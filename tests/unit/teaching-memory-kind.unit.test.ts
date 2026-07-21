import { describe, expect, it } from 'vitest'
import {
  isTeachingMemoryKind,
  normalizeTeachingMemoryKind,
  resolveTeachingMemoryKind,
  resolveTeachingMemoryStatus,
  teachingMemoryMatchesKind,
  TEACHING_MEMORY_KINDS
} from '../../src/shared/teaching-memory-kind'

describe('teaching memory kind metadata (DB-P1-2)', () => {
  it('accepts only the stable kind taxonomy', () => {
    for (const kind of TEACHING_MEMORY_KINDS) {
      expect(isTeachingMemoryKind(kind)).toBe(true)
      expect(normalizeTeachingMemoryKind(kind)).toBe(kind)
    }
    expect(isTeachingMemoryKind('vector')).toBe(false)
    expect(normalizeTeachingMemoryKind('vector')).toBeUndefined()
    expect(normalizeTeachingMemoryKind(null)).toBeUndefined()
  })

  it('resolves explicit memoryKind before stable tags', () => {
    expect(resolveTeachingMemoryKind({
      memoryKind: 'learner-profile',
      tags: ['teaching-experience', 'episodic-session']
    })).toBe('learner-profile')
  })

  it('resolves kind from stable tags with deterministic priority', () => {
    expect(resolveTeachingMemoryKind({ tags: ['teaching-experience'] })).toBe('teaching-experience')
    expect(resolveTeachingMemoryKind({
      tags: ['episodic-session', 'teaching-synthetic', 'learner-profile']
    })).toBe('learner-profile')
    expect(resolveTeachingMemoryKind({ tags: ['misc', 'other'] })).toBeUndefined()
  })

  it('maps soft lifecycle fields to projection status without destructive purge semantics', () => {
    expect(resolveTeachingMemoryStatus({})).toBe('active')
    expect(resolveTeachingMemoryStatus({ disabledAt: '2026-07-01T00:00:00.000Z' })).toBe('disabled')
    expect(resolveTeachingMemoryStatus({
      disabledAt: '2026-07-01T00:00:00.000Z',
      deletedAt: '2026-07-02T00:00:00.000Z'
    })).toBe('deleted')
  })

  it('matches optional kind filters for catalog/lexical callers', () => {
    const record = { memoryKind: 'teaching-synthetic' as const, tags: ['teaching-synthetic'] }
    expect(teachingMemoryMatchesKind(record, undefined)).toBe(true)
    expect(teachingMemoryMatchesKind(record, [])).toBe(true)
    expect(teachingMemoryMatchesKind(record, 'teaching-synthetic')).toBe(true)
    expect(teachingMemoryMatchesKind(record, 'learner-profile')).toBe(false)
    expect(teachingMemoryMatchesKind(record, ['learner-profile', 'teaching-synthetic'])).toBe(true)
    expect(teachingMemoryMatchesKind({ tags: ['misc'] }, 'episodic-session')).toBe(false)
  })
})
