/**
 * Strict envelope parsers for mind map teaching IPC (docs/mindmap/design.md §4.3).
 *
 * Each parser requires an exact key set, rejects extra keys, validates
 * `workspaceId` / `id` as non-empty strings, and returns `null` on any invalid
 * payload. The `doc` field of an update is validated with
 * `mindMapDocumentSchema.safeParse`.
 *
 * Kept in a dedicated module so `teaching-ipc-commands.ts` and
 * `teaching-ipc-gateway.ts` do not grow further (module-size policy ADR-0075).
 */
import { mindMapDocumentSchema } from '../../shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'
import type {
  MindMapAccessPayload,
  MindMapCreatePayload,
  MindMapExportPayload,
  MindMapGeneratePayload,
  MindMapImportPayload,
  MindMapListPayload,
  MindMapUpdatePayload
} from '../../shared/teaching-types/mindmap'

/** Non-empty string guard for workspace/identifier fields. */
function requireNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value
}

/** Exact all-or-nothing key set check; returns the record or null. */
function requireExactKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) return null
  return record
}

export function parseMindMapListPayload(value: unknown): MindMapListPayload | null {
  const record = requireExactKeys(value, ['workspaceId'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  if (!workspaceId) return null
  return { workspaceId }
}

export function parseMindMapCreatePayload(value: unknown): MindMapCreatePayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'title'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const title = requireNonEmptyString(record.title)
  if (!workspaceId || !title) return null
  return { workspaceId, title }
}

export function parseMindMapAccessPayload(value: unknown): MindMapAccessPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'id'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  if (!workspaceId || !id) return null
  return { workspaceId, id }
}

export function parseMindMapUpdatePayload(value: unknown): MindMapUpdatePayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'id', 'doc'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  if (!workspaceId || !id) return null
  const parsedDoc = mindMapDocumentSchema.safeParse(record.doc)
  if (!parsedDoc.success) return null
  return { workspaceId, id, doc: parsedDoc.data as MindMapDocument }
}

export function parseMindMapGeneratePayload(value: unknown): MindMapGeneratePayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'title', 'prompt'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const title = requireNonEmptyString(record.title)
  const prompt = requireNonEmptyString(record.prompt)
  if (!workspaceId || !title || !prompt) return null
  return { workspaceId, title, prompt }
}

export function parseMindMapImportPayload(value: unknown): MindMapImportPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'sourcePath'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const sourcePath = requireNonEmptyString(record.sourcePath)
  if (!workspaceId || !sourcePath) return null
  return { workspaceId, sourcePath }
}

export function parseMindMapExportPayload(value: unknown): MindMapExportPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'id', 'destinationDirectory'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const destinationDirectory = requireNonEmptyString(record.destinationDirectory)
  if (!workspaceId || !id || !destinationDirectory) return null
  return { workspaceId, id, destinationDirectory }
}