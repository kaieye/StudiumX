import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishLessonArtifacts, type LessonArtifactPublicationFacts } from '../../src/main/teaching-lesson-artifacts'
import { runLessonGenerationPipeline } from '../../src/main/teaching-lesson-generation'
import { planLessonIndexReconciliation } from '../../src/main/teaching-workspace/catalog-reconciliation'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { normalizeTeachingSettings } from '../../src/shared/teaching-settings-schema'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'
import { createIsolatedTestRuntime, type IsolatedTestRuntime } from '../helpers/runtime-isolation'

const renameFailure = vi.hoisted(() => ({ publishRenameCalls: 0, failOnPublishRename: 0, publishTargets: [] as string[] }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (String(from).includes('.studiumx-lesson-stage-')) {
        renameFailure.publishRenameCalls += 1
        renameFailure.publishTargets.push(to)
        if (renameFailure.publishRenameCalls === renameFailure.failOnPublishRename) {
          throw Object.assign(new Error('injected publish failure'), { code: 'EIO' })
        }
      }
      await actual.rename(from, to)
    }
  }
})

const generator: TeachingSettingsV1['generator'] = {
  providerId: 'test-provider',
  model: 'test-model',
  endpointFormat: 'chat_completions',
  temperature: 0.2,
  maxOutputTokens: 4096,
  lessonDurationMinutes: 25,
  includeRetrievalPractice: true,
  generateReference: true,
  structuredOutput: true,
  streaming: false,
  reasoningEffort: 'off',
  requestTimeoutMs: 30_000
}

const runtimes: IsolatedTestRuntime[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  renameFailure.publishRenameCalls = 0
  renameFailure.failOnPublishRename = 0
  renameFailure.publishTargets = []
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.cleanup()))
})

function publicationFacts(runtime: IsolatedTestRuntime, overrides: Partial<LessonArtifactPublicationFacts> = {}): LessonArtifactPublicationFacts {
  return {
    workspace: { name: 'Learning Lab', rootPath: runtime.workspaceDir },
    plan: {
      title: 'Atomic publication',
      objective: 'Publish a complete lesson set.',
      durationMinutes: 25,
      sections: [{ heading: 'One step', body: 'Render **everything** before publishing.' }],
      keyPoints: ['Stage before publish'],
      quiz: [],
      flashcards: [],
      callouts: [],
      referenceNotes: 'Reference note',
      learningRecordNote: '## 判定\n\nPublication completed.\n\n## 影响\n\nSafe output.'
    },
    sequence: 1,
    title: 'Atomic publication',
    objective: 'Publish a complete lesson set.',
    prompt: 'Teach atomic publication.',
    createdAt: '2026-07-14T00:00:00.000Z',
    durationMinutes: 25,
    mission: { title: 'Reliable lessons', excerpt: 'Publish complete lesson artifacts.' },
    generator,
    includeReference: false,
      ...overrides
  }
}

async function runtime(label: string): Promise<IsolatedTestRuntime> {
  const value = await createIsolatedTestRuntime(label)
  runtimes.push(value)
  return value
}

describe('Lesson artifact publisher integration', () => {
  it('publishes a deterministic static assessment sidecar from the same quiz plan before the discoverable Lesson', async () => {
    const isolated = await runtime('lesson-assessment-sidecar')
    const facts = publicationFacts(isolated, {
      plan: {
        ...publicationFacts(isolated).plan,
        quiz: [{
          type: 'single',
          question: 'Which artifact is authoritative?',
          choices: ['Normal lesson', 'Assessment sidecar'],
          answer: 1,
          explanation: 'The sidecar is canonical for assessment.'
        }, {
          type: 'truefalse',
          question: 'A sidecar is static.',
          answer: true,
          explanation: 'It contains no executable content.'
        }]
      }
    })

    const published = await publishLessonArtifacts(facts)
    const sidecar = await readFile(join(isolated.workspaceDir, ...published.assessment.relativePath.split('/')), 'utf8')
    const normal = await readFile(published.lesson.absolutePath, 'utf8')

    expect(published.paths.assessmentRelativePath).toBe('lessons/0001-atomic-publication-assessment.json')
    expect(published.assessment).toEqual({
      relativePath: published.paths.assessmentRelativePath,
      contentSha256: createHash('sha256').update(sidecar, 'utf8').digest('hex')
    })
    expect(published.eventPaths).toEqual([
      published.lesson.relativePath,
      published.assessment.relativePath
    ])
    expect(renameFailure.publishTargets.map((path) => path.replace(/\\/g, '/'))).toEqual([
      join(isolated.workspaceDir, published.assessment.relativePath).replace(/\\/g, '/'),
      published.lesson.absolutePath.replace(/\\/g, '/')
    ])
    const authority = JSON.parse(sidecar) as { schemaVersion: number; kind: string; quizzes: Array<{ itemId: string }> }
    expect(authority).toMatchObject({ schemaVersion: 1, kind: 'studiumx-assessment' })
    expect(authority.quizzes.map((quiz) => quiz.itemId)).toEqual(['quiz-1', 'quiz-2'])
    expect(sidecar).not.toMatch(/<(?:html|script|iframe|template)\b/i)
    expect([...normal.matchAll(/data-item-id="([^"]+)"/g)].map((match) => match[1])).toEqual(['quiz-1', 'quiz-2'])
  })

  it('publishes the default-course lesson only and returns its durable paths with working asset links', async () => {
    const isolated = await runtime('lesson-artifacts-default')
    const published = await publishLessonArtifacts(publicationFacts(isolated))

    expect(published.lesson).toMatchObject({
      id: '0001',
      courseRelativePath: 'lessons',
      sessionRelativePath: 'lessons',
      relativePath: 'lessons/0001-atomic-publication.html'
    })
    expect(published.paths.referenceRelativePath).toBeNull()
    expect(published.paths).not.toHaveProperty('recordRelativePath')
    expect(published.paths.reviewsRelativePath).toBeNull()
    expect(published.eventPaths).toEqual([
      'lessons/0001-atomic-publication.html',
      'lessons/0001-atomic-publication-assessment.json'
    ])

    const html = await readFile(published.lesson.absolutePath, 'utf8')
    expect(html).toContain('href="../assets/lesson.css"')
    expect(html).toContain('src="../assets/quiz.js"')
    expect(html).toContain('<meta name="generator" content="StudiumX"')
    expect((await readdir(join(isolated.workspaceDir, 'lessons'))).filter((file) => file.endsWith('.html'))).toEqual([
      '0001-atomic-publication.html'
    ])
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-assessment.json'), 'utf8')).resolves.toContain('studiumx-assessment')
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-reference.html'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('publishes Lesson, Reference, and reviews without creating a Learning record or changing legacy records', async () => {
    const isolated = await runtime('lesson-artifacts-named')
    const legacyRecordsDirectory = join(isolated.workspaceDir, 'learning-records')
    const legacyRecordPath = join(legacyRecordsDirectory, '0001-legacy-understanding.md')
    const legacyRecord = '# Legacy learning record\n\nObserved evidence from an earlier conversation.\n'
    await mkdir(legacyRecordsDirectory, { recursive: true })
    await writeFile(legacyRecordPath, legacyRecord, 'utf8')
    const facts = publicationFacts(isolated, {
      sequence: 2,
      title: 'Event loop mechanics',
      requestedCourseName: 'JavaScript Runtime',
      includeReference: true,
      plan: {
        ...publicationFacts(isolated).plan,
        title: 'Event loop mechanics',
        flashcards: [{ front: 'What runs first?', back: 'The current call stack.' }]
      }
    })
    const published = await publishLessonArtifacts(facts)

    expect(published.lesson).toMatchObject({
      id: '0002',
      courseName: 'Javascript Runtime',
      courseRelativePath: 'courses/javascript-runtime',
      sessionRelativePath: 'courses/javascript-runtime/lesson',
      relativePath: 'courses/javascript-runtime/lesson/0002-event-loop-mechanics.html'
    })
    expect(published.paths).not.toHaveProperty('recordRelativePath')
    expect(published.paths).not.toHaveProperty('recordAbsolutePath')
    expect(published.eventPaths).toEqual([
      'courses/javascript-runtime/lesson/0002-event-loop-mechanics.html',
      'courses/javascript-runtime/lesson/0002-event-loop-mechanics-assessment.json',
      'courses/javascript-runtime/lesson/0002-event-loop-mechanics-reference.html',
      'courses/javascript-runtime/lesson/0002-event-loop-mechanics-flashcards.json'
    ])
    await expect(readFile(published.paths.referenceAbsolutePath!, 'utf8')).resolves.toContain('Event loop mechanics 速查')
    await expect(readFile(published.paths.reviewsAbsolutePath!, 'utf8')).resolves.toContain('What runs first?')
    await expect(readFile(join(isolated.workspaceDir, 'courses', 'javascript-runtime', 'lesson', '0002-event-loop-mechanics.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(legacyRecordPath, 'utf8')).resolves.toBe(legacyRecord)
    await expect(readdir(legacyRecordsDirectory)).resolves.toEqual(['0001-legacy-understanding.md'])
    await expect(readFile(published.lesson.absolutePath, 'utf8')).resolves.toContain('href="../../../assets/lesson.css"')
  })

  it('ignores a legacy generateLearningRecord setting while publishing durable Lesson and Reference artifacts', async () => {
    const isolated = await runtime('lesson-artifacts-legacy-setting')
    const settings = normalizeTeachingSettings({
      generator: {
        generateLearningRecord: true,
        generateReference: true
      }
    }, isolated.workspaceDir)

    const generated = await runLessonGenerationPipeline({
      workspace: { id: 'workspace-1', name: 'Learning Lab', rootPath: isolated.workspaceDir },
      settings,
      lessons: [],
      prompt: 'Teach one safe publication step.',
      messages: [],
      now: '2026-07-14T00:00:00.000Z',
      retrieveMemories: async () => []
    })

    expect(generated.lesson.relativePath).toMatch(/\.html$/)
    expect(generated.eventPaths).toContain(generated.lesson.relativePath)
    expect(generated.eventPaths.some((path) => path.endsWith('-reference.html'))).toBe(true)
    expect(generated.eventPaths.some((path) => path.endsWith('.md'))).toBe(false)
    await expect(readFile(generated.lesson.absolutePath, 'utf8')).resolves.toContain('<!doctype html>')
    await expect(readdir(join(isolated.workspaceDir, 'learning-records'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cleans staging and rolls back already-published artifacts when a final publish rename fails', async () => {
    const isolated = await runtime('lesson-artifacts-cleanup')
    const facts = publicationFacts(isolated, {
      includeReference: true,
      plan: {
        ...publicationFacts(isolated).plan,
        flashcards: [{ front: 'Front', back: 'Back' }]
      }
    })
    renameFailure.failOnPublishRename = 2

    await expect(publishLessonArtifacts(facts)).rejects.toThrow('injected publish failure')
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-reference.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-assessment.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-flashcards.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(isolated.workspaceDir)).resolves.not.toContain('lessons')
  })

  it('keeps an actual published Assessment Lesson visible while excluding only its marked sidecar collision', async () => {
    const isolated = await runtime('lesson-assessment-title-collision')
    const base = publicationFacts(isolated)
    const facts = {
      ...base,
      title: 'Assessment',
      plan: { ...base.plan, title: 'Assessment' }
    }

    const workspaceId = 'workspace-assessment-collision'
    const ledger = createLearningSessionLedger({ workspaceRoot: isolated.workspaceDir })
    const published = await publishLessonArtifacts(facts, {
      bindCanonicalSession: async ({ lesson, assessment }) => {
        await ledger.open({
          sessionId: lesson.sessionId,
          workspaceId,
          courseRef: {
            courseId: lesson.courseId,
            courseName: lesson.courseName,
            relativePath: lesson.courseRelativePath
          },
          lessonRef: {
            lessonId: lesson.id,
            title: lesson.title,
            relativePath: lesson.relativePath,
            assessment
          }
        })
      }
    })
    expect(published.lesson.relativePath).toBe('lessons/0001-assessment.html')
    expect(published.assessment.relativePath).toBe('lessons/0001-assessment-assessment.json')

    const reconciliation = await planLessonIndexReconciliation({
      rootPath: isolated.workspaceDir,
      workspaceName: 'Learning Lab',
      workspaceId,
      lessons: []
    })
    expect(reconciliation.recoveredRelativePaths).toEqual([published.lesson.relativePath])
    expect(reconciliation.lessons.map((lesson) => lesson.relativePath)).toEqual([published.lesson.relativePath])
  })
  it('does not publish any lesson artifact when the canonical session binding fails before the final Lesson rename', async () => {
    const isolated = await runtime('lesson-binding-atomic-failure')
    const facts = publicationFacts(isolated)

    await expect(publishLessonArtifacts(facts, {
      bindCanonicalSession: async () => { throw new Error('injected canonical ledger open failure') }
    })).rejects.toThrow('injected canonical ledger open failure')

    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-assessment.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(isolated.workspaceDir)).resolves.not.toContain('lessons')
  })

  it('compensates a successful canonical session binding when the final Lesson rename fails', async () => {
    const isolated = await runtime('lesson-binding-final-rename-failure')
    const facts = publicationFacts(isolated)
    const compensate = vi.fn(async () => undefined)
    renameFailure.failOnPublishRename = 2

    await expect(publishLessonArtifacts(facts, {
      bindCanonicalSession: async () => compensate
    })).rejects.toThrow('injected publish failure')

    expect(compensate).toHaveBeenCalledTimes(1)
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-assessment.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(isolated.workspaceDir)).resolves.not.toContain('lessons')
  })

})