import type { MindMapLayoutNode } from './mind-map-layout'

export type MindMapFocusDirection = 'up' | 'down' | 'left' | 'right'

type Point = { x: number; y: number }

const EPSILON = 0.5

function center(node: MindMapLayoutNode): Point {
  return {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  }
}

function isAhead(current: Point, candidate: Point, direction: MindMapFocusDirection): boolean {
  switch (direction) {
    case 'up':
      return candidate.y < current.y - EPSILON
    case 'down':
      return candidate.y > current.y + EPSILON
    case 'left':
      return candidate.x < current.x - EPSILON
    case 'right':
      return candidate.x > current.x + EPSILON
  }
}

function primaryDistance(current: Point, candidate: Point, direction: MindMapFocusDirection): number {
  return direction === 'up' || direction === 'down'
    ? Math.abs(candidate.y - current.y)
    : Math.abs(candidate.x - current.x)
}

function secondaryDistance(current: Point, candidate: Point, direction: MindMapFocusDirection): number {
  return direction === 'up' || direction === 'down'
    ? Math.abs(candidate.x - current.x)
    : Math.abs(candidate.y - current.y)
}

function compareCandidates(
  current: Point,
  direction: MindMapFocusDirection,
  a: { point: Point; index: number },
  b: { point: Point; index: number }
): number {
  const primary = primaryDistance(current, a.point, direction) - primaryDistance(current, b.point, direction)
  if (primary !== 0) return primary
  const secondary = secondaryDistance(current, a.point, direction) - secondaryDistance(current, b.point, direction)
  return secondary !== 0 ? secondary : a.index - b.index
}

/**
 * Pick the next visible node for keyboard spatial navigation.
 *
 * Candidates in the requested direction win by nearest primary-axis distance,
 * then by nearest cross-axis distance. When an edge of the visible canvas is
 * reached, navigation wraps to the opposite edge, keeping arrow-key movement
 * continuous for keyboard-only editing.
 */
export function nextMindMapFocus(
  nodes: readonly MindMapLayoutNode[],
  selectedNodeId: string | null,
  direction: MindMapFocusDirection
): string | null {
  if (nodes.length === 0) return null

  const selectedIndex = selectedNodeId === null
    ? -1
    : nodes.findIndex((node) => node.id === selectedNodeId)
  if (selectedIndex < 0) return nodes[0]?.id ?? null

  const selected = nodes[selectedIndex]
  if (!selected) return nodes[0]?.id ?? null
  const selectedPoint = center(selected)

  const candidates = nodes
    .map((node, index) => ({ node, point: center(node), index }))
    .filter(({ index, point }) => index !== selectedIndex && isAhead(selectedPoint, point, direction))

  if (candidates.length > 0) {
    candidates.sort((a, b) => compareCandidates(selectedPoint, direction, a, b))
    return candidates[0]?.node.id ?? null
  }

  // No node lies ahead: wrap around to the opposite side of the visible map.
  const opposite = nodes
    .map((node, index) => ({ node, point: center(node), index }))
    .filter(({ index }) => index !== selectedIndex)
    .sort((a, b) => {
      const primaryA = direction === 'up' || direction === 'down' ? a.point.y : a.point.x
      const primaryB = direction === 'up' || direction === 'down' ? b.point.y : b.point.x
      const primary = direction === 'up' || direction === 'left'
        ? primaryB - primaryA
        : primaryA - primaryB
      if (primary !== 0) return primary
      return secondaryDistance(selectedPoint, a.point, direction) - secondaryDistance(selectedPoint, b.point, direction)
    })

  return opposite[0]?.node.id ?? selected.id
}
