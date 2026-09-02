/**
 * AI-assisted mind map generation (see docs/mindmap/design.md §5.2).
 *
 * Generation runs as a bounded agent loop over the shared teaching agent
 * runner (see `mind-map-agent.ts`): the model streams its reasoning, decides
 * which workspace reads it needs, and hands over the strict mind-map envelope
 * through a terminal submit tool. The envelope is validated with the same
 * pure parsers as before and never applied to the canonical document here.
 *
 * On any failure this throws a structured `MindMapGenerationError`; it never
 * fabricates a fallback document. Cancellation is propagated through the
 * existing `AbortSignal` contract, and resource-terminal outcomes are wired
 * to the host `AgentRunResourceGovernor` (plan §5.7 / m0-baseline P0 fix).
 */
import type {
  AgentRunResourceGovernance,
  TeachingSettingsV1
} from '../../shared/teaching-types'
import type { AgentChatImageAttachment } from '../../shared/agent-chat-images'
import type { MindMapConversationHistoryTurn } from '../../shared/teaching-types/mindmap'
import type { ToolDefinition } from '../ai/provider-adapter'
import { mindMapDocumentSchema } from '../../shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'
import {
  parseMindMapProposalJson,
  salvageFirstParseableJsonRoot,
  unwrapModelArgumentsEnvelope,
  type MindMapProposalScope,
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
import {
  mindMapAgentMessages,
  runMindMapAgentGeneration,
  type MindMapAgentRunFailed
} from './mind-map-agent'

export { cancelMindMapGeneration } from './mind-map-agent'

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
  /** Prior mind-map conversation turns so a follow-up keeps context. */
  history?: MindMapConversationHistoryTurn[]
  /** User-selected images sent with the generation turn (same payload as agent chat). */
  imageAttachments?: AgentChatImageAttachment[]
  /**
   * Stable correlation id used by `cancelMindMapGeneration` to abort the
   * in-flight agent loop. Optional so existing callers (and tests that
   * only exercise pure parsing) keep working.
   */
  generationId?: string
  /** Host-owned cancellation signal; aborting it cancels the provider request. */
  signal?: AbortSignal
  /** Host-owned resource governance snapshot; terminal boundaries become resource_limit/suspended. */
  resourceGovernance?: AgentRunResourceGovernance
  /** Workspace root for the loop's read-only workspace tools. */
  workspaceRoot?: string
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
  /** Workspace root for the loop's read-only workspace tools. */
  workspaceRoot?: string
  /** Main-process bounded context from one explicitly selected workspace file. */
  selectedFileContext?: MindMapSelectedFileContext
  /** Main-process context from Markdown files inferred from this user prompt. */
  autoSourceContext?: MindMapAutoSourceContext
  /** Main-process bounded context from one canonical generated Lesson artifact. */
  lessonContext?: MindMapLessonContext
  /** Main-process bounded context from the canonical workspace `NOTES.md`. */
  notesContext?: MindMapNotesContext
}

/** Extra learner-facing agent activity forwarded by the IPC gateway. */
export type MindMapAgentEvents = {
  /** Model tool calls, published as real transcript tool rows. */
  onToolCall?: (toolCall: { id: string; name: string; arguments: string }) => void
  onToolResult?: (toolCall: { id: string; name: string; arguments: string }, result: string, isError: boolean) => void
  /** Final no-tool answer deltas (the learner-facing reply). */
  onAnswer?: (delta: string) => void
}

/** Optional presentation-only response attached to a provider result. */
export type MindMapGeneratedProposal = MindMapProviderProposal & {
  /** Never send this field through the canonical apply IPC payload. */
  assistantMessage?: string
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
  // Unwrap a provider double-encoding of the full document envelope.
  parsed = unwrapModelArgumentsEnvelope(parsed).value

  const result = mindMapDocumentSchema.safeParse(parsed)
  if (!result.success) {
    throw new MindMapGenerationError(
      'invalid_output',
      `模型输出未通过思维导图结构校验：${formatZodError(result.error)}`
    )
  }
  return result.data
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

// ---- Submit tools (the terminal business tool of each loop) ----

/**
 * Terminal business tool for the reviewable-diff loop. The arguments object is
 * the proposal envelope itself and is validated with the same pure parser as
 * the legacy single-shot path.
 */
export function mindMapProposalSubmitTool(expectedScope: MindMapProposalScope): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'submit_mind_map_proposal',
      description: `提交对当前思维导图的最终修改提案。参数就是完整的提案信封：schemaVersion=1、scope="${expectedScope}"、proposalId 与全部 items（每项含稳定 id 与 command）。先完成全部检查，再一次性提交；提交后不要重复调用。`,
      parameters: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'integer', const: 1 },
          proposalId: { type: 'string' },
          scope: { type: 'string', const: expectedScope },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                command: { type: 'object' }
              },
              required: ['id', 'command']
            }
          },
          assistantMessage: { type: 'string', description: '可选：面向学习者的简短说明。' }
        },
        required: ['schemaVersion', 'proposalId', 'scope', 'items']
      }
    }
  }
}

/** Terminal business tool for the full-document generation loop. */
export function mindMapDocumentSubmitTool(): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'submit_mind_map_document',
      description: '提交最终生成的完整思维导图文档。参数就是完整的文档信封（schemaVersion=2，含 title 与全部 sheets）。先完成全部检查，再一次性提交；提交后不要重复调用。',
      parameters: {
        type: 'object',
        properties: {
          schemaVersion: { type: 'integer', const: 2 },
          title: { type: 'string' },
          theme: { type: 'object' },
          sheets: {
            type: 'array',
            items: { type: 'object' }
          }
        },
        required: ['schemaVersion', 'title', 'sheets']
      }
    }
  }
}

/** Map a failed agent run onto the structured generation error contract. */
function mindMapAgentFailure(failure: MindMapAgentRunFailed): MindMapGenerationError {
  switch (failure.stopReason) {
    case 'canceled':
      return new MindMapGenerationError('cancelled', 'AI 生成已取消。')
    case 'resource_limit':
      return new MindMapGenerationError('resource_limit', failure.error ?? '已达到资源边界。')
    case 'suspended':
      return new MindMapGenerationError('suspended', failure.error ?? '运行已由紧急保护暂停。')
    case 'no_progress':
    case 'context_unrecoverable':
    case 'retry_exhausted':
      return new MindMapGenerationError('provider', failure.error ?? 'AI 生成未能完成。')
    default:
      return new MindMapGenerationError(
        'invalid_output',
        failure.error ?? '模型未提交思维导图结果。'
      )
  }
}

// ---- Generation ----

/**
 * Generate a mind map from the topic/prompt using a bounded agent loop: the
 * model streams reasoning, may read workspace context with the read-only
 * tools, and submits the complete document envelope via the submit tool.
 *
 * When `input.generationId` is supplied the run is registered so
 * `cancelMindMapGeneration(generationId)` can abort the loop.
 */
export async function generateMindMap(
  input: MindMapGenerationInput,
  onStream?: (text: string) => void,
  onReasoning?: (text: string) => void,
  agentEvents?: MindMapAgentEvents
): Promise<MindMapDocument> {
  const prompts = {
    systemPrompt: buildMindMapSystemPrompt({
      title: input.title,
      prompt: input.prompt,
      history: input.history,
      selectedFileContext: input.selectedFileContext,
      autoSourceContext: input.autoSourceContext,
      lessonContext: input.lessonContext
    }),
    userPrompt: buildMindMapUserPrompt({
      title: input.title,
      prompt: input.prompt,
      history: input.history,
      selectedFileContext: input.selectedFileContext,
      autoSourceContext: input.autoSourceContext,
      lessonContext: input.lessonContext
    })
  }

  const agent = await runMindMapAgentGeneration({
    settings: input.settings,
    workspaceRoot: input.workspaceRoot,
    generationId: input.generationId,
    signal: input.signal,
    resourceGovernance: input.resourceGovernance,
    messages: mindMapAgentMessages(prompts.systemPrompt, prompts.userPrompt, input.imageAttachments),
    submitTool: mindMapDocumentSubmitTool(),
    durableSuccessText: '思维导图已生成并通过校验。',
    validateSubmitArguments: (argsText) => ({ document: parseMindMapOutput(argsText) }),
    onSubmitValidated: (captured) => {
      onStream?.(JSON.stringify(captured.document))
    },
    eventHandlers: { onReasoning, ...agentEvents }
  })
  if (!agent.ok) throw mindMapAgentFailure(agent)
  return agent.captured.document
}

/**
 * Generate a strict, reviewable provider proposal against one canonical v2
 * snapshot. The agent loop never applies commands or persists the document —
 * the caller owns the review/apply lane.
 */
export async function generateMindMapProposal(
  input: MindMapProposalGenerationInput,
  onStream?: (text: string) => void,
  onReasoning?: (text: string) => void,
  agentEvents?: MindMapAgentEvents
): Promise<MindMapGeneratedProposal> {
  // The renderer deliberately does not get to declare a request as an
  // "initial map": derive it from the canonical v2 snapshot that the main
  // process just loaded. A blank sheet needs a complete hierarchy, whereas an
  // established map must retain the conservative proposal behavior.
  const initialMap = isInitialMindMapProposal(input)
  const prompts = {
    systemPrompt: buildMindMapProposalSystemPrompt({
      title: input.title,
      prompt: input.prompt,
      request: input.request,
      history: input.history,
      initialMap
    }),
    userPrompt: buildMindMapProposalUserPrompt({
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
  }

  const agent = await runMindMapAgentGeneration({
    settings: input.settings,
    workspaceRoot: input.workspaceRoot,
    generationId: input.generationId,
    signal: input.signal,
    resourceGovernance: input.resourceGovernance,
    messages: mindMapAgentMessages(prompts.systemPrompt, prompts.userPrompt, input.imageAttachments),
    submitTool: mindMapProposalSubmitTool(input.request.scope),
    durableSuccessText: '思维导图提案已提交并通过校验。',
    validateSubmitArguments: (argsText) => {
      const parsed = parseMindMapProposalJson(argsText)
      if (!parsed.ok) throw new Error(parsed.message)
      if (parsed.proposal.scope !== input.request.scope) {
        throw new Error(`mind-map proposal scope mismatch: expected ${input.request.scope}`)
      }
      return {
        proposal: {
          ...parsed.proposal,
          items: reconcileMindMapProposalTopicIds(input.document, parsed.proposal.items)
        },
        assistantMessage: parsed.assistantMessage
      }
    },
    onSubmitValidated: (captured) => {
      // Feed the validated envelope to the canvas preview reveal; the renderer
      // admits complete items from this shape and animates them one by one.
      onStream?.(JSON.stringify({ items: captured.proposal.items }))
    },
    eventHandlers: { onReasoning, ...agentEvents }
  })
  if (!agent.ok) throw mindMapAgentFailure(agent)

  const reply = agent.finalText.trim() || agent.captured.assistantMessage?.trim()
  return {
    ...agent.captured.proposal,
    ...(reply ? { assistantMessage: reply } : {})
  }
}

export type { MindMapProposalScope }
