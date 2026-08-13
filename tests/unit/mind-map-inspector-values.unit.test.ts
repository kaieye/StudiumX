import { describe, expect, it } from 'vitest'
import {
  resolveInspectorValue,
  resolveTopicStyleField
} from '../../src/renderer/src/views/mindmap/mind-map-inspector-values'
import type { MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'

const topic = (id: string, shape?: string): MindMapTopicV2 => ({
  id,
  title: id,
  children: [],
  ...(shape === undefined ? {} : { style: { shape } })
})

describe('mind-map inspector values', () => {
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
})
