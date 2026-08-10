/**
 * AI-assisted mind map generation (see docs/mindmap/design.md §5.2).
 *
 * Reuses the existing provider routing / error classification / streaming layer —
 * no second provider channel. On any failure this throws a structured
 * `MindMapGenerationError`; it never fabricates a fallback document.
 *
 * Cancellation is propagated to the provider through the existing `AbortSignal`
 * contract, and resource-terminal outcomes are wired to the host
 * `AgentRunResourceGovernor` (plan §5.7 / m0-baseline P0 fix).
 */
import {
  callProvider,
  ProviderAdapterError,
  resolveActiveProvider,
  streamProvider,
  type AdapterCallbacks
} from '../ai/provider-adapter'
import {
  AgentRunResourceBoundaryError,
  AgentRunResourceGovernor
} from '../ai/agent-run-resource-governance'
import type {
  AgentRunResourceGovernance,
  TeachingSettingsV1
} from '../../shared/teaching-types'
import { classifyProviderError, providerErrorReason } from '../../shared/provider-error'
import { mindMapDocumentSchema } from '../../shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'
import {
  parseMindMapProposalJson,
  type MindMapProviderProposal
} from '../../shared/mindmap/commands/mind-map-proposal'
import type { MindMapProposalRequest } from '../../shared/mindmap/commands/mind-map-proposal-request'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'
import {
  buildMindMapProposalSystemPrompt,
  buildMindMapProposalUserPrompt,
  buildMindMapSystemPrompt,
  buildMindMapUserPrompt
} from './mind-map-prompts'
import type {
  MindMapLessonContext,
  MindMapNotesContext,
  MindMapSelectedFileContext
} from './mind-map-selected-file'

export type MindMapGenerationErrorKind =
  | 'invalid_output' // model returned non-JSON or failed Zod validation
  | 'provider' // provider/transport error (use classifyProviderError)
  | 'resource_limit' // resource governor terminal
  | 'suspended'
  | 'cancelled'

export class MindMapGenerationError extends Error {
  readonly kind: MindMapGenerationErrorKind
  constructor(kind: MindMapGenerationErrorKind, message: string) {
    super(message)
    this.name = 'MindMapGenerationError'
    this.kind = kind
  }
}

export type MindMapGenerationInput = {
  title: string
  prompt: string
  settings: TeachingSettingsV1
  /**
   * Stable correlation id used by `cancelMindMapGeneration` to abort the
   * in-flight provider request. Optional so existing callers (and tests that
   * only exercise pure parsing) keep working.
   */
  generationId?: string
  /** Host-owned cancellation signal; aborting it cancels the provider request. */
  signal?: AbortSignal
  /** Host-owned resource governance snapshot; terminal boundaries become resource_limit/suspended. */
  resourceGovernance?: AgentRunResourceGovernance
  /** Main-process bounded context from one explicitly selected workspace file. */
  selectedFileContext?: MindMapSelectedFileContext
  /** Main-process bounded context from one canonical generated Lesson artifact. */
  lessonContext?: MindMapLessonContext
}

export type MindMapProposalGenerationInput = {
  title: string
  prompt: string
  settings: TeachingSettingsV1
  document: MindMapDocumentV2
  request: MindMapProposalRequest
  /** Stable correlation id used by `cancelMindMapGeneration`. */
  generationId?: string
  /** Host-owned cancellation signal. */
  signal?: AbortSignal
  /** Host-owned resource governance snapshot. */
  resourceGovernance?: AgentRunResourceGovernance
  /** Main-process bounded context from one explicitly selected workspace file. */
  selectedFileContext?: MindMapSelectedFileContext
  /** Main-process bounded context from one canonical generated Lesson artifact. */
  lessonContext?: MindMapLessonContext
  /** Main-process bounded context from the canonical workspace `NOTES.md`. */
  notesContext?: MindMapNotesContext
}

/**
 * Active generation registry keyed by `generationId`. The IPC cancel path
 * (registered by the gateway) calls `cancelMindMapGeneration` so the abort
 * reaches the provider request instead of only hiding renderer loading state.
 */
const activeMindMapGenerations = new Map<string, AbortController>()

/** Abort the in-flight generation for `generationId`, if still active. */
export function cancelMindMapGeneration(generationId: string): boolean {
  const controller = activeMindMapGenerations.get(generationId)
  if (!controller) return false
  controller.abort()
  activeMindMapGenerations.delete(generationId)
  return true
}

// ---- Pure parsing (unit-testable without a live provider) ----

/** Strip an optional surrounding ```json / ``` markdown fence if present. */
function stripCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const match = /^```(?:json)?\s*([\s\S]*?)```\s*$/.exec(trimmed)
  if (match) return match[1].trim()
  // A dangling opening fence (streaming artifact) — drop the first line.
  const opening = /^```(?:json)?\s*\r?\n([\s\S]*)$/.exec(trimmed)
  return opening ? opening[1].trim() : trimmed
}

function formatZodError(error: import('zod').ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

/**
 * Pure helper: parse raw model text into a validated MindMapDocument.
 * Throws `MindMapGenerationError('invalid_output')` on any failure.
 */
export function parseMindMapOutput(raw: string): MindMapDocument {
  const cleaned = stripCodeFence(raw)

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new MindMapGenerationError('invalid_output', `模型输出不是有效 JSON：${detail}`)
  }

  const result = mindMapDocumentSchema.safeParse(parsed)
  if (!result.success) {
    throw new MindMapGenerationError(
      'invalid_output',
      `模型输出未通过思维导图结构校验：${formatZodError(result.error)}`
    )
  }
  return result.data
}

// ---- Generation ----

/**
 * Generate a mind map from the topic/prompt using the configured provider.
 * When `onStream` is provided the response is streamed and each delta is
 * forwarded; the accumulated output is then parsed and validated.
 *
 * When `input.generationId` is supplied the run is registered so
 * `cancelMindMapGeneration(generationId)` can abort the provider request.
 * `input.signal` and the resource governor's signal are both forwarded to the
 * provider adapter; an abort surfaces as `MindMapGenerationError('cancelled')`
 * and a governor terminal as `resource_limit` / `suspended` — never a forged
 * success document.
 */
export async function generateMindMap(
  input: MindMapGenerationInput,
  onStream?: (text: string) => void
): Promise<MindMapDocument> {
  const text = await runMindMapProvider(input, {
    systemPrompt: buildMindMapSystemPrompt({
      title: input.title,
      prompt: input.prompt,
      selectedFileContext: input.selectedFileContext,
      lessonContext: input.lessonContext
    }),
    userPrompt: buildMindMapUserPrompt({
      title: input.title,
      prompt: input.prompt,
      selectedFileContext: input.selectedFileContext,
      lessonContext: input.lessonContext
    })
  }, onStream)
  return parseMindMapOutput(text)
}

/**
 * Generate a strict, reviewable provider proposal against one canonical v2
 * snapshot. This function only calls the provider and parses its response; it
 * never applies commands or persists the document.
 */
export async function generateMindMapProposal(
  input: MindMapProposalGenerationInput
): Promise<MindMapProviderProposal> {
  const text = await runMindMapProvider(input, {
    systemPrompt: buildMindMapProposalSystemPrompt({
      title: input.title,
      prompt: input.prompt,
      request: input.request
    }),
    userPrompt: buildMindMapProposalUserPrompt({
      title: input.title,
      prompt: input.prompt,
      request: input.request,
      selectedFileContext: input.selectedFileContext,
      notesContext: input.notesContext,
      lessonContext: input.lessonContext,
      document: input.document
    })
  })
  const parsed = parseMindMapProposalJson(text)
  if (!parsed.ok) {
    throw new MindMapGenerationError('invalid_output', parsed.message)
  }
  if (parsed.proposal.scope !== input.request.scope) {
    throw new MindMapGenerationError(
      'invalid_output',
      `mind-map proposal scope mismatch: expected ${input.request.scope}`
    )
  }
  return parsed.proposal
}

type MindMapProviderCallInput = Pick<
  MindMapGenerationInput,
  'settings' | 'generationId' | 'signal' | 'resourceGovernance'
>

/** Shared provider invocation seam for full documents and reviewable diffs. */
async function runMindMapProvider(
  input: MindMapProviderCallInput,
  prompts: { systemPrompt: string; userPrompt: string },
  onStream?: (text: string) => void
): Promise<string> {
  const provider = resolveActiveProvider(input.settings)
  if (!provider || !provider.apiKey.trim()) {
    throw new MindMapGenerationError('provider', '未配置可用的 AI Provider 或 API Key。')
  }

  const governor = new AgentRunResourceGovernor({
    governance: input.resourceGovernance,
    parentSignal: input.signal
  })
  const runController = input.generationId ? new AbortController() : undefined
  if (runController) activeMindMapGenerations.set(input.generationId!, runController)
  const signal = composeSignals(input.signal, governor.signal, runController?.signal)

  try {
    const request = { ...prompts, jsonMode: true }
    try {
      governor.preflight('logical_requests', 1)
      governor.claim('logical_requests', 1)
      if (onStream) {
        const callbacks: AdapterCallbacks = {
          // A provider transport may deliver one final queued delta after its
          // abort signal fires. Never surface that stale preview to the
          // renderer after cancellation/resource termination.
          onToken: (delta) => {
            if (!signal?.aborted) onStream(delta)
          }
        }
        const result = await streamProvider({
          settings: input.settings,
          provider,
          request,
          callbacks,
          signal
        })
        if (result.usage?.totalTokens !== undefined) {
          governor.consume('total_tokens', Math.max(0, Math.floor(result.usage.totalTokens)))
        }
        return result.text
      }

      const result = await callProvider({
        settings: input.settings,
        provider,
        request,
        signal
      })
      if (result.usage?.totalTokens !== undefined) {
        governor.consume('total_tokens', Math.max(0, Math.floor(result.usage.totalTokens)))
      }
      return result.text
    } catch (error) {
      throw mapGenerationError(error, governor, signal)
    }
  } finally {
    // Do not let an older run with a reused generation id delete a newer run's
    // cancellation lease. This identity check also makes cleanup idempotent
    // when cancellation removed the entry before provider settlement.
    if (runController && activeMindMapGenerations.get(input.generationId!) === runController) {
      activeMindMapGenerations.delete(input.generationId!)
    }
    governor.dispose()
  }
}

/**
 * Normalize a provider/transport/resource failure into a `MindMapGenerationError`.
 *
 * Cancellation is detected from the effective signal before provider error
 * classification, so aborting a request surfaces as `cancelled`. A terminated
 * resource governor surfaces as `resource_limit` / `suspended`. Provider errors
 * are classified via `classifyProviderError` for a canonical message.
 */
function mapGenerationError(
  error: unknown,
  governor: AgentRunResourceGovernor,
  signal?: AbortSignal
): MindMapGenerationError {
  if (error instanceof MindMapGenerationError) return error

  if (governor.isTerminated) {
    const boundary = governor.boundary
    const kind = boundary?.action === 'suspended' ? 'suspended' : 'resource_limit'
    return new MindMapGenerationError(
      kind,
      boundary ? new AgentRunResourceBoundaryError(boundary).message : '已达到资源边界。'
    )
  }

  if (governor.signal.aborted || signal?.aborted) {
    return new MindMapGenerationError('cancelled', 'AI 生成已取消。')
  }

  if (error instanceof ProviderAdapterError) {
    return new MindMapGenerationError('provider', `AI 生成失败：${adapterErrorReason(error)}`)
  }

  const info = classifyProviderError(error)
  const reason = info
    ? providerErrorReason(info)
    : error instanceof Error
      ? error.message
      : String(error)
  return new MindMapGenerationError('provider', `AI 生成失败：${reason}`)
}

function composeSignals(...candidates: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const signals = candidates.filter((signal): signal is AbortSignal => signal !== undefined)
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  return AbortSignal.any(signals)
}

function adapterErrorReason(error: ProviderAdapterError): string {
  switch (error.kind) {
    case 'no_api_key':
      return '未配置 API Key'
    case 'network':
      return '网络错误'
    case 'http':
      return providerErrorReason(classifyProviderError(error.message) ?? { kind: 'http' })
    case 'parse':
      return '响应解析失败'
    case 'timeout':
      return '请求超时'
    case 'unsupported':
      return '不支持的 endpoint 格式'
    default:
      return error.message
  }
}
