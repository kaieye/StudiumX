import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { publishLessonArtifacts } from '../../src/main/teaching-lesson-artifacts'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import {
  loadWorkspaceIndex,
  saveWorkspaceIndex
} from '../../src/main/teaching-workspace/lifecycle'
import type { RegistryWorkspace } from '../../src/main/teaching-workspace/registry'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'
import {
  createLearningOutcomeCommitClient,
  recordPreviewLessonInteractionAndMaybeCommit
} from '../../src/renderer/src/teaching/learning-outcome-commit-client'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

const generator: TeachingSettingsV1['generator'] = {
  providerId: 'test-provider',
  model: 'test-model',
  endpointFormat: 'chat_completions',
  temperature: 0.2,
  maxOutputTokens: 4096,
  lessonDurationMinutes: 25,
  includeRetrievalPractice: true,
  generateReference: false,
  structuredOutput: true,
  streaming: false,
  reasoningEffort: 'off',
  requestTimeoutMs: 30_000
}

/** Fixed assessment plan — no provider key / generateLesson fallback path. */
const FIXED_ASSESSMENT_PLAN = {
  title: 'Trusted assessment',
  objective: 'Use canonical sidecar facts.',
  durationMinutes: 25,
  sections: [{ heading: 'Evidence', body: 'Normal previews are not assessment authority.' }],
  keyPoints: ['Bind the sidecar digest'],
  quiz: [
    {
      type: 'single' as const,
      question: 'Which artifact is authoritative?',
      choices: ['Normal preview', 'Assessment sidecar'],
      answer: 1,
      explanation: 'Only the static sidecar is evaluated.'
    }
  ],
  flashcards: [] as [],
  callouts: [] as [],
  referenceNotes: '',
  learningRecordNote: ''
}

async function createService(label: string): Promise<TeachingWorkspaceService> {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  return new TeachingWorkspaceService({
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot)
  })
}

function activatePreviewLesson(service: TeachingWorkspaceService, webContentsId: number, url: string): void {
  service.observePreviewLessonNavigation(webContentsId, {
    url,
    isMainFrame: false,
    isSameDocument: false,
    frameProcessId: webContentsId,
    frameRoutingId: webContentsId + 1000
  })
}

async function countLearningRecords(workspaceRoot: string): Promise<number> {
  const entries = await readdir(join(workspaceRoot, 'learning-records')).catch(() => [] as string[])
  return entries.filter((name) => name.endsWith('.md')).length
}

/**
 * Seed a fixed published lesson + canonical session into a service-managed
 * workspace without calling generateLesson / provider generation.
 */
async function seedFixedPreviewLesson(workspace: RegistryWorkspace) {
  const publication = await publishLessonArtifacts(
    {
      workspace: { name: workspace.name, rootPath: workspace.rootPath },
      plan: FIXED_ASSESSMENT_PLAN,
      sequence: 1,
      title: FIXED_ASSESSMENT_PLAN.title,
      objective: FIXED_ASSESSMENT_PLAN.objective,
      prompt: 'Teach trusted assessment with a fixed fixture.',
      createdAt: '2026-07-15T15:00:00.000Z',
      durationMinutes: 25,
      mission: { title: workspace.name, excerpt: 'Trust static evidence.' },
      generator,
      includeReference: false
    },
    {
      bindCanonicalSession: async ({ lesson, assessment }) => {
        const ledger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
        await ledger.open({
          sessionId: lesson.sessionId,
          workspaceId: workspace.id,
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
    }
  )

  const index = await loadWorkspaceIndex(workspace)
  await saveWorkspaceIndex(workspace.rootPath, {
    ...index,
    updatedAt: '2026-07-15T15:00:00.000Z',
    lessons: [publication.lesson]
  })

  return publication
}

describe('production App learning-outcome commit cutover (TeachingWorkspaceService sole writer)', () => {
  it('records wrong then corrected evidence through the App helper with a fixed assessment fixture', async () => {
    const service = await createService('app-commit-cutover-fixed')
    const created = await service.createWorkspace({
      name: 'App commit cutover',
      prompt: 'Teach a trustworthy quiz correction loop.'
    })
    const workspace = created.activeWorkspace!
    const publication = await seedFixedPreviewLesson(workspace)
    const lesson = publication.lesson
    const senderId = 901

    const preview = await service.readLesson(
      { workspaceId: workspace.id, lessonPath: lesson.relativePath },
      senderId
    )
    activatePreviewLesson(service, senderId, preview.url)

    const api = {
      recordPreviewLessonInteraction: (intent: Parameters<TeachingWorkspaceService['recordPreviewLessonInteraction']>[1]) =>
        service.recordPreviewLessonInteraction(senderId, intent),
      commitLearningOutcome: (request: Parameters<TeachingWorkspaceService['commitLearningOutcome']>[0]) =>
        service.commitLearningOutcome(request)
    }
    const client = createLearningOutcomeCommitClient({
      commitLearningOutcome: api.commitLearningOutcome
    })
    client.setLessonScope(`${workspace.id}:${lesson.relativePath}`)

    const wrong = await recordPreviewLessonInteractionAndMaybeCommit({
      api,
      workspaceId: workspace.id,
      client,
      intent: {
        eventId: 'app-commit-wrong-001',
        kind: 'quiz_answered',
        itemId: 'quiz-1',
        selectedOptionIds: ['a'],
        correct: false
      }
    })
    expect(wrong.receipt).toMatchObject({
      eventId: 'app-commit-wrong-001',
      sessionId: lesson.sessionId,
      duplicate: false
    })
    expect(wrong.commitStatus).toMatchObject({
      kind: 'needs_practice',
      recordSaved: false,
      announcement: null,
      operationId: `outcome-seq-${wrong.receipt!.sequence}`
    })
    expect(await countLearningRecords(workspace.rootPath)).toBe(0)

    const corrected = await recordPreviewLessonInteractionAndMaybeCommit({
      api,
      workspaceId: workspace.id,
      client,
      intent: {
        eventId: 'app-commit-corrected-002',
        kind: 'quiz_answered',
        itemId: 'quiz-1',
        selectedOptionIds: ['b'],
        correct: false
      }
    })
    expect(corrected.receipt).toMatchObject({
      eventId: 'app-commit-corrected-002',
      sessionId: lesson.sessionId,
      duplicate: false
    })
    expect(corrected.commitStatus).toMatchObject({
      kind: 'saved',
      recordSaved: true,
      outcomeKind: 'misconception_corrected',
      operationId: `outcome-seq-${corrected.receipt!.sequence}`
    })
    expect(corrected.commitStatus.kind === 'saved' ? corrected.commitStatus.announcement : null).toMatchObject({
      id: `saved:outcome-seq-${corrected.receipt!.sequence}`
    })
    expect(await countLearningRecords(workspace.rootPath)).toBe(1)

    const replay = await client.commitAfterEvidence({
      workspaceId: workspace.id,
      sessionId: lesson.sessionId,
      evidenceSequence: corrected.receipt!.sequence,
      eventId: 'app-commit-corrected-002',
      intentKind: 'quiz_answered'
    })
    expect(replay).toMatchObject({
      kind: 'already_committed',
      recordSaved: true,
      announcement: null,
      operationId: `outcome-seq-${corrected.receipt!.sequence}`
    })
    expect(await countLearningRecords(workspace.rootPath)).toBe(1)
    expect(client.getEmittedAnnouncementIds()).toEqual([
      `saved:outcome-seq-${corrected.receipt!.sequence}`
    ])
  })

  it('same-operationId retry after api_reject reuses the formal commit path without new evidence', async () => {
    const service = await createService('app-commit-retry-same-op')
    const created = await service.createWorkspace({
      name: 'App commit retry',
      prompt: 'Retry same operationId after transient reject.'
    })
    const workspace = created.activeWorkspace!
    const publication = await seedFixedPreviewLesson(workspace)
    const lesson = publication.lesson
    const senderId = 902

    const preview = await service.readLesson(
      { workspaceId: workspace.id, lessonPath: lesson.relativePath },
      senderId
    )
    activatePreviewLesson(service, senderId, preview.url)

    let commitCalls = 0
    const realCommit = (request: Parameters<TeachingWorkspaceService['commitLearningOutcome']>[0]) =>
      service.commitLearningOutcome(request)
    const api = {
      recordPreviewLessonInteraction: (intent: Parameters<TeachingWorkspaceService['recordPreviewLessonInteraction']>[1]) =>
        service.recordPreviewLessonInteraction(senderId, intent),
      commitLearningOutcome: async (request: Parameters<TeachingWorkspaceService['commitLearningOutcome']>[0]) => {
        commitCalls += 1
        if (commitCalls === 1) throw new Error('ipc down')
        return realCommit(request)
      }
    }
    const client = createLearningOutcomeCommitClient({
      commitLearningOutcome: api.commitLearningOutcome
    })
    client.setLessonScope(`${workspace.id}:${lesson.relativePath}:retry`)

    const first = await recordPreviewLessonInteractionAndMaybeCommit({
      api,
      workspaceId: workspace.id,
      client,
      intent: {
        eventId: 'app-commit-retry-001',
        kind: 'quiz_answered',
        itemId: 'quiz-1',
        selectedOptionIds: ['b'],
        correct: false
      }
    })
    expect(first.commitStatus).toMatchObject({
      kind: 'retryable',
      reason: 'api_reject',
      canRetry: true,
      operationId: `outcome-seq-${first.receipt!.sequence}`
    })
    expect(await countLearningRecords(workspace.rootPath)).toBe(0)

    const recovered = await client.retry()
    expect(recovered).toMatchObject({
      kind: 'saved',
      recordSaved: true,
      operationId: `outcome-seq-${first.receipt!.sequence}`,
      announcement: { id: `saved:outcome-seq-${first.receipt!.sequence}` }
    })
    expect(commitCalls).toBe(2)
    expect(await countLearningRecords(workspace.rootPath)).toBe(1)

    const replay = await client.retry()
    expect(replay.kind === 'saved' || replay.kind === 'already_committed' || replay.kind === 'idle').toBe(true)
    expect(commitCalls).toBe(2)
    expect(client.getEmittedAnnouncementIds()).toEqual([
      `saved:outcome-seq-${first.receipt!.sequence}`
    ])
  })
})
