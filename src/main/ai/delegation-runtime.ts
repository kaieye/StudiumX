import { runAgentLoop, type AgentLoopEvent } from './agent-loop'
import type { ChatMessage } from './provider-adapter'
import type { TeachingModelProviderProfile, TeachingSettingsV1 } from '../../shared/teaching-types'
import {
  buildDefaultRegistry,
  buildToolContext,
  type ToolRuntimeChildRunRecord,
  type ToolRuntimeEvent
} from './tools/registry'

export type ChildAgentProfile = 'read_only' | 'research' | 'workspace_audit'
export type ChildRunStatus = ToolRuntimeChildRunRecord['status']

export type ChildRunInput = {
  label: string
  prompt: string
  context?: string
  profile?: ChildAgentProfile
  maxIterations?: number
  timeoutMs?: number
}

export type ParallelChildRunInput = {
  tasks: ChildRunInput[]
  concurrency?: number
}

export type ChildRunUsage = NonNullable<ToolRuntimeChildRunRecord['usage']>

export type ChildRunResult = {
  childRunId: string
  label: string
  profile: ChildAgentProfile
  status: ChildRunStatus
  summary: string
  error?: string
  citations?: Array<{ sourceId: string; url: string; title?: string }>
  filesRead?: string[]
  usage?: ChildRunUsage
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

export type ChildRunRecord = ToolRuntimeChildRunRecord & {
  prompt: string
  parentStreamId?: string
}

export type DelegationRuntimeOptions = {
  settings: TeachingSettingsV1
  provider: TeachingModelProviderProfile
  workspaceRoot?: string
  parentStreamId?: string
  signal?: AbortSignal
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

export class ChildRunStore {
  private readonly records = new Map<string, ChildRunRecord>()

  create(input: {
    id: string
    label: string
    profile: ChildAgentProfile
    prompt: string
    parentStreamId?: string
  }): ChildRunRecord {
    const now = new Date().toISOString()
    const record: ChildRunRecord = {
      id: input.id,
      parentStreamId: input.parentStreamId,
      label: input.label,
      profile: input.profile,
      status: 'queued',
      prompt: input.prompt,
      startedAt: now
    }
    this.records.set(record.id, record)
    return record
  }

  update(id: string, patch: Partial<ChildRunRecord>): ChildRunRecord {
    const current = this.records.get(id)
    if (!current) throw new Error(`Unknown child run: ${id}`)
    const next: ChildRunRecord = { ...current, ...patch }
    this.records.set(id, next)
    return next
  }

  get(id: string): ChildRunRecord | null {
    return this.records.get(id) ?? null
  }

  list(parentStreamId?: string): ChildRunRecord[] {
    const records = [...this.records.values()]
    return parentStreamId ? records.filter((record) => record.parentStreamId === parentStreamId) : records
  }
}

export class DelegationRuntime {
  private readonly settings: TeachingSettingsV1
  private readonly provider: TeachingModelProviderProfile
  private readonly workspaceRoot?: string
  private readonly parentStreamId?: string
  private readonly signal?: AbortSignal
  private readonly store: ChildRunStore
  private nextRunNumber = 0

  constructor(options: DelegationRuntimeOptions & { store?: ChildRunStore }) {
    this.settings = options.settings
    this.provider = options.provider
    this.workspaceRoot = options.workspaceRoot
    this.parentStreamId = options.parentStreamId
    this.signal = options.signal
    this.store = options.store ?? new ChildRunStore()
  }

  async runChild(input: ChildRunInput, options: DelegationRuntimeRunOptions = {}): Promise<ChildRunResult> {
    const normalized = normalizeChildRunInput(input, this.settings.tools.maxIterations)
    const emit = options.emit ?? (() => undefined)
    const childRunId = this.createChildRunId()
    const record = this.store.create({
      id: childRunId,
      label: normalized.label,
      profile: normalized.profile,
      prompt: normalized.prompt,
      parentStreamId: this.parentStreamId
    })
    emit({ type: 'child_run_queued', child: toRuntimeRecord(record) })
    return this.runQueuedChild(childRunId, normalized, options)
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
    const queued = tasks.map((task) => {
      const normalized = normalizeChildRunInput(task, this.settings.tools.maxIterations)
      const childRunId = this.createChildRunId()
      const record = this.store.create({
        id: childRunId,
        label: normalized.label,
        profile: normalized.profile,
        prompt: normalized.prompt,
        parentStreamId: this.parentStreamId
      })
      options.emit?.({ type: 'child_run_queued', child: toRuntimeRecord(record) })
      return { childRunId, normalized }
    })

    const results = await mapWithConcurrencyLimit(queued, concurrency, ({ childRunId, normalized }) =>
      this.runQueuedChild(childRunId, normalized, options)
    )
    return buildParallelChildRunResult(results, concurrency)
  }

  private async runQueuedChild(
    childRunId: string,
    normalized: Required<ChildRunInput> & { profile: ChildAgentProfile },
    options: DelegationRuntimeRunOptions
  ): Promise<ChildRunResult> {
    const emit = options.emit ?? (() => undefined)
    const emitRecord = (type: ToolRuntimeEvent['type'], child: ToolRuntimeChildRunRecord): void => {
      if (type === 'child_run_delta') return
      emit({ type, child } as ToolRuntimeEvent)
    }

    const running = this.store.update(childRunId, { status: 'running', startedAt: new Date().toISOString() })
    emitRecord('child_run_started', toRuntimeRecord(running))

    try {
      const controllerSignal = withTimeoutSignal(this.signal, normalized.timeoutMs)
      const registry = childRegistryForProfile({
        settings: this.settings,
        workspaceRoot: this.workspaceRoot,
        profile: normalized.profile
      })
      const childEvents: AgentLoopEvent[] = []
      const result = await runAgentLoop({
        settings: this.settings,
        provider: this.provider,
        messages: buildChildMessages(normalized),
        tools: registry.definitions(),
        toolHandlers: registry.handlerMap(buildToolContext(this.settings, {
          workspaceRoot: this.workspaceRoot,
          signal: controllerSignal
        })),
        maxIterations: normalized.maxIterations,
        maxIterationsBehavior: 'error',
        signal: controllerSignal,
        callbacks: {
          onEvent: (event) => {
            childEvents.push(event)
            if (event.type === 'status') {
              emit({ type: 'child_run_delta', childRunId, message: event.message ?? event.status })
            }
          }
        }
      })

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
        const summary = '子任务已取消或超时。'
        const canceled = this.store.update(childRunId, {
          status: 'canceled',
          summary,
          usage,
          completedAt: new Date().toISOString()
        })
        emitRecord('child_run_canceled', toRuntimeRecord(canceled))
        return { childRunId, label: normalized.label, profile: normalized.profile, status: 'canceled', summary, filesRead, citations, usage }
      }
      if (result.error) {
        const childError = latestChildToolError(childEvents) ?? result.error
        const failed = this.store.update(childRunId, {
          status: 'failed',
          summary: `子任务失败：${childError}`,
          error: childError,
          usage,
          completedAt: new Date().toISOString()
        })
        emitRecord('child_run_failed', toRuntimeRecord(failed))
        return {
          childRunId,
          label: normalized.label,
          profile: normalized.profile,
          status: 'failed',
          summary: failed.summary ?? '',
          error: childError,
          filesRead,
          citations,
          usage
        }
      }

      const summary = result.finalText.trim() || '子任务完成，但没有返回摘要。'
      const completed = this.store.update(childRunId, {
        status: 'completed',
        summary,
        usage,
        completedAt: new Date().toISOString()
      })
      emitRecord('child_run_completed', toRuntimeRecord(completed))
      return { childRunId, label: normalized.label, profile: normalized.profile, status: 'completed', summary, filesRead, citations, usage }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failed = this.store.update(childRunId, {
        status: 'failed',
        summary: `子任务失败：${message}`,
        error: message,
        completedAt: new Date().toISOString(),
        usage: { toolCalls: 0 }
      })
      emitRecord('child_run_failed', toRuntimeRecord(failed))
      return {
        childRunId,
        label: normalized.label,
        profile: normalized.profile,
        status: 'failed',
        summary: failed.summary ?? '',
        error: message,
        usage: failed.usage
      }
    }
  }

  abortChild(childRunId: string): Promise<void> {
    const current = this.store.get(childRunId)
    if (current && current.status !== 'completed' && current.status !== 'failed' && current.status !== 'canceled') {
      this.store.update(childRunId, { status: 'canceled', completedAt: new Date().toISOString() })
    }
    return Promise.resolve()
  }

  listRuns(parentStreamId?: string): ChildRunRecord[] {
    return this.store.list(parentStreamId)
  }

  diagnostics(): { runs: ChildRunRecord[] } {
    return { runs: this.store.list() }
  }

  private createChildRunId(): string {
    this.nextRunNumber += 1
    return `child-${Date.now().toString(36)}-${this.nextRunNumber.toString(36)}`
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

function withTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal
}

function childUsage(messages: ChatMessage[]): ChildRunUsage {
  return { toolCalls: messages.filter((message) => message.role === 'tool').length }
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

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<TOut>(items.length)
  let nextIndex = 0
  await Promise.all(
    new Array(limit).fill(null).map(async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await worker(items[index], index)
      }
    })
  )
  return results
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

function toRuntimeRecord(record: ChildRunRecord): ToolRuntimeChildRunRecord {
  return {
    id: record.id,
    label: record.label,
    profile: record.profile,
    status: record.status,
    summary: record.summary,
    error: record.error,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    usage: record.usage
  }
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
