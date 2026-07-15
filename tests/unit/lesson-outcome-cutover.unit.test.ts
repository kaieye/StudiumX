import { describe, expect, it } from 'vitest'
import { buildLessonSystemPrompt } from '../../src/main/ai/lesson-prompts'
import { renderLessonHtmlFromPlan } from '../../src/main/ai/lesson-renderer'
import { lessonPlanSchema } from '../../src/shared/lesson-schema'
import type { LessonSummary, TeachingSettingsV1 } from '../../src/shared/teaching-types'

const generator: TeachingSettingsV1['generator'] = {
  providerId: 'test',
  model: 'test-model',
  endpointFormat: 'chat_completions',
  temperature: 0,
  maxOutputTokens: 1024,
  lessonDurationMinutes: 10,
  includeRetrievalPractice: true,
  generateReference: true,
  structuredOutput: true,
  streaming: false,
  reasoningEffort: 'off',
  requestTimeoutMs: 5_000
}

const lesson: LessonSummary = {
  id: '0001',
  title: 'Evidence rubric',
  objective: 'Specify evidence without claiming mastery.',
  prompt: 'Teach evidence rubrics.',
  createdAt: '2026-07-14T00:00:00.000Z',
  durationMinutes: 10,
  relativePath: 'lessons/0001-evidence-rubric.html',
  absolutePath: 'D:/workspace/lessons/0001-evidence-rubric.html',
  courseId: 'workspace',
  courseName: 'Workspace',
  courseRelativePath: 'lessons',
  courseAbsolutePath: 'D:/workspace/lessons',
  sessionId: 'lesson-0001',
  sessionName: '0001 Evidence rubric',
  sessionRelativePath: 'lessons',
  sessionAbsolutePath: 'D:/workspace/lessons'
}

describe('Lesson outcome cutover semantics', () => {
  it('keeps learningRecordNote as a backward-compatible expected-evidence field, not a mastery claim', () => {
    const plan = lessonPlanSchema.parse({
      title: 'Evidence rubric',
      objective: 'Explain the next observable evidence.',
      durationMinutes: 10,
      sections: [{ heading: 'Try', body: 'Explain the decision in your own words.' }],
      learningRecordNote: 'Expected evidence: distinguish an observation from a conclusion and explain why.'
    })

    expect(plan.learningRecordNote).toContain('Expected evidence')
    expect(plan.learningRecordNote).not.toMatch(/##\s*判定/)
  })

  it('prompts for conditional expected evidence and renders no generated Learning record content', () => {
    const prompt = buildLessonSystemPrompt({
      missionTitle: 'Evidence first',
      missionExcerpt: 'Do not turn lesson generation into learner evidence.',
      durationMinutes: 10,
      includeRetrievalPractice: true,
      generateReference: true,
      memories: [],
      generator
    })
    const plan = lessonPlanSchema.parse({
      title: 'Evidence rubric',
      objective: 'Specify observable evidence.',
      durationMinutes: 10,
      sections: [{ heading: 'Try', body: 'Give an explanation.' }],
      learningRecordNote: 'Expected evidence: explain the trade-off and name a counterexample.'
    })
    const html = renderLessonHtmlFromPlan({
      plan,
      lesson,
      mission: { title: 'Evidence first', excerpt: '' },
      workspaceName: 'Workspace',
      referenceRelativePath: null,
      generator
    })

    expect(prompt).toContain('\"learningRecordNote\": string,')
    expect(prompt).toContain('待验证证据或评分标准')
    expect(prompt).toContain('不得声称已经掌握')
    expect(prompt).toContain('不会创建或更新 learning record')
    expect(prompt).not.toContain('## 判定')
    expect(html).not.toContain(plan.learningRecordNote)
    expect(html).toContain('"learningRecord": null')
  })
})
