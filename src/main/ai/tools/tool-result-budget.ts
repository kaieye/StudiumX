/**
 * Turn-level tool result aggregation budget + spill-to-preview.
 *
 * Layering (distinct from ADR-0041):
 *   1. Per-tool hard byte budget — annotations.enforceToolResultBudget (32KiB default)
 *   2. Turn aggregate char budget — this module (default 200_000 chars)
 *
 * When a turn's model-facing tool results exceed the aggregate budget, the
 * largest non-spilled results are written under a path-access sandboxed
 * directory (.studiumx/tool-results/<runId>/) and replaced with a short
 * preview + relative pointer. Absolute host paths never leave this module
 * toward the model transcript or learner UI.
 *
 * Anti-loop: tools that re-read spill artifacts (read_workspace_file and
 * aliases) are pinned so their results are never spilled, preventing
 * persist → read → persist amplification.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { isPathInsideRoot } from '../../path-access'
import { sanitizeRunId } from './write-rewind-journal'

/** Aggregate chars across all tool results in one model turn. */
export const DEFAULT_TURN_TOOL_RESULT_BUDGET_CHARS = 200_000
/** Inline preview size after spill (characters, not bytes). */
export const DEFAULT_TOOL_RESULT_PREVIEW_CHARS = 1_500
/** Optional per-result soft threshold before forced spill (Hermes layer 2). */
export const DEFAULT_PER_RESULT_PERSIST_CHARS = 100_000

export const SPILLED_OUTPUT_OPEN = '<spilled-tool-result>'
export const SPILLED_OUTPUT_CLOSE = '</spilled-tool-result>'

/**
 * Tools whose outputs must never be spilled. Reading a spill file must not
 * re-trigger spill, or the model enters a persist→read→persist loop.
 */
export const TURN_BUDGET_PINNED_TOOLS: ReadonlySet<string> = new Set([
  'read_workspace_file',
  'read_skill_resource'
])

export type ToolResultTurnBudgetConfig = Readonly<{
  turnBudgetChars: number
  previewChars: number
  /** Soft per-result size that may force spill even under turn budget. */
  perResultPersistChars: number
}>

export type ToolResultTurnEntry = Readonly<{
  toolCallId: string
  name: string
  content: string
  isError?: boolean
}>

export type ToolResultTurnBudgetContext = Readonly<{
  workspaceRoot: string
  runId: string
  config?: Partial<ToolResultTurnBudgetConfig>
  /**
   * Optional writer for tests. Must only accept absolute paths already proven
   * inside the spill directory (callers use resolveSpillAbsolutePath).
   */
  writeSpillFile?: (absolutePath: string, content: string) => Promise<void>
}>

export type ToolResultTurnBudgetOutcome = Readonly<{
  entries: ToolResultTurnEntry[]
  totalCharsBefore: number
  totalCharsAfter: number
  spilled: ReadonlyArray<{
    toolCallId: string
    name: string
    originalChars: number
    relativePath: string
  }>
  /** True when spill was needed but could not complete (inline fallback). */
  spillUnavailable: boolean
}>

export function defaultToolResultTurnBudgetConfig(
  overrides?: Partial<ToolResultTurnBudgetConfig>
): ToolResultTurnBudgetConfig {
  return {
    turnBudgetChars: normalizePositiveInt(
      overrides?.turnBudgetChars,
      DEFAULT_TURN_TOOL_RESULT_BUDGET_CHARS
    ),
    previewChars: normalizePositiveInt(
      overrides?.previewChars,
      DEFAULT_TOOL_RESULT_PREVIEW_CHARS
    ),
    perResultPersistChars: normalizePositiveInt(
      overrides?.perResultPersistChars,
      DEFAULT_PER_RESULT_PERSIST_CHARS
    )
  }
}

export function toolResultSpillDirectory(workspaceRoot: string, runId: string): string {
  return join(resolve(workspaceRoot), '.studiumx', 'tool-results', sanitizeRunId(runId))
}

/**
 * Relative path (posix, workspace-rooted) shown to the model. Never absolute.
 */
export function toolResultSpillRelativePath(runId: string, toolCallId: string): string {
  return `.studiumx/tool-results/${sanitizeRunId(runId)}/${safeResultFilename(toolCallId)}`
}

export function isSpilledToolResultContent(content: string): boolean {
  return content.includes(SPILLED_OUTPUT_OPEN)
}

export function isTurnBudgetPinnedTool(toolName: string): boolean {
  return TURN_BUDGET_PINNED_TOOLS.has(toolName)
}

export function generateToolResultPreview(
  content: string,
  maxChars: number = DEFAULT_TOOL_RESULT_PREVIEW_CHARS
): { preview: string; hasMore: boolean } {
  const limit = Math.max(0, Math.floor(maxChars))
  if (content.length <= limit) return { preview: content, hasMore: false }
  let truncated = content.slice(0, limit)
  const lastNl = truncated.lastIndexOf('\n')
  if (lastNl > limit / 2) truncated = truncated.slice(0, lastNl + 1)
  return { preview: truncated, hasMore: true }
}

export function buildSpilledToolResultMessage(input: {
  preview: string
  hasMore: boolean
  originalChars: number
  relativePath: string
}): string {
  const sizeLabel = formatCharSize(input.originalChars)
  const lines = [
    SPILLED_OUTPUT_OPEN,
    `This tool result was too large (${input.originalChars.toLocaleString('en-US')} characters, ${sizeLabel}).`,
    `Full output saved to workspace-relative path: ${input.relativePath}`,
    'Use read_workspace_file with offset/limit to inspect sections. Do not request the entire file at once.',
    '',
    `Preview (first ${input.preview.length} chars):`,
    input.preview
  ]
  if (input.hasMore) lines.push('...')
  lines.push(SPILLED_OUTPUT_CLOSE)
  return lines.join('\n')
}

/**
 * Enforce per-result soft persist threshold (layer 2) then turn aggregate
 * budget (layer 3). Entries are returned in the same order as input.
 *
 * When workspaceRoot / runId are missing, oversized results fall back to
 * inline preview truncation without writing files (no absolute path leak).
 */
export async function enforceToolResultTurnBudget(
  entries: readonly ToolResultTurnEntry[],
  context: ToolResultTurnBudgetContext
): Promise<ToolResultTurnBudgetOutcome> {
  const config = defaultToolResultTurnBudgetConfig(context.config)
  const workspaceRoot = context.workspaceRoot?.trim()
  const runId = context.runId?.trim()
  const canSpill = Boolean(workspaceRoot && runId)

  let working: ToolResultTurnEntry[] = entries.map((entry) => ({ ...entry }))
  const spilled: Array<{
    toolCallId: string
    name: string
    originalChars: number
    relativePath: string
  }> = []
  let spillUnavailable = false

  const totalCharsBefore = sumChars(working)

  // Layer 2: soft per-result persist for oversized non-pinned results.
  for (let i = 0; i < working.length; i += 1) {
    const entry = working[i]
    if (shouldSkipSpill(entry)) continue
    if (entry.content.length <= config.perResultPersistChars) continue
    const result = await trySpillEntry(entry, {
      workspaceRoot: workspaceRoot ?? '',
      runId: runId ?? '',
      canSpill,
      config,
      writeSpillFile: context.writeSpillFile
    })
    working[i] = result.entry
    if (result.spilled) spilled.push(result.spilled)
    if (result.spillUnavailable) spillUnavailable = true
  }

  // Layer 3: aggregate turn budget — spill largest remaining non-spilled first.
  let total = sumChars(working)
  if (total > config.turnBudgetChars) {
    const candidates = working
      .map((entry, index) => ({ entry, index, size: entry.content.length }))
      .filter(({ entry }) => !shouldSkipSpill(entry))
      .sort((a, b) => b.size - a.size)

    for (const candidate of candidates) {
      if (total <= config.turnBudgetChars) break
      const entry = working[candidate.index]
      const result = await trySpillEntry(entry, {
        workspaceRoot: workspaceRoot ?? '',
        runId: runId ?? '',
        canSpill,
        config,
        writeSpillFile: context.writeSpillFile,
        /** Force spill regardless of per-result threshold. */
        force: true
      })
      if (result.entry.content === entry.content) {
        if (result.spillUnavailable) spillUnavailable = true
        continue
      }
      total = total - entry.content.length + result.entry.content.length
      working[candidate.index] = result.entry
      if (result.spilled) spilled.push(result.spilled)
      if (result.spillUnavailable) spillUnavailable = true
    }
  }

  return {
    entries: working,
    totalCharsBefore,
    totalCharsAfter: sumChars(working),
    spilled,
    spillUnavailable
  }
}

function shouldSkipSpill(entry: ToolResultTurnEntry): boolean {
  if (entry.isError) return true
  if (isTurnBudgetPinnedTool(entry.name)) return true
  if (isSpilledToolResultContent(entry.content)) return true
  return false
}

async function trySpillEntry(
  entry: ToolResultTurnEntry,
  opts: {
    workspaceRoot: string
    runId: string
    canSpill: boolean
    config: ToolResultTurnBudgetConfig
    writeSpillFile?: (absolutePath: string, content: string) => Promise<void>
    force?: boolean
  }
): Promise<{
  entry: ToolResultTurnEntry
  spilled?: { toolCallId: string; name: string; originalChars: number; relativePath: string }
  spillUnavailable: boolean
}> {
  const originalChars = entry.content.length
  if (!opts.force && originalChars <= opts.config.perResultPersistChars) {
    return { entry, spillUnavailable: false }
  }

  const { preview, hasMore } = generateToolResultPreview(entry.content, opts.config.previewChars)

  if (!opts.canSpill || !opts.workspaceRoot || !opts.runId) {
    return {
      entry: {
        ...entry,
        content: buildInlineFallbackMessage(preview, hasMore, originalChars)
      },
      spillUnavailable: true
    }
  }

  const relativePath = toolResultSpillRelativePath(opts.runId, entry.toolCallId)
  const absolutePath = resolveSpillAbsolutePath(opts.workspaceRoot, opts.runId, entry.toolCallId)
  if (!absolutePath) {
    return {
      entry: {
        ...entry,
        content: buildInlineFallbackMessage(preview, hasMore, originalChars)
      },
      spillUnavailable: true
    }
  }

  try {
    await mkdir(toolResultSpillDirectory(opts.workspaceRoot, opts.runId), { recursive: true })
    const writer =
      opts.writeSpillFile ??
      (async (path: string, content: string) => {
        await writeFile(path, content, 'utf8')
      })
    await writer(absolutePath, entry.content)
    return {
      entry: {
        ...entry,
        content: buildSpilledToolResultMessage({
          preview,
          hasMore,
          originalChars,
          relativePath
        })
      },
      spilled: {
        toolCallId: entry.toolCallId,
        name: entry.name,
        originalChars,
        relativePath
      },
      spillUnavailable: false
    }
  } catch {
    return {
      entry: {
        ...entry,
        content: buildInlineFallbackMessage(preview, hasMore, originalChars)
      },
      spillUnavailable: true
    }
  }
}

/**
 * Resolve and prove spill absolute path stays under workspaceRoot + spill dir.
 * Returns null on any containment failure (fail closed → inline fallback).
 */
export function resolveSpillAbsolutePath(
  workspaceRoot: string,
  runId: string,
  toolCallId: string
): string | null {
  const root = resolve(workspaceRoot)
  if (!root.trim()) return null
  const dir = toolResultSpillDirectory(root, runId)
  const absolutePath = join(dir, safeResultFilename(toolCallId))
  if (!isPathInsideRoot(root, dir)) return null
  if (!isPathInsideRoot(root, absolutePath)) return null
  if (!isPathInsideRoot(dir, absolutePath)) return null
  return absolutePath
}

function buildInlineFallbackMessage(preview: string, hasMore: boolean, originalChars: number): string {
  return [
    preview,
    hasMore ? '...' : '',
    '',
    `[Truncated: tool response was ${originalChars.toLocaleString('en-US')} chars. Full output could not be spilled under the workspace sandbox.]`
  ]
    .filter((line, index, arr) => !(line === '...' && arr[index - 1] === ''))
    .join('\n')
}

function safeResultFilename(toolCallId: string): string {
  const raw = String(toolCallId || 'tool_result')
  let stem = raw.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '')
  let changed = stem !== raw
  if (!stem) {
    stem = 'tool_result'
    changed = true
  }
  const maxStem = 120
  if (changed || stem.length > maxStem) {
    // Short stable suffix without importing crypto for every tiny path — use
    // a deterministic djb2-ish hash so collisions still stay single-file.
    const digest = simpleDigest(raw).slice(0, 12)
    stem = `${stem.slice(0, maxStem).replace(/[._-]+$/g, '') || 'tool_result'}_${digest}`
  }
  return `${stem}.txt`
}

function simpleDigest(value: string): string {
  // FNV-1a 32-bit → hex; sufficient for filename disambiguation, not security.
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sumChars(entries: readonly ToolResultTurnEntry[]): number {
  let total = 0
  for (const entry of entries) total += entry.content.length
  return total
}

function formatCharSize(chars: number): string {
  const kb = chars / 1024
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb.toFixed(1)} KB`
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}
