import { describe, expect, it } from 'vitest'
import {
  buildXmindThemeFidelityReport
} from '../../src/shared/mindmap/themes/theme-fidelity'
import {
  BUILT_IN_THEME_FIDELITY_REPORTS,
  BUILT_IN_THEMES,
  getBuiltInThemeFidelityReport
} from '../../src/shared/mindmap/themes/built-in-themes'

describe('XMind built-in theme fidelity reports', () => {
  it('audits every built-in preset independently and keeps the catalogue aligned', () => {
    expect(BUILT_IN_THEME_FIDELITY_REPORTS).toHaveLength(BUILT_IN_THEMES.length)

    for (const theme of BUILT_IN_THEMES) {
      const fidelity = getBuiltInThemeFidelityReport(theme.id)
      expect(fidelity).toBeDefined()
      expect(fidelity).toMatchObject({ themeId: theme.id })
      expect(fidelity?.report.preserved.length).toBeGreaterThan(0)
      // Every source preset must explicitly disclose the native visual gap.
      expect((fidelity?.report.approximated.length ?? 0) + (fidelity?.report.dropped.length ?? 0)).toBeGreaterThan(0)
    }
  })

  it('classifies mapped, approximate, dropped, and unknown properties without source values', () => {
    const report = buildXmindThemeFidelityReport({
      name: 'fidelity-fixture',
      content: {
        id: 'M-fixture',
        map: {
          type: 'map',
          properties: {
            'svg:fill': '#F0F0F0',
            'line-tapered': 'true'
          }
        },
        centralTopic: {
          type: 'topic',
          styleId: 'foreign-style-id',
          properties: {
            'svg:fill': '#123456',
            'fo:font-size': '12pt',
            'border-line-pattern': 'dash-dot',
            'shape-class': 'org.xmind.topicShape.roundedRect',
            'line-class': 'org.xmind.branchConnection.elbow'
          }
        },
        relationship: {
          type: 'relationship',
          properties: {
            'arrow-end-class': 'org.xmind.arrowShape.triangle'
          }
        },
        foreignElement: {
          properties: {
            'private-token': 'must-not-leak'
          }
        }
      }
    })

    expect(report.preserved).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'content.map.properties.svg:fill' }),
      expect.objectContaining({ path: 'content.centralTopic.properties.svg:fill' })
    ]))
    expect(report.approximated).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'content.id' }),
      expect.objectContaining({ path: 'content.centralTopic.properties.fo:font-size' }),
      expect.objectContaining({ path: 'content.centralTopic.properties.border-line-pattern' }),
      expect.objectContaining({ path: 'content.centralTopic.properties.shape-class' })
    ]))
    expect(report.dropped).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'content.map.properties.line-tapered' }),
      expect.objectContaining({ path: 'content.centralTopic.properties.line-class' }),
      expect.objectContaining({ path: 'content.relationship.properties.arrow-end-class' }),
      expect.objectContaining({ path: 'content.<unknown-element>.properties.private-token' })
    ]))
    expect(JSON.stringify(report)).not.toContain('#123456')
    expect(JSON.stringify(report)).not.toContain('foreign-style-id')
    expect(JSON.stringify(report)).not.toContain('must-not-leak')
  })

  it('reports malformed theme boundaries without throwing', () => {
    expect(buildXmindThemeFidelityReport(null).warnings).toEqual([
      expect.objectContaining({ path: 'theme', reason: 'Theme JSON is not an object' })
    ])
    expect(buildXmindThemeFidelityReport({ content: null }).warnings).toEqual([
      expect.objectContaining({ path: 'theme.content', reason: 'Theme content is not an object' })
    ])
  })
})
