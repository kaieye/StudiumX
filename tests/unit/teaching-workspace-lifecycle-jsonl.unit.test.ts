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
const UPPERCASE_TRACE_ID = 'A0B1C2D3-E4F5-4A67-8B90-123456789ABC'
const CANONICAL_TRACE_ID = 'a0b1c2d3-e4f5-4a67-8b90-123456789abc'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function lifecycleEvent(id: string, overrides: Partial<WorkspaceLifecycleEvent> = {}): WorkspaceLifecycleEvent {
  return {
    id,
    kind: 'lesson_generated',
    timestamp: '2026-07-17T00:00:00.000Z',
    workspaceId: 'workspace-1',
    ...overrides
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

  it('persists only canonical normalized trace IDs and never leaks malformed trace input', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-workspace-lifecycle-'))
    roots.push(rootPath)
    const secretLikeTrace = 'Bearer secret-token-must-not-reach-jsonl'

    await appendWorkspaceLifecycleEvent(rootPath, lifecycleEvent('valid-trace', { traceId: UPPERCASE_TRACE_ID }))
    await appendWorkspaceLifecycleEvent(rootPath, lifecycleEvent('malformed-trace', { traceId: secretLikeTrace }))

    const rawJsonl = await readFile(join(rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH), 'utf8')
    const rawLines = rawJsonl
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as WorkspaceLifecycleEvent)

    expect(rawLines).toEqual([
      lifecycleEvent('valid-trace', { traceId: CANONICAL_TRACE_ID }),
      lifecycleEvent('malformed-trace')
    ])
    expect(rawJsonl).not.toContain(secretLikeTrace)
  })

  it('keeps legacy trace-free and malformed historical rows readable', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-workspace-lifecycle-'))
    roots.push(rootPath)
    const ledgerDirectory = join(rootPath, '.studiumx')
    const legacyTraceFree = lifecycleEvent('legacy-trace-free')
    const legacyMalformedTrace = lifecycleEvent('legacy-malformed-trace', {
      traceId: 'Bearer historical-secret-like-value'
    })
    await mkdir(ledgerDirectory, { recursive: true })
    await writeFile(
      join(rootPath, WORKSPACE_LIFECYCLE_LEDGER_RELATIVE_PATH),
      `${JSON.stringify(legacyTraceFree)}\n${JSON.stringify(legacyMalformedTrace)}\n`,
      'utf8'
    )

    await expect(readWorkspaceLifecycleEvents(rootPath)).resolves.toEqual([legacyTraceFree, legacyMalformedTrace])
  })
})
