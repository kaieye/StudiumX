import type { LessonSummary, TeachingWorkspaceSummary, WorkspaceFileNode } from './teaching-types'

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
      children: listSidebarCourseFolders([workspace], showAllCourseFiles).map(({ node }) => ({
        ...node,
        name: sidebarCourseNodeName(node)
      }))
    }
  }))
}

export function listSidebarCourseFolders(
  workspaces: TeachingWorkspaceSummary[],
  showAllCourseFiles: boolean
): SidebarCourseFolder[] {
  return workspaces.flatMap((workspace) => workspace.courses.map((course) => {
    const courseTree = findWorkspaceNode(workspace.fileTree, course.relativePath)
    const children = courseTree?.children ?? []
    const visibleChildren = showAllCourseFiles ? children : filterCourseTreeToLessons(children, workspace.lessons, 1)
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

function findWorkspaceNode(nodes: WorkspaceFileNode[], relativePath: string): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (sameRelativePath(node.relativePath, relativePath)) return node
    const child = node.kind === 'directory' ? findWorkspaceNode(node.children ?? [], relativePath) : null
    if (child) return child
  }
  return null
}

function filterCourseTreeToLessons(nodes: WorkspaceFileNode[], lessons: LessonSummary[], level = 0): WorkspaceFileNode[] {
  const lessonPaths = new Set(lessons.map((lesson) => normalizeRelativePath(lesson.relativePath)))

  return nodes
    .map((node): WorkspaceFileNode | null => {
      if (node.kind === 'file') {
        const relativePath = normalizeRelativePath(node.relativePath)
        return lessonPaths.has(relativePath) || isCourseConversationPath(relativePath) ? node : null
      }
      const children = filterCourseTreeToLessons(node.children ?? [], lessons, level + 1)
      if (level === 0) return { ...node, children }
      if (children.length === 0) return null
      return { ...node, children }
    })
    .filter((node): node is WorkspaceFileNode => Boolean(node))
}

function sidebarCourseNodeName(node: WorkspaceFileNode): string {
  const relativePath = normalizeRelativePath(node.relativePath)
  return relativePath === 'lessons' ? 'lessons' : node.name
}

function isCourseConversationPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  return /^lessons\/conversations\/[^/]+\.md$/i.test(normalized) ||
    /^courses\/[^/]+\/conversations\/[^/]+\.md$/i.test(normalized)
}

function sameRelativePath(left: string, right: string): boolean {
  return normalizeRelativePath(left) === normalizeRelativePath(right)
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').replace(/\/+$/, '')
}
