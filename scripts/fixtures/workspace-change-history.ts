import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { TeachingWorkspaceChangeHistoryStore } from '../../src/main/teaching-workspace-change-history'
import type { TeachingWorkspaceChangeSummary } from '../../src/shared/teaching-types'

function change(workspaceId: string, index: number): TeachingWorkspaceChangeSummary {
  return {
    id: `change-${index}`,
    workspaceId,
    timestamp: new Date(Date.UTC(2026, 6, 12, 0, 0, index)).toISOString(),
    trigger: { kind: 'mission_update', label: `Change ${index}` },
    changedFiles: [{
      relativePath: 'MISSION.md',
      status: 'modified',
      fileKind: 'mission',
      additions: index,
      deletions: 0,
      diffAvailable: true
    }],
    additions: index,
    deletions: 0,
    summary: `Change ${index}`,
    checkpoint: {
      repositoryRoot: '/workspace',
      workspaceInRepository: '.',
      beforeCommitOid: 'a'.repeat(40),
      afterCommitOid: 'b'.repeat(40)
    },
    git: { available: true }
  }
}

const root = await mkdtemp(join(tmpdir(), 'studiumx-workspace-change-history-'))
const filePath = join(root, 'nested', 'workspace-change-history.json')

try {
  const store = new TeachingWorkspaceChangeHistoryStore({ filePath })
  await Promise.all(Array.from({ length: 22 }, (_, index) => store.append('workspace-a', change('workspace-a', index))))
  await store.append('workspace-b', change('workspace-b', 1))

  const workspaceA = await store.list('workspace-a')
  assert.equal(workspaceA.length, 20)
  assert.equal(workspaceA[0]?.id, 'change-21')
  assert.equal(workspaceA.at(-1)?.id, 'change-2')
  assert.equal((await store.latest('workspace-a'))?.id, 'change-21')
  assert.equal((await store.get('workspace-a', 'change-10'))?.summary, 'Change 10')
  assert.equal(await store.get('workspace-a', 'missing'), null)
  assert.equal((await store.list('workspace-b')).length, 1)

  await store.append('workspace-a', { ...change('workspace-a', 21), summary: 'Updated change' })
  assert.equal((await store.list('workspace-a')).length, 20)
  assert.equal((await store.latest('workspace-a'))?.summary, 'Updated change')

  const reloaded = new TeachingWorkspaceChangeHistoryStore({ filePath })
  assert.equal((await reloaded.list('workspace-a')).length, 20)
  assert.equal((await reloaded.latest('workspace-a'))?.checkpoint?.beforeCommitOid, 'a'.repeat(40))
  assert.equal(JSON.parse(await readFile(filePath, 'utf8')).version, 1)

  await assert.rejects(
    store.append('workspace-b', change('workspace-a', 30)),
    /does not belong/
  )

  await writeFile(filePath, '{broken json', 'utf8')
  assert.deepEqual(await reloaded.list('workspace-a'), [])
  await reloaded.append('workspace-a', change('workspace-a', 40))
  assert.equal((await reloaded.latest('workspace-a'))?.id, 'change-40')
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('workspace change history ok')
