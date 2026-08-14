import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import {
  buildXmindZip,
  buildXmindZipV2,
  buildXmindZipV2WithCompatibilityReport,
  exportXmindFile,
  parseXmindZip,
  parseXmindZipWithCompatibilityReport,
  readXmindFile,
  readXmindFileWithCompatibilityReport
} from '../../src/main/mindmap/xmind-file'
import { migrateV1ToV2 } from '../../src/shared/mindmap/migrations'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const NOW = '2026-08-09T00:00:00.000Z'

function sampleDocument(): MindMapDocument {
  return {
    schemaVersion: 1,
    id: 'doc-1',
    title: 'Study Plan',
    createdAt: NOW,
    updatedAt: NOW,
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        structureClass: 'org.xmind.ui.logic.right',
        root: {
          id: 'root-1',
          title: '中心主题',
          collapsed: false,
          children: [
            {
              id: 'branch-1',
              title: 'Branch 1',
              note: 'a note',
              structureClass: 'org.xmind.ui.logic.balanced',
              children: [
                {
                  id: 'leaf-1',
                  title: 'Leaf 1',
                  children: []
                }
              ]
            }
          ]
        }
      },
      {
        id: 'sheet-2',
        title: 'Sheet 2',
        structureClass: 'org.xmind.ui.logic.map',
        root: {
          id: 'root-2',
          title: 'Second Root',
          children: []
        }
      }
    ]
  }
}

/** Build a `.xmind`-shaped ZIP from raw content.json text plus extra entries. */
function buildZipWithContent(
  contentJson: string,
  extra: Record<string, string | Uint8Array> = {}
): Uint8Array {
  return zipSync({
    'content.json': strToU8(contentJson),
    'metadata.json': strToU8('{}'),
    'manifest.json': strToU8('{}'),
    ...Object.fromEntries(
      Object.entries(extra).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])
    )
  })
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('buildXmindZip / parseXmindZip', () => {
  it('round-trips a document tree through the ZIP', () => {
    const doc = sampleDocument()
    const bytes = buildXmindZip(doc)
    const parsed = parseXmindZip(bytes)

    expect(parsed.schemaVersion).toBe(1)
    // content.json only carries sheet titles — the document title is derived
    // from the first sheet on import.
    expect(parsed.title).toBe('Sheet 1')
    expect(parsed.sheets).toHaveLength(2)

    const sheet = parsed.sheets[0]
    expect(sheet.id).toBe('sheet-1')
    expect(sheet.title).toBe('Sheet 1')
    expect(sheet.structureClass).toBe('org.xmind.ui.logic.right')
    expect(sheet.root.id).toBe('root-1')
    expect(sheet.root.title).toBe('中心主题')
    expect(sheet.root.collapsed).toBe(false)

    const branch = sheet.root.children[0]
    expect(branch.title).toBe('Branch 1')
    expect(branch.note).toBe('a note')
    expect(branch.structureClass).toBe('org.xmind.ui.logic.balanced')
    expect(branch.children[0].title).toBe('Leaf 1')

    const second = parsed.sheets[1]
    expect(second.structureClass).toBe('org.xmind.ui.logic.map')
    expect(second.root.title).toBe('Second Root')
    expect(second.root.children).toEqual([])
  })

  it('returns a compatibility report for the exact imported content', () => {
    const bytes = buildZipWithContent(
      JSON.stringify([
        {
          class: 'sheet',
          id: 'sheet-report',
          title: 'Reported',
          structureClass: 'org.xmind.ui.logic.right',
          rootTopic: {
            class: 'topic',
            id: 'root-report',
            title: 'Root',
            style: { id: 'foreign-style' },
            children: { attached: [] }
          }
        }
      ])
    )

    const result = parseXmindZipWithCompatibilityReport(bytes)

    expect(result.document.sheets[0]?.root.title).toBe('Root')
    expect(result.compatibilityReport).toEqual({
      preserved: expect.arrayContaining([
        expect.objectContaining({ path: 'sheets', count: 1 })
      ]),
      approximated: expect.any(Array),
      dropped: expect.arrayContaining([
        expect.objectContaining({ path: 'topics[].style.id', count: 1 })
      ]),
      warnings: expect.any(Array)
    })
  })

  it('reads a regular filesystem archive through the bounded handle path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-'))
    temporaryRoots.push(root)
    const sourcePath = join(root, 'valid.xmind')
    await writeFile(sourcePath, buildXmindZip(sampleDocument()))

    await expect(readXmindFile(sourcePath)).resolves.toMatchObject({
      title: 'Sheet 1',
      sheets: expect.arrayContaining([
        expect.objectContaining({ id: 'sheet-1' })
      ])
    })
  })

  it('reads the compatibility report without changing the legacy read result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-'))
    temporaryRoots.push(root)
    const sourcePath = join(root, 'reported.xmind')
    await writeFile(
      sourcePath,
      buildZipWithContent(
        JSON.stringify([
          {
            class: 'sheet',
            id: 'sheet-report-file',
            title: 'Reported file',
            rootTopic: { class: 'topic', id: 'root-report-file', title: 'Root' }
          }
        ])
      )
    )

    const legacy = await readXmindFile(sourcePath)
    const withReport = await readXmindFileWithCompatibilityReport(sourcePath)

    expect(withReport.document).toMatchObject({
      schemaVersion: legacy.schemaVersion,
      title: legacy.title,
      sheets: legacy.sheets
    })
    expect(withReport.compatibilityReport).toEqual({
      preserved: expect.any(Array),
      approximated: expect.any(Array),
      dropped: expect.any(Array),
      warnings: expect.any(Array)
    })
  })

  it('imports one referenced embedded PNG and projects its asset id onto the topic', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-assets-'))
    temporaryRoots.push(root)
    const sourcePath = join(root, 'embedded.xmind')
    const imageBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3])
    await writeFile(
      sourcePath,
      buildZipWithContent(
        JSON.stringify([
          {
            class: 'sheet',
            id: 'sheet-image',
            title: 'Image sheet',
            rootTopic: {
              class: 'topic',
              id: 'root-image',
              title: 'Diagram',
              image: { src: 'attachments/diagram.png' }
            }
          }
        ]),
        { 'attachments/diagram.png': imageBytes }
      )
    )

    let importedBytes: Uint8Array | undefined
    const result = await readXmindFileWithCompatibilityReport(sourcePath, {
      nowIso: NOW,
      importEmbeddedImage: (image) => {
        importedBytes = image.bytes
        return {
          id: 'asset-1',
          fileName: image.fileName,
          mimeType: image.mimeType,
          sizeBytes: image.bytes.byteLength
        }
      }
    })

    expect(importedBytes).toEqual(imageBytes)
    expect(result.document.sheets[0]?.root.assetIds).toEqual(['asset-1'])
    expect(result.assets).toEqual([
      {
        id: 'asset-1',
        fileName: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: imageBytes.byteLength
      }
    ])
    expect(result.compatibilityReport.approximated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'topics[].image', count: 1 })
      ])
    )
    expect(result.compatibilityReport.dropped).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'topics[].image' })])
    )
  })

  it('does not extract unreferenced, nested, or non-PNG attachment entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-attachment-filter-'))
    temporaryRoots.push(root)
    const sourcePath = join(root, 'filtered.xmind')
    await writeFile(
      sourcePath,
      buildZipWithContent(
        JSON.stringify([
          {
            class: 'sheet',
            id: 'sheet-filter',
            title: 'Filter',
            rootTopic: {
              class: 'topic',
              id: 'root-filter',
              title: 'Root',
              image: { src: 'attachments/referenced.png' }
            }
          }
        ]),
        {
          'attachments/referenced.png': new Uint8Array([1]),
          'attachments/unreferenced.png': new Uint8Array([2]),
          'attachments/nested/nested.png': new Uint8Array([3]),
          'attachments/document.pdf': new Uint8Array([4])
        }
      )
    )

    const imported: string[] = []
    const result = await readXmindFileWithCompatibilityReport(sourcePath, {
      importEmbeddedImage: (image) => {
        imported.push(image.zipPath)
        return { id: 'asset-1', fileName: image.fileName }
      }
    })

    expect(imported).toEqual(['attachments/referenced.png'])
    expect(result.assets).toHaveLength(1)
    expect(result.document.sheets[0]?.root.assetIds).toEqual(['asset-1'])
  })

  it('exports into a newly created directory with a traversal-safe filename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-'))
    temporaryRoots.push(root)
    const destination = join(root, 'nested', 'exports')

    const result = await exportXmindFile(
      { ...sampleDocument(), title: 'Study Plan / ../Secrets' },
      destination
    )

    expect(result.path).toBe(join(destination, 'study-plan-secrets.xmind'))
    const parsed = parseXmindZip(await readFile(result.path))
    expect(parsed.sheets).toHaveLength(2)
    expect(parsed.sheets[0]?.root.title).toBe('中心主题')
  })

  it('bounds filesystem imports before reading an oversized source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-'))
    temporaryRoots.push(root)
    const sourcePath = join(root, 'oversized.xmind')
    await writeFile(sourcePath, '')
    await truncate(sourcePath, 32 * 1024 * 1024 + 1)

    await expect(readXmindFile(sourcePath)).rejects.toThrow(
      /source exceeds the 33554432 byte safety limit/
    )
  })

  it('rejects directories as filesystem import sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-'))
    temporaryRoots.push(root)
    const sourcePath = join(root, 'not-a-file.xmind')
    await mkdir(sourcePath)

    await expect(readXmindFile(sourcePath)).rejects.toThrow(
      /source must be a regular file/
    )
  })

  it.skipIf(process.platform === 'win32')('rejects symbolic-link import sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'xmind-file-'))
    temporaryRoots.push(root)
    const sourcePath = join(root, 'valid.xmind')
    const linkPath = join(root, 'linked.xmind')
    await writeFile(sourcePath, buildXmindZip(sampleDocument()))
    await symlink(sourcePath, linkPath)

    await expect(readXmindFile(linkPath)).rejects.toThrow(
      /source must be a regular file, not a directory or symlink/
    )
  })

  it('writes a content.json entry that is a JSON array of sheets', () => {
    const bytes = buildXmindZip(sampleDocument())
    const entries = unzipSync(bytes)
    const content = JSON.parse(strFromU8(entries['content.json']))
    expect(Array.isArray(content)).toBe(true)
    expect(content).toHaveLength(2)
    expect((content[0] as Record<string, unknown>).class).toBe('sheet')
  })

  it('parses a hand-crafted minimal .xmind with one sheet + rootTopic', () => {
    const contentJson = JSON.stringify([
      {
        class: 'sheet',
        id: 'sheet-a',
        title: 'Minimal',
        structureClass: 'org.xmind.ui.logic.right',
        rootTopic: {
          class: 'topic',
          id: 'root-a',
          title: 'Root',
          children: {
            attached: [{ class: 'topic', id: 'child-a', title: 'Child' }]
          }
        }
      }
    ])
    const parsed = parseXmindZip(buildZipWithContent(contentJson))

    expect(parsed.sheets).toHaveLength(1)
    expect(parsed.sheets[0].id).toBe('sheet-a')
    expect(parsed.sheets[0].root.id).toBe('root-a')
    expect(parsed.sheets[0].root.title).toBe('Root')
    expect(parsed.sheets[0].root.children[0].title).toBe('Child')
  })

  it('throws a clear error when content.json is missing', () => {
    const bytes = zipSync({ 'metadata.json': strToU8('{}') })
    expect(() => parseXmindZip(bytes)).toThrow(/missing content\.json/)
  })

  it('throws a clear error on non-ZIP bytes', () => {
    const bytes = strToU8('this is not a zip archive at all')
    expect(() => parseXmindZip(bytes)).toThrow(/not a valid \.xmind/i)
  })

  it('rejects unsafe ZIP entry paths before extraction', () => {
    const contentJson = JSON.stringify([
      {
        class: 'sheet',
        id: 'sheet-safe',
        title: 'Safe',
        rootTopic: { class: 'topic', id: 'root-safe', title: 'Root' }
      }
    ])
    const bytes = buildZipWithContent(contentJson, { '../outside.txt': 'x' })
    expect(() => parseXmindZip(bytes)).toThrow(/unsafe entry path/i)
  })

  it('rejects entries that exceed the uncompressed import budget', () => {
    const oversized = 'x'.repeat(8 * 1024 * 1024 + 1)
    const bytes = buildZipWithContent('[]', { 'attachments/large.bin': oversized })
    expect(() => parseXmindZip(bytes)).toThrow(/exceeds.*safety limit/i)
  })

  it('rejects archives with too many entries', () => {
    const extras = Object.fromEntries(
      Array.from({ length: 127 }, (_, index) => [`extra/${index}.bin`, 'x'])
    )
    const bytes = buildZipWithContent('[]', extras)
    expect(() => parseXmindZip(bytes)).toThrow(/more than 128 entries/i)
  })

  it('tolerates unknown zip entries alongside content.json', () => {
    const contentJson = JSON.stringify([
      {
        class: 'sheet',
        id: 'sheet-x',
        title: 'Unknowns',
        rootTopic: { class: 'topic', id: 'root-x', title: 'Root' }
      }
    ])
    const parsed = parseXmindZip(
      buildZipWithContent(contentJson, {
        'Thumbnails/thumbnail.svg': '<svg/>',
        'something-else.bin': 'junk'
      })
    )
    expect(parsed.sheets).toHaveLength(1)
    expect(parsed.sheets[0].root.title).toBe('Root')
  })
})

describe('buildXmindZipV2 theme roundtrip', () => {
  it('preserves theme background and branch colors in the exported content.json', () => {
    const doc: MindMapDocumentV2 = {
      schemaVersion: 2,
      id: 'v2-doc',
      revision: 1,
      title: 'V2 Test',
      createdAt: NOW,
      updatedAt: NOW,
      theme: {
        id: 'snowbrush',
        background: '#FFFFFF',
        fontFamily: 'system-ui, sans-serif',
        branchColors: ['#FF6B6B', '#97D3B6', '#6FD0F9'],
        rainbowBranches: true
      },
      sheets: [
        {
          id: 'sheet-1',
          title: 'Overview',
          root: { id: 'root', title: 'Root', children: [] },
          elements: [],
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        }
      ],
      assets: []
    }

    const bytes = buildXmindZipV2(doc)
    const unzipped = unzipSync(bytes)
    const contentJson = strFromU8(unzipped['content.json'])
    const content = JSON.parse(contentJson) as Array<Record<string, unknown>>
    const sheet = content[0]
    const theme = sheet.theme as Record<string, unknown>
    expect(theme).toBeDefined()
    expect((theme.map as Record<string, unknown>)['svg:fill']).toBe('#FFFFFF')
    expect(theme.multiLineColors).toBeDefined()
  })

  it('preserves native v2 topic border styles in the exported content.json', () => {
    const doc: MindMapDocumentV2 = {
      schemaVersion: 2,
      id: 'v2-borders',
      revision: 1,
      title: 'Borders',
      createdAt: NOW,
      updatedAt: NOW,
      theme: { id: 'default' },
      sheets: [
        {
          id: 'sheet-1',
          title: 'Overview',
          root: {
            id: 'root',
            title: 'Root',
            style: { stroke: '#123456', borderStyle: 'dash', borderWidth: 5 },
            children: []
          },
          elements: [],
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        }
      ],
      assets: []
    }

    const bytes = buildXmindZipV2(doc)
    const content = JSON.parse(strFromU8(unzipSync(bytes)['content.json'])) as Array<
      Record<string, unknown>
    >
    const root = content[0]!.rootTopic as Record<string, unknown>
    expect((root.style as Record<string, unknown>).properties).toEqual({
      'border-line-color': '#123456',
      'border-line-width': '5',
      'border-line-pattern': 'dash'
    })
  })

  it('exports without a theme block when theme has no visual attributes', () => {
    const doc: MindMapDocumentV2 = {
      schemaVersion: 2,
      id: 'v2-doc-2',
      revision: 1,
      title: 'No Theme',
      createdAt: NOW,
      updatedAt: NOW,
      theme: { id: 'default' },
      sheets: [
        {
          id: 'sheet-1',
          title: 'Overview',
          root: { id: 'root', title: 'Root', children: [] },
          elements: [],
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        }
      ],
      assets: []
    }

    const bytes = buildXmindZipV2(doc)
    const unzipped = unzipSync(bytes)
    const contentJson = strFromU8(unzipped['content.json'])
    const content = JSON.parse(contentJson) as Array<Record<string, unknown>>
    expect(content[0].theme).toBeUndefined()
  })

  it('round-trips topic numbering through the .xmind ZIP and the v1→v2 migration', () => {
    const doc: MindMapDocumentV2 = {
      schemaVersion: 2,
      id: 'v2-numbering',
      revision: 1,
      title: 'Numbered',
      createdAt: NOW,
      updatedAt: NOW,
      theme: { id: 'default' },
      sheets: [
        {
          id: 'sheet-1',
          title: 'Overview',
          root: {
            id: 'root',
            title: 'Root',
            numbering: { pattern: 'arabic', tiered: true, restartAt: 3 },
            children: [
              {
                id: 'child',
                title: 'Child',
                numbering: { pattern: 'roman' },
                children: []
              }
            ]
          },
          elements: [],
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        }
      ],
      assets: []
    }

    const bytes = buildXmindZipV2(doc)
    const content = JSON.parse(strFromU8(unzipSync(bytes)['content.json'])) as Array<
      Record<string, unknown>
    >
    const root = content[0]!.rootTopic as Record<string, unknown>
    expect((root.style as Record<string, unknown>).properties).toEqual({
      'xmind:numbering': 'org.xmind.numbering.arabic',
      'xmind:numbering-tiered': 'true',
      'xmind:numbering-restart-at': '3'
    })
    const child = ((root.children as { attached: Record<string, unknown>[] }).attached)[0]!
    expect((child.style as Record<string, unknown>).properties).toEqual({
      'xmind:numbering': 'org.xmind.numbering.roman'
    })

    // Import the ZIP back through the file boundary, then run the v1→v2
    // migration exactly like the IPC import path does.
    const imported = parseXmindZip(bytes)
    const migrated = migrateV1ToV2(imported)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) return
    const migratedRoot = migrated.value.sheets[0]!.root
    expect(migratedRoot.numbering).toEqual({
      pattern: 'arabic',
      tiered: true,
      restartAt: 3
    })
    expect(migratedRoot.children[0]!.numbering).toEqual({ pattern: 'roman' })
  })

  it('returns a value-free export compatibility report alongside the ZIP bytes', () => {
    const doc: MindMapDocumentV2 = {
      schemaVersion: 2,
      id: 'v2-report',
      revision: 1,
      title: 'Report',
      createdAt: NOW,
      updatedAt: NOW,
      theme: {
        id: 'default',
        background: '#FFFFFF',
        fontFamily: 'system-ui, sans-serif',
        branchColors: ['#FF6B6B'],
        rainbowBranches: true
      },
      assets: [],
      sheets: [
        {
          id: 'sheet-1',
          title: 'Overview',
          root: {
            id: 'root',
            title: 'Root',
            style: { stroke: '#112233', borderStyle: 'hand-drawn-solid' as const },
            children: []
          },
          elements: [
            {
              id: 'boundary-1',
              type: 'boundary',
              topicId: 'root',
              style: { outlineShape: 'rounded-rectangle' }
            }
          ],
          layout: { structureClass: 'org.xmind.ui.logic.right' }
        }
      ]
    }

    const { bytes, compatibilityReport } =
      buildXmindZipV2WithCompatibilityReport(doc)

    // The report corresponds to the exact bytes being written.
    const content = JSON.parse(strFromU8(unzipSync(bytes)['content.json'])) as Array<
      Record<string, unknown>
    >
    expect((content[0]!.theme as Record<string, unknown>).map).toBeDefined()

    expect(compatibilityReport.preserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sheets[].theme.map.svg:fill',
          count: 1
        })
      ])
    )
    expect(compatibilityReport.approximated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'topics[].style.border-line-pattern',
          reason: 'Hand-drawn border is approximated as a solid XMind border'
        })
      ])
    )
    expect(compatibilityReport.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sheets[].elements[].style',
          count: 1
        })
      ])
    )
  })
})
