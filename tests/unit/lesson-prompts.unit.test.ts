import { describe, expect, it } from 'vitest'
import type { TeachingMemoryRecord, TeachingSettingsV1 } from '../../src/shared/teaching-types'
import {
  buildLessonSystemPrompt,
  buildLessonUserPrompt
} from '../../src/main/ai/lesson-prompts'

function memory(
  partial: Partial<TeachingMemoryRecord> & Pick<TeachingMemoryRecord, 'id' | 'content'>
): TeachingMemoryRecord {
  return {
    id: partial.id,
    content: partial.content,
    scope: partial.scope ?? 'workspace',
    tags: partial.tags ?? [],
    confidence: partial.confidence ?? 1,
    createdAt: partial.createdAt ?? '2026-07-21T00:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-07-21T00:00:00.000Z',
    deletedAt: partial.deletedAt,
    disabledAt: partial.disabledAt
  }
}

/** Minimal stub — buildLessonSystemPrompt currently types generator but does not read it. */
const generatorStub = {
  providerId: 'openai',
  model: 'gpt-test',
  endpointFormat: 'openai-chat',
  temperature: 0.2,
  maxOutputTokens: 2048,
  lessonDurationMinutes: 15,
  includeRetrievalPractice: true,
  generateReference: false,
  structuredOutput: false,
  streaming: false,
  reasoningEffort: 'none',
  requestTimeoutMs: 60_000
} as TeachingSettingsV1['generator']

const malicious =
  '偏好：表格\u0000\u0007\nAuthorization: Bearer sk-abcdefghijklmnopqrstuvwxyz012345\npath=C:\\Users\\alice\\secret.md'

describe('lesson-prompts memory injection sanitize', () => {
  it('sanitizes memory.content in system prompt', () => {
    const out = buildLessonSystemPrompt({
      missionTitle: 'Mission',
      missionExcerpt: 'excerpt',
      durationMinutes: 15,
      includeRetrievalPractice: true,
      generateReference: false,
      memories: [memory({ id: 'm1', content: malicious, scope: 'user' })],
      generator: generatorStub
    })

    expect(out).toContain('可用长期记忆')
    expect(out).toContain('[redacted]')
    expect(out).toContain('[path]')
    expect(out).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/)
    expect(out).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz012345/)
    expect(out).not.toContain('C:\\Users\\alice')
    expect(out).toContain('偏好：表格')
  })

  it('sanitizes memory.content in user prompt', () => {
    const out = buildLessonUserPrompt({
      prompt: '学导数',
      sequence: 1,
      missionTitle: 'Mission',
      memories: [memory({ id: 'm1', content: malicious })]
    })

    expect(out).toContain('相关长期记忆')
    expect(out).toContain('[redacted]')
    expect(out).toContain('[path]')
    expect(out).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/)
    expect(out).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz012345/)
    expect(out).not.toContain('C:\\Users\\alice')
  })

  it('omits memory blocks when memories list is empty', () => {
    const system = buildLessonSystemPrompt({
      missionTitle: 'Mission',
      missionExcerpt: 'excerpt',
      durationMinutes: 15,
      includeRetrievalPractice: false,
      generateReference: false,
      memories: [],
      generator: generatorStub
    })
    const user = buildLessonUserPrompt({
      prompt: '学导数',
      sequence: 1,
      missionTitle: 'Mission',
      memories: []
    })
    expect(system).not.toContain('可用长期记忆')
    expect(user).not.toContain('相关长期记忆')
  })
})
