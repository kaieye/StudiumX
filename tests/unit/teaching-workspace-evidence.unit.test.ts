import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

async function createService(label: string) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  return new TeachingWorkspaceService({
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot)
  })
}

describe('TeachingWorkspaceService preview lesson evidence', () => {
  it('generates a canonical writable Session, binds a lesson preview to its sender, and durably reloads host-owned evidence', async () => {
    const service = await createService('preview-evidence')
    const created = await service.createWorkspace({ name: 'Evidence course', prompt: 'Teach trustworthy learning evidence.' })
    const workspace = created.activeWorkspace!
    const generated = await service.generateLesson({
      workspaceId: workspace.id,
      prompt: 'Explain the difference between a fact and an inference.',
      messages: []
    })
    const lesson = generated.lesson

    const ledger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
    const session = await ledger.load(lesson.sessionId)
    expect(session).toMatchObject({
      id: lesson.sessionId,
      source: 'canonical',
      readOnly: false,
      status: 'active',
      workspaceId: workspace.id,
      courseRef: { courseId: lesson.courseId, courseName: lesson.courseName, relativePath: lesson.courseRelativePath },
      lessonRef: { lessonId: lesson.id, title: lesson.title, relativePath: lesson.relativePath }
    })

    await service.readLesson({ workspaceId: workspace.id, lessonPath: lesson.relativePath }, 101)
    const receipt = await service.recordPreviewLessonInteraction(101, {
      eventId: 'preview-open-001', kind: 'lesson_opened', itemId: lesson.id
    })
    expect(receipt).toEqual({ eventId: 'preview-open-001', sessionId: lesson.sessionId, sequence: 1, duplicate: false })

    const restartedLedger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
    const reloaded = await restartedLedger.load(lesson.sessionId)
    const recorded = reloaded?.events[0]?.payload.lessonInteraction as Record<string, unknown>
    const digest = createHash('sha256').update(await readFile(lesson.absolutePath)).digest('hex')
    expect(recorded).toMatchObject({
      eventId: 'preview-open-001',
      workspaceId: workspace.id,
      courseId: lesson.courseId,
      sessionId: lesson.sessionId,
      lessonId: lesson.id,
      artifactDigest: digest,
      attempt: 1,
      surface: 'lesson_preview'
    })
    expect(receipt).not.toHaveProperty('evidence')

    await expect(service.recordPreviewLessonInteraction(202, {
      eventId: 'preview-open-other-sender', kind: 'lesson_opened', itemId: lesson.id
    })).rejects.toMatchObject({ code: 'binding_unavailable', message: 'No trusted Lesson preview binding is active.' })
    await expect(service.recordPreviewLessonInteraction(101, {
      eventId: 'preview-open-forged', kind: 'lesson_opened', itemId: lesson.id, workspaceId: 'forged'
    } as never)).rejects.toThrow('unsupported fields')

    await writeFile(join(workspace.rootPath, 'lessons', 'generic-preview.html'), '<!doctype html><html><body>Generic</body></html>')
    await service.readLesson({ workspaceId: workspace.id, lessonPath: 'lessons/generic-preview.html' }, 101)
    await expect(service.recordPreviewLessonInteraction(101, {
      eventId: 'preview-open-after-generic-html', kind: 'lesson_opened', itemId: lesson.id
    })).rejects.toThrow('No trusted Lesson preview binding')

    await service.readWorkspaceMarkdown({ workspaceId: workspace.id, documentPath: 'MISSION.md' }, 101)
    await expect(service.recordPreviewLessonInteraction(101, {
      eventId: 'preview-open-after-markdown', kind: 'lesson_opened', itemId: lesson.id
    })).rejects.toThrow('No trusted Lesson preview binding')
    await expect((await restartedLedger.load(lesson.sessionId))?.events).toHaveLength(1)

    const restartedService = await createService('preview-evidence-restart')
    await expect(restartedService.recordPreviewLessonInteraction(101, {
      eventId: 'preview-open-after-restart', kind: 'lesson_opened', itemId: lesson.id
    })).rejects.toThrow('No trusted Lesson preview binding')
  })

  it('keeps concurrent trusted bindings isolated by numeric preview sender', async () => {
    const service = await createService('preview-evidence-concurrent-senders')
    const workspace = (await service.createWorkspace({ name: 'Concurrent bindings', prompt: 'Teach sender-scoped authority.' })).activeWorkspace!
    const first = (await service.generateLesson({ workspaceId: workspace.id, prompt: 'First concurrent Lesson', messages: [] })).lesson
    const second = (await service.generateLesson({ workspaceId: workspace.id, prompt: 'Second concurrent Lesson', messages: [] })).lesson
    const documents = (service as unknown as {
      documents: { readLesson: (workspace: unknown, lessonPath: string) => Promise<unknown> }
    }).documents
    const originalReadLesson = documents.readLesson.bind(documents)
    let releaseFirstRead!: () => void
    const firstReadBlocked = new Promise<void>((resolve) => { releaseFirstRead = resolve })
    let firstReadStarted!: () => void
    const firstReadStartedPromise = new Promise<void>((resolve) => { firstReadStarted = resolve })
    documents.readLesson = async (resolvedWorkspace, lessonPath) => {
      if (lessonPath === first.relativePath) {
        firstReadStarted()
        await firstReadBlocked
      }
      return originalReadLesson(resolvedWorkspace, lessonPath)
    }

    const firstRead = service.readLesson({ workspaceId: workspace.id, lessonPath: first.relativePath }, 401)
    await firstReadStartedPromise
    await service.readLesson({ workspaceId: workspace.id, lessonPath: second.relativePath }, 402)
    releaseFirstRead()
    await firstRead

    await expect(service.recordPreviewLessonInteraction(401, {
      eventId: 'preview-concurrent-first-001', kind: 'lesson_opened', itemId: first.id
    })).resolves.toMatchObject({ sessionId: first.sessionId })
    await expect(service.recordPreviewLessonInteraction(402, {
      eventId: 'preview-concurrent-second-001', kind: 'lesson_opened', itemId: second.id
    })).resolves.toMatchObject({ sessionId: second.sessionId })
  })

  it('does not let a stale lesson read overwrite a newer sender binding and clears authority explicitly', async () => {
    const service = await createService('preview-evidence-stale-read')
    const workspace = (await service.createWorkspace({ name: 'Stale binding', prompt: 'Teach safe preview binding.' })).activeWorkspace!
    const first = (await service.generateLesson({ workspaceId: workspace.id, prompt: 'First Lesson', messages: [] })).lesson
    const second = (await service.generateLesson({ workspaceId: workspace.id, prompt: 'Second Lesson', messages: [] })).lesson
    const documents = (service as unknown as {
      documents: { readLesson: (workspace: unknown, lessonPath: string) => Promise<unknown> }
    }).documents
    const originalReadLesson = documents.readLesson.bind(documents)
    let releaseFirstRead!: () => void
    const firstReadBlocked = new Promise<void>((resolve) => { releaseFirstRead = resolve })
    let firstReadStarted!: () => void
    const firstReadStartedPromise = new Promise<void>((resolve) => { firstReadStarted = resolve })
    documents.readLesson = async (resolvedWorkspace, lessonPath) => {
      if (lessonPath === first.relativePath) {
        firstReadStarted()
        await firstReadBlocked
      }
      return originalReadLesson(resolvedWorkspace, lessonPath)
    }

    const staleRead = service.readLesson({ workspaceId: workspace.id, lessonPath: first.relativePath }, 303)
    await firstReadStartedPromise
    await service.readLesson({ workspaceId: workspace.id, lessonPath: second.relativePath }, 303)
    releaseFirstRead()
    await staleRead

    await service.recordPreviewLessonInteraction(303, {
      eventId: 'preview-stale-read-001', kind: 'lesson_opened', itemId: second.id
    })
    await expect(service.recordPreviewLessonInteraction(303, {
      eventId: 'preview-stale-read-002', kind: 'lesson_opened', itemId: first.id
    })).resolves.toMatchObject({ sessionId: second.sessionId })

    service.clearPreviewLessonBinding(303)
    await expect(service.recordPreviewLessonInteraction(303, {
      eventId: 'preview-after-destroy-001', kind: 'lesson_opened', itemId: second.id
    })).rejects.toThrow('No trusted Lesson preview binding')

    expect((await createLearningSessionLedger({ workspaceRoot: workspace.rootPath }).load(first.sessionId))?.events).toHaveLength(0)
    expect((await createLearningSessionLedger({ workspaceRoot: workspace.rootPath }).load(second.sessionId))?.events).toHaveLength(2)
  })
})
