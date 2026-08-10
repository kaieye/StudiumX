/**
 * Pure M5 request boundary for selecting the context a provider may inspect.
 *
 * This module deliberately stops before provider/IPC/UI code. It turns a
 * current sheet, optional selection and optional source refs into a strict,
 * canonical request. Every id is checked against the document before it can
 * cross the boundary, and ambiguous/duplicated source anchors fail closed.
 */
import { z } from 'zod'

import { mindMapSourceRefSchema } from '../domain/schema'
import { collectTopicIds, validateMindMapDocumentV2 } from '../domain/invariants'
import type {
  MindMapDocumentV2,
  MindMapSourceRef,
  MindMapTopicV2
} from '../domain/types'
import {
  MIND_MAP_PROPOSAL_SCOPES,
  type MindMapProposalScope
} from './mind-map-proposal'

const nonEmptyIdSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'must not be empty'
})
const strictSourceRefSchema = mindMapSourceRefSchema.strict()

/** Canonical context sent to a provider request adapter. */
export type MindMapProposalRequest = {
  schemaVersion: 1
  scope: MindMapProposalScope
  documentId: string
  sheetId: string
  /** Empty except when the caller explicitly selected one or more topics. */
  selectedTopicIds: string[]
  /** Canonical refs copied from the current document, never caller metadata. */
  sourceRefs: MindMapSourceRef[]
  /**
   * Ephemeral source metadata for `selected-file` scope. The file body is
   * deliberately not part of this request and remains main-process/provider
   * context only.
   */
  selectedFile?: MindMapSourceRef
  /**
   * Ephemeral source metadata for the fixed workspace `NOTES.md` scope. The
   * note body is deliberately not part of this request and remains
   * main-process/provider context only.
   */
  notes?: MindMapSourceRef
  /** Ephemeral source metadata for one canonical generated Lesson artifact. */
  lesson?: MindMapSourceRef
}

/** Runtime-friendly input for the pure request builder. */
export type MindMapProposalRequestInput = {
  document: MindMapDocumentV2
  scope: unknown
  sheetId: unknown
  selectedTopicIds?: readonly unknown[]
  sourceRefs?: readonly unknown[]
  /** Main-process canonical ref produced by the bounded selected-file reader. */
  selectedFileRef?: MindMapSourceRef
  /** Main-process canonical ref produced by the bounded `NOTES.md` reader. */
  notesRef?: MindMapSourceRef
  /** Main-process canonical ref produced by the bounded Lesson reader. */
  lessonRef?: MindMapSourceRef
}

export type MindMapProposalRequestErrorCode =
  | 'invalid_document'
  | 'invalid_scope'
  | 'invalid_sheet'
  | 'sheet_not_found'
  | 'invalid_selection'
  | 'duplicate_id'
  | 'topic_out_of_scope'
  | 'invalid_source_refs'
  | 'source_out_of_scope'
  | 'empty_scope'

export type MindMapProposalRequestResult =
  | { ok: true; request: MindMapProposalRequest }
  | {
      ok: false
      code: MindMapProposalRequestErrorCode
      message: string
    }

/** Strict schema for the provider request envelope. */
export const mindMapProposalRequestSchema: z.ZodType<
  MindMapProposalRequest,
  z.ZodTypeDef,
  unknown
> = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.enum(MIND_MAP_PROPOSAL_SCOPES),
    documentId: nonEmptyIdSchema,
    sheetId: nonEmptyIdSchema,
    selectedTopicIds: z.array(nonEmptyIdSchema),
    sourceRefs: z.array(strictSourceRefSchema),
    selectedFile: strictSourceRefSchema.optional(),
    notes: strictSourceRefSchema.optional(),
    lesson: strictSourceRefSchema.optional()
  })
  .strict()
  .superRefine((request, ctx) => {
    if (request.scope === 'selection' && request.selectedTopicIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedTopicIds'],
        message: 'selection scope requires at least one selected topic'
      })
    }
    if (request.scope === 'source' && request.sourceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceRefs'],
        message: 'source scope requires at least one source ref'
      })
    }
    if (request.scope === 'selected-file') {
      if (request.selectedTopicIds.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selectedTopicIds'],
          message: 'selected-file scope does not accept selected topics'
        })
      }
      if (request.sourceRefs.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceRefs'],
          message: 'selected-file scope does not accept document source refs'
        })
      }
      if (request.selectedFile === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selectedFile'],
          message: 'selected-file scope requires selected file metadata'
        })
      }
      if (request.notes !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes'],
          message: 'notes metadata is only valid for notes scope'
        })
      }
    } else if (request.selectedFile !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedFile'],
        message: 'selectedFile metadata is only valid for selected-file scope'
      })
    }

    if (request.scope === 'notes') {
      if (request.selectedTopicIds.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selectedTopicIds'],
          message: 'notes scope does not accept selected topics'
        })
      }
      if (request.sourceRefs.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceRefs'],
          message: 'notes scope does not accept document source refs'
        })
      }
      if (request.notes === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes'],
          message: 'notes scope requires NOTES.md metadata'
        })
      }
      if (request.selectedFile !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selectedFile'],
          message: 'selectedFile metadata is only valid for selected-file scope'
        })
      }
    } else if (request.notes !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notes'],
        message: 'notes metadata is only valid for notes scope'
      })
    }

    if (request.scope === 'lesson') {
      if (request.selectedTopicIds.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selectedTopicIds'],
          message: 'lesson scope does not accept selected topics'
        })
      }
      if (request.sourceRefs.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceRefs'],
          message: 'lesson scope does not accept document source refs'
        })
      }
      if (request.lesson === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lesson'],
          message: 'lesson scope requires Lesson metadata'
        })
      } else if (!isCanonicalLessonRef(request.lesson)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lesson'],
          message: 'lesson metadata must be canonical generated Lesson metadata'
        })
      }
      if (request.selectedFile !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selectedFile'],
          message: 'selectedFile metadata is not valid for lesson scope'
        })
      }
      if (request.notes !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes'],
          message: 'notes metadata is not valid for lesson scope'
        })
      }
    } else if (request.lesson !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lesson'],
        message: 'lesson metadata is only valid for lesson scope'
      })
    }

    const topicIds = new Set<string>()
    request.selectedTopicIds.forEach((id, index) => {
      if (topicIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selectedTopicIds', index],
          message: `duplicate selected topic id "${id}"`
        })
      }
      topicIds.add(id)
    })

    const sourceIds = new Set<string>()
    request.sourceRefs.forEach((ref, index) => {
      if (sourceIds.has(ref.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceRefs', index, 'id'],
          message: `duplicate source ref id "${ref.id}"`
        })
      }
      sourceIds.add(ref.id)
    })
  })

const proposalScopes = new Set<string>(MIND_MAP_PROPOSAL_SCOPES)

function isSafeSelectedFileRef(sourceRef: MindMapSourceRef): boolean {
  if (sourceRef.workspacePath === undefined) return false
  const normalized = sourceRef.workspacePath.trim().replace(/\\/g, '/')
  if (
    normalized.length === 0 ||
    normalized.includes('\u0000') ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return false
  }
  const parts = normalized.split('/').filter((part) => part !== '' && part !== '.')
  return parts.length > 0 && !parts.some((part) => part === '..')
}

function isCanonicalNotesRef(sourceRef: MindMapSourceRef): boolean {
  return (
    sourceRef.id.startsWith('notes:') &&
    sourceRef.workspacePath === 'NOTES.md' &&
    typeof sourceRef.contentHash === 'string' &&
    sourceRef.contentHash.trim().length > 0
  )
}

function normalizeLessonWorkspacePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, '/')
  if (
    trimmed.length === 0 ||
    trimmed.includes('\u0000') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    /^[A-Za-z]:/.test(trimmed)
  ) return null
  const parts = trimmed.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.some((part) => part === '..')) return null
  const normalized = parts.join('/')
  const namedCourse = parts.length >= 4 && parts[0] === 'courses' && parts[2] === 'lesson'
  const defaultCourse = parts.length >= 2 && parts[0] === 'lessons'
  const leaf = parts[parts.length - 1] ?? ''
  if ((!namedCourse && !defaultCourse) || !/\.html?$/i.test(leaf)) return null
  if (/(?:^|[-_])(assessment|reference|flashcards?)(?:[-_.]|$)/i.test(leaf)) return null
  return normalized
}

function isCanonicalLessonRef(sourceRef: MindMapSourceRef): boolean {
  if (!sourceRef.id.startsWith('lesson:')) return false
  if (typeof sourceRef.workspacePath !== 'string') return false
  const normalizedPath = normalizeLessonWorkspacePath(sourceRef.workspacePath)
  return (
    normalizedPath === sourceRef.workspacePath &&
    typeof sourceRef.contentHash === 'string' &&
    sourceRef.contentHash.trim().length > 0
  )
}

function failure(
  code: MindMapProposalRequestErrorCode,
  message: string
): MindMapProposalRequestResult {
  return { ok: false, code, message }
}

function parseIdList(
  value: readonly unknown[] | undefined,
  field: 'selectedTopicIds'
): { ok: true; ids: string[] } | { ok: false; result: MindMapProposalRequestResult } {
  if (value === undefined) return { ok: true, ids: [] }
  if (!Array.isArray(value)) {
    return {
      ok: false,
      result: failure('invalid_selection', `${field} must be an array`)
    }
  }

  const ids: string[] = []
  const seen = new Set<string>()
  for (const [index, candidate] of value.entries()) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      return {
        ok: false,
        result: failure('invalid_selection', `${field}[${index}] must be a non-empty id`)
      }
    }
    if (seen.has(candidate)) {
      return {
        ok: false,
        result: failure('duplicate_id', `duplicate selected topic id "${candidate}"`)
      }
    }
    seen.add(candidate)
    ids.push(candidate)
  }
  return { ok: true, ids }
}

function sourceRefEquals(left: MindMapSourceRef, right: MindMapSourceRef): boolean {
  if (left.id !== right.id) return false
  if (left.workspacePath !== right.workspacePath) return false
  if (left.blockId !== right.blockId) return false
  if (left.contentHash !== right.contentHash) return false
  if (left.lastConfirmedAt !== right.lastConfirmedAt) return false
  if (left.stale !== right.stale) return false
  const leftBreadcrumb = left.breadcrumb
  const rightBreadcrumb = right.breadcrumb
  if (leftBreadcrumb === undefined || rightBreadcrumb === undefined) {
    return leftBreadcrumb === rightBreadcrumb
  }
  return (
    leftBreadcrumb.length === rightBreadcrumb.length &&
    leftBreadcrumb.every((part, index) => part === rightBreadcrumb[index])
  )
}

type SourceCatalogEntry = {
  ref: MindMapSourceRef
  topicIds: Set<string>
}

function collectSourceCatalog(
  root: MindMapTopicV2,
  catalog: Map<string, SourceCatalogEntry>
): MindMapProposalRequestResult | null {
  const visit = (topic: MindMapTopicV2): MindMapProposalRequestResult | null => {
    for (const ref of topic.sourceRefs ?? []) {
      const parsed = strictSourceRefSchema.safeParse(ref)
      if (!parsed.success) {
        return failure(
          'invalid_document',
          'the current document contains an invalid source ref'
        )
      }
      const existing = catalog.get(parsed.data.id)
      if (existing !== undefined) {
        return failure(
          'duplicate_id',
          `source ref id "${parsed.data.id}" is ambiguous in the current sheet`
        )
      }
      catalog.set(parsed.data.id, { ref: parsed.data, topicIds: new Set([topic.id]) })
    }
    for (const child of topic.children) {
      const result = visit(child)
      if (result !== null) return result
    }
    return null
  }

  return visit(root)
}

function collectSubtreeSourceIds(
  topic: MindMapTopicV2,
  catalog: ReadonlyMap<string, SourceCatalogEntry>,
  result: Set<string>
): void {
  for (const ref of topic.sourceRefs ?? []) {
    if (catalog.has(ref.id)) result.add(ref.id)
  }
  for (const child of topic.children) {
    collectSubtreeSourceIds(child, catalog, result)
  }
}

/**
 * Build a canonical, scope-checked request without contacting a provider.
 *
 * `selection` requires at least one topic; `source` requires at least one
 * source ref. A source ref must be attached to the target sheet, and for a
 * selection request it must be attached below one of the selected topics.
 * Caller-supplied ref metadata must match the current document exactly so an
 * untrusted adapter cannot rewrite a path or block id while retaining an id.
 */
export function buildMindMapProposalRequest(
  input: MindMapProposalRequestInput
): MindMapProposalRequestResult {
  let documentValidation: ReturnType<typeof validateMindMapDocumentV2>
  try {
    documentValidation = validateMindMapDocumentV2(input.document)
  } catch {
    return failure('invalid_document', 'current mind-map document is invalid')
  }
  if (!documentValidation.ok) {
    return failure('invalid_document', 'current mind-map document is invalid')
  }

  if (typeof input.scope !== 'string' || !proposalScopes.has(input.scope)) {
    return failure('invalid_scope', 'proposal scope must be selection, sheet, source, selected-file, notes, or lesson')
  }
  const scope = input.scope as MindMapProposalScope

  if (typeof input.sheetId !== 'string' || input.sheetId.trim().length === 0) {
    return failure('invalid_sheet', 'proposal request requires a non-empty sheet id')
  }
  const sheet = input.document.sheets.find((candidate) => candidate.id === input.sheetId)
  if (sheet === undefined) {
    return failure('sheet_not_found', `sheet "${input.sheetId}" is not part of the document`)
  }

  const selection = parseIdList(input.selectedTopicIds, 'selectedTopicIds')
  if (!selection.ok) return selection.result

  const topicIds = new Set(collectTopicIds(sheet))
  for (const topicId of selection.ids) {
    if (!topicIds.has(topicId)) {
      return failure(
        'topic_out_of_scope',
        `selected topic "${topicId}" is not part of sheet "${sheet.id}"`
      )
    }
  }

  const sourceRefs: MindMapSourceRef[] = []
  const sourceIds = new Set<string>()
  if (input.sourceRefs !== undefined) {
    if (!Array.isArray(input.sourceRefs)) {
      return failure('invalid_source_refs', 'sourceRefs must be an array')
    }
    for (const [index, candidate] of input.sourceRefs.entries()) {
      const parsed = strictSourceRefSchema.safeParse(candidate)
      if (!parsed.success) {
        return failure('invalid_source_refs', `sourceRefs[${index}] failed schema validation`)
      }
      if (sourceIds.has(parsed.data.id)) {
        return failure('duplicate_id', `duplicate source ref id "${parsed.data.id}"`)
      }
      sourceIds.add(parsed.data.id)
      sourceRefs.push(parsed.data)
    }
  }

  if (input.scope !== 'selected-file' && input.selectedFileRef !== undefined) {
    return failure(
      'source_out_of_scope',
      'selected file metadata is only valid for selected-file scope'
    )
  }
  if (input.scope !== 'notes' && input.notesRef !== undefined) {
    return failure(
      'source_out_of_scope',
      'notes metadata is only valid for notes scope'
    )
  }
  if (input.scope !== 'lesson' && input.lessonRef !== undefined) {
    return failure(
      'source_out_of_scope',
      'Lesson metadata is only valid for lesson scope'
    )
  }
  if (input.scope === 'lesson') {
    if (selection.ids.length !== 0) {
      return failure('invalid_selection', 'lesson scope does not accept selected topics')
    }
    if (sourceRefs.length !== 0) {
      return failure('source_out_of_scope', 'lesson scope does not accept document source refs')
    }
    if (input.selectedFileRef !== undefined || input.notesRef !== undefined) {
      return failure('source_out_of_scope', 'lesson scope accepts only Lesson metadata')
    }
    const lesson = strictSourceRefSchema.safeParse(input.lessonRef)
    if (!lesson.success || !isCanonicalLessonRef(lesson.data)) {
      return failure('invalid_source_refs', 'lesson scope requires canonical Lesson metadata')
    }
    const request: MindMapProposalRequest = {
      schemaVersion: 1,
      scope,
      documentId: input.document.id,
      sheetId: sheet.id,
      selectedTopicIds: [],
      sourceRefs: [],
      lesson: {
        ...lesson.data,
        ...(lesson.data.breadcrumb ? { breadcrumb: [...lesson.data.breadcrumb] } : {})
      }
    }
    const parsed = mindMapProposalRequestSchema.safeParse(request)
    if (!parsed.success) {
      return failure('invalid_source_refs', 'built proposal request failed schema validation')
    }
    return { ok: true, request: parsed.data }
  }
  if (input.scope === 'selected-file') {
    if (selection.ids.length !== 0) {
      return failure('invalid_selection', 'selected-file scope does not accept selected topics')
    }
    if (sourceRefs.length !== 0) {
      return failure('source_out_of_scope', 'selected-file scope does not accept document source refs')
    }
    const selectedFile = strictSourceRefSchema.safeParse(input.selectedFileRef)
    if (!selectedFile.success || !isSafeSelectedFileRef(selectedFile.data)) {
      return failure('invalid_source_refs', 'selected-file scope requires canonical file metadata')
    }
    const request: MindMapProposalRequest = {
      schemaVersion: 1,
      scope,
      documentId: input.document.id,
      sheetId: sheet.id,
      selectedTopicIds: [],
      sourceRefs: [],
      selectedFile: {
        ...selectedFile.data,
        ...(selectedFile.data.breadcrumb
          ? { breadcrumb: [...selectedFile.data.breadcrumb] }
          : {})
      }
    }
    const parsed = mindMapProposalRequestSchema.safeParse(request)
    if (!parsed.success) {
      return failure('invalid_source_refs', 'built proposal request failed schema validation')
    }
    return { ok: true, request: parsed.data }
  }

  if (input.scope === 'notes') {
    if (selection.ids.length !== 0) {
      return failure('invalid_selection', 'notes scope does not accept selected topics')
    }
    if (sourceRefs.length !== 0) {
      return failure('source_out_of_scope', 'notes scope does not accept document source refs')
    }
    if (input.selectedFileRef !== undefined) {
      return failure('source_out_of_scope', 'selected file metadata is only valid for selected-file scope')
    }
    const notes = strictSourceRefSchema.safeParse(input.notesRef)
    if (!notes.success || !isCanonicalNotesRef(notes.data)) {
      return failure('invalid_source_refs', 'notes scope requires canonical NOTES.md metadata')
    }
    const request: MindMapProposalRequest = {
      schemaVersion: 1,
      scope,
      documentId: input.document.id,
      sheetId: sheet.id,
      selectedTopicIds: [],
      sourceRefs: [],
      notes: {
        ...notes.data,
        ...(notes.data.breadcrumb ? { breadcrumb: [...notes.data.breadcrumb] } : {})
      }
    }
    const parsed = mindMapProposalRequestSchema.safeParse(request)
    if (!parsed.success) {
      return failure('invalid_source_refs', 'built proposal request failed schema validation')
    }
    return { ok: true, request: parsed.data }
  }

  const sourceCatalog = new Map<string, SourceCatalogEntry>()
  const catalogError = collectSourceCatalog(sheet.root, sourceCatalog)
  if (catalogError !== null) return catalogError

  const selectedSourceIds = new Set<string>()
  if (scope === 'selection') {
    for (const selectedTopicId of selection.ids) {
      const selectedTopic = findTopic(sheet.root, selectedTopicId)
      if (selectedTopic !== undefined) {
        collectSubtreeSourceIds(selectedTopic, sourceCatalog, selectedSourceIds)
      }
    }
  }

  for (const sourceRef of sourceRefs) {
    const canonical = sourceCatalog.get(sourceRef.id)
    if (canonical === undefined || !sourceRefEquals(sourceRef, canonical.ref)) {
      return failure(
        'source_out_of_scope',
        `source ref "${sourceRef.id}" is not a current source of sheet "${sheet.id}"`
      )
    }
    if (scope === 'selection' && !selectedSourceIds.has(sourceRef.id)) {
      return failure(
        'source_out_of_scope',
        `source ref "${sourceRef.id}" is outside the selected topics`
      )
    }
  }

  if (scope === 'selection' && selection.ids.length === 0) {
    return failure('empty_scope', 'selection scope requires at least one selected topic')
  }
  if (scope === 'source' && sourceRefs.length === 0) {
    return failure('empty_scope', 'source scope requires at least one source ref')
  }

  const request: MindMapProposalRequest = {
    schemaVersion: 1,
    scope,
    documentId: input.document.id,
    sheetId: sheet.id,
    selectedTopicIds: selection.ids,
    sourceRefs: sourceRefs.map((sourceRef) => ({
      ...sourceCatalog.get(sourceRef.id)!.ref,
      ...(sourceCatalog.get(sourceRef.id)!.ref.breadcrumb
        ? { breadcrumb: [...sourceCatalog.get(sourceRef.id)!.ref.breadcrumb!] }
        : {})
    }))
  }

  const parsed = mindMapProposalRequestSchema.safeParse(request)
  if (!parsed.success) {
    return failure('invalid_source_refs', 'built proposal request failed schema validation')
  }
  return { ok: true, request: parsed.data }
}

function findTopic(root: MindMapTopicV2, topicId: string): MindMapTopicV2 | undefined {
  if (root.id === topicId) return root
  for (const child of root.children) {
    const found = findTopic(child, topicId)
    if (found !== undefined) return found
  }
  return undefined
}
