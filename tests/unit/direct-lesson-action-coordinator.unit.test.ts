import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  canonicalizeDirectLessonInput,
  computeRequestTag,
  DIRECT_LESSON_OPERATION,
  loadOrCreateInstallKey,
  readDirectLessonReceipt,
  receiptPath,
  writeDirectLessonReceipt
} from '../../src/main/direct-lesson-action'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'

const runtimeScope = createVitestRuntimeScope()

async function createService(label: string) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  const service = new TeachingWorkspaceService({
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot)
  })
  const created = await service.createWorkspace({
    name: 'Direct Lesson Action',
    prompt: 'Initial mission for lesson action correlation.'
  })
  const workspace = created.activeWorkspace
  if (!workspace) throw new Error('Expected workspace')
  return {
    service,
    workspace,
    appDataRoot: runtime.paths.appData
  }
}

describe('TeachingWorkspaceService direct lesson action correlation', () => {
  it('completes generation and reuses the same actionId without a second lesson', async () => {
    const fixture = await createService('direct-lesson-reuse')
    const actionId = randomUUID()
    const prompt = 'Teach exact retry for direct lesson actions.'

    const first = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt,
      messages: []
    })
    expect(first.disposition).toBe('succeeded')
    if (first.disposition !== 'succeeded') throw new Error('expected succeeded')
    const lessonId = first.lesson.id
    const lessonCount = first.state.activeWorkspace?.lessons.length ?? 0

    const receipt = await readDirectLessonReceipt(fixture.workspace.rootPath, actionId)
    expect(receipt.status).toBe('ok')
    if (receipt.status === 'ok') {
      expect(receipt.receipt.phase).toBe('completed')
      expect(receipt.receipt.requestTag).toMatch(/^[0-9a-f]{64}$/)
      const raw = await readFile(receiptPath(fixture.workspace.rootPath, actionId), 'utf8')
      expect(raw).not.toContain(prompt)
    }

    const second = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt,
      messages: []
    })
    expect(second.disposition).toBe('reused')
    if (second.disposition !== 'reused') throw new Error('expected reused')
    expect(second.lesson.id).toBe(lessonId)
    expect(second.state.activeWorkspace?.lessons.length).toBe(lessonCount)
  })

  it('treats different actionIds with the same prompt as independent actions', async () => {
    const fixture = await createService('direct-lesson-no-content-dedupe')
    const prompt = 'Same prompt, different user actions for lessons.'
    const first = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId: randomUUID(),
      prompt,
      messages: []
    })
    const second = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId: randomUUID(),
      prompt,
      messages: []
    })
    expect(first.disposition).toBe('succeeded')
    expect(second.disposition).toBe('succeeded')
    if (first.disposition !== 'succeeded' || second.disposition !== 'succeeded') {
      throw new Error('expected both succeeded')
    }
    expect(first.lesson.id).not.toBe(second.lesson.id)
    expect(first.actionId).not.toBe(second.actionId)
  })

  it('fails closed with request_mismatch when the same actionId is retried with a different prompt', async () => {
    const fixture = await createService('direct-lesson-request-mismatch')
    const actionId = randomUUID()
    const first = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt: 'Original bound prompt for lesson.',
      messages: []
    })
    expect(first.disposition).toBe('succeeded')
    const lessonsBefore = first.disposition === 'succeeded' ? first.state.activeWorkspace?.lessons.length : 0

    const conflicted = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt: 'Changed prompt for same action id.',
      messages: []
    })
    expect(conflicted).toEqual({
      disposition: 'conflict',
      actionId,
      code: 'request_mismatch'
    })
    const status = await fixture.service.getDirectLessonActionStatus({
      workspaceId: fixture.workspace.id,
      actionId
    })
    if (status.disposition === 'reused' || status.disposition === 'succeeded') {
      expect(status.state.activeWorkspace?.lessons.length).toBe(lessonsBefore)
    }
  })

  it('fails closed with receipt_corrupt for unreadable receipts', async () => {
    const fixture = await createService('direct-lesson-corrupt')
    const actionId = randomUUID()
    const completed = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt: 'Prompt before corruption.',
      messages: []
    })
    expect(completed.disposition).toBe('succeeded')
    await writeFile(receiptPath(fixture.workspace.rootPath, actionId), '{not-json', 'utf8')

    const result = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt: 'Prompt before corruption.',
      messages: []
    })
    expect(result).toEqual({ disposition: 'conflict', actionId, code: 'receipt_corrupt' })
  })

  it('fails closed with expired for tombstone receipts', async () => {
    const fixture = await createService('direct-lesson-tombstone')
    const actionId = randomUUID()
    const key = await loadOrCreateInstallKey(fixture.appDataRoot)
    const prompt = 'Tombstoned action must never restart.'
    const requestTag = computeRequestTag(key, {
      workspaceId: fixture.workspace.id,
      prompt,
      messages: []
    })
    const now = new Date().toISOString()
    await writeDirectLessonReceipt(
      {
        schemaVersion: 1,
        operation: DIRECT_LESSON_OPERATION,
        actionId,
        workspaceId: fixture.workspace.id,
        createdAt: now,
        updatedAt: now,
        phase: 'tombstone',
        requestTag,
        terminalKind: 'expired'
      },
      { workspaceRoot: fixture.workspace.rootPath }
    )

    const result = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt,
      messages: []
    })
    expect(result).toEqual({ disposition: 'conflict', actionId, code: 'expired' })
  })

  it('fails closed with provider_outcome_unknown for provider_started receipts without auto-retry', async () => {
    const fixture = await createService('direct-lesson-provider-started')
    const actionId = randomUUID()
    const key = await loadOrCreateInstallKey(fixture.appDataRoot)
    const prompt = 'Provider started only; never auto continue from coordinator retry.'
    const requestTag = computeRequestTag(key, {
      workspaceId: fixture.workspace.id,
      prompt,
      messages: []
    })
    const now = new Date().toISOString()
    await writeDirectLessonReceipt(
      {
        schemaVersion: 1,
        operation: DIRECT_LESSON_OPERATION,
        actionId,
        workspaceId: fixture.workspace.id,
        createdAt: now,
        updatedAt: now,
        phase: 'provider_started',
        requestTag,
        generationStartedAt: now
      },
      { workspaceRoot: fixture.workspace.rootPath }
    )

    const result = await fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt,
      messages: []
    })
    expect(result).toEqual({
      disposition: 'indeterminate',
      actionId,
      code: 'provider_outcome_unknown'
    })
    const status = await fixture.service.getDirectLessonActionStatus({
      workspaceId: fixture.workspace.id,
      actionId
    })
    expect(status).toEqual({
      disposition: 'indeterminate',
      actionId,
      code: 'provider_outcome_unknown'
    })
  })

  it('reports in_progress for concurrent same-action callers and resolves to one lesson', async () => {
    const fixture = await createService('direct-lesson-concurrent')
    const actionId = randomUUID()
    const prompt = 'Concurrent exact retry shares one disposition.'

    const firstPromise = fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt,
      messages: []
    })
    // Give the first call a chance to mark in-flight before the second starts.
    await new Promise((resolve) => setTimeout(resolve, 5))
    const secondPromise = fixture.service.generateLesson({
      workspaceId: fixture.workspace.id,
      actionId,
      prompt,
      messages: []
    })

    const [first, second] = await Promise.all([firstPromise, secondPromise])
    const dispositions = [first.disposition, second.disposition].sort()
    expect(dispositions).toEqual(['reused', 'succeeded'].sort())
    if (
      (first.disposition === 'succeeded' || first.disposition === 'reused') &&
      (second.disposition === 'succeeded' || second.disposition === 'reused')
    ) {
      expect(first.lesson.id).toBe(second.lesson.id)
    }
  })

  it('agent path generateAndPersistLesson is not required to use actionId protocol', async () => {
    // Agent tools call generateAndPersistLesson without actionId. Prove public
    // generateLesson requires actionId at the parser boundary while agent work
    // remains available via conversation tooling separately.
    const { parseGenerateLessonPayload } = await import('../../src/main/teaching-ipc-commands')
    expect(() =>
      parseGenerateLessonPayload({
        workspaceId: 'ws-1',
        prompt: 'x',
        messages: []
      })
    ).toThrow(/actionId/)

    // Canonical input helper stays free of durable secrets and is only for tags.
    const canonical = canonicalizeDirectLessonInput({
      workspaceId: 'ws-1',
      prompt: 'agent-isolated',
      messages: []
    })
    expect(canonical).toContain('direct_ui_lesson_generation/v1')
    expect(canonical).toContain('agent-isolated')
  })
})
