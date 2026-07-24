import type {
  AgentChatContextCompactionRequest,
  AgentChatMessage,
  AgentChatStreamPayload,
  ApplyLessonStylePayload,
  AskAnswer,
  CreateWorkspacePayload,
  CreateTeachingMemoryPayload,
  GenerateLessonPayload,
  GitBranchPayload,
  ModelEndpointFormat,
  NotificationPayload,
  ProbeProviderPayload,
  ReadWorkspaceChangeDiffPayload,
  ReadLessonPayload,
  ReadWorkspaceMarkdownPayload,
  RemoveTeachingGitWorktreePayload,
  WorkspaceItemKind,
  WorkspaceItemMetaPayload,
  WorkspaceItemRemovePayload,
  WorkspaceRemovePayload,
  RecordProgressPayload,
  SaveWorkspaceMarkdownPayload,
  SetWorkspaceTrustPayload,
  TeachingSettingsPatch,
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload,
  WindowControlAction
} from '../shared/teaching-types'
import type { RunTeachingDoctorPayload } from '../shared/teaching-types/teaching-doctor'
import type { ProjectAgentSessionQueuePayload } from '../shared/teaching-types/agent-session-queue'
import type { CommitLearningOutcomeRequest } from '../shared/teaching-types/system-api'
import { normalizePreviewLessonInteractionIntent, type PreviewLessonInteractionIntent } from '../shared/teaching-types/lesson-interaction'
import { isLessonStyleId } from '../shared/lesson-styles'
import { isLearningSessionId } from '../shared/teaching-placement'
import { normalizeProviderCustomHeaders } from '../shared/provider-custom-headers'

const SAFE_CONVERSATION_ID = /^[a-z0-9][a-z0-9-]{0,99}$/
const SAFE_OUTCOME_COMMIT_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/

/**
 * Narrow, versioned command envelope. This parser is intentionally exact: the
 * renderer never sends file paths, evidence, outcome, evaluator, or provider
 * data when requesting an outcome commit.
 */
export function parseCommitLearningOutcomeRequest(payload: unknown): CommitLearningOutcomeRequest | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const record = payload as Record<string, unknown>
  const allowedKeys = ['schemaVersion', 'type', 'workspaceId', 'sessionId', 'operationId']
  if (Object.keys(record).length !== allowedKeys.length || Object.keys(record).some((key) => !allowedKeys.includes(key))) {
    return null
  }
  return isSafeCommitLearningOutcomeRequest(payload) ? payload : null
}

function isSafeCommitLearningOutcomeRequest(value: unknown): value is CommitLearningOutcomeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === 1 &&
    record.type === 'commit' &&
    isSafeOutcomeCommitId(record.workspaceId) &&
    typeof record.sessionId === 'string' &&
    isLearningSessionId(record.sessionId) &&
    isSafeOutcomeCommitId(record.operationId)
}

function isSafeOutcomeCommitId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_OUTCOME_COMMIT_ID.test(value)
}

export function parseCreateWorkspacePayload(payload: unknown): CreateWorkspacePayload {
  const record = requireRecord(payload)
  return {
    name: requireString(record.name, 'name'),
    prompt: requireString(record.prompt, 'prompt')
  }
}

export function parseUpdateMissionPayload(payload: unknown): UpdateMissionPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('IPC payload must be an object.')
  }
  const record = payload as Record<string, unknown>
  const allowedKeys = ['workspaceId', 'prompt', 'actionId']
  const keys = Object.keys(record)
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) {
    throw new Error('IPC updateMission payload must contain only "workspaceId", "prompt", and "actionId".')
  }
  const actionId = requireString(record.actionId, 'actionId').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(actionId)) {
    throw new Error('IPC payload field "actionId" must be a UUID.')
  }
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    prompt: requireString(record.prompt, 'prompt'),
    actionId
  }
}

/**
 * Exact, path-free workspace trust command. The renderer may identify a
 * registered workspace and choose the binary grant, but cannot supply a root
 * path or any broader capability data.
 */
export function parseSetWorkspaceTrustPayload(payload: unknown): SetWorkspaceTrustPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('IPC payload must be an object.')
  }
  const record = payload as Record<string, unknown>
  const allowedKeys = ['workspaceId', 'trust']
  const keys = Object.keys(record)
  if (keys.length !== allowedKeys.length || keys.some((key) => !allowedKeys.includes(key))) {
    throw new Error('IPC workspace trust payload must contain only "workspaceId" and "trust".')
  }
  const trust = record.trust
  if (trust !== 'trusted' && trust !== 'untrusted') {
    throw new Error('IPC payload field "trust" must be one of: trusted, untrusted.')
  }
  return { workspaceId: requireString(record.workspaceId, 'workspaceId'), trust }
}

export function parseApplyLessonStylePayload(payload: unknown): ApplyLessonStylePayload {
  const record = requireRecord(payload)
  const styleId = requireString(record.styleId, 'styleId')
  if (!isLessonStyleId(styleId)) {
    throw new Error('IPC payload field "styleId" must be a known lesson style id.')
  }
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    styleId
  }
}

const RFC4122_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseGenerateLessonPayload(payload: unknown): GenerateLessonPayload {
  const record = requireRecord(payload)
  // Reject renderer-supplied internal recovery fields; main owns receipts/trace/transaction IDs.
  for (const forbidden of ['traceId', 'receiptPath', 'publicationTransactionId', 'lifecycleEventId', 'requestTag']) {
    if (forbidden in record) {
      throw new Error('IPC generate-lesson payload must not include "' + forbidden + '".')
    }
  }
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    actionId: requireActionId(record.actionId),
    prompt: requireString(record.prompt, 'prompt'),
    courseName: optionalString(record.courseName),
    messages: parseAgentChatMessages(record.messages)
  }
}

export function parseDirectLessonActionStatusPayload(payload: unknown): { workspaceId: string; actionId: string } {
  const record = requireRecord(payload)
  for (const key of Object.keys(record)) {
    if (key !== 'workspaceId' && key !== 'actionId') {
      throw new Error('IPC direct-lesson action-status payload must contain only "workspaceId" and "actionId".')
    }
  }
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    actionId: requireActionId(record.actionId)
  }
}

function requireActionId(value: unknown): string {
  const actionId = requireString(value, 'actionId').trim()
  if (!RFC4122_UUID_V4.test(actionId)) {
    throw new Error('IPC payload field "actionId" must be an RFC 4122 UUID v4.')
  }
  return actionId.toLowerCase()
}

export function parseAgentChatMessages(value: unknown): AgentChatMessage[] {
  const rawMessages = Array.isArray(value) ? value : []
  const messages: AgentChatMessage[] = []
  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    const role = m.role
    if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') continue
    messages.push({
      role,
      content: typeof m.content === 'string' ? m.content : m.content === null ? null : '',
      toolCallId: typeof m.toolCallId === 'string' ? m.toolCallId : undefined,
      toolCalls: Array.isArray(m.toolCalls)
        ? m.toolCalls.map((tc) => {
            const t = (tc ?? {}) as Record<string, unknown>
            return {
              id: typeof t.id === 'string' ? t.id : '',
              name: typeof t.name === 'string' ? t.name : '',
              arguments: typeof t.arguments === 'string' ? t.arguments : ''
            }
          })
        : undefined
    })
  }
  return messages
}

export function parseAgentChatStreamPayload(payload: unknown): AgentChatStreamPayload {
  const record = requireRecord(payload)
  const skillIds = Array.isArray(record.skillIds)
    ? [...new Set(record.skillIds.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, 8)
    : undefined
  const messageTurnIds = Array.isArray(record.messageTurnIds) && record.messageTurnIds.length <= 400
    ? Array.from(record.messageTurnIds, (item) => {
        const turnId = typeof item === 'string' ? item.trim() : ''
        return turnId || undefined
      })
    : undefined
  const messages = parseAgentChatMessages(record.messages)
  const expectedBranchRevision = optionalNonNegativeInteger(record.expectedBranchRevision, 'expectedBranchRevision')
  const alignedMessageTurnIds = messageTurnIds?.length === messages.length
    ? messageTurnIds as AgentChatStreamPayload['messageTurnIds']
    : undefined
  return {
    streamId: optionalStreamId(record.streamId),
    conversationId: optionalStreamId(record.conversationId),
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
    ...(expectedBranchRevision !== undefined ? { expectedBranchRevision } : {}),
    mode: record.mode === 'teaching' ? 'teaching' : record.mode === 'temporary' ? 'temporary' : undefined,
    context: optionalString(record.context),
    contextCompaction: parseAgentChatContextCompaction(record.contextCompaction),
    ...(skillIds?.length ? { skillIds } : {}),
    ...(alignedMessageTurnIds ? { messageTurnIds: alignedMessageTurnIds } : {}),
    messages,
    userInput: requireString(record.userInput, 'userInput')
  }
}

function parseAgentChatContextCompaction(value: unknown): AgentChatContextCompactionRequest | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const request: AgentChatContextCompactionRequest = {}
  if (typeof record.force === 'boolean') request.force = record.force
  if (typeof record.enabled === 'boolean') request.enabled = record.enabled
  const contextWindowTokens = optionalPositiveInteger(record.contextWindowTokens, 2_000, 2_000_000)
  const softThresholdTokens = optionalPositiveInteger(record.softThresholdTokens, 512, 2_000_000)
  const hardThresholdTokens = optionalPositiveInteger(record.hardThresholdTokens, 512, 2_000_000)
  if (contextWindowTokens !== undefined) request.contextWindowTokens = contextWindowTokens
  if (softThresholdTokens !== undefined) request.softThresholdTokens = softThresholdTokens
  if (hardThresholdTokens !== undefined) request.hardThresholdTokens = hardThresholdTokens
  return Object.keys(request).length > 0 ? request : undefined
}

export function parseReplayAgentChatEventsPayload(payload: unknown): { streamId: string; afterSequence: number } {
  const record = payload && typeof payload === 'object'
    ? payload as { streamId?: unknown; afterSequence?: unknown }
    : {}
  return {
    streamId: requireStreamId(record.streamId),
    afterSequence: typeof record.afterSequence === 'number' && Number.isFinite(record.afterSequence)
      ? Math.max(0, Math.floor(record.afterSequence))
      : 0
  }
}

const MAX_AGENT_CHAT_STEER_TEXT_CHARS = 32 * 1024

export type SteerAgentChatPayload = {
  streamId: string
  text: string
  conversationId?: string
  expectedRevision?: number
}

export type FollowUpAgentChatPayload = SteerAgentChatPayload

/**
 * Fail-closed parser for mid-run steer IPC (ADR-0082).
 * Exact keys only: streamId, text, optional conversationId / expectedRevision.
 */
export function parseSteerAgentChatPayload(payload: unknown): SteerAgentChatPayload {
  return parseSteerOrFollowUpAgentChatPayload(payload, 'steer')
}

/**
 * Fail-closed parser for mid-run follow-up IPC (ADR-0082).
 */
export function parseFollowUpAgentChatPayload(payload: unknown): FollowUpAgentChatPayload {
  return parseSteerOrFollowUpAgentChatPayload(payload, 'follow-up')
}

/**
 * Fail-closed parser for projectAgentSessionQueue IPC (ADR-0091).
 * Exact keys: streamId (required), includeTextPreview?, textPreviewMax?.
 * Read-only projection only — never drains or flips autoDrain.
 */
export function parseProjectAgentSessionQueuePayload(
  payload: unknown
): ProjectAgentSessionQueuePayload {
  const record = requireRecord(payload)
  const allowed = new Set(['streamId', 'includeTextPreview', 'textPreviewMax'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC projectAgentSessionQueue payload must contain only "streamId", optional "includeTextPreview", and optional "textPreviewMax".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'streamId')) {
    throw new Error('IPC projectAgentSessionQueue payload requires "streamId".')
  }
  const streamId = requireStreamId(record.streamId)

  const result: ProjectAgentSessionQueuePayload = { streamId }

  if (Object.prototype.hasOwnProperty.call(record, 'includeTextPreview')) {
    if (typeof record.includeTextPreview !== 'boolean') {
      throw new Error(
        'IPC payload field "includeTextPreview" must be a boolean when present.'
      )
    }
    result.includeTextPreview = record.includeTextPreview
  }

  if (Object.prototype.hasOwnProperty.call(record, 'textPreviewMax')) {
    if (
      typeof record.textPreviewMax !== 'number' ||
      !Number.isSafeInteger(record.textPreviewMax) ||
      record.textPreviewMax < 0
    ) {
      throw new Error(
        'IPC payload field "textPreviewMax" must be a safe integer >= 0 when present.'
      )
    }
    result.textPreviewMax = record.textPreviewMax
  }

  return result
}

/**
 * Fail-closed parser for product TeachingDoctor IPC (ADR-0084).
 * Allows undefined / empty / {} / { includeProcessCrashMarker?: boolean }.
 * Rejects unknown keys and non-boolean include flag.
 */
export function parseRunTeachingDoctorPayload(payload: unknown): RunTeachingDoctorPayload {
  if (payload === undefined || payload === null) {
    return {}
  }
  const record = requireRecord(payload)
  const allowed = new Set(['includeProcessCrashMarker'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        'IPC runTeachingDoctor payload must contain only optional "includeProcessCrashMarker".'
      )
    }
  }
  if (!Object.prototype.hasOwnProperty.call(record, 'includeProcessCrashMarker')) {
    return {}
  }
  if (typeof record.includeProcessCrashMarker !== 'boolean') {
    throw new Error('IPC payload field "includeProcessCrashMarker" must be a boolean when present.')
  }
  return { includeProcessCrashMarker: record.includeProcessCrashMarker }
}

function parseSteerOrFollowUpAgentChatPayload(
  payload: unknown,
  label: 'steer' | 'follow-up'
): SteerAgentChatPayload {
  const record = requireRecord(payload)
  const allowed = new Set(['streamId', 'text', 'conversationId', 'expectedRevision'])
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(
        `IPC agent-chat ${label} payload must contain only "streamId", "text", optional "conversationId", and optional "expectedRevision".`
      )
    }
  }
  const streamId = requireStreamId(record.streamId)
  const text = requireString(record.text, 'text')
  if (text.length > MAX_AGENT_CHAT_STEER_TEXT_CHARS) {
    throw new Error(
      `IPC payload field "text" must be at most ${MAX_AGENT_CHAT_STEER_TEXT_CHARS} characters.`
    )
  }
  const conversationId = optionalCanonicalConversationId(record.conversationId)
  const expectedRevision = optionalNonNegativeInteger(record.expectedRevision, 'expectedRevision')
  return {
    streamId,
    text,
    ...(conversationId !== undefined ? { conversationId } : {}),
    ...(expectedRevision !== undefined ? { expectedRevision } : {})
  }
}

export function decodeToolAnswerPayload(payload: unknown): {
  streamId: string
  toolCallId: string
  answers: AskAnswer[]
} {
  const record = requireRecord(payload)
  const streamId = requireStreamId(record.streamId)
  const toolCallId = requireString(record.toolCallId, 'toolCallId')
  const rawAnswers = Array.isArray(record.answers) ? record.answers : []
  const answers: AskAnswer[] = []
  for (const item of rawAnswers) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const questionId = typeof a.questionId === 'string' ? a.questionId : ''
    if (!questionId) continue
    const selected = Array.isArray(a.selected) ? a.selected.map((s) => String(s)) : []
    answers.push({ questionId, selected })
  }
  return { streamId, toolCallId, answers }
}

export function parseWorkspaceItemMetaPayload(payload: unknown): WorkspaceItemMetaPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    relativePath: requireString(record.relativePath, 'relativePath'),
    pinned: record.pinned === null ? null : typeof record.pinned === 'boolean' ? record.pinned : undefined,
    archived: record.archived === null ? null : typeof record.archived === 'boolean' ? record.archived : undefined
  }
}

export function parseWorkspaceItemRemovePayload(payload: unknown): WorkspaceItemRemovePayload {
  const record = requireRecord(payload)
  const kind = requireString(record.kind, 'kind') as WorkspaceItemKind
  if (kind !== 'conversation' && kind !== 'file' && kind !== 'directory') {
    throw new Error('IPC payload field "kind" must be one of: conversation, file, directory.')
  }
  const mode = typeof record.mode === 'string' ? record.mode : 'disk'
  if (mode !== 'list' && mode !== 'disk') {
    throw new Error('IPC payload field "mode" must be one of: list, disk.')
  }
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    relativePath: requireString(record.relativePath, 'relativePath'),
    kind,
    mode
  }
}

export function parseWorkspaceRemovePayload(payload: unknown): WorkspaceRemovePayload {
  const record = requireRecord(payload)
  const mode = typeof record.mode === 'string' ? record.mode : 'disk'
  if (mode !== 'list' && mode !== 'disk') {
    throw new Error('IPC payload field "mode" must be one of: list, disk.')
  }
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    mode
  }
}

export function parsePreviewLessonInteractionIntent(payload: unknown): PreviewLessonInteractionIntent {
  return normalizePreviewLessonInteractionIntent(payload)
}

export function parseReadLessonPayload(payload: unknown): ReadLessonPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    lessonPath: requireString(record.lessonPath, 'lessonPath')
  }
}

export function parseReadWorkspaceMarkdownPayload(payload: unknown): ReadWorkspaceMarkdownPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    documentPath: requireString(record.documentPath, 'documentPath')
  }
}

export function parseSaveWorkspaceMarkdownPayload(payload: unknown): SaveWorkspaceMarkdownPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    documentPath: requireString(record.documentPath, 'documentPath'),
    content: requireString(record.content, 'content')
  }
}

export function parseReadWorkspaceChangeDiffPayload(payload: unknown): ReadWorkspaceChangeDiffPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    relativePath: requireString(record.relativePath, 'relativePath'),
    changeId: optionalString(record.changeId)
  }
}

export function parseProbeProviderPayload(payload: unknown): ProbeProviderPayload {
  const record = requireRecord(payload)
  const customHeaders = normalizeProviderCustomHeaders(record.customHeaders)
  return {
    baseUrl: requireString(record.baseUrl, 'baseUrl'),
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    endpointFormat: requireEndpointFormat(record.endpointFormat),
    ...(customHeaders.length > 0 ? { customHeaders } : {})
  }
}

export function parseListUpstreamModelsPayload(
  payload: unknown,
  providers: Array<{
    id: string
    baseUrl: string
    apiKey: string
    endpointFormat: ModelEndpointFormat
    customHeaders?: Array<{ name: string; value: string }>
  }>
): ProbeProviderPayload | null {
  const providerIdPayload = payload && typeof payload === 'object'
    ? payload as { providerId?: unknown }
    : null
  const providerId = typeof payload === 'string'
    ? payload
    : typeof providerIdPayload?.providerId === 'string'
      ? providerIdPayload.providerId
      : ''
  if (providerId) {
    const provider = providers.find((item) => item.id === providerId)
    if (!provider) return null
    const customHeaders = normalizeProviderCustomHeaders(provider.customHeaders)
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      endpointFormat: provider.endpointFormat,
      ...(customHeaders.length > 0 ? { customHeaders } : {})
    }
  }
  return parseProbeProviderPayload(payload)
}

export function parseRecordProgressPayload(payload: unknown): RecordProgressPayload {
  const record = requireRecord(payload)
  const results = Array.isArray(record.results) ? record.results : []
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    lessonId: requireString(record.lessonId, 'lessonId'),
    results: results.map((entry) => {
      const item = requireRecord(entry)
      return {
        lessonId: requireString(item.lessonId, 'lessonId'),
        question: requireString(item.question, 'question'),
        correct: item.correct === true
      }
    })
  }
}

export function parseCreateMemoryPayload(payload: unknown): CreateTeachingMemoryPayload {
  const record = requireRecord(payload)
  return {
    content: requireString(record.content, 'content'),
    scope: requireMemoryScope(record.scope),
    tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : [],
    confidence: typeof record.confidence === 'number' ? record.confidence : Number(record.confidence),
    workspaceRoot: optionalString(record.workspaceRoot)
  }
}

export function parseUpdateMemoryPayload(payload: unknown): UpdateTeachingMemoryPayload {
  const record = requireRecord(payload)
  return {
    ...(record.content !== undefined ? { content: requireString(record.content, 'content') } : {}),
    ...(record.tags !== undefined ? { tags: Array.isArray(record.tags) ? record.tags.map((tag) => String(tag)) : [] } : {}),
    ...(record.confidence !== undefined ? { confidence: typeof record.confidence === 'number' ? record.confidence : Number(record.confidence) } : {}),
    ...(record.disabled !== undefined ? { disabled: record.disabled === true } : {}),
    ...(record.workspaceRoot !== undefined ? { workspaceRoot: optionalString(record.workspaceRoot) } : {})
  }
}

export function parseSettingsPatch(payload: unknown): TeachingSettingsPatch {
  return requireRecord(payload) as TeachingSettingsPatch
}

export function parseRemoveGitWorktreePayload(payload: unknown): RemoveTeachingGitWorktreePayload {
  const record = requireRecord(payload)
  return {
    workspaceRoot: requireString(record.workspaceRoot, 'workspaceRoot'),
    worktreePath: requireString(record.worktreePath, 'worktreePath')
  }
}

export function parseGitBranchPayload(payload: unknown): GitBranchPayload {
  const record = requireRecord(payload)
  return {
    workspaceRoot: requireString(record.workspaceRoot, 'workspaceRoot'),
    branch: requireString(record.branch, 'branch')
  }
}

export function parseNotificationPayload(payload: unknown): NotificationPayload {
  const record = requireRecord(payload)
  return {
    title: requireString(record.title, 'title'),
    body: requireString(record.body, 'body')
  }
}

export function requireEndpointFormat(value: unknown): ModelEndpointFormat {
  if (
    value === 'chat_completions' ||
    value === 'responses' ||
    value === 'messages' ||
    value === 'custom_endpoint'
  ) {
    return value
  }
  throw new Error('IPC payload field "endpointFormat" must be a valid endpoint format.')
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    throw new Error('IPC payload must be an object.')
  }
  return value as Record<string, unknown>
}

export function requireHttpUrl(value: unknown): string {
  const raw = requireString(value, 'url')
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Unsupported protocol.')
    }
    return parsed.toString()
  } catch {
    throw new Error('External URL must be a valid http(s) URL.')
  }
}

export function requireString(value: unknown, key: string): string {
  if (typeof value !== 'string') {
    throw new Error(`IPC payload field "${key}" must be a string.`)
  }
  return value
}

export function optionalStreamId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return parseStreamId(value)
}

export function requireStreamId(value: unknown): string {
  return parseStreamId(requireString(value, 'streamId'))
}

export function parseStreamId(value: string): string {
  const streamId = value.trim()
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(streamId)) {
    throw new Error('IPC payload field "streamId" must be a valid stream id.')
  }
  return streamId
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function requireCanonicalConversationId(value: unknown): string {
  const id = requireString(value, 'conversationId')
  if (id !== id.trim() || !SAFE_CONVERSATION_ID.test(id)) {
    throw new Error('IPC payload field "conversationId" must be a canonical conversation id.')
  }
  return id
}

export function optionalCanonicalConversationId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireCanonicalConversationId(value)
}

export function requireSafeId(value: unknown, key: string, maxLength = 160): string {
  const id = requireString(value, key).trim()
  if (id.length > maxLength || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error(`IPC payload field "${key}" must be a safe id of at most ${maxLength} characters.`)
  }
  return id
}

export function optionalSafeId(value: unknown, key: string, maxLength = 160): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireSafeId(value, key, maxLength)
}

export function optionalBoundedTrimmedString(value: unknown, key: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = requireString(value, key).trim()
  if (!text) return undefined
  if (text.length > maxLength) {
    throw new Error(`IPC payload field "${key}" must be at most ${maxLength} characters.`)
  }
  return text
}

export function requireNonNegativeInteger(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`IPC payload field "${key}" must be a non-negative integer.`)
  }
  return value
}

export function optionalNonNegativeInteger(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`IPC payload field "${key}" must be a non-negative integer.`)
  }
  return value
}

export function optionalBoundedString(value: unknown, maxLength: number): string | undefined {
  const text = optionalString(value)?.trim()
  return text ? text.slice(0, maxLength) : undefined
}

export function optionalIsoDate(value: unknown, key: string): string | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) throw new Error(`IPC payload field "${key}" must be an ISO date.`)
  return new Date(timestamp).toISOString()
}

export function optionalPositiveInteger(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return undefined
  const rounded = Math.floor(parsed)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

export function requireMemoryScope(value: unknown): 'user' | 'workspace' | 'project' {
  if (value === 'user' || value === 'workspace' || value === 'project') return value
  throw new Error('IPC payload field "scope" must be a valid memory scope.')
}

export function requireWindowControlAction(value: unknown): WindowControlAction {
  if (value === 'minimize' || value === 'toggle-maximize' || value === 'close') {
    return value
  }
  throw new Error('Unsupported window control action.')
}

/** Re-export turn-review IPC parsers (ADR-0119 peel surface; see teaching-ipc-commands-turn-review). */
export {
  parseProjectTeachingTurnReviewPayload,
  parseDecideTeachingTurnReviewPayload,
  parseProjectTeachingTurnReviewHandoffPayload,
  parseGetTeachingTurnReviewLastBundlePayload,
  parseSaveTeachingTurnReviewLastBundlePayload
} from './teaching-ipc-commands-turn-review'

/** Re-export agent-conversation IPC parsers (ADR-0120 peel surface; see teaching-ipc-commands-agent-conversation). */
export {
  parseSaveAgentConversationPayload,
  parseRenameAgentConversationPayload,
  parseReadAgentConversationPayload,
  parseProjectAgentConversationSummariesPayload,
  parseReadAgentConversationSessionTreePayload,
  parseOpenAgentConversationBranchPayload,
  parseForkAgentConversationBranchPayload,
  parseReplayAgentConversationBranchPayload,
  parseUpdateAgentConversationBranchStatusPayload,
  parseCreateAgentConversationCheckpointPayload,
  parseResolveAgentConversationCheckpointPayload,
  parseRestoreAgentWriteRewindPayload,
  parseListAgentWriteRewindJournalPayload,
  parseQueryAgentArchivedHistoryPayload,
  parseRebuildAgentHistoryIndexPayload
} from './teaching-ipc-commands-agent-conversation'
