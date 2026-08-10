import { describe, expect, it } from 'vitest'

import {
  buildXmindImportCompatibilityReport,
  emptyXmindCompatibilityReport
} from '../../src/shared/mindmap/xmind-compatibility'

describe('XMind compatibility report', () => {
  it('returns a fresh report with the four fixed categories', () => {
    const first = emptyXmindCompatibilityReport()
    const second = emptyXmindCompatibilityReport()

    expect(first).toEqual({
      preserved: [],
      approximated: [],
      dropped: [],
      warnings: []
    })
    expect(first).not.toBe(second)
    expect(first.preserved).not.toBe(second.preserved)
  })

  it('reports supported fields, approximations, dropped fields, and warnings', () => {
    const report = buildXmindImportCompatibilityReport([
      {
        class: 'sheet',
        id: 'sheet-1',
        title: 'Sheet',
        // Missing structureClass is approximated to the right layout.
        rootTopic: {
          class: 'topic',
          id: 'root-1',
          title: 'Root',
          markers: ['star'],
          image: { src: 'attachments/pic.png' },
          children: {
            attached: [
              {
                class: 'topic',
                id: 'child-1',
                title: 'Child',
                labels: ['important']
              }
            ]
          }
        },
        relationships: [{ id: 'rel-1' }]
      }
    ])

    expect(report.preserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sheets', count: 1 }),
        expect.objectContaining({ path: 'sheets[].id', count: 1 }),
        expect.objectContaining({ path: 'sheets[].rootTopic', count: 1 }),
        expect.objectContaining({ path: 'topics[].id', count: 2 }),
        expect.objectContaining({ path: 'topics[].children.attached', count: 1 })
      ])
    )
    expect(report.approximated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sheets[].structureClass', count: 1 })
      ])
    )
    expect(report.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sheets[].relationships[].end1', count: 1 }),
        expect.objectContaining({ path: 'sheets[].relationships[].end2', count: 1 }),
        expect.objectContaining({ path: 'topics[].markers', count: 1 }),
        expect.objectContaining({ path: 'topics[].image', count: 1 }),
        expect.objectContaining({ path: 'topics[].labels', count: 1 })
      ])
    )
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'topics[].image', count: 1 })
      ])
    )
  })

  it('marks valid relationships as preserved and malformed endpoints as dropped', () => {
    const report = buildXmindImportCompatibilityReport([
      {
        class: 'sheet',
        id: 'sheet-1',
        title: 'Sheet',
        rootTopic: {
          class: 'topic',
          id: 'root-1',
          title: 'Root'
        },
        relationships: [
          {
            class: 'relationship',
            id: 'rel-1',
            end1: { id: 'root-1' },
            end2: { id: 'child-1' },
            title: 'links to'
          },
          { id: 'rel-bad', end1: { id: 'root-1' } }
        ]
      }
    ])

    expect(report.preserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sheets[].relationships',
          count: 1,
          reason: 'Sheet relationships map to StudiumX relationship elements'
        })
      ])
    )
    expect(report.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sheets[].relationships[].end2', count: 1 })
      ])
    )
  })

  it('recognizes compact XMind relationship endpoint ids', () => {
    const report = buildXmindImportCompatibilityReport([
      {
        class: 'sheet',
        id: 'sheet-compact',
        title: 'Compact relationships',
        rootTopic: {
          class: 'topic',
          id: 'root-compact',
          title: 'Root'
        },
        relationships: [
          {
            id: 'rel-compact',
            end1Id: 'root-compact',
            end2Id: 'child-compact',
            title: 'links to'
          }
        ]
      }
    ])

    expect(report.preserved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sheets[].relationships',
          count: 1,
          reason: 'Sheet relationships map to StudiumX relationship elements'
        })
      ])
    )
    expect(report.dropped).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sheets[].relationships[].end1' }),
        expect.objectContaining({ path: 'sheets[].relationships[].end2' })
      ])
    )
  })

  it('does not expose foreign values and reports malformed content', () => {
    const cyclic: Record<string, unknown> = {
      class: 'topic',
      id: 'root',
      title: 'Root'
    }
    cyclic.extension = cyclic
    cyclic.children = { attached: [cyclic] }

    const report = buildXmindImportCompatibilityReport([
      {
        class: 'sheet',
        id: 'sheet-1',
        title: 'Sheet',
        structureClass: 'org.xmind.ui.logic.unknown',
        rootTopic: cyclic
      },
      null,
      'not-a-sheet'
    ])

    expect(report.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'topics[].extension' }),
        expect.objectContaining({ path: 'sheets[].structureClass' }),
        expect.objectContaining({ path: 'sheets[]' })
      ])
    )
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sheets[].structureClass' }),
        expect.objectContaining({ path: 'sheets[]' })
      ])
    )
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('not-a-sheet')
    expect(serialized).not.toContain('attachments')
  })

  it('reports non-array content without throwing', () => {
    const report = buildXmindImportCompatibilityReport({ sheets: [] })
    expect(report).toEqual({
      preserved: [],
      approximated: [],
      dropped: [],
      warnings: [
        {
          path: 'content',
          count: 1,
          reason: 'Expected content.json to contain a sheet array'
        }
      ]
    })
  })

  it('adds explainable warnings for unsupported elements and opaque extension bags', () => {
    const report = buildXmindImportCompatibilityReport([
      {
        class: 'sheet',
        id: 'sheet-1',
        title: 'Sheet',
        relationships: [{ id: 'relationship-1', from: 'a', to: 'b' }],
        extensions: {
          html: '<script>alert(1)</script>',
          providerPayload: { shouldNotAppear: true }
        },
        rootTopic: {
          class: 'topic',
          id: 'root-1',
          title: 'Root',
          markers: [{ id: 'marker-1' }],
          extensionData: { opaque: 'foreign value' }
        }
      }
    ])

    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'sheets[].extensions',
          count: 1,
          reason: 'Foreign extension bag was not retained at the XMind import boundary'
        }),
        expect.objectContaining({
          path: 'topics[].markers',
          count: 1,
          reason: 'Unsupported XMind element metadata was not migrated into StudiumX elements'
        }),
        expect.objectContaining({
          path: 'topics[].extensionData',
          count: 1,
          reason: 'Foreign extension bag was not retained at the XMind import boundary'
        })
      ])
    )
    expect(report.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'sheets[].extensions', count: 1 }),
        expect.objectContaining({ path: 'topics[].markers', count: 1 }),
        expect.objectContaining({ path: 'topics[].extensionData', count: 1 })
      ])
    )
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('<script>')
    expect(serialized).not.toContain('providerPayload')
    expect(serialized).not.toContain('foreign value')
  })
})
