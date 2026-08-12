import { describe, expect, it } from 'vitest'
import {
  STRUCTURE_TYPE_PRESETS,
  STRUCTURE_FAMILIES,
  getConnectorStyle,
  getLayoutGeometry,
  getStructureTypePreset,
  getLayoutStrategy,
  templateToStructureClass
} from '../../src/shared/mindmap/structure-types'

describe('Structure type presets (Xmind catalogue)', () => {
  it('covers all eight Xmind layout families', () => {
    const families = new Set(STRUCTURE_TYPE_PRESETS.map((p) => p.family))
    expect(families.has('map')).toBe(true)
    expect(families.has('logic')).toBe(true)
    expect(families.has('org')).toBe(true)
    expect(families.has('tree')).toBe(true)
    expect(families.has('brace')).toBe(true)
    expect(families.has('timeline')).toBe(true)
    expect(families.has('matrix')).toBe(true)
    expect(families.has('fishbone')).toBe(true)
  })

  it('includes the original six structure classes (backward compat)', () => {
    const ids = new Set(STRUCTURE_TYPE_PRESETS.map((p) => p.id))
    for (const id of [
      'org.xmind.ui.logic.right',
      'org.xmind.ui.logic.balanced',
      'org.xmind.ui.logic.left',
      'org.xmind.ui.logic.map',
      'org.xmind.ui.logic.down',
      'org.xmind.ui.logic.up'
    ]) {
      expect(ids.has(id as never)).toBe(true)
    }
  })

  it('includes newly-migrated Xmind-canonical structure classes', () => {
    const ids = new Set(STRUCTURE_TYPE_PRESETS.map((p) => p.id))
    for (const id of [
      'org.xmind.ui.map',
      'org.xmind.ui.map.clockwise',
      'org.xmind.ui.org-chart.down',
      'org.xmind.ui.org-chart.up',
      'org.xmind.ui.tree.right',
      'org.xmind.ui.tree.left',
      'org.xmind.ui.brace.right',
      'org.xmind.ui.brace.left',
      'org.xmind.ui.timeline.horizontal',
      'org.xmind.ui.timeline.vertical',
      'org.xmind.ui.spreadsheet',
      'org.xmind.ui.spreadsheet.column',
      'org.xmind.ui.fishbone.rightHeaded',
      'org.xmind.ui.fishbone.leftHeaded'
    ]) {
      expect(ids.has(id as never)).toBe(true)
    }
  })

  it('produces unique structure class ids', () => {
    const ids = STRUCTURE_TYPE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('maps tree/brace to horizontal layout strategies', () => {
    expect(getLayoutStrategy('org.xmind.ui.tree.right' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('org.xmind.ui.tree.left' as never)).toBe('horizontal-left')
    expect(getLayoutStrategy('org.xmind.ui.brace.right' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('org.xmind.ui.brace.left' as never)).toBe('horizontal-left')
  })

  it('maps timeline and fishbone to balanced/vertical strategies', () => {
    expect(getLayoutStrategy('org.xmind.ui.timeline.horizontal' as never)).toBe('balanced')
    expect(getLayoutStrategy('org.xmind.ui.timeline.vertical' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('org.xmind.ui.fishbone.rightHeaded' as never)).toBe('balanced')
    expect(getLayoutStrategy('org.xmind.ui.fishbone.leftHeaded' as never)).toBe('balanced')
  })

  it('maps org-chart to vertical strategies', () => {
    expect(getLayoutStrategy('org.xmind.ui.org-chart.down' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('org.xmind.ui.org-chart.up' as never)).toBe('vertical-up')
  })

  it('maps matrix layouts to a vertical grid strategy', () => {
    expect(getLayoutStrategy('org.xmind.ui.spreadsheet' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('org.xmind.ui.spreadsheet.column' as never)).toBe('vertical-down')
  })

  it('resolves distinct geometries and connector languages for non-tree families', () => {
    expect(getLayoutGeometry('org.xmind.ui.timeline.horizontal' as never)).toBe('timeline-horizontal')
    expect(getLayoutGeometry('org.xmind.ui.timeline.vertical' as never)).toBe('timeline-vertical')
    expect(getLayoutGeometry('org.xmind.ui.fishbone.rightHeaded' as never)).toBe('fishbone-right')
    expect(getLayoutGeometry('org.xmind.ui.spreadsheet' as never)).toBe('matrix-rows')
    expect(getLayoutGeometry('org.xmind.ui.spreadsheet.column' as never)).toBe('matrix-columns')
    expect(getConnectorStyle('org.xmind.ui.brace.right' as never)).toBe('brace')
    expect(getConnectorStyle('org.xmind.ui.org-chart.down' as never)).toBe('elbow')
  })

  it('maps map variants correctly', () => {
    expect(getLayoutStrategy('org.xmind.ui.map' as never)).toBe('balanced')
    expect(getLayoutStrategy('org.xmind.ui.map.clockwise' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('org.xmind.ui.map.anticlockwise' as never)).toBe('horizontal-left')
  })

  it('preserves backward-compatible strategy for original six', () => {
    expect(getLayoutStrategy('org.xmind.ui.logic.right' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('org.xmind.ui.logic.left' as never)).toBe('horizontal-left')
    expect(getLayoutStrategy('org.xmind.ui.logic.balanced' as never)).toBe('balanced')
    expect(getLayoutStrategy('org.xmind.ui.logic.map' as never)).toBe('balanced')
    expect(getLayoutStrategy('org.xmind.ui.logic.down' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('org.xmind.ui.logic.up' as never)).toBe('vertical-up')
  })

  it('getStructureTypePreset returns metadata for known classes', () => {
    const tree = getStructureTypePreset('org.xmind.ui.tree.right' as never)
    expect(tree?.family).toBe('tree')
    expect(tree?.glyph).toBe('⇉')
  })

  it('templateToStructureClass maps Xmind template families', () => {
    expect(templateToStructureClass('map')).toBe('org.xmind.ui.logic.map')
    expect(templateToStructureClass('logic')).toBe('org.xmind.ui.logic.right')
    expect(templateToStructureClass('brace')).toBe('org.xmind.ui.brace.right')
    expect(templateToStructureClass('org')).toBe('org.xmind.ui.org-chart.down')
    expect(templateToStructureClass('tree')).toBe('org.xmind.ui.tree.right')
    expect(templateToStructureClass('timeline')).toBe('org.xmind.ui.timeline.horizontal')
    expect(templateToStructureClass('matrix')).toBe('org.xmind.ui.spreadsheet')
    expect(templateToStructureClass('fishbone')).toBe('org.xmind.ui.fishbone.rightHeaded')
    expect(templateToStructureClass('unknown')).toBeUndefined()
  })

  it('STRUCTURE_FAMILIES is ordered for display', () => {
    expect(STRUCTURE_FAMILIES[0]).toBe('map')
    expect(STRUCTURE_FAMILIES).toHaveLength(8)
    expect(STRUCTURE_FAMILIES).toContain('matrix')
  })
})
