import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { listAgentConversations, sortAgentConversationSummaries } from './teaching-agent-conversations'
import { readLearningAssetCatalog } from './teaching-workspace/learning-assets-catalog'
import {
  cleanText,
  fileExists,
  isPathArchived,
  toWorkspaceRelativePath,
  workspaceRelativePath,
  type WorkspacePathMeta
} from './teaching-workspace-paths'
import {
  courseRelativePathForAgentConversation as courseRelativePathFromConversationPath,
  isAgentConversationJsonRelativePath
} from '../shared/agent-conversation-catalog'
import type {
  AgentConversationSummary,
  LessonSummary,
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

export { readMissionSummary } from './teaching-workspace/learning-assets-catalog'

export type WorkspaceCatalogWorkspace = {
  id: string
  name: string
  rootPath: string
}

export type WorkspaceCatalogSource = {
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

export async function buildWorkspaceCatalog(
  workspace: WorkspaceCatalogWorkspace,
  source: WorkspaceCatalogSource
): Promise<WorkspaceCatalogSummary> {
  const pathMeta = source.pathMeta ?? {}
  const learningAssets = await readLearningAssetCatalog(workspace.rootPath, workspace.name)
  const lessons = presentLessonSummaries(source.lessons, pathMeta)
  const conversations = await listAgentConversations(
    workspace.rootPath,
    pathMeta,
    { includeRoot: true, includeRootConversation: true, includeLegacyRootConversations: false }
  )
  const fileTree = await buildWorkspaceFileTree(workspace.rootPath, pathMeta)
  const courses = buildCourseSummaries(workspace, lessons, conversations, pathMeta)
  return {
    missionPath: learningAssets.missionPath,
    resourcesPath: learningAssets.resourcesPath,
    lessonsDir: join(workspace.rootPath, 'lessons'),
    recordsDir: learningAssets.recordsDir,
    referenceDir: learningAssets.referenceDir,
    reviewsDir: join(workspace.rootPath, 'reviews'),
    missionTitle: learningAssets.mission.title,
    missionExcerpt: learningAssets.mission.excerpt,
    courses,
    fileTree,
    conversations,
    resources: learningAssets.resources,
    records: learningAssets.records,
    lessons,
    referenceCount: learningAssets.referenceCount,
    assetsReady: await fileExists(join(workspace.rootPath, 'assets', 'lesson.css'))
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
    if (isPathArchived(pathMeta, lesson.relativePath) || isPathArchived(pathMeta, lesson.courseRelativePath)) continue
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

function presentLessonSummaries(
  lessons: LessonSummary[],
  pathMeta: Record<string, WorkspacePathMeta>
): LessonSummary[] {
  return lessons
    .map((lesson) => ({ ...lesson, pinned: Boolean(pathMeta[lesson.relativePath]?.pinned) }))
    .filter((lesson) => !isPathArchived(pathMeta, lesson.relativePath))
    .sort((a, b) => {
      const aPinned = a.pinned ? 1 : 0
      const bPinned = b.pinned ? 1 : 0
      if (aPinned !== bPinned) return bPinned - aPinned
      return b.id.localeCompare(a.id)
    })
}

const WORKSPACE_TREE_MAX_DEPTH = 5
const WORKSPACE_TREE_MAX_ENTRIES_PER_DIR = 80
const WORKSPACE_TREE_IGNORED_DIRS = new Set([
  '.agent-sessions',
  '.git',
  '.studiumx',
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
