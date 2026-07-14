import { runAgentLoop, type AgentLoopEvent } from './agent-loop'
import type { ChatMessage } from './provider-adapter'
import type { AgentArtifactRef, TeachingModelProviderProfile, TeachingSettingsV1 } from '../../shared/teaching-types'
import {
  ChildRunStore,
  ChildRunSupervisor,
  type ChildRunExecutionResult,
  type SupervisedChildRun
} from './child-run-supervisor'
import type { ToolRuntimeEvent } from './tools/registry'
import { buildDefaultRegistry, buildToolContext } from './tools/registry'

export {
  ChildRunStore,
  type ChildAgentProfile,
  type ChildRunInput,
  type ChildRunRecord,
  type ChildRunResult,
  type ChildRunStatus,
  type ChildRunUsage
} from './child-run-supervisor'
import type {
  ChildAgentProfile,
  ChildRunInput,
  ChildRunRecord,
  ChildRunResult,
  ChildRunUsage
} from './child-run-supervisor'

export type ParallelChildRunInput = {
  tasks: ChildRunInput[]
  concurrency?: number
}

export type ParallelChildRunResult = {
  mode: 'parallel'
  status: 'completed' | 'partial' | 'failed' | 'canceled'
  total: number
  completed: number
  failed: number
  canceled: number
  concurrency: number
  summary: string
  results: ChildRunResult[]
  usage?: ChildRunUsage
}

export type DelegationRuntimeOptions = {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  workspaceRoot?: string
  parentStreamId?: string
  signal?: AbortSignal
  stageTranscript?: (childRunId: string, transcript: string) => Promise<AgentArtifactRef>
}

export type DelegationRuntimeRunOptions = {
  emit?: (event: ToolRuntimeEvent) => void
}

const DEFAULT_CHILD_MAX_ITERATIONS = 4
const MAX_CHILD_MAX_ITERATIONS = 10
const DEFAULT_CHILD_TIMEOUT_MS = 120_000
const MAX_CHILD_TIMEOUT_MS = 300_000
const MAX_PARALLEL_CHILD_TASKS = 8
const DEFAULT_PARALLEL_CHILD_CONCURRENCY = 3
const MAX_PARALLEL_CHILD_CONCURRENCY = 4

const WORKSPACE_READ_TOOL_NAMES = [
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace'
] as const

const WEB_TOOL_NAMES = ['web_search', 'web_fetch'] as const

/**
 * Caller-facing facade for child delegation. The supervisor owns child-run
 * supervision; this facade retains the agent-loop invocation and tool-policy
 * boundaries that determine what a child may execute.
 */
export class DelegationRuntime {
  private readonly supervisor: ChildRunSupervisor

  constructor(private readonly options: DelegationRuntimeOptions & { store?: ChildRunStore }) {
    this.supervisor = new ChildRunSupervisor({
      parentStreamId: options.parentStreamId,
      signal: options.signal,
      store: options.store,
      execute: (input, lifecycle) => this.executeChild(input, lifecycle)
    })
  }

  async runChild(input: ChildRunInput, options: DelegationRuntimeRunOptions = {}): Promise<ChildRunResult> {
    return this.supervisor.run(normalizeChildRunInput(input, this.options.settings.tools.maxIterations), options)
  }

  async runChildren(input: ParallelChildRunInput, options: DelegationRuntimeRunOptions = {}): Promise<ParallelChildRunResult> {
    const tasks = Array.isArray(input.tasks) ? input.tasks : []
    if (tasks.length === 0) throw new Error('parallel_tasks 缺少 tasks。')
    if (tasks.length > MAX_PARALLEL_CHILD_TASKS) {
      throw new Error(`parallel_tasks 最多支持 ${MAX_PARALLEL_CHILD_TASKS} 个子任务。`)
    }
    const concurrency = clampInteger(
      input.concurrency,
      1,
      Math.min(MAX_PARALLEL_CHILD_CONCURRENCY, tasks.length),
      Math.min(DEFAULT_PARALLEL_CHILD_CONCURRENCY, tasks.length)
    )
    const results = await this.supervisor.runMany(
      tasks.map((task) => normalizeChildRunInput(task, this.options.settings.tools.maxIterations)),
      concurrency,
      options
    )
    return buildParallelChildRunResult(results, concurrency)
  }

  async abortChild(childRunId: string): Promise<void> {
    await this.supervisor.abort(childRunId)
  }

  listRuns(parentStreamId?: string): ChildRunRecord[] {
    return this.supervisor.list(parentStreamId)
  }

  diagnostics(): { runs: ChildRunRecord[] } {
    return this.supervisor.diagnostics()
  }

  private async executeChild(
    input: SupervisedChildRun,
    lifecycle: { childRunId: string; signal: AbortSignal; onDelta: (message: string) => void }
  ): Promise<ChildRunExecutionResult> {
    const registry = childRegistryForProfile({
      settings: this.options.settings,
      workspaceRoot: this.options.workspaceRoot,
      profile: input.profile
    })
    const childEvents: AgentLoopEvent[] = []
    const initialMessages = buildChildMessages(input)
    let transcriptMessages = initialMessages
    let stopReason: string | undefined
    let output: ChildRunExecutionResult
    try {
      const result = await runAgentLoop({
        settings: this.options.settings,
        provider: this.options.provider,
        messages: initialMessages,
        tools: registry.definitions(),
        toolHandlers: registry.handlerMap(buildToolContext(this.options.settings, {
          workspaceRoot: this.options.workspaceRoot,
          signal: lifecycle.signal
        })),
        maxIterations: input.maxIterations,
        maxIterationsBehavior: 'error',
        signal: lifecycle.signal,
        callbacks: {
          onEvent: (event) => {
            childEvents.push(event)
            if (event.type === 'status') lifecycle.onDelta(event.message ?? event.status)
          }
        }
      })
      transcriptMessages = result.messages
      stopReason = result.stopReason
      const usage: ChildRunUsage = {
        providerCalls: result.usage.providerCalls,
        toolCalls: result.usage.toolCalls,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens
      }
      const filesRead = extractFilesRead(result.messages)
      const citations = extractCitations(result.messages)
      if (result.stopReason === 'canceled') {
        output = { status: 'canceled', summary: '子任务已取消或超时。', filesRead, citations, usage }
      } else if (result.error) {
        const childError = latestChildToolError(childEvents) ?? result.error
        output = {
          status: 'failed',
          summary: `子任务失败：${childError}`,
          error: childError,
          filesRead,
          citations,
          usage
        }
      } else {
        output = {
          status: 'completed',
          summary: result.finalText.trim() || '子任务完成，但没有返回摘要。',
          filesRead,
          citations,
          usage
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      output = lifecycle.signal.aborted
        ? { status: 'canceled', summary: '子任务已取消或超时。', usage: { toolCalls: 0 } }
        : {
            status: 'failed',
            summary: `子任务失败：${message}`,
            error: message,
            usage: { toolCalls: 0 }
          }
    }

    const archive = this.options.stageTranscript
      ? await this.options.stageTranscript(lifecycle.childRunId, buildChildTranscript({
          childRunId: lifecycle.childRunId,
          input,
          output,
          stopReason,
          messages: transcriptMessages
        }))
      : undefined
    return archive ? { ...output, archive } : output
  }
}
export function childRegistryForProfile(options: {
  settings: TeachingSettingsV1
  workspaceRoot?: string
  profile: ChildAgentProfile
}) {
  const base = buildDefaultRegistry(options.settings, {
    workspaceRoot: options.workspaceRoot,
    workspaceWrite: false
  })
  const allow = toolNamesForProfile(options.profile)
  return base.project({ allow })
}

function toolNamesForProfile(profile: ChildAgentProfile): string[] {
  if (profile === 'workspace_audit') return [...WORKSPACE_READ_TOOL_NAMES]
  return [...WORKSPACE_READ_TOOL_NAMES, ...WEB_TOOL_NAMES]
}

function normalizeChildRunInput(input: ChildRunInput, settingsMaxIterations: number): Required<ChildRunInput> & {
  profile: ChildAgentProfile
} {
  const label = cleanText(input.label).slice(0, 80) || '只读子任务'
  const prompt = cleanText(input.prompt)
  if (!prompt) throw new Error('delegate_task 缺少 prompt。')
  const context = cleanText(input.context).slice(0, 12_000)
  const profile = normalizeProfile(input.profile)
  const defaultIterations =
    settingsMaxIterations > 0
      ? Math.min(MAX_CHILD_MAX_ITERATIONS, Math.max(1, settingsMaxIterations))
      : DEFAULT_CHILD_MAX_ITERATIONS
  return {
    label,
    prompt,
    context,
    profile,
    maxIterations: clampInteger(input.maxIterations, 1, MAX_CHILD_MAX_ITERATIONS, defaultIterations),
    timeoutMs: clampInteger(input.timeoutMs, 1_000, MAX_CHILD_TIMEOUT_MS, DEFAULT_CHILD_TIMEOUT_MS)
  }
}

function normalizeProfile(value: unknown): ChildAgentProfile {
  return value === 'research' || value === 'workspace_audit' ? value : 'read_only'
}

function buildChildMessages(input: Required<ChildRunInput> & { profile: ChildAgentProfile }): ChatMessage[] {
  const contextBlock = input.context
    ? ['<parent-context>', input.context, '</parent-context>', ''].join('\n')
    : ''
  return [
    {
      role: 'system',
      content: [
        '你是 StudiumX 的只读 child agent。你的任务是完成父 agent 派发的一个窄任务，并返回可直接给父 agent 使用的摘要。',
        '你只能做读取、检索、抓取和分析；不要写文件、生成课程、询问用户、派发子任务或修改任何工作区状态。',
        '如果需要工作区信息，使用只读工作区工具。若工具不可用，明确说明无法验证，不要假装读取过文件。',
        '最终答复保持简洁，列出关键结论、必要的文件路径或来源链接，以及仍不确定的点。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `<child-task label="${escapePromptAttribute(input.label)}" profile="${input.profile}">`,
        contextBlock,
        input.prompt,
        '</child-task>'
      ].join('\n')
    }
  ]
}

function buildChildTranscript(input: {
  childRunId: string
  input: SupervisedChildRun
  output: ChildRunExecutionResult
  stopReason?: string
  messages: ChatMessage[]
}): string {
  return `${JSON.stringify({
    version: 1,
    childRunId: input.childRunId,
    label: input.input.label,
    profile: input.input.profile,
    status: input.output.status,
    stopReason: input.stopReason,
    error: input.output.error,
    usage: input.output.usage,
    messages: input.messages
  }, null, 2)}\n`
}

function buildParallelChildRunResult(results: ChildRunResult[], concurrency: number): ParallelChildRunResult {
  const completed = results.filter((result) => result.status === 'completed').length
  const failed = results.filter((result) => result.status === 'failed').length
  const canceled = results.filter((result) => result.status === 'canceled').length
  const status = completed === results.length
    ? 'completed'
    : completed > 0
      ? 'partial'
      : canceled === results.length
        ? 'canceled'
        : 'failed'
  const summaryLines = [
    `并行子任务完成：${completed}/${results.length} 成功，${failed} 失败，${canceled} 取消。`,
    '',
    ...results.map((result, index) => [
      `### ${index + 1}. ${result.label} (${result.status})`,
      compactChildSummary(result.summary),
      result.filesRead?.length ? `Files read: ${result.filesRead.join(', ')}` : '',
      result.citations?.length ? `Sources: ${result.citations.map((item) => item.url).join(', ')}` : ''
    ].filter(Boolean).join('\n'))
  ]
  return {
    mode: 'parallel',
    status,
    total: results.length,
    completed,
    failed,
    canceled,
    concurrency,
    summary: summaryLines.join('\n\n'),
    results,
    usage: aggregateChildUsage(results)
  }
}

function aggregateChildUsage(results: ChildRunResult[]): ChildRunUsage {
  const usage: ChildRunUsage = { toolCalls: 0 }
  for (const result of results) {
    usage.providerCalls = sumOptional(usage.providerCalls, result.usage?.providerCalls)
    usage.toolCalls += result.usage?.toolCalls ?? 0
    usage.promptTokens = sumOptional(usage.promptTokens, result.usage?.promptTokens)
    usage.completionTokens = sumOptional(usage.completionTokens, result.usage?.completionTokens)
    usage.totalTokens = sumOptional(usage.totalTokens, result.usage?.totalTokens)
  }
  return usage
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (right === undefined) return left
  return (left ?? 0) + right
}

function compactChildSummary(value: string): string {
  const maxLength = 4000
  const normalized = value.replace(/\s+$/g, '').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function latestChildToolError(events: AgentLoopEvent[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type !== 'tool_result' || !event.isError) continue
    const parsed = safeParseJson(event.result) as { error?: unknown }
    const message = typeof parsed.error === 'string' ? parsed.error.trim() : event.result.trim()
    if (message) return message
  }
  return null
}

function extractFilesRead(messages: ChatMessage[]): string[] | undefined {
  const paths = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const call of message.tool_calls ?? []) {
      if (!WORKSPACE_READ_TOOL_NAMES.includes(call.function.name as typeof WORKSPACE_READ_TOOL_NAMES[number])) continue
      const args = safeParseJson(call.function.arguments) as { path?: unknown; pattern?: unknown }
      const path = typeof args.path === 'string' && args.path.trim()
        ? args.path.trim()
        : call.function.name === 'glob_workspace' && typeof args.pattern === 'string'
          ? args.pattern.trim()
          : ''
      if (path) paths.add(path)
    }
  }
  return paths.size > 0 ? [...paths] : undefined
}

function extractCitations(messages: ChatMessage[]): Array<{ sourceId: string; url: string; title?: string }> | undefined {
  const citations = new Map<string, { sourceId: string; url: string; title?: string }>()
  for (const message of messages) {
    if (message.role !== 'tool') continue
    const parsed = safeParseJson(message.content)
    collectCitations(parsed, citations)
  }
  return citations.size > 0 ? [...citations.values()] : undefined
}

function collectCitations(value: unknown, out: Map<string, { sourceId: string; url: string; title?: string }>): void {
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) collectCitations(item, out)
    return
  }
  const record = value as Record<string, unknown>
  const sourceId = typeof record.sourceId === 'string' ? record.sourceId : ''
  const url = typeof record.url === 'string'
    ? record.url
    : typeof record.finalUrl === 'string'
      ? record.finalUrl
      : ''
  if (sourceId && url && !out.has(sourceId)) {
    out.set(sourceId, {
      sourceId,
      url,
      title: typeof record.title === 'string' ? record.title : undefined
    })
  }
  for (const nested of Object.values(record)) collectCitations(nested, out)
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim()
}

function escapePromptAttribute(value: string): string {
  return value.replace(/"/g, "'")
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value || '{}')
  } catch {
    return {}
  }
}
