/**
 * Main-process persistence store for mind maps (ADR-0173 / docs/mindmap/design.md §3).
 *
 * One JSON document per file at `<rootPath>/mindmaps/<id>.json`. Documents are
 * stored in the v2 schema (`MindMapDocumentV2`) with a monotonic `revision`.
 * Writes are durable (ADR-0131): write a same-directory journal + temp file,
 * then rename over the target. A valid journal is used as the last legal
 * snapshot during crash recovery; the undo stack is never canonical.
 *
 * `update` is compare-and-swap: it requires `expectedRevision` and refuses to
 * overwrite a newer revision (no last-write-wins). Autosave is debounced in
 * this store; callers must `flush` before switching documents, closing the
 * window, or exporting.
 *
 * Main-process I/O only. No IPC, no renderer, no provider calls.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

import { mindMapDocumentV2Schema } from '../../shared/mindmap/domain/schema'
import { DEFAULT_MIND_MAP_THEME } from '../../shared/mindmap/domain/types'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'
import { migrateV1ToV2 } from '../../shared/mindmap/migrations'
import {
  DEFAULT_MIND_MAP_STRUCTURE_CLASS,
  DEFAULT_MIND_MAP_TOPIC_SHAPE
} from '../../shared/mindmap/mind-map-types'
import { MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MESSAGE } from '../../shared/mindmap/mind-map-repository-errors'
import type { MindMapStructureClass, MindMapSummary } from '../../shared/mindmap/mind-map-types'

export type { MindMapSummary } from '../../shared/mindmap/mind-map-types'

/** Relative (under `<rootPath>`) directory holding one JSON file per document. */
const MIND_MAPS_DIR = 'mindmaps'

/** File suffix for persisted documents. */
const FILE_SUFFIX = '.json'

/** Suffix for the durable-write temp file written before rename. */
const TEMP_SUFFIX = '.tmp'

/** Suffix for the restricted crash-recovery journal. */
const JOURNAL_SUFFIX = '.journal'

/** Short debounce used for autosave (main-process side). */
const AUTOSAVE_DEBOUNCE_MS = 80

/**
 * id safety: lowercase alphanumeric start, then lowercase alphanumeric or dash,
 * up to 64 chars total. Rejects traversal and other unsafe characters.
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export type MindMapUpdateResult =
  | { ok: true; document: MindMapDocumentV2 }
  | {
      ok: false
      code: 'revision_stale'
      expectedRevision: number
      currentRevision: number
    }

export type MindMapFlushResult = { ok: true }

export type MindMapStore = {
  /** List all mind maps in the workspace (sorted by updatedAt desc). */
  list(): Promise<MindMapSummary[]>
  /** Create a new v2 document (one sheet, empty root) and persist it. */
  create(title: string, structureClass?: MindMapStructureClass): Promise<MindMapDocumentV2>
  /** Read + migrate + validate one document, using the journal when present. */
  read(id: string): Promise<MindMapDocumentV2>
  /**
   * Compare-and-swap persist. Returns a structured result on revision
   * mismatch; never overwrites a newer document.
   */
  update(
    id: string,
    doc: MindMapDocumentV2,
    expectedRevision: number
  ): Promise<MindMapUpdateResult>
  /** Delete the file. Idempotent (missing file → no-op). */
  remove(id: string): Promise<void>
  /** Force-flush pending debounced saves for one document (or all). */
  flush(id?: string): Promise<void>
  /** Flush all pending saves and cancel timers (window close / shutdown). */
  close(): Promise<void>
}

/** Structured repository failure (invalid document, migration, recovery). */
export class MindMapStoreError extends Error {
  readonly code:
    | 'not_found'
    | 'invalid_document'
    | 'migration_failed'
    | 'read_failed'
    | 'write_failed'
  readonly detail?: unknown
  constructor(
    code: MindMapStoreError['code'],
    message: string,
    detail?: unknown
  ) {
    super(message)
    this.name = 'MindMapStoreError'
    this.code = code
    this.detail = detail
  }
}

type PendingSave = {
  doc: MindMapDocumentV2
  revision: number
}

/**
 * Validates a document id against the safe-id pattern and throws a clear error
 * otherwise. Used by every public operation before any path is built.
 */
function assertValidId(id: string): asserts id is string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid mind map id "${id}". Must match /^[a-z0-9][a-z0-9-]{0,63}$/.`
    )
  }
}

/**
 * Returns the absolute path for a document id, asserting (belt and suspenders,
 * on top of the regex) that the resolved path stays under `<rootPath>/mindmaps/`.
 */
function pathFor(rootPath: string, id: string, dirName: string = MIND_MAPS_DIR): string {
  assertValidId(id)
  const root = resolve(rootPath)
  const mindMapsRoot = dirName ? resolve(root, dirName) : root
  const filePath = resolve(mindMapsRoot, `${id}${FILE_SUFFIX}`)
  const rel = relative(mindMapsRoot, filePath)
  if (rel.startsWith('..') || rel.includes('..') || rel.startsWith('/')) {
    throw new Error(`Refusing to access mind map path outside ${mindMapsRoot}: ${filePath}`)
  }
  return filePath
}

function journalPathFor(filePath: string): string {
  return join(dirname(filePath), `.${basename(filePath)}${JOURNAL_SUFFIX}`)
}

function tempPathFor(filePath: string): string {
  return join(dirname(filePath), `.${basename(filePath)}${TEMP_SUFFIX}`)
}

/** Ensures the `<rootPath>/mindmaps/` directory exists (idempotent). */
async function ensureDirectory(rootPath: string, dirName: string = MIND_MAPS_DIR): Promise<void> {
  await mkdir(dirName ? resolve(rootPath, dirName) : rootPath, { recursive: true })
}

/** Parse raw JSON and migrate legacy v1 documents to v2. */
function parseAndMigrateDocument(id: string, content: string): MindMapDocumentV2 {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new MindMapStoreError(
      'invalid_document',
      `Mind map "${id}" is not valid JSON: ${(error as Error).message}`
    )
  }
  const result = migrateV1ToV2(parsed)
  if (!result.ok) {
    throw new MindMapStoreError(
      'migration_failed',
      `Mind map "${id}" failed schema migration: ${result.error.message}`,
      result.error
    )
  }
  return result.value
}

/** Durable-write: journal → temp file → rename → remove journal. */
async function writeDurably(filePath: string, doc: MindMapDocumentV2): Promise<void> {
  const journalPath = journalPathFor(filePath)
  const journalTmpPath = `${journalPath}.${randomUUID()}${TEMP_SUFFIX}`
  const tmpPath = tempPathFor(filePath)
  const content = JSON.stringify(doc, null, 2)
  let published = false
  try {
    // A restricted journal is only ever a serialized v2 document; it is never
    // an undo stack or intermediate migration state. Publish it by rename so a
    // journal left by an earlier interrupted write remains a valid fallback
    // until the replacement is complete. In particular, do not use `wx` on the
    // journal itself: a crash after journal publish and before target rename
    // must not make the next CAS update fail with EEXIST.
    await writeFile(journalTmpPath, content, { flag: 'wx' })
    await rename(journalTmpPath, journalPath)
    await writeFile(tmpPath, content)
    await rename(tmpPath, filePath)
    published = true
  } catch (error) {
    throw new MindMapStoreError(
      'write_failed',
      `Failed to durably write mind map "${doc.id}": ${(error as Error).message}`
    )
  } finally {
    // A failed write must retain the currently published journal for crash
    // recovery. Once the target has been renamed, the journal is redundant and
    // can be removed; failure to remove it is harmless because it is the same
    // legal snapshot and will be replaced atomically by the next write.
    await unlink(journalTmpPath).catch(() => undefined)
    if (published) await unlink(journalPath).catch(() => undefined)
  }
}

/** Read the latest legal snapshot: valid journal first, then the main file. */
async function readDocumentFromDisk(
  rootPath: string,
  id: string,
  dirName: string = MIND_MAPS_DIR
): Promise<MindMapDocumentV2> {
  const filePath = pathFor(rootPath, id, dirName)
  const journalPath = journalPathFor(filePath)
  try {
    const journal = await readFile(journalPath, 'utf8')
    return parseAndMigrateDocument(id, journal)
  } catch (error) {
    if (!isErrno(error) || error.code !== 'ENOENT') {
      // A corrupt journal is deliberately ignored — the main file is the
      // fallback snapshot. A thrown EACCES/other read error still surfaces.
      if (isErrno(error) && (error.code === 'EACCES' || error.code === 'EPERM')) throw error
    }
  }
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (error) {
    if (isErrno(error) && error.code === 'ENOENT') {
      throw new MindMapStoreError('not_found', MIND_MAP_DOCUMENT_NOT_FOUND_ERROR_MESSAGE)
    }
    throw error
  }
  return parseAndMigrateDocument(id, content)
}

/** Validate a v2 document and throw a structured error on failure. */
function validateV2Document(id: string, doc: MindMapDocumentV2): MindMapDocumentV2 {
  const parsed = mindMapDocumentV2Schema.safeParse(doc)
  if (!parsed.success) {
    throw new MindMapStoreError(
      'invalid_document',
      `Mind map "${id}" failed schema validation: ${parsed.error.message}`,
      parsed.error
    )
  }
  return parsed.data
}

/**
 * Monotonic updatedAt stamp: ensure the new timestamp is strictly newer than
 * the incoming doc's so rapid successive writes are always visible.
 */
function stampUpdatedAt(doc: MindMapDocumentV2): MindMapDocumentV2 {
  const previousMs = new Date(doc.updatedAt).getTime()
  const nowMs = Date.now()
  const stampedMs = Number.isFinite(previousMs) && previousMs >= nowMs ? previousMs + 1 : nowMs
  return { ...doc, updatedAt: new Date(stampedMs).toISOString() }
}

/**
 * Create a mind-map store rooted at `rootPath`.
 *
 * `dirName` defaults to the per-workspace `mindmaps/` folder. The home
 * location passes `''` so maps are written directly into `rootPath` (the
 * `MindMaps/` directory itself) rather than a nested subfolder.
 */
export function createMindMapStore(rootPath: string, dirName: string = MIND_MAPS_DIR): MindMapStore {
  const pendingSaves = new Map<string, PendingSave>()
  const pendingFlushes = new Map<string, Promise<void>>()
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * Serialize all repository operations that can change or observe one
   * document.  A compare-and-swap must cover the initial read as well as the
   * durable write: otherwise two concurrent updates can both read revision N,
   * both publish revision N+1, and one acknowledged update disappears.
   */
  const operationTails = new Map<string, Promise<void>>()

  const runExclusive = async <T>(id: string, operation: () => Promise<T>): Promise<T> => {
    const previous = operationTails.get(id)
    let release!: () => void
    const tail = new Promise<void>((resolveTail) => {
      release = resolveTail
    })
    operationTails.set(id, tail)

    if (previous) await previous
    try {
      return await operation()
    } finally {
      release()
      if (operationTails.get(id) === tail) operationTails.delete(id)
    }
  }

  const clearTimer = (id: string): void => {
    const timer = saveTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      saveTimers.delete(id)
    }
  }

  const flushOne = async (id: string): Promise<void> => {
    const inflight = pendingFlushes.get(id)
    if (inflight) return inflight
    if (!pendingSaves.has(id)) return
    const task = (async () => {
      try {
        while (true) {
          const pending = pendingSaves.get(id)
          if (!pending) return

          await writeDurably(pathFor(rootPath, id, dirName), pending.doc)
          if (pendingSaves.get(id)?.revision === pending.revision) {
            pendingSaves.delete(id)
            return
          }
          // A newer update arrived while this snapshot was being written.
          // Drain it in the same serial flush instead of relying on a timer
          // that may be cleared by this task's finally block.
        }
      } finally {
        pendingFlushes.delete(id)
        // If a write failed, leave a timer scheduled by a newer update alone;
        // it is the only automatic retry opportunity for that newer snapshot.
        if (!pendingSaves.has(id)) clearTimer(id)
      }
    })()
    pendingFlushes.set(id, task)
    return task
  }

  const scheduleSave = (id: string): void => {
    clearTimer(id)
    const timer = setTimeout(() => {
      // The originating update already receives write failures.  The timer is
      // a best-effort retry and must not create an unhandled rejection while
      // the pending snapshot remains available for an explicit flush/close.
      void flushOne(id).catch(() => undefined)
    }, AUTOSAVE_DEBOUNCE_MS)
    saveTimers.set(id, timer)
  }

  return {
    async list(): Promise<MindMapSummary[]> {
      const dir = dirName ? resolve(rootPath, dirName) : rootPath
      let names: string[]
      try {
        names = await readdir(dir)
      } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') return []
        throw error
      }

      const summaries: MindMapSummary[] = []
      for (const name of names) {
        if (!name.endsWith(FILE_SUFFIX)) continue
        // Skip temp/journal files left by an interrupted durable write.
        if (name.endsWith(TEMP_SUFFIX) || name.endsWith(JOURNAL_SUFFIX)) continue
        const id = name.slice(0, -FILE_SUFFIX.length)
        const filePath = join(dir, name)
        try {
          const content = await readFile(filePath, 'utf8')
          const doc = parseAndMigrateDocument(id, content)
          summaries.push({
            id: doc.id,
            title: doc.title,
            updatedAt: doc.updatedAt,
            sheetCount: doc.sheets.length,
            // Card previews need only the first tree and its layout settings;
            // elements/assets stay behind the canonical read boundary.
            preview: doc.sheets[0]
              ? {
                  theme: doc.theme,
                  root: doc.sheets[0].root,
                  layout: doc.sheets[0].layout
                }
              : undefined
          })
        } catch {
          // Skip unparseable files robustly — don't crash the whole list.
        }
      }

      summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      return summaries
    },

    async create(title: string, structureClass?: MindMapStructureClass): Promise<MindMapDocumentV2> {
      await ensureDirectory(rootPath, dirName)
      const id = randomUUID()
      const now = new Date().toISOString()
      const doc: MindMapDocumentV2 = {
        schemaVersion: 2,
        id,
        revision: 1,
        title,
        createdAt: now,
        updatedAt: now,
        theme: DEFAULT_MIND_MAP_THEME,
        sheets: [
          {
            id: randomUUID(),
            title: 'Sheet 1',
            root: { id: randomUUID(), title, children: [] },
            elements: [],
            layout: {
              structureClass: structureClass ?? DEFAULT_MIND_MAP_STRUCTURE_CLASS,
              defaultTopicShape: DEFAULT_MIND_MAP_TOPIC_SHAPE
            }
          }
        ],
        assets: []
      }
      await writeDurably(pathFor(rootPath, id, dirName), doc)
      return doc
    },

    async read(id: string): Promise<MindMapDocumentV2> {
      return runExclusive(id, async () => {
        const pending = pendingSaves.get(id)
        if (pending) return pending.doc
        const doc = await readDocumentFromDisk(rootPath, id, dirName)
        return validateV2Document(id, doc)
      })
    },

    async update(
      id: string,
      doc: MindMapDocumentV2,
      expectedRevision: number
    ): Promise<MindMapUpdateResult> {
      return runExclusive(id, async () => {
        if (doc.id !== id) {
          throw new Error(`Mind map id mismatch: expected "${id}" but document has id "${doc.id}".`)
        }
        const current = pendingSaves.get(id)?.doc ?? (await readDocumentFromDisk(rootPath, id, dirName))
        const currentRevision = current.revision
        if (expectedRevision !== currentRevision) {
          return {
            ok: false,
            code: 'revision_stale',
            expectedRevision,
            currentRevision
          }
        }
        const nextRevision = currentRevision + 1
        const stamped = validateV2Document(id, {
          ...doc,
          id,
          schemaVersion: 2,
          revision: nextRevision,
          updatedAt: stampUpdatedAt(doc).updatedAt
        })
        pendingSaves.set(id, { doc: stamped, revision: nextRevision })
        scheduleSave(id)
        await flushOne(id)
        return { ok: true, document: stamped }
      })
    },

    async remove(id: string): Promise<void> {
      await runExclusive(id, async () => {
        pendingSaves.delete(id)
        clearTimer(id)
        // A failed autosave can still be writing outside the operation queue.
        // Wait for that write before unlinking the target, otherwise its
        // completion could resurrect a document the caller just removed.
        await pendingFlushes.get(id)?.catch(() => undefined)
        const filePath = pathFor(rootPath, id, dirName)
        try {
          await unlink(filePath)
        } catch (error) {
          if (isErrno(error) && error.code === 'ENOENT') return
          throw error
        }
        await unlink(journalPathFor(filePath)).catch(() => undefined)
        await unlink(tempPathFor(filePath)).catch(() => undefined)
      })
    },

    async flush(id?: string): Promise<void> {
      if (id !== undefined) {
        await runExclusive(id, () => flushOne(id))
        return
      }
      const ids = new Set([...pendingSaves.keys(), ...operationTails.keys()])
      await Promise.all([...ids].map((pendingId) => runExclusive(pendingId, () => flushOne(pendingId))))
    },

    async close(): Promise<void> {
      for (const timer of saveTimers.values()) clearTimeout(timer)
      saveTimers.clear()
      await this.flush()
    }
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}
