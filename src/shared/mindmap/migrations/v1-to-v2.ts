/**
 * v1 → v2 mind map document migration.
 *
 * Deterministic and idempotent: applying the migration to an already-migrated
 * v2 document returns the validated document unchanged. On failure it returns
 * a structured error and never mutates the input object, so the caller can
 * keep the original file intact.
 *
 * The migration preserves v1 title/note/collapsed/tree structure and all
 * sheets. StudiumX `structureClass` values are carried over into the sheet's
 * layout and, for per-node overrides, into the topic style bag.
 */
import { mindMapDocumentSchema } from '../mind-map-schema'
import {
  DEFAULT_MIND_MAP_THEME,
  MIND_MAP_DOCUMENT_SCHEMA_VERSION_V2
} from '../domain/types'
import type {
  MindMapDocumentV2,
  MindMapRelationship as MindMapRelationshipV2,
  MindMapSheetV2,
  MindMapTopicV2
} from '../domain/types'
import { mindMapDocumentV2Schema } from '../domain/schema'
import type {
  MindMapNode,
  MindMapRelationship as MindMapRelationshipV1,
  MindMapStructureClass
} from '../mind-map-types'

export type MindMapMigrationErrorCode =
  | 'NOT_A_DOCUMENT'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_V1_DOCUMENT'
  | 'INVALID_V2_DOCUMENT'

export type MindMapMigrationError = {
  code: MindMapMigrationErrorCode
  message: string
  detail?: unknown
}

export type MindMapMigrationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MindMapMigrationError }

type UnknownRecord = Record<string, unknown>

type LegacyConnectorTarget = {
  targetType: 'topic' | 'shape'
  targetId: string
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectRawTopicIds(root: unknown): Set<string> {
  const ids = new Set<string>()
  const visited = new Set<UnknownRecord>()
  const stack: unknown[] = [root]

  while (stack.length > 0) {
    const topic = stack.pop()
    if (!isRecord(topic) || visited.has(topic)) continue
    visited.add(topic)

    if (typeof topic.id === 'string' && topic.id.length > 0) {
      ids.add(topic.id)
    }
    if (Array.isArray(topic.children)) {
      stack.push(...topic.children)
    }
  }

  return ids
}

function connectorTarget(
  endpoint: unknown,
  topicIds: ReadonlySet<string>,
  shapeIds: ReadonlySet<string>
): LegacyConnectorTarget | null {
  if (!isRecord(endpoint) || !isRecord(endpoint.anchor)) return null

  const { targetType, targetId } = endpoint.anchor
  if (
    (targetType !== 'topic' && targetType !== 'shape')
    || typeof targetId !== 'string'
    || targetId.length === 0
  ) {
    return null
  }

  const targetExists = targetType === 'topic'
    ? topicIds.has(targetId)
    : shapeIds.has(targetId)
  return targetExists ? { targetType, targetId } : null
}

/**
 * Remove connectors emitted by earlier v2 canvas builds before endpoints became
 * mandatory bindings. This is deliberately narrow: malformed topics, shapes,
 * styles, and all non-connector elements still reach the regular schema and
 * invariant validation paths unchanged.
 */
function removeLegacyInvalidConnectors(input: UnknownRecord): unknown {
  if (!Array.isArray(input.sheets)) return input

  let changed = false
  const sheets = input.sheets.map((rawSheet) => {
    if (!isRecord(rawSheet) || !Array.isArray(rawSheet.elements)) return rawSheet

    const topicIds = collectRawTopicIds(rawSheet.root)
    const shapeIds = new Set(
      rawSheet.elements.flatMap((element) => (
        isRecord(element)
        && element.type === 'shape'
        && typeof element.id === 'string'
        && element.id.length > 0
          ? [element.id]
          : []
      ))
    )
    const elements = rawSheet.elements.filter((element) => {
      if (!isRecord(element) || element.type !== 'connector') return true

      const start = connectorTarget(element.start, topicIds, shapeIds)
      const end = connectorTarget(element.end, topicIds, shapeIds)
      return (
        start !== null
        && end !== null
        && (start.targetType !== end.targetType || start.targetId !== end.targetId)
      )
    })

    if (elements.length === rawSheet.elements.length) return rawSheet
    changed = true
    return { ...rawSheet, elements }
  })

  return changed ? { ...input, sheets } : input
}

function mapTopic(topic: MindMapNode): MindMapTopicV2 {
  return {
    id: topic.id,
    title: topic.title,
    ...(topic.note !== undefined ? { note: topic.note } : {}),
    ...(topic.collapsed !== undefined ? { collapsed: topic.collapsed } : {}),
    children: topic.children.map(mapTopic),
    ...(topic.assetIds !== undefined ? { assetIds: [...topic.assetIds] } : {}),
    ...(topic.structureClass !== undefined
      ? { style: { structureClass: topic.structureClass } }
      : {}),
    ...(topic.numbering !== undefined ? { numbering: { ...topic.numbering } } : {})
  }
}

function mapRelationship(relationship: MindMapRelationshipV1): MindMapRelationshipV2 {
  return {
    id: relationship.id,
    type: 'relationship',
    from: relationship.from,
    to: relationship.to,
    ...(relationship.label !== undefined ? { label: relationship.label } : {})
  }
}

function mapSheet(v1Sheet: {
  id: string
  title: string
  structureClass: MindMapStructureClass
  root: MindMapNode
  relationships?: MindMapRelationshipV1[]
}): MindMapSheetV2 {
  return {
    id: v1Sheet.id,
    title: v1Sheet.title,
    root: mapTopic(v1Sheet.root),
    elements: (v1Sheet.relationships ?? []).map(mapRelationship),
    images: [],
    layout: { structureClass: v1Sheet.structureClass }
  }
}

/**
 * Migrate an unknown payload to a v2 document.
 *
 * - schemaVersion 1: structural v1 → v2 migration.
 * - schemaVersion 2: validates and returns the document unchanged (idempotent).
 * - anything else: structured unsupported-version error.
 *
 * The input is never mutated.
 */
export function migrateV1ToV2(input: unknown): MindMapMigrationResult<MindMapDocumentV2> {
  if (typeof input !== 'object' || input === null) {
    return {
      ok: false,
      error: {
        code: 'NOT_A_DOCUMENT',
        message: 'Expected a mind map document object'
      }
    }
  }

  const candidate = input as { schemaVersion?: unknown }
  if (candidate.schemaVersion === MIND_MAP_DOCUMENT_SCHEMA_VERSION_V2) {
    const parsed = mindMapDocumentV2Schema.safeParse(removeLegacyInvalidConnectors(candidate))
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'INVALID_V2_DOCUMENT',
          message: 'Input claims schemaVersion 2 but is not a valid v2 document',
          detail: parsed.error
        }
      }
    }
    return { ok: true, value: parsed.data }
  }

  if (typeof candidate.schemaVersion !== 'number' || candidate.schemaVersion !== 1) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        message:
          typeof candidate.schemaVersion === 'number'
            ? `Unsupported schema version: ${candidate.schemaVersion}`
            : 'Missing or invalid schemaVersion'
      }
    }
  }

  const parsedV1 = mindMapDocumentSchema.safeParse(input)
  if (!parsedV1.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_V1_DOCUMENT',
        message: 'Input is not a valid v1 mind map document',
        detail: parsedV1.error
      }
    }
  }

  const v1 = parsedV1.data
  const migrated: MindMapDocumentV2 = {
    schemaVersion: MIND_MAP_DOCUMENT_SCHEMA_VERSION_V2,
    id: v1.id,
    revision: 1,
    title: v1.title,
    createdAt: v1.createdAt,
    updatedAt: v1.updatedAt,
    theme: DEFAULT_MIND_MAP_THEME,
    sheets: v1.sheets.map(mapSheet),
    assets: [],
    interop: { migratedFrom: { schemaVersion: 1 } }
  }

  return { ok: true, value: migrated }
}
