import { describe, expect, it } from 'vitest'
import { resolveFocusStartAttribution } from '../../src/shared/study-planning'

describe('resolveFocusStartAttribution (STC-401)', () => {
  it('uses explicit task when open', () => {
    expect(
      resolveFocusStartAttribution({
        explicitTaskId: 'a',
        selectedTaskId: 'b',
        openTaskIds: ['a', 'b']
      })
    ).toEqual({ kind: 'task', taskId: 'a' })
  })

  it('uses selected task without falling back to first open', () => {
    expect(
      resolveFocusStartAttribution({
        selectedTaskId: 'b',
        openTaskIds: ['a', 'b']
      })
    ).toEqual({ kind: 'task', taskId: 'b' })
  })

  it('asks by default when no selection (never silent first open)', () => {
    expect(
      resolveFocusStartAttribution({
        openTaskIds: ['a', 'b']
      })
    ).toEqual({ kind: 'ask', policy: 'ask_every_time' })
  })

  it('honors remember_unattributed preference', () => {
    expect(
      resolveFocusStartAttribution({
        openTaskIds: ['a'],
        emptyStartPolicy: 'remember_unattributed'
      })
    ).toEqual({ kind: 'unattributed' })
  })

  it('honors userChoice unattributed under ask policy', () => {
    expect(
      resolveFocusStartAttribution({
        openTaskIds: ['a'],
        userChoice: 'unattributed'
      })
    ).toEqual({ kind: 'unattributed' })
  })

  it('quick_start from preference or choice', () => {
    expect(
      resolveFocusStartAttribution({
        openTaskIds: [],
        emptyStartPolicy: 'remember_quick_start'
      })
    ).toEqual({ kind: 'quick_start' })
    expect(
      resolveFocusStartAttribution({
        openTaskIds: [],
        userChoice: 'quick_start'
      })
    ).toEqual({ kind: 'quick_start' })
  })
})
