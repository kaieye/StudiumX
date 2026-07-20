import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  captureAndAppendWritePreImage,
  readWriteRewindJournal,
  restoreWriteRewindJournal,
  sha256Utf8,
  writeRewindJournalPath
} from '../../src/main/ai/tools/write-rewind-journal'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-write-rewind-'))
  roots.push(root)
  await mkdir(join(root, 'notes'), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('write rewind journal', () => {
  it('captures create pre-image and restores by deleting matching content', async () => {
    const root = await workspace()
    const runId = 'run-create-1'
    const content = 'new notes body'

    const entry = await captureAndAppendWritePreImage({
      workspaceRoot: root,
      relativePath: 'notes/created.md',
      runId,
      content,
      nowIso: () => '2026-07-21T00:00:00.000Z'
    })
    expect(entry).toMatchObject({
      version: 1,
      runId,
      relativePath: 'notes/created.md',
      existed: false,
      preImageUtf8: null,
      writtenContentSha256: sha256Utf8(content)
    })

    await writeFile(join(root, 'notes', 'created.md'), content, 'utf8')
    const restored = await restoreWriteRewindJournal({ workspaceRoot: root, runId })
    expect(restored.deleted).toEqual(['notes/created.md'])
    expect(restored.restored).toEqual([])
    await expect(readFile(join(root, 'notes', 'created.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('is idempotent on first-touch path and restores overwrite pre-image', async () => {
    const root = await workspace()
    const runId = 'run-overwrite-1'
    const original = 'original body'
    const next = 'rewritten body'
    await writeFile(join(root, 'notes', 'entry.md'), original, 'utf8')

    const first = await captureAndAppendWritePreImage({
      workspaceRoot: root,
      relativePath: 'notes/entry.md',
      runId,
      content: next,
      nowIso: () => '2026-07-21T01:00:00.000Z'
    })
    const second = await captureAndAppendWritePreImage({
      workspaceRoot: root,
      relativePath: 'notes/entry.md',
      runId,
      content: 'later rewrite ignored for journal',
      nowIso: () => '2026-07-21T01:01:00.000Z'
    })
    expect(first?.existed).toBe(true)
    expect(first?.preImageUtf8).toBe(original)
    expect(second).toBeNull()

    const journal = await readWriteRewindJournal({ workspaceRoot: root, runId })
    expect(journal).toHaveLength(1)

    await writeFile(join(root, 'notes', 'entry.md'), next, 'utf8')
    const restored = await restoreWriteRewindJournal({ workspaceRoot: root, runId })
    expect(restored.restored).toEqual(['notes/entry.md'])
    expect(await readFile(join(root, 'notes', 'entry.md'), 'utf8')).toBe(original)
  })

  it('skips create-rewind when content changed since the journaled write', async () => {
    const root = await workspace()
    const runId = 'run-changed-1'
    await captureAndAppendWritePreImage({
      workspaceRoot: root,
      relativePath: 'notes/created.md',
      runId,
      content: 'published-by-tool'
    })
    await writeFile(join(root, 'notes', 'created.md'), 'user-edited-after-write', 'utf8')
    const restored = await restoreWriteRewindJournal({ workspaceRoot: root, runId })
    expect(restored.deleted).toEqual([])
    expect(restored.skipped).toEqual([
      { path: 'notes/created.md', reason: 'content_changed_since_write' }
    ])
    expect(await readFile(join(root, 'notes', 'created.md'), 'utf8')).toBe('user-edited-after-write')
  })

  it('writes journal under .studiumx/checkpoints/<runId>/write-journal.jsonl', async () => {
    const root = await workspace()
    await captureAndAppendWritePreImage({
      workspaceRoot: root,
      relativePath: 'notes/a.md',
      runId: 'run/with spaces',
      content: 'x'
    })
    const path = writeRewindJournalPath(root, 'run/with spaces')
    expect(path.replace(/\\/g, '/')).toContain('.studiumx/checkpoints/run_with_spaces/write-journal.jsonl')
    const text = await readFile(path, 'utf8')
    expect(text).toContain('"relativePath":"notes/a.md"')
  })
})