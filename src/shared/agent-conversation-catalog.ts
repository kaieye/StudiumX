import type { AgentChatMode } from './teaching-types'
import {
  courseRelativePathFromWorkspacePath,
  isCourseRelativePath,
  isDefaultCourseRelativePath,
  joinTeachingRelativePath,
  normalizeTeachingRelativePath
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
}

export type AgentConversationCollectionOptions = {
  includeRoot?: boolean
  includeRootConversation?: boolean
  includeLegacyRootConversations?: boolean
  includeLessons?: boolean
  includeCourses?: boolean
}

export function normalizeAgentConversationRelativePath(value: string): string {
  return normalizeTeachingRelativePath(value)
}

export function describeAgentConversationPath(relativePath: string): AgentConversationPathInfo | null {
  const normalized = normalizeAgentConversationRelativePath(relativePath)
  const format = agentConversationFileFormat(normalized)
  if (!format) return null

  const parts = normalized.split('/').filter(Boolean)
  const fileName = parts.at(-1) ?? ''
  const id = fileName.replace(/\.(md|json)$/i, '')
  const directoryRelativePath = joinAgentConversationRelativePath(...parts.slice(0, -1))

  if (parts.length === 2 && parts[0] === 'conversation') {
    return {
      normalizedRelativePath: normalized,
      directoryRelativePath,
      id,
      format,
      scope: 'course',
      courseRelativePath: 'lessons'
    }
  }

  if (parts.length === 2 && parts[0] === 'conversations') {
    return {
      normalizedRelativePath: normalized,
      directoryRelativePath,
      id,
      format,
      scope: 'temporary',
      courseRelativePath: null
    }
  }

  if (parts.length === 3 && parts[0] === 'lessons' && isConversationFolderName(parts[1])) {
    return {
      normalizedRelativePath: normalized,
      directoryRelativePath,
      id,
      format,
      scope: 'course',
      courseRelativePath: 'lessons'
    }
  }

  if (parts.length === 4 && parts[0] === 'courses' && parts[1] && isConversationFolderName(parts[2])) {
    return {
      normalizedRelativePath: normalized,
      directoryRelativePath,
      id,
      format,
      scope: 'course',
      courseRelativePath: joinAgentConversationRelativePath('courses', parts[1])
    }
  }

  return null
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

export function agentConversationDirectoryRelativePath(input: AgentConversationPlacementInput): string {
  if (input.mode === 'temporary') return 'conversations'

  const selectedCourse = normalizeAgentConversationRelativePath(input.selectedCourseRelativePath ?? '')
  if (isCourseRelativePath(selectedCourse)) {
    return primaryAgentConversationDirectoryRelativePathForCourse(selectedCourse)
  }

  const lessonCourse = courseRelativePathFromWorkspacePath(input.selectedLessonPath ?? '')
  if (lessonCourse) return primaryAgentConversationDirectoryRelativePathForCourse(lessonCourse)

  return input.mode === 'teaching' ? 'conversation' : 'conversations'
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

export function normalizeAgentConversationDirectory(conversationDir: string): string {
  const normalized = normalizeAgentConversationRelativePath(conversationDir)
  if (normalized === 'conversation') return 'conversation'
  if (!normalized || normalized === 'conversations') return 'conversations'
  if (normalized === 'lessons/conversation' || normalized === 'lessons/conversations') return normalized
  if (/^courses\/[^/]+\/conversation$/.test(normalized) || /^courses\/[^/]+\/conversations$/.test(normalized)) {
    return normalized
  }
  return 'conversations'
}

function agentConversationFileRelativePath(id: string, conversationDir: string, extension: 'md' | 'json'): string {
  return joinAgentConversationRelativePath(normalizeAgentConversationDirectory(conversationDir), `${id}.${extension}`)
}

function agentConversationFileFormat(relativePath: string): AgentConversationFileFormat | null {
  if (relativePath.toLowerCase().endsWith('.md')) return 'markdown'
  if (relativePath.toLowerCase().endsWith('.json')) return 'json'
  return null
}

function isConversationFolderName(value: string | undefined): boolean {
  return value === 'conversation' || value === 'conversations'
}

function joinAgentConversationRelativePath(...parts: string[]): string {
  return joinTeachingRelativePath(...parts)
}
