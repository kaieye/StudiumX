import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { reconcileLearningWorkLedger } from './lib/learning-work-reconcile.mjs'

const root = await mkdtemp(join(tmpdir(), 'studiumx-ledger-reconcile-'))
const outside = await mkdtemp(join(tmpdir(), 'studiumx-ledger-outside-'))

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
  await symlink(join(outside, 'escaped.json'), join(root, 'conversations', 'escaped.json'))

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
  const unsafeEntry = {
    ...baseEntry,
    entryId: 'entry-2',
    conversation: { ...baseEntry.conversation, id: 'conversation-2' },
    pointers: {
      markdown: 'conversations/missing.md',
      materializedJson: 'conversations/escaped.json',
      sessionAudit: '../outside.jsonl'
    }
  }
  await writeFile(
    join(root, '.studiumx', 'learning-work.jsonl'),
    [JSON.stringify(baseEntry), JSON.stringify(baseEntry), JSON.stringify(unsafeEntry), '{bad json'].join('\n')
  )

  const result = await reconcileLearningWorkLedger(root)
  assert.equal(result.status, 'issues')
  assert.equal(result.entries, 3)
  assert.equal(result.conversations, 2)
  assert.equal(result.issues.invalidLines, 1)
  assert.equal(result.issues.duplicateEntries, 1)
  assert.equal(result.issues.missingPointers.markdown, 1)
  assert.equal(result.issues.unsafePointers, 2)
  assert.equal(result.issues.staleSnapshots, 1)

  const missing = await reconcileLearningWorkLedger(outside)
  assert.equal(missing.status, 'not_found')
  assert.equal(missing.exists, false)

  console.log('learning work ledger reconcile ok')
} finally {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
}
