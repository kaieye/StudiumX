/** Shared pure import boundary for text-based mind-map formats. */
import {
  DEFAULT_MIND_MAP_STRUCTURE_CLASS,
  type MindMapStructureClass
} from './mind-map-types'
import { validateMindMapDocumentV2 } from './domain/invariants'
import {
  DEFAULT_MIND_MAP_THEME,
  type MindMapDocumentV2,
  type MindMapSheetV2
} from './domain/types'

/** Inputs that keep imported document metadata deterministic in tests/callers. */
export type MindMapImportOptions = {
  documentId?: string
  /** Defaults to a deterministic epoch timestamp; callers may inject current time. */
  nowIso?: string
  structureClass?: MindMapStructureClass
}

export type MindMapImportErrorCode =
  | 'EMPTY_INPUT'
  | 'INVALID_FORMAT'
  | 'INVALID_STRUCTURE'
  | 'DUPLICATE_ID'
  | 'UNSUPPORTED_FEATURE'

export type MindMapImportError = {
  code: MindMapImportErrorCode
  message: string
  line?: number
  path?: string
}

export type MindMapImportResult =
  | { ok: true; document: MindMapDocumentV2 }
  | { ok: false; error: MindMapImportError }

export const DEFAULT_MIND_MAP_IMPORT_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export function importFailure(
  code: MindMapImportErrorCode,
  message: string,
  details: Pick<MindMapImportError, 'line' | 'path'> = {}
): { ok: false; error: MindMapImportError } {
  return { ok: false, error: { code, message, ...details } }
}

/** Build and invariant-check a tree-only imported v2 document. */
export function buildImportedMindMapDocument(
  title: string,
  sheets: readonly MindMapSheetV2[],
  options: MindMapImportOptions = {}
): MindMapImportResult {
  const document: MindMapDocumentV2 = {
    schemaVersion: 2,
    id: options.documentId ?? 'imported-mind-map',
    revision: 1,
    title,
    createdAt: options.nowIso ?? DEFAULT_MIND_MAP_IMPORT_TIMESTAMP,
    updatedAt: options.nowIso ?? DEFAULT_MIND_MAP_IMPORT_TIMESTAMP,
    theme: DEFAULT_MIND_MAP_THEME,
    sheets: [...sheets],
    assets: []
  }

  const validation = validateMindMapDocumentV2(document)
  if (!validation.ok) {
    return importFailure(
      'INVALID_STRUCTURE',
      `Imported document violates mind-map invariants: ${validation.errors
        .map((error) => error.message)
        .join('; ')}`
    )
  }
  return { ok: true, document }
}

export function isNonEmptyImportId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function defaultImportStructureClass(
  options: MindMapImportOptions
): MindMapStructureClass {
  return options.structureClass ?? DEFAULT_MIND_MAP_STRUCTURE_CLASS
}
