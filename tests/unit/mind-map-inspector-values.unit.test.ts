import { describe, expect, it } from 'vitest'
import {
  resolveElementStyleField,
  resolveInspectorValue,
  resolveLayoutField,
  resolveTopicStyleField
} from '../../src/renderer/src/views/mindmap/mind-map-inspector-values'
import type { MindMapLayoutSettings, MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'

const topic = (id: string, shape?: string): MindMapTopicV2 => ({
  id,
  title: id,
  children: [],
  ...(shape === undefined ? {} : { style: { shape } })
})

const layout = (overrides: Partial<MindMapLayoutSettings> = {}): MindMapLayoutSettings => ({
  structureClass: 'studiumx.layout.logic.right',
  ...overrides
})

describe('mind-map inspector values', () => {
  it('resolves element style fields with inherited as the absent state', () => {
    expect(resolveElementStyleField(undefined, 'stroke')).toEqual({ state: 'inherited' })
    expect(resolveElementStyleField({}, 'stroke')).toEqual({ state: 'inherited' })
    expect(resolveElementStyleField({ fill: '#FFF' }, 'stroke')).toEqual({ state: 'inherited' })
    expect(resolveElementStyleField({ stroke: '#112233' }, 'stroke')).toEqual({
      state: 'concrete',
      value: '#112233'
    })
    expect(resolveElementStyleField({ dashed: false }, 'dashed')).toEqual({
      state: 'concrete',
      value: false
    })
  })

  it('resolves multiple element styles to mixed when they disagree', () => {
    expect(resolveElementStyleField([
      { stroke: '#112233' },
      { stroke: '#445566' }
    ], 'stroke')).toEqual({ state: 'mixed' })
    expect(resolveElementStyleField([
      { stroke: '#112233' },
      undefined
    ], 'stroke')).toEqual({ state: 'mixed' })
    expect(resolveElementStyleField([
      { stroke: '#112233' },
      { stroke: '#112233' }
    ], 'stroke')).toEqual({ state: 'concrete', value: '#112233' })
    expect(resolveElementStyleField([
      { lineShape: 'curved' },
      { lineShape: 'angled' }
    ], 'lineShape')).toEqual({ state: 'mixed' })
  })

  it('keeps default, inherited, none, concrete, and mixed states distinct', () => {
    expect(resolveInspectorValue([], { absentState: 'default' })).toEqual({ state: 'default' })
    expect(resolveTopicStyleField([topic('a'), topic('b')], 'shape')).toEqual({ state: 'inherited' })
    expect(resolveTopicStyleField([topic('a', 'none'), topic('b', 'none')], 'shape')).toEqual({ state: 'none' })
    expect(resolveTopicStyleField([topic('a', 'rect'), topic('b', 'rect')], 'shape')).toEqual({
      state: 'concrete',
      value: 'rect'
    })
    expect(resolveTopicStyleField([topic('a', 'rect'), topic('b')], 'shape')).toEqual({ state: 'mixed' })
  })

  it('models an unspecified sheet-layout field as inherited and an explicit one as concrete', () => {
    expect(resolveLayoutField(undefined, 'lineStyle')).toEqual({ state: 'inherited' })
    expect(resolveLayoutField(layout(), 'spacing')).toEqual({ state: 'inherited' })
    expect(resolveLayoutField(layout(), 'compact')).toEqual({ state: 'inherited' })
    expect(resolveLayoutField(layout({ lineStyle: 'elbow' }), 'lineStyle')).toEqual({
      state: 'concrete',
      value: 'elbow'
    })
    expect(resolveLayoutField(layout({ lineWidthScale: 1.5 }), 'lineWidthScale')).toEqual({
      state: 'concrete',
      value: 1.5
    })
    expect(resolveLayoutField(layout({ tapered: true }), 'tapered')).toEqual({
      state: 'concrete',
      value: true
    })
    // explicit false is still a sheet override, not inherited
    expect(resolveLayoutField(layout({ compact: false }), 'compact')).toEqual({
      state: 'concrete',
      value: false
    })
    expect(resolveLayoutField(layout({ linePattern: 'dash' }), 'linePattern')).toEqual({
      state: 'concrete',
      value: 'dash'
    })
  })

  it('reports mixed when multiple sheets disagree and resolves across the whole field set', () => {
    expect(resolveLayoutField([layout({ spacing: 16 }), layout({ spacing: 24 })], 'spacing')).toEqual({
      state: 'mixed'
    })
    expect(resolveLayoutField([layout({ spacing: 16 }), undefined], 'spacing')).toEqual({
      state: 'mixed'
    })
    expect(resolveLayoutField([layout({ spacing: 24 }), layout({ spacing: 24 })], 'spacing')).toEqual({
      state: 'concrete',
      value: 24
    })
    // every supported field routes through the same inherited/concrete contract
    for (const field of ['lineWidthScale', 'lineStyle', 'linePattern', 'tapered', 'compact', 'spacing'] as const) {
      expect(resolveLayoutField(undefined, field)).toEqual({ state: 'inherited' })
    }
  })
})
