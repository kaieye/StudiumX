import { join } from 'node:path'

import type { AgentConversationRecord } from '../shared/teaching-types'
import {
  buildLearningWorkEvidenceSnapshot,
  type LearningWorkLedgerSnapshot
} from './learning-work-ledger/evidence-snapshot'
import { appendDurableJsonlLine, readDurableJsonlLines } from './durable-jsonl'

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
}): Promise<void> {
  await LearningWorkLedger.appendSnapshot({
    rootPath: options.rootPath,
    workspace: options.workspace,
    conversation: options.record
  })
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

async function appendSnapshotOnce(ledgerPath: string, snapshot: LearningWorkLedgerSnapshot): Promise<void> {
  const previous = pendingSnapshotAppends.get(ledgerPath) ?? Promise.resolve()
  const append = previous.catch(() => undefined).then(async () => {
    if (await ledgerEntryExists(ledgerPath, snapshot.entryId)) return
    await appendDurableJsonlLine({ activePath: ledgerPath }, JSON.stringify(snapshot))
  })
  pendingSnapshotAppends.set(ledgerPath, append)
  try {
    await append
  } finally {
    if (pendingSnapshotAppends.get(ledgerPath) === append) pendingSnapshotAppends.delete(ledgerPath)
  }
}

async function ledgerEntryExists(path: string, entryId: string): Promise<boolean> {
  const lines = await readDurableJsonlLines(path)
  return lines.some((line) => {
    const parsed = safeParseJson(line)
    return Boolean(parsed && typeof parsed === 'object' && (parsed as { entryId?: unknown }).entryId === entryId)
  })
}

function safeParseJson(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
