/**
 * Strict envelope parsers for mind map teaching IPC (docs/mindmap/design.md §4.3).
 *
 * Each parser requires an exact key set (with explicitly optional fields
 * called out in the parser), rejects extra keys, validates `workspaceId` / `id`
 * as non-empty strings, and returns `null` on any invalid payload. The `doc`
 * field of an update is validated against the v2 schema, and `expectedRevision`
 * must be a non-negative safe integer.
 *
 * Kept in a dedicated module so `teaching-ipc-commands.ts` and
 * `teaching-ipc-gateway.ts` do not grow further (module-size policy ADR-0075).
 */
import {
  mindMapDocumentV2Schema,
  mindMapSourceRefSchema
} from '../../shared/mindmap/domain/schema'
import {
  MIND_MAP_PROPOSAL_SCOPES,
  type MindMapProposalScope
} from '../../shared/mindmap/commands/mind-map-proposal'
import {
  MIND_MAP_SVG_EXPORT_LIMITS,
  getMindMapSvgExportDimensions,
  validateMindMapSvgExportInput,
  type MindMapSvgEdge,
  type MindMapSvgExportInput,
  type MindMapSvgNode
} from '../../shared/mindmap/svg-export'
import { inspectMindMapPngExportArtifact } from '../../shared/mindmap/png-export'
import { mindMapStructureClassSchema } from '../../shared/mindmap/mind-map-schema'
import type {
  MindMapDocumentV2,
  MindMapSourceRef
} from '../../shared/mindmap/domain/types'
import type {
  MindMapAccessPayload,
  MindMapCancelGenerationPayload,
  MindMapCreatePayload,
  MindMapExportPayload,
  MindMapMarkdownExportPayload,
  MindMapMarkdownImportPayload,
  MindMapOpmlExportPayload,
  MindMapPngExportPayload,
  MindMapOpmlImportPayload,
  MindMapSvgExportPayload,
  MindMapFlushPayload,
  MindMapGeneratePayload,
  MindMapProposalGeneratePayload,
  MindMapImportPayload,
  MindMapListPayload,
  MindMapSourceRefreshApplyPayload,
  MindMapSourceRefreshPayload,
  MindMapUpdatePayload
} from '../../shared/teaching-types/mindmap'
import {
  normalizeMindMapLessonWorkspacePath,
  normalizeSelectedFileWorkspacePath
} from './mind-map-selected-file'

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

/** Allowed-key check for envelopes with explicitly optional fields. */
function requireAllowedKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[]
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !(key in record))) {
    return null
  }
  return record
}

function requireNonNegativeSafeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null
}

export function parseMindMapListPayload(value: unknown): MindMapListPayload | null {
  const record = requireExactKeys(value, ['workspaceId'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  if (!workspaceId) return null
  return { workspaceId }
}

export function parseMindMapCreatePayload(value: unknown): MindMapCreatePayload | null {
  const record = requireAllowedKeys(
    value,
    ['workspaceId', 'title', 'structureClass'],
    ['workspaceId', 'title']
  )
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const title = requireNonEmptyString(record.title)
  if (!workspaceId || !title) return null

  if (record.structureClass === undefined) return { workspaceId, title }
  const structureClass = mindMapStructureClassSchema.safeParse(record.structureClass)
  return structureClass.success ? { workspaceId, title, structureClass: structureClass.data } : null
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
  const record = requireExactKeys(value, ['workspaceId', 'id', 'expectedRevision', 'doc'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (!workspaceId || !id || expectedRevision === null) return null
  const parsedDoc = mindMapDocumentV2Schema.safeParse(record.doc)
  if (!parsedDoc.success) return null
  return {
    workspaceId,
    id,
    expectedRevision,
    doc: parsedDoc.data as MindMapDocumentV2
  }
}

export function parseMindMapFlushPayload(value: unknown): MindMapFlushPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'id'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  if (!workspaceId || !id) return null
  return { workspaceId, id }
}

/** Parse the path-free, read-only source refresh envelope. */
export function parseMindMapSourceRefreshPayload(
  value: unknown
): MindMapSourceRefreshPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'id'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  if (!workspaceId || !id) return null
  return { workspaceId, id }
}

/** Parse an explicit, path-safe source metadata writeback envelope. */
export function parseMindMapSourceRefreshApplyPayload(
  value: unknown
): MindMapSourceRefreshApplyPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'id', 'expectedRevision', 'updates'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (!workspaceId || !id || expectedRevision === null || !Array.isArray(record.updates)) return null
  if (record.updates.length > 256) return null

  const updates: MindMapSourceRefreshApplyPayload['updates'] = []
  const seenSourceIds = new Set<string>()
  for (const candidate of record.updates) {
    const update = requireExactKeys(candidate, ['sourceRef'])
    if (!update) return null
    const parsed = mindMapSourceRefSchema.strict().safeParse(update.sourceRef)
    if (!parsed.success || seenSourceIds.has(parsed.data.id)) return null

    const sourceRef = parsed.data as MindMapSourceRef
    // A source-refresh writeback is only meaningful for a bounded hash that
    // the read-only preview observed.  Do not let a renderer turn an
    // arbitrary source ref into a confirmed/fresh ref by omitting the hash or
    // by setting `stale` to anything other than the explicit confirmation
    // value.
    if (
      typeof sourceRef.contentHash !== 'string' ||
      sourceRef.contentHash.length === 0 ||
      sourceRef.stale !== false ||
      sourceRef.workspacePath === undefined
    ) {
      return null
    }
    if (sourceRef.workspacePath !== undefined) {
      const normalizedPath = normalizeSelectedFileWorkspacePath(sourceRef.workspacePath)
      if (!normalizedPath) return null
      sourceRef.workspacePath = normalizedPath
    }
    seenSourceIds.add(sourceRef.id)
    updates.push({ sourceRef })
  }

  return { workspaceId, id, expectedRevision, updates }
}

export function parseMindMapGeneratePayload(value: unknown): MindMapGeneratePayload | null {
  // `generationId` was added for provider cancellation. Keep the original
  // three-field envelope valid while allowing exactly one read-only context
  // selector (selected file or generated Lesson).
  const record =
    requireExactKeys(value, ['workspaceId', 'title', 'prompt']) ??
    requireExactKeys(value, ['workspaceId', 'title', 'prompt', 'generationId']) ??
    requireExactKeys(value, ['workspaceId', 'title', 'prompt', 'selectedFile']) ??
    requireExactKeys(value, ['workspaceId', 'title', 'prompt', 'selectedFile', 'generationId']) ??
    requireExactKeys(value, ['workspaceId', 'title', 'prompt', 'lesson']) ??
    requireExactKeys(value, ['workspaceId', 'title', 'prompt', 'lesson', 'generationId'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const title = requireNonEmptyString(record.title)
  const prompt = requireNonEmptyString(record.prompt)
  if (!workspaceId || !title || !prompt) return null
  const selectedFile = parseSelectedFile(record.selectedFile)
  if (Object.prototype.hasOwnProperty.call(record, 'selectedFile') && !selectedFile) return null
  const lesson = parseLesson(record.lesson)
  if (Object.prototype.hasOwnProperty.call(record, 'lesson') && !lesson) return null
  const generationId = Object.prototype.hasOwnProperty.call(record, 'generationId')
    ? requireNonEmptyString(record.generationId)
    : undefined
  if (Object.prototype.hasOwnProperty.call(record, 'generationId') && !generationId) return null
  return {
    workspaceId,
    title,
    prompt,
    ...(selectedFile ? { selectedFile } : {}),
    ...(lesson ? { lesson } : {}),
    ...(generationId ? { generationId } : {})
  }
}

/**
 * Parse the read-only provider proposal request before workspace/document
 * access. The selected ids and source refs are intentionally carried as
 * arrays, then canonicalized against the current document by the gateway's
 * pure request builder; this parser only validates their transport shape.
 */
export function parseMindMapProposalGeneratePayload(
  value: unknown
): MindMapProposalGeneratePayload | null {
  const baseKeys = [
    'workspaceId',
    'id',
    'scope',
    'sheetId',
    'selectedTopicIds',
    'sourceRefs'
  ] as const
  const record =
    requireExactKeys(value, [...baseKeys, 'prompt']) ??
    requireExactKeys(value, [...baseKeys, 'prompt', 'generationId']) ??
    requireExactKeys(value, [...baseKeys, 'selectedFile', 'prompt']) ??
    requireExactKeys(value, [...baseKeys, 'selectedFile', 'prompt', 'generationId']) ??
    requireExactKeys(value, [...baseKeys, 'lesson', 'prompt']) ??
    requireExactKeys(value, [...baseKeys, 'lesson', 'prompt', 'generationId'])
  if (!record) return null

  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const sheetId = requireNonEmptyString(record.sheetId)
  const prompt = requireNonEmptyString(record.prompt)
  if (!workspaceId || !id || !sheetId || !prompt) return null
  if (!isMindMapProposalScope(record.scope)) return null
  const scope = record.scope

  const selectedTopicIds = parseNonEmptyStringArray(record.selectedTopicIds)
  if (!selectedTopicIds) return null
  const sourceRefs = parseSourceRefs(record.sourceRefs)
  if (!sourceRefs) return null
  const selectedFile = parseSelectedFile(record.selectedFile)
  if (Object.prototype.hasOwnProperty.call(record, 'selectedFile') && !selectedFile) return null
  const lesson = parseLesson(record.lesson)
  if (Object.prototype.hasOwnProperty.call(record, 'lesson') && !lesson) return null
  if (scope === 'selected-file' && !selectedFile) return null
  if (scope !== 'selected-file' && selectedFile) return null
  if (scope === 'lesson' && !lesson) return null
  if (scope !== 'lesson' && lesson) return null

  const generationId = Object.prototype.hasOwnProperty.call(record, 'generationId')
    ? requireNonEmptyString(record.generationId)
    : undefined
  if (Object.prototype.hasOwnProperty.call(record, 'generationId') && !generationId) return null
  return {
    workspaceId,
    id,
    scope,
    sheetId,
    selectedTopicIds,
    sourceRefs,
    ...(selectedFile ? { selectedFile } : {}),
    ...(lesson ? { lesson } : {}),
    prompt,
    ...(generationId ? { generationId } : {})
  }
}

function parseSelectedFile(value: unknown): { workspacePath: string } | null {
  if (value === undefined) return null
  const record = requireExactKeys(value, ['workspacePath'])
  if (!record) return null
  const workspacePath = normalizeSelectedFileWorkspacePath(record.workspacePath)
  if (!workspacePath) return null
  return { workspacePath }
}

function parseLesson(value: unknown): { workspacePath: string } | null {
  if (value === undefined) return null
  const record = requireExactKeys(value, ['workspacePath'])
  if (!record) return null
  const workspacePath = normalizeMindMapLessonWorkspacePath(record.workspacePath)
  if (!workspacePath) return null
  return { workspacePath }
}

function parseNonEmptyStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of value) {
    const parsed = requireNonEmptyString(candidate)
    if (!parsed || seen.has(parsed)) return null
    seen.add(parsed)
    result.push(parsed)
  }
  return result
}

function isMindMapProposalScope(value: unknown): value is MindMapProposalScope {
  return typeof value === 'string' && (MIND_MAP_PROPOSAL_SCOPES as readonly string[]).includes(value)
}

function parseSourceRefs(value: unknown): MindMapSourceRef[] | null {
  if (!Array.isArray(value)) return null
  const result: MindMapSourceRef[] = []
  const seen = new Set<string>()
  for (const candidate of value) {
    const parsed = mindMapSourceRefSchema.strict().safeParse(candidate)
    if (!parsed.success || seen.has(parsed.data.id)) return null
    seen.add(parsed.data.id)
    result.push(parsed.data)
  }
  return result
}

export function parseMindMapCancelGenerationPayload(value: unknown): MindMapCancelGenerationPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'generationId'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const generationId = requireNonEmptyString(record.generationId)
  if (!workspaceId || !generationId) return null
  return { workspaceId, generationId }
}

export function parseMindMapImportPayload(value: unknown): MindMapImportPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'sourcePath'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const sourcePath = requireNonEmptyString(record.sourcePath)
  if (!workspaceId || !sourcePath) return null
  return { workspaceId, sourcePath }
}

/** Parse the Markdown import envelope before any filesystem access. */
export function parseMindMapMarkdownImportPayload(
  value: unknown
): MindMapMarkdownImportPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'sourcePath'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const sourcePath = requireNonEmptyString(record.sourcePath)
  if (!workspaceId || !sourcePath) return null
  return { workspaceId, sourcePath }
}

/** Parse the OPML import envelope before any filesystem access. */
export function parseMindMapOpmlImportPayload(
  value: unknown
): MindMapOpmlImportPayload | null {
  const record = requireExactKeys(value, ['workspaceId', 'sourcePath'])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const sourcePath = requireNonEmptyString(record.sourcePath)
  if (!workspaceId || !sourcePath) return null
  return { workspaceId, sourcePath }
}

/**
 * Parse the XMind export envelope using the fail-closed renderer readiness proof.
 * A legacy destination-only request is intentionally rejected: the main process
 * must not serialize a snapshot without evidence that the renderer drained its
 * local save lane.
 */
export function parseMindMapExportPayload(value: unknown): MindMapExportPayload | null {
  const record = requireExactKeys(value, [
    'workspaceId',
    'id',
    'destinationDirectory',
    'snapshotRevision',
    'expectedRevision',
    'pendingWrites',
    'dirty'
  ])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const destinationDirectory = requireNonEmptyString(record.destinationDirectory)
  const snapshotRevision = requireNonNegativeSafeInteger(record.snapshotRevision)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (
    !workspaceId ||
    !id ||
    !destinationDirectory ||
    snapshotRevision === null ||
    expectedRevision === null ||
    typeof record.pendingWrites !== 'boolean' ||
    typeof record.dirty !== 'boolean'
  ) {
    return null
  }
  return {
    workspaceId,
    id,
    destinationDirectory,
    snapshotRevision,
    expectedRevision,
    pendingWrites: record.pendingWrites,
    dirty: record.dirty
  }
}

/**
 * Parse the Markdown export envelope.  The readiness fields are deliberately
 * part of the exact IPC contract: a missing renderer proof must not be treated
 * as a clean snapshot by the main process.
 */
export function parseMindMapMarkdownExportPayload(value: unknown): MindMapMarkdownExportPayload | null {
  const record = requireExactKeys(value, [
    'workspaceId',
    'id',
    'destinationDirectory',
    'snapshotRevision',
    'expectedRevision',
    'pendingWrites',
    'dirty'
  ])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const destinationDirectory = requireNonEmptyString(record.destinationDirectory)
  const snapshotRevision = requireNonNegativeSafeInteger(record.snapshotRevision)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (
    !workspaceId ||
    !id ||
    !destinationDirectory ||
    snapshotRevision === null ||
    expectedRevision === null ||
    typeof record.pendingWrites !== 'boolean' ||
    typeof record.dirty !== 'boolean'
  ) {
    return null
  }
  return {
    workspaceId,
    id,
    destinationDirectory,
    snapshotRevision,
    expectedRevision,
    pendingWrites: record.pendingWrites,
    dirty: record.dirty
  }
}

/** Parse the OPML export envelope using the same fail-closed readiness proof. */
export function parseMindMapOpmlExportPayload(value: unknown): MindMapOpmlExportPayload | null {
  const record = requireExactKeys(value, [
    'workspaceId',
    'id',
    'destinationDirectory',
    'snapshotRevision',
    'expectedRevision',
    'pendingWrites',
    'dirty'
  ])
  if (!record) return null
  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const destinationDirectory = requireNonEmptyString(record.destinationDirectory)
  const snapshotRevision = requireNonNegativeSafeInteger(record.snapshotRevision)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (
    !workspaceId ||
    !id ||
    !destinationDirectory ||
    snapshotRevision === null ||
    expectedRevision === null ||
    typeof record.pendingWrites !== 'boolean' ||
    typeof record.dirty !== 'boolean'
  ) {
    return null
  }
  return {
    workspaceId,
    id,
    destinationDirectory,
    snapshotRevision,
    expectedRevision,
    pendingWrites: record.pendingWrites,
    dirty: record.dirty
  }
}

/**
 * Parse the SVG export envelope.  Unlike a renderer-provided SVG string, the
 * payload carries only a strict layout input; the main process serializes it
 * with the shared static SVG serializer after rechecking repository readiness.
 */
export function parseMindMapSvgExportPayload(value: unknown): MindMapSvgExportPayload | null {
  const record = requireExactKeys(value, [
    'workspaceId',
    'id',
    'sheetId',
    'destinationDirectory',
    'input',
    'snapshotRevision',
    'expectedRevision',
    'pendingWrites',
    'dirty'
  ])
  if (!record) return null

  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const sheetId = requireNonEmptyString(record.sheetId)
  const destinationDirectory = requireNonEmptyString(record.destinationDirectory)
  const snapshotRevision = requireNonNegativeSafeInteger(record.snapshotRevision)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (
    !workspaceId ||
    !id ||
    !sheetId ||
    !destinationDirectory ||
    snapshotRevision === null ||
    expectedRevision === null ||
    typeof record.pendingWrites !== 'boolean' ||
    typeof record.dirty !== 'boolean'
  ) {
    return null
  }

  const input = parseMindMapSvgExportInput(record.input)
  if (!input) return null
  return {
    workspaceId,
    id,
    sheetId,
    destinationDirectory,
    input,
    snapshotRevision,
    expectedRevision,
    pendingWrites: record.pendingWrites,
    dirty: record.dirty
  }
}

/**
 * Parse the PNG export envelope. The renderer supplies a canvas-rasterized
 * artifact, but the main process revalidates its PNG structure and binds its
 * dimensions to the same strict SVG layout input before writing any bytes.
 */
export function parseMindMapPngExportPayload(value: unknown): MindMapPngExportPayload | null {
  const record = requireExactKeys(value, [
    'workspaceId',
    'id',
    'sheetId',
    'destinationDirectory',
    'input',
    'pngBase64',
    'width',
    'height',
    'snapshotRevision',
    'expectedRevision',
    'pendingWrites',
    'dirty'
  ])
  if (!record) return null

  const workspaceId = requireNonEmptyString(record.workspaceId)
  const id = requireNonEmptyString(record.id)
  const sheetId = requireNonEmptyString(record.sheetId)
  const destinationDirectory = requireNonEmptyString(record.destinationDirectory)
  const snapshotRevision = requireNonNegativeSafeInteger(record.snapshotRevision)
  const expectedRevision = requireNonNegativeSafeInteger(record.expectedRevision)
  if (
    !workspaceId ||
    !id ||
    !sheetId ||
    !destinationDirectory ||
    snapshotRevision === null ||
    expectedRevision === null ||
    typeof record.pendingWrites !== 'boolean' ||
    typeof record.dirty !== 'boolean'
  ) {
    return null
  }

  const input = parseMindMapSvgExportInput(record.input)
  if (!input) return null
  try {
    const dimensions = getMindMapSvgExportDimensions(input)
    inspectMindMapPngExportArtifact(
      {
        pngBase64: record.pngBase64,
        width: record.width,
        height: record.height
      },
      dimensions
    )
  } catch {
    return null
  }
  return {
    workspaceId,
    id,
    sheetId,
    destinationDirectory,
    input,
    pngBase64: record.pngBase64 as string,
    width: record.width as number,
    height: record.height as number,
    snapshotRevision,
    expectedRevision,
    pendingWrites: record.pendingWrites,
    dirty: record.dirty
  }
}

function parseMindMapSvgExportInput(value: unknown): MindMapSvgExportInput | null {
  const record = requireExactKeys(value, ['title', 'nodes', 'edges'])
  if (!record || typeof record.title !== 'string' || !Array.isArray(record.nodes) || !Array.isArray(record.edges)) {
    return null
  }
  if (
    record.nodes.length > MIND_MAP_SVG_EXPORT_LIMITS.maxNodes ||
    record.edges.length > MIND_MAP_SVG_EXPORT_LIMITS.maxEdges
  ) {
    return null
  }

  const nodes: MindMapSvgNode[] = []
  for (const value of record.nodes) {
    const parsed = parseMindMapSvgNode(value)
    if (!parsed) return null
    nodes.push(parsed)
  }

  const edges: MindMapSvgEdge[] = []
  for (const value of record.edges) {
    const record =
      requireExactKeys(value, ['from', 'to']) ??
      requireExactKeys(value, ['from', 'to', 'label'])
    if (!record) return null
    const from = requireNonEmptyString(record.from)
    const to = requireNonEmptyString(record.to)
    const hasLabel = Object.prototype.hasOwnProperty.call(record, 'label')
    const label = !hasLabel
      ? undefined
      : typeof record.label === 'string'
        ? record.label
        : null
    if (!from || !to || label === null) return null
    edges.push({ from, to, ...(hasLabel ? { label: label as string } : {}) })
  }

  const input: MindMapSvgExportInput = { title: record.title, nodes, edges }
  try {
    validateMindMapSvgExportInput(input)
  } catch {
    return null
  }
  return input
}

function parseMindMapSvgNode(value: unknown): MindMapSvgNode | null {
  const record =
    requireExactKeys(value, ['id', 'title', 'x', 'y', 'width', 'height']) ??
    requireExactKeys(value, ['id', 'title', 'x', 'y', 'width', 'height', 'collapsed'])
  if (!record) return null

  const id = requireNonEmptyString(record.id)
  const title = typeof record.title === 'string' ? record.title : null
  const x = requireFiniteSvgNumber(record.x)
  const y = requireFiniteSvgNumber(record.y)
  const width = requireFiniteSvgNumber(record.width)
  const height = requireFiniteSvgNumber(record.height)
  if (!id || title === null || x === null || y === null || width === null || height === null) {
    return null
  }
  if (
    Math.abs(x) > MIND_MAP_SVG_EXPORT_LIMITS.maxCoordinate ||
    Math.abs(y) > MIND_MAP_SVG_EXPORT_LIMITS.maxCoordinate ||
    Math.abs(width) > MIND_MAP_SVG_EXPORT_LIMITS.maxCoordinate ||
    Math.abs(height) > MIND_MAP_SVG_EXPORT_LIMITS.maxCoordinate ||
    width <= 0 ||
    height <= 0 ||
    title.length > MIND_MAP_SVG_EXPORT_LIMITS.maxTextLength
  ) {
    return null
  }

  if (Object.prototype.hasOwnProperty.call(record, 'collapsed')) {
    if (typeof record.collapsed !== 'boolean') return null
    return { id, title, x, y, width, height, collapsed: record.collapsed }
  }
  return { id, title, x, y, width, height }
}

function requireFiniteSvgNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
