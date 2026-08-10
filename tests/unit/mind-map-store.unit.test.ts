import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createMindMapStore } from '../../src/main/mindmap/mind-map-store'
import { mindMapDocumentV2Schema } from '../../src/shared/mindmap/domain/schema'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type { MindMapUpdateResult } from '../../src/shared/teaching-types/mindmap'

const createdRoots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mindmap-store-'))
  createdRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

/** Ensures distinct `Date.now()` milliseconds so updatedAt ordering is deterministic. */
async function tick(): Promise<void> {
  await new Promise((resolveTick) => setTimeout(resolveTick, 5))
}

function makeDocument(overrides: Partial<MindMapDocumentV2> = {}): MindMapDocumentV2 {
  const now = '2026-08-09T00:00:00.000Z'
  return {
    ...mindMapDocumentV2Schema.parse({
      schemaVersion: 2,
      id: 'doc-1',
      revision: 1,
      title: 'Test',
      createdAt: now,
      updatedAt: now,
      theme: { id: 'studiumx-default' },
      sheets: [
        {
          id: 'sheet-1',
          title: 'Sheet 1',
          root: { id: 'root-1', title: 'Root', children: [] },
          elements: [],
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        }
      ],
      assets: []
    }),
    ...overrides
  }
}

/** Assert a CAS update succeeded and return the persisted v2 document. */
function expectUpdateOk(result: MindMapUpdateResult): MindMapDocumentV2 {
  if (result.ok) return result.document
  throw new Error(
    `Unexpected revision conflict: expected ${result.expectedRevision}, current ${result.currentRevision}`
  )
}

describe('createMindMapStore', () => {
  it('create → read round-trips a new empty document', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)

    const created = await store.create('My mind map')

    expect(created.id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/)
    expect(created.title).toBe('My mind map')
    expect(created.sheets).toHaveLength(1)
    expect(created.sheets[0]!.root.title).toBe('My mind map')
    expect(created.sheets[0]!.root.children).toEqual([])

    const read = await store.read(created.id)
    expect(read).toEqual(created)
  })

  it('update stamps updatedAt and persists the change', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Before')

    const updated = expectUpdateOk(await store.update(created.id, {
      ...created,
      title: 'After',
      sheets: [
        {
          id: 'sheet-1',
          title: 'Sheet 1',
          root: { id: 'root-1', title: 'Root', children: [] },
          elements: [],
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        },
        {
          id: 'sheet-2',
          title: 'Sheet 2',
          root: { id: 'root-2', title: 'Root 2', children: [] },
          elements: [],
          layout: { structureClass: 'org.xmind.ui.logic.balanced' }
        }
      ]
    }, created.revision))

    expect(updated.title).toBe('After')
    expect(updated.updatedAt).toBeDefined()
    expect(updated.updatedAt > created.updatedAt).toBe(true)

    const read = await store.read(created.id)
    expect(read.title).toBe('After')
    expect(read.sheets).toHaveLength(2)
    expect(read.updatedAt).toBe(updated.updatedAt)
  })

  it('does not overwrite a confirmed update after a stale revision conflict', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Before')

    const confirmed = expectUpdateOk(
      await store.update(created.id, { ...created, title: 'Confirmed' }, created.revision)
    )
    expect(confirmed.revision).toBe(created.revision + 1)

    const stale = await store.update(
      created.id,
      { ...created, title: 'Stale overwrite attempt' },
      created.revision
    )
    expect(stale).toEqual({
      ok: false,
      code: 'revision_stale',
      expectedRevision: created.revision,
      currentRevision: confirmed.revision
    })

    const persisted = await store.read(created.id)
    expect(persisted.title).toBe('Confirmed')
    expect(persisted.revision).toBe(confirmed.revision)
  })

  it('serializes concurrent compare-and-swap updates for one document', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Before')

    // Both callers intentionally use the same revision.  The repository must
    // serialize the initial read + CAS check, not just the eventual file
    // rename, so exactly one update can claim revision 2.
    const [first, second] = await Promise.all([
      store.update(created.id, { ...created, title: 'First writer' }, created.revision),
      store.update(created.id, { ...created, title: 'Second writer' }, created.revision)
    ])

    const results = [first, second]
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)

    const conflict = results.find((result) => !result.ok)
    expect(conflict).toEqual({
      ok: false,
      code: 'revision_stale',
      expectedRevision: created.revision,
      currentRevision: created.revision + 1
    })

    const winner = results.find((result) => result.ok)
    if (!winner || !winner.ok) throw new Error('Expected one successful update')
    await expect(store.read(created.id)).resolves.toEqual(winner.document)
  })

  it('update rejects a document whose id does not match', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Doc')

    // Pass a different requested id than the document's own id.
    await expect(store.update('other-id', created, created.revision)).rejects.toThrow(/id mismatch/)
  })

  it('remove deletes the file', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('To delete')

    await store.remove(created.id)

    await expect(store.read(created.id)).rejects.toThrow()
    const files = await readdir(join(root, 'mindmaps'))
    expect(files).toHaveLength(0)
  })

  it('remove is idempotent on a missing file', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Doc')

    await store.remove(created.id)
    await expect(store.remove(created.id)).resolves.toBeUndefined()
  })

  it('list returns summaries sorted by updatedAt desc', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)

    const first = await store.create('first')
    await tick()
    const second = await store.create('second')
    await tick()
    const third = await store.create('third')

    // Force an ordering: update third last so it becomes the most recent.
    await tick()
    await expectUpdateOk(await store.update(third.id, { ...third, title: 'third updated' }, third.revision))
    await tick()
    await expectUpdateOk(await store.update(second.id, { ...second, title: 'second updated' }, second.revision))

    const list = await store.list()

    expect(list).toHaveLength(3)
    expect(list.map((s) => s.id)).toEqual([second.id, third.id, first.id])
    expect(list[0]!.title).toBe('second updated')
    expect(list[0]!.sheetCount).toBe(1)
    expect(list[0]!.updatedAt > list[1]!.updatedAt).toBe(true)
    expect(list[1]!.updatedAt > list[2]!.updatedAt).toBe(true)
  })

  it('invalid id is rejected by read/update/remove', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)

    await expect(store.read('../escape')).rejects.toThrow(/Invalid mind map id/)
    await expect(store.remove('../../etc/passwd')).rejects.toThrow(/Invalid mind map id/)

    const doc = makeDocument({ id: 'UPPERCASE' })
    await expect(store.update('UPPERCASE', doc, 1)).rejects.toThrow(/Invalid mind map id/)
  })

  it('replaces a crash-recovery journal before the next update', async () => {
    const root = await createRoot()
    const initialStore = createMindMapStore(root)
    const created = await initialStore.create('Before crash')

    // Simulate a process crash after the journal was published but before the
    // journal snapshot was renamed over the main document.
    const recovered = {
      ...created,
      revision: created.revision + 1,
      title: 'Recovered snapshot',
      updatedAt: '2026-08-09T00:00:01.000Z'
    }
    const journalPath = join(root, 'mindmaps', `.${created.id}.json.journal`)
    await writeFile(journalPath, JSON.stringify(recovered, null, 2))

    const store = createMindMapStore(root)
    await expect(store.read(created.id)).resolves.toEqual(recovered)

    const updated = expectUpdateOk(
      await store.update(
        created.id,
        { ...recovered, title: 'After recovery' },
        recovered.revision
      )
    )

    expect(updated.revision).toBe(recovered.revision + 1)
    expect(updated.title).toBe('After recovery')
    await expect(store.read(created.id)).resolves.toEqual(updated)
    await expect(
      readFile(join(root, 'mindmaps', `${created.id}.json`), 'utf8').then((content) =>
        JSON.parse(content)
      )
    ).resolves.toEqual(updated)
    await expect(readdir(join(root, 'mindmaps'))).resolves.toEqual([`${created.id}.json`])
  })

  it('durable write leaves no .tmp file after update', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Doc')

    await expectUpdateOk(await store.update(created.id, { ...created, title: 'Updated' }, created.revision))

    const files = await readdir(join(root, 'mindmaps'))
    expect(files).toHaveLength(1)
    expect(files[0]).toBe(`${created.id}.json`)
    expect(files[0]!.endsWith('.tmp')).toBe(false)
  })

  it('path containment blocks a traversal id', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)

    // A traversal id that could otherwise escape the mindmaps dir.
    await expect(store.read('..')).rejects.toThrow()
    await expect(store.read('a/b')).rejects.toThrow()
    await expect(store.read('a..b')).rejects.toThrow(/Invalid mind map id/)
  })
})
