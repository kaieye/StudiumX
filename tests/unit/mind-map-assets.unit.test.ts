import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MindMapAssetError,
  MindMapAssetStore
} from '../../src/main/mindmap/mind-map-assets'

async function makeFixture(prefix: string): Promise<{ root: string; source: string }> {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`))
  const source = join(root, 'source.png')
  await writeFile(source, Buffer.from('asset bytes'))
  return { root, source }
}

describe('MindMapAssetStore', () => {
  it('copies bounded assets into an id-scoped root and returns metadata only', async () => {
    const { root, source } = await makeFixture('studiumx-mindmap-assets')
    const store = new MindMapAssetStore({
      rootPath: join(root, 'assets'),
      now: () => '2026-08-09T00:00:00.000Z'
    })

    const asset = await store.importFromFile({
      id: 'asset-1',
      fileName: 'diagram.png',
      mimeType: 'image/png; charset=binary',
      sourcePath: source
    })

    expect(asset).toEqual({
      id: 'asset-1',
      fileName: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: 11,
      sha256: createHash('sha256').update('asset bytes').digest('hex'),
      createdAt: '2026-08-09T00:00:00.000Z'
    })
    expect(asset).not.toHaveProperty('absolutePath')
    await expect(store.read(asset)).resolves.toEqual(Buffer.from('asset bytes'))
    await expect(readFile(join(root, 'assets', 'asset-1', 'diagram.png'))).resolves.toEqual(
      Buffer.from('asset bytes')
    )
  })

  it('imports bounded embedded bytes and records size/hash metadata', async () => {
    const { root } = await makeFixture('studiumx-mindmap-assets-bytes')
    const store = new MindMapAssetStore({
      rootPath: join(root, 'assets'),
      maxBytes: 4,
      now: () => '2026-08-09T00:00:00.000Z'
    })
    const content = new Uint8Array([1, 2, 3, 4])

    const asset = await store.importFromBytes({
      id: 'embedded-1',
      fileName: 'diagram.png',
      mimeType: 'image/png',
      content
    })

    expect(asset).toEqual({
      id: 'embedded-1',
      fileName: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      sha256: createHash('sha256').update(content).digest('hex'),
      createdAt: '2026-08-09T00:00:00.000Z'
    })
    await expect(store.read(asset)).resolves.toEqual(Buffer.from(content))

    await expect(
      store.importFromBytes({
        id: 'embedded-large',
        fileName: 'large.png',
        content: new Uint8Array([1, 2, 3, 4, 5])
      })
    ).rejects.toMatchObject({
      code: 'embedded_asset_too_large'
    } satisfies Partial<MindMapAssetError>)
  })

  it('rejects traversal, symlink sources, mime mismatches, and oversized files', async () => {
    const { root, source } = await makeFixture('studiumx-mindmap-assets-security')
    const store = new MindMapAssetStore({ rootPath: join(root, 'assets'), maxBytes: 4 })

    await expect(
      store.importFromFile({
        id: '../escape',
        fileName: 'diagram.png',
        sourcePath: source
      })
    ).rejects.toMatchObject({ code: 'invalid_asset_id' } satisfies Partial<MindMapAssetError>)

    await expect(
      store.importFromFile({
        id: 'asset-1',
        fileName: '../escape.png',
        sourcePath: source
      })
    ).rejects.toMatchObject({ code: 'invalid_file_name' } satisfies Partial<MindMapAssetError>)

    await expect(
      store.importFromFile({
        id: 'asset-1',
        fileName: 'diagram.png',
        mimeType: 'text/plain',
        sourcePath: source
      })
    ).rejects.toMatchObject({ code: 'invalid_mime_type' } satisfies Partial<MindMapAssetError>)

    await expect(
      store.importFromFile({
        id: 'asset-1',
        fileName: 'diagram.png',
        sourcePath: source
      })
    ).rejects.toMatchObject({ code: 'source_too_large' } satisfies Partial<MindMapAssetError>)

    const link = join(root, 'source-link.png')
    await symlink(source, link)
    const permissiveStore = new MindMapAssetStore({ rootPath: join(root, 'other-assets') })
    await expect(
      permissiveStore.importFromFile({
        id: 'asset-1',
        fileName: 'diagram.png',
        sourcePath: link
      })
    ).rejects.toMatchObject({ code: 'source_not_regular' } satisfies Partial<MindMapAssetError>)
  })

  it('does not overwrite an existing asset and cleans only orphan id directories', async () => {
    const { root, source } = await makeFixture('studiumx-mindmap-assets-cleanup')
    const secondSource = join(root, 'second.txt')
    await writeFile(secondSource, 'second')
    const store = new MindMapAssetStore({ rootPath: join(root, 'assets') })

    const first = await store.importFromFile({
      id: 'keep',
      fileName: 'one.png',
      sourcePath: source
    })
    await expect(
      store.importFromFile({
        id: 'keep',
        fileName: 'one.png',
        sourcePath: source
      })
    ).rejects.toMatchObject({ code: 'asset_exists' } satisfies Partial<MindMapAssetError>)
    await store.importFromFile({
      id: 'orphan',
      fileName: 'two.txt',
      sourcePath: secondSource
    })

    await expect(store.cleanupOrphans(['keep'])).resolves.toEqual(['orphan'])
    await expect(store.read(first)).resolves.toEqual(Buffer.from('asset bytes'))
    await expect(store.read({ id: 'orphan', fileName: 'two.txt' })).rejects.toMatchObject({
      code: 'asset_missing'
    } satisfies Partial<MindMapAssetError>)
    await expect(lstat(join(root, 'assets', 'orphan'))).rejects.toMatchObject({ code: 'ENOENT' })

    await store.remove(first)
    await expect(store.remove(first)).resolves.toBeUndefined()
  })

  it('rejects persisted references whose size or hash no longer matches storage', async () => {
    const { root, source } = await makeFixture('studiumx-mindmap-assets-integrity')
    const store = new MindMapAssetStore({ rootPath: join(root, 'assets') })
    const asset = await store.importFromFile({
      id: 'asset-1',
      fileName: 'diagram.png',
      sourcePath: source
    })

    await expect(store.read({ ...asset, sizeBytes: asset.sizeBytes! + 1 })).rejects.toMatchObject({
      code: 'asset_integrity_mismatch'
    } satisfies Partial<MindMapAssetError>)
    await expect(store.read({ ...asset, sha256: '0'.repeat(64) })).rejects.toMatchObject({
      code: 'asset_integrity_mismatch'
    } satisfies Partial<MindMapAssetError>)

    await writeFile(join(root, 'assets', 'asset-1', 'diagram.png'), Buffer.from('asset bytez'))
    await expect(store.read(asset)).rejects.toMatchObject({
      code: 'asset_integrity_mismatch'
    } satisfies Partial<MindMapAssetError>)
  })
})
