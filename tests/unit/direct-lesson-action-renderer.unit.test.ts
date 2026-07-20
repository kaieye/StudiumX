/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDirectLessonActionId,
  directLessonPayloadKey,
  resolveDirectLessonActionId
} from '../../src/renderer/src/app-shell/appStore'

const workspaceId = 'workspace-direct-1'

describe('direct lesson actionId renderer lifecycle', () => {
  beforeEach(() => {
    sessionStorage.clear()
    clearDirectLessonActionId(workspaceId)
  })

  afterEach(() => {
    clearDirectLessonActionId(workspaceId)
    sessionStorage.clear()
  })

  it('reuses the in-memory actionId for exact payload lost-response retries', () => {
    const input = {
      workspaceId,
      prompt: 'Exact retry prompt',
      courseName: 'Course',
      messages: [{ role: 'user' as const, content: 'Exact retry prompt' }]
    }
    const first = resolveDirectLessonActionId(input)
    const second = resolveDirectLessonActionId(input)
    expect(second).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    const marker = sessionStorage.getItem(`studiumx:direct-lesson-action:${workspaceId}`)
    expect(marker).toBeTruthy()
    expect(marker).not.toContain('Exact retry prompt')
    expect(JSON.parse(marker!)).toMatchObject({
      workspaceId,
      actionId: first,
      operation: 'direct_ui_lesson_generation/v1'
    })
  })

  it('issues independent actionIds when the payload changes', () => {
    const first = resolveDirectLessonActionId({
      workspaceId,
      prompt: 'Prompt A',
      messages: []
    })
    const second = resolveDirectLessonActionId({
      workspaceId,
      prompt: 'Prompt B',
      messages: []
    })
    expect(second).not.toBe(first)
  })

  it('issues a new actionId after clear (conflict/indeterminate path)', () => {
    const first = resolveDirectLessonActionId({
      workspaceId,
      prompt: 'Same prompt',
      messages: []
    })
    clearDirectLessonActionId(workspaceId)
    const second = resolveDirectLessonActionId({
      workspaceId,
      prompt: 'Same prompt',
      messages: []
    })
    expect(second).not.toBe(first)
  })

  it('does not treat payload key as durable storage content', () => {
    const key = directLessonPayloadKey({
      workspaceId,
      prompt: 'SECRET_SHOULD_STAY_MEMORY_ONLY',
      messages: []
    })
    expect(key).toContain('SECRET_SHOULD_STAY_MEMORY_ONLY')
    resolveDirectLessonActionId({
      workspaceId,
      prompt: 'SECRET_SHOULD_STAY_MEMORY_ONLY',
      messages: []
    })
    const marker = sessionStorage.getItem(`studiumx:direct-lesson-action:${workspaceId}`)
    expect(marker).not.toContain('SECRET_SHOULD_STAY_MEMORY_ONLY')
  })
})
