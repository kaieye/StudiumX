import type {
  AgentChatContextCompactionRequest,
  AgentChatMessage,
  AgentChatStreamPayload,
  AgentChatTurn,
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
  ReadAgentConversationPayload,
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
  UpdateTeachingMemoryPayload,
  UpdateMissionPayload,
  WindowControlAction
} from '../shared/teaching-types'
import { isLessonStyleId } from '../shared/lesson-styles'

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
  return {
    streamId: optionalStreamId(record.streamId),
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
    mode: record.mode === 'teaching' ? 'teaching' : record.mode === 'temporary' ? 'temporary' : undefined,
    context: optionalString(record.context),
    contextCompaction: parseAgentChatContextCompaction(record.contextCompaction),
    ...(skillIds?.length ? { skillIds } : {}),
    messages: parseAgentChatMessages(record.messages),
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
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    mode: record.mode === 'teaching' ? 'teaching' : record.mode === 'temporary' ? 'temporary' : undefined,
    conversationId: optionalString(record.conversationId) ?? null,
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
    courseName: optionalString(record.courseName),
    turns: Array.isArray(record.turns)
      ? record.turns.filter((turn): turn is AgentChatTurn => Boolean(turn) && typeof turn === 'object') as AgentChatTurn[]
      : []
  }
}

export function parseReadAgentConversationPayload(payload: unknown): ReadAgentConversationPayload {
  const record = requireRecord(payload)
  return {
    workspaceId: requireString(record.workspaceId, 'workspaceId'),
    conversationId: requireString(record.conversationId, 'conversationId')
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
