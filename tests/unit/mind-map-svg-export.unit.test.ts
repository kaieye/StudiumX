import { describe, expect, it } from 'vitest'

import {
  serializeMindMapSvg,
  type MindMapSvgExportInput
} from '../../src/shared/mindmap/svg-export'

function sampleInput(): MindMapSvgExportInput {
  return {
    title: 'A <safe> map',
    nodes: [
      {
        id: 'root',
        title: 'Root & center',
        x: -80,
        y: 0,
        width: 160,
        height: 40
      },
      {
        id: 'child',
        title: 'Child\nnode',
        x: 160,
        y: 80,
        width: 160,
        height: 40,
        collapsed: true
      }
    ],
    edges: [{ from: 'root', to: 'child', label: 'supports & links' }]
  }
}

describe('serializeMindMapSvg', () => {
  it('serializes a bounded layout as static, escaped SVG', () => {
    const svg = serializeMindMapSvg(sampleInput())

    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('viewBox="0 0 496 216"')
    expect(svg).toContain('aria-label="A &lt;safe&gt; map"')
    expect(svg).toContain('data-node-id="root"')
    expect(svg).toContain('data-collapsed="true"')
    expect(svg).toContain('Root &amp; center')
    expect(svg).toContain('Child node')
    expect(svg).toContain('<path d="M 80 20 C 120 20, 120 100, 160 100"')
    expect(svg).toContain('data-edge-label="true"')
    expect(svg).toContain('supports &amp; links')
    expect(svg).not.toContain('foreignObject')
    expect(svg).not.toContain('<script')
  })

  it('fails closed for duplicate ids, dangling edges, and invalid geometry', () => {
    expect(() =>
      serializeMindMapSvg({
        ...sampleInput(),
        nodes: [...sampleInput().nodes, sampleInput().nodes[0]]
      })
    ).toThrow(/duplicate/i)

    expect(() =>
      serializeMindMapSvg({ ...sampleInput(), edges: [{ from: 'root', to: 'missing' }] })
    ).toThrow(/missing node/i)

    expect(() =>
      serializeMindMapSvg({
        ...sampleInput(),
        edges: [{ from: 'root', to: 'child', label: 42 as unknown as string }]
      })
    ).toThrow(/edge label must be a string/i)

    expect(() =>
      serializeMindMapSvg({
        ...sampleInput(),
        nodes: [{ ...sampleInput().nodes[0], width: Number.NaN }]
      })
    ).toThrow(/invalid geometry/i)
  })

  it('uses safe style fallbacks and preserves no executable option text', () => {
    const svg = serializeMindMapSvg(sampleInput(), {
      background: 'url(javascript:alert(1))',
      nodeFill: 'red" onload="alert(1)',
      fontFamily: 'Arial; color: red'
    })

    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('font-family="system-ui, sans-serif"')
    expect(svg).not.toContain('javascript:')
    expect(svg).not.toContain('onload=')
  })
})
