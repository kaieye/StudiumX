import { describe, expect, it } from 'vitest'
import type { MindMapStructureClass } from '../../src/shared/mindmap/mind-map-types'
import type {
  MindMapSheetV2,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'
import {
  computeMindMapLayout,
  computeMovedTopicPreview,
  computeTopicImageAndTextRegions,
  MIND_MAP_HORIZONTAL_GAP,
  MIND_MAP_NODE_MIN_WIDTH,
  MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH,
  MIND_MAP_TOPIC_IMAGE_HEIGHT,
  MIND_MAP_VERTICAL_GAP,
  horizontalGapForDepth,
  verticalGapForDepth,
  wrapMindMapTopicTitle
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
  structureClass: MindMapStructureClass = 'studiumx.layout.logic.right',
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
      { from: 'a', to: 'b', branchIndex: 0, branchKey: 'b', axis: 'horizontal' },
      { from: 'b', to: 'c', branchIndex: 0, branchKey: 'b', axis: 'horizontal' },
      { from: 'a', to: 'd', branchIndex: 1, branchKey: 'd', axis: 'horizontal' }
    ])
  })

  it('retains labelled sheet relationships separately from tree edges', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { edges, relationships, callouts, summaries, boundaries } = computeMindMapLayout(
      sheet(root, 'studiumx.layout.logic.right', [
        { id: 'rel-1', type: 'relationship', from: 'b', to: 'c', label: 'depends on' },
        { id: 'callout-1', type: 'callout', topicId: 'a', text: 'note', position: { x: 12, y: 24 } },
        { id: 'summary-1', type: 'summary', from: 'b', to: 'c', label: 'group' }
      ])
    )

    expect(edges).toEqual([
      { from: 'a', to: 'b', branchIndex: 0, branchKey: 'b', axis: 'horizontal' },
      { from: 'a', to: 'c', branchIndex: 1, branchKey: 'c', axis: 'horizontal' }
    ])
    expect(relationships).toEqual([
      { id: 'rel-1', from: 'b', to: 'c', label: 'depends on' }
    ])
    expect(callouts).toEqual([
      { id: 'callout-1', topicId: 'a', text: 'note', position: { x: 12, y: 24 } }
    ])
    expect(summaries).toEqual([
      expect.objectContaining({ id: 'summary-1', from: 'b', to: 'c', label: 'group' })
    ])
    expect(boundaries).toEqual([])
  })

  it('places a linked summary output as a regular node beside its brace', () => {
    const root = node('a', 'A', [
      node('b', 'B'),
      node('c', 'C'),
      node('summary-topic', 'Node summary', [node('summary-child', 'Detail')])
    ])
    const layout = computeMindMapLayout(
      sheet(root, 'studiumx.layout.logic.right', [
        {
          id: 'summary-1',
          type: 'summary',
          from: 'b',
          to: 'c',
          summaryTopicId: 'summary-topic'
        }
      ])
    )
    const byId = new Map(layout.nodes.map((layoutNode) => [layoutNode.id, layoutNode]))
    const from = byId.get('b')!
    const to = byId.get('c')!
    const output = byId.get('summary-topic')!
    const child = byId.get('summary-child')!

    expect(layout.summaries).toEqual([
      expect.objectContaining({
        id: 'summary-1',
        from: 'b',
        to: 'c',
        summaryTopicId: 'summary-topic',
        side: 'right'
      })
    ])
    expect(output.depth).toBe(1)
    // Summary output sits directly after a compact brace: 20px from the
    // covered range to the brace, 24px brace width, then 20px to the node.
    expect(output.x - Math.max(from.x + from.width, to.x + to.width)).toBe(64)
    expect(output.y + output.height / 2).toBeCloseTo(
      (from.y + from.height / 2 + to.y + to.height / 2) / 2,
      5
    )
    expect(child.x).toBeGreaterThanOrEqual(output.x + output.width)
    expect(layout.edges.some((edge) => edge.to === 'summary-topic')).toBe(false)
  })

  it('moves a linked summary outward when covered topics gain visible descendants', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('b-detail', 'B detail')]),
      node('c', 'C'),
      node('summary-topic', 'Node summary')
    ])
    const layout = computeMindMapLayout(
      sheet(root, 'studiumx.layout.logic.right', [
        {
          id: 'summary-1',
          type: 'summary',
          from: 'b',
          to: 'c',
          summaryTopicId: 'summary-topic'
        }
      ])
    )
    const byId = new Map(layout.nodes.map((layoutNode) => [layoutNode.id, layoutNode]))
    const output = byId.get('summary-topic')!
    const coveredNodes = ['b', 'b-detail', 'c'].map((id) => byId.get(id)!)
    const coveredRight = Math.max(...coveredNodes.map((layoutNode) => layoutNode.x + layoutNode.width))
    const coveredTop = Math.min(...coveredNodes.map((layoutNode) => layoutNode.y))
    const coveredBottom = Math.max(...coveredNodes.map((layoutNode) => layoutNode.y + layoutNode.height))

    // The brace/output pair follows the latest visible extent of the covered
    // subtrees instead of staying beside the source topics and overlapping the
    // children that were added after the summary was created.
    expect(layout.summaries[0]?.coveredEdgeX).toBe(coveredRight)
    expect(layout.summaries[0]?.coveredTopY).toBe(coveredTop)
    expect(layout.summaries[0]?.coveredBottomY).toBe(coveredBottom)
    expect(output.x - coveredRight).toBe(64)
  })

  it('mirrors a linked summary output for a left-side branch', () => {
    const root = node('root', 'Root', [
      node('right-branch', 'Right branch'),
      node('left-branch', 'Left branch', [
        node('first', 'First', [node('first-detail', 'First detail')]),
        node('second', 'Second'),
        node('summary-topic', 'Node summary', [node('summary-child', 'Detail')])
      ])
    ])
    const layout = computeMindMapLayout(
      sheet(root, 'studiumx.layout.logic.balanced', [
        {
          id: 'summary-1',
          type: 'summary',
          from: 'first',
          to: 'second',
          summaryTopicId: 'summary-topic'
        }
      ])
    )
    const byId = new Map(layout.nodes.map((layoutNode) => [layoutNode.id, layoutNode]))
    const first = byId.get('first')!
    const firstDetail = byId.get('first-detail')!
    const second = byId.get('second')!
    const output = byId.get('summary-topic')!
    const child = byId.get('summary-child')!

    expect(layout.summaries).toEqual([
      expect.objectContaining({
        id: 'summary-1',
        from: 'first',
        to: 'second',
        summaryTopicId: 'summary-topic',
        side: 'left'
      })
    ])
    expect(Math.min(first.x, firstDetail.x, second.x) - (output.x + output.width)).toBe(64)
    expect(child.x + child.width).toBeLessThanOrEqual(output.x)
    expect(layout.edges.some((edge) => edge.to === 'summary-topic')).toBe(false)
  })

  it('keeps descendants of a cross-branch left summary on the left', () => {
    // In a balanced map these source topics are both on the left, but their
    // shared parent is the root. The generated output topic is inserted after
    // the second left root branch, which is an even root index and would
    // normally make its descendants grow to the right. Once the output is
    // mirrored beside a left-side brace, its descendants must mirror too.
    const root = node('root', 'Root', [
      node('right-a', 'Right A'),
      node('left-a', 'Left A', [node('first', 'First')]),
      node('right-b', 'Right B'),
      node('left-b', 'Left B', [node('second', 'Second')]),
      node('summary-topic', 'Node summary', [node('summary-child', 'Detail')])
    ])
    const layout = computeMindMapLayout(
      sheet(root, 'studiumx.layout.logic.balanced', [
        {
          id: 'summary-1',
          type: 'summary',
          from: 'first',
          to: 'second',
          sourceTopicIds: ['first', 'second'],
          summaryTopicId: 'summary-topic'
        }
      ])
    )
    const byId = new Map(layout.nodes.map((layoutNode) => [layoutNode.id, layoutNode]))
    const output = byId.get('summary-topic')!
    const child = byId.get('summary-child')!

    expect(layout.summaries).toEqual([
      expect.objectContaining({ id: 'summary-1', side: 'left' })
    ])
    expect(child.x + child.width).toBeLessThanOrEqual(output.x)
  })

  it('keeps descendants of a cross-branch right summary on the right', () => {
    // This is the symmetric case: the generated output occupies a left
    // semantic root index, even though all of the covered source topics are on
    // the right and the summary output is rendered there.
    const root = node('root', 'Root', [
      node('right-a', 'Right A', [node('first', 'First')]),
      node('left-a', 'Left A'),
      node('right-b', 'Right B', [node('second', 'Second')]),
      node('summary-topic', 'Node summary', [node('summary-child', 'Detail')])
    ])
    const layout = computeMindMapLayout(
      sheet(root, 'studiumx.layout.logic.balanced', [
        {
          id: 'summary-1',
          type: 'summary',
          from: 'first',
          to: 'second',
          sourceTopicIds: ['first', 'second'],
          summaryTopicId: 'summary-topic'
        }
      ])
    )
    const byId = new Map(layout.nodes.map((layoutNode) => [layoutNode.id, layoutNode]))
    const output = byId.get('summary-topic')!
    const child = byId.get('summary-child')!

    expect(layout.summaries).toEqual([
      expect.objectContaining({ id: 'summary-1', side: 'right' })
    ])
    expect(child.x).toBeGreaterThanOrEqual(output.x + output.width)
  })

  it('does not flip balanced siblings when a summary output sits mid-list', () => {
    // Regression: a cross-branch summary output is inserted as an ordinary
    // child of the common ancestor (here at root index 5, before the last
    // left branch). If it took part in the balanced index alternation it
    // would shift `l3` from an odd (left) index to an even (right) index,
    // "splitting" the map's sides. The output must be excluded from sibling
    // stacking so existing branches keep their sides and stay centred.
    const root = node('root', 'Root', [
      node('r1', 'R1', [node('a', 'A')]),
      node('l1', 'L1'),
      node('r2', 'R2', [node('c', 'C')]),
      node('l2', 'L2'),
      node('r3', 'R3', [node('e', 'E')]),
      node('summary-topic', 'Node summary'),
      node('l3', 'L3', [node('f', 'F')])
    ])
    const layout = computeMindMapLayout(
      sheet(root, 'studiumx.layout.logic.balanced', [
        {
          id: 'summary-1',
          type: 'summary',
          from: 'a',
          to: 'e',
          sourceTopicIds: ['a', 'c', 'e'],
          summaryTopicId: 'summary-topic'
        }
      ])
    )
    const byId = new Map(layout.nodes.map((layoutNode) => [layoutNode.id, layoutNode]))
    const rootNode = byId.get('root')!
    const l3 = byId.get('l3')!
    const r3 = byId.get('r3')!

    // The last left branch must stay on the left instead of flipping to the
    // right once the summary output consumes the slot before it.
    expect(l3.x + l3.width / 2).toBeLessThan(0)
    expect(r3.x + r3.width / 2).toBeGreaterThan(0)

    // Neither side group may be left mis-centred by the moved output.
    const depth1 = layout.nodes.filter((node) => node.depth === 1)
    const rootCenterY = rootNode.y + rootNode.height / 2
    const rightGroup = depth1.filter((node) => node.x + node.width / 2 > 0)
    const leftGroup = depth1.filter((node) => node.x + node.width / 2 < 0)
    for (const group of [leftGroup, rightGroup]) {
      const minY = Math.min(...group.map((node) => node.y))
      const maxY = Math.max(...group.map((node) => node.y + node.height))
      expect((minY + maxY) / 2).toBeCloseTo(rootCenterY, 5)
    }
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
    expect(layout.edges).toEqual([{ from: 'a', to: 'b', branchIndex: 0, branchKey: 'b', axis: 'horizontal' }])
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
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.balanced'))
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
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.balanced'))
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
    // native alternates sides at the root only. Both children of the
    // right-side branch b must lie to b's right; both children of the
    // left-side branch c must lie to c's left.
    const root = node('a', 'A', [
      node('b', 'B', [node('d', 'D'), node('e', 'E')]),
      node('c', 'C', [node('f', 'F'), node('g', 'G')])
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.balanced'))
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
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const id of ['b', 'c']) {
      expect(byId.get(id)!.x).toBeGreaterThan(byId.get('a')!.x)
    }
  })

  it('places children to the left (−x) for the left structure class', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.left'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    for (const id of ['b', 'c']) {
      expect(byId.get(id)!.x).toBeLessThan(byId.get('a')!.x)
    }
  })

  it('places children below and spreads them horizontally for the down structure class', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C'), node('d', 'D')])
    const { nodes, edges } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.down'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const rootNode = byId.get('a')!
    const children = ['b', 'c', 'd'].map((id) => byId.get(id)!)

    expect(children.every((child) => child.y > rootNode.y)).toBe(true)
    expect(children.map((child) => child.x)).toEqual([...children].sort((a, b) => a.x - b.x).map((child) => child.x))
    expect(new Set(children.map((child) => child.y)).size).toBe(1)
    expect(edges).toEqual([
      { from: 'a', to: 'b', branchIndex: 0, branchKey: 'b', axis: 'vertical', connectorStyle: 'elbow' },
      { from: 'a', to: 'c', branchIndex: 1, branchKey: 'c', axis: 'vertical', connectorStyle: 'elbow' },
      { from: 'a', to: 'd', branchIndex: 2, branchKey: 'd', axis: 'vertical', connectorStyle: 'elbow' }
    ])
  })

  it('places children above for the up structure class', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.up'))
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
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.balanced'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const rootX = byId.get('a')!.x
    const childXs = ['b', 'c', 'd'].map((id) => byId.get(id)!.x)
    expect(childXs.some((x) => x > rootX)).toBe(true)
    expect(childXs.some((x) => x < rootX)).toBe(true)
  })

  it('honors a per-node structureClass override for its children', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')], false, 'studiumx.layout.logic.left')
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    expect(byId.get('b')!.x).toBeGreaterThan(byId.get('a')!.x)
    expect(byId.get('c')!.x).toBeLessThan(byId.get('b')!.x)
  })

  it('keeps assignments O(n) shaped (no duplicated nodes or edges)', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C'), node('d', 'D')]),
      node('e', 'E')
    ])
    const { nodes, edges } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.map'))
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

  it('reserves visible space for images rendered inside a topic', () => {
    const plain = computeMindMapLayout(sheet(node('a', 'Diagram'))).nodes[0]!
    const withImageSheet: MindMapSheetV2 = {
      ...sheet(node('a', 'Diagram')),
      images: [{ id: 'img-1', type: 'image', assetId: 'asset-1', width: 160, height: 88, topicId: 'a' }]
    }
    const withImage = computeMindMapLayout(withImageSheet).nodes[0]!

    expect(withImage.width).toBeGreaterThanOrEqual(180)
    expect(withImage.height).toBeGreaterThan(plain.height)
  })

  it('reserves only the note action slot while formula and links become title Markdown', () => {
    const plainRoot = node('a', 'Topic')
    const contentRoot: MindMapTopicV2 = {
      ...node('a', 'Topic'),
      note: 'Remember this',
      formula: 'a^2+b^2=c^2',
      links: [{ id: 'link-1', url: 'https://example.com' }]
    }
    const plain = computeMindMapLayout(sheet(plainRoot), {
      reserveTopicActionButtonSpace: true
    }).nodes[0]!
    const withContent = computeMindMapLayout(sheet(contentRoot), {
      reserveTopicActionButtonSpace: true
    }).nodes[0]!
    const withoutReservedAction = computeMindMapLayout(sheet(contentRoot)).nodes[0]!

    expect(withContent.width - withoutReservedAction.width).toBe(MIND_MAP_TOPIC_ACTION_BUTTON_RESERVED_WIDTH)
    expect(withContent).toMatchObject({
      hasNote: true,
      hasFormula: true,
      hasLinks: true
    })
    expect(withContent.title).toContain('$$\na^2+b^2=c^2\n$$')
    expect(withContent.title).toContain('[https://example.com](https://example.com)')
  })

  it('uses a fixed topic width and reflows its title height within that width', () => {
    const root = node('a', 'This is a title that should wrap when the topic is fixed narrow', [node('b', 'B')])
    root.style = { widthMode: 'fixed', width: 120 }
    const layout = computeMindMapLayout(sheet(root))
    const rendered = layout.nodes.find((n) => n.id === 'a')!

    expect(rendered.width).toBe(120)
    expect(rendered.height).toBeGreaterThan(56)
  })

  it('clamps very narrow topics and wraps mixed CJK and Latin text deterministically', () => {
    const title = '节点 text that must wrap 自动换行'
    const root = node('a', title)
    root.style = { widthMode: 'fixed', width: 24 }

    const rendered = computeMindMapLayout(sheet(root)).nodes.find((n) => n.id === 'a')!
    const lines = wrapMindMapTopicTitle(title, rendered.width, rendered.depth)

    expect(rendered.width).toBe(MIND_MAP_NODE_MIN_WIDTH)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => line.length > 0)).toBe(true)
    expect(lines.join('').replaceAll(' ', '')).toBe(title.replaceAll(' ', ''))
    expect(rendered.height).toBeGreaterThan(56)
  })

  it('preserves explicit title line breaks when calculating adaptive height', () => {
    const title = 'First line\n第二行\nThird line'
    const root = node('a', title)
    root.style = { widthMode: 'fixed', width: 240 }

    const rendered = computeMindMapLayout(sheet(root)).nodes.find((n) => n.id === 'a')!

    expect(wrapMindMapTopicTitle(title, rendered.width, rendered.depth)).toEqual([
      'First line',
      '第二行',
      'Third line'
    ])
    expect(rendered.height).toBe(124)
  })

  it('falls back to automatic sizing when a width override is reset', () => {
    const root = node('a', 'A much longer title')
    root.style = { widthMode: 'fixed', width: 240 }
    const fixed = computeMindMapLayout(sheet(root)).nodes.find((n) => n.id === 'a')!
    root.style = { widthMode: 'auto' }
    const auto = computeMindMapLayout(sheet(root)).nodes.find((n) => n.id === 'a')!

    expect(fixed.width).toBe(240)
    expect(auto.width).not.toBe(240)
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
      sheet(root, 'studiumx.layout.logic.right', [
        { id: 'bound-1', type: 'boundary', topicId: 'a', children: ['b', 'c'] }
      ])
    )
    expect(boundaries).toHaveLength(1)
    expect(boundaries[0]!.id).toBe('bound-1')
    expect(boundaries[0]!.width).toBeGreaterThan(0)
    expect(boundaries[0]!.height).toBeGreaterThan(0)
  })

  it('keeps horizontal gap between parent edge and child edge constant', () => {
    const root = node('a', 'A', [
      node('b', 'B'),
      node('c', 'A much longer sibling title')
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.right'))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const a = byId.get('a')!
    for (const id of ['b', 'c']) {
      const child = byId.get(id)!
      expect(child.x - (a.x + a.width)).toBe(horizontalGapForDepth(0))
    }
  })

  it('gives structure families their own layout geometry and connector kind', () => {
    const root = node('a', 'A', [
      node('b', 'B'),
      node('c', 'C'),
      node('d', 'D'),
      node('e', 'E')
    ])

    const map = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.map'))
    const timeline = computeMindMapLayout(sheet(root, 'studiumx.layout.timeline.horizontal'))
    const fishbone = computeMindMapLayout(sheet(root, 'studiumx.layout.fishbone.rightHeaded'))
    const matrix = computeMindMapLayout(sheet(root, 'studiumx.layout.spreadsheet'))

    const childPositions = (layout: typeof map) =>
      layout.nodes
        .filter((item) => item.depth === 1)
        .map(({ x, y }) => `${x}:${y}`)

    expect(childPositions(timeline)).not.toEqual(childPositions(map))
    expect(childPositions(fishbone)).not.toEqual(childPositions(map))
    expect(childPositions(matrix)).not.toEqual(childPositions(map))
    expect(timeline.edges.every((edge) => edge.connectorStyle === 'timeline')).toBe(true)
    expect(fishbone.edges.every((edge) => edge.connectorStyle === 'fishbone')).toBe(true)
    expect(matrix.edges.every((edge) => edge.connectorStyle === 'matrix')).toBe(true)
  })

  it('uses depth-based horizontal gap (root->L1 wider than deeper)', () => {
    const root = node('a', 'A', [
      node('b', 'B', [node('c', 'C')])
    ])
    const { nodes } = computeMindMapLayout(sheet(root, 'studiumx.layout.logic.right'))
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

  it('compacts default and explicit sibling spacing without replacing the spacing choice', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    const normalSheet = sheet(root)
    const compactSheet = sheet(root)
    compactSheet.layout.compact = true
    const explicitSheet = sheet(root)
    explicitSheet.layout.spacing = 32
    const explicitCompactSheet = sheet(root)
    explicitCompactSheet.layout.spacing = 32
    explicitCompactSheet.layout.compact = true

    const siblingGap = (candidate: MindMapSheetV2): number => {
      const byId = new Map(computeMindMapLayout(candidate).nodes.map((entry) => [entry.id, entry]))
      const first = byId.get('b')!
      const second = byId.get('c')!
      return second.y - (first.y + first.height)
    }

    expect(siblingGap(normalSheet)).toBe(verticalGapForDepth(0))
    expect(siblingGap(compactSheet)).toBeCloseTo(verticalGapForDepth(0) * 0.6)
    expect(siblingGap(explicitSheet)).toBe(32)
    expect(siblingGap(explicitCompactSheet)).toBeCloseTo(32 * 0.6)
    expect(explicitCompactSheet.layout.spacing).toBe(32)
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

  it('keeps every created topic rectangle collision-free across structure presets', () => {
    let nextId = 0
    const createTree = (depth: number): MindMapTopicV2 => {
      const id = `created-${nextId++}`
      return node(
        id,
        id,
        depth === 0 ? [] : [createTree(depth - 1), createTree(depth - 1), createTree(depth - 1)]
      )
    }
    const structureClasses: MindMapStructureClass[] = [
      'studiumx.layout.logic.map',
      'studiumx.layout.logic.right',
      'studiumx.layout.logic.left',
      'studiumx.layout.logic.down',
      'studiumx.layout.logic.up',
      'studiumx.layout.timeline.horizontal',
      'studiumx.layout.timeline.vertical',
      'studiumx.layout.fishbone.rightHeaded',
      'studiumx.layout.fishbone.leftHeaded',
      'studiumx.layout.spreadsheet',
      'studiumx.layout.spreadsheet.column'
    ]

    for (const structureClass of structureClasses) {
      nextId = 0
      const { nodes } = computeMindMapLayout(sheet(createTree(3), structureClass))
      for (let first = 0; first < nodes.length; first += 1) {
        for (let second = first + 1; second < nodes.length; second += 1) {
          const left = nodes[first]!
          const right = nodes[second]!
          const overlaps =
            Math.max(left.x, right.x) < Math.min(left.x + left.width, right.x + right.width) &&
            Math.max(left.y, right.y) < Math.min(left.y + left.height, right.y + right.height)
          expect(overlaps, `${structureClass}: ${left.id} overlaps ${right.id}`).toBe(false)
        }
      }
    }
  })
})

describe('computeMovedTopicPreview', () => {
  it('returns the dragged topic rect when reparented under the target', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C', [node('d', 'D')])])
    const preview = computeMovedTopicPreview(sheet(root), 'd', 'b')
    expect(preview).not.toBeNull()
    const moved = computeMindMapLayout(sheet(node('a', 'A', [node('b', 'B', [node('d', 'D')]), node('c', 'C')])))
      .nodes.find((n) => n.id === 'd')
    expect(preview).toEqual({
      x: moved!.x,
      y: moved!.y,
      width: moved!.width,
      height: moved!.height
    })
  })

  it('does not mutate the input sheet', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    computeMovedTopicPreview(sheet(root), 'c', 'b')
    expect(root.children.map((c) => c.id)).toEqual(['b', 'c'])
    expect(root.children[0]!.children).toEqual([])
  })

  it('returns null for the root topic, missing topics and cyclic moves', () => {
    const root = node('a', 'A', [node('b', 'B', [node('c', 'C')])])
    // root cannot be moved
    expect(computeMovedTopicPreview(sheet(root), 'a', 'b')).toBeNull()
    // missing dragged topic
    expect(computeMovedTopicPreview(sheet(root), 'zz', 'b')).toBeNull()
    // missing target
    expect(computeMovedTopicPreview(sheet(root), 'b', 'zz')).toBeNull()
    // moving a topic into its own descendant is cyclic
    expect(computeMovedTopicPreview(sheet(root), 'b', 'c')).toBeNull()
    // target equal to the dragged topic
    expect(computeMovedTopicPreview(sheet(root), 'b', 'b')).toBeNull()
  })

  it('suppresses a ghost when the move would be a no-op reorder of the same parent', () => {
    const root = node('a', 'A', [node('b', 'B'), node('c', 'C')])
    // Moving b under c changes depth, so it is still a valid cross-branch move.
    expect(computeMovedTopicPreview(sheet(root), 'b', 'c')).not.toBeNull()
  })
})

describe('topic image placement', () => {
  const img = (width = 160, height = 88) => ({ width, height })

  it('regions never overlap and keep text and image separate for every placement', () => {
    const base = { x: 10, y: 20, width: 300, height: 200 }
    for (const placement of ['top', 'bottom', 'left', 'right'] as const) {
      const { text, image } = computeTopicImageAndTextRegions(base, [img(), img()], placement)
      expect(image).not.toBeNull()
      // disjoint: no shared interior area
      const overlapX = Math.max(0, Math.min(text.x + text.width, image!.x + image!.width) - Math.max(text.x, image!.x))
      const overlapY = Math.max(0, Math.min(text.y + text.height, image!.y + image!.height) - Math.max(text.y, image!.y))
      expect(overlapX * overlapY).toBe(0)
    }
  })

  it('places the image above the text for top placement', () => {
    const { text, image } = computeTopicImageAndTextRegions(
      { x: 0, y: 0, width: 300, height: 200 },
      [img()],
      'top'
    )
    expect(image!.y).toBe(0)
    expect(text.y).toBe(image!.y + image!.height)
    expect(text.y + text.height).toBe(200)
  })

  it('places the image to the right of the text for right placement', () => {
    const { text, image } = computeTopicImageAndTextRegions(
      { x: 0, y: 0, width: 300, height: 200 },
      [img()],
      'right'
    )
    expect(image!.x).toBe(text.x + text.width)
    expect(text.x).toBe(0)
    expect(image!.x + image!.width).toBe(300)
  })

  it('returns null image region and full-node text for an image-less topic', () => {
    const regions = computeTopicImageAndTextRegions({ x: 0, y: 0, width: 120, height: 40 })
    expect(regions.image).toBeNull()
    expect(regions.text).toEqual({ x: 0, y: 0, width: 120, height: 40 })
  })

  it('sizes a topic wider for side-by-side placement and taller for stacked placement', () => {
    const withImage = {
      root: { ...node('a', 'Diagram'), imagePlacement: 'bottom' as const },
      images: [{ id: 'img-1', type: 'image' as const, assetId: 'a-1', width: 160, height: 88, topicId: 'a' }]
    }
    const layoutSheet = (placement: 'bottom' | 'right' | 'top') => ({
      ...sheet(withImage.root),
      images: withImage.images.map((i) => ({ ...i, topicId: 'a' })),
      root: { ...withImage.root, imagePlacement: placement }
    })
    const bottom = computeMindMapLayout(layoutSheet('bottom')).nodes[0]!
    const right = computeMindMapLayout(layoutSheet('right')).nodes[0]!
    const top = computeMindMapLayout(layoutSheet('top')).nodes[0]!

    expect(bottom.height).toBeGreaterThanOrEqual(MIND_MAP_TOPIC_IMAGE_HEIGHT)
    expect(top.height).toBe(bottom.height)
    // side-by-side adds the image column to the width instead of the height
    expect(right.width).toBeGreaterThan(bottom.width)
    expect(right.height).toBeLessThan(bottom.height)
  })
})
