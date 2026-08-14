import type { MindMapStructureClass } from '../../../../shared/mindmap/mind-map-types'
import { getLayoutGeometry } from '../../../../shared/mindmap/structure-types'
import type { MindMapLayoutNode } from './mind-map-layout'

export const MIND_MAP_NODE_ACTION_RADIUS = 11
export const MIND_MAP_NODE_ACTION_OFFSET = 19

export type MindMapNodeActionDirection = 'left' | 'right' | 'top' | 'bottom'

/**
 * Resolve the side where adding a child feels natural for the active layout.
 * Balanced roots expose both horizontal branches; descendants continue away
 * from the root. One-sided and vertical structures follow their growth axis.
 */
export function resolveMindMapNodeActionDirections(
  node: MindMapLayoutNode,
  structureClass: MindMapStructureClass,
  root: MindMapLayoutNode
): MindMapNodeActionDirection[] {
  const geometry = getLayoutGeometry(node.style?.structureClass ?? structureClass)
  switch (geometry) {
    case 'horizontal-left':
    case 'fishbone-right':
      return ['left']
    case 'vertical-up':
      return ['top']
    case 'vertical-down':
    case 'timeline-vertical':
    case 'matrix-rows':
    case 'matrix-columns':
      return ['bottom']
    case 'fishbone-left':
    case 'timeline-horizontal':
    case 'horizontal-right':
      return ['right']
    case 'balanced':
    default:
      if (node.depth === 0) return ['left', 'right']
      return [
        node.x + node.width / 2 < root.x + root.width / 2 ? 'left' : 'right'
      ]
  }
}

export function resolveMindMapNodeActionPosition(
  node: MindMapLayoutNode,
  direction: MindMapNodeActionDirection
): { x: number; y: number } {
  switch (direction) {
    case 'left':
      return { x: node.x - MIND_MAP_NODE_ACTION_OFFSET, y: node.y + node.height / 2 }
    case 'top':
      return { x: node.x + node.width / 2, y: node.y - MIND_MAP_NODE_ACTION_OFFSET }
    case 'bottom':
      return {
        x: node.x + node.width / 2,
        y: node.y + node.height + MIND_MAP_NODE_ACTION_OFFSET
      }
    case 'right':
    default:
      return {
        x: node.x + node.width + MIND_MAP_NODE_ACTION_OFFSET,
        y: node.y + node.height / 2
      }
  }
}
