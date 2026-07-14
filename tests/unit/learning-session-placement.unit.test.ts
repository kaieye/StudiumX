import { describe, expect, it } from 'vitest'
import {
  learningSessionEventsRelativePath,
  learningSessionManifestRelativePath,
  learningSessionOutcomeRelativePath,
  learningSessionRelativePath
} from '../../src/shared/teaching-placement'

describe('Learning Session placement', () => {
  it('derives canonical workspace-relative paths only from stable Session IDs', () => {
    expect(learningSessionRelativePath('session-0001')).toBe('learning-sessions/session-0001')
    expect(learningSessionManifestRelativePath('session-0001')).toBe('learning-sessions/session-0001/session.json')
    expect(learningSessionEventsRelativePath('session-0001')).toBe('learning-sessions/session-0001/events')
    expect(learningSessionOutcomeRelativePath('session-0001')).toBe('learning-sessions/session-0001/outcome.json')
    expect(() => learningSessionRelativePath('../escape')).toThrow(/stable Session ID/i)
    expect(() => learningSessionRelativePath('nested/session')).toThrow(/stable Session ID/i)
    expect(() => learningSessionRelativePath('session.')).toThrow(/stable Session ID/i)
    expect(() => learningSessionRelativePath('CON')).toThrow(/stable Session ID/i)
  })
})
