import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  parseDirectLessonActionStatusPayload,
  parseGenerateLessonPayload
} from '../../src/main/teaching-ipc-commands'

describe('parseGenerateLessonPayload actionId contract', () => {
  it('accepts exact workspaceId/prompt/actionId payloads', () => {
    const actionId = randomUUID()
    expect(
      parseGenerateLessonPayload({
        workspaceId: 'ws-1',
        prompt: 'Learn durable direct lesson actions.',
        actionId,
        messages: []
      })
    ).toEqual({
      workspaceId: 'ws-1',
      prompt: 'Learn durable direct lesson actions.',
      actionId: actionId.toLowerCase(),
      courseName: undefined,
      messages: []
    })
  })

  it('rejects missing, extra recovery fields, or non-UUID actionId without side effects', () => {
    expect(() => parseGenerateLessonPayload({ workspaceId: 'ws-1', prompt: 'x' })).toThrow(/actionId/)
    expect(() =>
      parseGenerateLessonPayload({
        workspaceId: 'ws-1',
        prompt: 'x',
        actionId: 'not-a-uuid'
      })
    ).toThrow(/UUID/)
    expect(() =>
      parseGenerateLessonPayload({
        workspaceId: 'ws-1',
        prompt: 'x',
        actionId: randomUUID(),
        traceId: randomUUID()
      })
    ).toThrow(/traceId/)
    expect(() =>
      parseGenerateLessonPayload({
        workspaceId: 'ws-1',
        prompt: 'x',
        actionId: randomUUID(),
        requestTag: 'a'.repeat(64)
      })
    ).toThrow(/requestTag/)
  })
})

describe('parseDirectLessonActionStatusPayload', () => {
  it('accepts only workspaceId and actionId', () => {
    const actionId = randomUUID()
    expect(
      parseDirectLessonActionStatusPayload({
        workspaceId: 'ws-1',
        actionId
      })
    ).toEqual({
      workspaceId: 'ws-1',
      actionId: actionId.toLowerCase()
    })
  })

  it('rejects extra fields and invalid action ids', () => {
    expect(() =>
      parseDirectLessonActionStatusPayload({
        workspaceId: 'ws-1',
        actionId: randomUUID(),
        prompt: 'must not appear'
      })
    ).toThrow(/only/)
    expect(() =>
      parseDirectLessonActionStatusPayload({
        workspaceId: 'ws-1',
        actionId: 'bad'
      })
    ).toThrow(/UUID/)
  })
})
