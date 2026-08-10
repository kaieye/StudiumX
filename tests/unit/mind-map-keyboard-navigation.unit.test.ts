import { describe, expect, it } from 'vitest'
import type { MindMapLayoutNode } from '../../src/renderer/src/views/mindmap/mind-map-layout'
import { nextMindMapFocus } from '../../src/renderer/src/views/mindmap/mind-map-keyboard-navigation'

function node(id: string, x: number, y: number): MindMapLayoutNode {
  return {
    id,
    title: id,
    x,
    y,
    width: 100,
    height: 40,
    depth: 0,
    collapsed: false
  }
}

describe('nextMindMapFocus', () => {
  const nodes = [
    node('root', 0, 100),
    node('up', 160, 0),
    node('down', 160, 200),
    node('far-right', 320, 200)
  ]

  it('moves to the nearest visible node in the requested spatial direction', () => {
    expect(nextMindMapFocus(nodes, 'root', 'right')).toBe('up')
    expect(nextMindMapFocus(nodes, 'root', 'down')).toBe('down')
  })

  it('wraps at the edge so repeated arrow navigation remains continuous', () => {
    expect(nextMindMapFocus(nodes, 'far-right', 'right')).toBe('root')
    expect(nextMindMapFocus(nodes, 'up', 'up')).toBe('down')
  })

  it('starts at the first visible node when selection is empty or stale', () => {
    expect(nextMindMapFocus(nodes, null, 'down')).toBe('root')
    expect(nextMindMapFocus(nodes, 'missing', 'left')).toBe('root')
  })

  it('returns null for an empty canvas', () => {
    expect(nextMindMapFocus([], null, 'right')).toBeNull()
  })
})
