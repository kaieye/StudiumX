import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MindMapAssetStore } from '../../src/main/mindmap/mind-map-assets'
import {
  exportMindMapPortableFile,
  importMindMapPortableFile
} from '../../src/main/mindmap/portable-file'
import {
  MIND_MAP_PORTABLE_FORMAT,
  MindMapPortableError,
  createMindMapPortablePackage,
  parseMindMapPortablePackage,
  serializeMindMapPortablePackage
} from '../../src/shared/mindmap/portable'
import type { MindMapAssetRef, MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const FIXED_NOW = '2026-08-19T00:00:00.000Z'

function documentWithMedia(assets: readonly MindMapAssetRef[]): MindMapDocumentV2 {
  const [asset] = assets
  if (!asset) throw new Error('A media fixture requires one asset.')
  return {
    schemaVersion: 2,
    id: 'document-1',
    revision: 4,
    title: 'Cell Biology / media',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    theme: { id: 'theme-1' },
    assets: [...assets],
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root-1',
          title: 'Cells',
          assetIds: [asset.id],
          children: [
            {
              id: 'child-1',
              title: 'Membrane',
              assetIds: [asset.id],
              children: []
            }
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
          },
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

async function createAssetFixture(prefix: string): Promise<{
  workspaceRoot: string
  asset: MindMapAssetRef
  content: Uint8Array
}> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), `${prefix}-`))
  const content = new Uint8Array(Buffer.from('portable cell-diagram bytes'))
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

describe('portable mind-map packages', () => {
  it('exports a single .sxmind file and re-materializes its media with new asset ids', async () => {
    const source = await createAssetFixture('studiumx-portable-source')
    const destinationDirectory = await mkdtemp(join(tmpdir(), 'studiumx-portable-export-'))
    const document = documentWithMedia([source.asset])

    const exported = await exportMindMapPortableFile(
      document,
      source.workspaceRoot,
      destinationDirectory
    )

    expect(exported.path).toBe(join(destinationDirectory, 'cell-biology-media.sxmind'))
    const pkg = parseMindMapPortablePackage(await readFile(exported.path, 'utf8'))
    expect(pkg.format).toBe(MIND_MAP_PORTABLE_FORMAT)
    expect(pkg.assets).toEqual([
      {
        asset: source.asset,
        dataBase64: Buffer.from(source.content).toString('base64')
      }
    ])

    const targetWorkspace = await mkdtemp(join(tmpdir(), 'studiumx-portable-target-'))
    const imported = await importMindMapPortableFile(exported.path, targetWorkspace)
    const importedAsset = imported.importedAssets[0]
    if (!importedAsset) throw new Error('Expected the embedded media to be imported.')

    expect(importedAsset.id).not.toBe(source.asset.id)
    await expect(
      new MindMapAssetStore({ rootPath: join(targetWorkspace, 'mindmap-assets') }).read(importedAsset)
    ).resolves.toEqual(Buffer.from(source.content))
    expect(imported.document.assets).toEqual([importedAsset])
    expect(imported.document.sheets[0]).toMatchObject({
      root: {
        assetIds: [importedAsset.id],
        children: [{ assetIds: [importedAsset.id] }]
      },
      images: [
        {
          id: 'attached-image-1',
          assetId: importedAsset.id,
          topicId: 'root-1',
          width: 320,
          height: 180,
          label: 'Cell diagram',
          style: { stroke: '#112233', strokeWidth: 2 }
        },
        {
          id: 'free-image-1',
          assetId: importedAsset.id,
          position: { x: 48, y: -24 },
          width: 240,
          height: 135,
          label: 'Free diagram',
          style: { fill: '#ffffff' }
        }
      ]
    })
  })

  it('rejects malformed or tampered envelopes before a document can be used', () => {
    expect(() => parseMindMapPortablePackage('')).toThrow(MindMapPortableError)
    expect(() => parseMindMapPortablePackage('{')).toThrow(MindMapPortableError)

    const asset: MindMapAssetRef = {
      id: 'asset-1',
      fileName: 'diagram.png',
      sizeBytes: 1,
      sha256: createHash('sha256').update('x').digest('hex')
    }
    const serialized = serializeMindMapPortablePackage(
      createMindMapPortablePackage(documentWithMedia([asset]), [{ asset, dataBase64: 'eA==' }])
    )
    const tampered = JSON.parse(serialized) as { assets: Array<{ dataBase64: string }> }
    tampered.assets[0]!.dataBase64 = 'eA=='
    tampered.assets.push({ dataBase64: 'eA==' })

    expect(() => parseMindMapPortablePackage(JSON.stringify(tampered))).toThrow(MindMapPortableError)
  })

  it('cleans up media already materialized when a later embedded asset fails integrity verification', async () => {
    const source = await createAssetFixture('studiumx-portable-cleanup-source')
    const secondContent = new Uint8Array(Buffer.from('second asset'))
    const secondAsset: MindMapAssetRef = {
      id: 'asset-second',
      fileName: 'second.png',
      mimeType: 'image/png',
      sizeBytes: secondContent.byteLength,
      // A syntactically valid but intentionally incorrect digest makes the
      // second import fail after the first asset has been written.
      sha256: '0'.repeat(64),
      createdAt: FIXED_NOW
    }
    const document = documentWithMedia([source.asset, secondAsset])
    const sourcePath = join(source.workspaceRoot, 'tampered.sxmind')
    await writeFile(
      sourcePath,
      serializeMindMapPortablePackage(
        createMindMapPortablePackage(document, [
          { asset: source.asset, dataBase64: Buffer.from(source.content).toString('base64') },
          { asset: secondAsset, dataBase64: Buffer.from(secondContent).toString('base64') }
        ])
      ),
      'utf8'
    )
    const targetWorkspace = await mkdtemp(join(tmpdir(), 'studiumx-portable-cleanup-target-'))

    await expect(importMindMapPortableFile(sourcePath, targetWorkspace)).rejects.toThrow(
      'hash does not match its bytes'
    )
    await expect(readdir(join(targetWorkspace, 'mindmap-assets'))).resolves.toEqual([])
  })
})
