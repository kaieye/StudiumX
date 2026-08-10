import { describe, expect, it } from 'vitest'

import {
  documentToXmindContent,
  xmindContentToDocument
} from '../../src/shared/mindmap/xmind-converter'
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

describe('documentToXmindContent', () => {
  it('produces a JSON array of sheets with class and children.attached wrappers', () => {
    const content = documentToXmindContent(sampleDocument())
    expect(Array.isArray(content)).toBe(true)
    expect(content).toHaveLength(2)

    const sheet = content[0] as Record<string, unknown>
    expect(sheet.class).toBe('sheet')
    expect(sheet.id).toBe('sheet-1')
    expect(sheet.title).toBe('Sheet 1')
    expect(sheet.structureClass).toBe('org.xmind.ui.logic.right')

    const root = sheet.rootTopic as Record<string, unknown>
    expect(root.class).toBe('topic')
    expect(root.id).toBe('root-1')

    const branch = (root.children as Record<string, unknown>).attached[0] as Record<
      string,
      unknown
    >
    expect(branch.class).toBe('topic')
    expect(branch.note).toBe('a note')
    expect(branch.structureClass).toBe('org.xmind.ui.logic.balanced')
    const leaf = (branch.children as Record<string, unknown>).attached[0] as Record<
      string,
      unknown
    >
    expect(leaf.id).toBe('leaf-1')
  })

  it('omits children.attached for a leaf node', () => {
    const doc = sampleDocument()
    const content = documentToXmindContent(doc)
    const sheet = content[0] as Record<string, unknown>
    const root = sheet.rootTopic as Record<string, unknown>
    const branch = (root.children as Record<string, unknown>).attached[0] as Record<
      string,
      unknown
    >
    const leaf = (branch.children as Record<string, unknown>).attached[0] as Record<
      string,
      unknown
    >
    expect(leaf.children).toBeUndefined()
  })

  it('handles an empty root (no attached children)', () => {
    const content = documentToXmindContent(sampleDocument())
    const sheet = content[1] as Record<string, unknown>
    const root = sheet.rootTopic as Record<string, unknown>
    expect(root.children).toBeUndefined()
  })

  it('round-trips sheet relationships through XMind endpoint wrappers', () => {
    const doc = sampleDocument()
    doc.sheets[0].relationships = [
      {
        id: 'relationship-1',
        from: 'root-1',
        to: 'branch-1',
        label: 'depends on'
      }
    ]

    const content = documentToXmindContent(doc)
    expect(content[0].relationships).toEqual([
      {
        class: 'relationship',
        id: 'relationship-1',
        end1: { id: 'root-1' },
        end2: { id: 'branch-1' },
        title: 'depends on'
      }
    ])

    const roundTripped = xmindContentToDocument(content, { nowIso: NOW })
    expect(roundTripped.sheets[0].relationships).toEqual([
      {
        id: 'relationship-1',
        from: 'root-1',
        to: 'branch-1',
        label: 'depends on'
      }
    ])
  })

  it('imports XMind relationships that use compact endpoint ids', () => {
    const doc = xmindContentToDocument(
      [
        {
          class: 'sheet',
          id: 'sheet-compact-relationship',
          title: 'Compact relationship',
          rootTopic: {
            class: 'topic',
            id: 'root-compact',
            title: 'Root',
            children: {
              attached: [
                { class: 'topic', id: 'child-compact', title: 'Child' }
              ]
            }
          },
          relationships: [
            {
              class: 'relationship',
              id: 'relationship-compact',
              end1Id: 'root-compact',
              end2Id: 'child-compact',
              title: 'depends on'
            }
          ]
        }
      ],
      { nowIso: NOW }
    )

    expect(doc.sheets[0]?.relationships).toEqual([
      {
        id: 'relationship-compact',
        from: 'root-compact',
        to: 'child-compact',
        label: 'depends on'
      }
    ])
  })
})

describe('xmindContentToDocument', () => {
  it('maps an XMind sheet array to a native document', () => {
    const content = documentToXmindContent(sampleDocument())
    const doc = xmindContentToDocument(content, { nowIso: NOW })

    expect(doc.schemaVersion).toBe(1)
    expect(doc.title).toBe('Sheet 1')
    expect(doc.createdAt).toBe(NOW)
    expect(doc.updatedAt).toBe(NOW)
    expect(doc.sheets).toHaveLength(2)

    const sheet = doc.sheets[0]
    expect(sheet.id).toBe('sheet-1')
    expect(sheet.structureClass).toBe('org.xmind.ui.logic.right')
    expect(sheet.root.id).toBe('root-1')
    expect(sheet.root.title).toBe('中心主题')
    expect(sheet.root.collapsed).toBe(false)
    expect(sheet.root.children).toHaveLength(1)
    expect(sheet.root.children[0].note).toBe('a note')
    expect(sheet.root.children[0].structureClass).toBe(
      'org.xmind.ui.logic.balanced'
    )
    expect(sheet.root.children[0].children[0]).toMatchObject({
      id: 'leaf-1',
      title: 'Leaf 1',
      children: []
    })
  })

  it('round-trips: document -> content -> document preserves structure', () => {
    const doc = sampleDocument()
    const roundTripped = xmindContentToDocument(
      documentToXmindContent(doc),
      { nowIso: NOW }
    )
    expect(roundTripped.sheets.map((s) => s.id)).toEqual([
      'sheet-1',
      'sheet-2'
    ])
    expect(roundTripped.sheets[0].root.children[0]).toMatchObject({
      id: 'branch-1',
      title: 'Branch 1',
      note: 'a note',
      structureClass: 'org.xmind.ui.logic.balanced',
      children: [{ id: 'leaf-1', title: 'Leaf 1', children: [] }]
    })
  })

  it('handles an empty sheet array', () => {
    const doc = xmindContentToDocument([], { nowIso: NOW })
    expect(doc.sheets).toEqual([])
    expect(doc.title).toBe('Untitled')
  })

  it('handles deep nesting', () => {
    const content = [
      {
        class: 'sheet',
        id: 's1',
        title: 'Deep',
        rootTopic: deepTopic(0, 40)
      }
    ]
    const doc = xmindContentToDocument(content, { nowIso: NOW })
    let node = doc.sheets[0].root
    let depth = 0
    while (node.children.length > 0) {
      node = node.children[0]
      depth += 1
    }
    expect(depth).toBe(40)
  })

  it('tolerates unknown fields', () => {
    const content = [
      {
        class: 'sheet',
        id: 's1',
        title: 'Extra',
        someExtension: { arbitrary: true },
        rootTopic: {
          class: 'topic',
          id: 'r1',
          title: 'Root',
          image: { src: 'x' },
          markers: [{ symbolId: 'star' }],
          someUnknown: 42,
          children: {
            attached: [
              {
                class: 'topic',
                id: 'c1',
                title: 'Child',
                ext: { version: '1.0' }
              }
            ]
          }
        }
      }
    ]
    const doc = xmindContentToDocument(content, { nowIso: NOW })
    expect(doc.sheets[0].root.id).toBe('r1')
    expect(doc.sheets[0].root.children[0].id).toBe('c1')
    expect(doc.sheets[0].root.children[0].title).toBe('Child')
  })

  it('maps a resolved embedded image path to a topic asset id', () => {
    const content = [
      {
        class: 'sheet',
        id: 's1',
        title: 'Images',
        rootTopic: {
          class: 'topic',
          id: 'r1',
          title: 'Root',
          image: { src: 'attachments/diagram.png' },
          children: {
            attached: [
              {
                class: 'topic',
                id: 'c1',
                title: 'Child',
                image: { src: 'attachments/other.png' }
              }
            ]
          }
        }
      }
    ]

    const doc = xmindContentToDocument(content, {
      nowIso: NOW,
      assetIdForPath: (path) =>
        path === 'attachments/diagram.png' ? 'asset-1' : undefined
    })

    expect(doc.sheets[0]?.root.assetIds).toEqual(['asset-1'])
    expect(doc.sheets[0]?.root.children[0]).not.toHaveProperty('assetIds')
  })

  it('defaults a missing structureClass to right', () => {
    const content = [
      {
        class: 'sheet',
        id: 's1',
        title: 'No Struct',
        rootTopic: { class: 'topic', id: 'r1', title: 'Root' }
      }
    ]
    const doc = xmindContentToDocument(content, { nowIso: NOW })
    expect(doc.sheets[0].structureClass).toBe('org.xmind.ui.logic.right')
  })

  it('defaults a topic-level missing structureClass to undefined (inherits sheet)', () => {
    const content = [
      {
        class: 'sheet',
        id: 's1',
        title: 'No Struct',
        rootTopic: {
          class: 'topic',
          id: 'r1',
          title: 'Root',
          children: {
            attached: [{ class: 'topic', id: 'c1', title: 'Child' }]
          }
        }
      }
    ]
    const doc = xmindContentToDocument(content, { nowIso: NOW })
    expect(doc.sheets[0].root.structureClass).toBeUndefined()
  })

  it('uses Date.now when no nowIso is provided', () => {
    const content = [
      {
        class: 'sheet',
        id: 's1',
        title: 'T',
        rootTopic: { class: 'topic', id: 'r1', title: 'R' }
      }
    ]
    const doc = xmindContentToDocument(content)
    expect(doc.createdAt).toBe(doc.updatedAt)
    expect(Number.isNaN(Date.parse(doc.createdAt))).toBe(false)
  })
})

function deepTopic(depth: number, maxDepth: number): Record<string, unknown> {
  const topic: Record<string, unknown> = {
    class: 'topic',
    id: `t${depth}`,
    title: `T${depth}`
  }
  if (depth < maxDepth) {
    topic.children = { attached: [deepTopic(depth + 1, maxDepth)] }
  }
  return topic
}
