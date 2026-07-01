import type { LessonSummary, TeachingWorkspaceSummary, WorkspaceFileNode } from './teaching-types'

export type SidebarCourseFolder = {
  workspace: TeachingWorkspaceSummary
  node: WorkspaceFileNode
}

export function listSidebarCourseFolders(
  workspaces: TeachingWorkspaceSummary[],
  showAllCourseFiles: boolean
): SidebarCourseFolder[] {
  return workspaces.map((workspace) => {
    const lessonsTree = workspace.fileTree.find((node) => node.kind === 'directory' && sameRelativePath(node.relativePath, 'lessons'))
    const children = lessonsTree?.children ?? []
    const visibleChildren = showAllCourseFiles ? children : filterCourseTreeToLessons(children, workspace.lessons, 1)
    return {
      workspace,
      node: {
        name: workspace.name,
        kind: 'directory',
        relativePath: 'lessons',
        absolutePath: workspace.lessonsDir,
        children: visibleChildren
      }
    }
  })
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

function isCourseConversationPath(relativePath: string): boolean {
  return /^courses\/[^/]+\/conversations\/[^/]+\.md$/i.test(normalizeRelativePath(relativePath))
}

function sameRelativePath(left: string, right: string): boolean {
  return normalizeRelativePath(left) === normalizeRelativePath(right)
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').replace(/\/+$/, '')
}
