import { describe, expect, it } from 'vitest'
import {
  effectiveViewForSessionPanel,
  shouldShowSidebarSessionPanel
} from '../../src/renderer/src/App'

describe('session panel visibility while Settings is open', () => {
  it('keeps the session panel hidden on immersive views (mind map / study room)', () => {
    expect(shouldShowSidebarSessionPanel('mindmap')).toBe(false)
    expect(shouldShowSidebarSessionPanel('workbench')).toBe(false)
    // Settings itself is not an immersive view, so the panel would show if the
    // effective view were derived from the Settings view directly.
    expect(shouldShowSidebarSessionPanel('settings')).toBe(true)
  })

  it('inherits the originating view while Settings is open', () => {
    // Opened from the mind map: the panel must stay hidden behind the modal.
    expect(effectiveViewForSessionPanel('settings', 'mindmap')).toBe('mindmap')
    expect(effectiveViewForSessionPanel('settings', 'workbench')).toBe('workbench')
    // Opened from a view with a visible panel: keep it visible.
    expect(effectiveViewForSessionPanel('settings', 'overview')).toBe('overview')
    expect(effectiveViewForSessionPanel('settings', 'lessons')).toBe('lessons')
  })

  it('falls back to the Settings view when no prior view was remembered', () => {
    expect(effectiveViewForSessionPanel('settings', null)).toBe('settings')
  })

  it('leaves non-settings views untouched', () => {
    expect(effectiveViewForSessionPanel('mindmap', 'overview')).toBe('mindmap')
    expect(effectiveViewForSessionPanel('overview', null)).toBe('overview')
  })
})
