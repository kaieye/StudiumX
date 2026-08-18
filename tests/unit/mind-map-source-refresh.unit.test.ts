import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { previewMindMapSourceRefresh } from '../../src/main/mindmap/mind-map-source-refresh'
import type {
  MindMapDocumentV2,
  MindMapSourceRef,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'

const roots: string[] = []

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function makeRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `studiumx-source-refresh-${label}-`))
  roots.push(root)
  return root
}

function documentWithTopics(topics: MindMapTopicV2[]): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'map-1',
    revision: 7,
    title: 'Source refresh test',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'studiumx-default' },
    assets: [],
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        root: {
          id: 'root-1',
          title: 'Root',
          children: topics
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ]
  }
}

function topic(id: string, sourceRefs: MindMapSourceRef[] = []): MindMapTopicV2 {
  return { id, title: id, children: [], sourceRefs }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('previewMindMapSourceRefresh', () => {
  it('hashes a contained source and reports fresh, changed, and sticky-stale states', async () => {
    const root = await makeRoot('states')
    const sourcePath = join(root, 'notes', 'biology.md')
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(sourcePath, 'cells v1', 'utf8')
    const firstHash = hash('cells v1')

    const document = documentWithTopics([
      topic('topic-fresh', [{ id: 'fresh', workspacePath: 'notes/biology.md', contentHash: firstHash }]),
      topic('topic-stale', [{ id: 'stale', workspacePath: 'notes/biology.md', contentHash: firstHash, stale: true }]),
      topic('topic-changed', [{ id: 'changed', workspacePath: 'notes/biology.md', contentHash: hash('old') }])
    ])

    const preview = await previewMindMapSourceRefresh(document, root)
    expect(preview.entries).toHaveLength(3)
    expect(preview.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRef: expect.objectContaining({ id: 'fresh', workspacePath: 'notes/biology.md' }),
        currentContentHash: firstHash,
        status: 'fresh',
        changed: false,
        change: 'unchanged'
      }),
      expect.objectContaining({
        sourceRef: expect.objectContaining({ id: 'stale' }),
        currentContentHash: firstHash,
        status: 'stale',
        changed: true,
        change: 'stale_flag'
      }),
      expect.objectContaining({
        sourceRef: expect.objectContaining({ id: 'changed' }),
        currentContentHash: firstHash,
        status: 'stale',
        changed: true,
        change: 'content_changed'
      })
    ]))
    expect(preview.changedCount).toBe(2)
    expect(preview.attentionCount).toBe(2)

    await writeFile(sourcePath, 'cells v2', 'utf8')
    const changedPreview = await previewMindMapSourceRefresh(document, root)
    expect(changedPreview.entries.find((entry) => entry.sourceRef.id === 'fresh')).toMatchObject({
      status: 'stale',
      changed: true,
      change: 'content_changed',
      currentContentHash: hash('cells v2')
    })
  })

  it('reports unknown when no baseline/path exists and never returns source content', async () => {
    const root = await makeRoot('unknown')
    const secret = 'do not return this source body'
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', 'unknown.md'), secret, 'utf8')

    const absolutePath = join(root, 'notes', 'unknown.md')
    const document = documentWithTopics([
      topic('topic-no-hash', [{ id: 'no-hash', workspacePath: 'notes/unknown.md' }]),
      topic('topic-no-path', [{ id: 'no-path' }]),
      topic('topic-absolute', [{ id: 'absolute', workspacePath: absolutePath, contentHash: hash(secret) }])
    ])

    const preview = await previewMindMapSourceRefresh(document, root)
    expect(preview.entries.find((entry) => entry.sourceRef.id === 'no-hash')).toMatchObject({
      status: 'unknown',
      changed: false,
      change: 'missing_hash',
      currentContentHash: hash(secret)
    })
    expect(preview.entries.find((entry) => entry.sourceRef.id === 'no-path')).toMatchObject({
      status: 'unknown',
      changed: false,
      change: 'missing_path'
    })
    const absolute = preview.entries.find((entry) => entry.sourceRef.id === 'absolute')
    expect(absolute).toMatchObject({ status: 'unreadable', change: 'unsafe_path' })
    expect(absolute?.sourceRef.workspacePath).toBeUndefined()
    expect(JSON.stringify(preview)).not.toContain(secret)
    expect(JSON.stringify(preview)).not.toContain(root)
  })

  it('fails closed for missing, oversized, and symlinked files', async () => {
    const root = await makeRoot('fail-closed')
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', 'large.md'), '123456789', 'utf8')
    await symlink(join(root, 'notes', 'large.md'), join(root, 'notes', 'link.md'))

    const document = documentWithTopics([
      topic('missing', [{ id: 'missing', workspacePath: 'notes/not-there.md', contentHash: 'old' }]),
      topic('large', [{ id: 'large', workspacePath: 'notes/large.md', contentHash: 'old' }]),
      topic('link', [{ id: 'link', workspacePath: 'notes/link.md', contentHash: 'old' }])
    ])

    const preview = await previewMindMapSourceRefresh(document, root, 3)
    expect(preview.entries.find((entry) => entry.sourceRef.id === 'missing')).toMatchObject({
      status: 'missing',
      change: 'missing_file'
    })
    expect(preview.entries.find((entry) => entry.sourceRef.id === 'large')).toMatchObject({
      status: 'unreadable',
      change: 'over_limit'
    })
    expect(preview.entries.find((entry) => entry.sourceRef.id === 'link')).toMatchObject({
      status: 'unreadable',
      change: 'unsafe_path'
    })
  })

  it('groups repeated refs and marks conflicting metadata for review', async () => {
    const root = await makeRoot('grouping')
    await mkdir(join(root, 'notes'), { recursive: true })
    await writeFile(join(root, 'notes', 'shared.md'), 'shared', 'utf8')
    const contentHash = hash('shared')
    const shared: MindMapSourceRef = {
      id: 'shared',
      workspacePath: './notes/shared.md',
      contentHash
    }
    const conflicting: MindMapSourceRef = { ...shared, blockId: 'different-block' }
    const document = documentWithTopics([
      topic('topic-a', [shared]),
      topic('topic-b', [shared]),
      topic('topic-conflict', [conflicting])
    ])

    const preview = await previewMindMapSourceRefresh(document, root)
    expect(preview.entries).toHaveLength(1)
    expect(preview.entries[0]).toMatchObject({
      sourceRef: expect.objectContaining({ id: 'shared', workspacePath: 'notes/shared.md' }),
      topicIds: ['topic-a', 'topic-b', 'topic-conflict'],
      sheetIds: ['sheet-1'],
      status: 'unknown',
      changed: false,
      change: 'conflicting_metadata'
    })
  })
})
