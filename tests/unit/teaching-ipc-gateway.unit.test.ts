import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const event = { sender: { id: 41, isDestroyed: vi.fn(() => false), once: vi.fn(), send: vi.fn() } }

function handler(channel: string) {
  const registered = electron.handlers.get(channel)
  if (!registered) throw new Error(`No handler registered for ${channel}`)
  return registered
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

  it('rejects invalid input before its action can run', async () => {
    const createWorkspace = vi.fn()
    registerTeachingIpcGateway(registration({ workspaceService: { createWorkspace } }))

    await expect(handler(teachingInvokeChannels.createWorkspace)(event, { name: 'Course', prompt: 42 }))
      .rejects.toThrow('IPC payload field "prompt" must be a string.')
    expect(createWorkspace).not.toHaveBeenCalled()
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

  it('routes explicit archived-history operations through bounded parsers', async () => {
    const queryAgentArchivedHistory = vi.fn().mockResolvedValue({ items: [], truncated: false })
    const cleanupAgentArtifacts = vi.fn().mockResolvedValue({ dryRun: true, actions: [] })
    registerTeachingIpcGateway(registration({
      workspaceService: { queryAgentArchivedHistory, cleanupAgentArtifacts }
    }))

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

    await handler(teachingInvokeChannels.cleanupAgentArtifacts)(event, {
      workspaceId: 'workspace-1', dryRun: true, retentionDays: 90
    })
    expect(cleanupAgentArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace-1', dryRun: true, retentionDays: 90
    }))
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

