/**
 * Learner-facing file-touch projection (ADR-0143 Phase A surface).
 *
 * Pure reducers that map ledger-shaped DTOs → display rows. This is
 * **reference / process transparency**, not teaching-evidence and not
 * settlement authority. Secrets are redacted; absolute / breakout paths drop.
 */

import {
  DEFAULT_FILE_TOUCH_MAX_ENTRIES,
  DEFAULT_FILE_TOUCH_MAX_PATH_CHARS,
  classifyFileTouchTool,
  sanitizeFileTouchDisplayPath as sanitizeFileTouchDisplayPathShared,
  stickyFileTouchKind,
  clampFileTouchInt,
  type FileTouchKind as SharedFileTouchKind
} from './file-touch-tools'

/** Access kind mirrored from the main-process file-touch ledger. */
export type FileTouchKind = SharedFileTouchKind

/** Ledger entry shape accepted by learner projectors (order optional for UI). */
export type FileTouchLedgerEntryDto = Readonly<{
  path: string
  kind: FileTouchKind
  order?: number
}>

/** Snapshot / metadata DTO — not settlement. */
export type FileTouchLedgerDto = Readonly<{
  entries: readonly FileTouchLedgerEntryDto[]
}>

/** Compact durable projection stored on turn metadata (reference only). */
export type AgentFileTouchMetadata = Readonly<{
  role: 'reference_projection'
  files: ReadonlyArray<{ path: string; kind: FileTouchKind }>
}>

export type FileTouchDisplayRow = Readonly<{
  id: string
  /** Learner-safe relative path (posix); never absolute, never secret. */
  displayPath: string
  kind: FileTouchKind
  kindLabel: string
}>

export type FileTouchPresentation = Readonly<{
  /** Stable non-evidence label for UI chrome. */
  title: string
  /** Explicitly not teaching outcome evidence. */
  role: 'reference_projection'
  caption: string
  rows: readonly FileTouchDisplayRow[]
  empty: boolean
}>

export const FILE_TOUCH_UI_TITLE = '本回合触碰的文件'
export const FILE_TOUCH_UI_CAPTION =
  '参考投影（压缩/工具触碰记录），不是教学结果证据'

const TOOL_PATH_ARG_KEYS = ['path', 'file_path', 'filepath', 'filePath'] as const

export const DEFAULT_FILE_TOUCH_UI_MAX_ENTRIES = DEFAULT_FILE_TOUCH_MAX_ENTRIES
export const DEFAULT_FILE_TOUCH_UI_MAX_PATH_CHARS = DEFAULT_FILE_TOUCH_MAX_PATH_CHARS

export type ProjectFileTouchesOptions = Readonly<{
  maxEntries?: number
  maxPathChars?: number
}>

/**
 * Classify a tool name into a file-touch kind when it targets a single path.
 * Dead aliases such as apply_patch are intentionally omitted.
 */
export function classifyFileTouchToolForUi(toolName: string): FileTouchKind | null {
  return classifyFileTouchTool(toolName)
}

/**
 * Lexical path sanitization for learner display (shared sanitize + secret drop).
 */
export function sanitizeFileTouchDisplayPath(
  raw: unknown,
  maxPathChars: number = DEFAULT_FILE_TOUCH_UI_MAX_PATH_CHARS
): string | null {
  return sanitizeFileTouchDisplayPathShared(raw, maxPathChars)
}

/**
 * Merge ledger-shaped entries: sticky `modified`, later order wins recency.
 * Drops unsanitizable paths entirely (never mid-path truncate).
 */
export function mergeFileTouchEntriesForUi(
  entries: readonly FileTouchLedgerEntryDto[],
  options?: ProjectFileTouchesOptions
): FileTouchLedgerEntryDto[] {
  const maxEntries = clampFileTouchInt(
    options?.maxEntries,
    1,
    10_000,
    DEFAULT_FILE_TOUCH_UI_MAX_ENTRIES
  )
  const maxPathChars = clampFileTouchInt(
    options?.maxPathChars,
    16,
    4_096,
    DEFAULT_FILE_TOUCH_UI_MAX_PATH_CHARS
  )
  const byPath = new Map<string, FileTouchLedgerEntryDto>()

  for (const entry of entries) {
    const path = sanitizeFileTouchDisplayPath(entry.path, maxPathChars)
    if (!path) continue
    const kind: FileTouchKind = entry.kind === 'modified' ? 'modified' : 'read'
    const order =
      typeof entry.order === 'number' && Number.isFinite(entry.order)
        ? Math.floor(entry.order)
        : 0
    const prev = byPath.get(path)
    if (!prev) {
      byPath.set(path, { path, kind, order })
      continue
    }
    byPath.set(path, {
      path,
      kind: stickyFileTouchKind(prev.kind, kind),
      order: Math.max(prev.order ?? 0, order)
    })
  }

  const sorted = [...byPath.values()].sort((a, b) => {
    const ao = a.order ?? 0
    const bo = b.order ?? 0
    if (ao !== bo) return ao - bo
    return a.path.localeCompare(b.path)
  })

  return sorted.length <= maxEntries
    ? sorted
    : sorted.slice(sorted.length - maxEntries)
}

/**
 * Project ledger DTO → learner presentation rows.
 */
export function projectFileTouchesForLearner(
  ledger: FileTouchLedgerDto | AgentFileTouchMetadata | null | undefined,
  options?: ProjectFileTouchesOptions
): FileTouchPresentation {
  const rawEntries = extractLedgerEntries(ledger)
  const merged = mergeFileTouchEntriesForUi(rawEntries, options)
  const rows: FileTouchDisplayRow[] = merged.map((entry, index) => ({
    id: `file-touch:${entry.kind}:${entry.path}:${index}`,
    displayPath: entry.path,
    kind: entry.kind,
    kindLabel: kindLabelZh(entry.kind)
  }))
  return {
    title: FILE_TOUCH_UI_TITLE,
    role: 'reference_projection',
    caption: FILE_TOUCH_UI_CAPTION,
    rows,
    empty: rows.length === 0
  }
}

/**
 * Rebuild a ledger-shaped DTO from durable tool call views (success only).
 * Used when turn metadata is absent (live stream) or as audit fallback.
 */
export function rebuildFileTouchLedgerFromToolCalls(
  toolCalls: ReadonlyArray<{
    id: string
    name: string
    arguments: string
    result?: string
    isError?: boolean
  }> | undefined,
  options?: ProjectFileTouchesOptions
): FileTouchLedgerDto {
  if (!toolCalls?.length) return { entries: [] }
  const batch: FileTouchLedgerEntryDto[] = []
  let order = 0
  for (const call of toolCalls) {
    if (call.isError || call.result === undefined) continue
    if (toolContentLooksLikeError(call.result)) continue
    const kind = classifyFileTouchToolForUi(call.name)
    if (!kind) continue
    const path = pathFromToolArguments(call.arguments)
    if (!path) continue
    batch.push({ path, kind, order })
    order += 1
  }
  return { entries: mergeFileTouchEntriesForUi(batch, options) }
}

/**
 * Compact metadata payload for durable turns (reference projection only).
 */
export function buildAgentFileTouchMetadata(
  ledger: FileTouchLedgerDto | null | undefined,
  options?: ProjectFileTouchesOptions
): AgentFileTouchMetadata | undefined {
  const merged = mergeFileTouchEntriesForUi(ledger?.entries ?? [], options)
  if (merged.length === 0) return undefined
  return {
    role: 'reference_projection',
    files: merged.map((e) => ({ path: e.path, kind: e.kind }))
  }
}

/**
 * Normalize untrusted JSON into AgentFileTouchMetadata (or undefined).
 */
export function normalizeAgentFileTouchMetadata(
  value: unknown,
  options?: ProjectFileTouchesOptions
): AgentFileTouchMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.role !== 'reference_projection') return undefined
  const filesRaw = record.files
  if (!Array.isArray(filesRaw)) return undefined
  const entries: FileTouchLedgerEntryDto[] = []
  let order = 0
  for (const item of filesRaw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const path = typeof row.path === 'string' ? row.path : ''
    const kind = row.kind === 'modified' ? 'modified' : row.kind === 'read' ? 'read' : null
    if (!path || !kind) continue
    entries.push({ path, kind, order })
    order += 1
  }
  return buildAgentFileTouchMetadata({ entries }, options)
}

function extractLedgerEntries(
  ledger: FileTouchLedgerDto | AgentFileTouchMetadata | null | undefined
): FileTouchLedgerEntryDto[] {
  if (!ledger) return []
  if ('entries' in ledger && Array.isArray(ledger.entries)) {
    return [...ledger.entries]
  }
  if ('files' in ledger && Array.isArray(ledger.files)) {
    return ledger.files.map((f, order) => ({
      path: f.path,
      kind: f.kind === 'modified' ? 'modified' : 'read',
      order
    }))
  }
  return []
}

function pathFromToolArguments(raw: string): string | undefined {
  if (!raw || !raw.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as Record<string, unknown>
  for (const key of TOOL_PATH_ARG_KEYS) {
    const value = record[key]
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function toolContentLooksLikeError(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  if (/^error\b/i.test(trimmed)) return true
  try {
    const parsed = JSON.parse(trimmed) as { error?: unknown; isError?: unknown }
    if (parsed && typeof parsed === 'object') {
      if (parsed.isError === true) return true
      if (typeof parsed.error === 'string' && parsed.error.trim()) return true
    }
  } catch {
    // not JSON
  }
  return false
}

function kindLabelZh(kind: FileTouchKind): string {
  return kind === 'modified' ? '已修改' : '已读取'
}




