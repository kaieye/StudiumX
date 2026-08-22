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
import type { AgentChatImageAttachment } from '../../shared/agent-chat-images'
import type { MindMapConversationHistoryTurn } from '../../shared/teaching-types/mindmap'
import { classifyProviderError, providerErrorReason } from '../../shared/provider-error'
import { mindMapDocumentSchema } from '../../shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'
import {
  parseMindMapProposalJson,
  salvageFirstParseableJsonRoot,
  type MindMapProviderProposal
} from '../../shared/mindmap/commands/mind-map-proposal'
import { reconcileMindMapProposalTopicIds } from '../../shared/mindmap/commands/mind-map-proposal-topic-ids'
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
import type { MindMapAutoSourceContext } from './mind-map-auto-source'

export type MindMapGenerationErrorKind =
  | 'invalid_output' // model returned non-JSON or failed Zod validation
  | 'provider' // provider/transport error (use classifyProviderError)
  | 'resource_limit' // resource governor terminal
  | 'suspended'
  | 'cancelled'

/**
 * Optional provider adapter diagnosis carried on a `provider` error. It is
 * derived from `ProviderAdapterError.code` and lets the generation layer tell
 * an output-shape failure (model streamed reasoning but no content, or an
 * empty answer) apart from a genuine transport/network failure. Reasoning-only
 * and empty-output failures are recoverable with one non-streaming repair
 * retry; transport failures must surface to the learner as-is.
 */
export type MindMapGenerationProviderCode =
  | 'reasoning_only'
  | 'empty_output'

export class MindMapGenerationError extends Error {
  readonly kind: MindMapGenerationErrorKind
  /** Only set when `kind === 'provider'` and the adapter reported a recoverable output shape. */
  readonly code?: MindMapGenerationProviderCode
  constructor(kind: MindMapGenerationErrorKind, message: string, code?: MindMapGenerationProviderCode) {
    super(message)
    this.name = 'MindMapGenerationError'
    this.kind = kind
    this.code = code
  }
}

export type MindMapGenerationInput = {
  title: string
  prompt: string
  settings: TeachingSettingsV1
  /** Prior mind-map conversation turns so a follow-up keeps context. */
  history?: MindMapConversationHistoryTurn[]
  /** User-selected images sent with the generation turn (same payload as agent chat). */
  imageAttachments?: AgentChatImageAttachment[]
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
  /** Main-process context from Markdown files inferred from this user prompt. */
  autoSourceContext?: MindMapAutoSourceContext
  /** Main-process bounded context from one canonical generated Lesson artifact. */
  lessonContext?: MindMapLessonContext
}

export type MindMapProposalGenerationInput = {
  title: string
  prompt: string
  settings: TeachingSettingsV1
  document: MindMapDocumentV2
  request: MindMapProposalRequest
  /** Prior mind-map conversation turns so a follow-up keeps context. */
  history?: MindMapConversationHistoryTurn[]
  /** User-selected images sent with the generation turn (same payload as agent chat). */
  imageAttachments?: AgentChatImageAttachment[]
  /** Stable correlation id used by `cancelMindMapGeneration`. */
  generationId?: string
  /** Host-owned cancellation signal. */
  signal?: AbortSignal
  /** Host-owned resource governance snapshot. */
  resourceGovernance?: AgentRunResourceGovernance
  /** Main-process bounded context from one explicitly selected workspace file. */
  selectedFileContext?: MindMapSelectedFileContext
  /** Main-process context from Markdown files inferred from this user prompt. */
  autoSourceContext?: MindMapAutoSourceContext
  /** Main-process bounded context from one canonical generated Lesson artifact. */
  lessonContext?: MindMapLessonContext
  /** Main-process bounded context from the canonical workspace `NOTES.md`. */
  notesContext?: MindMapNotesContext
}

/** Optional presentation-only response attached to a provider result. */
export type MindMapGeneratedProposal = MindMapProviderProposal & {
  /** Never send this field through the canonical apply IPC payload. */
  assistantMessage?: string
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
  } catch {
    // Tolerate trailing prose/fence after a complete JSON document; a genuinely
    // truncated root stays an invalid_output so the caller can repair-retry.
    parsed = salvageFirstParseableJsonRoot(cleaned)
    if (parsed === null) {
      throw new MindMapGenerationError('invalid_output', '模型输出不是有效 JSON')
    }
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
  onStream?: (text: string) => void,
  onReasoning?: (text: string) => void
): Promise<MindMapDocument> {
  const buildPrompts = (repair?: string): { systemPrompt: string; userPrompt: string } => {
    const userPrompt = buildMindMapUserPrompt({
      title: input.title,
      prompt: input.prompt,
      history: input.history,
      selectedFileContext: input.selectedFileContext,
      autoSourceContext: input.autoSourceContext,
      lessonContext: input.lessonContext
    })
    return {
      systemPrompt: buildMindMapSystemPrompt({
        title: input.title,
        prompt: input.prompt,
        history: input.history,
        selectedFileContext: input.selectedFileContext,
        autoSourceContext: input.autoSourceContext,
        lessonContext: input.lessonContext
      }),
      userPrompt: repair ? `${userPrompt}\n\n${repair}` : userPrompt
    }
  }

  let text: string
  try {
    text = await runMindMapProvider(input, buildPrompts(), onStream, onReasoning)
  } catch (firstError) {
    // A DeepSeek-style reasoning model may stream reasoning and settle with an
    // empty `content` (reasoning_only) or an empty answer. That is an
    // output-shape problem, not a network failure: retry once, non-streaming,
    // so the provider returns a complete document instead of surfacing a
    // "响应解析失败" parse error to the learner.
    if (!isRepairRetryableProviderError(firstError)) throw firstError
    text = await runMindMapProvider(
      input,
      buildPrompts(buildMindMapRepairInstruction(errorMessage(firstError))),
      undefined,
      undefined,
      mindMapRepairOutputTokens(input.settings.generator.maxOutputTokens)
    )
  }
  try {
    return parseMindMapOutput(text)
  } catch (firstError) {
    if (!(firstError instanceof MindMapGenerationError) || firstError.kind !== 'invalid_output') {
      throw firstError
    }
    // One bounded repair retry for a truncated or trailing-garbage document.
    // Fully non-streaming so the repair is never cut short by provider
    // reasoning tokens and the renderer preview is never fed a second
    // concatenated JSON payload.
    text = await runMindMapProvider(
      input,
      buildPrompts(buildMindMapRepairInstruction(firstError.message)),
      undefined,
      undefined,
      mindMapRepairOutputTokens(input.settings.generator.maxOutputTokens)
    )
    return parseMindMapOutput(text)
  }
}

/**
 * Generate a strict, reviewable provider proposal against one canonical v2
 * snapshot. This function only calls the provider and parses its response; it
 * never applies commands or persists the document.
 */
export async function generateMindMapProposal(
  input: MindMapProposalGenerationInput,
  onStream?: (text: string) => void,
  onReasoning?: (text: string) => void
): Promise<MindMapGeneratedProposal> {
  // The renderer deliberately does not get to declare a request as an
  // "initial map": derive it from the canonical v2 snapshot that the main
  // process just loaded. A blank sheet needs a complete hierarchy, whereas an
  // established map must retain the conservative proposal behavior.
  const initialMap = isInitialMindMapProposal(input)
  const buildPrompts = (repair?: string): { systemPrompt: string; userPrompt: string } => {
    const userPrompt = buildMindMapProposalUserPrompt({
      title: input.title,
      prompt: input.prompt,
      request: input.request,
      history: input.history,
      initialMap,
      selectedFileContext: input.selectedFileContext,
      autoSourceContext: input.autoSourceContext,
      notesContext: input.notesContext,
      lessonContext: input.lessonContext,
      document: input.document
    })
    return {
      systemPrompt: buildMindMapProposalSystemPrompt({
        title: input.title,
        prompt: input.prompt,
        request: input.request,
        history: input.history,
        initialMap
      }),
      userPrompt: repair ? `${userPrompt}\n\n${repair}` : userPrompt
    }
  }

  let text: string
  try {
    text = await runMindMapProvider(input, buildPrompts(), onStream, onReasoning)
  } catch (firstError) {
    // Same reasoning-only / empty-output recovery as full-document generation:
    // a DeepSeek-style reasoning model that streamed no content must not become
    // a hard "响应解析失败" provider error. Retry once, non-streaming.
    if (!isRepairRetryableProviderError(firstError)) throw firstError
    text = await runMindMapProvider(
      input,
      buildPrompts(buildMindMapRepairInstruction(errorMessage(firstError))),
      undefined,
      undefined,
      mindMapRepairOutputTokens(input.settings.generator.maxOutputTokens)
    )
  }
  let parsed = parseMindMapProposalJson(text)
  if (!parsed.ok) {
    // One bounded repair retry: providers occasionally truncate the envelope
    // at the output-token limit or append a note/fence after a complete JSON
    // root that even salvage cannot read. Fully non-streaming so the repair is
    // never cut short by provider reasoning tokens and the renderer preview is
    // never fed a second, concatenated JSON payload.
    text = await runMindMapProvider(
      input,
      buildPrompts(buildMindMapRepairInstruction(parsed.message)),
      undefined,
      undefined,
      mindMapRepairOutputTokens(input.settings.generator.maxOutputTokens)
    )
    parsed = parseMindMapProposalJson(text)
  }
  if (!parsed.ok) {
    throw new MindMapGenerationError('invalid_output', parsed.message)
  }
  if (parsed.proposal.scope !== input.request.scope) {
    throw new MindMapGenerationError(
      'invalid_output',
      `mind-map proposal scope mismatch: expected ${input.request.scope}`
    )
  }
  return {
    ...parsed.proposal,
    items: reconcileMindMapProposalTopicIds(input.document, parsed.proposal.items),
    ...(parsed.assistantMessage ? { assistantMessage: parsed.assistantMessage } : {})
  }
}

/**
 * A provider error that is really an output-shape problem, not a transport or
 * network failure. DeepSeek-style reasoning models can stream `reasoning_content`
 * and settle with an empty `content` (reasoning_only), or return an empty
 * answer (empty_output). Both are worth one non-streaming repair retry before
 * any message reaches the learner; everything else (network, HTTP, auth,
 * resource boundary, cancellation) must surface unchanged.
 */
function isRepairRetryableProviderError(error: unknown): boolean {
  if (!(error instanceof MindMapGenerationError) || error.kind !== 'provider') return false
  return error.code === 'reasoning_only' || error.code === 'empty_output'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Repair retries raise the output budget so a large document/proposal that was
 * truncated at the learner's configured cap (or starved by provider reasoning
 * tokens) can be returned in full. The first attempt always honors the
 * configured budget; only the single bounded repair escalates. The effective
 * cap is still clamped by the model catalog in the request builder.
 */
const MIND_MAP_REPAIR_OUTPUT_TOKENS = 32_768

function mindMapRepairOutputTokens(configured: number): number {
  return Math.max(configured, MIND_MAP_REPAIR_OUTPUT_TOKENS)
}

/**
 * Learner-safe repair instruction appended to the user prompt for exactly one
 * retry after an invalid provider output. It never repeats the system prompt
 * or any source text; the diagnostic is a short, generic validation summary.
 */
function buildMindMapRepairInstruction(diagnostic: string): string {
  return `你上一次的输出没有通过严格 JSON 校验（${diagnostic}）。
请只输出一个完整、有效、不截断的 JSON 对象，并严格遵守系统提示中的输出契约：
- 不要使用 markdown 代码围栏（\`\`\`json），不要输出任何解释、结尾语或额外文字。
- 确保所有括号、引号和逗号都正确闭合，schemaVersion 与 scope 完全正确。
- 如果内容较多，请完整输出全部 items，不要因为长度而提前截断。
只输出 JSON 对象本身。`
}

/**
 * An empty sheet is the first-generation path even though it is already a
 * persisted document. Explicit topic selection remains an edit request: this
 * prevents a user selecting the root merely to make a small change from
 * accidentally asking the provider to rebuild the entire map.
 */
function isInitialMindMapProposal(input: MindMapProposalGenerationInput): boolean {
  if (input.request.selectedTopicIds.length > 0) return false
  const sheet = input.document.sheets.find((candidate) => candidate.id === input.request.sheetId)
  return sheet !== undefined && sheet.root.children.length === 0
}

type MindMapProviderCallInput = Pick<
  MindMapGenerationInput,
  'settings' | 'generationId' | 'signal' | 'resourceGovernance' | 'imageAttachments'
>

/** Shared provider invocation seam for full documents and reviewable diffs. */
async function runMindMapProvider(
  input: MindMapProviderCallInput,
  prompts: { systemPrompt: string; userPrompt: string },
  onStream?: (text: string) => void,
  onReasoning?: (text: string) => void,
  outputTokenOverride?: number
): Promise<string> {
  // A repair retry may raise the output budget so a large document/proposal
  // that was truncated at the configured cap (or starved by provider
  // reasoning tokens) can be returned in full. The first attempt always
  // honors the learner's configured budget; only the bounded repair escalates.
  const settings = outputTokenOverride
    ? {
        ...input.settings,
        generator: {
          ...input.settings.generator,
          maxOutputTokens: outputTokenOverride
        }
      }
    : input.settings
  const provider = resolveActiveProvider(settings)
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
    const request = {
      ...prompts,
      jsonMode: true,
      ...(input.imageAttachments?.length ? { imageAttachments: input.imageAttachments } : {})
    }
    try {
      governor.preflight('logical_requests', 1)
      governor.claim('logical_requests', 1)
      if (onStream || onReasoning) {
        const callbacks: AdapterCallbacks = {
          // A provider transport may deliver one final queued delta after its
          // abort signal fires. Never surface that stale preview to the
          // renderer after cancellation/resource termination.
          onToken: (delta) => {
            if (!signal?.aborted) onStream?.(delta)
          },
          onReasoning: (delta) => {
            if (!signal?.aborted) onReasoning?.(delta)
          }
        }
        const result = await streamProvider({
          settings,
          provider,
          request,
          callbacks,
          signal,
          beforeTransportDispatch: () => governor.claim('provider_transport_attempts')
        })
        if (result.usage?.totalTokens !== undefined) {
          governor.consume('total_tokens', Math.max(0, Math.floor(result.usage.totalTokens)))
        }
        return result.text
      }

      const result = await callProvider({
        settings,
        provider,
        request,
        signal,
        beforeTransportDispatch: () => governor.claim('provider_transport_attempts')
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
    // Carry the adapter's output-shape diagnosis (reasoning_only / empty_output)
    // so the generation layer can repair-retry instead of surfacing a parse
    // failure to the learner. Genuine transport errors have no code and pass
    // through unchanged.
    const code: MindMapGenerationProviderCode | undefined =
      error.code === 'reasoning_only' || error.code === 'empty_output' ? error.code : undefined
    return new MindMapGenerationError('provider', `AI 生成失败：${adapterErrorReason(error)}`, code)
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
