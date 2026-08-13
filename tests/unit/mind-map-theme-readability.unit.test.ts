import { describe, expect, it } from 'vitest'
import type { MindMapTheme } from '../../src/shared/mindmap/domain/types'
import {
  findMindMapThemeReadabilityIssues,
  formatMindMapContrastRatio,
  MINIMUM_TOPIC_TEXT_CONTRAST
} from '../../src/renderer/src/views/mindmap/mind-map-theme-readability'

const LIGHT_ENVIRONMENT = {
  surfaceColor: '#FFFFFF',
  textColor: '#24324A',
  subtopicFillColor: '#F8F7F7'
} as const

function theme(overrides: Partial<MindMapTheme> = {}): MindMapTheme {
  return {
    id: 'readability-test',
    background: '#FFFFFF',
    textColor: '#24324A',
    rainbowBranches: false,
    lineColor: '#24324A',
    topicStyles: {
      central: { fill: '#FFFFFF', textColor: '#24324A' },
      main: { fill: '#24324A', textColor: '#FFFFFF' },
      sub: { fill: '#F8F7F7', textColor: '#24324A' }
    },
    ...overrides
  }
}

describe('findMindMapThemeReadabilityIssues', () => {
  it('reports each rendered topic layer whose text/fill pair misses the normal-text target', () => {
    const issues = findMindMapThemeReadabilityIssues(theme({
      topicStyles: {
        central: { fill: '#FFFFFF', textColor: '#F8FAFC' },
        main: { fill: '#24324A', textColor: '#FFFFFF' },
        sub: { fill: '#F8F7F7', textColor: '#24324A' }
      }
    }), LIGHT_ENVIRONMENT)

    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      id: 'central',
      layer: 'central',
      foreground: '#F8FAFC',
      background: '#FFFFFF'
    })
    expect(issues[0]?.contrastRatio).toBeLessThan(MINIMUM_TOPIC_TEXT_CONTRAST)
  })

  it('checks every branch color when main topics inherit the palette and defaults their label ink to white', () => {
    const issues = findMindMapThemeReadabilityIssues(theme({
      rainbowBranches: true,
      branchColors: ['#FF6B6B', '#24324A'],
      topicStyles: {
        central: { fill: '#FFFFFF', textColor: '#24324A' },
        sub: { fill: '#F8F7F7', textColor: '#24324A' }
      }
    }), LIGHT_ENVIRONMENT)

    expect(issues.map((issue) => issue.id)).toEqual(['main-0'])
    expect(issues[0]).toMatchObject({ layer: 'main', foreground: '#FFFFFF', background: '#FF6B6B' })
  })

  it('supports short hex and alpha compositing instead of comparing raw color channels', () => {
    const safeShortHex = findMindMapThemeReadabilityIssues(theme({
      topicStyles: {
        central: { fill: '#FFF', textColor: '#333' },
        main: { fill: '#24324A', textColor: '#FFF' },
        sub: { fill: '#F8F7F7', textColor: '#24324A' }
      }
    }), LIGHT_ENVIRONMENT)
    const translucentFill = findMindMapThemeReadabilityIssues(theme({
      topicStyles: {
        central: { fill: '#00000080', textColor: '#FFFFFF' },
        main: { fill: '#24324A', textColor: '#FFFFFF' },
        sub: { fill: '#F8F7F7', textColor: '#24324A' }
      }
    }), LIGHT_ENVIRONMENT)

    expect(safeShortHex).toEqual([])
    expect(translucentFill.find((issue) => issue.id === 'central')?.contrastRatio).toBeLessThan(
      MINIMUM_TOPIC_TEXT_CONTRAST
    )
  })

  it('accounts for transparent topic fills by compositing them over the resolved canvas background', () => {
    const issues = findMindMapThemeReadabilityIssues(theme({
      topicStyles: {
        central: { fill: '#00000000', textColor: '#FFFFFF' },
        main: { fill: '#24324A', textColor: '#FFFFFF' },
        sub: { fill: '#F8F7F7', textColor: '#24324A' }
      }
    }), LIGHT_ENVIRONMENT)

    expect(issues.map((issue) => issue.id)).toContain('central')
  })

  it('does not invent a warning for a high-contrast resolved theme and formats ratios only for display', () => {
    expect(findMindMapThemeReadabilityIssues(theme(), LIGHT_ENVIRONMENT)).toEqual([])
    expect(formatMindMapContrastRatio(4.499)).toBe('4.49')
  })
})
