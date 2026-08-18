import { createHash } from 'node:crypto'

import { sanitizeAgentPresentationTimeline, sanitizeAgentTurnContent } from './agent-conversation-turns'
import { redactAgentSecretText } from './agent-secret-redaction'
import { normalizeTraceId } from './trace-context'
import type {
  AgentChatPresentationTimelineEntry,
  AgentChatTurn,
  AgentConversationRecord,
  AgentTurnMetadata
} from './teaching-types'

/**
 * Canonical replacement for a user turn whose content must not become durable.
 *
 * Keeping the turn (rather than dropping it) preserves turn order, turn ids,
 * message counts, and audit/analytics cardinality without retaining searchable
 * credential material.
 */
export const OMITTED_SENSITIVE_USER_INPUT = '[sensitive user input omitted]'
export const SAFE_PERSISTED_CONVERSATION_TITLE = 'Conversation'

export type PersistedUserHistorySanitization =
  | {
      kind: 'redacted'
      text: string
      redacted: boolean
    }
  | {
      kind: 'omitted'
      text: typeof OMITTED_SENSITIVE_USER_INPUT
      reason: 'secret_only' | 'uncertain_high_risk' | 'sanitizer_failed'
    }

export type PersistedUserHistorySanitizer = (value: string) => PersistedUserHistorySanitization

export type PersistedParentTurnProof = {
  schemaVersion: 1
  algorithm: 'sha256'
  digest: string
}

type SecretRedactor = (value: string) => string

const REDACTION_MARKER_RE = /\[redacted(?: private key)?\]/gi
const CREDENTIAL_LABEL_RE = /\b(?:authorization|bearer|basic|x-api-key|(?:[a-z0-9]+[_-])?api[_\s-]?key|apikey|password|passphrase|client[_\s-]?secret|refresh[_\s-]?token|session[_\s-]?token|access[_\s-]?token|private[_\s-]?token|personal[_\s-]?access[_\s-]?token|token|credential)\b\s*[:=]?/gi
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/
const UNKNOWN_HIGH_RISK_TOKEN_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]{31,}|[A-Fa-f0-9]{32,})$/

/**
 * Builds the single persisted-user-history boundary. Production code uses the
 * exported `sanitizePersistedUserHistory`; the factory keeps failure behaviour
 * directly testable without an `alreadyRedacted` or caller-controlled bypass.
 */
export function createPersistedUserHistorySanitizer(redactor: SecretRedactor): PersistedUserHistorySanitizer {
  return (value) => {
    try {
      if (looksUncertainAndHighRisk(value)) return omitted('uncertain_high_risk')
      const text = redactor(value)
      if (typeof text !== 'string') return omitted('sanitizer_failed')
      if (isSecretOnlyRedactedText(text)) return omitted('secret_only')
      return { kind: 'redacted', text, redacted: text !== value }
    } catch {
      // Never include the input or an error message here: both can contain the
      // credential we are deliberately refusing to persist.
      return omitted('sanitizer_failed')
    }
  }
}

/** Sanitizes raw user input immediately before it crosses into durable history. */
export const sanitizePersistedUserHistory = createPersistedUserHistorySanitizer(redactAgentSecretText)

/** Safely handles titles, including legacy/raw title values projected into new sinks. */
export function sanitizePersistedConversationTitle(title: string): string {
  const result = sanitizePersistedUserHistory(title)
  if (result.kind === 'omitted') return SAFE_PERSISTED_CONVERSATION_TITLE
  return result.text.trim() || SAFE_PERSISTED_CONVERSATION_TITLE
}

/**
 * Produces the durable conversation projection while leaving the caller's raw
 * turns untouched for transient provider confirmation. Every saved run marker
 * is rebound to a proof of this sanitized sequence; raw parent digests are
 * intentionally removed before any durable writer sees the record.
 */
export function sanitizePersistedAgentConversationRecord(record: AgentConversationRecord): AgentConversationRecord {
  const sanitizedTurns = record.turns.map(sanitizePersistedConversationTurn)
  const turns = bindPersistedParentTurnProofs(sanitizedTurns)
  const title = sanitizePersistedConversationTitle(record.title)
  const traceId = normalizeTraceId(record.traceId)
  const turnsChanged = turns.some((turn, index) => turn !== record.turns[index])
  return turnsChanged || title !== record.title || traceId !== record.traceId
    ? { ...record, title, traceId, turns }
    : record
}

/**
 * Computes a non-secret proof for the prefix ending in its latest assistant
 * turn. The canonical input is already redacted/omitted and includes order,
 * identity, timestamps, and the metadata that binds the run to that turn.
 */
export function persistedAgentParentTurnProof(turns: readonly AgentChatTurn[]): PersistedParentTurnProof {
  const assistantIndex = turns.findLastIndex((turn) => turn.role === 'assistant')
  if (assistantIndex < 0) throw new Error('A persisted parent turn proof requires an assistant turn.')
  const assistant = turns[assistantIndex]
  if (!assistant?.metadata?.runId) throw new Error('A persisted parent turn proof requires a run id.')
  const sanitized = turns.slice(0, assistantIndex + 1).map(sanitizePersistedConversationTurn)
  return {
    schemaVersion: 1,
    algorithm: 'sha256',
    digest: sha256(stableCanonicalJson({
      schemaVersion: 1,
      turns: sanitized.map(parentTurnProofProjection)
    }))
  }
}

/** Checks an existing safe proof without permitting legacy raw-digest fallback. */
export function hasPersistedAgentParentTurnProof(
  turns: readonly AgentChatTurn[],
  runId: string,
  expectedDigest: string
): boolean {
  return turns.some((turn, index) => {
    const proof = turn.metadata?.parentTurnProof
    if (turn.role !== 'assistant' || turn.metadata?.runId !== runId ||
      proof?.schemaVersion !== 1 || proof.algorithm !== 'sha256' || proof.digest !== expectedDigest) return false
    try {
      return persistedAgentParentTurnProof(turns.slice(0, index + 1)).digest === expectedDigest
    } catch {
      return false
    }
  })
}

export function isOmittedSensitiveUserInput(value: string): boolean {
  return value === OMITTED_SENSITIVE_USER_INPUT
}

function sanitizePersistedConversationTurn(turn: AgentChatTurn): AgentChatTurn {
  const content = turn.role === 'user'
    ? sanitizePersistedUserHistory(turn.content).text
    : redactAgentSecretText(turn.content)
  const toolCalls = turn.toolCalls?.map((tool) => {
    const argumentsText = redactAgentSecretText(tool.arguments)
    const result = tool.result === undefined ? undefined : redactAgentSecretText(tool.result)
    return argumentsText === tool.arguments && result === tool.result ? tool : {
      ...tool,
      arguments: argumentsText,
      ...(result === undefined ? {} : { result })
    }
  })
  const processEvents = turn.processEvents?.map((event) => {
    const title = redactAgentSecretText(event.title)
    const detail = event.detail === undefined ? undefined : redactAgentSecretText(event.detail)
    return title === event.title && detail === event.detail ? event : {
      ...event,
      title,
      ...(detail === undefined ? {} : { detail })
    }
  })
  const presentationTimeline = sanitizePersistedPresentationTimeline(
    turn.presentationTimeline,
    new Set((processEvents ?? []).map((event) => event.id))
  )
  const metadata = sanitizePersistedTurnMetadata(stripRawParentTurnDigest(turn.metadata))
  const toolCallsChanged = Boolean(toolCalls?.some((tool, index) => tool !== turn.toolCalls?.[index]))
  const processEventsChanged = Boolean(processEvents?.some((event, index) => event !== turn.processEvents?.[index]))
  const presentationTimelineChanged = !presentationTimelinesEqual(presentationTimeline, turn.presentationTimeline)
  if (
    content === turn.content &&
    !toolCallsChanged &&
    !processEventsChanged &&
    !presentationTimelineChanged &&
    metadata === turn.metadata
  ) return turn
  const { presentationTimeline: _unsafePresentationTimeline, ...turnWithoutPresentationTimeline } = turn
  return {
    ...turnWithoutPresentationTimeline,
    content,
    ...(toolCalls === undefined ? {} : { toolCalls }),
    ...(processEvents === undefined ? {} : { processEvents }),
    ...(presentationTimeline === undefined ? {} : { presentationTimeline }),
    ...(metadata === undefined ? {} : { metadata })
  }
}

/**
 * The presentation timeline is a safe rendering order projection, not a
 * second transcript. Rebuild each entry so a malformed in-memory object cannot
 * carry raw diagnostic fields through persistence, and retain process rows
 * only when they point at a sanitized event from this turn.
 */
function sanitizePersistedPresentationTimeline(
  timeline: readonly AgentChatPresentationTimelineEntry[] | undefined,
  processEventIds: ReadonlySet<string>
): AgentChatPresentationTimelineEntry[] | undefined {
  if (!timeline?.length) return undefined
  const entries: AgentChatPresentationTimelineEntry[] = []
  for (const raw of timeline) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry = raw as unknown as Record<string, unknown>
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id : null
    const sequence = typeof entry.sequence === 'number' && Number.isSafeInteger(entry.sequence)
      ? entry.sequence
      : null
    const createdAt = typeof entry.createdAt === 'string' && entry.createdAt.trim()
      ? entry.createdAt
      : null
    if (!id || sequence === null || !createdAt) continue
    if (entry.kind === 'assistant_text') {
      if (typeof entry.content !== 'string') continue
      const content = sanitizeAgentTurnContent(redactAgentSecretText(entry.content))
      if (!content) continue
      entries.push({ id, sequence, kind: 'assistant_text', content, createdAt })
      continue
    }
    if (entry.kind === 'process') {
      const processEventId = typeof entry.processEventId === 'string' && entry.processEventId.trim()
        ? entry.processEventId
        : null
      if (!processEventId || !processEventIds.has(processEventId)) continue
      entries.push({ id, sequence, kind: 'process', processEventId, createdAt })
    }
  }
  return sanitizeAgentPresentationTimeline(entries)
}

function presentationTimelinesEqual(
  left: readonly AgentChatPresentationTimelineEntry[] | undefined,
  right: readonly AgentChatPresentationTimelineEntry[] | undefined
): boolean {
  if (left === right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((entry, index) => {
    const candidate = right[index]
    if (
      !candidate ||
      entry.id !== candidate.id ||
      entry.sequence !== candidate.sequence ||
      entry.kind !== candidate.kind ||
      entry.createdAt !== candidate.createdAt
    ) return false
    return entry.kind === 'assistant_text'
      ? candidate.kind === 'assistant_text' && entry.content === candidate.content
      : candidate.kind === 'process' && entry.processEventId === candidate.processEventId
  })
}

/**
 * Redacts every free-text field that can be promoted with a conversation turn.
 * Archive/audit writers invoke the same boundary too, but doing it here makes
 * the canonical record and recovery proof safe before any individual sink has
 * a chance to serialize a nested tool, event, child transcript, or diagnostic.
 */
function sanitizePersistedTurnMetadata(metadata: AgentTurnMetadata | undefined): AgentTurnMetadata | undefined {
  if (!metadata) return metadata
  const sources = metadata.sources?.map((source) => {
    const url = redactAgentSecretText(source.url)
    const title = source.title === undefined ? undefined : redactAgentSecretText(source.title)
    const snippet = source.snippet === undefined ? undefined : redactAgentSecretText(source.snippet)
    return url === source.url && title === source.title && snippet === source.snippet ? source : {
      ...source,
      url,
      ...(title === undefined ? {} : { title }),
      ...(snippet === undefined ? {} : { snippet })
    }
  })
  const childRuns = metadata.childRuns?.map((child) => {
    // Archived child-run types intentionally expose only their durable shape,
    // but callers can still be carrying transient transcript fields at this
    // boundary. Redact those fields before object spread preserves them.
    const richChild = child as typeof child & { transcript?: string; transcriptText?: string }
    const label = redactAgentSecretText(child.label)
    const summary = child.summary === undefined ? undefined : redactAgentSecretText(child.summary)
    const error = child.error === undefined ? undefined : redactAgentSecretText(child.error)
    const transcript = richChild.transcript === undefined ? undefined : redactAgentSecretText(richChild.transcript)
    const transcriptText = richChild.transcriptText === undefined ? undefined : redactAgentSecretText(richChild.transcriptText)
    const filesRead = child.filesRead?.map(redactAgentSecretText)
    const citations = child.citations?.map((citation) => {
      const url = redactAgentSecretText(citation.url)
      const title = citation.title === undefined ? undefined : redactAgentSecretText(citation.title)
      return url === citation.url && title === citation.title ? citation : {
        ...citation,
        url,
        ...(title === undefined ? {} : { title })
      }
    })
    const archive = sanitizePersistedArtifactPreview(child.archive)
    const changed = label !== child.label || summary !== child.summary || error !== child.error ||
      transcript !== richChild.transcript || transcriptText !== richChild.transcriptText || archive !== child.archive ||
      Boolean(filesRead?.some((path, index) => path !== child.filesRead?.[index])) ||
      Boolean(citations?.some((citation, index) => citation !== child.citations?.[index]))
    return changed ? {
      ...child,
      label,
      ...(summary === undefined ? {} : { summary }),
      ...(error === undefined ? {} : { error }),
      ...(transcript === undefined ? {} : { transcript }),
      ...(transcriptText === undefined ? {} : { transcriptText }),
      ...(filesRead === undefined ? {} : { filesRead }),
      ...(citations === undefined ? {} : { citations }),
      ...(archive === undefined ? {} : { archive })
    } : child
  })
  const compactions = metadata.compactions?.map((compaction) => {
    const reason = redactAgentSecretText(compaction.reason)
    const error = compaction.error === undefined ? undefined : redactAgentSecretText(compaction.error)
    return reason === compaction.reason && error === compaction.error ? compaction : {
      ...compaction,
      reason,
      ...(error === undefined ? {} : { error })
    }
  })
  const toolResults = metadata.toolResults?.map((diagnostic) => {
    const archive = sanitizePersistedArtifactPreview(diagnostic.archive)
    return archive === diagnostic.archive ? diagnostic : { ...diagnostic, ...(archive === undefined ? {} : { archive }) }
  })
  const fileTouches = sanitizePersistedFileTouches(metadata.fileTouches)
  const changed = Boolean(
    sources?.some((source, index) => source !== metadata.sources?.[index]) ||
    childRuns?.some((child, index) => child !== metadata.childRuns?.[index]) ||
    compactions?.some((compaction, index) => compaction !== metadata.compactions?.[index]) ||
    toolResults?.some((diagnostic, index) => diagnostic !== metadata.toolResults?.[index]) ||
    fileTouches !== metadata.fileTouches
  )
  return changed ? {
    ...metadata,
    ...(sources === undefined ? {} : { sources }),
    ...(childRuns === undefined ? {} : { childRuns }),
    ...(compactions === undefined ? {} : { compactions }),
    ...(toolResults === undefined ? {} : { toolResults }),
    ...(fileTouches === undefined ? {} : { fileTouches })
  } : metadata
}

function sanitizePersistedFileTouches(
  fileTouches: AgentTurnMetadata['fileTouches']
): AgentTurnMetadata['fileTouches'] {
  if (!fileTouches || fileTouches.role !== 'reference_projection') return fileTouches
  const files = fileTouches.files.map((file) => {
    const path = redactAgentSecretText(file.path)
    return path === file.path ? file : { ...file, path }
  })
  const changed = files.some((file, index) => file !== fileTouches.files[index])
  return changed ? { role: 'reference_projection', files } : fileTouches
}

function sanitizePersistedArtifactPreview<T extends { preview?: string }>(artifact: T | undefined): T | undefined {
  if (!artifact?.preview) return artifact
  const preview = redactAgentSecretText(artifact.preview)
  return preview === artifact.preview ? artifact : { ...artifact, preview }
}

function bindPersistedParentTurnProofs(turns: readonly AgentChatTurn[]): AgentChatTurn[] {
  return turns.map((turn, index) => {
    if (turn.role !== 'assistant' || !turn.metadata?.runId) return turn
    const metadataWithoutProof = stripRawParentTurnDigest(turn.metadata)
    const candidate = metadataWithoutProof?.parentTurnProof === undefined
      ? turn
      : { ...turn, metadata: { ...metadataWithoutProof, parentTurnProof: undefined } }
    const prefix = [...turns.slice(0, index), candidate]
    const proof = persistedAgentParentTurnProof(prefix)
    const current = metadataWithoutProof?.parentTurnProof
    if (current?.schemaVersion === proof.schemaVersion && current.algorithm === proof.algorithm && current.digest === proof.digest && metadataWithoutProof === turn.metadata) {
      return turn
    }
    return { ...turn, metadata: { ...(metadataWithoutProof ?? { version: 1 as const }), parentTurnProof: proof } }
  })
}

function parentTurnProofProjection(turn: AgentChatTurn): unknown {
  const metadata = turn.metadata
  // parentTurnProof is the value being checked and must not recursively bind
  // itself. The raw parent digest is never durable and is excluded even for a
  // malformed in-memory caller. Every other sanitized turn field participates,
  // including tool/event/child/diagnostic metadata, so post-save tampering
  // cannot be accepted as the original parent sequence.
  const metadataForProof = metadata
    ? (() => {
        const { parentTurnDigest: _rawDigest, parentTurnProof: _proof, ...rest } = metadata
        return rest
      })()
    : undefined
  return {
    id: turn.id,
    role: turn.role,
    content: turn.content,
    createdAt: turn.createdAt,
    // Readers normalize absent boolean flags to false. Canonicalize them back to
    // their stored representation so an unhydrated JSON read verifies exactly
    // the bytes/shape that archive serialization wrote.
    toolCalls: turn.toolCalls?.map((tool) => ({
      id: tool.id,
      name: tool.name,
      arguments: tool.arguments,
      ...(tool.result === undefined ? {} : { result: tool.result }),
      ...(tool.isError === true ? { isError: true } : {})
    })),
    processEvents: turn.processEvents?.map((event) => ({
      id: event.id,
      kind: event.kind,
      title: event.title,
      ...(event.detail === undefined ? {} : { detail: event.detail }),
      ...(event.status === undefined ? {} : { status: event.status }),
      ...(event.toolCallId === undefined ? {} : { toolCallId: event.toolCallId }),
      ...(event.toolName === undefined ? {} : { toolName: event.toolName }),
      ...(event.isError === true ? { isError: true } : {}),
      createdAt: event.createdAt
    })),
    ...(turn.presentationTimeline === undefined ? {} : {
      presentationTimeline: turn.presentationTimeline.map((entry) => entry.kind === 'assistant_text'
        ? {
            id: entry.id,
            sequence: entry.sequence,
            kind: 'assistant_text' as const,
            content: entry.content,
            createdAt: entry.createdAt
          }
        : {
            id: entry.id,
            sequence: entry.sequence,
            kind: 'process' as const,
            processEventId: entry.processEventId,
            createdAt: entry.createdAt
          })
    }),
    metadata: metadataForProof
  }
}

function stripRawParentTurnDigest(metadata: AgentTurnMetadata | undefined): AgentTurnMetadata | undefined {
  if (!metadata || metadata.parentTurnDigest === undefined) return metadata
  const { parentTurnDigest: _rawDigest, ...safeMetadata } = metadata
  return safeMetadata
}

function omitted(reason: Extract<PersistedUserHistorySanitization, { kind: 'omitted' }>['reason']): PersistedUserHistorySanitization {
  return { kind: 'omitted', text: OMITTED_SENSITIVE_USER_INPUT, reason }
}

function looksUncertainAndHighRisk(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (JWT_RE.test(trimmed)) return true
  // A standalone high-entropy token with no explanatory context is ambiguous,
  // so the durable boundary omits it rather than guessing whether it is safe.
  return UNKNOWN_HIGH_RISK_TOKEN_RE.test(trimmed) && redactAgentSecretText(trimmed) === trimmed
}

function isSecretOnlyRedactedText(value: string): boolean {
  const withoutLabels = value
    .replace(CREDENTIAL_LABEL_RE, '')
    .replace(REDACTION_MARKER_RE, '')
    .replace(/[\s:=;,'"`{}()[\]<>-]/g, '')
  return withoutLabels.length === 0
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set<object>()))
}

function canonicalize(value: unknown, stack: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return undefined
  if (stack.has(value as object)) throw new TypeError('Cyclic values cannot be encoded as canonical JSON.')
  stack.add(value as object)
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, stack) ?? null)
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = canonicalize((value as Record<string, unknown>)[key], stack)
      if (item !== undefined) out[key] = item
    }
    return out
  } finally {
    stack.delete(value as object)
  }
}
