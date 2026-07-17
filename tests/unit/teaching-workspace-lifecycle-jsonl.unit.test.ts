import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { durableJsonlSealedSegmentFileName } from '../../src/main/durable-jsonl'
import {
  appendWorkspaceLifecycleEvent,
  readWorkspaceLifecycleEvents,
  WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH,
  type WorkspaceLifecycleEvent
} from '../../src/main/teaching-workspace/lifecycle'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function lifecycleEvent(id: string): WorkspaceLifecycleEvent {
  return {
    id,
    kind: 'lesson_generated',
    timestamp: '2026-07-17T00:00:00.000Z',
    workspaceId: 'workspace-1'
  }
}

describe('workspace lifecycle JSONL', () => {
  it('reads strict sealed lifecycle segments before the active filename', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-workspace-lifecycle-'))
    roots.push(rootPath)
    const ledgerDirectory = join(rootPath, '.studiumx')
    await mkdir(ledgerDirectory, { recursive: true })
    const sealed = lifecycleEvent('sealed-event')
    await writeFile(
      join(ledgerDirectory, durableJsonlSealedSegmentFileName('sessions.jsonl', '2026-06', 1)),
      `${JSON.stringify(sealed)}\n`,
      'utf8'
    )
    await writeFile(
      join(ledgerDirectory, 'sessions.sealed-2026-06-00001.jsonl'),
      `${JSON.stringify(lifecycleEvent('ignored-lookalike'))}\n`,
      'utf8'
    )

    await appendWorkspaceLifecycleEvent(rootPath, lifecycleEvent('active-event'))

    await expect(readWorkspaceLifecycleEvents(rootPath)).resolves.toEqual([sealed, lifecycleEvent('active-event')])
    await expect(readFile(join(rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH), 'utf8')).resolves.toContain('active-event')
  })
})
