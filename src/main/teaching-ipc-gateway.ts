import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { cancelStreamAskPending, resolveAskPending } from './ai/ask-pending'
import { cancelStreamToolPermissionPending, resolveToolPermissionPending } from './ai/tool-permission-pending'
import type { AgentEventBus } from './ai/agent-event-bus'
import { openExternalHttpUrl } from './external-links'
import type { Logger } from './logger'
import { isPathInsideConfiguredRoot, isRealPathInsideRoot } from './path-access'
import { fetchUpstreamModels, probeModelProvider } from './provider-connection'
import type { SkillLibraryService } from './skill-library'
import { createAndSwitchGitBranchForWorkspace, getGitBranchesForWorkspace, listGitWorktreesForWorkspace, removeGitWorktreeForWorkspace, switchGitBranchForWorkspace } from './teaching-git'
import {
  decodeToolAnswerPayload, optionalString, parseAgentChatStreamPayload, parseApplyLessonStylePayload,
  parseCleanupAgentArtifactsPayload, parseCommitLearningOutcomeRequest, parseCreateAgentConversationCheckpointPayload,
  parseForkAgentConversationBranchPayload, parseOpenAgentConversationBranchPayload,
  parseCreateMemoryPayload, parseCreateWorkspacePayload, parseGenerateLessonPayload, parseGitBranchPayload,
  parseListUpstreamModelsPayload, parseNotificationPayload, parseProbeProviderPayload,
  parseQueryAgentArchivedHistoryPayload, parseReadAgentConversationPayload,
  parseReadAgentConversationSessionTreePayload, parseReadLessonPayload, parseReadWorkspaceChangeDiffPayload,
  parsePreviewLessonInteractionIntent,
  parseReplayAgentConversationBranchPayload,
  parseRebuildAgentHistoryIndexPayload, parseResolveAgentConversationCheckpointPayload,
  parseReadWorkspaceMarkdownPayload, parseRecordProgressPayload, parseRemoveGitWorktreePayload, parseReplayAgentChatEventsPayload,
  parseSaveAgentConversationPayload, parseSaveWorkspaceMarkdownPayload, parseSettingsPatch,
  parseUpdateAgentConversationBranchStatusPayload, parseUpdateMemoryPayload, parseUpdateMissionPayload,
  parseWorkspaceItemMetaPayload,
  parseWorkspaceItemRemovePayload, parseWorkspaceRemovePayload, requireStreamId, requireString,
  requireWindowControlAction
} from './teaching-ipc-commands'
import type { TeachingSettingsService } from './teaching-settings'
import { resolveOptionalRegisteredWorkspaceRoot, resolveRegisteredWorkspaceRoot } from './teaching-workspace-access'
import {
  PreviewLessonInteractionBindingError,
  type PreviewLessonNavigation,
  type TeachingWorkspaceService
} from './teaching-workspace'
import type { LearningAnalyticsService } from './teaching/services/learning-analytics'
import { teachingEventChannels, teachingInvokeChannels } from '../shared/teaching-ipc-contract'
import type { AnalyticsExportRequest, ClearAnalyticsRequest, LearningAnalyticsRequest, TeachingSettingsV1 } from '../shared/teaching-types'

/** Dependencies owned by the main-process Teaching IPC composition root. */
export interface TeachingIpcRegistration {
  workspaceService: TeachingWorkspaceService
  settingsService: TeachingSettingsService
  skillLibraryService: SkillLibraryService
  learningAnalyticsService: LearningAnalyticsService
  logger: Pick<Logger, 'error' | 'path'>
  applyAppBehavior: (settings: TeachingSettingsV1) => Promise<void>
}

type GatewayContext = TeachingIpcRegistration & {
  activeAgentChatStreams: Map<string, AbortController>
  retainedAgentEventBuses: Map<string, AgentEventBus>
  agentStreamSessions: WeakMap<Electron.IpcMainInvokeEvent, AgentStreamSession>
  /** Weakly remembers senders whose preview lifecycle hooks are already installed. */
  previewBindingLifecycleSenders: WeakSet<Electron.WebContents>
}

type AgentStreamSession = { streamId: string; controller: AbortController }

type GatewayCommand = {
  channel: string
  invoke: (event: Electron.IpcMainInvokeEvent, args: unknown[]) => Promise<unknown>
}

type CommandDeclaration<Payload, Result> = {
  channel: string
  parser: (...args: unknown[]) => Payload | Promise<Payload>
  action: (event: Electron.IpcMainInvokeEvent, payload: Payload) => Result | Promise<Result>
  reply: (result: Result) => unknown
  streamCleanup: (event: Electron.IpcMainInvokeEvent, payload: Payload) => void
}

const identityReply = <Value>(value: Value): Value => value
const noStreamCleanup = (): void => {}

function command<Payload, Result>(declaration: CommandDeclaration<Payload, Result>): GatewayCommand {
  return {
    channel: declaration.channel,
    async invoke(event, args) {
      // Parsing occurs before actions, so malformed renderer input cannot cause side effects.
      const payload = await declaration.parser(...args)
      try {
        return declaration.reply(await declaration.action(event, payload))
      } finally {
        declaration.streamCleanup(event, payload)
      }
    }
  }
}

function previewBindingSenderId(context: GatewayContext, event: Electron.IpcMainInvokeEvent): number {
  const sender = event.sender
  if (!sender || sender.isDestroyed() || !Number.isSafeInteger(sender.id) || sender.id < 1) {
    throw new PreviewLessonInteractionBindingError('sender_unavailable', 'Preview lesson interaction sender is unavailable.')
  }
  ensurePreviewBindingLifecycle(context, sender)
  return sender.id
}

/**
 * A child iframe keeps its WindowProxy across document navigations. Revoke the
 * main-owned preview authority at Electron's navigation start instead of
 * trusting renderer load timing or a WindowProxy equality check.
 */
function ensurePreviewBindingLifecycle(context: GatewayContext, sender: Electron.WebContents): void {
  if (context.previewBindingLifecycleSenders.has(sender)) return
  context.previewBindingLifecycleSenders.add(sender)
  const senderId = sender.id
  sender.once('destroyed', () => context.workspaceService.clearPreviewLessonBinding(senderId))
  sender.on('did-start-navigation', (details, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
    context.workspaceService.observePreviewLessonNavigation(senderId, previewLessonNavigation(
      details, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId
    ))
  })
}

/** Extract navigation facts from Electron only; malformed or unavailable facts fail closed in the service. */
function previewLessonNavigation(
  details: unknown,
  url: unknown,
  isInPlace: unknown,
  isMainFrame: unknown,
  frameProcessId: unknown,
  frameRoutingId: unknown
): PreviewLessonNavigation {
  const detail = isUnknownRecord(details) ? details : null
  const frame = detail && isUnknownRecord(detail.frame) ? detail.frame : null
  return {
    url: stringNavigationFact(detail?.url, url),
    isMainFrame: booleanNavigationFact(detail?.isMainFrame, isMainFrame),
    isSameDocument: booleanNavigationFact(detail?.isSameDocument, isInPlace),
    frameProcessId: numberNavigationFact(frame?.processId, frameProcessId),
    frameRoutingId: numberNavigationFact(frame?.routingId, frameRoutingId)
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringNavigationFact(primary: unknown, fallback: unknown): string | null {
  return typeof primary === 'string' ? primary : typeof fallback === 'string' ? fallback : null
}

function booleanNavigationFact(primary: unknown, fallback: unknown): boolean | null {
  return typeof primary === 'boolean' ? primary : typeof fallback === 'boolean' ? fallback : null
}

function numberNavigationFact(primary: unknown, fallback: unknown): number | null {
  return typeof primary === 'number' ? primary : typeof fallback === 'number' ? fallback : null
}

function clearPreviewLessonBindingForSender(context: GatewayContext, event: Electron.IpcMainInvokeEvent): void {
  const sender = event.sender
  if (!sender || sender.isDestroyed() || !Number.isSafeInteger(sender.id) || sender.id < 1) return
  ensurePreviewBindingLifecycle(context, sender)
  context.workspaceService.clearPreviewLessonBinding(sender.id)
}

/**
 * Register the fixed Electron IPC surface for Teaching. Electron remains internal;
 * this is intentionally not a public, replaceable transport abstraction.
 */
export function registerTeachingIpcGateway(registration: TeachingIpcRegistration): void {
  const context: GatewayContext = {
    ...registration,
    activeAgentChatStreams: new Map(),
    retainedAgentEventBuses: new Map(),
    agentStreamSessions: new WeakMap(),
    previewBindingLifecycleSenders: new WeakSet()
  }
  const channels = new Set<string>()
  for (const declaration of createCommands(context)) {
    if (channels.has(declaration.channel)) {
      throw new Error(`Teaching IPC channel registered more than once: ${declaration.channel}`)
    }
    channels.add(declaration.channel)
    ipcMain.handle(declaration.channel, (event, ...args: unknown[]) => declaration.invoke(event, args))
  }
}

function createCommands(context: GatewayContext): GatewayCommand[] {
  const { workspaceService: service, settingsService: settings, skillLibraryService: skills, learningAnalyticsService: analytics } = context
  const retainAgentEventBus = (streamId: string, eventBus: AgentEventBus): void => {
    context.retainedAgentEventBuses.delete(streamId)
    context.retainedAgentEventBuses.set(streamId, eventBus)
    while (context.retainedAgentEventBuses.size > 32) {
      const oldestStreamId = context.retainedAgentEventBuses.keys().next().value
      if (typeof oldestStreamId !== 'string') break
      context.retainedAgentEventBuses.delete(oldestStreamId)
    }
  }
  const resolveGitWorkspaceRoot = async (rawWorkspaceRoot: string) =>
    resolveRegisteredWorkspaceRoot((await service.getState()).workspaces, rawWorkspaceRoot)
  const resolveOptionalWorkspaceRoot = async (rawWorkspaceRoot: string | undefined) =>
    resolveOptionalRegisteredWorkspaceRoot((await service.getState()).workspaces, rawWorkspaceRoot)

  return [
    command({ channel: teachingInvokeChannels.getState, parser: () => undefined, action: () => service.getState(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getLearningAnalytics, parser: (query) => query as LearningAnalyticsRequest, action: (_event, query) => analytics.getLearningAnalytics(query), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.clearLearningAnalytics, parser: (request) => request as ClearAnalyticsRequest, action: (_event, request) => analytics.clearLearningAnalytics(request), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.exportLearningAnalytics,
      parser: (request) => request as AnalyticsExportRequest,
      action: async (_event, exportRequest) => {
        const prepared = await analytics.prepareExport(exportRequest)
        const options: Electron.SaveDialogOptions = { title: '导出学习分析', defaultPath: prepared.fileName, filters: exportRequest.format === 'json' ? [{ name: 'JSON', extensions: ['json'] }] : [{ name: 'CSV', extensions: ['csv'] }] }
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return { canceled: true as const }
        await writeFile(result.filePath, prepared.content, { encoding: 'utf8', mode: 0o600 })
        return { canceled: false as const, fileName: basename(result.filePath), bytesWritten: Buffer.byteLength(prepared.content, 'utf8'), manifest: prepared.manifest }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.getSettings, parser: () => undefined, action: () => settings.load(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listInterruptedAgentRuns, parser: () => undefined, action: () => service.listInterruptedAgentRuns(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.updateSettings, parser: (payload) => parseSettingsPatch(payload),
      action: async (_event, payload) => { const updated = await settings.patch(payload); void context.applyAppBehavior(updated); return updated },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.selectWorkspace, parser: (workspaceId) => requireString(workspaceId, 'workspaceId'), action: (event, workspaceId) => { clearPreviewLessonBindingForSender(context, event); return service.selectWorkspace(workspaceId) }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.createWorkspace, parser: (payload) => parseCreateWorkspacePayload(payload), action: (_event, payload) => service.createWorkspace(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.importWorkspace, parser: () => undefined,
      action: async () => {
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow ? await dialog.showOpenDialog(mainWindow, { title: '选择教学工作区', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] }) : await dialog.showOpenDialog({ title: '选择教学工作区', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] })
        const rootPath = result.filePaths[0]
        return result.canceled || !rootPath ? { canceled: true, state: null } : { canceled: false, state: await service.importWorkspace(rootPath) }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.importWorkspacePath, parser: (rootPath) => requireString(rootPath, 'rootPath').trim(), action: (_event, rootPath) => service.importWorkspace(rootPath), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.pickDirectory, parser: (defaultPath) => defaultPath,
      action: async (_event, defaultPath) => {
        const options: Electron.OpenDialogOptions = { title: '选择目录', properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'], ...(typeof defaultPath === 'string' && defaultPath.trim() ? { defaultPath: defaultPath.trim() } : {}) }
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
        const path = result.filePaths[0] ?? null
        return { canceled: result.canceled || !path, path }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openImportLocation, parser: (rawPath) => optionalString(rawPath),
      action: async (_event, requestedPath) => {
        const loadedSettings = await settings.load()
        const target = resolve(requestedPath ?? (loadedSettings.workspace.defaultRoot || app.getPath('documents')))
        if (!requestedPath) await mkdir(target, { recursive: true }).catch(() => {})
        const message = await shell.openPath(target)
        return { ok: message.length === 0, message: message || undefined }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.updateMission, parser: (payload) => parseUpdateMissionPayload(payload), action: (_event, payload) => service.updateMission(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.applyLessonStyle, parser: (payload) => parseApplyLessonStylePayload(payload), action: (_event, payload) => service.applyLessonStyle(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listSkills, parser: () => undefined, action: () => skills.listSkills(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.installSkill, parser: (skillId) => requireString(skillId, 'skillId'), action: (_event, skillId) => skills.installSkill(skillId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.generateLesson, parser: (payload) => parseGenerateLessonPayload(payload), action: (_event, payload) => service.generateLesson(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.generateLessonStream, parser: (payload) => parseGenerateLessonPayload(payload),
      action: async (event, payload) => {
        const streamId = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
        try {
          const result = await service.generateLessonStream(payload, { streamId, onChunk: (chunk) => safeSend(event.sender, teachingEventChannels.lessonStreamChunk, chunk), onStatus: (status) => safeSend(event.sender, teachingEventChannels.lessonStreamStatus, status) })
          return { streamId, ...result }
        } catch (error) {
          const message = errorMessage(error); context.logger.error(`Lesson stream failed: ${message}`); return { streamId, error: true as const, message }
        }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.agentChatStream, parser: (payload) => parseAgentChatStreamPayload(payload),
      action: async (event, payload) => {
        const streamId = payload.streamId ?? `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
        const controller = new AbortController()
        context.activeAgentChatStreams.set(streamId, controller)
        context.agentStreamSessions.set(event, { streamId, controller })
        try {
          const result = await service.agentChatStream(payload, {
            streamId, signal: controller.signal,
            onChunk: (chunk) => safeSend(event.sender, teachingEventChannels.agentChatChunk, chunk),
            onStatus: (status) => safeSend(event.sender, teachingEventChannels.agentChatStatus, status),
            onTool: (toolEvent) => safeSend(event.sender, teachingEventChannels.agentChatTool, toolEvent),
            onRealtimeEvent: (realtimeEvent) => safeSend(event.sender, teachingEventChannels.agentChatEvent, realtimeEvent),
            onEventBusReady: (eventBus) => retainAgentEventBus(streamId, eventBus)
          })
          return { streamId, ...result }
        } catch (error) {
          if (controller.signal.aborted) return { streamId, canceled: true as const }
          const message = errorMessage(error); context.logger.error(`Agent chat stream failed: ${message}`); return { streamId, error: true as const, message }
        }
      },
      reply: identityReply,
      streamCleanup: (event) => {
        const session = context.agentStreamSessions.get(event)
        if (!session) return
        if (context.activeAgentChatStreams.get(session.streamId) === session.controller) context.activeAgentChatStreams.delete(session.streamId)
        context.agentStreamSessions.delete(event)
      }
    }),
    command({
      channel: teachingInvokeChannels.replayAgentChatEvents, parser: (rawPayload) => parseReplayAgentChatEventsPayload(rawPayload),
      action: (_event, payload) => context.retainedAgentEventBuses.get(payload.streamId)?.replayAfter(payload.afterSequence) ?? unavailableReplay(payload.streamId, payload.afterSequence),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.cancelAgentChatStream, parser: (streamId) => requireStreamId(streamId),
      action: (_event, streamId) => {
        const controller = context.activeAgentChatStreams.get(streamId)
        if (controller) { controller.abort(); context.activeAgentChatStreams.delete(streamId) }
        cancelStreamAskPending(streamId); cancelStreamToolPermissionPending(streamId)
        return { canceled: Boolean(controller) }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.answerAgentChatTool, parser: (payload) => decodeToolAnswerPayload(payload),
      action: (_event, payload) => { if (!resolveAskPending(payload.streamId, payload.toolCallId, payload.answers)) resolveToolPermissionPending(payload.streamId, payload.toolCallId, payload.answers); return { ok: true } },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.saveAgentConversation,
      parser: (payload) => parseSaveAgentConversationPayload(payload),
      action: async (_event, payload) => {
        const result = await service.saveAgentConversation(payload)
        analytics.invalidate(['conversation'])
        return result
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.readAgentConversation, parser: (payload) => parseReadAgentConversationPayload(payload), action: (_event, payload) => service.readAgentConversation(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.readAgentConversationSessionTree, parser: (payload) => parseReadAgentConversationSessionTreePayload(payload), action: (_event, payload) => service.readAgentConversationSessionTree(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.openAgentConversationBranch, parser: (payload) => parseOpenAgentConversationBranchPayload(payload), action: (_event, payload) => service.openAgentConversationBranch(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.forkAgentConversationBranch, parser: (payload) => parseForkAgentConversationBranchPayload(payload), action: async (_event, payload) => { const result = await service.forkAgentConversationBranch(payload); analytics.invalidate(['conversation']); return result }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.replayAgentConversationBranch, parser: (payload) => parseReplayAgentConversationBranchPayload(payload), action: (_event, payload) => service.replayAgentConversationBranch(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.updateAgentConversationBranchStatus, parser: (payload) => parseUpdateAgentConversationBranchStatusPayload(payload), action: async (_event, payload) => { const result = await service.updateAgentConversationBranchStatus(payload); analytics.invalidate(['conversation']); return result }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.createAgentConversationCheckpoint, parser: (payload) => parseCreateAgentConversationCheckpointPayload(payload), action: (_event, payload) => service.createAgentConversationCheckpoint(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.resolveAgentConversationCheckpoint, parser: (payload) => parseResolveAgentConversationCheckpointPayload(payload), action: (_event, payload) => service.resolveAgentConversationCheckpoint(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.queryAgentArchivedHistory, parser: (payload) => parseQueryAgentArchivedHistoryPayload(payload), action: (_event, payload) => service.queryAgentArchivedHistory(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.rebuildAgentHistoryIndex, parser: (payload) => parseRebuildAgentHistoryIndexPayload(payload), action: (_event, payload) => service.rebuildAgentHistoryIndex(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.cleanupAgentArtifacts, parser: (payload) => parseCleanupAgentArtifactsPayload(payload), action: (_event, payload) => service.cleanupAgentArtifacts(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.setWorkspaceItemMeta, parser: (payload) => parseWorkspaceItemMetaPayload(payload), action: (_event, payload) => service.setWorkspaceItemMeta(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.removeWorkspaceItem, parser: (payload) => parseWorkspaceItemRemovePayload(payload), action: (_event, payload) => service.removeWorkspaceItem(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.removeWorkspace, parser: (payload) => parseWorkspaceRemovePayload(payload), action: (_event, payload) => service.removeWorkspace(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.readLesson, parser: (payload) => parseReadLessonPayload(payload), action: (event, payload) => {
      const senderId = previewBindingSenderId(context, event)
      return service.readLesson(payload, senderId)
    }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.recordPreviewLessonInteraction, parser: (payload) => parsePreviewLessonInteractionIntent(payload), action: (event, intent) => service.recordPreviewLessonInteraction(previewBindingSenderId(context, event), intent), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.commitLearningOutcome,
      parser: (payload) => parseCommitLearningOutcomeRequest(payload),
      action: (_event, request) => request
        ? service.commitLearningOutcome(request)
        : { status: 'non_retryable_failure' as const, reason: 'invalid_request' as const },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.readWorkspaceMarkdown, parser: (payload) => parseReadWorkspaceMarkdownPayload(payload), action: (event, payload) => {
      const senderId = previewBindingSenderId(context, event)
      return service.readWorkspaceMarkdown(payload, senderId)
    }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.readWorkspaceChangeDiff, parser: (payload) => parseReadWorkspaceChangeDiffPayload(payload), action: (_event, payload) => service.readWorkspaceChangeDiff(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.saveWorkspaceMarkdown, parser: (payload) => parseSaveWorkspaceMarkdownPayload(payload), action: (_event, payload) => service.saveWorkspaceMarkdown(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.openPath, parser: (rawPath) => resolve(String(rawPath ?? '')),
      action: async (_event, target) => {
        const state = await service.getState()
        const loadedSettings = await settings.load()
        const lexicalAllowedRoots = [...state.workspaces.map((workspace) => workspace.rootPath), loadedSettings.worktree.rootPath, loadedSettings.workspace.defaultRoot].filter((rootPath) => isPathInsideConfiguredRoot(rootPath, target))
        const allowed = lexicalAllowedRoots.length > 0 && (await Promise.all(lexicalAllowedRoots.map((rootPath) => isRealPathInsideRoot(rootPath, target)))).some(Boolean)
        if (!allowed) return { ok: false, message: 'Path is outside registered teaching workspaces.' }
        const message = await shell.openPath(target)
        return { ok: message.length === 0, message: message || undefined }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openExternal, parser: (rawUrl) => rawUrl,
      action: async (_event, rawUrl) => openExternalHttpUrl(rawUrl, await settings.load(), (url) => shell.openExternal(url)),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.showNotification, parser: (payload) => payload,
      action: async (_event, rawPayload) => {
        if (!(await settings.load()).notifications.enabled || !Notification.isSupported()) return
        const payload = parseNotificationPayload(rawPayload)
        new Notification({ title: payload.title, body: payload.body }).show()
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.controlWindow, parser: (action) => requireWindowControlAction(action),
      action: (event, action) => {
        const targetWindow = BrowserWindow.fromWebContents(event.sender)
        if (!targetWindow) return
        if (action === 'minimize') { targetWindow.minimize(); return }
        if (action === 'toggle-maximize') { if (targetWindow.isMaximized()) targetWindow.unmaximize(); else targetWindow.maximize(); return }
        targetWindow.close()
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.probeProvider, parser: (payload) => parseProbeProviderPayload(payload),
      action: async (_event, payload) => probeModelProvider(payload, resolveProxyUrl(await settings.load())),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listUpstreamModels,
      parser: async (payload) => {
        const loadedSettings = await settings.load()
        return {
          request: parseListUpstreamModelsPayload(payload, loadedSettings.provider.providers),
          proxyUrl: resolveProxyUrl(loadedSettings)
        }
      },
      action: (_event, payload) => payload.request
        ? fetchUpstreamModels(payload.request, payload.proxyUrl)
        : { ok: false as const, message: '未找到该 provider。' },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.listReviewCards, parser: (workspaceId) => requireString(workspaceId, 'workspaceId'), action: (_event, workspaceId) => service.listReviewCards(workspaceId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.recordProgress, parser: (payload) => parseRecordProgressPayload(payload), action: (_event, payload) => service.recordProgress(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getProgress, parser: (workspaceId) => requireString(workspaceId, 'workspaceId'), action: (_event, workspaceId) => service.getProgress(workspaceId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.listGitWorktrees, parser: (workspaceRoot) => requireString(workspaceRoot, 'workspaceRoot'),
      action: async (_event, workspaceRoot) => listGitWorktreesForWorkspace(workspaceRoot, (await settings.load()).worktree.rootPath),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.removeGitWorktree, parser: (payload) => parseRemoveGitWorktreePayload(payload),
      action: async (_event, request) => {
        const access = await resolveGitWorkspaceRoot(request.workspaceRoot)
        if (!access.ok) return { ok: false, message: access.message }
        return removeGitWorktreeForWorkspace({ workspaceRoot: access.rootPath, worktreePath: request.worktreePath, worktreeRoot: (await settings.load()).worktree.rootPath })
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listGitBranches, parser: (workspaceRoot) => requireString(workspaceRoot, 'workspaceRoot'),
      action: async (_event, workspaceRoot) => { const access = await resolveGitWorkspaceRoot(workspaceRoot); return access.ok ? getGitBranchesForWorkspace(access.rootPath) : access },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.switchGitBranch, parser: (payload) => parseGitBranchPayload(payload),
      action: async (_event, request) => { const access = await resolveGitWorkspaceRoot(request.workspaceRoot); return access.ok ? switchGitBranchForWorkspace(access.rootPath, request.branch) : access },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.createGitBranch, parser: (payload) => parseGitBranchPayload(payload),
      action: async (_event, request) => { const access = await resolveGitWorkspaceRoot(request.workspaceRoot); return access.ok ? createAndSwitchGitBranchForWorkspace(access.rootPath, request.branch) : access },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listMemory, parser: (workspaceRoot) => optionalString(workspaceRoot),
      action: async (_event, workspaceRoot) => { const access = await resolveOptionalWorkspaceRoot(workspaceRoot); if (!access.ok) throw new Error(access.message); return service.listMemory(access.rootPath) },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.getMemoryDiagnostics, parser: () => undefined, action: () => service.getMemoryDiagnostics(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getConnectorStatuses, parser: () => undefined, action: () => service.getConnectorStatuses(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({
      channel: teachingInvokeChannels.createMemory, parser: (payload) => parseCreateMemoryPayload(payload),
      action: async (_event, request) => {
        const access = await resolveOptionalWorkspaceRoot(request.workspaceRoot)
        if (!access.ok) throw new Error(access.message)
        if (request.scope !== 'user' && !access.rootPath) throw new Error('Workspace memory requires a registered teaching workspace.')
        return service.createMemory({ ...request, workspaceRoot: access.rootPath })
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.updateMemory,
      parser: (memoryId, patch) => ({ patch: parseUpdateMemoryPayload(patch), memoryId: requireString(memoryId, 'memoryId') }),
      action: async (_event, request) => { const access = await resolveOptionalWorkspaceRoot(request.patch.workspaceRoot); if (!access.ok) throw new Error(access.message); return service.updateMemory(request.memoryId, { ...request.patch, workspaceRoot: access.rootPath }) },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.deleteMemory,
      parser: (memoryId, workspaceRoot) => ({ memoryId: requireString(memoryId, 'memoryId'), workspaceRoot: optionalString(workspaceRoot) }),
      action: async (_event, request) => { const access = await resolveOptionalWorkspaceRoot(request.workspaceRoot); if (!access.ok) throw new Error(access.message); return service.deleteMemory(request.memoryId, access.rootPath) },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openLogFile, parser: () => undefined,
      action: async () => { const message = await shell.openPath(context.logger.path); return { ok: message.length === 0, message: message || undefined } },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.openAppDataDir, parser: () => undefined,
      action: async () => { const message = await shell.openPath(app.getPath('userData')); return { ok: message.length === 0, message: message || undefined } },
      reply: identityReply, streamCleanup: noStreamCleanup
    })
  ]
}

function unavailableReplay(streamId: string, afterSequence: number) {
  return { streamId, available: false, requestedAfterSequence: afterSequence, fromSequence: afterSequence + 1, nextSequence: afterSequence + 1, hasGap: true, droppedEvents: 0, droppedBytes: 0, events: [] }
}

function safeSend(sender: Electron.WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

function resolveProxyUrl(settings: TeachingSettingsV1): string {
  return settings.provider.proxy.enabled ? settings.provider.proxy.url.trim() : ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

