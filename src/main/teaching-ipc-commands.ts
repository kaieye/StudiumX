import type {
  AgentArchivedHistoryItemType,
  AgentChatContextCompactionRequest,
  AgentChatMessage,
  AgentChatStreamPayload,
  AgentChatTurn,
  ApplyLessonStylePayload,
  CleanupAgentArtifactsPayload,
  CreateAgentConversationCheckpointPayload,
  ForkAgentConversationBranchPayload,
  OpenAgentConversationBranchPayload,
  QueryAgentArchivedHistoryPayload,
  RebuildAgentHistoryIndexPayload,
  ResolveAgentConversationCheckpointPayload,
  AskAnswer,
  CreateWorkspacePayload,
  CreateTeachingMemoryPayload,
  GenerateLessonPayload,
  GitBranchPayload,
  ModelEndpointFormat,
  NotificationPayload,
  ProbeProviderPayload,
  ReadWorkspaceChangeDiffPayload,
  ReadAgentConversationPayload,
  ReadAgentConversationSessionTreePayload,
  ReplayAgentConversationBranchPayload,
  ReadLessonPayload,
  ReadWorkspaceMarkdownPayload,
  RemoveTeachingGitWorktreePayload,
  WorkspaceItemKind,
  WorkspaceItemMetaPayload,
  WorkspaceItemRemovePayload,
  WorkspaceRemovePayload,
  RecordProgressPayload,
  SaveAgentConversationPayload,
  SaveWorkspaceMarkdownPayload,
  TeachingSettingsPatch,
  UpdateAgentConversationBranchStatusPayload,
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload,
  WindowControlAction
} from '../shared/teaching-types'
import type { CommitLearningOutcomeRequest } from '../shared/teaching-types/system-api'
import { normalizePreviewLessonInteractionIntent, type PreviewLessonInteractionIntent } from '../shared/teaching-types/lesson-interaction'
import { isLessonStyleId } from '../shared/lesson-styles'

const MAX_SAVED_CONVERSATION_TURNS = 400
const MAX_SAVED_CONVERSATION_BYTES = 8 * 1024 * 1024
const MAX_SAVED_TURN_CONTENT_BYTES = 1024 * 1024
const SAFE_CONVERSATION_ID = /^[a-z0-9][a-z0-9-]{0,99}$/
const SAFE_LINEAGE_ID = /^[A-Za-z0-9._:-]{1,160}$/
const SAFE_TURN_ID = /^[A-Za-z0-9._:-]{1,240}$/

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
  if (record.schemaVersion !== 1 || record.type !== 'commit') return null
  if (![record.workspaceId, record.sessionId, record.operationId].every(isNonEmptyString)) return null
  return {
    schemaVersion: 1,
    type: 'commit',
    workspaceId: record.workspaceId as string,
    sessionId: record.sessionId as string,
    operationId: record.operationId as string
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function parseCreateWorkspacePayload(payload: unknown): CreateWorkspacePayload {
  const record = requireRecord(payload)
  return {
    name: requireString(record.name, 'name'),
    prompt: requireString(record.prompt, 'prompt')
  }
}

export function parseUpdateMissionPayload(payload: unknown): UpdateMissionPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    prompt: requireString(record.prompt, 'prompt')
  }
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

export function parseGenerateLessonPayload(payload: unknown): GenerateLessonPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    prompt: requireString(record.prompt, 'prompt'),
    courseName: optionalString(record.courseName),
    messages: parseAgentChatMessages(record.messages)
  }
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

export function parseSaveAgentConversationPayload(payload: unknown): SaveAgentConversationPayload {
  const record = requireRecord(payload)
  const runId = optionalStreamId(record.runId)
  const courseName = optionalString(record.courseName)
  const expectedBranchRevision = optionalNonNegativeInteger(record.expectedBranchRevision, 'expectedBranchRevision')
  return {
    workspaceId: requireSafeId(record.workspaceId, 'workspaceId'),
    ...(runId ? { runId } : {}),
    mode: record.mode === 'teaching' ? 'teaching' : record.mode === 'temporary' ? 'temporary' : undefined,
    conversationId: optionalCanonicalConversationId(record.conversationId) ?? null,
    ...(expectedBranchRevision !== undefined ? { expectedBranchRevision } : {}),
    selectedLessonPath:
      typeof record.selectedLessonPath === 'string'
        ? record.selectedLessonPath
        : record.selectedLessonPath === null
          ? null
          : undefined,
    selectedCourseRelativePath:
      typeof record.selectedCourseRelativePath === 'string'
        ? record.selectedCourseRelativePath
        : record.selectedCourseRelativePath === null
          ? null
          : undefined,
    ...(courseName ? { courseName } : {}),
    turns: parseSavedAgentConversationTurns(record.turns)
  }
}

export function parseReadAgentConversationPayload(payload: unknown): ReadAgentConversationPayload {
  const record = requireRecord(payload)
  return parseAgentConversationBranchReference(record)
}

export function parseReadAgentConversationSessionTreePayload(
  payload: unknown
): ReadAgentConversationSessionTreePayload {
  return parseAgentConversationBranchReference(requireRecord(payload))
}

export function parseOpenAgentConversationBranchPayload(payload: unknown): OpenAgentConversationBranchPayload {
  return parseAgentConversationBranchReference(requireRecord(payload))
}

export function parseForkAgentConversationBranchPayload(payload: unknown): ForkAgentConversationBranchPayload {
  const record = requireRecord(payload)
  const branch = parseAgentConversationBranchReference(record)
  const sourceTurnId = optionalSafeId(record.sourceTurnId, 'sourceTurnId', 240)
  const title = optionalBoundedTrimmedString(record.title, 'title', 240)
  const expectedRevision = requireNonNegativeInteger(record.expectedRevision, 'expectedRevision')
  return {
    ...branch,
    ...(sourceTurnId ? { sourceTurnId } : {}),
    ...(title ? { title } : {}),
    expectedRevision
  }
}

export function parseReplayAgentConversationBranchPayload(payload: unknown): ReplayAgentConversationBranchPayload {
  const record = requireRecord(payload)
  const sourceTurnId = optionalSafeId(record.sourceTurnId, 'sourceTurnId', 240)
  return {
    ...parseAgentConversationBranchReference(record),
    ...(sourceTurnId ? { sourceTurnId } : {})
  }
}

export function parseUpdateAgentConversationBranchStatusPayload(
  payload: unknown
): UpdateAgentConversationBranchStatusPayload {
  const record = requireRecord(payload)
  const branch = parseAgentConversationBranchReference(record)
  const status = requireAgentConversationBranchStatus(record.status)
  const expectedRevision = requireNonNegativeInteger(record.expectedRevision, 'expectedRevision')
  return {
    ...branch,
    status,
    expectedRevision
  }
}

export function parseCreateAgentConversationCheckpointPayload(payload: unknown): CreateAgentConversationCheckpointPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    conversationId: requireString(record.conversationId, 'conversationId'),
    label: optionalBoundedString(record.label, 240),
    reason: optionalBoundedString(record.reason, 2_000)
  }
}

export function parseResolveAgentConversationCheckpointPayload(payload: unknown): ResolveAgentConversationCheckpointPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    conversationId: requireString(record.conversationId, 'conversationId'),
    checkpointId: requireString(record.checkpointId, 'checkpointId')
  }
}

export function parseQueryAgentArchivedHistoryPayload(payload: unknown): QueryAgentArchivedHistoryPayload {
  const record = requireRecord(payload)
  const types = Array.isArray(record.types)
    ? record.types.map((value): AgentArchivedHistoryItemType => {
        if (value === 'conversation_turn' || value === 'session_sidecar' || value === 'tool_result' ||
          value === 'child_transcript' || value === 'checkpoint') return value
        throw new Error('IPC payload field "types" contains an invalid archived history item type.')
      })
    : undefined
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    scope: requireAgentConversationStorageScope(record.scope),
    conversationId: optionalString(record.conversationId),
    from: optionalIsoDate(record.from, 'from'),
    to: optionalIsoDate(record.to, 'to'),
    types: types?.length ? types : undefined,
    checkpointId: optionalString(record.checkpointId),
    limit: optionalPositiveInteger(record.limit, 1, 500),
    maxBytes: optionalPositiveInteger(record.maxBytes, 1_024, 2 * 1024 * 1024),
    maxExcerptBytes: optionalPositiveInteger(record.maxExcerptBytes, 64, 8 * 1024)
  }
}

export function parseRebuildAgentHistoryIndexPayload(payload: unknown): RebuildAgentHistoryIndexPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    scope: requireAgentConversationStorageScope(record.scope)
  }
}

export function parseCleanupAgentArtifactsPayload(payload: unknown): CleanupAgentArtifactsPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    scope: requireAgentConversationStorageScope(record.scope),
    dryRun: record.dryRun !== false,
    retentionDays: optionalPositiveInteger(record.retentionDays, 1, 3_650),
    graceHours: optionalPositiveInteger(record.graceHours, 1, 24 * 30),
    maxTotalBytes: optionalPositiveInteger(record.maxTotalBytes, 1024 * 1024, 10 * 1024 * 1024 * 1024)
  }
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
  return {
    baseUrl: requireString(record.baseUrl, 'baseUrl'),
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    endpointFormat: requireEndpointFormat(record.endpointFormat)
  }
}

export function parseListUpstreamModelsPayload(
  payload: unknown,
  providers: Array<{ id: string; baseUrl: string; apiKey: string; endpointFormat: ModelEndpointFormat }>
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
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      endpointFormat: provider.endpointFormat
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

function parseSavedAgentConversationTurns(value: unknown): AgentChatTurn[] {
  if (!Array.isArray(value)) throw new Error('IPC payload field "turns" must be an array.')
  if (value.length > MAX_SAVED_CONVERSATION_TURNS) {
    throw new Error(`IPC payload field "turns" must contain at most ${MAX_SAVED_CONVERSATION_TURNS} turns.`)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error('IPC payload field "turns" must be JSON serializable.')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SAVED_CONVERSATION_BYTES) {
    throw new Error(`IPC payload field "turns" exceeds ${MAX_SAVED_CONVERSATION_BYTES} bytes.`)
  }

  const ids = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`IPC payload turn ${index} must be an object.`)
    }
    const turn = item as Record<string, unknown>
    const id = requireSafeTurnId(turn.id, `turns[${index}].id`)
    if (ids.has(id)) throw new Error(`IPC payload field "turns" contains duplicate turn id "${id}".`)
    ids.add(id)
    if (turn.role !== 'user' && turn.role !== 'assistant') {
      throw new Error(`IPC payload field "turns[${index}].role" must be user or assistant.`)
    }
    if (typeof turn.content !== 'string') {
      throw new Error(`IPC payload field "turns[${index}].content" must be a string.`)
    }
    if (Buffer.byteLength(turn.content, 'utf8') > MAX_SAVED_TURN_CONTENT_BYTES) {
      throw new Error(`IPC payload field "turns[${index}].content" is too large.`)
    }
    if (typeof turn.createdAt !== 'string' || Number.isNaN(Date.parse(turn.createdAt))) {
      throw new Error(`IPC payload field "turns[${index}].createdAt" must be an ISO date.`)
    }
    validateSavedTurnProvenance(turn.metadata, index)
    return item as AgentChatTurn
  })
}

function validateSavedTurnProvenance(metadata: unknown, turnIndex: number): void {
  if (metadata === undefined) return
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata" must be an object.`)
  }
  const provenance = (metadata as Record<string, unknown>).provenance
  if (provenance === undefined) return
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata.provenance" is invalid.`)
  }
  const record = provenance as Record<string, unknown>
  const allowedKeys = new Set(['kind', 'sourceConversationId', 'sourceBranchId', 'sourceTurnId', 'replayId'])
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata.provenance" contains unsupported fields.`)
  }
  const kind = record.kind
  if (kind !== 'original' && kind !== 'replayed' && kind !== 'recovery_notice') {
    throw new Error(`IPC payload field "turns[${turnIndex}].metadata.provenance.kind" is invalid.`)
  }
  const sourceConversationId = optionalExactSafeId(record.sourceConversationId, SAFE_LINEAGE_ID)
  const sourceBranchId = optionalExactSafeId(record.sourceBranchId, SAFE_LINEAGE_ID)
  const sourceTurnId = optionalExactSafeId(record.sourceTurnId, SAFE_TURN_ID)
  const replayId = optionalExactSafeId(record.replayId, SAFE_LINEAGE_ID)
  if (kind === 'original' && (sourceConversationId || sourceBranchId || sourceTurnId || replayId)) {
    throw new Error('Original conversation turns cannot claim replay provenance.')
  }
  if (kind === 'replayed' && !(sourceConversationId && sourceBranchId && sourceTurnId && replayId)) {
    throw new Error('Replayed conversation turns require complete source provenance.')
  }
  if (kind === 'recovery_notice' && (sourceBranchId || sourceTurnId || replayId)) {
    throw new Error('Recovery notices cannot claim replay provenance.')
  }
}

function optionalExactSafeId(value: unknown, pattern: RegExp): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value !== value.trim() || !pattern.test(value)) {
    throw new Error('Conversation turn provenance contains an invalid id.')
  }
  return value
}

function requireSafeTurnId(value: unknown, key: string): string {
  const id = requireString(value, key)
  if (id !== id.trim() || !SAFE_TURN_ID.test(id)) {
    throw new Error(`IPC payload field "${key}" must be a safe turn id.`)
  }
  return id
}

function requireCanonicalConversationId(value: unknown): string {
  const id = requireString(value, 'conversationId')
  if (id !== id.trim() || !SAFE_CONVERSATION_ID.test(id)) {
    throw new Error('IPC payload field "conversationId" must be a canonical conversation id.')
  }
  return id
}

function optionalCanonicalConversationId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireCanonicalConversationId(value)
}

function requireAgentConversationLookupScope(value: unknown): 'workspace' | 'temporary' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'workspace' || value === 'temporary') return value
  throw new Error('IPC payload field "scope" must be workspace or temporary.')
}

function parseAgentConversationBranchReference(record: Record<string, unknown>): {
  workspaceId: string
  conversationId: string
  scope?: 'workspace' | 'temporary'
} {
  const scope = requireAgentConversationLookupScope(record.scope)
  return {
    workspaceId: requireSafeId(record.workspaceId, 'workspaceId'),
    conversationId: requireCanonicalConversationId(record.conversationId),
    ...(scope ? { scope } : {})
  }
}

function requireSafeId(value: unknown, key: string, maxLength = 160): string {
  const id = requireString(value, key).trim()
  if (id.length > maxLength || !/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error(`IPC payload field "${key}" must be a safe id of at most ${maxLength} characters.`)
  }
  return id
}

function optionalSafeId(value: unknown, key: string, maxLength = 160): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireSafeId(value, key, maxLength)
}

function optionalBoundedTrimmedString(value: unknown, key: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const text = requireString(value, key).trim()
  if (!text) return undefined
  if (text.length > maxLength) {
    throw new Error(`IPC payload field "${key}" must be at most ${maxLength} characters.`)
  }
  return text
}

function requireNonNegativeInteger(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`IPC payload field "${key}" must be a non-negative integer.`)
  }
  return value
}

function optionalNonNegativeInteger(value: unknown, key: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`IPC payload field "${key}" must be a non-negative integer.`)
  }
  return value
}

function requireAgentConversationBranchStatus(value: unknown): 'active' | 'archived' | 'deleted' {
  if (value === 'active' || value === 'archived' || value === 'deleted') return value
  throw new Error('IPC payload field "status" must be active, archived, or deleted.')
}

function optionalBoundedString(value: unknown, maxLength: number): string | undefined {
  const text = optionalString(value)?.trim()
  return text ? text.slice(0, maxLength) : undefined
}

function optionalIsoDate(value: unknown, key: string): string | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) throw new Error(`IPC payload field "${key}" must be an ISO date.`)
  return new Date(timestamp).toISOString()
}

function requireAgentConversationStorageScope(value: unknown): 'workspace' | 'temporary' | 'all' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'workspace' || value === 'temporary' || value === 'all') return value
  throw new Error('IPC payload field "scope" must be workspace, temporary, or all.')
}

function optionalPositiveInteger(value: unknown, min: number, max: number): number | undefined {
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
