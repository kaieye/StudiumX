import { describe, expect, it } from 'vitest'
import {
  applyMindMapQuickStyle,
  MIND_MAP_QUICK_STYLE_TOKENS
} from '../../src/shared/mindmap/quick-styles'

describe('mind map quick styles', () => {
  it('uses visual-only important presets without touching planning fields', () => {
    const style = applyMindMapQuickStyle(
      { fill: '#123456', fontSize: 18, textDecoration: 'underline' },
      'important'
    )

    expect(style).toMatchObject({
      fill: MIND_MAP_QUICK_STYLE_TOKENS.important.fill,
      textColor: MIND_MAP_QUICK_STYLE_TOKENS.important.textColor,
      fontWeight: '700',
      fontSize: 18,
      textDecoration: 'underline'
    })
    expect(style).not.toHaveProperty('planning')
  })

  it('gives very important a stronger visual boundary while preserving unrelated style', () => {
    expect(applyMindMapQuickStyle({ shape: 'diamond' }, 'very-important')).toMatchObject({
      shape: 'diamond',
      fill: '#FFD6D6',
      borderStyle: 'solid',
      borderWidth: 2
    })
  })

  it('adds strikethrough without changing canonical topic content', () => {
    expect(applyMindMapQuickStyle({ textDecoration: 'underline' }, 'strikethrough')).toMatchObject({
      textDecoration: 'line-through underline'
    })
  })

  it('default is an explicit reset to inherited style', () => {
    expect(applyMindMapQuickStyle({ fill: '#123456' }, 'default')).toBeNull()
  })
})
