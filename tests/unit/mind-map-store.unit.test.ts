import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createMindMapStore } from '../../src/main/mindmap/mind-map-store'
import { mindMapDocumentSchema } from '../../src/shared/mindmap/mind-map-schema'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'

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

function makeDocument(overrides: Partial<MindMapDocument> = {}): MindMapDocument {
  const now = '2026-08-09T00:00:00.000Z'
  return {
    ...mindMapDocumentSchema.parse({
      schemaVersion: 1,
      id: 'doc-1',
      title: 'Test',
      createdAt: now,
      updatedAt: now,
      sheets: [
        {
          id: 'sheet-1',
          title: 'Sheet 1',
          structureClass: 'org.xmind.ui.logic.right',
          root: { id: 'root-1', title: 'Root', children: [] }
        }
      ]
    }),
    ...overrides
  }
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

    const updated = await store.update(created.id, {
      ...created,
      title: 'After',
      sheets: [
        {
          id: 'sheet-1',
          title: 'Sheet 1',
          structureClass: 'org.xmind.ui.logic.right',
          root: { id: 'root-1', title: 'Root', children: [] }
        },
        {
          id: 'sheet-2',
          title: 'Sheet 2',
          structureClass: 'org.xmind.ui.logic.balanced',
          root: { id: 'root-2', title: 'Root 2', children: [] }
        }
      ]
    })

    expect(updated.title).toBe('After')
    expect(updated.updatedAt).toBeDefined()
    expect(updated.updatedAt > created.updatedAt).toBe(true)

    const read = await store.read(created.id)
    expect(read.title).toBe('After')
    expect(read.sheets).toHaveLength(2)
    expect(read.updatedAt).toBe(updated.updatedAt)
  })

  it('update rejects a document whose id does not match', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Doc')

    // Pass a different requested id than the document's own id.
    await expect(store.update('other-id', created)).rejects.toThrow(/id mismatch/)
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
    await store.update(third.id, { ...third, title: 'third updated' })
    await tick()
    await store.update(second.id, { ...second, title: 'second updated' })

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
    await expect(store.update('UPPERCASE', doc)).rejects.toThrow(/Invalid mind map id/)
  })

  it('durable write leaves no .tmp file after update', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Doc')

    await store.update(created.id, { ...created, title: 'Updated' })

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