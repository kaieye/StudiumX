/**
 * Read-only usage analytics adapter.
 *
 * Aggregates only — never exposes raw JSONL lines, prompts, tool arguments,
 * or secret-bearing fields. SQLite projection is optional and disposable.
 */

import {
  readUsageLedgerSources,
  summarizeUsageEntries,
  usageLedgerActivePath,
  usageLedgerWorkspacePath,
  type UsageAnalyticsSummary,
  type UsageLedgerEntry
} from './usage-ledger'

export type UsageAnalyticsAdapterResult =
  | { state: 'readable'; summary: UsageAnalyticsSummary; source: 'sqlite_projection' | 'jsonl_ledger' }
  | { state: 'unavailable'; reason: string }

export type UsageAnalyticsProjectionReader = {
  summarize: () => Promise<
    | { state: 'readable'; summary: UsageAnalyticsSummary }
    | { state: 'unavailable' }
  >
}

export type ReadUsageAnalyticsInput = {
  appDataRoot: string
  /** Optional workspace roots whose .studiumx/usage.jsonl mirrors should be included. */
  workspaceRoots?: string[]
  /** Optional LocalDataIndex (or compatible) projection adapter. */
  projection?: UsageAnalyticsProjectionReader | null
}

/**
 * Prefer the disposable SQLite projection when available; fall back to canonical
 * JSONL usage ledgers. Never throws — callers get unavailable on all failures.
 */
export async function readUsageAnalyticsSummary(input: ReadUsageAnalyticsInput): Promise<UsageAnalyticsAdapterResult> {
  if (input.projection) {
    try {
      const projected = await input.projection.summarize()
      if (projected.state === 'readable') {
        return { state: 'readable', summary: projected.summary, source: 'sqlite_projection' }
      }
    } catch {
      // Projection is disposable; continue with file-truth fallback.
    }
  }

  try {
    const entries = await collectUsageLedgerEntries(input.appDataRoot, input.workspaceRoots ?? [])
    return { state: 'readable', summary: summarizeUsageEntries(entries), source: 'jsonl_ledger' }
  } catch (error) {
    return {
      state: 'unavailable',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

async function collectUsageLedgerEntries(appDataRoot: string, workspaceRoots: string[]): Promise<UsageLedgerEntry[]> {
  const byEntryId = new Map<string, UsageLedgerEntry>()
  const activePaths = [usageLedgerActivePath(appDataRoot), ...workspaceRoots.map(usageLedgerWorkspacePath)]
  for (const activePath of activePaths) {
    const sources = await readUsageLedgerSources(activePath)
    for (const source of sources) {
      for (const entry of source.entries) {
        if (!byEntryId.has(entry.entryId)) byEntryId.set(entry.entryId, entry)
      }
    }
  }
  return [...byEntryId.values()].sort(
    (left, right) => left.timestamp.localeCompare(right.timestamp) || left.entryId.localeCompare(right.entryId)
  )
}
