import { join } from 'node:path'

import { traceIdsMatchForIdempotency } from '../shared/trace-context'
import type { AgentConversationRecord } from '../shared/teaching-types'
import {
  buildLearningWorkEvidenceSnapshot,
  type LearningWorkLedgerSnapshot
} from './learning-work-ledger/evidence-snapshot'
import { appendDurableJsonlLine, readDurableJsonlLines } from './durable-jsonl'
import { assertLearningWorkCanonicalEntry } from '../shared/event-density-policy'

export const LEARNING_WORK_LEDGER_RELATIVE_PATH = '.studiumx/learning-work.jsonl'

export type LearningWorkLedgerSnapshotInput = {
  rootPath: string
  workspace: { id?: string; name: string }
  conversation: AgentConversationRecord
}

const pendingSnapshotAppends = new Map<string, Promise<void>>()

/**
 * The single production seam for local learning-work snapshots. It owns the
 * compact conversation projection, stable snapshot identity, JSONL de-duplication,
 * and a synced append to the Teaching workspace ledger.
 */
export const LearningWorkLedger = {
  async appendSnapshot(input: LearningWorkLedgerSnapshotInput): Promise<void> {
    const snapshot = buildLearningWorkEvidenceSnapshot(input.workspace, input.conversation)
    const ledgerPath = join(input.rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH)
    await appendSnapshotOnce(ledgerPath, snapshot)
  }
} as const

/**
 * Compatibility entry point for archive callers that still name the conversation
 * record `record`. New callers should use LearningWorkLedger.appendSnapshot.
 */
export async function appendLearningWorkLedgerSnapshot(options: {
  rootPath: string
  workspace: { id?: string; name: string }
  record: AgentConversationRecord
  /** Runs after identity collision checks and before the ledger append decision. */
  beforeAppend?: () => Promise<void>
}): Promise<void> {
  const snapshot = buildLearningWorkEvidenceSnapshot(options.workspace, options.record)
  const ledgerPath = join(options.rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH)
  await appendSnapshotOnce(ledgerPath, snapshot, options.beforeAppend)
}

/**
 * Compatibility builder retained for archive verification. Snapshot construction
 * stays in the evidence projection module rather than leaking to callers.
 */
export function buildLearningWorkLedgerEntry(
  workspace: { id?: string; name: string },
  record: AgentConversationRecord
): LearningWorkLedgerSnapshot {
  return buildLearningWorkEvidenceSnapshot(workspace, record)
}

/** Reads all strict sealed segments followed by the active learning-work ledger. */
export async function readLearningWorkLedgerLines(rootPath: string): Promise<string[]> {
  return readDurableJsonlLines(join(rootPath, LEARNING_WORK_LEDGER_RELATIVE_PATH))
}

async function appendSnapshotOnce(
  ledgerPath: string,
  snapshot: LearningWorkLedgerSnapshot,
  beforeAppend?: () => Promise<void>
): Promise<void> {
  // DB-P1-3: refuse debug / stream kinds and non-snapshot rows before durable append.
  assertLearningWorkCanonicalEntry(snapshot)
  const previous = pendingSnapshotAppends.get(ledgerPath) ?? Promise.resolve()
  const append = previous.catch(() => undefined).then(async () => {
    const exists = await ledgerEntryExists(ledgerPath, snapshot)
    await beforeAppend?.()
    if (!exists) {
      assertLearningWorkCanonicalEntry(snapshot)
      await appendDurableJsonlLine({ activePath: ledgerPath }, JSON.stringify(snapshot))
    }
  })
  pendingSnapshotAppends.set(ledgerPath, append)
  try {
    await append
  } finally {
    if (pendingSnapshotAppends.get(ledgerPath) === append) pendingSnapshotAppends.delete(ledgerPath)
  }
}

async function ledgerEntryExists(path: string, expected: LearningWorkLedgerSnapshot): Promise<boolean> {
  const lines = await readDurableJsonlLines(path)
  let found = false
  for (const line of lines) {
    const parsed = safeParseJson(line)
    if (!parsed || typeof parsed !== 'object') continue
    const candidate = parsed as { entryId?: unknown; traceId?: unknown }
    if (candidate.entryId !== expected.entryId) continue
    found = true
    if (!traceIdsMatchForIdempotency(candidate.traceId, expected.traceId)) {
      throw new Error('Learning-work ledger snapshot identity is already bound to a different trace.')
    }
  }
  return found
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
