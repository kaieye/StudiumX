import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { listAgentConversations, sortAgentConversationSummaries } from './teaching-agent-conversations'
import {
  cleanText,
  collectTeachingFiles,
  compactMarkdown,
  fileExists,
  formatDate,
  isPathArchived,
  titleFromFilename,
  toWorkspaceRelativePath,
  workspaceRelativePath,
  type WorkspacePathMeta
} from './teaching-workspace-paths'
import {
  courseRelativePathForAgentConversation as courseRelativePathFromConversationPath,
  isAgentConversationJsonRelativePath,
  isAgentConversationMarkdownRelativePath
} from '../shared/agent-conversation-catalog'
import type {
  AgentConversationSummary,
  LessonSummary,
  ResourceSummary,
  TeachingCourseSummary,
  TeachingSessionSummary,
  TeachingWorkspaceSummary,
  WorkspaceFileNode
} from '../shared/teaching-types'
import {
  DEFAULT_COURSE_RELATIVE_PATH,
  deriveLessonPlacementFromRelativePath,
  describeCoursePlacement,
  isDefaultCourseRelativePath,
  normalizeTeachingRelativePath
} from '../shared/teaching-placement'

export type WorkspaceCatalogWorkspace = {
  id: string
  name: string
  rootPath: string
}

export type WorkspaceCatalogIndex = {
  lessons: LessonSummary[]
  pathMeta?: Record<string, WorkspacePathMeta>
}

export type WorkspaceCatalogSummary = Pick<
  TeachingWorkspaceSummary,
  | 'missionPath'
  | 'resourcesPath'
  | 'lessonsDir'
  | 'recordsDir'
  | 'referenceDir'
  | 'reviewsDir'
  | 'missionTitle'
  | 'missionExcerpt'
  | 'courses'
  | 'fileTree'
  | 'conversations'
  | 'resources'
  | 'records'
  | 'lessons'
  | 'referenceCount'
  | 'assetsReady'
>

export type WorkspaceCatalogResult = WorkspaceCatalogSummary & {
  lessonIndexChanged: boolean
}

export async function buildWorkspaceCatalog(
  workspace: WorkspaceCatalogWorkspace,
  index: WorkspaceCatalogIndex
): Promise<WorkspaceCatalogResult> {
  const pathMeta = index.pathMeta ?? {}
  const mission = await readMissionSummary(workspace.rootPath, workspace.name)
  const lessons = await mergeLessonIndexWithDisk(workspace.rootPath, workspace.name, index.lessons, pathMeta)
  const conversations = await listAgentConversations(
    workspace.rootPath,
    pathMeta,
    { includeRoot: true, includeRootConversation: true, includeLegacyRootConversations: false }
  )
  const fileTree = await buildWorkspaceFileTree(workspace.rootPath, pathMeta)
  const courses = buildCourseSummaries(workspace, lessons, conversations, pathMeta)
  return {
    missionPath: join(workspace.rootPath, 'MISSION.md'),
    resourcesPath: join(workspace.rootPath, 'RESOURCES.md'),
    lessonsDir: join(workspace.rootPath, 'lessons'),
    recordsDir: join(workspace.rootPath, 'lessons'),
    referenceDir: join(workspace.rootPath, 'lessons'),
    reviewsDir: join(workspace.rootPath, 'lessons'),
    missionTitle: mission.title,
    missionExcerpt: mission.excerpt,
    courses,
    fileTree,
    conversations,
    resources: await readResourceSummary(workspace.rootPath),
    records: await readLearningRecords(workspace.rootPath),
    lessons,
    referenceCount: (await collectTeachingFiles(workspace.rootPath, (file) => file.toLowerCase().endsWith('-reference.html'))).length,
    assetsReady: await fileExists(join(workspace.rootPath, 'assets', 'lesson.css')),
    lessonIndexChanged: lessons.length !== index.lessons.length
  }
}

export async function readMissionSummary(
  rootPath: string,
  fallbackName: string
): Promise<{ title: string; excerpt: string }> {
  const content = await readFile(join(rootPath, 'MISSION.md'), 'utf8').catch(() => '')
  const title = /^#\s+Mission:\s*(.+)$/m.exec(content)?.[1] ?? /^#\s+(.+)$/m.exec(content)?.[1] ?? fallbackName
  const excerpt = /##\s+Why\s+([\s\S]*?)(?:\n##\s+|$)/m.exec(content)?.[1] ?? content
  return {
    title: cleanText(title),
    excerpt: compactMarkdown(excerpt) || '等待补充学习使命。'
  }
}

export function buildCourseSummaries(
  workspace: WorkspaceCatalogWorkspace,
  lessons: LessonSummary[],
  conversations: AgentConversationSummary[] = [],
  pathMeta: Record<string, WorkspacePathMeta> = {}
): TeachingCourseSummary[] {
  const courseMap = new Map<string, {
    id: string
    name: string
    relativePath: string
    absolutePath: string
    sessions: TeachingSessionSummary[]
    conversations: AgentConversationSummary[]
  }>()
  const ensureCourse = (relativePath: string): NonNullable<ReturnType<typeof courseMap.get>> => {
    const normalized = normalizeTeachingRelativePath(relativePath) || DEFAULT_COURSE_RELATIVE_PATH
    const existing = courseMap.get(normalized)
    if (existing) return existing
    const placement = describeCoursePlacement({ workspaceName: workspace.name, courseRelativePath: normalized })
    const course = {
      id: placement.courseId,
      name: placement.courseName,
      relativePath: placement.courseRelativePath,
      absolutePath: join(workspace.rootPath, placement.courseRelativePath),
      sessions: [],
      conversations: []
    }
    courseMap.set(normalized, course)
    return course
  }

  if (!isPathArchived(pathMeta, DEFAULT_COURSE_RELATIVE_PATH)) {
    ensureCourse(DEFAULT_COURSE_RELATIVE_PATH)
  }
  for (const lesson of lessons) {
    if (isPathArchived(pathMeta, lesson.courseRelativePath)) continue
    ensureCourse(lesson.courseRelativePath).sessions.push({
      id: lesson.sessionId,
      name: lesson.sessionName,
      relativePath: lesson.sessionRelativePath,
      absolutePath: lesson.sessionAbsolutePath,
      lesson
    })
  }
  for (const conversation of conversations) {
    const courseRelativePath = courseRelativePathFromConversationPath(conversation.relativePath)
    if (!courseRelativePath) continue
    if (isPathArchived(pathMeta, courseRelativePath)) continue
    ensureCourse(courseRelativePath).conversations.push(conversation)
  }

  return [...courseMap.values()]
    .filter((course) => !isPathArchived(pathMeta, course.relativePath))
    .map((course): TeachingCourseSummary => {
      const sortedSessions = course.sessions.sort((left, right) => right.lesson.id.localeCompare(left.lesson.id))
      const sortedConversations = sortAgentConversationSummaries(course.conversations)
      return {
        id: course.id,
        name: course.name,
        relativePath: course.relativePath,
        absolutePath: course.absolutePath,
        lessonCount: sortedSessions.length,
        sessionCount: sortedSessions.length + sortedConversations.length,
        sessions: sortedSessions,
        conversations: sortedConversations
      }
    })
    .sort((left, right) => {
      if (isDefaultCourseRelativePath(left.relativePath)) return -1
      if (isDefaultCourseRelativePath(right.relativePath)) return 1
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
}

export function normalizeLessonSummary(
  rootPath: string,
  workspaceName: string,
  lesson: LessonSummary
): LessonSummary {
  const placement = deriveLessonPlacementFromPath(rootPath, workspaceName, lesson.absolutePath)
  return {
    ...lesson,
    courseId: placement.courseId,
    courseName: placement.courseName,
    courseRelativePath: placement.courseRelativePath,
    courseAbsolutePath: placement.courseAbsolutePath,
    sessionId: placement.sessionId,
    sessionName: normalizeLessonSessionName(lesson, placement.sessionName),
    sessionRelativePath: placement.sessionRelativePath,
    sessionAbsolutePath: placement.sessionAbsolutePath
  }
}

function normalizeLessonSessionName(lesson: LessonSummary, filenameSessionName: string): string {
  const storedSessionName = cleanText(lesson.sessionName)
  if (storedSessionName && !isFilenameDerivedSessionName(storedSessionName, filenameSessionName, lesson.id)) {
    return storedSessionName
  }
  const title = cleanText(lesson.title)
  if (!title) return filenameSessionName
  const sequence = /^\d{4}$/.test(lesson.id) && lesson.id !== '0000' ? lesson.id : ''
  if (!sequence || title.startsWith(sequence)) return title
  return `${sequence} ${title}`
}

function isFilenameDerivedSessionName(value: string, filenameSessionName: string, lessonId: string): boolean {
  const normalizedValue = value.toLocaleLowerCase()
  const normalizedFilenameName = cleanText(filenameSessionName).toLocaleLowerCase()
  const normalizedId = cleanText(lessonId)
  return (
    normalizedValue === normalizedFilenameName ||
    Boolean(normalizedId && normalizedValue === `${normalizedId} ${normalizedFilenameName}`)
  )
}

async function mergeLessonIndexWithDisk(
  rootPath: string,
  workspaceName: string,
  indexedLessons: LessonSummary[],
  pathMeta: Record<string, WorkspacePathMeta> = {}
): Promise<LessonSummary[]> {
  const indexedByPath = new Map(indexedLessons.map((lesson) => [resolve(lesson.absolutePath).toLowerCase(), lesson]))
  const files = await collectTeachingFiles(rootPath, (filePath) => {
    const lower = filePath.toLowerCase()
    if (!lower.endsWith('.html')) return false
    if (lower.endsWith('-reference.html')) return false
    return true
  })
  return files
    .map((absolutePath) => {
      const existing = indexedByPath.get(resolve(absolutePath).toLowerCase())
      if (existing) return existing
      const file = basename(absolutePath)
      const relativePath = toWorkspaceRelativePath(rootPath, absolutePath)
      const placement = deriveLessonPlacementFromPath(rootPath, workspaceName, absolutePath)
      const idMatch = /^(\d{4})-/.exec(file)
      return {
        id: idMatch?.[1] ?? '0000',
        title: titleFromFilename(file),
        objective: '从本地 lesson 文件恢复的课程。',
        prompt: '',
        createdAt: new Date(0).toISOString(),
        durationMinutes: 12,
        courseId: placement.courseId,
        courseName: placement.courseName,
        courseRelativePath: placement.courseRelativePath,
        courseAbsolutePath: placement.courseAbsolutePath,
        sessionId: placement.sessionId,
        sessionName: placement.sessionName,
        sessionRelativePath: placement.sessionRelativePath,
        sessionAbsolutePath: placement.sessionAbsolutePath,
        relativePath,
        absolutePath
      } satisfies LessonSummary
    })
    .map((lesson) => ({ ...lesson, pinned: Boolean(pathMeta[lesson.relativePath]?.pinned) }))
    .filter((lesson) => !isPathArchived(pathMeta, lesson.relativePath))
    .sort((a, b) => {
      const aPinned = a.pinned ? 1 : 0
      const bPinned = b.pinned ? 1 : 0
      if (aPinned !== bPinned) return bPinned - aPinned
      return b.id.localeCompare(a.id)
    })
}

async function readResourceSummary(rootPath: string): Promise<ResourceSummary[]> {
  const content = await readFile(join(rootPath, 'RESOURCES.md'), 'utf8').catch(() => '')
  const rows: ResourceSummary[] = []
  let currentSection = '资源'
  for (const line of content.split(/\r?\n/)) {
    const heading = /^##\s+(.+)$/.exec(line)
    if (heading) {
      currentSection = heading[1]!.trim()
      continue
    }
    if (!line.startsWith('- ')) continue
    const item = line.slice(2).trim()
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/.exec(item)
    const localMatch = /^([^:]+):\s*(.+)$/.exec(item)
    const title = linkMatch?.[1] ?? localMatch?.[1] ?? item.split(' — ')[0] ?? item
    const detail = compactMarkdown(linkMatch?.[3] ?? localMatch?.[2] ?? item.split(' — ').slice(1).join(' — ')) || '已记录在资源索引中。'
    rows.push({ title: cleanText(title), detail, tag: currentSection })
  }
  return rows.length > 0 ? rows.slice(0, 8) : [{ title: 'RESOURCES.md', detail: '等待添加首批可信资源。', tag: 'Gaps' }]
}

async function readLearningRecords(rootPath: string): Promise<TeachingWorkspaceSummary['records']> {
  const files = await collectTeachingFiles(
    rootPath,
    (file) => {
      if (!file.toLowerCase().endsWith('.md')) return false
      const name = basename(file)
      if (
        name.startsWith('MISSION') ||
        name.startsWith('RESOURCES') ||
        name.startsWith('GLOSSARY') ||
        name.startsWith('NOTES')
      ) return false
      return !isAgentConversationMarkdownRelativePath(toWorkspaceRelativePath(rootPath, file))
    }
  )
  return Promise.all(
    files
      .sort()
      .reverse()
      .slice(0, 8)
      .map(async (absolutePath) => {
        const file = basename(absolutePath)
        const content = await readFile(absolutePath, 'utf8').catch(() => '')
        const info = await stat(absolutePath).catch(() => null)
        return {
          title: cleanText(/^#\s+(.+)$/m.exec(content)?.[1] ?? titleFromFilename(file)),
          date: formatDate(info?.mtime ?? new Date()),
          relativePath: toWorkspaceRelativePath(rootPath, absolutePath),
          absolutePath
        }
      })
  )
}

const WORKSPACE_TREE_MAX_DEPTH = 5
const WORKSPACE_TREE_MAX_ENTRIES_PER_DIR = 80
const WORKSPACE_TREE_IGNORED_DIRS = new Set([
  '.agent-sessions',
  '.git',
  '.teachos',
  'node_modules',
  'out',
  'dist',
  'release'
])

async function buildWorkspaceFileTree(
  rootPath: string,
  pathMeta: Record<string, WorkspacePathMeta> = {}
): Promise<WorkspaceFileNode[]> {
  return readWorkspaceTreeDirectory(rootPath, '', 0, pathMeta)
}

async function readWorkspaceTreeDirectory(
  rootPath: string,
  relativeDir: string,
  depth: number,
  pathMeta: Record<string, WorkspacePathMeta>
): Promise<WorkspaceFileNode[]> {
  const absoluteDir = relativeDir ? join(rootPath, relativeDir) : rootPath
  const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => [])
  const visibleEntries = entries
    .filter((entry) => !shouldHideWorkspaceTreeEntry(relativeDir, entry.name, entry.isDirectory()))
    .filter((entry) => {
      const relativePath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), entry.name)
      return !isPathArchived(pathMeta, relativePath)
    })
    .sort((left, right) => {
      const leftPath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), left.name)
      const rightPath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), right.name)
      const leftPinned = pathMeta[leftPath]?.pinned ? 1 : 0
      const rightPinned = pathMeta[rightPath]?.pinned ? 1 : 0
      if (leftPinned !== rightPinned) return rightPinned - leftPinned
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
      return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
    .slice(0, WORKSPACE_TREE_MAX_ENTRIES_PER_DIR)

  const nodes = await Promise.all(
    visibleEntries.map(async (entry): Promise<WorkspaceFileNode | null> => {
      if (!entry.isDirectory() && !entry.isFile()) return null
      const relativePath = workspaceRelativePath(relativeDir.replace(/\\/g, '/'), entry.name)
      const absolutePath = join(rootPath, relativePath)
      const pinned = Boolean(pathMeta[relativePath]?.pinned)
      if (entry.isDirectory()) {
        const atDepthLimit = depth + 1 >= WORKSPACE_TREE_MAX_DEPTH
        return {
          name: entry.name,
          kind: 'directory',
          relativePath,
          absolutePath,
          children: atDepthLimit ? [] : await readWorkspaceTreeDirectory(rootPath, relativePath, depth + 1, pathMeta),
          truncated: atDepthLimit || entries.length > WORKSPACE_TREE_MAX_ENTRIES_PER_DIR || undefined,
          pinned
        }
      }
      return {
        name: entry.name,
        kind: 'file',
        relativePath,
        absolutePath,
        pinned
      }
    })
  )

  return nodes.filter((node): node is WorkspaceFileNode => Boolean(node))
}

function shouldHideWorkspaceTreeEntry(relativeDir: string, name: string, isDirectory: boolean): boolean {
  if (isDirectory && WORKSPACE_TREE_IGNORED_DIRS.has(name)) return true
  const normalizedDir = relativeDir.replace(/\\/g, '/')
  if (name.toLowerCase().endsWith('.json') && isAgentConversationJsonRelativePath(workspaceRelativePath(normalizedDir, name))) return true
  return false
}

function deriveLessonPlacementFromPath(
  rootPath: string,
  workspaceName: string,
  absolutePath: string
): Pick<
  LessonSummary,
  | 'courseId'
  | 'courseName'
  | 'courseRelativePath'
  | 'courseAbsolutePath'
  | 'sessionId'
  | 'sessionName'
  | 'sessionRelativePath'
  | 'sessionAbsolutePath'
> {
  const relativePath = toWorkspaceRelativePath(rootPath, absolutePath)
  const placement = deriveLessonPlacementFromRelativePath({ workspaceName, relativePath })
  return {
    courseId: placement.courseId,
    courseName: placement.courseName,
    courseRelativePath: placement.courseRelativePath,
    courseAbsolutePath: join(rootPath, placement.courseRelativePath),
    sessionId: placement.sessionId,
    sessionName: placement.sessionName,
    sessionRelativePath: placement.sessionRelativePath,
    sessionAbsolutePath: join(rootPath, placement.sessionRelativePath)
  }
}
