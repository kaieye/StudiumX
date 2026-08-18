import { describe, expect, it } from 'vitest'
import {
  getCanvasInspectorFieldCapability,
  getElementInspectorFieldCapability,
  getTopicStyleFieldCapability
} from '../../src/renderer/src/views/mindmap/mind-map-inspector-capabilities'

describe('mind-map inspector field capabilities', () => {
  it('resolves border fields independently of other topic style fields', () => {
    expect(getTopicStyleFieldCapability('stroke', { borderEnabled: false })).toMatchObject({
      supported: true, disabled: true, reasonKey: 'borderDisabled'
    })
    expect(getTopicStyleFieldCapability('fill', { borderEnabled: false })).toMatchObject({
      supported: true, disabled: false
    })
  })

  it('limits auto-balance to logic-chart structures without disabling other canvas fields', () => {
    expect(getCanvasInspectorFieldCapability('autoBalance', 'studiumx.layout.org-chart.down')).toMatchObject({
      supported: false, disabled: true, reasonKey: 'balancedMapUnavailable'
    })
    expect(getCanvasInspectorFieldCapability('compact', 'studiumx.layout.org-chart.down')).toMatchObject({
      supported: true, disabled: false
    })
  })

  it('makes unavailable element fields explicit rather than omitting the capability decision', () => {
    expect(getElementInspectorFieldCapability('summary', 'fill')).toMatchObject({
      supported: false, disabled: true, reasonKey: 'unsupportedElementField'
    })
    expect(getElementInspectorFieldCapability('summary', 'stroke')).toMatchObject({
      supported: true, disabled: false
    })
    expect(getElementInspectorFieldCapability('free-topic', 'text')).toMatchObject({
      supported: false, disabled: true, reasonKey: 'freeTopicCanvasUnavailable'
    })
  })
})
