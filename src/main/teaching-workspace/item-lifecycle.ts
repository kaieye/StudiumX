import { basename, dirname, join, resolve } from 'node:path'
import type { WorkspaceItemKind, WorkspaceItemRemoveMode } from '../../shared/teaching-types'
import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionArtifactDirectoryRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../shared/agent-conversation-catalog'
import type { WorkspacePathMeta } from '../teaching-workspace-paths'
import {
  normalizeWorkspaceRelativePath,
  pathRemovedByWorkspaceItem,
  prunePathMeta
} from '../teaching-workspace-paths'
import { isWorkspaceScaffoldPath, type WorkspaceIndex } from './lifecycle'

export type WorkspaceItemTarget = {
  relativePath: string
  kind: WorkspaceItemKind
}

export type WorkspaceItemMetaChange = {
  pinned?: boolean | null
  archived?: boolean | null
}

export type WorkspaceItemDiskRemovalPlan = {
  files: string[]
  directories: string[]
}

export function shouldArchiveWorkspaceItem(mode: WorkspaceItemRemoveMode | undefined): boolean {
  return (mode ?? 'disk') === 'list'
}

export function mergeWorkspaceItemPathMeta(
  pathMeta: Record<string, WorkspacePathMeta> | undefined,
  relativePath: string,
  change: WorkspaceItemMetaChange
): Record<string, WorkspacePathMeta> {
  const key = normalizeWorkspaceRelativePath(relativePath)
  const nextPathMeta = { ...(pathMeta ?? {}) }
  const merged: WorkspacePathMeta = { ...(nextPathMeta[key] ?? {}) }

  if (change.pinned === null) delete merged.pinned
  else if (change.pinned !== undefined) merged.pinned = change.pinned

  if (change.archived === null) delete merged.archived
  else if (change.archived !== undefined) merged.archived = change.archived

  if (merged.pinned === undefined && merged.archived === undefined) {
    delete nextPathMeta[key]
  } else {
    nextPathMeta[key] = merged
  }

  return nextPathMeta
}

export function archiveWorkspaceItemPathMeta(
  pathMeta: Record<string, WorkspacePathMeta> | undefined,
  relativePath: string
): Record<string, WorkspacePathMeta> {
  return mergeWorkspaceItemPathMeta(pathMeta, relativePath, { archived: true })
}

/**
 * Plans removal from a catalog-validated conversation markdown path. The shared
 * path helpers strictly parse the path before deriving any sibling paths, so a
 * malformed path (including one with traversal segments) cannot be used as a
 * deletion base.
 */
export function planTemporaryConversationDiskRemoval(
  appDataRoot: string,
  relativePath: string
): WorkspaceItemDiskRemovalPlan {
  return planAgentConversationDiskRemoval(appDataRoot, relativePath)
}

export function planWorkspaceItemDiskRemoval(
  rootPath: string,
  index: WorkspaceIndex,
  target: WorkspaceItemTarget
): WorkspaceItemDiskRemovalPlan {
  const relativePath = normalizeWorkspaceRelativePath(target.relativePath)
  const absolutePath = resolve(join(rootPath, relativePath))

  if (target.kind === 'directory') {
    return { files: [], directories: [absolutePath] }
  }

  if (target.kind === 'conversation') {
    return planAgentConversationDiskRemoval(rootPath, relativePath)
  }

  const files = [absolutePath]
  const lessonMatch = index.lessons.find(
    (lesson) => resolve(lesson.absolutePath).toLowerCase() === absolutePath.toLowerCase()
  )
  if (lessonMatch) {
    const dir = dirname(lessonMatch.absolutePath)
    const base = basename(lessonMatch.absolutePath).replace(/\.html$/i, '')
    for (const suffix of ['-reference.html', '.md', '-flashcards.json']) {
      files.push(join(dir, `${base}${suffix}`))
    }
  }

  return { files, directories: [] }
}

export function pruneWorkspaceIndexForItemRemoval(
  index: WorkspaceIndex,
  target: WorkspaceItemTarget
): Pick<WorkspaceIndex, 'lessons' | 'pathMeta'> {
  const relativePath = normalizeWorkspaceRelativePath(target.relativePath)
  const lessons = index.lessons.filter(
    (lesson) => !pathRemovedByWorkspaceItem(target.kind, relativePath, lesson.relativePath)
  )
  const pathMeta = pruneWorkspacePathMetaForItemRemoval(index.pathMeta, target)

  return { lessons, pathMeta }
}

export function pruneWorkspacePathMetaForItemRemoval(
  pathMeta: Record<string, WorkspacePathMeta> | undefined,
  target: WorkspaceItemTarget
): Record<string, WorkspacePathMeta> {
  const relativePath = normalizeWorkspaceRelativePath(target.relativePath)
  const prunedMeta = prunePathMeta(pathMeta, relativePath)
  return isWorkspaceScaffoldPath(target.kind, relativePath)
    ? { ...prunedMeta, [relativePath]: { archived: true } }
    : prunedMeta
}

function planAgentConversationDiskRemoval(
  rootPath: string,
  markdownRelativePath: string
): WorkspaceItemDiskRemovalPlan {
  const jsonRelativePath = agentConversationJsonRelativePathForMarkdown(markdownRelativePath)
  const auditRelativePath = agentConversationSessionAuditRelativePathForMarkdown(markdownRelativePath)
  const artifactDirectoryRelativePath = agentConversationSessionArtifactDirectoryRelativePathForMarkdown(markdownRelativePath)
  return {
    files: [
      join(rootPath, jsonRelativePath),
      join(rootPath, markdownRelativePath),
      join(rootPath, auditRelativePath)
    ],
    directories: [join(rootPath, artifactDirectoryRelativePath)]
  }
}
