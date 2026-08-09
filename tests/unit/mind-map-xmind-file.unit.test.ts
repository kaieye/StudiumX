import { describe, expect, it } from 'vitest'

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import {
  buildXmindZip,
  parseXmindZip
} from '../../src/main/mindmap/xmind-file'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'

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
  extra: Record<string, string> = {}
): Uint8Array {
  return zipSync({
    'content.json': strToU8(contentJson),
    'metadata.json': strToU8('{}'),
    'manifest.json': strToU8('{}'),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)]))
  })
}

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