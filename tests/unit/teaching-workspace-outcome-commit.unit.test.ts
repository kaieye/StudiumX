import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { LearningSessionSnapshot } from '../../src/shared/teaching-types/learning-session'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

const request = {
  schemaVersion: 1 as const,
  type: 'commit' as const,
  workspaceId: 'workspace-placeholder',
  sessionId: 'session-1',
  operationId: 'operation-1'
}

function canonicalSession(workspaceId: string): LearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-1',
    workspaceId,
    source: 'canonical',
    readOnly: false,
    status: 'active',
    version: 1,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    completedAt: null,
    courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course.md' },
    lessonRef: null,
    conversationRefs: [],
    eventCount: 0,
    outcomeRef: null,
    events: []
  }
}

function legacySession(): LearningSessionSnapshot {
  return {
    schemaVersion: 1,
    id: 'session-1',
    workspaceId: null,
    source: 'legacy_lesson',
    readOnly: true,
    status: 'legacy_read_only',
    version: 0,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    completedAt: null,
    courseRef: { courseId: 'course-1', courseName: 'Course', relativePath: 'courses/course.md' },
    lessonRef: { lessonId: 'lesson-1', title: 'Lesson', relativePath: 'courses/lesson.md' },
    conversationRefs: [],
    eventCount: 0,
    outcomeRef: null,
    events: []
  }
}

async function createService(label: string, session: () => LearningSessionSnapshot | null, result: () => unknown) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  const ledger = { load: vi.fn(async () => session()) }
  const commit = vi.fn(async () => result())
  const learningOutcomeLedgerFactory = vi.fn(() => ledger)
  const learningOutcomeCommitterFactory = vi.fn(() => ({ commit }))
  const service = new TeachingWorkspaceService({
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot),
    learningOutcomeLedgerFactory,
    learningOutcomeCommitterFactory
  })
  const workspace = (await service.createWorkspace({ name: 'Outcome IPC', prompt: 'Test safe outcome delegation.' })).activeWorkspace!
  return { service, workspace, ledger, commit, learningOutcomeLedgerFactory, learningOutcomeCommitterFactory }
}

describe('TeachingWorkspaceService outcome commit façade', () => {
  it('resolves only a registered workspace root and delegates a canonical matching session without reconciliation', async () => {
    let workspaceId = ''
    const fixture = await createService(
      'outcome-commit-delegation',
      () => canonicalSession(workspaceId),
      () => ({
        status: 'committed',
        outcome: { kind: 'needs_practice', evidenceEventIds: ['private-evidence'] },
        recordSaved: false,
        record: { relativePath: 'learning-records/private.md', contentSha256: 'private-hash' }
      })
    )
    workspaceId = fixture.workspace.id

    await expect(fixture.service.commitLearningOutcome({ ...request, workspaceId })).resolves.toEqual({
      status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false
    })
    expect(fixture.learningOutcomeLedgerFactory).toHaveBeenCalledWith(fixture.workspace.rootPath)
    expect(fixture.ledger.load).toHaveBeenCalledWith('session-1')
    expect(fixture.learningOutcomeCommitterFactory).toHaveBeenCalledWith(fixture.workspace.rootPath, fixture.ledger)
    expect(fixture.commit).toHaveBeenCalledWith({ sessionId: 'session-1', operationId: 'operation-1' })
  })

  it('rejects unknown workspace, missing session, legacy/read-only session, and workspace mismatch before the committer', async () => {
    let mode: 'missing' | 'legacy' | 'readOnly' | 'mismatch' = 'missing'
    let workspaceId = ''
    const fixture = await createService('outcome-commit-guards', () => {
      if (mode === 'missing') return null
      if (mode === 'legacy') return legacySession()
      if (mode === 'readOnly') return { ...canonicalSession(workspaceId), readOnly: true } as LearningSessionSnapshot
      return canonicalSession('another-registered-or-not-workspace')
    }, () => ({ status: 'committed', outcome: { kind: 'established' }, recordSaved: true }))
    workspaceId = fixture.workspace.id

    await expect(fixture.service.commitLearningOutcome({ ...request, workspaceId: 'unknown-workspace' })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'not_found'
    })
    await expect(fixture.service.commitLearningOutcome({ ...request, workspaceId })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'not_found'
    })

    mode = 'legacy'
    await expect(fixture.service.commitLearningOutcome({ ...request, workspaceId })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'read_only'
    })

    mode = 'readOnly'
    await expect(fixture.service.commitLearningOutcome({ ...request, workspaceId })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'read_only'
    })

    mode = 'mismatch'
    await expect(fixture.service.commitLearningOutcome({ ...request, workspaceId })).resolves.toEqual({
      status: 'non_retryable_failure', reason: 'invalid_session'
    })
    expect(fixture.commit).not.toHaveBeenCalled()
    expect(fixture.learningOutcomeCommitterFactory).not.toHaveBeenCalled()
  })

  it('recursively projects every outcome result to the learner-safe union', async () => {
    let workspaceId = ''
    const responses = [
      {
        status: 'insufficient_evidence', reason: 'not_evidenced',
        diagnostics: [{ relativePath: 'private/evidence.json', message: 'private' }]
      },
      {
        status: 'committed',
        outcome: {
          kind: 'needs_practice', evidenceEventIds: ['secret-evidence'], relativePath: 'private/outcome.json',
          assessment: { contentSha256: 'secret-hash' }
        },
        recordSaved: false,
        record: { content: 'private record', absolutePath: 'C:/private/record.md' }
      },
      {
        status: 'committed',
        outcome: {
          kind: 'misconception_corrected', evidenceEventIds: ['secret-evidence'], evaluator: { provider: 'private-provider' }
        },
        recordSaved: true,
        artifact: { relativePath: 'private/artifact', contentSha256: 'secret-hash' }
      },
      {
        status: 'already_committed',
        outcome: { kind: 'established', evidenceEventIds: ['secret-evidence'], record: { content: 'private' } },
        recordSaved: true,
        provider: { message: 'private provider failure' }
      },
      {
        status: 'conflict', reason: 'review_required',
        evaluator: { diagnostics: ['private diagnostic'] }, error: { message: 'private exception' }
      }
    ]
    const fixture = await createService(
      'outcome-commit-projection',
      () => canonicalSession(workspaceId),
      () => responses.shift()
    )
    workspaceId = fixture.workspace.id

    const projected = []
    for (let index = 0; index < 5; index += 1) {
      projected.push(await fixture.service.commitLearningOutcome({ ...request, workspaceId }))
    }
    expect(projected).toEqual([
      { status: 'insufficient_evidence', reason: 'not_evidenced' },
      { status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false },
      { status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true },
      { status: 'already_committed', outcome: { kind: 'established' }, recordSaved: true },
      { status: 'conflict', reason: 'review_required' }
    ])
    expect(JSON.stringify(projected)).not.toMatch(/private|secret|hash|diagnostic|provider|absolutePath|relativePath|content/i)
  })
})
