import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'
import type { TeachingIpcRegistration } from '../../src/main/teaching-ipc-gateway'
import { teachingEventChannels, teachingInvokeChannels } from '../../src/shared/teaching-ipc-contract'
import { buildXmindZip, parseXmindZip } from '../../src/main/mindmap/xmind-file'
import { createMindMapStore, type MindMapStore } from '../../src/main/mindmap/mind-map-store'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'
import { strToU8, zipSync } from 'fflate'

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
  resolveToolPermissionPending: vi.fn(() => false)
}))

const mindMapGeneration = vi.hoisted(() => ({
  generateMindMap: vi.fn(),
  generateMindMapProposal: vi.fn(),
  cancelMindMapGeneration: vi.fn(),
  MindMapGenerationError: class MindMapGenerationError extends Error {
    readonly kind: string

    constructor(kind: string, message: string) {
      super(message)
      this.name = 'MindMapGenerationError'
      this.kind = kind
    }
  }
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(), fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: electron.handle },
  Notification: { isSupported: vi.fn() },
  shell: { openPath: vi.fn(), openExternal: vi.fn() }
}))
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {}
  }
}))
vi.mock('../../src/main/ai/ask-pending', () => ({
  cancelStreamAskPending: pending.cancelStreamAskPending,
  resolveAskPending: pending.resolveAskPending
}))
vi.mock('../../src/main/ai/tool-permission-pending', () => ({
  cancelStreamToolPermissionPending: pending.cancelStreamToolPermissionPending,
  resolveToolPermissionPending: pending.resolveToolPermissionPending
}))
vi.mock('../../src/main/mindmap/mind-map-generation', () => mindMapGeneration)

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

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function canonicalConversation(id: string, revision: number, turns: unknown[] = []) {
  return {
    id,
    title: id,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
    relativePath: `.agent-conversations/${id}.json`,
    absolutePath: `C:\workspace\${id}.json`,
    messageCount: turns.length,
    turns,
    branch: { revision, status: 'active' }
  }
}

function completedConversationTurn(turnId: string) {
  return {
    turns: [
      { id: `${turnId}-user`, role: 'user', content: 'host-owned input', createdAt: '2026-08-03T00:00:00.000Z' },
      { id: `${turnId}-assistant`, role: 'assistant', content: 'host-owned answer', createdAt: '2026-08-03T00:00:01.000Z' }
    ],
    finalText: 'host-owned answer',
    iterations: 1,
    toolsSupported: false,
    usage: { totalTokens: 0, promptTokens: 0, completionTokens: 0, provenance: 'unknown' }
  }
}

function submitFollowUp(overrides: Record<string, unknown> = {}) {
  return {
    target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-1' },
    clientRequestId: `request-${Math.random().toString(36).slice(2)}`,
    text: 'continue the lesson',
    mode: 'teaching',
    delivery: 'follow_up',
    ...overrides
  }
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

  it('rejects Ask answers that do not match a pending Ask or permission request', async () => {
    registerTeachingIpcGateway(registration())

    await expect(handler(teachingInvokeChannels.answerAgentChatTool)(event, {
      streamId: 'unknown-host-stream',
      toolCallId: 'unknown-tool-call',
      answers: [{ questionId: 'direction', selected: ['A'] }]
    })).rejects.toThrow('No pending Ask or tool permission request matches')
    expect(pending.resolveAskPending).toHaveBeenCalledWith('unknown-host-stream', 'unknown-tool-call', [{ questionId: 'direction', selected: ['A'] }])
    expect(pending.resolveToolPermissionPending).toHaveBeenCalledWith('unknown-host-stream', 'unknown-tool-call', [{ questionId: 'direction', selected: ['A'] }])
  })

  it.each([
    {
      name: 'XMind',
      channel: teachingInvokeChannels.importMindMapXmind,
      fileName: 'course.xmind',
      title: 'XMind Course',
      writeSource: async (sourcePath: string) => {
        const sourceDocument: MindMapDocument = {
          schemaVersion: 1,
          id: 'source-xmind',
          title: 'XMind Course',
          createdAt: '2026-08-09T00:00:00.000Z',
          updatedAt: '2026-08-09T00:00:00.000Z',
          sheets: [
            {
              id: 'sheet-xmind',
              title: 'XMind Course',
              structureClass: 'org.xmind.ui.logic.right',
              root: {
                id: 'root-xmind',
                title: 'Study roots',
                children: [{ id: 'topic-xmind', title: 'One branch', children: [] }]
              }
            }
          ]
        }
        await writeFile(sourcePath, buildXmindZip(sourceDocument))
      }
    },
    {
      name: 'Markdown',
      channel: teachingInvokeChannels.importMindMapMarkdown,
      fileName: 'course.md',
      title: 'Markdown Course',
      writeSource: (sourcePath: string) => writeFile(
        sourcePath,
        '# Markdown Course\n\n## Basics\n- Study roots\n  - One branch\n',
        'utf8'
      )
    },
    {
      name: 'OPML',
      channel: teachingInvokeChannels.importMindMapOpml,
      fileName: 'course.opml',
      title: 'OPML Course',
      writeSource: (sourcePath: string) => writeFile(
        sourcePath,
        '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n' +
          '<opml version=\"2.0\">\n' +
          '  <head><title>OPML Course</title></head>\n' +
          '  <body>\n' +
          '    <outline text=\"Basics\" _studiumx_sheet_id=\"sheet-opml\">\n' +
          '      <outline text=\"Study roots\" _studiumx_topic_id=\"root-opml\">\n' +
          '        <outline text=\"One branch\" _studiumx_topic_id=\"topic-opml\" />\n' +
          '      </outline>\n' +
          '    </outline>\n' +
          '  </body>\n' +
          '</opml>\n',
        'utf8'
      )
    }
  ])('durably commits $name imports through the gateway', async ({ name, channel, fileName, title, writeSource }) => {
    const runtime = await runtimeScope.create(`gateway-mind-map-${name.toLowerCase()}`)
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const sourcePath = join(rootPath, fileName)
    await writeSource(sourcePath)

    const getState = vi.fn().mockResolvedValue({ workspaces: [{ id: 'workspace-import', rootPath }] })
    registerTeachingIpcGateway(registration({ workspaceService: { getState } }))

    const result = await handler(channel)(event, { workspaceId: 'workspace-import', sourcePath }) as {
      id: string
      title: string
      schemaVersion: number
      revision: number
      sheets: unknown[]
      compatibilityReport?: unknown
    }

    expect(result).toMatchObject({
      id: expect.any(String),
      title,
      schemaVersion: 2,
      revision: 2,
      sheets: expect.any(Array)
    })
    if (name === 'XMind') {
      expect(result.compatibilityReport).toMatchObject({
        preserved: expect.any(Array),
        approximated: expect.any(Array),
        dropped: expect.any(Array),
        warnings: expect.any(Array)
      })
    }

    const durablePath = join(rootPath, 'mindmaps', `${result.id}.json`)
    const durable = JSON.parse(await readFile(durablePath, 'utf8')) as Record<string, unknown>
    expect(durable).toMatchObject({
      id: result.id,
      title,
      schemaVersion: 2,
      revision: 2
    })
    expect(durable).not.toHaveProperty('compatibilityReport')
    await expect(handler(teachingInvokeChannels.readMindMap)(event, {
      workspaceId: 'workspace-import',
      id: result.id
    })).resolves.toEqual(durable)
    await expect(readdir(join(rootPath, 'mindmaps'))).resolves.toEqual([`${result.id}.json`])
  })

  it.each([
    { name: 'XMind', channel: teachingInvokeChannels.importMindMapXmind, fileName: 'invalid.xmind', content: Buffer.from('not a ZIP archive') },
    { name: 'Markdown', channel: teachingInvokeChannels.importMindMapMarkdown, fileName: 'invalid.md', content: Buffer.from('plain prose is not a mind map\n', 'utf8') },
    { name: 'OPML', channel: teachingInvokeChannels.importMindMapOpml, fileName: 'invalid.opml', content: Buffer.from('<!DOCTYPE opml><opml />', 'utf8') }
  ])('does not leave a mind-map product when $name import fails', async ({ name, channel, fileName, content }) => {
    const runtime = await runtimeScope.create(`gateway-mind-map-failure-${name.toLowerCase()}`)
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const sourcePath = join(rootPath, fileName)
    await writeFile(sourcePath, content)

    const getState = vi.fn().mockResolvedValue({ workspaces: [{ id: 'workspace-import', rootPath }] })
    registerTeachingIpcGateway(registration({ workspaceService: { getState } }))

    await expect(handler(channel)(event, { workspaceId: 'workspace-import', sourcePath })).rejects.toThrow()
    await expect(readdir(join(rootPath, 'mindmaps'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes the created product and durable-write artifacts when an import update fails', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-post-create-failure')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const sourcePath = join(rootPath, 'course.md')
    await writeFile(sourcePath, '# Markdown Course\n\n## Basics\n- Study roots\n', 'utf8')

    const durableStore = createMindMapStore(rootPath)
    let createdId: string | undefined
    const remove = vi.fn(async (id: string) => durableStore.remove(id))
    const injectedUpdate: MindMapStore['update'] = async (id, doc) => {
      const mindMapsPath = join(rootPath, 'mindmaps')
      const content = JSON.stringify({ ...doc, id, revision: doc.revision + 1 })
      // Model the durable-write failure window after journal publication and
      // before target replacement. The gateway must remove both artifacts.
      await writeFile(join(mindMapsPath, `.${id}.json.journal`), content, 'utf8')
      await writeFile(join(mindMapsPath, `.${id}.json.tmp`), content, 'utf8')
      throw new Error('injected durable update failure')
    }
    const failingStore: MindMapStore = {
      ...durableStore,
      create: async (title) => {
        const created = await durableStore.create(title)
        createdId = created.id
        return created
      },
      update: injectedUpdate,
      remove
    }
    const mindMapStoreFactory = vi.fn(() => failingStore)
    const getState = vi.fn().mockResolvedValue({ workspaces: [{ id: 'workspace-import', rootPath }] })
    registerTeachingIpcGateway(registration({ workspaceService: { getState }, mindMapStoreFactory }))

    await expect(handler(teachingInvokeChannels.importMindMapMarkdown)(event, {
      workspaceId: 'workspace-import',
      sourcePath
    })).rejects.toThrow('injected durable update failure')

    expect(mindMapStoreFactory).toHaveBeenCalledWith(rootPath)
    expect(createdId).toEqual(expect.any(String))
    const id = createdId as string
    expect(remove).toHaveBeenCalledWith(id)
    await expect(readdir(join(rootPath, 'mindmaps'))).resolves.toEqual([])
    await expect(readFile(join(rootPath, 'mindmaps', `${id}.json`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(rootPath, 'mindmaps', `.${id}.json.journal`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(rootPath, 'mindmaps', `.${id}.json.tmp`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const freshStore = createMindMapStore(rootPath)
    await expect(freshStore.list()).resolves.toEqual([])
    await expect(freshStore.read(id)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('maps a channel through its parser, action, and reply', async () => {
    const createWorkspace = vi.fn().mockResolvedValue({ id: 'workspace-1' })
    registerTeachingIpcGateway(registration({ workspaceService: { createWorkspace } }))

    await expect(handler(teachingInvokeChannels.createWorkspace)(event, { name: 'Course', prompt: 'Teach algebra' }))
      .resolves.toEqual({ id: 'workspace-1' })
    expect(createWorkspace).toHaveBeenCalledTimes(1)
    expect(createWorkspace).toHaveBeenCalledWith({ name: 'Course', prompt: 'Teach algebra' })
  })

  it('projects host-owned formal admission on the skill catalog without changing catalog ownership', async () => {
    const listSkills = vi.fn().mockResolvedValue({
      skills: [
        {
          id: 'teach', name: 'Teach', description: 'Kernel', category: 'learning', icon: 'graduation-cap',
          author: 'StudiumX', command: '/teach', source: 'builtin', installed: true
        },
        {
          id: 'learning-assessor', name: 'Learning Assessor', description: 'Assess', category: 'learning', icon: 'sparkles',
          author: 'StudiumX', command: '/learning-assessor', source: 'builtin', installed: true
        },
        {
          id: 'personal-study-style', name: 'Personal Style', description: 'Personal', category: 'learning', icon: 'sparkles',
          author: 'You', command: '/personal-study-style', source: 'personal', installed: true
        }
      ]
    })
    registerTeachingIpcGateway(registration({ skillLibraryService: { listSkills } }))

    const result = await handler(teachingInvokeChannels.listSkills)(event) as {
      skills: Array<{ id: string; orchestration?: { formalTeachingEligible: boolean; selectionSurface: string; trustLevel: string } }>
    }

    expect(listSkills).toHaveBeenCalledTimes(1)
    expect(result.skills.find((skill) => skill.id === 'teach')?.orchestration).toMatchObject({
      formalTeachingEligible: false,
      selectionSurface: 'hidden',
      trustLevel: 'host_governed'
    })
    expect(result.skills.find((skill) => skill.id === 'learning-assessor')?.orchestration).toMatchObject({
      formalTeachingEligible: true,
      selectionSurface: 'default',
      trustLevel: 'host_governed'
    })
    expect(result.skills.find((skill) => skill.id === 'personal-study-style')?.orchestration).toMatchObject({
      formalTeachingEligible: false,
      selectionSurface: 'advanced',
      trustLevel: 'advisory_only'
    })
  })

  it('exposes only the active-workspace learner-safe presentation and rejects expanded action payloads', async () => {
    const snapshot = {
      schemaVersion: 1 as const,
      operationId: 'a'.repeat(64),
      revision: 7,
      nextStep: {
        action: 'contrast_and_retry' as const,
        label: '对照后再试一次',
        description: '先比较关键差异，再用新的提示重试。'
      }
    }
    const getState = vi.fn().mockResolvedValue({ activeWorkspace: { id: 'workspace-presentation-1' } })
    const getTeachingPresentation = vi.fn().mockResolvedValue(snapshot)
    const actOnTeachingPresentation = vi.fn().mockResolvedValue({ status: 'accepted' as const, snapshot })
    registerTeachingIpcGateway(registration({
      workspaceService: { getState },
      turnCoordinatorHost: { getTeachingPresentation, actOnTeachingPresentation }
    }))

    await expect(handler(teachingInvokeChannels.getTeachingPresentation)(event)).resolves.toEqual(snapshot)
    expect(getTeachingPresentation).toHaveBeenCalledWith('workspace-presentation-1')

    await expect(handler(teachingInvokeChannels.getTeachingPresentation)(event, {
      operationId: snapshot.operationId
    })).rejects.toThrow('Teaching presentation read does not accept a payload.')
    expect(getTeachingPresentation).toHaveBeenCalledTimes(1)

    await expect(handler(teachingInvokeChannels.actOnTeachingPresentation)(event, {
      operationId: snapshot.operationId,
      expectedRevision: snapshot.revision,
      action: 'contrast_and_retry'
    })).resolves.toEqual({ status: 'accepted', snapshot })
    expect(actOnTeachingPresentation).toHaveBeenCalledWith('workspace-presentation-1', {
      operationId: snapshot.operationId,
      expectedRevision: snapshot.revision,
      action: 'contrast_and_retry'
    })

    await expect(handler(teachingInvokeChannels.actOnTeachingPresentation)(event, {
      operationId: snapshot.operationId,
      expectedRevision: snapshot.revision,
      action: 'contrast_and_retry',
      prompt: 'must not cross the presentation boundary'
    })).rejects.toThrow('Teaching presentation action contains unsupported fields.')
    expect(actOnTeachingPresentation).toHaveBeenCalledTimes(1)

    await expect(handler(teachingInvokeChannels.actOnTeachingPresentation)(event, {
      operationId: snapshot.operationId,
      expectedRevision: snapshot.revision,
      action: 'review_due'
    })).resolves.toEqual({ status: 'accepted', snapshot })
    expect(actOnTeachingPresentation).toHaveBeenLastCalledWith('workspace-presentation-1', {
      operationId: snapshot.operationId,
      expectedRevision: snapshot.revision,
      action: 'review_due'
    })
  })

  it('validates canonical presentation output before exposing it to the renderer', async () => {
    const getState = vi.fn().mockResolvedValue({ activeWorkspace: { id: 'workspace-presentation-1' } })
    const validSnapshot = {
      schemaVersion: 1 as const,
      operationId: 'a'.repeat(64),
      revision: 7,
      nextStep: {
        action: 'contrast_and_retry' as const,
        label: '对照后再试一次',
        description: '先比较关键差异，再用新的提示重试。'
      }
    }
    const getTeachingPresentation = vi.fn().mockResolvedValue({ ...validSnapshot, reason: 'internal-only' })
    const actOnTeachingPresentation = vi.fn().mockResolvedValue({
      status: 'accepted',
      snapshot: { ...validSnapshot, prompt: 'must not reach renderer' }
    })
    registerTeachingIpcGateway(registration({
      workspaceService: { getState },
      turnCoordinatorHost: { getTeachingPresentation, actOnTeachingPresentation }
    }))

    await expect(handler(teachingInvokeChannels.getTeachingPresentation)(event)).resolves.toBeNull()
    await expect(handler(teachingInvokeChannels.actOnTeachingPresentation)(event, {
      operationId: validSnapshot.operationId,
      expectedRevision: validSnapshot.revision,
      action: 'contrast_and_retry'
    })).resolves.toEqual({ status: 'unavailable', snapshot: null })
  })

  it('allows only the fixed learner-safe due-review snapshot copy', async () => {
    const getState = vi.fn().mockResolvedValue({ activeWorkspace: { id: 'workspace-presentation-1' } })
    const snapshot = {
      schemaVersion: 1 as const,
      operationId: 'b'.repeat(64),
      revision: 8,
      nextStep: {
        action: 'review_due' as const,
        label: '开始复习' as const,
        description: '先完成一项到期复习，再继续新的学习内容。' as const
      }
    }
    const getTeachingPresentation = vi.fn().mockResolvedValue(snapshot)
    const actOnTeachingPresentation = vi.fn().mockResolvedValue({ status: 'accepted' as const, snapshot })
    registerTeachingIpcGateway(registration({
      workspaceService: { getState },
      turnCoordinatorHost: { getTeachingPresentation, actOnTeachingPresentation }
    }))

    await expect(handler(teachingInvokeChannels.getTeachingPresentation)(event)).resolves.toEqual(snapshot)
    await expect(handler(teachingInvokeChannels.actOnTeachingPresentation)(event, {
      operationId: snapshot.operationId,
      expectedRevision: snapshot.revision,
      action: 'review_due'
    })).resolves.toEqual({ status: 'accepted', snapshot })
  })

  it('fails closed when the canonical presentation reader or action host is unavailable', async () => {
    const getState = vi.fn().mockResolvedValue({ activeWorkspace: { id: 'workspace-presentation-1' } })
    const getTeachingPresentation = vi.fn().mockRejectedValue(new Error('/internal/canonical/path'))
    const actOnTeachingPresentation = vi.fn().mockRejectedValue(new Error('internal evaluator reason'))
    registerTeachingIpcGateway(registration({
      workspaceService: { getState },
      turnCoordinatorHost: { getTeachingPresentation, actOnTeachingPresentation }
    }))

    await expect(handler(teachingInvokeChannels.getTeachingPresentation)(event)).resolves.toBeNull()
    await expect(handler(teachingInvokeChannels.actOnTeachingPresentation)(event, {
      operationId: 'a'.repeat(64),
      expectedRevision: 7,
      action: 'contrast_and_retry'
    })).resolves.toEqual({ status: 'unavailable', snapshot: null })
  })

  it('fails closed when active-workspace lookup fails before a canonical presentation read or action', async () => {
    const getState = vi.fn().mockRejectedValue(new Error('/private/workspace/root'))
    const getTeachingPresentation = vi.fn()
    const actOnTeachingPresentation = vi.fn()
    registerTeachingIpcGateway(registration({
      workspaceService: { getState },
      turnCoordinatorHost: { getTeachingPresentation, actOnTeachingPresentation }
    }))

    await expect(handler(teachingInvokeChannels.getTeachingPresentation)(event)).resolves.toBeNull()
    await expect(handler(teachingInvokeChannels.actOnTeachingPresentation)(event, {
      operationId: 'a'.repeat(64),
      expectedRevision: 7,
      action: 'contrast_and_retry'
    })).resolves.toEqual({ status: 'unavailable', snapshot: null })
    expect(getTeachingPresentation).not.toHaveBeenCalled()
    expect(actOnTeachingPresentation).not.toHaveBeenCalled()
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
      platformIoProfile: 'pathname_default',
      platformCapabilityCode: 'ok',
      platformCapabilityMessageKey: 'platformCapability.pathnameDefault',
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

  it('uses the pathname_default memory profile through the memory IPC boundary', async () => {
    const runtime = await runtimeScope.create('gateway-windows-memory-direct-path')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    registerTeachingIpcGateway(registration({ workspaceService: service }))

    const diagnostics = await handler(teachingInvokeChannels.getMemoryDiagnostics)(event)
    expect(diagnostics).toMatchObject({
      platformIoProfile: 'pathname_default',
      platformCapabilityCode: 'ok'
    })
    const created = await handler(teachingInvokeChannels.createMemory)(event, {
      content: 'Pathname-default memory write under trusted-root profile.',
      scope: 'user'
    })
    expect(created).toMatchObject({
      content: 'Pathname-default memory write under trusted-root profile.',
      scope: 'user'
    })
    expect(created.id).toEqual(expect.any(String))
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

  it('returns the XMind compatibility report alongside legacy document fields', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-xmind-report')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const sourcePath = join(rootPath, 'incoming.xmind')
    await writeFile(
      sourcePath,
      zipSync({
        'content.json': strToU8(
          JSON.stringify([
            {
              class: 'sheet',
              id: 'sheet-report',
              title: 'Reported',
              rootTopic: {
                class: 'topic',
                id: 'root-report',
                title: 'Root',
                children: {
                  attached: [
                    {
                      class: 'topic',
                      id: 'child-report',
                      title: 'Child'
                    }
                  ]
                },
                style: { id: 'foreign-style' }
              },
              relationships: [
                {
                  class: 'relationship',
                  id: 'relationship-report',
                  end1: { id: 'root-report' },
                  end2: { id: 'child-report' },
                  title: 'Connect'
                }
              ]
            }
          ])
        )
      })
    )
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-1', rootPath }]
    })
    registerTeachingIpcGateway(registration({ workspaceService: { getState } }))

    const result = await handler(teachingInvokeChannels.importMindMapXmind)(event, {
      workspaceId: 'workspace-1',
      sourcePath
    })

    expect(result).toMatchObject({
      schemaVersion: 2,
      title: 'Reported',
      sheets: expect.arrayContaining([
        expect.objectContaining({
          title: 'Reported',
          elements: expect.arrayContaining([
            {
              id: 'relationship-report',
              type: 'relationship',
              from: 'root-report',
              to: 'child-report',
              label: 'Connect'
            }
          ])
        })
      ]),
      compatibilityReport: {
        approximated: expect.any(Array),
        preserved: expect.arrayContaining([
          expect.objectContaining({
            path: 'sheets[].relationships',
            count: 1
          })
        ]),
        dropped: expect.arrayContaining([
          expect.objectContaining({ path: 'topics[].style.id', count: 1 })
        ]),
        warnings: expect.any(Array)
      }
    })
    expect((result as { compatibilityReport: unknown }).compatibilityReport).not.toHaveProperty(
      'sourcePath'
    )

    const imported = result as {
      id: string
      revision: number
      sheets: Array<{ elements?: unknown[] }>
    }
    const durablePath = join(rootPath, 'mindmaps', `${imported.id}.json`)
    const durable = JSON.parse(await readFile(durablePath, 'utf8')) as {
      sheets: Array<{ elements?: unknown[] }>
    }
    expect(durable.sheets[0]?.elements).toEqual(imported.sheets[0]?.elements)

    const exported = await handler(teachingInvokeChannels.exportMindMapXmind)(event, {
      workspaceId: 'workspace-1',
      id: imported.id,
      destinationDirectory: join(rootPath, 'exports'),
      snapshotRevision: imported.revision,
      expectedRevision: imported.revision,
      pendingWrites: false,
      dirty: false
    }) as { path: string }
    const exportedDocument = parseXmindZip(await readFile(exported.path))
    expect(exportedDocument.sheets[0]?.relationships).toEqual([
      {
        id: 'relationship-report',
        from: 'root-report',
        to: 'child-report',
        label: 'Connect'
      }
    ])
  })

  it('flushes before XMind export and refuses an unacknowledged renderer snapshot', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-xmind-export-readiness')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const store = createMindMapStore(rootPath)
    const created = await store.create('Readiness')
    const flush = vi.spyOn(store, 'flush')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-xmind-export', rootPath }]
    })
    registerTeachingIpcGateway(
      registration({
        workspaceService: { getState },
        mindMapStoreFactory: () => store
      })
    )

    await expect(
      handler(teachingInvokeChannels.exportMindMapXmind)(event, {
        workspaceId: 'workspace-xmind-export',
        id: created.id,
        destinationDirectory: join(rootPath, 'exports'),
        snapshotRevision: created.revision,
        expectedRevision: created.revision,
        pendingWrites: false,
        dirty: true
      })
    ).rejects.toThrow('Mind map XMind export refused: dirty')
    expect(flush).toHaveBeenCalledWith(created.id)
  })

  it('imports one embedded XMind PNG into workspace assets and persists only safe metadata', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-xmind-embedded-asset')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const sourcePath = join(rootPath, 'embedded.xmind')
    const imageBytes = Buffer.from([137, 80, 78, 71, 9, 8, 7])
    await writeFile(
      sourcePath,
      zipSync({
        'content.json': strToU8(
          JSON.stringify([
            {
              class: 'sheet',
              id: 'sheet-asset',
              title: 'Embedded image',
              rootTopic: {
                class: 'topic',
                id: 'root-asset',
                title: 'Root',
                image: { src: 'attachments/diagram.png' },
                attachment: { src: 'attachments/document.pdf' },
                children: {
                  attached: [
                    {
                      class: 'topic',
                      id: 'child-asset',
                      title: 'Second image',
                      image: { src: 'attachments/second.png' }
                    }
                  ]
                }
              }
            }
          ])
        ),
        'attachments/diagram.png': imageBytes,
        'attachments/second.png': new Uint8Array([1, 2]),
        'attachments/document.pdf': new Uint8Array([3, 4])
      })
    )
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-asset', rootPath }]
    })
    registerTeachingIpcGateway(registration({ workspaceService: { getState } }))

    const result = await handler(teachingInvokeChannels.importMindMapXmind)(event, {
      workspaceId: 'workspace-asset',
      sourcePath
    }) as {
      id: string
      sheets: Array<{ root: { assetIds?: string[] } }>
      assets: Array<{ id: string; fileName: string; mimeType?: string }>
      compatibilityReport: {
        approximated: unknown[]
        dropped: unknown[]
        warnings: unknown[]
      }
    }

    expect(result.sheets[0]?.root.assetIds).toHaveLength(1)
    expect(result.assets).toHaveLength(1)
    const asset = result.assets[0]!
    expect(asset.id).toMatch(/^xmind-[a-f0-9]{32}$/)
    expect(asset).toMatchObject({ fileName: 'diagram.png', mimeType: 'image/png' })
    expect(asset).not.toHaveProperty('absolutePath')
    expect(result.compatibilityReport.approximated).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'topics[].image', count: 1 })])
    )
    expect(result.compatibilityReport.dropped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'topics[].image' }),
        expect.objectContaining({ path: 'topics[].attachment' })
      ])
    )
    expect(result.compatibilityReport.warnings).toEqual(expect.any(Array))

    const durablePath = join(rootPath, 'mindmaps', `${result.id}.json`)
    const durable = JSON.parse(await readFile(durablePath, 'utf8')) as {
      assets: typeof result.assets
      sheets: typeof result.sheets
    }
    expect(durable.assets).toEqual(result.assets)
    expect(JSON.stringify(durable)).not.toContain(sourcePath)
    expect(JSON.stringify(durable)).not.toContain('attachments/')
    await expect(
      readFile(join(rootPath, 'mindmap-assets', asset.id, asset.fileName))
    ).resolves.toEqual(imageBytes)
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

  it('registers every non-MCP Teaching invoke channel exactly once', () => {
    registerTeachingIpcGateway(registration())

    // ADR-0128/0142: teach:mcp-* invoke channels are owned by the dedicated
    // registerMcpIpcGateway registrar. The access-token channel is registered
    // in the main-process bootstrap because it configures that gateway.
    const channels = Object.values(teachingInvokeChannels)
    const gatewayChannels = channels.filter((channel) =>
      !channel.startsWith('teach:mcp-') && channel !== teachingInvokeChannels.mcpSetStudiumxAccessToken
    )
    expect(electron.handle).toHaveBeenCalledTimes(gatewayChannels.length)
    expect(electron.handlers.size).toBe(gatewayChannels.length)
    expect([...electron.handlers.keys()].sort()).toEqual([...gatewayChannels].sort())
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

  it('rejects a duplicate active stream id but permits an explicit retry after the first stream settles', async () => {
    const agentChatStream = vi.fn((_payload, options: { signal: AbortSignal }) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    registerTeachingIpcGateway(registration({ workspaceService: { agentChatStream } }))

    const first = handler(teachingInvokeChannels.agentChatStream)(event, {
      streamId: 'retryable-stream', userInput: 'Hello', messages: []
    })
    await Promise.resolve()

    await expect(handler(teachingInvokeChannels.agentChatStream)(event, {
      streamId: 'retryable-stream', userInput: 'Duplicate', messages: []
    })).resolves.toEqual({
      streamId: 'retryable-stream',
      error: true,
      message: 'Agent chat stream id is already active.'
    })
    expect(agentChatStream).toHaveBeenCalledTimes(1)

    await expect(handler(teachingInvokeChannels.cancelAgentChatStream)(event, 'retryable-stream'))
      .resolves.toEqual({ canceled: true })
    await expect(first).resolves.toEqual({ streamId: 'retryable-stream', canceled: true })

    const retry = handler(teachingInvokeChannels.agentChatStream)(event, {
      streamId: 'retryable-stream', userInput: 'Retry', messages: []
    })
    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(2))
    await handler(teachingInvokeChannels.cancelAgentChatStream)(event, 'retryable-stream')
    await expect(retry).resolves.toEqual({ streamId: 'retryable-stream', canceled: true })
  })

  it('serializes same-lane host follow-ups and refreshes canonical revision only after settlement', async () => {
    const firstRuntime = deferred<ReturnType<typeof completedConversationTurn>>()
    const firstSave = deferred<{ state: { workspaces: [] }; conversation: { id: string } }>()
    const secondRuntime = deferred<ReturnType<typeof completedConversationTurn>>()
    const readAgentConversation = vi.fn()
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 1))
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 2, completedConversationTurn('first').turns))
    const agentChatStream = vi.fn()
      .mockImplementationOnce(() => firstRuntime.promise)
      .mockImplementationOnce(() => secondRuntime.promise)
    const saveAgentConversation = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValue({ state: { workspaces: [] }, conversation: { id: 'conversation-1' } })
    const invalidate = vi.fn()
    registerTeachingIpcGateway(registration({
      workspaceService: { readAgentConversation, agentChatStream, saveAgentConversation },
      learningAnalyticsService: { invalidate }
    }))

    const first = await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'fifo-1' })) as { code: string }
    const second = await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'fifo-2' })) as { code: string }
    expect(first.code).toBe('started')
    expect(second.code).toBe('queued')
    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(1))

    firstRuntime.resolve(completedConversationTurn('first'))
    await vi.waitFor(() => expect(saveAgentConversation).toHaveBeenCalledTimes(1))
    expect(agentChatStream).toHaveBeenCalledTimes(1)
    firstSave.resolve({ state: { workspaces: [] }, conversation: { id: 'conversation-1' } })

    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(2))
    expect(agentChatStream.mock.calls[0][0]).toMatchObject({ expectedBranchRevision: 1, conversationId: 'conversation-1' })
    expect(agentChatStream.mock.calls[1][0]).toMatchObject({ expectedBranchRevision: 2, conversationId: 'conversation-1' })
    expect(invalidate).toHaveBeenCalledWith(['conversation'])
    secondRuntime.resolve(completedConversationTurn('second'))
  })

  it('routes each host lane stream to its submitting renderer and announces queued activation only to that owner', async () => {
    const firstEvent = previewEvent(101)
    const queuedEvent = previewEvent(102)
    const firstRuntime = deferred<ReturnType<typeof completedConversationTurn>>()
    const secondRuntime = deferred<ReturnType<typeof completedConversationTurn>>()
    const firstResult = completedConversationTurn('owner-first')
    const secondDelta = completedConversationTurn('owner-second')
    const secondResult = { ...secondDelta, turns: [...firstResult.turns, ...secondDelta.turns] }
    const readAgentConversation = vi.fn()
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 1))
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 2, firstResult.turns))
    const agentChatStream = vi.fn()
      .mockImplementationOnce((payload: { streamId: string }, stream: { onChunk: (chunk: unknown) => void; onRealtimeEvent: (event: unknown) => void }) => {
        stream.onChunk({ streamId: payload.streamId, delta: 'first-owner-only' })
        stream.onRealtimeEvent({ sequence: 1, streamId: payload.streamId, kind: 'chunk', createdAt: '2026-08-03T00:00:00.000Z', payload: { streamId: payload.streamId, delta: 'first-owner-only' } })
        return firstRuntime.promise
      })
      .mockImplementationOnce((payload: { streamId: string }, stream: { onChunk: (chunk: unknown) => void; onRealtimeEvent: (event: unknown) => void }) => {
        stream.onChunk({ streamId: payload.streamId, delta: 'queued-owner-only' })
        stream.onRealtimeEvent({ sequence: 1, streamId: payload.streamId, kind: 'chunk', createdAt: '2026-08-03T00:00:02.000Z', payload: { streamId: payload.streamId, delta: 'queued-owner-only' } })
        return secondRuntime.promise
      })
    const saveAgentConversation = vi.fn().mockResolvedValue({
      state: { workspaces: [] }, conversation: { id: 'conversation-1' }
    })
    registerTeachingIpcGateway(registration({
      workspaceService: { readAgentConversation, agentChatStream, saveAgentConversation }
    }))

    const first = await handler(teachingInvokeChannels.submitConversationTurn)(firstEvent, submitFollowUp({ clientRequestId: 'owner-first' })) as { code: string; streamId: string }
    const queued = await handler(teachingInvokeChannels.submitConversationTurn)(queuedEvent, submitFollowUp({ clientRequestId: 'owner-queued' })) as { code: string; queuePosition?: number; streamId?: string }
    expect(first).toMatchObject({ code: 'started' })
    expect(queued).toMatchObject({ code: 'queued', queuePosition: 1 })
    expect(queued.streamId).toBeUndefined()
    const firstStreamId = first.streamId
    await vi.waitFor(() => expect(firstEvent.sender.send).toHaveBeenCalledWith(
      teachingEventChannels.agentChatChunk,
      expect.objectContaining({ streamId: firstStreamId })
    ))
    expect(queuedEvent.sender.send).not.toHaveBeenCalledWith(
      teachingEventChannels.agentChatChunk,
      expect.objectContaining({ streamId: firstStreamId })
    )

    firstRuntime.resolve(firstResult)
    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(2))
    const queuedStreamId = (agentChatStream.mock.calls[1]![0] as { streamId: string }).streamId
    expect(queuedEvent.sender.send).toHaveBeenCalledWith(
      teachingEventChannels.agentChatEvent,
      expect.objectContaining({
        kind: 'conversation_turn_started',
        streamId: queuedStreamId,
        activeTurnId: expect.any(String),
        clientRequestId: 'owner-queued',
        conversationId: 'conversation-1'
      })
    )
    expect(firstEvent.sender.send).not.toHaveBeenCalledWith(
      teachingEventChannels.agentChatEvent,
      expect.objectContaining({ kind: 'conversation_turn_started', streamId: queuedStreamId })
    )
    expect(queuedEvent.sender.send).toHaveBeenCalledWith(
      teachingEventChannels.agentChatChunk,
      expect.objectContaining({ streamId: queuedStreamId })
    )
    expect(firstEvent.sender.send).not.toHaveBeenCalledWith(
      teachingEventChannels.agentChatChunk,
      expect.objectContaining({ streamId: queuedStreamId })
    )

    secondRuntime.resolve(secondResult)
  })

  it('starts separate host lanes independently', async () => {
    const firstSave = deferred<unknown>()
    const secondSave = deferred<unknown>()
    const readAgentConversation = vi.fn()
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 1))
      .mockResolvedValueOnce(canonicalConversation('conversation-2', 1))
    const agentChatStream = vi.fn()
      .mockResolvedValueOnce(completedConversationTurn('one'))
      .mockResolvedValueOnce(completedConversationTurn('two'))
    const saveAgentConversation = vi.fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)
    registerTeachingIpcGateway(registration({ workspaceService: { readAgentConversation, agentChatStream, saveAgentConversation } }))

    await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'isolated-1' }))
    await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({
      clientRequestId: 'isolated-2',
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-2' }
    }))

    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(2))
    expect(agentChatStream.mock.calls.map(([payload]) => payload.conversationId)).toEqual(['conversation-1', 'conversation-2'])
  })

  it('cancels only the exact host-bound active stream and clears only its lane queue', async () => {
    const signals: AbortSignal[] = []
    const agentChatStream = vi.fn((_payload, stream: { signal: AbortSignal }) => {
      signals.push(stream.signal)
      return new Promise((_, reject) => stream.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
    })
    const readAgentConversation = vi.fn()
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 1))
      .mockResolvedValueOnce(canonicalConversation('conversation-2', 1))
    registerTeachingIpcGateway(registration({ workspaceService: { readAgentConversation, agentChatStream } }))

    const first = await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'cancel-1' })) as { code: string; streamId: string }
    await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'cancel-queued' }))
    const other = await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({
      clientRequestId: 'cancel-other',
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-2' }
    })) as { code: string; streamId: string }
    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(2))

    await expect(handler(teachingInvokeChannels.cancelConversationTurn)(event, {
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-1' },
      clientRequestId: 'cancel-public-1',
      expectedActiveTurnId: first.activeTurnId
    })).resolves.toEqual({
      code: 'cancelled',
      cancelledActiveTurnId: first.activeTurnId,
      clearedQueuedCount: 1
    })
    await vi.waitFor(() => expect(signals[0].aborted).toBe(true))
    expect(signals[1].aborted).toBe(false)
    await Promise.resolve()
    // lane.cancel clears only conversation-1's FIFO; it cannot promote its queued turn.
    expect(agentChatStream).toHaveBeenCalledTimes(2)
    await expect(handler(teachingInvokeChannels.cancelConversationTurn)(event, {
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-2' },
      clientRequestId: 'cancel-public-2',
      expectedActiveTurnId: other.activeTurnId
    })).resolves.toEqual(expect.objectContaining({ code: 'cancelled' }))
  })

  it('returns exact active-turn refresh without aborting a host-lane binding', async () => {
    const signal = deferred<void>()
    const agentChatStream = vi.fn((_payload, stream: { signal: AbortSignal }) => new Promise((_, reject) => {
      stream.signal.addEventListener('abort', () => {
        signal.resolve()
        reject(new Error('aborted'))
      }, { once: true })
    }))
    const readAgentConversation = vi.fn().mockResolvedValue(canonicalConversation('conversation-1', 1))
    registerTeachingIpcGateway(registration({ workspaceService: { readAgentConversation, agentChatStream } }))

    const started = await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'cancel-mismatch' })) as {
      code: string; activeTurnId: string
    }
    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(1))

    await expect(handler(teachingInvokeChannels.cancelConversationTurn)(event, {
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-1' },
      clientRequestId: 'cancel-mismatch-attempt',
      expectedActiveTurnId: 'different-turn'
    })).resolves.toEqual({ code: 'refresh_required', reason: 'active_turn_mismatch' })
    expect(started.activeTurnId).not.toBe('different-turn')

    // Clean up the live host lane through the public exact capability.
    await handler(teachingInvokeChannels.cancelConversationTurn)(event, {
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-1' },
      clientRequestId: 'cancel-mismatch-cleanup',
      expectedActiveTurnId: started.activeTurnId
    })
    await signal.promise
  })

  it('rejects legacy steer and follow-up against a host-lane stream without driving its facade', async () => {
    const agentChatStream = vi.fn((_payload, stream: { signal: AbortSignal }) => new Promise((_, reject) => {
      stream.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const readAgentConversation = vi.fn().mockResolvedValue(canonicalConversation('conversation-1', 1))
    registerTeachingIpcGateway(registration({ workspaceService: { readAgentConversation, agentChatStream } }))

    const started = await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'legacy-isolation' })) as {
      code: string; streamId: string; activeTurnId: string
    }
    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(1))

    await expect(handler(teachingInvokeChannels.steerAgentChatStream)(event, {
      streamId: started.streamId,
      text: 'legacy steer must not reach host facade'
    })).resolves.toEqual({ ok: false, disposition: 'no_active_session', reason: 'no_active_session' })
    await expect(handler(teachingInvokeChannels.followUpAgentChatStream)(event, {
      streamId: started.streamId,
      text: 'legacy follow-up must not reach host facade'
    })).resolves.toEqual({ ok: false, disposition: 'no_active_session', reason: 'no_active_session' })
    // Legacy calls did not prompt/steer/follow-up through the attached facade.
    expect(agentChatStream).toHaveBeenCalledTimes(1)

    await handler(teachingInvokeChannels.cancelConversationTurn)(event, {
      target: { kind: 'canonical', workspaceId: 'workspace-1', scope: 'workspace', conversationId: 'conversation-1' },
      clientRequestId: 'legacy-isolation-cleanup',
      expectedActiveTurnId: started.activeTurnId
    })
  })

  it('releases a failed host reservation so its queued FIFO successor can start', async () => {
    const readAgentConversation = vi.fn()
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 1))
      .mockResolvedValueOnce(canonicalConversation('conversation-1', 2))
    const agentChatStream = vi.fn()
      .mockRejectedValueOnce(new Error('model unavailable'))
      .mockResolvedValueOnce(completedConversationTurn('recovered'))
    const saveAgentConversation = vi.fn().mockResolvedValue({ state: { workspaces: [] }, conversation: { id: 'conversation-1' } })
    registerTeachingIpcGateway(registration({ workspaceService: { readAgentConversation, agentChatStream, saveAgentConversation } }))

    await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'failure-1' }))
    await handler(teachingInvokeChannels.submitConversationTurn)(event, submitFollowUp({ clientRequestId: 'failure-2' }))

    await vi.waitFor(() => expect(agentChatStream).toHaveBeenCalledTimes(2))
    expect(saveAgentConversation).toHaveBeenCalledTimes(1)
    expect(agentChatStream.mock.calls[1][0]).toMatchObject({ expectedBranchRevision: 2 })
  })

  it('publishes an error terminal when a reserved host turn fails before its runtime event bus is ready', async () => {
    const senderEvent = previewEvent(701)
    const readAgentConversation = vi.fn().mockResolvedValue(canonicalConversation('conversation-1', 1))
    const agentChatStream = vi.fn().mockRejectedValue(new Error('Agent state record already exists.'))
    registerTeachingIpcGateway(registration({ workspaceService: { readAgentConversation, agentChatStream } }))

    const disposition = await handler(teachingInvokeChannels.submitConversationTurn)(
      senderEvent,
      submitFollowUp({ clientRequestId: 'pre-runtime-failure' })
    ) as { code: string; streamId: string }

    expect(disposition.code).toBe('started')
    await vi.waitFor(() => expect(senderEvent.sender.send).toHaveBeenCalledWith(
      teachingEventChannels.agentChatEvent,
      expect.objectContaining({
        streamId: disposition.streamId,
        kind: 'terminal',
        outcome: 'error'
      })
    ))
  })


  it('settles accepted AI proposal items atomically through the reducer and CAS store', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-proposal-apply')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-proposal', rootPath }]
    })
    const mindMapStoreFactory = vi.fn(() => store)
    registerTeachingIpcGateway(
      registration({ workspaceService: { getState }, mindMapStoreFactory })
    )

    const proposal = {
      schemaVersion: 1 as const,
      proposalId: 'proposal-1',
      scope: 'sheet' as const,
      items: [
        {
          id: 'rename-document',
          command: { type: 'document.rename' as const, title: 'Accepted title' }
        },
        {
          id: 'rename-missing-sheet',
          command: {
            type: 'sheet.rename' as const,
            sheetId: 'missing-sheet',
            title: 'Rejected title'
          }
        }
      ]
    }

    const result = await handler(teachingInvokeChannels.applyMindMapProposal)(event, {
      workspaceId: 'workspace-proposal',
      id: created.id,
      expectedRevision: created.revision,
      proposal,
      decisions: {
        'rename-document': 'accept',
        'rename-missing-sheet': 'reject'
      }
    }) as {
      ok: boolean
      proposalId: string
      document: { id: string; title: string; revision: number }
      acceptedIds: string[]
      rejectedIds: string[]
      command: { type: string } | null
      inverse: { type: string } | null
    }

    expect(result).toMatchObject({
      ok: true,
      proposalId: 'proposal-1',
      document: {
        id: created.id,
        title: 'Accepted title',
        revision: created.revision + 1
      },
      acceptedIds: ['rename-document'],
      rejectedIds: ['rename-missing-sheet'],
      command: { type: 'transaction' }
    })
    expect(result.inverse).toEqual(expect.objectContaining({ type: 'transaction' }))
    await expect(store.read(created.id)).resolves.toMatchObject({
      title: 'Accepted title',
      revision: created.revision + 1
    })
  })

  it('generates a provider proposal from the canonical snapshot without persisting it', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-proposal-generate')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-proposal', rootPath }]
    })
    const loadedSettings = defaultSettings(rootPath)
    const load = vi.fn().mockResolvedValue(loadedSettings)
    const proposal = {
      schemaVersion: 1 as const,
      proposalId: 'proposal-generated',
      scope: 'sheet' as const,
      items: [
        {
          id: 'rename-document',
          command: { type: 'document.rename' as const, title: 'Suggested title' }
        }
      ]
    }
    mindMapGeneration.generateMindMapProposal.mockResolvedValueOnce(proposal)
    registerTeachingIpcGateway(
      registration({
        workspaceService: { getState },
        settingsService: { load },
        mindMapStoreFactory: () => store
      })
    )

    const result = await handler(teachingInvokeChannels.generateMindMapProposal)(event, {
      workspaceId: 'workspace-proposal',
      id: created.id,
      scope: 'sheet',
      sheetId: created.sheets[0]!.id,
      selectedTopicIds: [],
      sourceRefs: [],
      prompt: 'Suggest a concise title.'
    }) as {
      documentId: string
      revision: number
      request: {
        schemaVersion: number
        scope: string
        documentId: string
        sheetId: string
        selectedTopicIds: string[]
        sourceRefs: unknown[]
      }
      proposal: typeof proposal
    }

    expect(result).toEqual({
      documentId: created.id,
      revision: created.revision,
      request: {
        schemaVersion: 1,
        scope: 'sheet',
        documentId: created.id,
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: []
      },
      proposal
    })
    expect(load).toHaveBeenCalledTimes(1)
    expect(mindMapGeneration.generateMindMapProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Original',
        prompt: 'Suggest a concise title.',
        settings: loadedSettings,
        document: expect.objectContaining({ id: created.id, revision: created.revision }),
        request: expect.objectContaining({
          schemaVersion: 1,
          scope: 'sheet',
          documentId: created.id,
          sheetId: created.sheets[0]!.id,
          selectedTopicIds: [],
          sourceRefs: []
        })
      })
    )
    expect(update).not.toHaveBeenCalled()
    await expect(store.read(created.id)).resolves.toMatchObject({
      title: 'Original',
      revision: created.revision
    })
  })

  it('generates selected-file proposals from the registered workspace root without persistence or renderer content', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-selected-file')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    const selectedPath = join(rootPath, 'notes', 'biology.md')
    await mkdir(join(rootPath, 'notes'), { recursive: true })
    const selectedContent = 'Cells are the basic unit of life.'
    await writeFile(selectedPath, selectedContent, 'utf8')

    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-selected-file', rootPath }]
    })
    const loadedSettings = defaultSettings(rootPath)
    const load = vi.fn().mockResolvedValue(loadedSettings)
    const proposal = {
      schemaVersion: 1 as const,
      proposalId: 'proposal-selected-file',
      scope: 'selected-file' as const,
      items: []
    }
    mindMapGeneration.generateMindMapProposal.mockResolvedValueOnce(proposal)
    registerTeachingIpcGateway(
      registration({
        workspaceService: { getState },
        settingsService: { load },
        mindMapStoreFactory: () => store
      })
    )

    const result = await handler(teachingInvokeChannels.generateMindMapProposal)(event, {
      workspaceId: 'workspace-selected-file',
      id: created.id,
      scope: 'selected-file',
      sheetId: created.sheets[0]!.id,
      selectedTopicIds: [],
      sourceRefs: [],
      selectedFile: { workspacePath: 'notes/biology.md' },
      prompt: 'Use the selected reading as context.'
    }) as {
      documentId: string
      revision: number
      request: Record<string, unknown>
      proposal: typeof proposal
    }

    expect(result).toMatchObject({
      documentId: created.id,
      revision: created.revision,
      proposal
    })
    expect(result.request).toMatchObject({
      schemaVersion: 1,
      scope: 'selected-file',
      documentId: created.id,
      sheetId: created.sheets[0]!.id,
      selectedTopicIds: [],
      sourceRefs: [],
      selectedFile: {
        id: expect.stringMatching(/^selected-file:[a-f0-9]{64}$/),
        workspacePath: 'notes/biology.md',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    })
    expect(JSON.stringify(result)).not.toContain(selectedContent)
    expect(JSON.stringify(result)).not.toContain(rootPath)
    expect(mindMapGeneration.generateMindMapProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ scope: 'selected-file' }),
        selectedFileContext: expect.objectContaining({
          content: selectedContent,
          sourceRef: expect.objectContaining({ workspacePath: 'notes/biology.md' })
        })
      })
    )
    expect(update).not.toHaveBeenCalled()
    await expect(store.read(created.id)).resolves.toMatchObject({
      title: 'Original',
      revision: created.revision
    })

    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-selected-file',
        id: created.id,
        scope: 'selected-file',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        selectedFile: { workspacePath: '../outside.md' },
        prompt: 'unsafe'
      })
    ).rejects.toThrow('Invalid IPC payload for generateMindMapProposal.')
    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-selected-file',
        id: created.id,
        scope: 'selected-file',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        selectedFile: { workspacePath: 'notes/missing.md' },
        prompt: 'missing'
      })
    ).rejects.toThrow('Mind map selected file failed (missing_file)')
    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-selected-file',
        id: created.id,
        scope: 'selected-file',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        selectedFile: { workspacePath: 'notes/biology.md' },
        workspaceRoot: rootPath,
        prompt: 'renderer must not supply roots'
      })
    ).rejects.toThrow('Invalid IPC payload for generateMindMapProposal.')
    expect(mindMapGeneration.generateMindMapProposal).toHaveBeenCalledTimes(1)
  })

  it('generates Notes proposals from the registered workspace root without persistence or renderer content', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-notes')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const notesContent = '# Notes\nUse retrieval practice after each lesson.\n'
    await writeFile(join(rootPath, 'NOTES.md'), notesContent, 'utf8')

    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-notes', rootPath }]
    })
    const loadedSettings = defaultSettings(rootPath)
    const load = vi.fn().mockResolvedValue(loadedSettings)
    const proposal = {
      schemaVersion: 1 as const,
      proposalId: 'proposal-notes',
      scope: 'notes' as const,
      items: []
    }
    mindMapGeneration.generateMindMapProposal.mockResolvedValueOnce(proposal)
    registerTeachingIpcGateway(
      registration({
        workspaceService: { getState },
        settingsService: { load },
        mindMapStoreFactory: () => store
      })
    )

    const result = await handler(teachingInvokeChannels.generateMindMapProposal)(event, {
      workspaceId: 'workspace-notes',
      id: created.id,
      scope: 'notes',
      sheetId: created.sheets[0]!.id,
      selectedTopicIds: [],
      sourceRefs: [],
      prompt: 'Turn my notes into a reviewable map.'
    }) as {
      documentId: string
      revision: number
      request: Record<string, unknown>
      proposal: typeof proposal
    }

    expect(result).toMatchObject({
      documentId: created.id,
      revision: created.revision,
      proposal,
      request: {
        schemaVersion: 1,
        scope: 'notes',
        documentId: created.id,
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        notes: {
          id: expect.stringMatching(/^notes:[a-f0-9]{64}$/),
          workspacePath: 'NOTES.md',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      }
    })
    expect(JSON.stringify(result)).not.toContain(notesContent)
    expect(JSON.stringify(result)).not.toContain(rootPath)
    expect(mindMapGeneration.generateMindMapProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ scope: 'notes' }),
        notesContext: expect.objectContaining({
          content: notesContent,
          sourceRef: expect.objectContaining({ workspacePath: 'NOTES.md' })
        })
      })
    )
    expect(update).not.toHaveBeenCalled()

    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-notes',
        id: created.id,
        scope: 'notes',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        workspaceRoot: rootPath,
        prompt: 'renderer must not supply roots'
      })
    ).rejects.toThrow('Invalid IPC payload for generateMindMapProposal.')
    await rm(join(rootPath, 'NOTES.md'))
    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-notes',
        id: created.id,
        scope: 'notes',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        prompt: 'missing'
      })
    ).rejects.toThrow('Mind map notes failed (missing_file)')
    expect(mindMapGeneration.generateMindMapProposal).toHaveBeenCalledTimes(1)
  })

  it('generates Lesson proposals from the registered workspace root without persistence or renderer content', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-lesson')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    const lessonPath = join(rootPath, 'courses', 'biology', 'lesson', 'cell-structure.html')
    await mkdir(join(rootPath, 'courses', 'biology', 'lesson'), { recursive: true })
    const lessonContent = '<html><body><h1>Cell structure</h1><p>Membrane and nucleus.</p></body></html>'
    await writeFile(lessonPath, lessonContent, 'utf8')

    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-lesson', rootPath }]
    })
    const loadedSettings = defaultSettings(rootPath)
    const load = vi.fn().mockResolvedValue(loadedSettings)
    const proposal = {
      schemaVersion: 1 as const,
      proposalId: 'proposal-lesson',
      scope: 'lesson' as const,
      items: []
    }
    mindMapGeneration.generateMindMapProposal.mockResolvedValueOnce(proposal)
    registerTeachingIpcGateway(
      registration({
        workspaceService: { getState },
        settingsService: { load },
        mindMapStoreFactory: () => store
      })
    )

    const result = await handler(teachingInvokeChannels.generateMindMapProposal)(event, {
      workspaceId: 'workspace-lesson',
      id: created.id,
      scope: 'lesson',
      sheetId: created.sheets[0]!.id,
      selectedTopicIds: [],
      sourceRefs: [],
      lesson: { workspacePath: 'courses/biology/lesson/cell-structure.html' },
      prompt: 'Turn this Lesson into a reviewable map.'
    }) as {
      documentId: string
      revision: number
      request: Record<string, unknown>
      proposal: typeof proposal
    }

    expect(result).toMatchObject({
      documentId: created.id,
      revision: created.revision,
      proposal,
      request: {
        schemaVersion: 1,
        scope: 'lesson',
        documentId: created.id,
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        lesson: {
          id: expect.stringMatching(/^lesson:[a-f0-9]{64}$/),
          workspacePath: 'courses/biology/lesson/cell-structure.html',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      }
    })
    expect(JSON.stringify(result)).not.toContain(lessonContent)
    expect(JSON.stringify(result)).not.toContain(rootPath)
    expect(mindMapGeneration.generateMindMapProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Original',
        prompt: 'Turn this Lesson into a reviewable map.',
        settings: loadedSettings,
        request: expect.objectContaining({
          scope: 'lesson',
          lesson: expect.objectContaining({
            workspacePath: 'courses/biology/lesson/cell-structure.html'
          })
        }),
        lessonContext: expect.objectContaining({
          content: lessonContent,
          sourceRef: expect.objectContaining({
            workspacePath: 'courses/biology/lesson/cell-structure.html'
          })
        })
      })
    )
    expect(update).not.toHaveBeenCalled()
    await expect(store.read(created.id)).resolves.toMatchObject({
      title: 'Original',
      revision: created.revision
    })

    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-lesson',
        id: created.id,
        scope: 'lesson',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        lesson: { workspacePath: '../outside.html' },
        prompt: 'unsafe'
      })
    ).rejects.toThrow('Invalid IPC payload for generateMindMapProposal.')
    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-lesson',
        id: created.id,
        scope: 'lesson',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        lesson: { workspacePath: 'courses/biology/lesson/missing.html' },
        prompt: 'missing'
      })
    ).rejects.toThrow('Mind map lesson failed (missing_file)')

    await writeFile(lessonPath, Buffer.alloc(512 * 1024 + 1, 'x'))
    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-lesson',
        id: created.id,
        scope: 'lesson',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        lesson: { workspacePath: 'courses/biology/lesson/cell-structure.html' },
        prompt: 'oversized'
      })
    ).rejects.toThrow('Mind map lesson failed (over_limit)')

    await expect(
      handler(teachingInvokeChannels.generateMindMapProposal)(event, {
        workspaceId: 'workspace-lesson',
        id: created.id,
        scope: 'lesson',
        sheetId: created.sheets[0]!.id,
        selectedTopicIds: [],
        sourceRefs: [],
        lesson: { workspacePath: 'courses/biology/lesson/cell-structure.html' },
        workspaceRoot: rootPath,
        prompt: 'renderer must not supply roots'
      })
    ).rejects.toThrow('Invalid IPC payload for generateMindMapProposal.')
    expect(mindMapGeneration.generateMindMapProposal).toHaveBeenCalledTimes(1)
  })

  it('previews canonical source refreshes without persisting or returning source content', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-source-refresh')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    const sourcePath = join(rootPath, 'notes', 'biology.md')
    await mkdir(join(rootPath, 'notes'), { recursive: true })
    await writeFile(sourcePath, 'cells v1', 'utf8')
    const contentHash = createHash('sha256').update('cells v1').digest('hex')
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const withSource = {
      ...created,
      sheets: created.sheets.map((sheet, index) => index === 0
        ? {
            ...sheet,
            root: {
              ...sheet.root,
              sourceRefs: [{ id: 'source-1', workspacePath: 'notes/biology.md', contentHash }]
            }
          }
        : sheet)
    }
    const persisted = await store.update(created.id, withSource, created.revision)
    expect(persisted.ok).toBe(true)
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-source-refresh', rootPath }]
    })
    registerTeachingIpcGateway(
      registration({
        workspaceService: { getState },
        mindMapStoreFactory: () => store
      })
    )

    const result = await handler(teachingInvokeChannels.previewMindMapSourceRefresh)(event, {
      workspaceId: 'workspace-source-refresh',
      id: created.id
    }) as {
      documentId: string
      revision: number
      entries: Array<{ status: string; currentContentHash?: string; change: string }>
      changedCount: number
      attentionCount: number
    }

    expect(result).toEqual({
      documentId: created.id,
      revision: created.revision + 1,
      entries: [{
        sourceRef: { id: 'source-1', workspacePath: 'notes/biology.md', contentHash },
        topicIds: [created.sheets[0]!.root.id],
        sheetIds: [created.sheets[0]!.id],
        previousContentHash: contentHash,
        currentContentHash: contentHash,
        status: 'fresh',
        changed: false,
        change: 'unchanged'
      }],
      changedCount: 0,
      attentionCount: 0
    })
    expect(update).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain('cells v1')
    await expect(store.read(created.id)).resolves.toMatchObject({ revision: created.revision + 1 })
  })

  it('applies explicitly confirmed source metadata to every occurrence through the reducer and CAS', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-source-refresh-apply')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    const sourcePath = join(rootPath, 'notes', 'biology.md')
    await mkdir(join(rootPath, 'notes'), { recursive: true })
    const oldBody = 'cells v1'
    const newBody = 'cells v2 — private source body'
    await writeFile(sourcePath, newBody, 'utf8')
    const oldHash = createHash('sha256').update(oldBody).digest('hex')
    const newHash = createHash('sha256').update(newBody).digest('hex')
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const sourceRef = { id: 'source-1', workspacePath: 'notes/biology.md', contentHash: oldHash, stale: true }
    const withSource = {
      ...created,
      sheets: created.sheets.map((sheet, index) => index === 0
        ? {
            ...sheet,
            root: {
              ...sheet.root,
              sourceRefs: [sourceRef],
              children: [{
                id: 'child-source',
                title: 'Child source',
                sourceRefs: [sourceRef],
                children: []
              }]
            }
          }
        : sheet)
    }
    const persisted = await store.update(created.id, withSource, created.revision)
    expect(persisted.ok).toBe(true)
    if (!persisted.ok) throw new Error('failed to seed source refs')
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-source-refresh-apply', rootPath }]
    })
    registerTeachingIpcGateway(
      registration({ workspaceService: { getState }, mindMapStoreFactory: () => store })
    )

    const result = await handler(teachingInvokeChannels.applyMindMapSourceRefresh)(event, {
      workspaceId: 'workspace-source-refresh-apply',
      id: created.id,
      expectedRevision: persisted.document.revision,
      updates: [{
        sourceRef: {
          id: 'source-1',
          workspacePath: './notes/biology.md',
          contentHash: newHash,
          stale: false
        }
      }]
    }) as {
      ok: boolean
      document: { revision: number; sheets: Array<{ root: { sourceRefs?: Array<Record<string, unknown>>; children: Array<{ sourceRefs?: Array<Record<string, unknown>> }> } }> }
      appliedSourceIds: string[]
    }

    expect(result.ok).toBe(true)
    expect(result.appliedSourceIds).toEqual(['source-1'])
    expect(result.document.revision).toBe(persisted.document.revision + 1)
    expect(result.document.sheets[0]!.root.sourceRefs).toEqual([
      expect.objectContaining({ id: 'source-1', workspacePath: 'notes/biology.md', contentHash: newHash, stale: false })
    ])
    expect(result.document.sheets[0]!.root.children[0]!.sourceRefs).toEqual([
      expect.objectContaining({ id: 'source-1', workspacePath: 'notes/biology.md', contentHash: newHash, stale: false })
    ])
    expect(update).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain(newBody)
    await expect(store.read(created.id)).resolves.toMatchObject({ revision: persisted.document.revision + 1 })
    await expect(readFile(sourcePath, 'utf8')).resolves.toBe(newBody)
  })

  it('rejects a stale source refresh apply without evaluating or persisting updates', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-source-refresh-apply-stale')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const changed = await store.update(created.id, { ...created, title: 'Newer title' }, created.revision)
    expect(changed.ok).toBe(true)
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-source-refresh-stale', rootPath }]
    })
    registerTeachingIpcGateway(
      registration({ workspaceService: { getState }, mindMapStoreFactory: () => store })
    )

    const result = await handler(teachingInvokeChannels.applyMindMapSourceRefresh)(event, {
      workspaceId: 'workspace-source-refresh-stale',
      id: created.id,
      expectedRevision: created.revision,
      updates: [{
        sourceRef: {
          id: 'missing',
          workspacePath: 'notes/missing.md',
          contentHash: 'new-hash',
          stale: false
        }
      }]
    })

    expect(result).toEqual({
      ok: false,
      code: 'revision_stale',
      expectedRevision: created.revision,
      currentRevision: created.revision + 1
    })
    expect(update).not.toHaveBeenCalled()
    await expect(store.read(created.id)).resolves.toMatchObject({ title: 'Newer title' })
  })

  it('returns a stale revision without evaluating or persisting a reviewed proposal', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-proposal-stale')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const changed = await store.update(
      created.id,
      { ...created, title: 'Newer title' },
      created.revision
    )
    expect(changed.ok).toBe(true)
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-proposal', rootPath }]
    })
    registerTeachingIpcGateway(
      registration({ workspaceService: { getState }, mindMapStoreFactory: () => store })
    )

    const result = await handler(teachingInvokeChannels.applyMindMapProposal)(event, {
      workspaceId: 'workspace-proposal',
      id: created.id,
      expectedRevision: created.revision,
      proposal: {
        schemaVersion: 1,
        proposalId: 'proposal-stale',
        scope: 'sheet',
        items: [
          {
            id: 'rename-document',
            command: { type: 'document.rename', title: 'Should not apply' }
          }
        ]
      },
      decisions: { 'rename-document': 'accept' }
    })

    expect(result).toEqual({
      ok: false,
      code: 'revision_stale',
      expectedRevision: created.revision,
      currentRevision: created.revision + 1
    })
    expect(update).not.toHaveBeenCalled()
    await expect(store.read(created.id)).resolves.toMatchObject({
      title: 'Newer title',
      revision: created.revision + 1
    })
  })

  it('returns reducer errors without publishing a partial proposal transaction', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-proposal-command-error')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-proposal', rootPath }]
    })
    registerTeachingIpcGateway(
      registration({ workspaceService: { getState }, mindMapStoreFactory: () => store })
    )

    const result = await handler(teachingInvokeChannels.applyMindMapProposal)(event, {
      workspaceId: 'workspace-proposal',
      id: created.id,
      expectedRevision: created.revision,
      proposal: {
        schemaVersion: 1,
        proposalId: 'proposal-invalid-command',
        scope: 'sheet',
        items: [
          {
            id: 'rename-missing-sheet',
            command: {
              type: 'sheet.rename',
              sheetId: 'missing-sheet',
              title: 'Must not apply'
            }
          }
        ]
      },
      decisions: { 'rename-missing-sheet': 'accept' }
    }) as {
      ok: boolean
      code: string
      proposalId: string
      error: { code: string }
    }

    expect(result).toMatchObject({
      ok: false,
      code: 'command_invalid',
      proposalId: 'proposal-invalid-command',
      error: { code: 'INVALID_TRANSACTION' }
    })
    expect(update).not.toHaveBeenCalled()
    await expect(store.read(created.id)).resolves.toMatchObject({
      title: 'Original',
      revision: created.revision
    })
  })

  it('keeps rejected-only reviews as a durable no-op', async () => {
    const runtime = await runtimeScope.create('gateway-mind-map-proposal-reject')
    const rootPath = join(runtime.paths.workspace, 'registered-course')
    await mkdir(rootPath, { recursive: true })
    const store = createMindMapStore(rootPath)
    const created = await store.create('Original')
    const update = vi.spyOn(store, 'update')
    const getState = vi.fn().mockResolvedValue({
      workspaces: [{ id: 'workspace-proposal', rootPath }]
    })
    registerTeachingIpcGateway(
      registration({ workspaceService: { getState }, mindMapStoreFactory: () => store })
    )

    const result = await handler(teachingInvokeChannels.applyMindMapProposal)(event, {
      workspaceId: 'workspace-proposal',
      id: created.id,
      expectedRevision: created.revision,
      proposal: {
        schemaVersion: 1,
        proposalId: 'proposal-reject',
        scope: 'sheet',
        items: [
          {
            id: 'rename-document',
            command: { type: 'document.rename', title: 'Must not apply' }
          }
        ]
      },
      decisions: { 'rename-document': 'reject' }
    }) as { ok: boolean; document: { revision: number; title: string }; command: unknown; inverse: unknown }

    expect(result).toMatchObject({
      ok: true,
      document: { revision: created.revision, title: 'Original' },
      command: null,
      inverse: null
    })
    expect(update).not.toHaveBeenCalled()
  })

})
