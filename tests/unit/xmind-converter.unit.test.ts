import { describe, expect, it } from 'vitest'

import {
  documentToXmindContent,
  documentV2ToXmindContent,
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

  it('defaults a missing structureClass to balanced', () => {
    const content = [
      {
        class: 'sheet',
        id: 's1',
        title: 'No Struct',
        rootTopic: { class: 'topic', id: 'r1', title: 'Root' }
      }
    ]
    const doc = xmindContentToDocument(content, { nowIso: NOW })
    expect(doc.sheets[0].structureClass).toBe('org.xmind.ui.logic.balanced')
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

describe('documentV2ToXmindContent', () => {
  it('maps theme background, branch colors, and font into the sheet theme block', () => {
    const sheets = [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: { id: 'root', title: 'Root', children: [] },
        structureClass: 'org.xmind.ui.logic.right' as const
      }
    ]
    const theme = {
      id: 'default',
      background: '#FFFFFF',
      fontFamily: 'system-ui, sans-serif',
      branchColors: ['#FF6B6B', '#97D3B6', '#6FD0F9'],
      rainbowBranches: true
    }
    const content = documentV2ToXmindContent(sheets, theme)
    const sheet = content[0] as Record<string, unknown>
    const themeBlock = sheet.theme as Record<string, unknown>
    expect(themeBlock).toBeDefined()
    expect((themeBlock.map as Record<string, unknown>)['svg:fill']).toBe('#FFFFFF')
    expect((themeBlock.defaults as Record<string, unknown>)['fo:font-family']).toBe('system-ui, sans-serif')
    expect(themeBlock.multiLineColors).toEqual({ '0': '#FF6B6B', '1': '#97D3B6', '2': '#6FD0F9' })
  })

  it('exports effective topic border color, width, and dash pattern at every depth', () => {
    const sheets = [
      {
        id: 'sheet-1',
        title: 'Borders',
        root: {
          id: 'root',
          title: 'Root',
          style: { stroke: '#112233', borderWidth: 3, borderStyle: 'solid' as const },
          children: [
            {
              id: 'child',
              title: 'Child',
              style: { stroke: '#445566', borderStyle: 'dash' as const },
              children: [
                { id: 'leaf', title: 'Leaf', children: [] }
              ]
            }
          ]
        },
        structureClass: 'org.xmind.ui.logic.right' as const
      }
    ]
    const theme = {
      id: 'default',
      topicStyles: { main: { borderWidth: 2 }, sub: { borderStyle: 'none' as const } }
    }

    const content = documentV2ToXmindContent(sheets, theme)
    const root = (content[0] as Record<string, unknown>).rootTopic as Record<string, unknown>
    const rootStyle = root.style as Record<string, unknown>
    expect(rootStyle.properties).toEqual({
      'border-line-color': '#112233',
      'border-line-width': '3',
      'border-line-pattern': 'solid'
    })

    const child = ((root.children as { attached: Record<string, unknown>[] }).attached)[0]!
    expect((child.style as Record<string, unknown>).properties).toEqual({
      'border-line-color': '#445566',
      'border-line-width': '2',
      'border-line-pattern': 'dash'
    })

    const leaf = ((child.children as { attached: Record<string, unknown>[] }).attached)[0]!
    expect((leaf.style as Record<string, unknown>).properties).toEqual({
      'border-line-color': 'none',
      'border-line-width': '0'
    })
  })

  it('approximates hand-drawn borders with XMind solid and dash patterns', () => {
    const sheets = [
      {
        id: 'sheet-1',
        title: 'Hand drawn',
        root: {
          id: 'root',
          title: 'Root',
          style: { borderStyle: 'hand-drawn-solid' as const },
          children: [
            {
              id: 'child',
              title: 'Child',
              style: { borderStyle: 'hand-drawn-dash' as const },
              children: []
            }
          ]
        },
        structureClass: 'org.xmind.ui.logic.right' as const
      }
    ]

    const content = documentV2ToXmindContent(sheets, undefined)
    const root = (content[0] as Record<string, unknown>).rootTopic as Record<string, unknown>
    expect((root.style as Record<string, unknown>).properties).toEqual({
      'border-line-pattern': 'solid'
    })
    const child = ((root.children as { attached: Record<string, unknown>[] }).attached)[0]!
    expect((child.style as Record<string, unknown>).properties).toEqual({
      'border-line-pattern': 'dash'
    })
  })

  it('exports independent effective text decorations with XMind canonical tokens', () => {
    const sheets = [{
      id: 'sheet-1',
      title: 'Decorations',
      root: {
        id: 'root',
        title: 'Root',
        style: { textDecoration: 'line-through underline' as const },
        children: [{ id: 'child', title: 'Child', children: [] }]
      },
      structureClass: 'org.xmind.ui.logic.right' as const
    }]

    const content = documentV2ToXmindContent(sheets, {
      id: 'default',
      topicStyles: { main: { textDecoration: 'underline' } }
    })
    const root = (content[0] as Record<string, unknown>).rootTopic as Record<string, unknown>
    expect((root.style as Record<string, unknown>).properties).toEqual({
      'fo:text-decoration': 'line-through underline'
    })
    const child = ((root.children as { attached: Record<string, unknown>[] }).attached)[0]!
    expect((child.style as Record<string, unknown>).properties).toEqual({
      'fo:text-decoration': 'underline'
    })
  })

  it('exports visual text transforms using XMind tokens without rewriting titles', () => {
    const sheets = [{
      id: 'sheet-1',
      title: 'Letter case',
      root: {
        id: 'root',
        title: 'Original Root',
        style: { textTransform: 'none' as const, textAlign: 'right' as const },
        children: [{ id: 'child', title: 'Original Child', children: [] }]
      },
      structureClass: 'org.xmind.ui.logic.right' as const
    }]

    const content = documentV2ToXmindContent(sheets, {
      id: 'default',
      topicStyles: { main: { textTransform: 'uppercase' } }
    })
    const root = (content[0] as Record<string, unknown>).rootTopic as Record<string, unknown>
    expect(root.title).toBe('Original Root')
    expect((root.style as Record<string, unknown>).properties).toEqual({
      'fo:text-transform': 'manual',
      'fo:text-align': 'right'
    })
    const child = ((root.children as { attached: Record<string, unknown>[] }).attached)[0]!
    expect(child.title).toBe('Original Child')
    expect((child.style as Record<string, unknown>).properties).toEqual({
      'fo:text-transform': 'uppercase'
    })
  })

  it('omits theme block when no theme is provided', () => {
    const sheets = [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: { id: 'root', title: 'Root', children: [] },
        structureClass: 'org.xmind.ui.logic.right' as const
      }
    ]
    const content = documentV2ToXmindContent(sheets, undefined)
    const sheet = content[0] as Record<string, unknown>
    expect(sheet.theme).toBeUndefined()
  })

  it('drops branch colors when rainbowBranches is false', () => {
    const sheets = [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: { id: 'root', title: 'Root', children: [] },
        structureClass: 'org.xmind.ui.logic.right' as const
      }
    ]
    const theme = {
      id: 'default',
      branchColors: ['#FF6B6B', '#97D3B6'],
      lineColor: '#8E8E93',
      rainbowBranches: false
    }
    const content = documentV2ToXmindContent(sheets, theme)
    const sheet = content[0] as Record<string, unknown>
    const themeBlock = sheet.theme as Record<string, unknown>
    expect(themeBlock.multiLineColors).toBeUndefined()
    expect(themeBlock.lineColor).toBe('#8E8E93')
  })
})
