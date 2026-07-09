import type { AgentConversationSummary, LessonSummary, TeachingCourseSummary, TeachingWorkspaceSummary, WorkspaceFileNode } from './teaching-types'
import {
  agentConversationDirectoryRelativePathsForCourse,
  primaryAgentConversationDirectoryRelativePathForCourse
} from './agent-conversation-catalog'
import {
  DEFAULT_COURSE_RELATIVE_PATH,
  isDefaultCourseRelativePath,
  joinTeachingRelativePath,
  lessonFolderNameForCourse,
  lessonFolderRelativePathForCourse,
  normalizeTeachingRelativePath,
  sameTeachingRelativePath
} from './teaching-placement'

export type SidebarCourseFolder = {
  workspace: TeachingWorkspaceSummary
  node: WorkspaceFileNode
}

export type SidebarWorkspaceFolder = {
  workspace: TeachingWorkspaceSummary
  node: WorkspaceFileNode
}

export function listSidebarWorkspaceFolders(
  workspaces: TeachingWorkspaceSummary[],
  showAllCourseFiles: boolean
): SidebarWorkspaceFolder[] {
  return workspaces.map((workspace) => ({
    workspace,
    node: {
      name: workspace.name,
      kind: 'directory',
      relativePath: '',
      absolutePath: workspace.rootPath,
      pinned: workspace.pinned,
      children: listSidebarWorkspaceChildren(workspace, showAllCourseFiles)
    }
  }))
}

export function listSidebarCourseFolders(
  workspaces: TeachingWorkspaceSummary[],
  showAllCourseFiles: boolean
): SidebarCourseFolder[] {
  return workspaces.flatMap((workspace) => workspace.courses.map((course) => {
    const courseTree = findWorkspaceNode(workspace.fileTree, course.relativePath)
    const visibleChildren = buildCourseContentFolders(workspace.fileTree, courseTree, course, showAllCourseFiles)
    return {
      workspace,
      node: {
        name: course.name,
        kind: 'directory',
        relativePath: course.relativePath,
        absolutePath: course.absolutePath,
        children: visibleChildren
      }
    }
  }))
}

function listSidebarWorkspaceChildren(
  workspace: TeachingWorkspaceSummary,
  showAllCourseFiles: boolean
): WorkspaceFileNode[] {
  const courseFolders = listSidebarCourseFolders([workspace], showAllCourseFiles)
  const defaultCourse = courseFolders.find(({ node }) => isDefaultCourseRelativePath(node.relativePath))
  const legacyCourses = courseFolders
    .filter(({ node }) => !isDefaultCourseRelativePath(node.relativePath))
    .map(({ node }) => ({
      ...node,
      name: sidebarCourseNodeName(node)
    }))
  return [
    ...(defaultCourse?.node.children ?? []),
    ...workspaceRootTeachingMarkdownNodes(workspace),
    ...legacyCourses
  ]
}

function workspaceRootTeachingMarkdownNodes(workspace: TeachingWorkspaceSummary): WorkspaceFileNode[] {
  const rootFiles = new Map<string, WorkspaceFileNode>()
  indexWorkspaceNodes(workspace.fileTree, rootFiles)
  return ['MISSION.md', 'GLOSSARY.md', 'RESOURCES.md', 'NOTES.md']
    .map((relativePath) => rootFiles.get(relativePath))
    .filter((node): node is WorkspaceFileNode => Boolean(node))
}

function findWorkspaceNode(nodes: WorkspaceFileNode[], relativePath: string): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (sameTeachingRelativePath(node.relativePath, relativePath)) return node
    const child = node.kind === 'directory' ? findWorkspaceNode(node.children ?? [], relativePath) : null
    if (child) return child
  }
  return null
}

function buildCourseContentFolders(
  workspaceTree: WorkspaceFileNode[],
  courseTree: WorkspaceFileNode | null,
  course: TeachingCourseSummary,
  showAllCourseFiles: boolean
): WorkspaceFileNode[] {
  const nodeByPath = new Map<string, WorkspaceFileNode>()
  indexWorkspaceNodes(workspaceTree, nodeByPath)
  const lessonFolderName = lessonFolderNameForCourse(course.relativePath)
  const lessonChildren = showAllCourseFiles
    ? mergeUniqueNodes([
        ...lessonFolderChildren(courseTree, course),
        ...legacyCourseRootLessonNodes(courseTree, course),
        ...course.sessions.map((session) => lessonNode(session.lesson, nodeByPath))
      ])
    : course.sessions.map((session) => lessonNode(session.lesson, nodeByPath))
  const conversationChildren = showAllCourseFiles
    ? mergeUniqueNodes([
        ...conversationFolderChildren(workspaceTree, course),
        ...course.conversations.map((conversation) => conversationNode(conversation, nodeByPath))
      ])
    : course.conversations.map((conversation) => conversationNode(conversation, nodeByPath))

  return [
    buildCourseContentFolder({
      course,
      workspaceTree,
      courseTree,
      name: lessonFolderName,
      children: lessonChildren
    }),
    buildCourseContentFolder({
      course,
      workspaceTree,
      courseTree,
      name: 'conversation',
      children: conversationChildren
    })
  ]
}

function buildCourseContentFolder(options: {
  course: TeachingCourseSummary
  workspaceTree: WorkspaceFileNode[]
  courseTree: WorkspaceFileNode | null
  name: 'lessons' | 'lesson' | 'conversation'
  children: WorkspaceFileNode[]
}): WorkspaceFileNode {
  const relativePath = contentFolderRelativePath(options.course, options.name)
  const existing = findCourseContentFolder(options.workspaceTree, options.courseTree, options.course, options.name)
  return {
    name: options.name,
    kind: 'directory',
    relativePath,
    absolutePath: existing?.absolutePath ?? joinDisplayPath(options.course.absolutePath, options.name),
    pinned: existing?.pinned,
    children: options.children
  }
}

function findCourseContentFolder(
  workspaceTree: WorkspaceFileNode[],
  courseTree: WorkspaceFileNode | null,
  course: TeachingCourseSummary,
  name: 'lessons' | 'lesson' | 'conversation'
): WorkspaceFileNode | null {
  if (name === 'conversation') {
    for (const relativePath of agentConversationDirectoryRelativePathsForCourse(course.relativePath)) {
      const folder = findWorkspaceNode(workspaceTree, relativePath)
      if (folder) return folder
    }
  }
  if (isDefaultCourseRelativePath(course.relativePath)) {
    return findWorkspaceNode(workspaceTree, contentFolderRelativePath(course, name))
  }
  const children = courseTree?.children ?? []
  const current = findWorkspaceNode(children, joinTeachingRelativePath(course.relativePath, name))
  if (current) return current
  return null
}

function lessonFolderChildren(
  courseTree: WorkspaceFileNode | null,
  course: TeachingCourseSummary
): WorkspaceFileNode[] {
  if (isDefaultCourseRelativePath(course.relativePath)) return courseTree?.children ?? []
  const folder = findWorkspaceNode(courseTree?.children ?? [], lessonFolderRelativePathForCourse(course.relativePath))
  return folder?.kind === 'directory' ? folder.children ?? [] : []
}

function conversationFolderChildren(
  workspaceTree: WorkspaceFileNode[],
  course: TeachingCourseSummary
): WorkspaceFileNode[] {
  return agentConversationDirectoryRelativePathsForCourse(course.relativePath).flatMap((relativePath) => {
    const folder = findWorkspaceNode(workspaceTree, relativePath)
    return folder?.kind === 'directory' ? folder.children ?? [] : []
  })
}

function contentFolderRelativePath(course: TeachingCourseSummary, name: 'lessons' | 'lesson' | 'conversation'): string {
  if (name === 'conversation') {
    return primaryAgentConversationDirectoryRelativePathForCourse(course.relativePath)
  }
  return isDefaultCourseRelativePath(course.relativePath)
    ? DEFAULT_COURSE_RELATIVE_PATH
    : lessonFolderRelativePathForCourse(course.relativePath)
}

function legacyCourseRootLessonNodes(
  courseTree: WorkspaceFileNode | null,
  course: TeachingCourseSummary
): WorkspaceFileNode[] {
  const excluded = new Set([
    lessonFolderRelativePathForCourse(course.relativePath),
    joinTeachingRelativePath(course.relativePath, 'lessons'),
    joinTeachingRelativePath(course.relativePath, 'conversation'),
    joinTeachingRelativePath(course.relativePath, 'conversations')
  ])
  return (courseTree?.children ?? [])
    .filter((node) => node.kind === 'file')
    .filter((node) => !excluded.has(normalizeTeachingRelativePath(node.relativePath)))
}

function mergeUniqueNodes(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  const seen = new Set<string>()
  const result: WorkspaceFileNode[] = []
  for (const node of nodes) {
    const path = normalizeTeachingRelativePath(node.relativePath)
    if (seen.has(path)) continue
    seen.add(path)
    result.push(node)
  }
  return result
}

function lessonNode(lesson: LessonSummary, nodeByPath: Map<string, WorkspaceFileNode>): WorkspaceFileNode {
  return nodeByPath.get(normalizeTeachingRelativePath(lesson.relativePath)) ?? {
    name: fileNameFromPath(lesson.relativePath),
    kind: 'file',
    relativePath: lesson.relativePath,
    absolutePath: lesson.absolutePath,
    pinned: lesson.pinned
  }
}

function conversationNode(
  conversation: AgentConversationSummary,
  nodeByPath: Map<string, WorkspaceFileNode>
): WorkspaceFileNode {
  return nodeByPath.get(normalizeTeachingRelativePath(conversation.relativePath)) ?? {
    name: fileNameFromPath(conversation.relativePath),
    kind: 'file',
    relativePath: conversation.relativePath,
    absolutePath: conversation.absolutePath,
    pinned: conversation.pinned
  }
}

function indexWorkspaceNodes(nodes: WorkspaceFileNode[], nodeByPath: Map<string, WorkspaceFileNode>): void {
  for (const node of nodes) {
    nodeByPath.set(normalizeTeachingRelativePath(node.relativePath), node)
    if (node.kind === 'directory') indexWorkspaceNodes(node.children ?? [], nodeByPath)
  }
}

function sidebarCourseNodeName(node: WorkspaceFileNode): string {
  const relativePath = normalizeTeachingRelativePath(node.relativePath)
  return isDefaultCourseRelativePath(relativePath) ? DEFAULT_COURSE_RELATIVE_PATH : node.name
}

function fileNameFromPath(path: string): string {
  return normalizeTeachingRelativePath(path).split('/').filter(Boolean).at(-1) ?? path
}

function joinDisplayPath(basePath: string, child: string): string {
  return `${basePath.replace(/[\\/]+$/, '')}/${child}`
}
