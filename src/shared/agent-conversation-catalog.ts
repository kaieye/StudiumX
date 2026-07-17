import type { AgentChatMode } from './teaching-types'
import {
  courseRelativePathFromWorkspacePath,
  isCourseRelativePath,
  isDefaultCourseRelativePath,
  joinTeachingRelativePath,
  normalizeTeachingRelativePath,
  requireSafeTeachingRelativePath
} from './teaching-placement'

export type AgentConversationFileFormat = 'markdown' | 'json'
export type AgentConversationScope = 'course' | 'temporary'

export type AgentConversationPathInfo = {
  normalizedRelativePath: string
  directoryRelativePath: string
  id: string
  format: AgentConversationFileFormat
  scope: AgentConversationScope
  courseRelativePath: string | null
}

export type AgentConversationPlacementInput = {
  mode?: AgentChatMode
  selectedCourseRelativePath?: string | null
  selectedLessonPath?: string | null
  /** Creation timestamp used to select the durable UTC month partition. */
  createdAt?: string | Date | null
}

export type AgentConversationCollectionOptions = {
  includeRoot?: boolean
  includeRootConversation?: boolean
  includeLegacyRootConversations?: boolean
  includeLessons?: boolean
  includeCourses?: boolean
}

const AGENT_CONVERSATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/
const UTC_YEAR_PATTERN = /^\d{4}$/
const UTC_MONTH_PATTERN = /^(0[1-9]|1[0-2])$/

export function normalizeAgentConversationRelativePath(value: string): string {
  return normalizeTeachingRelativePath(value)
}

/**
 * Strictly recognizes only canonical flat legacy paths and canonical two-level
 * UTC partitions. The parser intentionally does not normalize malformed input:
 * callers must not turn an anomalous path into a trusted storage location.
 */
export function describeAgentConversationPath(relativePath: string): AgentConversationPathInfo | null {
  if (typeof relativePath !== 'string') return null
  const normalized = normalizeAgentConversationRelativePath(relativePath)
  if (!normalized || normalized !== relativePath || normalized.split('/').some((part) => !part)) return null

  const format = agentConversationFileFormat(normalized)
  if (!format) return null

  const parts = normalized.split('/')
  const fileName = parts.at(-1) ?? ''
  const id = fileName.replace(/\.(md|json)$/i, '')
  if (!AGENT_CONVERSATION_ID_PATTERN.test(id)) return null

  const directoryParts = parts.slice(0, -1)
  const placement = describeConversationDirectoryParts(directoryParts)
  if (!placement) return null

  return {
    normalizedRelativePath: normalized,
    directoryRelativePath: joinAgentConversationRelativePath(...directoryParts),
    id,
    format,
    scope: placement.scope,
    courseRelativePath: placement.courseRelativePath
  }
}

export function isAgentConversationMarkdownRelativePath(relativePath: string): boolean {
  return describeAgentConversationPath(relativePath)?.format === 'markdown'
}

export function isAgentConversationJsonRelativePath(relativePath: string): boolean {
  return describeAgentConversationPath(relativePath)?.format === 'json'
}

export function isRootAgentConversationMarkdownRelativePath(relativePath: string): boolean {
  const info = describeAgentConversationPath(relativePath)
  return info?.format === 'markdown' && info.scope === 'temporary'
}

export function isTemporaryAgentConversationPath(relativePath: string): boolean {
  return describeAgentConversationPath(relativePath)?.scope === 'temporary'
}

export function isCourseAgentConversationPath(relativePath: string): boolean {
  return describeAgentConversationPath(relativePath)?.scope === 'course'
}

export function courseRelativePathForAgentConversation(relativePath: string): string | null {
  return describeAgentConversationPath(relativePath)?.courseRelativePath ?? null
}

/** Returns the UTC YYYY/MM partition below a canonical conversation directory. */
export function agentConversationUtcMonthDirectoryRelativePath(
  conversationDir: string,
  createdAt: string | Date
): string {
  const directory = normalizeAgentConversationDirectory(conversationDir)
  if (!isAgentConversationDirectoryRelativePath(directory)) {
    throw new Error('Conversation directory is invalid.')
  }
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt)
  if (Number.isNaN(date.getTime())) throw new Error('Conversation creation timestamp is invalid.')
  return joinAgentConversationRelativePath(
    directory,
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0')
  )
}

export function agentConversationDirectoryRelativePath(input: AgentConversationPlacementInput): string {
  const baseDirectory = agentConversationBaseDirectoryRelativePath(input)
  return input.createdAt
    ? agentConversationUtcMonthDirectoryRelativePath(baseDirectory, input.createdAt)
    : baseDirectory
}

export function primaryAgentConversationDirectoryRelativePathForCourse(courseRelativePath: string): string {
  const course = normalizeAgentConversationRelativePath(courseRelativePath)
  return isDefaultCourseRelativePath(course)
    ? 'conversation'
    : joinAgentConversationRelativePath(course, 'conversation')
}

export function agentConversationDirectoryRelativePathsForCourse(courseRelativePath: string): string[] {
  const course = normalizeAgentConversationRelativePath(courseRelativePath) || 'lessons'
  if (isDefaultCourseRelativePath(course)) {
    return ['conversation', 'lessons/conversation', 'lessons/conversations']
  }
  return [
    joinAgentConversationRelativePath(course, 'conversation'),
    joinAgentConversationRelativePath(course, 'conversations')
  ]
}

/** Base directories only; scanners enumerate a flat level plus exactly YYYY/MM below each base. */
export function agentConversationJsonScanDirectories(options: AgentConversationCollectionOptions = {}): string[] {
  const includeRoot = options.includeRoot ?? true
  const includeRootConversation = options.includeRootConversation ?? true
  const includeLegacyRootConversations = options.includeLegacyRootConversations ?? true
  const includeLessons = options.includeLessons ?? true
  const result: string[] = []
  if (includeRoot && includeRootConversation) result.push('conversation')
  if (includeRoot && includeLegacyRootConversations) result.push('conversations')
  if (includeLessons) result.push('lessons/conversation', 'lessons/conversations')
  return result
}

export function agentConversationCourseJsonScanDirectories(courseFolderName: string): string[] {
  return [
    joinAgentConversationRelativePath('courses', courseFolderName, 'conversation'),
    joinAgentConversationRelativePath('courses', courseFolderName, 'conversations')
  ]
}

export function agentConversationJsonRelativePath(id: string, conversationDir = 'conversations'): string {
  return agentConversationFileRelativePath(id, conversationDir, 'json')
}

export function agentConversationMarkdownRelativePath(id: string, conversationDir = 'conversations'): string {
  return agentConversationFileRelativePath(id, conversationDir, 'md')
}

export function pendingAgentConversationRelativePath(input: {
  id: string
  mode: AgentChatMode
  selectedCourseRelativePath: string | null
  createdAt?: string | Date | null
}): string {
  return agentConversationMarkdownRelativePath(input.id, agentConversationDirectoryRelativePath(input))
}

export function agentConversationAbsolutePath(rootPath: string, relativePath: string): string {
  return `${rootPath.replace(/[\\/]+$/, '')}/${normalizeAgentConversationRelativePath(relativePath)}`
}

export function agentConversationJsonRelativePathForMarkdown(markdownRelativePath: string): string {
  const info = describeAgentConversationPath(markdownRelativePath)
  if (info?.format !== 'markdown') {
    throw new Error('Conversation path is outside a conversations directory.')
  }
  return joinAgentConversationRelativePath(info.directoryRelativePath, `${info.id}.json`)
}

/** Kept beside the conversation's own flat or UTC-partitioned directory. */
export function agentConversationSessionAuditRelativePathForMarkdown(markdownRelativePath: string): string {
  const info = describeAgentConversationPath(markdownRelativePath)
  if (info?.format !== 'markdown') {
    throw new Error('Conversation path is outside a conversations directory.')
  }
  return joinAgentConversationRelativePath(info.directoryRelativePath, '.agent-sessions', `${info.id}.jsonl`)
}

export function agentConversationSessionArtifactDirectoryRelativePathForMarkdown(markdownRelativePath: string): string {
  const info = describeAgentConversationPath(markdownRelativePath)
  if (info?.format !== 'markdown') {
    throw new Error('Conversation path is outside a conversations directory.')
  }
  return joinAgentConversationRelativePath(info.directoryRelativePath, '.agent-sessions', info.id)
}

/**
 * Directory reserved for durable child-run transcripts belonging to one
 * conversation. Individual filenames are intentionally allocated in the main
 * process from a child id and content digest; callers must never append an
 * untrusted childRunId to this path.
 */
export function agentConversationChildTranscriptDirectoryRelativePathForMarkdown(markdownRelativePath: string): string {
  return joinAgentConversationRelativePath(
    agentConversationSessionArtifactDirectoryRelativePathForMarkdown(markdownRelativePath),
    'child-transcripts'
  )
}

export function agentConversationCheckpointDirectoryRelativePathForMarkdown(markdownRelativePath: string): string {
  return joinAgentConversationRelativePath(
    agentConversationSessionArtifactDirectoryRelativePathForMarkdown(markdownRelativePath),
    'checkpoints'
  )
}

export function agentConversationHistoryIndexRelativePath(): string {
  return '.agent-sessions/history-index.v1.json'
}

export function agentArtifactCleanupAuditRelativePath(): string {
  return '.agent-sessions/artifact-cleanup.jsonl'
}

/** Preserves canonical legacy or YYYY/MM partition directory paths; never rewrites a layout. */
export function normalizeAgentConversationDirectory(conversationDir: string): string {
  if (typeof conversationDir !== 'string') return 'conversations'
  const normalized = normalizeAgentConversationRelativePath(conversationDir)
  if (normalized !== conversationDir || normalized.split('/').some((part) => !part)) return 'conversations'
  return isAgentConversationDirectoryRelativePath(normalized) ? normalized : 'conversations'
}

function agentConversationBaseDirectoryRelativePath(input: AgentConversationPlacementInput): string {
  if (input.mode === 'temporary') return 'conversations'

  const selectedCourse = normalizeAgentConversationRelativePath(input.selectedCourseRelativePath ?? '')
  if (isCourseRelativePath(selectedCourse)) {
    return primaryAgentConversationDirectoryRelativePathForCourse(selectedCourse)
  }

  const lessonCourse = courseRelativePathFromWorkspacePath(input.selectedLessonPath ?? '')
  if (lessonCourse) return primaryAgentConversationDirectoryRelativePathForCourse(lessonCourse)

  return input.mode === 'teaching' ? 'conversation' : 'conversations'
}

function agentConversationFileRelativePath(id: string, conversationDir: string, extension: 'md' | 'json'): string {
  return joinAgentConversationRelativePath(normalizeAgentConversationDirectory(conversationDir), `${id}.${extension}`)
}

function describeConversationDirectoryParts(parts: string[]): {
  scope: AgentConversationScope
  courseRelativePath: string | null
} | null {
  const base = describeConversationBaseDirectoryParts(parts)
  if (base) return base
  if (parts.length < 3 || !isUtcPartition(parts.at(-2), parts.at(-1))) return null
  return describeConversationBaseDirectoryParts(parts.slice(0, -2))
}

function describeConversationBaseDirectoryParts(parts: string[]): {
  scope: AgentConversationScope
  courseRelativePath: string | null
} | null {
  if (parts.length === 1 && parts[0] === 'conversation') {
    return { scope: 'course', courseRelativePath: 'lessons' }
  }
  if (parts.length === 1 && parts[0] === 'conversations') {
    return { scope: 'temporary', courseRelativePath: null }
  }
  if (parts.length === 2 && parts[0] === 'lessons' && isConversationFolderName(parts[1])) {
    return { scope: 'course', courseRelativePath: 'lessons' }
  }
  if (
    parts.length === 3 &&
    parts[0] === 'courses' &&
    isSafeCourseFolderName(parts[1]) &&
    isConversationFolderName(parts[2])
  ) {
    return {
      scope: 'course',
      courseRelativePath: joinAgentConversationRelativePath('courses', parts[1])
    }
  }
  return null
}

function isAgentConversationDirectoryRelativePath(value: string): boolean {
  return Boolean(describeConversationDirectoryParts(value.split('/')))
}

function isUtcPartition(year: string | undefined, month: string | undefined): boolean {
  return Boolean(year && month && UTC_YEAR_PATTERN.test(year) && UTC_MONTH_PATTERN.test(month))
}

function isSafeCourseFolderName(value: string | undefined): boolean {
  if (!value) return false
  try {
    return requireSafeTeachingRelativePath(value, 'Course folder') === value
  } catch {
    return false
  }
}

function agentConversationFileFormat(relativePath: string): AgentConversationFileFormat | null {
  if (relativePath.endsWith('.md')) return 'markdown'
  if (relativePath.endsWith('.json')) return 'json'
  return null
}

function isConversationFolderName(value: string | undefined): boolean {
  return value === 'conversation' || value === 'conversations'
}

function joinAgentConversationRelativePath(...parts: string[]): string {
  return joinTeachingRelativePath(...parts)
}
