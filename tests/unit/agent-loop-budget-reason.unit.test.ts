import { describe, expect, it } from 'vitest'
import { budgetStopReasonFromError } from '../../src/main/ai/agent-loop-budget-reason'

describe('budgetStopReasonFromError', () => {
  it('returns undefined for non-objects', () => {
    expect(budgetStopReasonFromError(undefined)).toBeUndefined()
    expect(budgetStopReasonFromError(null)).toBeUndefined()
    expect(budgetStopReasonFromError('duration')).toBeUndefined()
    expect(budgetStopReasonFromError(42)).toBeUndefined()
  })

  it('returns undefined when budgetStopReason is missing', () => {
    expect(budgetStopReasonFromError(new Error('boom'))).toBeUndefined()
    expect(budgetStopReasonFromError({})).toBeUndefined()
  })

  it.each([
    'duration',
    'provider_calls',
    'tool_calls',
    'total_tokens'
  ] as const)('accepts known reason %s', (reason) => {
    expect(budgetStopReasonFromError({ budgetStopReason: reason })).toBe(reason)
  })

  it('returns undefined for unknown reason strings', () => {
    expect(budgetStopReasonFromError({ budgetStopReason: 'tokens' })).toBeUndefined()
    expect(budgetStopReasonFromError({ budgetStopReason: 'DURATION' })).toBeUndefined()
    expect(budgetStopReasonFromError({ budgetStopReason: '' })).toBeUndefined()
  })

  it('returns undefined for non-string budgetStopReason values', () => {
    expect(budgetStopReasonFromError({ budgetStopReason: 1 })).toBeUndefined()
    expect(budgetStopReasonFromError({ budgetStopReason: true })).toBeUndefined()
    expect(budgetStopReasonFromError({ budgetStopReason: null })).toBeUndefined()
    expect(budgetStopReasonFromError({ budgetStopReason: ['duration'] })).toBeUndefined()
  })

  it('reads the field from Error subclasses with an attached property', () => {
    const err = Object.assign(new Error('budget'), { budgetStopReason: 'tool_calls' as const })
    expect(budgetStopReasonFromError(err)).toBe('tool_calls')
  })
})
