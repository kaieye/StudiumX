import type { MindMapSourceJumpTarget } from '../../../shared/mindmap/domain/source-jump'
import { buildMindMapSourceJumpTarget } from '../../../shared/mindmap/domain/source-jump'
import type { MindMapSourceRef } from '../../../shared/mindmap/domain/types'
import type {
  TeachingWorkspaceSummary,
  WorkspaceFileNode
} from '../../../shared/teaching-types'
import {
  lessonToCoursePreviewFile,
  type CoursePreviewFile
} from './contextTransitions'
import type { LearningAssetReader } from './learning-asset-reader'

/**
 * The source-jump seam deliberately stops at a file-level reader action.
 * `blockId` is retained in the result for a future renderer-level scroll, but
 * this adapter never attempts to interpret or navigate to a block.
 */
export type MindMapSourceJumpOpenResult =
  | {
      ok: true
      kind: MindMapSourceJumpTarget['kind']
      relativePath: string
      blockId?: string
    }
  | {
      ok: false
      reason: 'invalid_target' | 'source_not_indexed'
      target: MindMapSourceJumpTarget
    }

export type MindMapSourceJumpAdapter = {
  open(input: {
    sourceRef: MindMapSourceRef
    workspace: TeachingWorkspaceSummary
  }): Promise<MindMapSourceJumpOpenResult>
}

/**
 * Adapt a persisted source reference to the existing LearningAssetReader.
 *
 * The adapter does not create absolute paths from source-ref metadata. It only
 * opens a file whose relative path and absolute path are already present in
 * the registered workspace catalog. The reader then sends the workspace id and
 * relative path through the existing guarded TeachingSystemApi IPC methods.
 */
export function createMindMapSourceJumpAdapter(input: {
  reader: Pick<LearningAssetReader, 'openHtmlPreview' | 'openMarkdownDocument'>
}): MindMapSourceJumpAdapter {
  return {
    open: async ({ sourceRef, workspace }) => {
      const target = buildMindMapSourceJumpTarget(sourceRef, workspace.id)
      if (!target.canResolve || !target.readerPayload) {
        return { ok: false, reason: 'invalid_target', target }
      }

      const file = findCanonicalWorkspaceFile(workspace, target)
      if (!file) {
        return { ok: false, reason: 'source_not_indexed', target }
      }

      if (target.kind === 'lesson') {
        await input.reader.openHtmlPreview({ workspace, file })
      } else {
        await input.reader.openMarkdownDocument({ workspace, file })
      }

      return {
        ok: true,
        kind: target.kind,
        relativePath: file.relativePath,
        ...(target.blockId === undefined ? {} : { blockId: target.blockId })
      }
    }
  }
}

/**
 * Resolve only catalog-owned file metadata. This keeps the renderer from
 * turning a user-controlled source ref into an arbitrary absolute path.
 */
export function findCanonicalWorkspaceFile(
  workspace: TeachingWorkspaceSummary,
  target: MindMapSourceJumpTarget
): CoursePreviewFile | null {
  const locator = target.locator
  if (!locator) return null
  if (target.kind !== 'lesson' && !isMarkdownPath(locator)) return null

  if (target.kind === 'lesson') {
    const lesson = workspace.lessons.find(
      (candidate) => sameWorkspacePath(candidate.relativePath, locator)
    )
    if (lesson) return lessonToCoursePreviewFile(lesson)
  }

  const node = findWorkspaceFileNode(workspace.fileTree, locator)
  if (!node) return null
  return {
    title: node.name || basename(node.relativePath),
    relativePath: node.relativePath,
    absolutePath: node.absolutePath
  }
}

function findWorkspaceFileNode(
  nodes: readonly WorkspaceFileNode[],
  relativePath: string
): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (node.kind === 'file' && sameWorkspacePath(node.relativePath, relativePath)) {
      return node
    }
    if (node.kind === 'directory') {
      const child = findWorkspaceFileNode(node.children ?? [], relativePath)
      if (child) return child
    }
  }
  return null
}

function sameWorkspacePath(left: string, right: string): boolean {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right)
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

function isMarkdownPath(value: string): boolean {
  return /\.(?:md|markdown)$/i.test(value)
}

function basename(value: string): string {
  return value.split('/').filter(Boolean).at(-1) ?? value
}
