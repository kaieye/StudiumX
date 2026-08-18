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

describe('Structure type presets (native catalogue)', () => {
  it('covers all eight native layout families', () => {
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
      'studiumx.layout.logic.right',
      'studiumx.layout.logic.balanced',
      'studiumx.layout.logic.left',
      'studiumx.layout.logic.map',
      'studiumx.layout.logic.down',
      'studiumx.layout.logic.up'
    ]) {
      expect(ids.has(id as never)).toBe(true)
    }
  })

  it('includes newly-migrated native-canonical structure classes', () => {
    const ids = new Set(STRUCTURE_TYPE_PRESETS.map((p) => p.id))
    for (const id of [
      'studiumx.layout.map',
      'studiumx.layout.map.clockwise',
      'studiumx.layout.org-chart.down',
      'studiumx.layout.org-chart.up',
      'studiumx.layout.tree.right',
      'studiumx.layout.tree.left',
      'studiumx.layout.brace.right',
      'studiumx.layout.brace.left',
      'studiumx.layout.timeline.horizontal',
      'studiumx.layout.timeline.vertical',
      'studiumx.layout.spreadsheet',
      'studiumx.layout.spreadsheet.column',
      'studiumx.layout.fishbone.rightHeaded',
      'studiumx.layout.fishbone.leftHeaded'
    ]) {
      expect(ids.has(id as never)).toBe(true)
    }
  })

  it('produces unique structure class ids', () => {
    const ids = STRUCTURE_TYPE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('maps tree/brace to horizontal layout strategies', () => {
    expect(getLayoutStrategy('studiumx.layout.tree.right' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('studiumx.layout.tree.left' as never)).toBe('horizontal-left')
    expect(getLayoutStrategy('studiumx.layout.brace.right' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('studiumx.layout.brace.left' as never)).toBe('horizontal-left')
  })

  it('maps timeline and fishbone to balanced/vertical strategies', () => {
    expect(getLayoutStrategy('studiumx.layout.timeline.horizontal' as never)).toBe('balanced')
    expect(getLayoutStrategy('studiumx.layout.timeline.vertical' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('studiumx.layout.fishbone.rightHeaded' as never)).toBe('balanced')
    expect(getLayoutStrategy('studiumx.layout.fishbone.leftHeaded' as never)).toBe('balanced')
  })

  it('maps org-chart to vertical strategies', () => {
    expect(getLayoutStrategy('studiumx.layout.org-chart.down' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('studiumx.layout.org-chart.up' as never)).toBe('vertical-up')
  })

  it('maps matrix layouts to a vertical grid strategy', () => {
    expect(getLayoutStrategy('studiumx.layout.spreadsheet' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('studiumx.layout.spreadsheet.column' as never)).toBe('vertical-down')
  })

  it('resolves distinct geometries and connector languages for non-tree families', () => {
    expect(getLayoutGeometry('studiumx.layout.timeline.horizontal' as never)).toBe('timeline-horizontal')
    expect(getLayoutGeometry('studiumx.layout.timeline.vertical' as never)).toBe('timeline-vertical')
    expect(getLayoutGeometry('studiumx.layout.fishbone.rightHeaded' as never)).toBe('fishbone-right')
    expect(getLayoutGeometry('studiumx.layout.spreadsheet' as never)).toBe('matrix-rows')
    expect(getLayoutGeometry('studiumx.layout.spreadsheet.column' as never)).toBe('matrix-columns')
    expect(getConnectorStyle('studiumx.layout.brace.right' as never)).toBe('brace')
    expect(getConnectorStyle('studiumx.layout.org-chart.down' as never)).toBe('elbow')
  })

  it('maps map variants correctly', () => {
    expect(getLayoutStrategy('studiumx.layout.map' as never)).toBe('balanced')
    expect(getLayoutStrategy('studiumx.layout.map.clockwise' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('studiumx.layout.map.anticlockwise' as never)).toBe('horizontal-left')
  })

  it('preserves backward-compatible strategy for original six', () => {
    expect(getLayoutStrategy('studiumx.layout.logic.right' as never)).toBe('horizontal-right')
    expect(getLayoutStrategy('studiumx.layout.logic.left' as never)).toBe('horizontal-left')
    expect(getLayoutStrategy('studiumx.layout.logic.balanced' as never)).toBe('balanced')
    expect(getLayoutStrategy('studiumx.layout.logic.map' as never)).toBe('balanced')
    expect(getLayoutStrategy('studiumx.layout.logic.down' as never)).toBe('vertical-down')
    expect(getLayoutStrategy('studiumx.layout.logic.up' as never)).toBe('vertical-up')
  })

  it('getStructureTypePreset returns metadata for known classes', () => {
    const tree = getStructureTypePreset('studiumx.layout.tree.right' as never)
    expect(tree?.family).toBe('tree')
    expect(tree?.glyph).toBe('⇉')
  })

  it('templateToStructureClass maps native template families', () => {
    expect(templateToStructureClass('map')).toBe('studiumx.layout.logic.map')
    expect(templateToStructureClass('logic')).toBe('studiumx.layout.logic.right')
    expect(templateToStructureClass('brace')).toBe('studiumx.layout.brace.right')
    expect(templateToStructureClass('org')).toBe('studiumx.layout.org-chart.down')
    expect(templateToStructureClass('tree')).toBe('studiumx.layout.tree.right')
    expect(templateToStructureClass('timeline')).toBe('studiumx.layout.timeline.horizontal')
    expect(templateToStructureClass('matrix')).toBe('studiumx.layout.spreadsheet')
    expect(templateToStructureClass('fishbone')).toBe('studiumx.layout.fishbone.rightHeaded')
    expect(templateToStructureClass('unknown')).toBeUndefined()
  })

  it('STRUCTURE_FAMILIES is ordered for display', () => {
    expect(STRUCTURE_FAMILIES[0]).toBe('map')
    expect(STRUCTURE_FAMILIES).toHaveLength(8)
    expect(STRUCTURE_FAMILIES).toContain('matrix')
  })
})
