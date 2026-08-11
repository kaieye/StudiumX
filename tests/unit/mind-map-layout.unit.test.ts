import { describe, expect, it } from 'vitest'
import type { MindMapStructureClass } from '../../src/shared/mindmap/mind-map-types'
import type {
  MindMapSheetV2,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'
import {
  computeMindMapLayout,
  MIND_MAP_HORIZONTAL_GAP,
  MIND_MAP_VERTICAL_GAP,
  horizontalGapForDepth,
  verticalGapForDepth
} from '../../src/renderer/src/views/mindmap/mind-map-layout'

function node(
  id: string,
  title: string,
  children: MindMapTopicV2[] = [],
  collapsed = false,
  structureClass?: MindMapStructureClass
): MindMapTopicV2 {
  return {
    id,
    title,
    children,
    ...(collapsed ? { collapsed: true } : {}),
    ...(structureClass ? { style: { structureClass } } : {})
  }
}

function sheet(
  root: MindMapTopicV2,
  structureClass: MindMapStructureClass = 'org.xmind.ui.logic.right',
  elements: MindMapSheetV2['elements'] = []
): MindMapSheetV2 {
  return {
    id: 'sheet-1',
    title: 'S',
    root,
    elements,
    layout: { structureClass }
  }
}

describe('computeMindMapLayout', () => {
  it('emits one layout node per node and connects every parent->child edge', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')]),
      node('d', 'D')
    ])
    const { nodes, edges } = computeMindMapLayout(sheet(root))

    expect(nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(edges).toEqual([
      { from: 'a', to: 'b', branchIndex: 0 },
      { from: 'b', to: 'c', branchIndex: 0 },
      { from: 'a', to: 'd', branchIndex: 1 }
    ])
  })

  it('retains labelled sheet relationships separately from tree edges', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { edges, relationships, callouts, summaries, boundaries } = computeMindMapLayout(
      sheet(root, 'org.xmind.ui.logic.right', [
        { id: 'rel-1', type: 'relationship', from: 'b', to: 'c', label: 'depends on' },
        { id: 'callout-1', type: 'callout', topicId: 'a', text: 'note', position: { x: 12, y: 24 } },
        { id: 'summary-1', type: 'summary', from: 'b', to: 'c', label: 'group' }
      ])
    )

    expect(edges).toEqual([
      { from: 'a', to: 'b', branchIndex: 0 },
      { from: 'a', to: 'c', branchIndex: 1 }
    ])
    expect(relationships).toEqual([
      { id: 'rel-1', from: 'b', to: 'c', label: 'depends on' }
    ])
    expect(callouts).toEqual([
      { id: 'callout-1', topicId: 'a', text: 'note', position: { x: 12, y: 24 } }
    ])
    expect(summaries).toEqual([
      { id: 'summary-1', from: 'b', to: 'c', label: 'group' }
    ])
    expect(boundaries).toEqual([])
  })

  it('projects topic markers without changing tree geometry', () => {
    const root = {
      ...node('a', 'A', [node('b', 'B')]),
      markers: [
        { id: 'marker-1', symbol: '★', label: 'Important' },
        { id: 'marker-2', symbol: '!', label: 'Review' }
      ]
    }
    const layout = computeMindMapLayout(sheet(root))
    const rootLayout = layout.nodes.find((layoutNode) => layoutNode.id === 'a')

    expect(rootLayout?.markers).toEqual([
      { id: 'marker-1', symbol: '★', label: 'Important' },
      { id: 'marker-2', symbol: '!', label: 'Review' }
    ])
    expect(layout.edges).toEqual([{ from: 'a', to: 'b', branchIndex: 0 }])
    // Positions are deterministic for the same input. The child is centred on
    // the root midline: (56 root height − 42 branch height) / 2 = 7.
    expect(layout.nodes.map(({ id, y }) => ({ id, y }))).toEqual([
      { id: 'a', y: 0 },
      { id: 'b', y: 7 }
    ])
  })

  it('does not recurse into collapsed subtrees (no descendants emitted)', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')], true),
      node('d', 'D')
    ])
    const { nodes } = computeMindMapLayout(sheet(root))

    expect(nodes.map((n) => n.id)).toEqual(['a', 'b', 'd'])
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
    // b and c are same-height subtrees; sibling gap is depth-based (parent at depth 0).
    expect(c.y - (b.y + b.height)).toBe(verticalGapForDepth(0))
  })

  it('centers children vertically around the parent midline (up-down symmetry)', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C'), node('d', 'D')])
    const { nodes } = computeMindMapLayout(sheet(root))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const a = byId.get('a')!
    const b = byId.get('b')!
    const d = byId.get('d')!
    // The midpoint of the children group (top of first -> bottom of last)
    // coincides with the parent's vertical center.
    const childrenMid = (b.y + (d.y + d.height)) / 2
    expect(childrenMid).toBeCloseTo(a.y + a.height / 2, 5)
  })

  it('places an even number of children symmetrically above and below the parent', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { nodes } = computeMindMapLayout(sheet(root))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const a = byId.get('a')!
    const b = byId.get('b')!
    const c = byId.get('c')!
    const parentMid = a.y + a.height / 2
    // First child sits above the parent center, second below - not both down.
    expect(b.y + b.height).toBeLessThan(parentMid)
    expect(c.y).toBeGreaterThan(parentMid)
  })

  it('centers each side independently for balanced layout (bilateral symmetry)', () => {
    // 4 children in balanced: b(right), c(left), d(right), e(left)
    const root = node('a', 'A', [
      node('b', 'B'),
      node('c', 'C'),
      node('d', 'D'),
      node('e', 'E')
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.balanced'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const a = byId.get('a')!
    const parentMid = a.y + a.height / 2

    // Right-side children (b, d) should be independently centered.
    const b = byId.get('b')!
    const d = byId.get('d')!
    expect(b.x).toBeGreaterThan(a.x) // right side
    expect(d.x).toBeGreaterThan(a.x) // right side
    const rightMid = (b.y + (d.y + d.height)) / 2
    expect(rightMid).toBeCloseTo(parentMid, 5)

    // Left-side children (c, e) should be independently centered.
    const c = byId.get('c')!
    const e = byId.get('e')!
    expect(c.x).toBeLessThan(a.x) // left side
    expect(e.x).toBeLessThan(a.x) // left side
    const leftMid = (c.y + (e.y + e.height)) / 2
    expect(leftMid).toBeCloseTo(parentMid, 5)

    // Right side should not overlap left side vertically beyond the parent.
    // Each side's first child is above the parent center, last below.
    expect(b.y + b.height).toBeLessThan(parentMid)
    expect(d.y).toBeGreaterThan(parentMid)
    expect(c.y + c.height).toBeLessThan(parentMid)
    expect(e.y).toBeGreaterThan(parentMid)
  })

  it('maintains bilateral symmetry at deeper levels for balanced layout', () => {
    // Root has two children, each with two grandchildren.
    const root = node('a', 'A', [
      node('b', 'B', [node('d', 'D'), node('e', 'E')]),
      node('c', 'C', [node('f', 'F'), node('g', 'G')])
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.balanced'))
    const byId = new Map(nodes.map((n) => [n.id, n]))

    // b goes right, c goes left (first-level balanced alternation).
    const a = byId.get('a')!
    const b = byId.get('b')!
    const c = byId.get('c')!
    expect(b.x).toBeGreaterThan(a.x)
    expect(c.x).toBeLessThan(a.x)

    // b's children (d, e) are independently centered around b's midline.
    const bMid = b.y + b.height / 2
    const d = byId.get('d')!
    const e = byId.get('e')!
    const dMid = (d.y + (d.y + d.height)) / 2
    const eMid = (e.y + (e.y + e.height)) / 2
    expect((dMid + eMid) / 2).toBeCloseTo(bMid, 5)

    // c's children (f, g) are independently centered around c's midline.
    const cMid = c.y + c.height / 2
    const f = byId.get('f')!
    const g = byId.get('g')!
    const fMid = (f.y + (f.y + f.height)) / 2
    const gMid = (g.y + (g.y + g.height)) / 2
    expect((fMid + gMid) / 2).toBeCloseTo(cMid, 5)
  })

  it('keeps deeper balanced topics on their branch side (no swing back to the root)', () => {
    // Xmind alternates sides at the root only. Both children of the
    // right-side branch b must lie to b's right; both children of the
    // left-side branch c must lie to c's left.
    const root = node('a', 'A', [
      node('b', 'B', [node('d', 'D'), node('e', 'E')]),
      node('c', 'C', [node('f', 'F'), node('g', 'G')])
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.balanced'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const b = byId.get('b')!
    const c = byId.get('c')!
    expect(byId.get('d')!.x).toBeGreaterThan(b.x)
    expect(byId.get('e')!.x).toBeGreaterThan(b.x)
    expect(byId.get('f')!.x).toBeLessThan(c.x)
    expect(byId.get('g')!.x).toBeLessThan(c.x)
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

  it('places children below and spreads them horizontally for the down structure class', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C'), node('d', 'D')])
    const { nodes, edges } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.down'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const rootNode = byId.get('a')!
    const children = ['b', 'c', 'd'].map((id) => byId.get(id)!)

    expect(children.every((child) => child.y > rootNode.y)).toBe(true)
    expect(children.map((child) => child.x)).toEqual([...children].sort((a, b) => a.x - b.x).map((child) => child.x))
    expect(new Set(children.map((child) => child.y)).size).toBe(1)
    expect(edges).toEqual([
      { from: 'a', to: 'b', branchIndex: 0 },
      { from: 'a', to: 'c', branchIndex: 1 },
      { from: 'a', to: 'd', branchIndex: 2 }
    ])
  })

  it('places children above for the up structure class', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.up'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const rootNode = byId.get('a')!
    const children = ['b', 'c'].map((id) => byId.get(id)!)

    expect(children.every((child) => child.y + child.height < rootNode.y + rootNode.height)).toBe(true)
    expect(new Set(children.map((child) => child.y)).size).toBe(1)
    expect(children[0]!.x).not.toBe(children[1]!.x)
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
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')], false, 'org.xmind.ui.logic.left')
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
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

  it('auto-sizes node width based on title length', () => {
    const shortRoot = node('a', 'Hi', [node('b', 'B')])
    const longRoot = node('a', 'This is a very long topic title that should produce a wider node', [node('b', 'B')])
    const shortLayout = computeMindMapLayout(sheet(shortRoot))
    const longLayout = computeMindMapLayout(sheet(longRoot))

    const shortNode = shortLayout.nodes.find((n) => n.id === 'a')!
    const longNode = longLayout.nodes.find((n) => n.id === 'a')!
    expect(longNode.width).toBeGreaterThan(shortNode.width)
    expect(shortNode.width).toBeGreaterThanOrEqual(72) // minimum width
  })

  it('measures untitled topics as the placeholder when emptyTitleFallback is set', () => {
    const root = node('a', 'A', [node('b', '')])
    const bare = computeMindMapLayout(sheet(root))
    const withFallback = computeMindMapLayout(sheet(root), { emptyTitleFallback: '未命名主题' })

    const bareB = bare.nodes.find((n) => n.id === 'b')!
    const fallbackB = withFallback.nodes.find((n) => n.id === 'b')!
    // The placeholder widens the measured chip but never rewrites the title.
    expect(fallbackB.width).toBeGreaterThan(bareB.width)
    expect(fallbackB.title).toBe('')
  })

  it('assigns branch indices for per-branch colouring', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')]),
      node('d', 'D', [node('e', 'E')])
    ])
    const { nodes, edges } = computeMindMapLayout(sheet(root))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    // Root has branchIndex 0
    expect(byId.get('a')!.branchIndex).toBe(0)
    // First-level children get their own branch index
    expect(byId.get('b')!.branchIndex).toBe(0)
    expect(byId.get('d')!.branchIndex).toBe(1)
    // Descendants inherit their parent's branch index
    expect(byId.get('c')!.branchIndex).toBe(0)
    expect(byId.get('e')!.branchIndex).toBe(1)
    // Edges carry the child's branch index
    expect(edges.find((e) => e.to === 'b')?.branchIndex).toBe(0)
    expect(edges.find((e) => e.to === 'd')?.branchIndex).toBe(1)
  })

  it('computes boundary rectangles from layout nodes', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')]),
      node('d', 'D')
    ])
    const { boundaries } = computeMindMapLayout(
      sheet(root, 'org.xmind.ui.logic.right', [
        { id: 'bound-1', type: 'boundary', topicId: 'a', children: ['b', 'c'] }
      ])
    )
    expect(boundaries).toHaveLength(1)
    expect(boundaries[0]!.id).toBe('bound-1')
    expect(boundaries[0]!.width).toBeGreaterThan(0)
    expect(boundaries[0]!.height).toBeGreaterThan(0)
  })

  it('keeps horizontal gap between parent edge and child edge constant', () => {
    const root = node('a', 'A', [node('b', 'B')])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const a = byId.get('a')!
    const b = byId.get('b')!
    expect(b.x - (a.x + a.width)).toBe(horizontalGapForDepth(0))
  })

  it('uses depth-based horizontal gap (root->L1 wider than deeper)', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')])
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'org.xmind.ui.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const a = byId.get('a')!
    const b = byId.get('b')!
    const c = byId.get('c')!
    // root -> L1 gap is 64
    expect(b.x - (a.x + a.width)).toBe(horizontalGapForDepth(0))
    // L1 -> L2 gap is 44
    expect(c.x - (b.x + b.width)).toBe(horizontalGapForDepth(1))
  })

  it('uses depth-based vertical gap (L1 siblings wider than deeper)', () => {
    const root = node('a', 'A', [
      node('b', 'B'),
      node('c', 'C')
    ])
    const deepRoot = node('a', 'A', [
      node('b', 'B', [
        node('d', 'D'),
        node('e', 'E')
      ])
    ])
    const { nodes } = computeMindMapLayout(sheet(root))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const b = byId.get('b')!
    const c = byId.get('c')!
    // L1 siblings (parent at depth 0) have gap 24
    expect(c.y - (b.y + b.height)).toBe(verticalGapForDepth(0))

    const deepLayout = computeMindMapLayout(sheet(deepRoot))
    const deepById = new Map(deepLayout.nodes.map((n) => [n.id, n]))
    const d = deepById.get('d')!
    const e = deepById.get('e')!
    // Deeper siblings (parent at depth 1) have gap 10
    expect(e.y - (d.y + d.height)).toBe(verticalGapForDepth(1))
  })

  it('counts hidden descendants for collapsed node badge', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C'), node('d', 'D')], true),
      node('e', 'E')
    ])
    const { nodes } = computeMindMapLayout(sheet(root))
    const collapsedNode = nodes.find((n) => n.id === 'b')!
    expect(collapsedNode.collapsed).toBe(true)
    expect(collapsedNode.hiddenDescendantCount).toBe(2)
  })

  it('counts nested hidden descendants for collapsed node badge', () => {
    const root = node('a', 'A', [
      node('b', 'B', [
        node('c', 'C', [node('x', 'X'), node('y', 'Y')]),
        node('d', 'D')
      ], true)
    ])
    const { nodes } = computeMindMapLayout(sheet(root))
    const collapsedNode = nodes.find((n) => n.id === 'b')!
    expect(collapsedNode.hiddenDescendantCount).toBe(4)
  })
})
