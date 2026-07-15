import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishLessonArtifacts, type LessonArtifactPublicationFacts } from '../../src/main/teaching-lesson-artifacts'
import { runLessonGenerationPipeline } from '../../src/main/teaching-lesson-generation'
import { normalizeTeachingSettings } from '../../src/shared/teaching-settings-schema'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'
import { createIsolatedTestRuntime, type IsolatedTestRuntime } from '../helpers/runtime-isolation'

const renameFailure = vi.hoisted(() => ({ publishRenameCalls: 0, failOnPublishRename: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (String(from).includes('.studiumx-lesson-stage-')) {
        renameFailure.publishRenameCalls += 1
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
    expect(published.eventPaths).toEqual(['lessons/0001-atomic-publication.html'])

    const html = await readFile(published.lesson.absolutePath, 'utf8')
    expect(html).toContain('href="../assets/lesson.css"')
    expect(html).toContain('src="../assets/quiz.js"')
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
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(isolated.workspaceDir, 'lessons', '0001-atomic-publication-flashcards.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(isolated.workspaceDir)).resolves.not.toContain('lessons')
  })
})