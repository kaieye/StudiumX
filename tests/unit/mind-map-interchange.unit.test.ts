import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { exportMindMapMarkdownFile } from '../../src/main/mindmap/markdown-file'
import { importMindMapMarkdownFileWithAssets } from '../../src/main/mindmap/markdown-import-file'
import {
  MIND_MAP_INTERCHANGE_FORMAT,
  MIND_MAP_INTERCHANGE_MANIFEST,
  MIND_MAP_INTERCHANGE_VERSION
} from '../../src/main/mindmap/mind-map-interchange'
import { MindMapAssetStore } from '../../src/main/mindmap/mind-map-assets'
import { exportMindMapOpmlFile } from '../../src/main/mindmap/opml-file'
import { importMindMapOpmlFileWithAssets } from '../../src/main/mindmap/opml-import-file'
import type { MindMapAssetRef, MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const FIXED_NOW = '2026-08-19T00:00:00.000Z'

function documentWithMedia(asset: MindMapAssetRef): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'document-1',
    revision: 4,
    title: 'Media map',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    theme: { id: 'theme-1' },
    assets: [asset],
    sheets: [
      {
        id: 'sheet-1',
        title: 'Cells',
        root: {
          id: 'root-1',
          title: 'Cell',
          assetIds: [asset.id],
          children: [
            { id: 'child-1', title: 'Membrane', assetIds: [asset.id], children: [] }
          ]
        },
        elements: [],
        images: [
          {
            id: 'attached-image-1',
            type: 'image',
            assetId: asset.id,
            topicId: 'root-1',
            width: 320,
            height: 180,
            label: 'Cell diagram',
            style: { stroke: '#112233', strokeWidth: 2 }
          }
        ],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      },
      {
        id: 'sheet-2',
        title: 'Organelles',
        root: {
          id: 'root-2',
          title: 'Nucleus',
          assetIds: [asset.id],
          children: []
        },
        elements: [],
        images: [
          {
            id: 'free-image-1',
            type: 'image',
            assetId: asset.id,
            position: { x: 48, y: -24 },
            width: 240,
            height: 135,
            label: 'Free diagram',
            style: { fill: '#ffffff' }
          }
        ],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ]
  }
}

function documentWithoutMedia(): MindMapDocumentV2 {
  const document = documentWithMedia({ id: 'unused', fileName: 'unused.png' })
  return {
    ...document,
    assets: [],
    sheets: document.sheets.map((sheet) => ({
      ...sheet,
      root: stripTopicAssets(sheet.root),
      images: []
    }))
  }
}

function stripTopicAssets(topic: MindMapDocumentV2['sheets'][number]['root']): MindMapDocumentV2['sheets'][number]['root'] {
  const { assetIds: _assetIds, children, ...rest } = topic
  return { ...rest, children: children.map(stripTopicAssets) }
}

async function createAssetFixture(prefix: string): Promise<{
  workspaceRoot: string
  asset: MindMapAssetRef
  content: Uint8Array
}> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), `${prefix}-`))
  const content = new Uint8Array(Buffer.from('sidecar cell-diagram bytes'))
  const asset = await new MindMapAssetStore({
    rootPath: join(workspaceRoot, 'mindmap-assets'),
    now: () => FIXED_NOW
  }).importFromBytes({
    id: 'asset-original',
    fileName: 'cell-diagram.png',
    mimeType: 'image/png',
    content,
    createdAt: FIXED_NOW
  })
  return { workspaceRoot, asset, content }
}

async function expectRestoredMedia(
  workspaceRoot: string,
  result: Awaited<ReturnType<typeof importMindMapMarkdownFileWithAssets>>,
  expectedContent: Uint8Array
): Promise<void> {
  const asset = result.importedAssets[0]
  if (!asset) throw new Error('Expected one restored asset.')
  const [firstSheet, secondSheet] = result.document.sheets
  if (!firstSheet || !secondSheet) throw new Error('Expected both sheets to be restored.')

  expect(result.importedAssets).toHaveLength(1)
  expect(result.document.assets).toEqual([asset])
  await expect(
    new MindMapAssetStore({ rootPath: join(workspaceRoot, 'mindmap-assets') }).read(asset)
  ).resolves.toEqual(Buffer.from(expectedContent))
  expect(firstSheet.root.assetIds).toEqual([asset.id])
  expect(firstSheet.root.children[0]?.assetIds).toEqual([asset.id])
  expect(secondSheet.root.assetIds).toEqual([asset.id])
  expect(firstSheet.images).toEqual([
    {
      id: 'attached-image-1',
      type: 'image',
      assetId: asset.id,
      topicId: firstSheet.root.id,
      width: 320,
      height: 180,
      label: 'Cell diagram',
      style: { stroke: '#112233', strokeWidth: 2 }
    }
  ])
  expect(secondSheet.images).toEqual([
    {
      id: 'free-image-1',
      type: 'image',
      assetId: asset.id,
      position: { x: 48, y: -24 },
      width: 240,
      height: 135,
      label: 'Free diagram',
      style: { fill: '#ffffff' }
    }
  ])
}

describe('mind-map editable media sidecars', () => {
  it('round-trips Markdown attachments, free images, topic references, and media bytes', async () => {
    const source = await createAssetFixture('studiumx-markdown-sidecar-source')
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-markdown-sidecar-export-'))
    const exported = await exportMindMapMarkdownFile(
      documentWithMedia(source.asset),
      source.workspaceRoot,
      destination
    )

    const sidecar = `${exported.path}.assets`
    const markdown = await readFile(exported.path, 'utf8')
    expect(markdown).toContain('![Cell diagram](media-map.md.assets/asset-000-cell-diagram.png)')
    await expect(readdir(sidecar)).resolves.toEqual(
      expect.arrayContaining([MIND_MAP_INTERCHANGE_MANIFEST, 'asset-000-cell-diagram.png'])
    )

    const targetWorkspace = await mkdtemp(join(tmpdir(), 'studiumx-markdown-sidecar-target-'))
    const imported = await importMindMapMarkdownFileWithAssets(exported.path, targetWorkspace)
    await expectRestoredMedia(targetWorkspace, imported, source.content)
    expect(imported.importedAssets[0]?.id).not.toBe(source.asset.id)
  })

  it('round-trips OPML attachments, free images, topic references, and media bytes', async () => {
    const source = await createAssetFixture('studiumx-opml-sidecar-source')
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-opml-sidecar-export-'))
    const exported = await exportMindMapOpmlFile(
      documentWithMedia(source.asset),
      source.workspaceRoot,
      destination
    )

    const opml = await readFile(exported.path, 'utf8')
    expect(opml).toContain('_studiumx_image_paths="asset-000-cell-diagram.png"')
    await expect(readdir(`${exported.path}.assets`)).resolves.toEqual(
      expect.arrayContaining([MIND_MAP_INTERCHANGE_MANIFEST, 'asset-000-cell-diagram.png'])
    )

    const targetWorkspace = await mkdtemp(join(tmpdir(), 'studiumx-opml-sidecar-target-'))
    const imported = await importMindMapOpmlFileWithAssets(exported.path, targetWorkspace)
    await expectRestoredMedia(targetWorkspace, imported, source.content)
    expect(imported.document.sheets[0]?.root.id).toBe('root-1')
  })

  it('fails closed on an unsafe sidecar manifest path and on a symlinked sidecar directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'studiumx-sidecar-security-'))
    const sourcePath = join(directory, 'map.md')
    await writeFile(sourcePath, '# Map\n\n## Sheet\n- Root\n', 'utf8')
    const sidecar = `${sourcePath}.assets`
    await mkdir(sidecar)
    await writeFile(
      join(sidecar, MIND_MAP_INTERCHANGE_MANIFEST),
      JSON.stringify({
        format: MIND_MAP_INTERCHANGE_FORMAT,
        version: MIND_MAP_INTERCHANGE_VERSION,
        assets: [{
          assetId: 'asset-1',
          relativePath: '../outside.png',
          fileName: 'outside.png',
          sizeBytes: 1,
          sha256: createHash('sha256').update('x').digest('hex')
        }],
        images: [],
        topics: []
      }),
      'utf8'
    )

    const workspaceRoot = await mkdtemp(join(tmpdir(), 'studiumx-sidecar-security-workspace-'))
    await expect(importMindMapMarkdownFileWithAssets(sourcePath, workspaceRoot)).rejects.toThrow(
      'unsafe identifier or path'
    )

    const safeSource = join(directory, 'safe.md')
    await writeFile(safeSource, '# Map\n\n## Sheet\n- Root\n', 'utf8')
    const external = await mkdtemp(join(tmpdir(), 'studiumx-sidecar-external-'))
    await symlink(external, `${safeSource}.assets`)
    await expect(importMindMapMarkdownFileWithAssets(safeSource, workspaceRoot)).rejects.toThrow(
      'sidecar path must be a real directory'
    )
  })

  it('removes a previous active sidecar manifest when a later export has no media', async () => {
    const source = await createAssetFixture('studiumx-sidecar-stale-source')
    const destination = await mkdtemp(join(tmpdir(), 'studiumx-sidecar-stale-export-'))
    const first = await exportMindMapMarkdownFile(
      documentWithMedia(source.asset),
      source.workspaceRoot,
      destination
    )
    await exportMindMapMarkdownFile(documentWithoutMedia(), source.workspaceRoot, destination)

    const targetWorkspace = await mkdtemp(join(tmpdir(), 'studiumx-sidecar-stale-target-'))
    const imported = await importMindMapMarkdownFileWithAssets(first.path, targetWorkspace)
    expect(imported.importedAssets).toEqual([])
    expect(imported.document.assets).toEqual([])
  })
})
