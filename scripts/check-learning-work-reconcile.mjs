import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { platform } from 'node:process'
import { join } from 'node:path'

import {
  mergeLearningWorkLedgerToLegacyActive,
  reconcileLearningWorkLedger
} from './lib/learning-work-reconcile.mjs'

const root = await mkdtemp(join(tmpdir(), 'studiumx-ledger-reconcile-'))
const outside = await mkdtemp(join(tmpdir(), 'studiumx-ledger-outside-'))
const sealedOnlyRoot = await mkdtemp(join(tmpdir(), 'studiumx-ledger-sealed-only-'))
const rollbackRoot = await mkdtemp(join(tmpdir(), 'studiumx-ledger-rollback-'))
const invalidRollbackRoot = await mkdtemp(join(tmpdir(), 'studiumx-ledger-invalid-rollback-'))

try {
  await mkdir(join(root, '.studiumx'), { recursive: true })
  await mkdir(join(root, 'conversations', '.agent-sessions'), { recursive: true })
  await writeFile(join(root, 'conversations', 'conversation.md'), '# Conversation\n')
  await writeFile(join(root, 'conversations', '.agent-sessions', 'conversation.jsonl'), '{}\n')
  await writeFile(join(root, 'conversations', 'conversation.json'), JSON.stringify({
    updatedAt: '2026-07-12T00:00:02.000Z',
    messageCount: 4
  }))
  await writeFile(join(outside, 'escaped.json'), '{}')
  await symlink(
    outside,
    join(root, 'conversations', 'escaped'),
    platform === 'win32' ? 'junction' : 'dir'
  )

  const baseEntry = {
    version: 1,
    entryId: 'entry-1',
    type: 'conversation_snapshot',
    createdAt: '2026-07-12T00:00:03.000Z',
    conversation: {
      id: 'conversation-1',
      updatedAt: '2026-07-12T00:00:01.000Z',
      messageCount: 3
    },
    pointers: {
      markdown: 'conversations/conversation.md',
      materializedJson: 'conversations/conversation.json',
      sessionAudit: 'conversations/.agent-sessions/conversation.jsonl'
    }
  }
  const sealedEntry = {
    ...baseEntry,
    entryId: 'entry-0',
    createdAt: '2026-07-12T00:00:00.000Z'
  }
  const unsafeEntry = {
    ...baseEntry,
    entryId: 'entry-2',
    conversation: { ...baseEntry.conversation, id: 'conversation-2' },
    pointers: {
      markdown: 'conversations/missing.md',
      materializedJson: 'conversations/escaped/escaped.json',
      sessionAudit: '../outside.jsonl'
    }
  }
  await writeFile(
    join(root, '.studiumx', 'learning-work.sealed-2026-06-000001.jsonl'),
    `${JSON.stringify(sealedEntry)}\n`
  )
  await writeFile(
    join(root, '.studiumx', 'learning-work.jsonl'),
    [JSON.stringify(baseEntry), JSON.stringify(baseEntry), JSON.stringify(unsafeEntry), '{bad json'].join('\n')
  )
  await writeFile(
    join(root, '.studiumx', 'learning-work.sealed-2026-06-00001.jsonl'),
    `${JSON.stringify({ ignored: 'not-a-strict-segment' })}\n`
  )

  const result = await reconcileLearningWorkLedger(root)
  assert.equal(result.status, 'issues')
  assert.equal(result.entries, 4)
  assert.equal(result.conversations, 2)
  assert.deepEqual(result.segments.map((segment) => segment.kind), ['sealed', 'active'])
  assert.equal(result.issues.invalidLines, 1)
  assert.equal(result.issues.duplicateEntries, 1)
  assert.equal(result.issues.missingPointers.markdown, 1)
  assert.equal(result.issues.unsafePointers, 2)
  assert.equal(result.issues.staleSnapshots, 1)

  await createValidSealedOnlyFixture(sealedOnlyRoot)
  const sealedOnly = await reconcileLearningWorkLedger(sealedOnlyRoot)
  assert.equal(sealedOnly.status, 'ok')
  assert.equal(sealedOnly.exists, true)
  assert.equal(sealedOnly.entries, 1)
  assert.equal(sealedOnly.conversations, 1)
  assert.deepEqual(sealedOnly.segments.map((segment) => segment.kind), ['sealed'])

  await mkdir(join(rollbackRoot, '.studiumx'), { recursive: true })
  const sealedPath = join(rollbackRoot, '.studiumx', 'learning-work.sealed-2026-06-000001.jsonl')
  const secondSealedPath = join(rollbackRoot, '.studiumx', 'learning-work.sealed-2026-07-000001.jsonl')
  const activePath = join(rollbackRoot, '.studiumx', 'learning-work.jsonl')
  const sealedContents = `${JSON.stringify({ id: 'sealed-first' })}\n`
  const secondSealedContents = `${JSON.stringify({ id: 'sealed-second' })}\n`
  const activeContents = `${JSON.stringify({ id: 'active-last' })}\n`
  await writeFile(sealedPath, sealedContents)
  await writeFile(secondSealedPath, secondSealedContents)
  await writeFile(activePath, activeContents)

  const rollback = await mergeLearningWorkLedgerToLegacyActive(rollbackRoot)
  assert.equal(rollback.sourceChecksum, rollback.outputChecksum)
  assert.equal(rollback.lines, 3)
  assert.deepEqual(rollback.sourceSegments.map((segment) => segment.kind), ['sealed', 'sealed', 'active'])
  assert.equal(await readFile(activePath, 'utf8'), `${sealedContents}${secondSealedContents}${activeContents}`)
  assert.equal(await readFile(sealedPath, 'utf8'), sealedContents)
  assert.equal(await readFile(secondSealedPath, 'utf8'), secondSealedContents)

  await mkdir(join(invalidRollbackRoot, '.studiumx'), { recursive: true })
  const invalidActivePath = join(invalidRollbackRoot, '.studiumx', 'learning-work.jsonl')
  const retainedSealedPath = join(invalidRollbackRoot, '.studiumx', 'learning-work.sealed-2026-07-000001.jsonl')
  const retainedSealedContents = `${JSON.stringify({ id: 'retained-sealed' })}\n`
  const invalidActiveContents = '{not-json}\n'
  await writeFile(retainedSealedPath, retainedSealedContents)
  await writeFile(invalidActivePath, invalidActiveContents)
  await assert.rejects(() => mergeLearningWorkLedgerToLegacyActive(invalidRollbackRoot), /invalid JSONL/)
  assert.equal(await readFile(invalidActivePath, 'utf8'), invalidActiveContents)
  assert.equal(await readFile(retainedSealedPath, 'utf8'), retainedSealedContents)

  const missing = await reconcileLearningWorkLedger(outside)
  assert.equal(missing.status, 'not_found')
  assert.equal(missing.exists, false)

  console.log('learning work ledger reconcile ok')
} finally {
  await Promise.all([root, outside, sealedOnlyRoot, rollbackRoot, invalidRollbackRoot].map((path) => rm(path, { recursive: true, force: true })))
}

async function createValidSealedOnlyFixture(rootPath) {
  await mkdir(join(rootPath, '.studiumx'), { recursive: true })
  await mkdir(join(rootPath, 'conversations', '.agent-sessions'), { recursive: true })
  await writeFile(join(rootPath, 'conversations', 'conversation.md'), '# Conversation\n')
  await writeFile(join(rootPath, 'conversations', '.agent-sessions', 'conversation.jsonl'), '{}\n')
  await writeFile(join(rootPath, 'conversations', 'conversation.json'), JSON.stringify({
    updatedAt: '2026-07-12T00:00:02.000Z',
    messageCount: 4
  }))
  await writeFile(join(rootPath, '.studiumx', 'learning-work.sealed-2026-07-000001.jsonl'), `${JSON.stringify({
    version: 1,
    entryId: 'sealed-only-entry',
    type: 'conversation_snapshot',
    createdAt: '2026-07-12T00:00:03.000Z',
    conversation: {
      id: 'sealed-only-conversation',
      updatedAt: '2026-07-12T00:00:02.000Z',
      messageCount: 4
    },
    pointers: {
      markdown: 'conversations/conversation.md',
      materializedJson: 'conversations/conversation.json',
      sessionAudit: 'conversations/.agent-sessions/conversation.jsonl'
    }
  })}\n`)
}
