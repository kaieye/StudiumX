import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { AgentConversationRecord } from '../shared/teaching-types'
import {
  buildLearningWorkEvidenceSnapshot,
  type LearningWorkLedgerSnapshot
} from './learning-work-ledger/evidence-snapshot'

export const LEARNING_WORK_LEDGER_RELATIVE_PATH = '.studiumx/learning-work.jsonl'

export type LearningWorkLedgerSnapshotInput = {
  rootPath: string
  workspace: { id?: string; name: string }
  conversation: AgentConversationRecord
}

const pendingAppends = new Map<string, Promise<void>>()

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

async function appendSnapshotOnce(ledgerPath: string, snapshot: LearningWorkLedgerSnapshot): Promise<void> {
  const previous = pendingAppends.get(ledgerPath) ?? Promise.resolve()
  const append = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(ledgerPath), { recursive: true })
    if (await ledgerEntryExists(ledgerPath, snapshot.entryId)) return

    const file = await open(ledgerPath, 'a', 0o600)
    try {
      await file.writeFile(`${JSON.stringify(snapshot)}\n`, 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
  })

  pendingAppends.set(ledgerPath, append)
  try {
    await append
  } finally {
    if (pendingAppends.get(ledgerPath) === append) pendingAppends.delete(ledgerPath)
  }
}

async function ledgerEntryExists(path: string, entryId: string): Promise<boolean> {
  const content = await readFile(path, 'utf8').catch(() => '')
  return content.split(/\r?\n/).some((line) => {
    if (!line.trim()) return false
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
