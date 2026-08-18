import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseMindMapUpdatePayload } from '../../src/main/mindmap/mind-map-ipc-commands'
import { createMindMapStore, MindMapStoreError } from '../../src/main/mindmap/mind-map-store'
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
          layout: { structureClass: 'studiumx.layout.logic.right' }
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
    expect(created.sheets[0]!.layout.structureClass).toBe('studiumx.layout.logic.right')
    expect(created.sheets[0]!.layout.defaultTopicShape).toBe('rounded-rect')

    const read = await store.read(created.id)
    expect(read).toEqual(created)
  })

  it('persists the requested first-sheet structure during creation', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)

    const created = await store.create('Matrix', 'studiumx.layout.spreadsheet')

    expect(created.sheets[0]?.layout.structureClass).toBe('studiumx.layout.spreadsheet')
    await expect(store.read(created.id)).resolves.toEqual(created)
  })

  it('opens a legacy document after removing invalid connector records', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Legacy connector map')
    const sheet = created.sheets[0]!
    const childId = 'child-1'
    const legacy = {
      ...created,
      sheets: [
        {
          ...sheet,
          root: {
            ...sheet.root,
            children: [{ id: childId, title: 'Child', children: [] }]
          },
          elements: [
            {
              id: 'connector-valid',
              type: 'connector',
              start: {
                x: 0,
                y: 0,
                anchor: { targetType: 'topic', targetId: sheet.root.id }
              },
              end: {
                x: 200,
                y: 80,
                anchor: { targetType: 'topic', targetId: childId }
              }
            },
            {
              id: 'connector-half',
              type: 'connector',
              start: {
                x: 0,
                y: 0,
                anchor: { targetType: 'topic', targetId: sheet.root.id }
              },
              end: { x: 200, y: 80 }
            },
            {
              id: 'connector-self',
              type: 'connector',
              start: {
                x: 0,
                y: 0,
                anchor: { targetType: 'topic', targetId: sheet.root.id }
              },
              end: {
                x: 100,
                y: 80,
                anchor: { targetType: 'topic', targetId: sheet.root.id }
              }
            }
          ]
        }
      ]
    }
    await writeFile(
      join(root, 'mindmaps', `${created.id}.json`),
      JSON.stringify(legacy, null, 2)
    )

    const reopened = await store.read(created.id)

    expect(reopened.sheets[0]!.elements.map((element) => element.id)).toEqual([
      'connector-valid'
    ])
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
          layout: { structureClass: 'studiumx.layout.logic.right' }
        },
        {
          id: 'sheet-2',
          title: 'Sheet 2',
          root: { id: 'root-2', title: 'Root 2', children: [] },
          elements: [],
          layout: { structureClass: 'studiumx.layout.logic.balanced' }
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

  it('round-trips every persisted right-panel theme and layout field', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('Styled map')
    const styled: MindMapDocumentV2 = {
      ...created,
      theme: {
        id: 'snowbrush',
        name: 'Snowbrush',
        background: '#FFFFFF',
        branchColors: ['#FF6B6B', '#97D3B6'],
        textColor: '#111111',
        lineColor: '#8E8E93',
        fontFamily: 'Inter, "Noto Sans CJK SC", sans-serif',
        shape: 'roundedRect',
        rainbowBranches: false,
        colorSchemeId: 'dawn',
        topicStyles: {
          central: {
            fill: '#F6212D',
            stroke: '#E32C2D',
            borderStyle: 'hand-drawn-dash',
            borderWidth: 5,
            textColor: '#FFFFFF',
            fontFamily: 'Inter, sans-serif',
            fontSize: 37,
            fontWeight: '700',
            fontStyle: 'italic',
            textDecoration: 'line-through underline',
            textTransform: 'capitalize',
            textAlign: 'right',
            shape: 'roundedRect',
            structureClass: 'studiumx.layout.logic.balanced'
          },
          main: { fill: '#FAD8DF', fontWeight: '500' },
          sub: { fill: '#F8F7F7', shape: 'underline' }
        }
      },
      sheets: created.sheets.map((sheet) => ({
        ...sheet,
        layout: {
          ...sheet.layout,
          direction: 'ltr',
          compact: true,
          spacing: 24,
          lineStyle: 'straight',
          lineWidthScale: 1.5
        }
      }))
    }

    const persisted = expectUpdateOk(await store.update(created.id, styled, created.revision))
    const reopened = await store.read(created.id)

    expect(reopened.theme).toEqual(styled.theme)
    expect(reopened.sheets[0]?.layout).toEqual(styled.sheets[0]?.layout)
    expect(reopened).toEqual(persisted)
  })

  it('preserves right-panel fields through IPC parsing, store update, and reopen', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)
    const created = await store.create('IPC styled map')
    const sheetId = created.sheets[0]!.id
    const rootId = created.sheets[0]!.root.id
    const childId = 'styled-child'
    const doc: MindMapDocumentV2 = {
      ...created,
      theme: {
        id: 'custom-style',
        background: 'transparent',
        branchColors: ['#112233', '#445566'],
        textColor: '#101010',
        lineColor: '#778899',
        fontFamily: 'Noto Sans CJK SC, sans-serif',
        shape: 'roundedRect',
        rainbowBranches: false,
        colorSchemeId: 'dawn',
        topicStyles: {
          central: {
            fill: '#AABBCC',
            stroke: '#223344',
            borderStyle: 'solid',
            borderWidth: 3,
            textColor: '#FFFFFF',
            fontFamily: 'Inter, sans-serif',
            fontSize: 32,
            fontWeight: '700',
            fontStyle: 'italic',
            textDecoration: 'underline',
            shape: 'roundedRect',
            structureClass: 'studiumx.layout.logic.right'
          },
          main: { fill: '#DDEEFF', fontStyle: 'normal' },
          sub: { textColor: '#334455', shape: 'underline' }
        }
      },
      sheets: [{
        ...created.sheets[0]!,
        root: {
          ...created.sheets[0]!.root,
          style: {
            fontWeight: '700',
            fontStyle: 'italic',
            textDecoration: 'line-through underline',
            fill: '#ABCDEF',
            stroke: '#123456',
            borderStyle: 'hand-drawn-dash',
            borderWidth: 5
          },
          children: [{ id: childId, title: 'Child', children: [] }]
        },
        elements: [
          {
            id: 'relationship-1',
            type: 'relationship',
            from: rootId,
            to: childId,
            label: 'Related',
            style: { stroke: '#111111', strokeWidth: 2, textColor: '#222222', fontFamily: 'Inter', fontSize: 13, dashed: true }
          },
          {
            id: 'boundary-1',
            type: 'boundary',
            topicId: rootId,
            children: [childId],
            label: 'Boundary',
            style: { stroke: '#333333', strokeWidth: 3, fill: '#EEEEEE', textColor: '#444444', fontFamily: 'Serif', fontSize: 14, dashed: false }
          },
          {
            id: 'summary-1',
            type: 'summary',
            from: childId,
            to: childId,
            label: 'Summary',
            style: { stroke: '#555555', strokeWidth: 4, fill: '#F0F0F0', textColor: '#666666', fontFamily: 'Monospace', fontSize: 15, dashed: true }
          },
          {
            id: 'callout-1',
            type: 'callout',
            topicId: childId,
            text: 'Callout',
            position: { x: 120, y: 80 },
            style: { stroke: '#777777', strokeWidth: 1.5, fill: '#FAFAFA', textColor: '#888888', fontFamily: 'Inter', fontSize: 16, dashed: false }
          }
        ],
        layout: {
          structureClass: 'studiumx.layout.logic.right',
          direction: 'rtl',
          compact: true,
          spacing: 36,
          lineStyle: 'elbow',
          lineWidthScale: 2
        }
      }]
    }

    const parsed = parseMindMapUpdatePayload({
      workspaceId: 'workspace-1',
      id: created.id,
      expectedRevision: created.revision,
      doc
    })
    expect(parsed).not.toBeNull()
    if (!parsed) throw new Error('Expected the IPC payload to parse')

    const persisted = expectUpdateOk(
      await store.update(parsed.id, parsed.doc, parsed.expectedRevision)
    )
    const reopened = await store.read(created.id)

    expect(reopened).toEqual(persisted)
    expect(reopened.theme).toEqual(parsed.doc.theme)
    expect(reopened.sheets[0]).toMatchObject({
      id: sheetId,
      root: parsed.doc.sheets[0]!.root,
      elements: parsed.doc.sheets[0]!.elements,
      layout: parsed.doc.sheets[0]!.layout
    })
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

  it('reports a missing document with a path-safe structured error', async () => {
    const root = await createRoot()
    const store = createMindMapStore(root)

    let caught: unknown
    try {
      await store.read('missing-map')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(MindMapStoreError)
    const failure = caught as MindMapStoreError
    expect(failure.code).toBe('not_found')
    expect(failure.message).toBe('mind_map_document_not_found: Mind map document not found.')
    expect(failure.message).not.toContain(root)
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
    expect(list[0]!.preview).toEqual({
      theme: second.theme,
      root: second.sheets[0]!.root,
      layout: second.sheets[0]!.layout
    })
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
