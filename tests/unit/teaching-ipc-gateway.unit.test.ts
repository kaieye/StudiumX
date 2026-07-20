import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'
import type { TeachingIpcRegistration } from '../../src/main/teaching-ipc-gateway'
import { teachingInvokeChannels } from '../../src/shared/teaching-ipc-contract'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  return {
    handlers,
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler)
    })
  }
})

const pending = vi.hoisted(() => ({
  cancelStreamAskPending: vi.fn(),
  resolveAskPending: vi.fn(() => false),
  cancelStreamToolPermissionPending: vi.fn(),
  resolveToolPermissionPending: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(), fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: electron.handle },
  Notification: { isSupported: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() }
}))
vi.mock('../../src/main/ai/ask-pending', () => ({
  cancelStreamAskPending: pending.cancelStreamAskPending,
  resolveAskPending: pending.resolveAskPending
}))
vi.mock('../../src/main/ai/tool-permission-pending', () => ({
  cancelStreamToolPermissionPending: pending.cancelStreamToolPermissionPending,
  resolveToolPermissionPending: pending.resolveToolPermissionPending
}))

const { registerTeachingIpcGateway } = await import('../../src/main/teaching-ipc-gateway')

const runtimeScope = createVitestRuntimeScope()

async function createEvidenceService(label: string) {
  const runtime = await runtimeScope.create(label)
  const managedRoot = join(runtime.paths.workspace, 'managed')
  return new TeachingWorkspaceService({
    registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
    defaultRoot: managedRoot,
    settingsProvider: async () => defaultSettings(managedRoot)
  })
}

function registration(overrides: Record<string, unknown> = {}): TeachingIpcRegistration {
  const workspaceService = new Proxy({}, { get: () => vi.fn() })
  const settingsService = new Proxy({}, { get: () => vi.fn() })
  const skillLibraryService = new Proxy({}, { get: () => vi.fn() })
  const learningAnalyticsService = new Proxy({}, { get: () => vi.fn() })
  return {
    workspaceService,
    settingsService,
    skillLibraryService,
    learningAnalyticsService,
    logger: { error: vi.fn(), path: 'C:\logs\studiumx.log' },
    applyAppBehavior: vi.fn(),
    ...overrides
  } as TeachingIpcRegistration
}

function previewEvent(id = 41) {
  return { sender: { id, isDestroyed: vi.fn(() => false), once: vi.fn(), on: vi.fn(), send: vi.fn() } }
}

const event = previewEvent()

function handler(channel: string) {
  const registered = electron.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
}

type NavigationStarted = (details: unknown, url: string, isInPlace: boolean, isMainFrame: boolean, frameProcessId: number, frameRoutingId: number) => void

function navigationStarted(senderEvent: ReturnType<typeof previewEvent>): NavigationStarted {
  const listener = senderEvent.sender.on.mock.calls.find(([name]) => name === 'did-start-navigation')?.[1]
  if (typeof listener !== 'function') throw new Error('Preview navigation listener was not registered.')
  return listener as NavigationStarted
}

function startNavigation(
  listener: NavigationStarted,
  input: { url: string; isMainFrame: boolean; frameProcessId: number; frameRoutingId: number; isSameDocument?: boolean }
): void {
  const isSameDocument = input.isSameDocument ?? false
  listener({
    url: input.url,
    isSameDocument,
    isMainFrame: input.isMainFrame,
    frame: { processId: input.frameProcessId, routingId: input.frameRoutingId }
  }, input.url, isSameDocument, input.isMainFrame, input.frameProcessId, input.frameRoutingId)
}


function requireGeneratedLesson(result: {
  disposition: string
  code?: string
  lesson?: unknown
}) {
  if ((result.disposition !== "succeeded" && result.disposition !== "reused") || !result.lesson) {
    throw new Error(`expected lesson success disposition, got ${result.disposition}${result.code ? `:${result.code}` : ""}`)
  }
  return result as typeof result & { lesson: NonNullable<typeof result.lesson> }
}

describe('Teaching IPC gateway', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.handle.mockClear()
    vi.clearAllMocks()
  })

  it('maps a channel through its parser, action, and reply', async () => {
    const createWorkspace = vi.fn().mockResolvedValue({ id: 'workspace-1' })
    registerTeachingIpcGateway(registration({ workspaceService: { createWorkspace } }))

    await expect(handler(teachingInvokeChannels.createWorkspace)(event, { name: 'Course', prompt: 'Teach algebra' }))
      .resolves.toEqual({ id: 'workspace-1' })
    expect(createWorkspace).toHaveBeenCalledTimes(1)
    expect(createWorkspace).toHaveBeenCalledWith({ name: 'Course', prompt: 'Teach algebra' })
  })

  it('routes the path-free workspace trust command through its exact parser', async () => {
    const setWorkspaceTrust = vi.fn().mockResolvedValue({ id: 'workspace-1', agentWorkspaceTrust: 'trusted' })
    registerTeachingIpcGateway(registration({ workspaceService: { setWorkspaceTrust } }))

    await expect(handler(teachingInvokeChannels.setWorkspaceTrust)(event, { workspaceId: 'workspace-1', trust: 'trusted' }))
      .resolves.toEqual({ id: 'workspace-1', agentWorkspaceTrust: 'trusted' })
    expect(setWorkspaceTrust).toHaveBeenCalledWith('workspace-1', 'trusted')

    await expect(handler(teachingInvokeChannels.setWorkspaceTrust)(event, {
      workspaceId: 'workspace-1', trust: 'trusted', rootPath: 'D:/must-not-cross-ipc'
    })).rejects.toThrow('IPC workspace trust payload must contain only "workspaceId" and "trust".')
    expect(setWorkspaceTrust).toHaveBeenCalledTimes(1)
  })

  it.runIf(process.platform !== 'win32')('returns exact aggregate-only memory diagnostics through the registered handler', async () => {
    const runtime = await runtimeScope.create('gateway-memory-diagnostics')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const sensitiveRoot = join(runtime.paths.appData, 'memory')
    const sensitiveContent = 'Memory content must never cross IPC.'
    const sensitiveHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const memory = await service.createMemory({
      content: `${sensitiveContent} ${sensitiveHash}`,
      scope: 'user'
    })
    registerTeachingIpcGateway(registration({ workspaceService: service }))

    const result = await handler(teachingInvokeChannels.getMemoryDiagnostics)(event)

    expect(result).toEqual({
      enabled: true,
      activeCount: 1,
      tombstoneCount: 0,
      lastInjectedCount: 0,
      legacyMigrationPreflight: {
        legacyFlatEligibleCount: 0,
        alreadyPartitionedCount: 1,
        blockedDuplicateCount: 0,
        blockedRecoveryIssueCount: 0,
        migrationReady: false
      }
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(sensitiveRoot)
    expect(serialized).not.toContain(memory.id)
    expect(serialized).not.toContain(sensitiveContent)
    expect(serialized).not.toContain(sensitiveHash)
  })

  it.runIf(process.platform === 'win32')('fails closed through the memory IPC boundary when the POSIX descriptor capability is unavailable', async () => {
    const runtime = await runtimeScope.create('gateway-windows-memory-unavailable')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    registerTeachingIpcGateway(registration({ workspaceService: service }))

    await expect(handler(teachingInvokeChannels.getMemoryDiagnostics)(event))
      .rejects.toThrow('Descriptor-relative contained directory access is unavailable on this platform.')
    await expect(handler(teachingInvokeChannels.createMemory)(event, {
      content: 'Must not fall back to unsafe pathname traversal.',
      scope: 'user'
    })).rejects.toThrow('Descriptor-relative contained directory access is unavailable on this platform.')
  })

  it('accepts memory scope roots only after registered-workspace resolution and strips renderer destination fields', async () => {
    const rootPath = await runtimeScope.create('gateway-memory-scope')
      .then((runtime) => join(runtime.paths.workspace, 'registered-course'))
    await mkdir(rootPath, { recursive: true })
    const createMemory = vi.fn().mockResolvedValue({ id: 'memory-1' })
    const getState = vi.fn().mockResolvedValue({ workspaces: [{ rootPath }] })
    registerTeachingIpcGateway(registration({ workspaceService: { getState, createMemory } }))

    await expect(handler(teachingInvokeChannels.createMemory)(event, {
      content: 'Remember this',
      scope: 'workspace',
      workspaceRoot: join(rootPath, 'lessons', '..'),
      tags: ['trusted'],
      confidence: 0.8,
      traceId: 'renderer-controlled-trace',
      destinationPath: '/private/renderer-controlled-memory',
      partitionKey: 'renderer-controlled'
    })).resolves.toEqual({ id: 'memory-1' })
    expect(createMemory).toHaveBeenCalledWith({
      content: 'Remember this',
      scope: 'workspace',
      workspaceRoot: rootPath,
      tags: ['trusted'],
      confidence: 0.8
    })

    await expect(handler(teachingInvokeChannels.createMemory)(event, {
      content: 'Not authorized', scope: 'workspace', workspaceRoot: resolve('/unregistered/course')
    })).rejects.toThrow('limited to registered teaching workspaces')
    expect(createMemory).toHaveBeenCalledTimes(1)
  })

  it('maps the narrow explicit per-id conversation projection command without renderer paths', async () => {
    const projectAgentConversationSummaries = vi.fn().mockResolvedValue({
      outcomes: [{ conversationId: 'chat-archived-1', status: 'generated' }]
    })
    registerTeachingIpcGateway(registration({ workspaceService: { projectAgentConversationSummaries } }))
    const request = { workspaceId: 'workspace-1', conversationIds: ['chat-archived-1'] }

    await expect(handler(teachingInvokeChannels.projectAgentConversationSummaries)(event, request)).resolves.toEqual({
      outcomes: [{ conversationId: 'chat-archived-1', status: 'generated' }]
    })
    expect(projectAgentConversationSummaries).toHaveBeenCalledWith(request)
    await expect(handler(teachingInvokeChannels.projectAgentConversationSummaries)(event, {
      ...request,
      rootPath: '/private/workspace'
    })).rejects.toThrow('IPC projection payload may contain only "workspaceId" and "conversationIds".')
    expect(projectAgentConversationSummaries).toHaveBeenCalledTimes(1)

    const preloadSource = await readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
    expect(preloadSource).toContain(
      'projectAgentConversationSummaries: (payload) => ipcRenderer.invoke(teachingInvokeChannels.projectAgentConversationSummaries, payload)'
    )
  })

  it('rejects invalid input before its action can run', async () => {
    const createWorkspace = vi.fn()
    registerTeachingIpcGateway(registration({ workspaceService: { createWorkspace } }))

    await expect(handler(teachingInvokeChannels.createWorkspace)(event, { name: 'Course', prompt: 42 }))
      .rejects.toThrow('IPC payload field "prompt" must be a string.')
    expect(createWorkspace).not.toHaveBeenCalled()
  })

  it('returns a typed invalid request without delegating malformed outcome commits', async () => {
    const commitLearningOutcome = vi.fn()
    registerTeachingIpcGateway(registration({ workspaceService: { commitLearningOutcome } }))

    const valid = {
      schemaVersion: 1,
      type: 'commit',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      operationId: 'operation-1'
    }
    const invalidPayloads: unknown[] = [
      null,
      [],
      {},
      { ...valid, schemaVersion: 2 },
      { ...valid, type: 'evaluate' },
      { ...valid, workspaceId: '' },
      { ...valid, workspaceId: '   ' },
      { ...valid, workspaceId: '../escape' },
      { ...valid, workspaceId: 'workspace path' },
      { ...valid, sessionId: 42 },
      { ...valid, sessionId: '../escape' },
      { ...valid, operationId: null },
      { ...valid, operationId: 'not valid' },
      { ...valid, operationId: 'o'.repeat(129) },
      {
        ...valid,
        path: 'C:/private',
        paths: ['C:/private'],
        evidence: ['private-evidence'],
        outcome: { kind: 'established' },
        record: { absolutePath: 'C:/private/record.md' },
        artifact: { contentSha256: 'secret' },
        evaluator: { diagnostics: ['secret'] },
        provider: { apiKey: 'secret' }
      }
    ]

    for (const payload of invalidPayloads) {
      await expect(handler(teachingInvokeChannels.commitLearningOutcome)(event, payload)).resolves.toEqual({
        status: 'non_retryable_failure', reason: 'invalid_request'
      })
    }
    expect(commitLearningOutcome).not.toHaveBeenCalled()
  })

  it('delegates an exact versioned outcome command and declares only the named preload channel', async () => {
    const commitLearningOutcome = vi.fn().mockResolvedValue({
      status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false
    })
    registerTeachingIpcGateway(registration({ workspaceService: { commitLearningOutcome } }))
    const request = {
      schemaVersion: 1 as const,
      type: 'commit' as const,
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      operationId: 'operation-1'
    }

    await expect(handler(teachingInvokeChannels.commitLearningOutcome)(event, request)).resolves.toEqual({
      status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false
    })
    expect(commitLearningOutcome).toHaveBeenCalledTimes(1)
    expect(commitLearningOutcome).toHaveBeenCalledWith(request)
    expect(Object.keys(commitLearningOutcome.mock.calls[0]![0])).toEqual([
      'schemaVersion', 'type', 'workspaceId', 'sessionId', 'operationId'
    ])
    expect(teachingInvokeChannels.commitLearningOutcome).toBe('teach:commit-learning-outcome')

    const preloadSource = await readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
    expect(preloadSource).toContain(
      'commitLearningOutcome: (request) => ipcRenderer.invoke(teachingInvokeChannels.commitLearningOutcome, request)'
    )
    expect(preloadSource).not.toMatch(/\binvoke\s*:/)
  })
  it('prefers turnCoordinatorHost for commitLearningOutcome when composed', async () => {
    const serviceCommit = vi.fn()
    const hostCommit = vi.fn().mockResolvedValue({
      status: 'committed', outcome: { kind: 'established' }, recordSaved: true
    })
    registerTeachingIpcGateway(registration({
      workspaceService: { commitLearningOutcome: serviceCommit },
      turnCoordinatorHost: { commitLearningOutcome: hostCommit, execute: vi.fn() }
    }))

    const request = {
      schemaVersion: 1,
      type: 'commit',
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      operationId: 'operation-host-path'
    }
    await expect(handler(teachingInvokeChannels.commitLearningOutcome)(event, request)).resolves.toEqual({
      status: 'committed', outcome: { kind: 'established' }, recordSaved: true
    })
    expect(hostCommit).toHaveBeenCalledTimes(1)
    expect(hostCommit).toHaveBeenCalledWith(request)
    expect(serviceCommit).not.toHaveBeenCalled()
  })

  it('accepts only a narrow preview intent before dispatching sender-bound recording', async () => {
    const recordPreviewLessonInteraction = vi.fn().mockResolvedValue({
      eventId: 'preview-open-001', sessionId: 'session-1', sequence: 1, duplicate: false
    })
    registerTeachingIpcGateway(registration({ workspaceService: { recordPreviewLessonInteraction } }))

    const intent = { eventId: 'preview-open-001', kind: 'lesson_opened', itemId: 'lesson-1' }
    await expect(handler(teachingInvokeChannels.recordPreviewLessonInteraction)(event, intent)).resolves.toEqual({
      eventId: 'preview-open-001', sessionId: 'session-1', sequence: 1, duplicate: false
    })
    expect(recordPreviewLessonInteraction).toHaveBeenCalledWith(41, intent)
    expect(event.sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function))
  })

  it('installs one numeric sender lifecycle cleanup across repeated preview calls and fails closed after destruction', async () => {
    const clearPreviewLessonBinding = vi.fn()
    const recordPreviewLessonInteraction = vi.fn().mockResolvedValue({
      eventId: 'preview-repeated', sessionId: 'session-1', sequence: 1, duplicate: false
    })
    const senderEvent = previewEvent(73)
    registerTeachingIpcGateway(registration({ workspaceService: { clearPreviewLessonBinding, recordPreviewLessonInteraction } }))

    for (let index = 0; index < 100; index += 1) {
      await handler(teachingInvokeChannels.recordPreviewLessonInteraction)(senderEvent, {
        eventId: `preview-repeated-${index}`, kind: 'lesson_opened', itemId: 'lesson-1'
      })
    }
    expect(senderEvent.sender.once).toHaveBeenCalledTimes(1)
    expect(senderEvent.sender.once).toHaveBeenCalledWith('destroyed', expect.any(Function))
    expect(senderEvent.sender.on).toHaveBeenCalledTimes(1)
    expect(senderEvent.sender.on).toHaveBeenCalledWith('did-start-navigation', expect.any(Function))

    const destroyed = senderEvent.sender.once.mock.calls[0]?.[1] as (() => void) | undefined
    destroyed?.()
    expect(clearPreviewLessonBinding).toHaveBeenCalledTimes(1)
    expect(clearPreviewLessonBinding).toHaveBeenLastCalledWith(73)

    senderEvent.sender.isDestroyed.mockReturnValue(true)
    await expect(handler(teachingInvokeChannels.recordPreviewLessonInteraction)(senderEvent, {
      eventId: 'preview-after-destroyed-001', kind: 'lesson_opened', itemId: 'lesson-1'
    })).rejects.toMatchObject({ code: 'sender_unavailable' })
    expect(recordPreviewLessonInteraction).toHaveBeenCalledTimes(100)
  })

  it.runIf(process.platform !== 'win32')('activates only a matching canonical preview child navigation, then revokes cross-document and main-frame navigation', async () => {
    const service = await createEvidenceService('gateway-preview-navigation')
    const workspace = (await service.createWorkspace({ name: 'Navigation evidence', prompt: 'Teach preview navigation revocation.' })).activeWorkspace!
    const lesson = requireGeneratedLesson(await service.generateLesson({
      workspaceId: workspace.id,
      actionId: randomUUID(),
      prompt: 'Explain why iframe document navigation revokes trusted authority.',
      messages: []
    })).lesson
    const senderEvent = previewEvent(86)
    registerTeachingIpcGateway(registration({ workspaceService: service }))
    const read = async () => handler(teachingInvokeChannels.readLesson)(senderEvent, {
      workspaceId: workspace.id,
      lessonPath: lesson.relativePath
    }) as Promise<{ url: string }>
    const record = (eventId: string) => handler(teachingInvokeChannels.recordPreviewLessonInteraction)(senderEvent, {
      eventId, kind: 'lesson_opened', itemId: lesson.id
    })

    const first = await read()
    const navigation = navigationStarted(senderEvent)
    await expect(record('preview-before-activation-001')).rejects.toMatchObject({ code: 'binding_unavailable' })

    // An arbitrary first child navigation cannot activate a pending canonical binding.
    startNavigation(navigation, {
      url: 'about:srcdoc', isMainFrame: false, frameProcessId: 610, frameRoutingId: 611
    })
    await expect(record('preview-after-noncanonical-initial-001')).rejects.toMatchObject({ code: 'binding_unavailable' })

    const activated = await read()
    startNavigation(navigation, {
      url: activated.url, isMainFrame: false, frameProcessId: 620, frameRoutingId: 621
    })
    await expect(record('preview-active-001')).resolves.toMatchObject({
      eventId: 'preview-active-001', sessionId: lesson.sessionId, sequence: 1, duplicate: false
    })
    expect(activated.url).toBe(first.url)
    const ledger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
    expect((await ledger.load(lesson.sessionId))?.events).toHaveLength(1)

    // The same iframe frame retains a WindowProxy, but a new generic document revokes its authority.
    startNavigation(navigation, {
      url: 'https://example.invalid/generic.html', isMainFrame: false, frameProcessId: 620, frameRoutingId: 621
    })
    await expect(record('preview-after-generic-child-navigation-001')).rejects.toMatchObject({ code: 'binding_unavailable' })
    expect((await ledger.load(lesson.sessionId))?.events).toHaveLength(1)

    const afterChildRevocation = await read()
    startNavigation(navigation, {
      url: afterChildRevocation.url, isMainFrame: false, frameProcessId: 630, frameRoutingId: 631
    })
    startNavigation(navigation, {
      url: 'studiumx://main-frame-navigation', isMainFrame: true, frameProcessId: 1, frameRoutingId: 2
    })
    await expect(record('preview-after-main-navigation-001')).rejects.toMatchObject({ code: 'binding_unavailable' })
    expect((await ledger.load(lesson.sessionId))?.events).toHaveLength(1)

    const rebound = await read()
    startNavigation(navigation, {
      url: rebound.url, isMainFrame: false, frameProcessId: 640, frameRoutingId: 641
    })
    await expect(record('preview-active-001')).rejects.toMatchObject({ code: 'identity_conflict' })
    await expect(record('preview-rebound-001')).resolves.toMatchObject({
      eventId: 'preview-rebound-001', sessionId: lesson.sessionId, sequence: 2, duplicate: false
    })
    expect((await ledger.load(lesson.sessionId))?.events).toHaveLength(2)
  })

  it('clears a sender binding when Electron destroys the preview sender', async () => {
    const clearPreviewLessonBinding = vi.fn()
    const recordPreviewLessonInteraction = vi.fn().mockResolvedValue({
      eventId: 'preview-destroy-001', sessionId: 'session-1', sequence: 1, duplicate: false
    })
    registerTeachingIpcGateway(registration({ workspaceService: { clearPreviewLessonBinding, recordPreviewLessonInteraction } }))

    await handler(teachingInvokeChannels.recordPreviewLessonInteraction)(event, {
      eventId: 'preview-destroy-001', kind: 'lesson_opened', itemId: 'lesson-1'
    })
    const destroyed = event.sender.once.mock.calls.find(([name]) => name === 'destroyed')?.[1] as (() => void) | undefined
    expect(destroyed).toBeTypeOf('function')
    destroyed?.()
    expect(clearPreviewLessonBinding).toHaveBeenCalledWith(41)
  })

  it('fails closed with a typed error when the preview sender is already destroyed', async () => {
    const recordPreviewLessonInteraction = vi.fn()
    registerTeachingIpcGateway(registration({ workspaceService: { recordPreviewLessonInteraction } }))
    event.sender.isDestroyed.mockReturnValueOnce(true)

    await expect(handler(teachingInvokeChannels.recordPreviewLessonInteraction)(event, {
      eventId: 'preview-destroyed-sender-001', kind: 'lesson_opened', itemId: 'lesson-1'
    })).rejects.toMatchObject({ code: 'sender_unavailable', message: 'Preview lesson interaction sender is unavailable.' })
    expect(recordPreviewLessonInteraction).not.toHaveBeenCalled()
  })

  it('rejects injected preview authority fields before recording and exposes no broad evidence channel', async () => {
    const recordPreviewLessonInteraction = vi.fn()
    registerTeachingIpcGateway(registration({ workspaceService: { recordPreviewLessonInteraction } }))

    await expect(handler(teachingInvokeChannels.recordPreviewLessonInteraction)(event, {
      eventId: 'preview-open-attack', kind: 'lesson_opened', itemId: 'lesson-1', workspaceId: 'forged-workspace'
    })).rejects.toThrow('unsupported fields')
    expect(recordPreviewLessonInteraction).not.toHaveBeenCalled()
    expect(Object.keys(teachingInvokeChannels)).toContain('recordPreviewLessonInteraction')
    expect(Object.keys(teachingInvokeChannels)).not.toContain('recordLessonInteraction')
  })

  it('invalidates conversation analytics after saving a conversation', async () => {
    const saved = {
      state: { workspaces: [] },
      conversation: { id: 'conversation-1' }
    }
    const saveAgentConversation = vi.fn().mockResolvedValue(saved)
    const invalidate = vi.fn()
    registerTeachingIpcGateway(registration({
      workspaceService: { saveAgentConversation },
      learningAnalyticsService: { invalidate }
    }))

    const payload = {
      workspaceId: 'workspace-1',
      mode: 'teaching',
      conversationId: null,
      expectedBranchRevision: 0,
      selectedLessonPath: null,
      selectedCourseRelativePath: null,
      turns: [
        { id: 'user-1', role: 'user', content: 'Hello', createdAt: '2026-07-14T00:00:00.000Z' },
        { id: 'assistant-1', role: 'assistant', content: 'Hi', createdAt: '2026-07-14T00:00:01.000Z' }
      ]
    }

    await expect(handler(teachingInvokeChannels.saveAgentConversation)(event, payload)).resolves.toEqual(saved)
    expect(saveAgentConversation).toHaveBeenCalledWith(payload)
    expect(invalidate).toHaveBeenCalledWith(['conversation'])
  })

  it('rejects malformed saved conversation turns before persistence', async () => {
    const saveAgentConversation = vi.fn()
    registerTeachingIpcGateway(registration({ workspaceService: { saveAgentConversation } }))

    const basePayload = {
      workspaceId: 'workspace-1',
      mode: 'teaching',
      conversationId: null,
      expectedBranchRevision: 0,
      selectedLessonPath: null,
      selectedCourseRelativePath: null
    }
    const userTurn = {
      id: 'user-1',
      role: 'user',
      content: 'Hello',
      createdAt: '2026-07-14T00:00:00.000Z'
    }

    const invalidPayloads = [
      {
        payload: { ...basePayload, turns: {} },
        message: 'IPC payload field "turns" must be an array.'
      },
      {
        payload: { ...basePayload, turns: [userTurn, { ...userTurn }] },
        message: 'duplicate turn id "user-1"'
      },
      {
        payload: { ...basePayload, turns: [{ ...userTurn, id: '../user-1' }] },
        message: 'must be a safe turn id'
      },
      {
        payload: {
          ...basePayload,
          turns: [{
            ...userTurn,
            metadata: {
              provenance: {
                kind: 'replayed',
                sourceConversationId: 'conversation-1',
                sourceBranchId: 'branch-1'
              }
            }
          }]
        },
        message: 'Replayed conversation turns require complete source provenance.'
      },
      {
        payload: {
          ...basePayload,
          turns: [{
            ...userTurn,
            metadata: {
              provenance: {
                kind: 'recovery_notice',
                sourceTurnId: 'turn-1',
                replayId: 'replay-1'
              }
            }
          }]
        },
        message: 'Recovery notices cannot claim replay provenance.'
      }
    ]

    for (const invalid of invalidPayloads) {
      await expect(handler(teachingInvokeChannels.saveAgentConversation)(event, invalid.payload))
        .rejects.toThrow(invalid.message)
    }
    expect(saveAgentConversation).not.toHaveBeenCalled()
  })

  it('routes conversation branch lifecycle operations through their bounded parsers', async () => {
    const readAgentConversationSessionTree = vi.fn().mockResolvedValue({ schemaVersion: 1, branches: [] })
    const openAgentConversationBranch = vi.fn().mockResolvedValue({ conversation: { id: 'branch-1' }, tree: {} })
    const forkAgentConversationBranch = vi.fn().mockResolvedValue({ conversation: { id: 'branch-2' }, tree: {} })
    const replayAgentConversationBranch = vi.fn().mockResolvedValue({ turns: [], replaySource: { replayId: 'replay-1' } })
    const updateAgentConversationBranchStatus = vi.fn().mockResolvedValue({ conversation: { id: 'branch-1' }, tree: {} })
    registerTeachingIpcGateway(registration({
      workspaceService: {
        readAgentConversationSessionTree,
        openAgentConversationBranch,
        forkAgentConversationBranch,
        replayAgentConversationBranch,
        updateAgentConversationBranchStatus
      }
    }))

    const branch = { workspaceId: 'workspace-1', conversationId: 'branch-1' }
    await handler(teachingInvokeChannels.readAgentConversationSessionTree)(event, branch)
    await handler(teachingInvokeChannels.openAgentConversationBranch)(event, branch)
    await handler(teachingInvokeChannels.forkAgentConversationBranch)(event, {
      ...branch,
      sourceTurnId: 'turn-1',
      title: '  Alternate path  ',
      expectedRevision: 2
    })
    await handler(teachingInvokeChannels.replayAgentConversationBranch)(event, {
      ...branch,
      sourceTurnId: 'turn-1'
    })
    await handler(teachingInvokeChannels.updateAgentConversationBranchStatus)(event, {
      ...branch,
      status: 'archived',
      expectedRevision: 2
    })

    expect(readAgentConversationSessionTree).toHaveBeenCalledWith(branch)
    expect(openAgentConversationBranch).toHaveBeenCalledWith(branch)
    expect(forkAgentConversationBranch).toHaveBeenCalledWith({
      ...branch,
      sourceTurnId: 'turn-1',
      title: 'Alternate path',
      expectedRevision: 2
    })
    expect(replayAgentConversationBranch).toHaveBeenCalledWith({ ...branch, sourceTurnId: 'turn-1' })
    expect(updateAgentConversationBranchStatus).toHaveBeenCalledWith({
      ...branch,
      status: 'archived',
      expectedRevision: 2
    })
  })

  it('rejects unsafe branch ids, oversized titles, invalid status, and invalid revisions before dispatch', async () => {
    const forkAgentConversationBranch = vi.fn()
    const updateAgentConversationBranchStatus = vi.fn()
    registerTeachingIpcGateway(registration({
      workspaceService: { forkAgentConversationBranch, updateAgentConversationBranchStatus }
    }))

    await expect(handler(teachingInvokeChannels.forkAgentConversationBranch)(event, {
      workspaceId: 'workspace-1',
      conversationId: '../branch-1'
    })).rejects.toThrow('conversationId')
    await expect(handler(teachingInvokeChannels.forkAgentConversationBranch)(event, {
      workspaceId: 'workspace-1',
      conversationId: 'branch-1',
      title: 'x'.repeat(241),
      expectedRevision: 2
    })).rejects.toThrow('title')
    await expect(handler(teachingInvokeChannels.forkAgentConversationBranch)(event, {
      workspaceId: 'workspace-1',
      conversationId: 'branch-1'
    })).rejects.toThrow('expectedRevision')
    await expect(handler(teachingInvokeChannels.updateAgentConversationBranchStatus)(event, {
      workspaceId: 'workspace-1',
      conversationId: 'branch-1',
      status: 'unknown'
    })).rejects.toThrow('status')
    await expect(handler(teachingInvokeChannels.updateAgentConversationBranchStatus)(event, {
      workspaceId: 'workspace-1',
      conversationId: 'branch-1',
      status: 'active',
      expectedRevision: -1
    })).rejects.toThrow('expectedRevision')

    expect(forkAgentConversationBranch).not.toHaveBeenCalled()
    expect(updateAgentConversationBranchStatus).not.toHaveBeenCalled()
  })

  it('routes archived-history queries through bounded parsers without publishing cleanup', async () => {
    const queryAgentArchivedHistory = vi.fn().mockResolvedValue({ items: [], truncated: false })
    registerTeachingIpcGateway(registration({ workspaceService: { queryAgentArchivedHistory } }))

    await handler(teachingInvokeChannels.queryAgentArchivedHistory)(event, {
      workspaceId: 'workspace-1',
      scope: 'all',
      conversationId: 'chat-1',
      types: ['tool_result'],
      limit: 10,
      maxBytes: 4096,
      maxExcerptBytes: 256
    })
    expect(queryAgentArchivedHistory).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1',
      scope: 'all',
      conversationId: 'chat-1',
      types: ['tool_result'],
      limit: 10
    }))

    expect('cleanupAgentArtifacts' in teachingInvokeChannels).toBe(false)
    expect(electron.handlers.has('teach:cleanup-agent-artifacts')).toBe(false)
    const preloadSource = await readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
    expect(preloadSource).not.toContain('cleanupAgentArtifacts')
    expect(preloadSource).not.toContain('cleanup-agent-artifacts')
  })

  it('registers every existing Teaching invoke channel exactly once', () => {
    registerTeachingIpcGateway(registration())

    const channels = Object.values(teachingInvokeChannels)
    expect(electron.handle).toHaveBeenCalledTimes(channels.length)
    expect(electron.handlers.size).toBe(channels.length)
    expect([...electron.handlers.keys()].sort()).toEqual([...channels].sort())
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('cancels an agent stream and cleans the active stream registration after completion', async () => {
    const agentChatStream = vi.fn((_payload, options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    registerTeachingIpcGateway(registration({ workspaceService: { agentChatStream } }))

    const stream = handler(teachingInvokeChannels.agentChatStream)(event, {
      streamId: 'stream-1',
      userInput: 'Hello',
      messages: []
    })
    await Promise.resolve()

    await expect(handler(teachingInvokeChannels.cancelAgentChatStream)(event, 'stream-1'))
      .resolves.toEqual({ canceled: true })
    await expect(stream).resolves.toEqual({ streamId: 'stream-1', canceled: true })
    await expect(handler(teachingInvokeChannels.cancelAgentChatStream)(event, 'stream-1'))
      .resolves.toEqual({ canceled: false })
    expect(pending.cancelStreamAskPending).toHaveBeenCalledWith('stream-1')
    expect(pending.cancelStreamToolPermissionPending).toHaveBeenCalledWith('stream-1')
  })
})

