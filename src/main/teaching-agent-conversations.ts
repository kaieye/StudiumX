import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isPathInsideRoot } from './path-access'
import {
  cleanText,
  formatDate,
  isPathArchived,
  normalizeWorkspaceRelativePath,
  slugify,
  workspaceRelativePath,
  type WorkspacePathMeta
} from './teaching-workspace-paths'
import {
  agentConversationCourseJsonScanDirectories,
  agentConversationJsonRelativePath,
  agentConversationJsonRelativePathForMarkdown,
  agentConversationJsonScanDirectories,
  agentConversationMarkdownRelativePath,
  isAgentConversationMarkdownRelativePath
} from '../shared/agent-conversation-catalog'
import type {
  AgentChatProcessEvent,
  AgentChatTurn,
  AgentConversationRecord,
  AgentConversationSummary
} from '../shared/teaching-types'

export type AgentConversationWorkspace = {
  id: string
  name: string
  rootPath: string
}

export async function listAgentConversations(
  rootPath: string,
  pathMeta: Record<string, WorkspacePathMeta> = {},
  options: {
    includeRoot?: boolean
    includeRootConversation?: boolean
    includeLegacyRootConversations?: boolean
    includeLessons?: boolean
    includeCourses?: boolean
    fallbackWorkspaceId?: string
  } = {}
): Promise<AgentConversationSummary[]> {
  const jsonRelativePaths = await collectAgentConversationJsonRelativePaths(rootPath, options)
  const records = await Promise.all(
    jsonRelativePaths.map((relativePath) => readAgentConversationRecordAt(rootPath, relativePath).catch(() => null))
  )
  return sortAgentConversationSummaries(records
    .filter((record): record is AgentConversationRecord => Boolean(record))
    .map((record) => toAgentConversationSummary(record, pathMeta, options.fallbackWorkspaceId))
    .filter((summary) => !isPathArchived(pathMeta, summary.relativePath))
  )
}

export async function nextAgentConversationId(
  rootPath: string,
  title: string,
  timestamp: string
): Promise<string> {
  const base = `chat-${formatConversationTimestamp(new Date(timestamp))}-${slugify(title, 'conversation')}`.slice(0, 96)
  let id = requireSafeAgentConversationId(base)
  let suffix = 2
  while (await agentConversationIdExists(rootPath, id)) {
    id = requireSafeAgentConversationId(`${base.slice(0, 88)}-${suffix}`)
    suffix += 1
  }
  return id
}

export async function readAgentConversationRecord(
  rootPath: string,
  conversationId: string
): Promise<AgentConversationRecord> {
  const id = requireSafeAgentConversationId(conversationId)
  const jsonRelativePath = await findAgentConversationJsonRelativePath(rootPath, id)
  return readAgentConversationRecordAt(rootPath, jsonRelativePath)
}

export async function writeAgentConversationRecord(
  workspace: AgentConversationWorkspace,
  record: AgentConversationRecord
): Promise<void> {
  const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(record.relativePath)
  const markdownRelativePath = normalizeWorkspaceRelativePath(record.relativePath)
  if (!isAgentConversationMarkdownRelativePath(markdownRelativePath)) {
    throw new Error('Conversation markdown path is outside a conversations directory.')
  }
  await atomicWriteFile(
    join(workspace.rootPath, jsonRelativePath),
    `${JSON.stringify({
      version: 1,
      workspaceId: record.workspaceId ?? workspace.id,
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      relativePath: record.relativePath,
      turns: record.turns
    }, null, 2)}\n`
  )
  await atomicWriteFile(
    join(workspace.rootPath, markdownRelativePath),
    renderAgentConversationMarkdown(workspace, record)
  )
}

export function normalizeAgentConversationTurns(turns: unknown): AgentChatTurn[] {
  if (!Array.isArray(turns)) return []
  const now = new Date().toISOString()
  const normalized: AgentChatTurn[] = []
  for (const [index, item] of turns.entries()) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null
    if (!role) continue
    const toolCalls = Array.isArray(record.toolCalls)
      ? record.toolCalls.map((raw, toolIndex) => {
          const tool = (raw ?? {}) as Record<string, unknown>
          return {
            id: typeof tool.id === 'string' && tool.id ? tool.id : `tool-${index}-${toolIndex}`,
            name: typeof tool.name === 'string' ? tool.name : '',
            arguments: typeof tool.arguments === 'string' ? tool.arguments : '',
            result: typeof tool.result === 'string' ? tool.result : undefined,
            isError: tool.isError === true
          }
        })
      : undefined
    const processEvents: AgentChatProcessEvent[] | undefined = Array.isArray(record.processEvents)
      ? record.processEvents
          .filter((event): event is Record<string, unknown> => Boolean(event) && typeof event === 'object')
          .map((event, eventIndex): AgentChatProcessEvent => {
            const kind: AgentChatProcessEvent['kind'] =
              event.kind === 'tool_call' || event.kind === 'tool_result' ? event.kind : 'status'
            return {
              id: typeof event.id === 'string' && event.id ? event.id : `event-${index}-${eventIndex}`,
              kind,
              title: typeof event.title === 'string' ? event.title : '',
              detail: typeof event.detail === 'string' ? event.detail : undefined,
              status: typeof event.status === 'string' ? event.status as NonNullable<AgentChatTurn['processEvents']>[number]['status'] : undefined,
              toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
              toolName: typeof event.toolName === 'string' ? event.toolName : undefined,
              isError: event.isError === true,
              createdAt: typeof event.createdAt === 'string' ? event.createdAt : now
            }
          })
      : undefined
    normalized.push({
      id: typeof record.id === 'string' && record.id ? record.id : `${role}-${index}`,
      role,
      content: typeof record.content === 'string' ? record.content : '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      processEvents: processEvents && processEvents.length > 0 ? processEvents : undefined,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now
    })
  }
  return normalized
}

export function deriveConversationTitle(turns: AgentChatTurn[], timestamp: string): string {
  const firstUserContent = cleanText(turns.find((turn) => turn.role === 'user')?.content)
  if (firstUserContent) return firstUserContent.length > 48 ? `${firstUserContent.slice(0, 48)}...` : firstUserContent
  return `Conversation ${formatDate(new Date(timestamp))}`
}

export async function ensureTeachingContentDirectories(rootPath: string): Promise<void> {
  await Promise.all([
    mkdir(join(rootPath, 'lessons'), { recursive: true }),
    mkdir(join(rootPath, 'conversation'), { recursive: true })
  ])
}

export function requireSafeAgentConversationId(value: string): string {
  const id = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw new Error('Conversation id is invalid.')
  return id
}

export function toAgentConversationSummary(
  record: AgentConversationRecord,
  pathMeta: Record<string, WorkspacePathMeta> = {},
  fallbackWorkspaceId?: string
): AgentConversationSummary {
  return {
    id: record.id,
    workspaceId: record.workspaceId ?? fallbackWorkspaceId,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    relativePath: record.relativePath,
    absolutePath: record.absolutePath,
    messageCount: record.messageCount,
    pinned: Boolean(pathMeta[record.relativePath]?.pinned)
  }
}

export function sortAgentConversationSummaries(
  conversations: AgentConversationSummary[]
): AgentConversationSummary[] {
  return conversations.sort((left, right) => {
    const leftPinned = left.pinned ? 1 : 0
    const rightPinned = right.pinned ? 1 : 0
    if (leftPinned !== rightPinned) return rightPinned - leftPinned
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

async function readAgentConversationRecordAt(
  rootPath: string,
  jsonRelativePath: string
): Promise<AgentConversationRecord> {
  const normalizedJsonRelativePath = normalizeWorkspaceRelativePath(jsonRelativePath)
  const id = requireSafeAgentConversationId(basename(normalizedJsonRelativePath).replace(/\.json$/i, ''))
  const jsonPath = join(rootPath, jsonRelativePath)
  if (!isPathInsideRoot(rootPath, jsonPath)) throw new Error('Conversation path is outside the workspace.')
  const parsed = safeJsonParse(await readFile(jsonPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('Conversation record is invalid.')
  const record = parsed as Record<string, unknown>
  const turns = normalizeAgentConversationTurns(record.turns)
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt
  const title = cleanText(record.title) || deriveConversationTitle(turns, createdAt)
  const storedMarkdownRelativePath = typeof record.relativePath === 'string'
    ? normalizeWorkspaceRelativePath(record.relativePath)
    : ''
  const conversationDir = dirname(normalizedJsonRelativePath).replace(/\\/g, '/')
  const relativePath = isAgentConversationMarkdownRelativePath(storedMarkdownRelativePath)
    ? storedMarkdownRelativePath
    : agentConversationMarkdownRelativePath(id, conversationDir)
  return {
    id,
    workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : undefined,
    title,
    createdAt,
    updatedAt,
    relativePath,
    absolutePath: join(rootPath, relativePath),
    messageCount: turns.filter((turn) => turn.role === 'user' || turn.role === 'assistant').length,
    turns
  }
}

function renderAgentConversationMarkdown(
  workspace: AgentConversationWorkspace,
  record: AgentConversationRecord
): string {
  const lines = [
    `# ${record.title}`,
    '',
    `Workspace: ${workspace.name}`,
    `Created: ${record.createdAt}`,
    `Updated: ${record.updatedAt}`,
    ''
  ]
  for (const turn of record.turns) {
    lines.push(`## ${turn.role === 'user' ? 'User' : 'Assistant'}`, '')
    lines.push(turn.content.trim() || '(empty)', '')
    if (turn.toolCalls?.length) {
      lines.push('Tool calls:', '')
      for (const tool of turn.toolCalls) {
        lines.push(`- ${tool.name || 'tool'}: ${compactTextForMarkdown(tool.result || tool.arguments || '', 240)}`)
      }
      lines.push('')
    }
  }
  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`
}

async function collectAgentConversationJsonRelativePaths(
  rootPath: string,
  options: {
    includeRoot?: boolean
    includeRootConversation?: boolean
    includeLegacyRootConversations?: boolean
    includeLessons?: boolean
    includeCourses?: boolean
  } = {}
): Promise<string[]> {
  const includeCourses = options.includeCourses ?? true
  const result: string[] = []
  for (const directory of agentConversationJsonScanDirectories(options)) {
    const entries = await readdir(join(rootPath, directory), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
        result.push(workspaceRelativePath(directory, entry.name))
      }
    }
  }
  if (!includeCourses) return result
  const courseEntries = await readdir(join(rootPath, 'courses'), { withFileTypes: true }).catch(() => [])
  for (const courseEntry of courseEntries) {
    if (!courseEntry.isDirectory()) continue
    for (const directory of agentConversationCourseJsonScanDirectories(courseEntry.name)) {
      const entries = await readdir(join(rootPath, directory), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
          result.push(workspaceRelativePath(directory, entry.name))
        }
      }
    }
  }
  return result
}

async function agentConversationIdExists(rootPath: string, id: string): Promise<boolean> {
  return findAgentConversationJsonRelativePath(rootPath, id)
    .then(() => true)
    .catch(() => false)
}

async function findAgentConversationJsonRelativePath(rootPath: string, id: string): Promise<string> {
  const safeId = requireSafeAgentConversationId(id)
  const matches = (await collectAgentConversationJsonRelativePaths(rootPath))
    .filter((relativePath) => basename(relativePath).replace(/\.json$/i, '') === safeId)
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
  const first = matches[0]
  if (!first) throw new Error('Conversation not found.')
  return first
}

function formatConversationTimestamp(date: Date): string {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${safeDate.getFullYear()}${pad(safeDate.getMonth() + 1)}${pad(safeDate.getDate())}-${pad(safeDate.getHours())}${pad(safeDate.getMinutes())}${pad(safeDate.getSeconds())}`
}

function compactTextForMarkdown(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return '(empty)'
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}...` : compact
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, path)
}
