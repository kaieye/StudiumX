/**
 * Local crash marker for next-start TeachingDoctor visibility.
 *
 * Writes a small JSON marker under an injectable appData directory so a later
 * process can report that the previous process ended abnormally. Never uploads,
 * never phones home, and never stores secrets or absolute user paths.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const CRASH_MARKER_SCHEMA_VERSION = 1 as const
export const CRASH_MARKER_FILE_NAME = 'crash-marker.json'
export const CRASH_MARKER_SUBDIR = 'observability'

/** Closed reason codes only — free text is rejected. */
export const CRASH_MARKER_REASON_CODES = [
  'uncaught_exception',
  'unhandled_rejection',
  'process_exit_abnormal',
  'manual_test',
  'unknown'
] as const

export type CrashMarkerReasonCode = (typeof CRASH_MARKER_REASON_CODES)[number]

export type CrashMarker = Readonly<{
  schemaVersion: typeof CRASH_MARKER_SCHEMA_VERSION
  /** ISO-8601 timestamp when the marker was written. */
  writtenAt: string
  reasonCode: CrashMarkerReasonCode
  /** Optional opaque run correlation (sanitized). */
  runId?: string
}>

export type CrashMarkerWriteInput = {
  reasonCode: CrashMarkerReasonCode | string
  runId?: string | null
  /** Injected clock for tests. */
  now?: () => string
}

export type CrashMarkerStoreOptions = {
  /**
   * App userData (or test temp) root. Marker is stored at
   * `<appDataRoot>/observability/crash-marker.json`.
   */
  appDataRoot: string
  /** Override absolute marker path (tests). Prefer appDataRoot in production. */
  markerPath?: string
}

export type CrashMarkerStore = {
  readonly markerPath: string
  write(input: CrashMarkerWriteInput): Promise<CrashMarker>
  read(): Promise<CrashMarker | null>
  clear(): Promise<void>
  /** True when a valid marker is present (best-effort, no throw). */
  isPresent(): Promise<boolean>
}

const OPAQUE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const REASON_SET = new Set<string>(CRASH_MARKER_REASON_CODES)

/**
 * Create a crash-marker store bound to an appData root (injectable for tests).
 */
export function createCrashMarkerStore(options: CrashMarkerStoreOptions): CrashMarkerStore {
  const markerPath =
    options.markerPath?.trim() ||
    join(options.appDataRoot, CRASH_MARKER_SUBDIR, CRASH_MARKER_FILE_NAME)

  return {
    markerPath,
    async write(input: CrashMarkerWriteInput): Promise<CrashMarker> {
      const marker = buildCrashMarker(input)
      await mkdir(dirname(markerPath), { recursive: true })
      // Atomic-ish replace: write then overwrite. Content is tiny and non-secret.
      await writeFile(markerPath, `${JSON.stringify(marker)}\n`, 'utf8')
      return marker
    },
    async read(): Promise<CrashMarker | null> {
      try {
        const raw = await readFile(markerPath, 'utf8')
        return parseCrashMarker(raw)
      } catch (error) {
        if (isNotFound(error)) return null
        // Fail closed: unreadable marker is treated as absent for diagnosis,
        // but never throws secrets or raw parse payloads to callers.
        return null
      }
    },
    async clear(): Promise<void> {
      try {
        await rm(markerPath, { force: true })
      } catch {
        // ignore
      }
    },
    async isPresent(): Promise<boolean> {
      return (await this.read()) != null
    }
  }
}

/** Pure builder used by write() and unit tests. */
export function buildCrashMarker(input: CrashMarkerWriteInput): CrashMarker {
  const writtenAt = (input.now ?? (() => new Date().toISOString()))()
  const reasonCode = normalizeReasonCode(input.reasonCode)
  const runId = normalizeRunId(input.runId)
  return {
    schemaVersion: CRASH_MARKER_SCHEMA_VERSION,
    writtenAt: typeof writtenAt === 'string' && writtenAt.trim() ? writtenAt.trim() : new Date().toISOString(),
    reasonCode,
    ...(runId ? { runId } : {})
  }
}

/** Parse and validate marker JSON; invalid content yields null (fail closed). */
export function parseCrashMarker(raw: string): CrashMarker | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(parsed)) return null
  if (parsed.schemaVersion !== CRASH_MARKER_SCHEMA_VERSION) return null
  if (typeof parsed.writtenAt !== 'string' || !parsed.writtenAt.trim()) return null
  // Reject absolute paths or secret-shaped fields if a buggy writer added them.
  for (const key of Object.keys(parsed)) {
    if (key === 'schemaVersion' || key === 'writtenAt' || key === 'reasonCode' || key === 'runId') continue
    return null
  }
  if (typeof parsed.reasonCode !== 'string') return null
  const reasonCode = normalizeReasonCode(parsed.reasonCode)
  const runId = normalizeRunId(parsed.runId)
  // Reject markers that embed path-like strings in known fields.
  if (looksLikePathOrSecret(parsed.writtenAt) || (runId != null && looksLikePathOrSecret(runId))) {
    return null
  }
  return {
    schemaVersion: CRASH_MARKER_SCHEMA_VERSION,
    writtenAt: parsed.writtenAt.trim(),
    reasonCode,
    ...(runId ? { runId } : {})
  }
}

/**
 * Install best-effort process hooks that write a crash marker.
 * Residual for main bootstrap: call once after appDataRoot is known.
 * Does **not** upload or log secrets from the error object.
 */
export function installLocalCrashMarkerHooks(
  store: CrashMarkerStore,
  options: { runId?: string | null } = {}
): () => void {
  const write = (reasonCode: CrashMarkerReasonCode): void => {
    void store.write({ reasonCode, runId: options.runId ?? null }).catch(() => {
      // never throw from process-level hooks
    })
  }

  const onUncaught = (): void => {
    write('uncaught_exception')
  }
  const onRejection = (): void => {
    write('unhandled_rejection')
  }

  process.on('uncaughtException', onUncaught)
  process.on('unhandledRejection', onRejection)

  return () => {
    process.off('uncaughtException', onUncaught)
    process.off('unhandledRejection', onRejection)
  }
}

function normalizeReasonCode(value: string): CrashMarkerReasonCode {
  const trimmed = String(value ?? '').trim()
  if (REASON_SET.has(trimmed)) return trimmed as CrashMarkerReasonCode
  return 'unknown'
}

function normalizeRunId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!OPAQUE_RUN_ID_RE.test(trimmed)) return undefined
  if (looksLikePathOrSecret(trimmed)) return undefined
  return trimmed
}

function looksLikePathOrSecret(value: string): boolean {
  if (/[\\/]/.test(value)) return true
  if (/^[A-Za-z]:/.test(value)) return true
  if (/api[_-]?key|secret|token|password|bearer/i.test(value)) return true
  return false
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT')
}
