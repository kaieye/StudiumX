/**
 * Main-process persistence store for mind maps (ADR-0172 / docs/mindmap/design.md §3).
 *
 * One JSON document per file at `<rootPath>/mindmaps/<id>.json`. Writes are
 * durable (ADR-0131): write a same-directory temp file, then rename over the
 * target. Reads are JSON.parse + Zod-validated — never silently degraded.
 *
 * Main-process I/O only. No IPC, no renderer, no provider calls.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

import { mindMapDocumentSchema } from '../../shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../shared/mindmap/mind-map-types'
import type { MindMapSummary } from '../../shared/mindmap/mind-map-types'

export type { MindMapSummary } from '../../shared/mindmap/mind-map-types'

/** Relative (under `<rootPath>`) directory holding one JSON file per document. */
const MIND_MAPS_DIR = 'mindmaps'

/** File suffix for persisted documents. */
const FILE_SUFFIX = '.json'

/** Suffix for the durable-write temp file written before rename. */
const TEMP_SUFFIX = '.tmp'

/**
 * id safety: lowercase alphanumeric start, then lowercase alphanumeric or dash,
 * up to 64 chars total. Rejects traversal and other unsafe characters.
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export type MindMapStore = {
  /** List all mind maps in the workspace (sorted by updatedAt desc). Reads file headers only where cheap; listing metadata is fine. */
  list(): Promise<MindMapSummary[]>
  /** Create a new empty document (one sheet, empty root) and persist it. Returns the document. */
  create(title: string): Promise<MindMapDocument>
  /** Read + Zod-validate one document. */
  read(id: string): Promise<MindMapDocument>
  /** Validate `doc.id === id`, stamp `updatedAt` from Date.now(), durable-write, return the stamped doc. */
  update(id: string, doc: MindMapDocument): Promise<MindMapDocument>
  /** Delete the file. Idempotent (missing file → no-op). */
  remove(id: string): Promise<void>
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
function pathFor(rootPath: string, id: string): string {
  assertValidId(id)
  const root = resolve(rootPath)
  const mindMapsRoot = resolve(root, MIND_MAPS_DIR)
  const filePath = resolve(mindMapsRoot, `${id}${FILE_SUFFIX}`)
  const rel = relative(mindMapsRoot, filePath)
  if (rel.startsWith('..') || rel.includes('..') || rel.startsWith('/')) {
    throw new Error(`Refusing to access mind map path outside ${mindMapsRoot}: ${filePath}`)
  }
  return filePath
}

/** Ensures the `<rootPath>/mindmaps/` directory exists (idempotent). */
async function ensureDirectory(rootPath: string): Promise<void> {
  await mkdir(resolve(rootPath, MIND_MAPS_DIR), { recursive: true })
}

/** JSON.parse + Zod-validate a document; throws a clear error on failure. */
function parseDocument(id: string, content: string): MindMapDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error(`Mind map "${id}" is not valid JSON: ${(error as Error).message}`)
  }
  const result = mindMapDocumentSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Mind map "${id}" failed schema validation: ${result.error.message}`
    )
  }
  return result.data
}

/** Durable-write: serialize → temp file → rename over the target. */
async function writeDurably(filePath: string, doc: MindMapDocument): Promise<void> {
  const tmpPath = join(
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    resolve(filePath, '..'),
    `.${basename(filePath)}${TEMP_SUFFIX}`
  )
  const content = JSON.stringify(doc, null, 2)
  await writeFile(tmpPath, content)
  await rename(tmpPath, filePath)
}

export function createMindMapStore(rootPath: string): MindMapStore {
  return {
    async list(): Promise<MindMapSummary[]> {
      const dir = resolve(rootPath, MIND_MAPS_DIR)
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
        // Skip temp files left by an interrupted durable write.
        if (name.endsWith(TEMP_SUFFIX)) continue
        const id = name.slice(0, -FILE_SUFFIX.length)
        const filePath = join(dir, name)
        try {
          const content = await readFile(filePath, 'utf8')
          const doc = parseDocument(id, content)
          summaries.push({
            id: doc.id,
            title: doc.title,
            updatedAt: doc.updatedAt,
            sheetCount: doc.sheets.length
          })
        } catch {
          // Skip unparseable files robustly — don't crash the whole list.
        }
      }

      summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      return summaries
    },

    async create(title: string): Promise<MindMapDocument> {
      await ensureDirectory(rootPath)
      const id = randomUUID()
      const now = new Date().toISOString()
      const doc: MindMapDocument = {
        schemaVersion: 1,
        id,
        title,
        createdAt: now,
        updatedAt: now,
        sheets: [
          {
            id: randomUUID(),
            title: 'Sheet 1',
            structureClass: 'org.xmind.ui.logic.right',
            root: { id: randomUUID(), title, children: [] }
          }
        ]
      }
      await writeDurably(pathFor(rootPath, id), doc)
      return doc
    },

    async read(id: string): Promise<MindMapDocument> {
      const filePath = pathFor(rootPath, id)
      const content = await readFile(filePath, 'utf8')
      return parseDocument(id, content)
    },

    async update(id: string, doc: MindMapDocument): Promise<MindMapDocument> {
      if (doc.id !== id) {
        throw new Error(`Mind map id mismatch: expected "${id}" but document has id "${doc.id}".`)
      }
      // Monotonic stamp: ensure the new updatedAt is strictly newer than the
      // incoming doc's, so rapid successive writes are always visible even when
      // they land in the same millisecond (Date.now() has ms resolution).
      const previous = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0
      const nowMs = Date.now()
      const stampedMs = Number.isFinite(previous) && previous >= nowMs ? previous + 1 : nowMs
      const stamped: MindMapDocument = {
        ...doc,
        updatedAt: new Date(stampedMs).toISOString()
      }
      await writeDurably(pathFor(rootPath, id), stamped)
      return stamped
    },

    async remove(id: string): Promise<void> {
      const filePath = pathFor(rootPath, id)
      try {
        await unlink(filePath)
      } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') return
        throw error
      }
    }
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}