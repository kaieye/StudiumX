import { describe, expect, it } from 'vitest'
import { fromXmindTheme } from '../../src/shared/mindmap/themes/from-xmind-theme'
import M01 from '../../src/shared/mindmap/themes/xmind/M01.json'
import M02 from '../../src/shared/mindmap/themes/xmind/M02.json'

describe('fromXmindTheme converter', () => {
  it('extracts map background from the theme JSON', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    expect(theme.background).toBe('#FFFFFF')
  })

  it('extracts fo:color from topic styles', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    // M01 centralTopic has no fo:color (inherits default), so theme.textColor is undefined
    expect(theme.textColor).toBeUndefined()
    // M01 subTopic has fo:color #333333
    expect(theme.topicStyles?.sub?.textColor).toBe('#333333')
  })

  it('extracts line-color from central topic as theme lineColor', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    expect(theme.lineColor).toBe('#333333')
  })

  it('converts pt to px (×4/3) in topicStyles', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    // M01 centralTopic font-size: 28pt -> 28 * 4/3 = 37.33 -> rounded 37
    expect(theme.topicStyles?.central?.fontSize).toBe(Math.round(28 * 4 / 3))
    // M01 mainTopic font-size: 20pt -> 20 * 4/3 = 26.67 -> rounded 27
    expect(theme.topicStyles?.main?.fontSize).toBe(Math.round(20 * 4 / 3))
    // M01 subTopic font-size: 14pt -> 14 * 4/3 = 18.67 -> rounded 19
    expect(theme.topicStyles?.sub?.fontSize).toBe(Math.round(14 * 4 / 3))
  })

  it('maps font-weight values correctly', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    // M01 central weight 600, main 500, sub 500
    expect(theme.topicStyles?.central?.fontWeight).toBe('600')
    expect(theme.topicStyles?.main?.fontWeight).toBe('500')
    expect(theme.topicStyles?.sub?.fontWeight).toBe('500')
  })

  it('preserves supported XMind font-style values', () => {
    const theme = fromXmindTheme(M02 as never, 'classic')
    expect(theme.topicStyles?.central?.fontStyle).toBe('normal')
    expect(theme.topicStyles?.main?.fontStyle).toBe('normal')
  })

  it('maps XMind text-decoration tokens to the controlled composite value', () => {
    const theme = fromXmindTheme({
      name: 'decorations',
      content: {
        id: 'decorations',
        centralTopic: {
          type: 'topic',
          properties: { 'fo:text-decoration': ' underline line-through ' }
        },
        mainTopic: {
          type: 'topic',
          properties: { 'fo:text-decoration': 'none' }
        }
      }
    }, 'decorations')

    expect(theme.topicStyles?.central?.textDecoration).toBe('line-through underline')
    expect(theme.topicStyles?.main?.textDecoration).toBe('none')
  })

  it('maps XMind text-transform and text-align tokens without changing topic text', () => {
    const theme = fromXmindTheme({
      name: 'letter-case',
      content: {
        id: 'letter-case',
        centralTopic: {
          type: 'topic',
          properties: { 'fo:text-transform': 'manual' }
        },
        mainTopic: {
          type: 'topic',
          properties: { 'fo:text-transform': 'uppercase', 'fo:text-align': 'right' }
        },
        subTopic: {
          type: 'topic',
          properties: { 'fo:text-transform': 'capitalize' }
        }
      }
    }, 'letter-case')

    expect(theme.topicStyles?.central?.textTransform).toBe('none')
    expect(theme.topicStyles?.main?.textTransform).toBe('uppercase')
    expect(theme.topicStyles?.main?.textAlign).toBe('right')
    expect(theme.topicStyles?.sub?.textTransform).toBe('capitalize')
  })

  it('extracts svg:fill into topicStyles', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    // M01 centralTopic svg:fill = #F6212D
    expect(theme.topicStyles?.central?.fill).toBe('#F6212D')
    // M01 subTopic svg:fill = #F8F7F7
    expect(theme.topicStyles?.sub?.fill).toBe('#F8F7F7')
  })

  it('maps shape-class to internal shape names', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    // M01 subTopic has shape-class roundedRect
    expect(theme.topicStyles?.sub?.shape).toBe('roundedRect')
  })

  it('preserves theme id and name', () => {
    const theme = fromXmindTheme(M01 as never, 'snowbrush')
    expect(theme.id).toBe('snowbrush')
    expect(theme.name).toBe('M01')
  })

  it('handles M02 Classic theme correctly', () => {
    const theme = fromXmindTheme(M02 as never, 'classic')
    // M02 central has svg:fill #0288D1
    expect(theme.topicStyles?.central?.fill).toBe('#0288D1')
    expect(theme.topicStyles?.central?.borderStyle).toBe('none')
    expect(theme.topicStyles?.main?.stroke).toBe('#333333')
    expect(theme.topicStyles?.main?.borderStyle).toBe('solid')
    expect(theme.topicStyles?.main?.borderWidth).toBe(2)
    // M02 sub has shape underline
    expect(theme.topicStyles?.sub?.shape).toBe('underline')
  })

  it('approximates XMind dotted and dashed topic borders with the native dash token', () => {
    const theme = fromXmindTheme({
      name: 'border-patterns',
      content: {
        id: 'border-patterns',
        centralTopic: {
          type: 'topic',
          properties: {
            'border-line-color': '#123456',
            'border-line-width': '3px',
            'border-line-pattern': 'dash-dot'
          }
        }
      }
    }, 'border-patterns')

    expect(theme.topicStyles?.central).toMatchObject({
      stroke: '#123456',
      borderStyle: 'dash',
      borderWidth: 3
    })
  })

  it('does not project XMind border widths outside the persisted topic-style contract', () => {
    const theme = fromXmindTheme({
      name: 'oversized-border',
      content: {
        id: 'oversized-border',
        centralTopic: {
          type: 'topic',
          properties: {
            'border-line-color': '#123456',
            'border-line-width': '64'
          }
        }
      }
    }, 'oversized-border')

    expect(theme.topicStyles?.central?.borderStyle).toBe('solid')
    expect(theme.topicStyles?.central?.borderWidth).toBeUndefined()
  })

  it('handles themes with svg:fill "none" (no fill extracted)', () => {
    // M06 light theme: subTopic has no svg:fill
    const theme = fromXmindTheme({
      name: 'M06',
      content: {
        id: 'test',
        centralTopic: {
          type: 'topic',
          properties: {
            'fo:font-size': '28pt',
            'fo:font-weight': '700',
            'svg:fill': 'none',
            'line-width': '3',
            'line-color': '#333333'
          }
        },
        subTopic: {
          type: 'topic',
          properties: {
            'fo:color': '#333333',
            'fo:font-size': '14pt',
            'shape-class': 'org.xmind.topicShape.roundedRect'
          }
        },
        map: { type: 'map', properties: {} }
      }
    }, 'light')
    // fill should not be set when svg:fill is 'none'
    expect(theme.topicStyles?.central?.fill).toBeUndefined()
    expect(theme.background).toBeUndefined()
  })

  it('produces undefined topicStyles when theme has no style properties', () => {
    const theme = fromXmindTheme({
      name: 'empty',
      content: { id: 'empty' }
    }, 'empty')
    expect(theme.topicStyles).toBeUndefined()
    expect(theme.background).toBeUndefined()
  })
})
