import { describe, expect, it } from 'vitest'
import type { MindMapNode, MindMapSheet } from '../../src/shared/mindmap/mind-map-types'
import {
  computeMindMapLayout,
  MIND_MAP_HORIZONTAL_GAP,
  MIND_MAP_NODE_HEIGHT,
  MIND_MAP_NODE_WIDTH,
  MIND_MAP_VERTICAL_GAP
} from '../../src/renderer/src/views/mindmap/mind-map-layout'

function node(
  id: string,
  title: string,
  children: MindMapNode[] = [],
  collapsed = false,
  structureClass?: MindMapNode['structureClass']
): MindMapNode {
  return structureClass ? { id, title, children, collapsed, structureClass } : { id, title, children, collapsed }
}

function sheet(root: MindMapNode, structureClass: MindMapSheet['structureClass'] = 'org.xmind.ui.logic.right'): MindMapSheet {
  return { id: 'sheet-1', title: 'S', structureClass, root }
}

describe('computeMindMapLayout', () => {
  it('emits one layout node per node and connects every parent→child edge', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')]),
      node('d', 'D')
    ])
    const { nodes, edges } = computeMindMapLayout(sheet(root))

    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(edges).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'd' }
    ])
  })

  it('does not recurse into collapsed subtrees (no descendants emitted)', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')], true),
      node('d', 'D')
    ])
    const { nodes } = computeMindMapLayout(sheet(root))

    expect(nodes.map((n) => n.id)).toEqual(['a', 'b', 'd'])
    // The collapsed node itself is still rendered.
    expect(nodes.find((n) => n.id === 'b')?.collapsed).toBe(true)
  })

  it('produces deterministic positions for the same input', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C'), node('d', 'D')])
    const first = computeMindMapLayout(sheet(root))
    const second = computeMindMapLayout(sheet(root))
    expect(first.nodes).toEqual(second.nodes)
    expect(first.edges).toEqual(second.edges)
  })

  it('spreads siblings vertically based on subtree height with a fixed gap', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { nodes } = computeMindMapLayout(sheet(root))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const b = byId.get('b')!
    const c = byId.get('c')!
    // b and c are same-height subtrees, so their top edges are gap apart (>0).
    expect(c.y - (b.y + MIND_MAP_NODE_HEIGHT)).toBe(MIND_MAP_VERTICAL_GAP)
  })

  it('places children to the right (+x) for the right structure class', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const id of ['b', 'c']) {
      expect(byId.get(id)!.x).toBeGreaterThan(byId.get('a')!.x)
    }
  })

  it('places children to the left (−x) for the left structure class', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.left'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const id of ['b', 'c']) {
      expect(byId.get(id)!.x).toBeLessThan(byId.get('a')!.x)
    }
  })

  it('spreads children across both sides for balanced/map (some negative x)', () => {
    const root = node('a', 'A', [
      node('b', 'B'),
      node('c', 'C'),
      node('d', 'D')
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.balanced'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const rootX = byId.get('a')!.x
    const childXs = ['b', 'c', 'd'].map((id) => byId.get(id)!.x)
    expect(childXs.some((x) => x > rootX)).toBe(true)
    expect(childXs.some((x) => x < rootX)).toBe(true)
  })

  it('honors a per-node structureClass override for its children', () => {
    // The node-level override governs how that node's own children fan out.
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')], false, 'org.xmind.ui.logic.left')
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    // b sits to the right of a (root is right), but b's child c fades left of b.
    expect(byId.get('b')!.x).toBeGreaterThan(byId.get('a')!.x)
    expect(byId.get('c')!.x).toBeLessThan(byId.get('b')!.x)
  })

  it('keeps assignments O(n) shaped (no duplicated nodes or edges)', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C'), node('d', 'D')]),
      node('e', 'E')
    ])
    const { nodes, edges } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.map'))
    expect(nodes.length).toBe(5)
    expect(edges.length).toBe(4)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(5)
  })

  it('uses the expected fixed node dimensions and horizontal child offset', () => {
    const root = node('a', 'A', [node('b', 'B')])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const a = byId.get('a')!
    const b = byId.get('b')!
    expect(a.width).toBe(MIND_MAP_NODE_WIDTH)
    expect(a.height).toBe(MIND_MAP_NODE_HEIGHT)
    expect(b.x - (a.x + MIND_MAP_NODE_WIDTH)).toBe(MIND_MAP_HORIZONTAL_GAP)
  })
})