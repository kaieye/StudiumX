import type { MindMapSourceRef, MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'

export type MindMapSourceOccurrence = {
  sourceRef: MindMapSourceRef
  nodeIds: string[]
  nodeTitles: string[]
}

/**
 * Collect source anchors from the current in-memory topic tree.
 *
 * This is deliberately a tree scan rather than a product search index. A
 * source anchor can be attached to several topics, so repeated references are
 * grouped while preserving first-seen (preorder) order for the panel.
 */
export function collectMindMapSources(root: MindMapTopicV2): MindMapSourceOccurrence[] {
  const occurrences = new Map<string, MindMapSourceOccurrence>()

  visit(root, occurrences)
  return [...occurrences.values()]
}

export function mindMapSourceDisplayName(sourceRef: MindMapSourceRef, untitledLabel: string): string {
  const breadcrumb = sourceRef.breadcrumb
    ?.map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (breadcrumb && breadcrumb.length > 0) return breadcrumb.join(' / ')

  const path = sourceRef.workspacePath?.replace(/\\/g, '/').split('/').filter(Boolean)
  if (path && path.length > 0) return path[path.length - 1] ?? untitledLabel

  return sourceRef.id || untitledLabel
}

export function mindMapSourceLocation(sourceRef: MindMapSourceRef): string | null {
  const path = sourceRef.workspacePath?.replace(/\\/g, '/').replace(/^\.\//, '')
  return path && path.length > 0 ? path : null
}

function visit(
  node: MindMapTopicV2,
  occurrences: Map<string, MindMapSourceOccurrence>
): void {
  for (const sourceRef of node.sourceRefs ?? []) {
    const existing = occurrences.get(sourceRef.id)
    if (existing) {
      if (!existing.nodeIds.includes(node.id)) {
        existing.nodeIds.push(node.id)
        existing.nodeTitles.push(node.title)
      }
      if (sourceRef.stale === true && existing.sourceRef.stale !== true) {
        existing.sourceRef = { ...existing.sourceRef, stale: true }
      }
    } else {
      occurrences.set(sourceRef.id, {
        sourceRef: {
          ...sourceRef,
          breadcrumb: sourceRef.breadcrumb ? [...sourceRef.breadcrumb] : undefined
        },
        nodeIds: [node.id],
        nodeTitles: [node.title]
      })
    }
  }

  for (const child of node.children) visit(child, occurrences)
}
