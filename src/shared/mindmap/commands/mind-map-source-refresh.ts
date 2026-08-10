/**
 * Build the reducer command for an explicitly confirmed source refresh.
 *
 * A source id can be attached to topics on multiple sheets (and more than one
 * topic on a sheet), so refresh writeback is deliberately one transaction over
 * every matching occurrence. The helper only changes `sourceRefs`; all topic,
 * sheet, element, and document metadata are preserved by the topic-update
 * patches and the reducer's inverse command.
 */
import type { MindMapSourceRef, MindMapDocumentV2, MindMapTopicV2 } from '../domain/types'
import { confirmMindMapSourceRefRefresh } from '../domain/source-anchors'
import type { MindMapCommand } from './mind-map-command-types'

export type MindMapSourceRefreshCommandUpdate = {
  sourceRef: MindMapSourceRef
}

export type MindMapSourceRefreshCommandBuildResult =
  | {
      ok: true
      command: MindMapCommand | null
      appliedSourceIds: string[]
    }
  | {
      ok: false
      code: 'source_unknown' | 'source_conflict'
      sourceId: string
    }

type Occurrence = {
  sheetId: string
  topicId: string
  sourceRef: MindMapSourceRef
}

/**
 * Build a source refresh transaction without mutating `document` or any
 * caller-owned source refs. `confirmedAt` is supplied by the main process so
 * renderer timestamps cannot become the confirmation authority.
 */
export function buildMindMapSourceRefreshCommand(
  document: MindMapDocumentV2,
  updates: readonly MindMapSourceRefreshCommandUpdate[],
  confirmedAt: string
): MindMapSourceRefreshCommandBuildResult {
  const occurrences = collectOccurrences(document)
  const bySourceId = new Map<string, Occurrence[]>()
  for (const occurrence of occurrences) {
    const list = bySourceId.get(occurrence.sourceRef.id) ?? []
    list.push(occurrence)
    bySourceId.set(occurrence.sourceRef.id, list)
  }

  const topicStates = collectTopicStates(document)
  const appliedSourceIds: string[] = []
  const seenUpdates = new Set<string>()

  for (const update of updates) {
    const sourceId = update.sourceRef.id
    if (seenUpdates.has(sourceId)) {
      return { ok: false, code: 'source_conflict', sourceId }
    }
    seenUpdates.add(sourceId)

    const sourceOccurrences = bySourceId.get(sourceId)
    if (!sourceOccurrences || sourceOccurrences.length === 0) {
      return { ok: false, code: 'source_unknown', sourceId }
    }
    if (hasConflictingMetadata(sourceOccurrences)) {
      return { ok: false, code: 'source_conflict', sourceId }
    }

    for (const occurrence of sourceOccurrences) {
      const key = topicKey(occurrence.sheetId, occurrence.topicId)
      const topic = topicStates.get(key)
      if (!topic) {
        return { ok: false, code: 'source_conflict', sourceId }
      }
      topic.sourceRefs = topic.sourceRefs.map((sourceRef) => sourceRef.id === sourceId
        ? confirmMindMapSourceRefRefresh(sourceRef, update.sourceRef, confirmedAt)
        : sourceRef)
    }
    appliedSourceIds.push(sourceId)
  }

  const commands: MindMapCommand[] = []
  for (const topic of topicStates.values()) {
    if (!topic.changed) continue
    commands.push({
      type: 'topic.update',
      sheetId: topic.sheetId,
      topicId: topic.topicId,
      patch: { sourceRefs: topic.sourceRefs }
    })
  }

  return {
    ok: true,
    command: commands.length === 0 ? null : { type: 'transaction', commands },
    appliedSourceIds
  }
}

function collectOccurrences(document: MindMapDocumentV2): Occurrence[] {
  const occurrences: Occurrence[] = []
  for (const sheet of document.sheets) {
    visitTopic(sheet.id, sheet.root, occurrences)
  }
  return occurrences
}

function visitTopic(sheetId: string, topic: MindMapTopicV2, occurrences: Occurrence[]): void {
  for (const sourceRef of topic.sourceRefs ?? []) {
    occurrences.push({ sheetId, topicId: topic.id, sourceRef })
  }
  for (const child of topic.children) visitTopic(sheetId, child, occurrences)
}

type TopicState = {
  sheetId: string
  topicId: string
  sourceRefs: MindMapSourceRef[]
  originalSourceRefs: string
  readonly changed: boolean
}

function collectTopicStates(document: MindMapDocumentV2): Map<string, TopicState> {
  const states = new Map<string, TopicState>()
  for (const sheet of document.sheets) {
    visitTopicState(sheet.id, sheet.root, states)
  }
  return states
}

function visitTopicState(
  sheetId: string,
  topic: MindMapTopicV2,
  states: Map<string, TopicState>
): void {
  const sourceRefs = (topic.sourceRefs ?? []).map((sourceRef) => ({
    ...sourceRef,
    ...(sourceRef.breadcrumb ? { breadcrumb: [...sourceRef.breadcrumb] } : {})
  }))
  states.set(topicKey(sheetId, topic.id), {
    sheetId,
    topicId: topic.id,
    sourceRefs,
    originalSourceRefs: JSON.stringify(sourceRefs),
    get changed() {
      return this.originalSourceRefs !== JSON.stringify(this.sourceRefs)
    }
  })
  for (const child of topic.children) visitTopicState(sheetId, child, states)
}

function topicKey(sheetId: string, topicId: string): string {
  return `${sheetId}\u0000${topicId}`
}

function hasConflictingMetadata(occurrences: readonly Occurrence[]): boolean {
  const first = occurrences[0]
  if (!first) return false
  const key = metadataKey(first.sourceRef)
  return occurrences.some((occurrence) => metadataKey(occurrence.sourceRef) !== key)
}

function metadataKey(sourceRef: MindMapSourceRef): string {
  return JSON.stringify({
    // Preview canonicalizes slash direction and a leading `./` before it
    // groups occurrences. Apply must use the same equivalence relation or a
    // portable document can become an avoidable source_conflict at writeback.
    workspacePath: normalizeWorkspacePathKey(sourceRef.workspacePath),
    breadcrumb: sourceRef.breadcrumb,
    blockId: sourceRef.blockId,
    contentHash: sourceRef.contentHash,
    lastConfirmedAt: sourceRef.lastConfirmedAt,
    stale: sourceRef.stale
  })
}

function normalizeWorkspacePathKey(path: string | undefined): string | undefined {
  if (path === undefined) return undefined
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
  return normalized || undefined
}
