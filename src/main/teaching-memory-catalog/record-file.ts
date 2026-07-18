import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { replaceDurably } from '../persistence/durable-file'

const RECORD_FILE_PREFIX = 'memory-'
const RECORD_FILE_SUFFIX = '.json'

/**
 * The durable file convention for a Teaching-memory record.
 *
 * Record IDs are encoded rather than interpolated into paths, so every ID has
 * one safe, deterministic file name on every supported platform. The helper
 * deliberately stays specific to the local Teaching-memory catalog; it is not
 * a persistence adapter for other record types.
 */
export function teachingMemoryRecordFileName(id: string): string {
  const normalizedId = normalizeRecordId(id)
  return `${RECORD_FILE_PREFIX}${Buffer.from(normalizedId, 'utf8').toString('base64url')}${RECORD_FILE_SUFFIX}`
}

export function teachingMemoryRecordFilePath(rootDir: string, id: string): string {
  return join(rootDir, teachingMemoryRecordFileName(id))
}

export function isCanonicalTeachingMemoryRecordFileName(fileName: string): boolean {
  return fileName.startsWith(RECORD_FILE_PREFIX) && fileName.endsWith(RECORD_FILE_SUFFIX)
}

export function isTeachingMemoryRecordFileName(fileName: string, id: string): boolean {
  const legacyFileName = legacyTeachingMemoryRecordFileName(id)
  return fileName === teachingMemoryRecordFileName(id) || fileName === legacyFileName
}

export async function listTeachingMemoryRecordFiles(rootDir: string): Promise<string[]> {
  await mkdir(rootDir, { recursive: true })
  return (await readdir(rootDir)).filter((fileName) => fileName.endsWith(RECORD_FILE_SUFFIX))
}

/** Canonical names take precedence; legacy names remain a final compatibility path. */
export async function readTeachingMemoryRecordFile(rootDir: string, id: string): Promise<{ fileName: string; content: string } | null> {
  const canonicalFileName = teachingMemoryRecordFileName(id)
  const canonical = await readFile(join(rootDir, canonicalFileName), 'utf8').catch((error: unknown) => {
    if (isMissingFile(error)) return null
    throw error
  })
  if (canonical !== null) return { fileName: canonicalFileName, content: canonical }

  const legacyFileName = legacyTeachingMemoryRecordFileName(id)
  if (!legacyFileName || legacyFileName === canonicalFileName) return null
  const legacy = await readFile(join(rootDir, legacyFileName), 'utf8').catch((error: unknown) => {
    if (isMissingFile(error)) return null
    throw error
  })
  return legacy === null ? null : { fileName: legacyFileName, content: legacy }
}

/** Writes and fsyncs a replacement before atomically publishing it at the canonical path. */
export async function replaceTeachingMemoryRecordFile(rootDir: string, id: string, record: unknown): Promise<void> {
  await mkdir(rootDir, { recursive: true })
  const fileName = teachingMemoryRecordFileName(id)
  const targetPath = join(rootDir, fileName)
  await replaceDurably({
    path: targetPath,
    content: `${JSON.stringify(record, null, 2)}\n`,
    mode: 0o600
  })

  const legacyFileName = legacyTeachingMemoryRecordFileName(id)
  if (legacyFileName && legacyFileName !== fileName) {
    await unlink(join(rootDir, legacyFileName)).catch((error: unknown) => {
      if (!isMissingFile(error)) throw error
    })
  }
}

function legacyTeachingMemoryRecordFileName(id: string): string | null {
  const normalizedId = normalizeRecordId(id)
  return /^[^\\/:*?"<>|]+$/.test(normalizedId) ? `${normalizedId}${RECORD_FILE_SUFFIX}` : null
}

function normalizeRecordId(id: string): string {
  const normalized = String(id).trim()
  if (!normalized) throw new Error('Teaching-memory record IDs must not be empty')
  return normalized
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
