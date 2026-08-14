import { describe, expect, it } from 'vitest'

import {
  mindMapLayoutToSvgInput,
  mindMapResolvedSvgOptions
} from '../../src/renderer/src/views/mindmap/mind-map-svg-adapter'
import { branchColor } from '../../src/renderer/src/views/mindmap/mind-map-branch-colors'
import { resolveEffectiveTopicStyle } from '../../src/renderer/src/views/mindmap/mind-map-topic-style'
import type { MindMapLayoutResult } from '../../src/renderer/src/views/mindmap/mind-map-layout'
import type { MindMapTheme } from '../../src/shared/mindmap/domain/types'

function sampleLayout(): MindMapLayoutResult {
  return {
    nodes: [
      {
        id: 'root',
        title: 'Root',
        x: -80,
        y: 0,
        width: 160,
        height: 40,
        depth: 0,
        collapsed: false,
        note: 'not part of static SVG input'
      },
      {
        id: 'child',
        title: 'Child',
        x: 160,
        y: 80,
        width: 160,
        height: 40,
        depth: 1,
        collapsed: true
      }
    ],
    edges: [{ from: 'root', to: 'child' }],
    relationships: [],
    callouts: [],
    summaries: []
  }
}

describe('mindMapLayoutToSvgInput', () => {
  it('maps the visible layout without renderer-only fields or mutation', () => {
    const layout = sampleLayout()
    const before = structuredClone(layout)

    expect(mindMapLayoutToSvgInput('Sheet title', layout)).toEqual({
      title: 'Sheet title',
      nodes: [
        {
          id: 'root',
          title: 'Root',
          x: -80,
          y: 0,
          width: 160,
          height: 40,
          collapsed: false
        },
        {
          id: 'child',
          title: 'Child',
          x: 160,
          y: 80,
          width: 160,
          height: 40,
          collapsed: true
        }
      ],
      edges: [{ from: 'root', to: 'child' }]
    })
    expect(layout).toEqual(before)
  })

  it('adds visible relationship elements to the exported edge list', () => {
    const layout = sampleLayout()

    expect(
      mindMapLayoutToSvgInput('Sheet title', layout, [
        {
          id: 'relationship-1',
          type: 'relationship',
          from: 'root',
          to: 'child',
          label: 'supports'
        },
        {
          id: 'relationship-hidden',
          type: 'relationship',
          from: 'root',
          to: 'missing',
          label: 'not exported'
        }
      ])
    ).toMatchObject({
      edges: [
        { from: 'root', to: 'child' },
        { from: 'root', to: 'child', label: 'supports' }
      ]
    })
  })

  it('embeds resolved options only when provided (backward compatible)', () => {
    expect(mindMapLayoutToSvgInput('Sheet title', sampleLayout()).options).toBeUndefined()

    const themed = mindMapLayoutToSvgInput('Sheet title', sampleLayout(), [], {
      background: '#111827',
      nodeFill: '#334155',
      edgeStroke: '#94a3b8'
    })
    expect(themed.options).toEqual({
      background: '#111827',
      nodeFill: '#334155',
      edgeStroke: '#94a3b8'
    })
  })
})

describe('mindMapResolvedSvgOptions', () => {
  function themedTheme(overrides: Partial<MindMapTheme> = {}): MindMapTheme {
    return {
      id: 'theme-test',
      name: 'Test',
      background: '#101828',
      textColor: '#F9FAFB',
      lineColor: '#64748B',
      rainbowBranches: false,
      fontFamily: 'Arial, sans-serif',
      branchColors: ['#FF6B6B', '#FF9F69', '#97D3B6'],
      topicStyles: {
        central: {
          fill: '#1D4ED8',
          stroke: '#93C5FD',
          textColor: '#FFFFFF',
          fontFamily: 'Georgia, serif',
          fontSize: 28
        }
      },
      ...overrides
    }
  }

  it('derives background from the resolved theme background', () => {
    expect(mindMapResolvedSvgOptions(themedTheme()).background).toBe('#101828')
    expect(mindMapResolvedSvgOptions(themedTheme({ background: 'transparent' })).background).toBe('#ffffff')
    expect(mindMapResolvedSvgOptions(themedTheme({ background: '#101828ff' })).background).toBe('#101828ff')
    // Semi-transparent 8-digit hex is flattened to a solid colour.
    expect(mindMapResolvedSvgOptions(themedTheme({ background: '#10182880' })).background).toBe('#101828')
  })

  it('uses the same resolved central-topic style as the canvas', () => {
    const theme = themedTheme()
    const central = resolveEffectiveTopicStyle(undefined, theme, 0) ?? {}
    const options = mindMapResolvedSvgOptions(theme)
    expect(options.nodeFill).toBe(central.fill)
    expect(options.nodeStroke).toBe(central.stroke)
    expect(options.textColor).toBe(central.textColor)
    expect(options.fontFamily).toBe(central.fontFamily)
  })

  it('falls back to the document theme text/font when central omits them', () => {
    const theme = themedTheme({ topicStyles: { central: { fill: '#1D4ED8' } } })
    const options = mindMapResolvedSvgOptions(theme)
    expect(options.nodeFill).toBe('#1D4ED8')
    expect(options.textColor).toBe(theme.textColor)
    expect(options.fontFamily).toBe(theme.fontFamily)
  })

  it('uses branchColor(theme, 0) semantics for the level-1 edge colour', () => {
    const theme = themedTheme({ rainbowBranches: false, lineColor: '#123456' })
    expect(mindMapResolvedSvgOptions(theme).edgeStroke).toBe(branchColor(theme, 0))
    expect(mindMapResolvedSvgOptions(theme).edgeStroke).toBe('#123456')

    const rainbow = themedTheme({ rainbowBranches: true })
    expect(mindMapResolvedSvgOptions(rainbow).edgeStroke).toBe(branchColor(rainbow, 0))
    expect(mindMapResolvedSvgOptions(rainbow).edgeStroke).toBe(rainbow.branchColors![0])
  })
})
