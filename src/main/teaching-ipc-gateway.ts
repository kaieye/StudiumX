import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { cancelStreamAskPending, resolveAskPending } from './ai/ask-pending'
import { cancelStreamToolPermissionPending, resolveToolPermissionPending } from './ai/tool-permission-pending'
import type { AgentEventBus } from './ai/agent-event-bus'
import { AgentInputQueueRegistry } from './ai/agent-input-queue'
import { AgentSessionFacade, AgentSessionFacadeRegistry } from './ai/agent-session-facade'
import {
  mapAgentSessionPromptResultToIpc,
  noActiveAgentSessionIpcResult
} from './ai/agent-chat-steer-followup-ipc'
import { runProjectAgentSessionQueueIpc } from './ai/agent-session-queue-ipc'
import {
  mapAgentChatStreamResultToRunResult,
  mapProductAgentChatInvokerPayload
} from './ai/product-agent-chat-invoker'
import { openExternalHttpUrl } from './external-links'
import type { Logger } from './logger'
import { isPathInsideConfiguredRoot, isRealPathInsideRoot } from './path-access'
import { fetchUpstreamModels, probeModelProvider } from './provider-connection'
import type { SkillLibraryService } from './skill-library'
import { createAndSwitchGitBranchForWorkspace, getGitBranchesForWorkspace, listGitWorktreesForWorkspace, removeGitWorktreeForWorkspace, switchGitBranchForWorkspace } from './teaching-git'
import {
  decodeToolAnswerPayload, optionalString, parseAgentChatStreamPayload, parseApplyLessonStylePayload, parseGetTeachingPresentationPayload, parseTeachingPresentationActionPayload, parseTeachingPresentationActionResult, parseTeachingPresentationSnapshot,
  parseCommitLearningOutcomeRequest, parseCreateAgentConversationCheckpointPayload,
  parseListAgentWriteRewindJournalPayload, parseRestoreAgentWriteRewindPayload,
  parseForkAgentConversationBranchPayload, parseOpenAgentConversationBranchPayload,
  parseCreateMemoryPayload, parseCreateWorkspacePayload, parseDirectLessonActionStatusPayload, parseGenerateLessonPayload, parseGitBranchPayload,
  parseListUpstreamModelsPayload, parseNotificationPayload, parseProbeProviderPayload,
  parseQueryAgentArchivedHistoryPayload, parseReadAgentConversationPayload, parseProjectAgentConversationSummariesPayload, parseRenameAgentConversationPayload,
  parseReadAgentConversationSessionTreePayload, parseReadLessonPayload, parseReadWorkspaceChangeDiffPayload,
  parsePreviewLessonInteractionIntent,
  parseReplayAgentConversationBranchPayload,
  parseRebuildAgentHistoryIndexPayload, parseResolveAgentConversationCheckpointPayload,
  parseReadWorkspaceMarkdownPayload, parseRecordProgressPayload, parseRemoveGitWorktreePayload, parseReplayAgentChatEventsPayload, parseSteerAgentChatPayload, parseFollowUpAgentChatPayload, parseProjectAgentSessionQueuePayload,
  parseSaveAgentConversationPayload, parseSaveWorkspaceMarkdownPayload, parseSettingsPatch,
  parseUpdateAgentConversationBranchStatusPayload, parseUpdateMemoryPayload, parseUpdateMissionPayload, parseSetWorkspaceTrustPayload,
  parseWorkspaceItemMetaPayload,
  parseWorkspaceItemRemovePayload, parseWorkspaceRemovePayload, parseRunTeachingDoctorPayload, parseProjectTeachingTurnReviewPayload, parseDecideTeachingTurnReviewPayload, parseProjectTeachingTurnReviewHandoffPayload, parseGetTeachingTurnReviewLastBundlePayload, parseSaveTeachingTurnReviewLastBundlePayload, requireStreamId, requireString,
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
import type { TeachingTurnCoordinatorHost } from './teaching-turn-coordinator-host'
import { teachingEventChannels, teachingInvokeChannels } from '../shared/teaching-ipc-contract'
import { createTeachingDoctorCatalogDriftFactsCollector, createTeachingDoctorConfigFactsCollector, createTeachingDoctorMcpFactsCollector, createTeachingDoctorSessionOutcomeScanFactsCollector, createTeachingDoctorSourceGapFactsCollector, runProductTeachingDoctor, type ProductTeachingDoctorCrashMarkerStore } from './observability'
import { createLearningSessionLedger } from './learning-session-ledger'
import { planLessonIndexReconciliation } from './teaching-workspace/catalog-reconciliation'
import {
  runDecideTeachingTurnReviewIpc,
  runProjectTeachingTurnReviewHandoffIpc,
  runProjectTeachingTurnReviewIpc
} from './teaching-turn-review-ipc'
import {
  runGetTeachingTurnReviewLastBundleIpc,
  runSaveTeachingTurnReviewLastBundleIpc
} from './teaching-turn-review-last-bundle-ipc'
import {
  parseApplyStudyPlanningPayload,
  parseReadStudyPlanningPayload,
  runApplyStudyPlanningIpc,
  runReadStudyPlanningIpc
} from './study-planning-ipc'
import type { AnalyticsExportRequest, ClearAnalyticsRequest, LearningAnalyticsRequest, TeachingSettingsV1 } from '../shared/teaching-types'
import {
  normalizeAgentSandboxMode,
  resolveAgentSandboxReadiness
} from './ai/tools/agent-sandbox-policy'

/** Dependencies owned by the main-process Teaching IPC composition root. */
export interface TeachingIpcRegistration {
  workspaceService: TeachingWorkspaceService
  settingsService: TeachingSettingsService
  skillLibraryService: SkillLibraryService
  learningAnalyticsService: LearningAnalyticsService
  logger: Pick<Logger, 'error' | 'path'>
  applyAppBehavior: (settings: TeachingSettingsV1) => Promise<void>
  /**
   * Optional sole-writer host for teaching-turn / outcome commits.
   * When provided, commitLearningOutcome routes through TeachingTurnCoordinator
   * instead of renderer-driven service orchestration.
   */
  turnCoordinatorHost?: TeachingTurnCoordinatorHost
  /**
   * Optional local crash-marker store for product TeachingDoctor IPC (ADR-0084).
   * Read-only for this channel; clear is a separate deliberate effect.
   */
  crashMarkerStore?: ProductTeachingDoctorCrashMarkerStore | null
  /**
   * Optional user MCP status source for TeachingDoctor (ADR-0128 Phase E).
   * Secret-free only; collector redacts command labels further.
   */
  mcpFactsSource?: {
    loadConfig(): Promise<import('../shared/mcp/types').UserMcpConfigV1 | null>
    listRuntime(): readonly import('../shared/mcp/types').McpRuntimeServerView[]
    getHostAggregates?(): {
      effectiveSourceCount?: number
      sourceWarningCount?: number
      marketplaceEmergencyDisabled?: boolean
    } | null
  } | null
}


type GatewayContext = TeachingIpcRegistration & {
  activeAgentChatStreams: Map<string, AbortController>
  retainedAgentEventBuses: Map<string, AgentEventBus>
  agentStreamSessions: WeakMap<Electron.IpcMainInvokeEvent, AgentStreamSession>
  /**
   * Per-stream busy follow-up/steer queues (B-01 / B-02).
   * Cancel always clears via clearOnCancel. Façade owns drain policy; gateway
   * only holds the optional registry for stream-keyed attach/abort.
   */
  agentInputQueues: AgentInputQueueRegistry
  /**
   * Optional AgentSessionFacade registry (B-02). Service layer may attach a
   * façade per streamId; cancel aborts + detaches when present. Does not replace
   * TeachingSessionProtocol (ADR-0040).
   */
  agentSessionFacades: AgentSessionFacadeRegistry
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
    agentInputQueues: new AgentInputQueueRegistry(),
    agentSessionFacades: new AgentSessionFacadeRegistry(),
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
    command({ channel: teachingInvokeChannels.setWorkspaceTrust, parser: (payload) => parseSetWorkspaceTrustPayload(payload), action: (_event, payload) => service.setWorkspaceTrust(payload.workspaceId, payload.trust), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.applyLessonStyle, parser: (payload) => parseApplyLessonStylePayload(payload), action: (_event, payload) => service.applyLessonStyle(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listSkills, parser: () => undefined, action: () => skills.listSkills(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.installSkill, parser: (skillId) => requireString(skillId, 'skillId'), action: (_event, skillId) => skills.installSkill(skillId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.generateLesson, parser: (payload) => parseGenerateLessonPayload(payload), action: (_event, payload) => service.generateLesson(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getDirectLessonActionStatus, parser: (payload) => parseDirectLessonActionStatusPayload(payload), action: (_event, payload) => service.getDirectLessonActionStatus(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
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
        // B-02: product stream is driven through AgentSessionFacade.prompt with a real
        // invoker that calls service.agentChatStream once (not a second loop).
        // autoDrain stays false (ADR-0082): mid-run steer/follow-up IPC is available, but product
        // multi-turn autoDrain remains off until renderer queue sync lands (ADR-0067 residual).
        // createAbortController always returns the shared controller so cancel aborts
        // the same signal the service stream observes.
        let productStreamResult: Awaited<ReturnType<TeachingWorkspaceService['agentChatStream']>> | undefined
        const facade = new AgentSessionFacade({
          streamId,
          conversationId: payload.conversationId,
          createAbortController: () => controller,
          autoDrain: false,
          run: async (invokerInput) => {
            try {
              const mappedPayload = mapProductAgentChatInvokerPayload(payload, {
                text: invokerInput.text,
                conversationId: invokerInput.conversationId,
                expectedRevision: invokerInput.expectedRevision,
                streamId: invokerInput.streamId ?? streamId,
                runId: invokerInput.runId
              })
              const result = await service.agentChatStream(mappedPayload, {
                streamId,
                signal: invokerInput.signal,
                onChunk: (chunk) => safeSend(event.sender, teachingEventChannels.agentChatChunk, chunk),
                onStatus: (status) => safeSend(event.sender, teachingEventChannels.agentChatStatus, status),
                onTool: (toolEvent) => safeSend(event.sender, teachingEventChannels.agentChatTool, toolEvent),
                onRealtimeEvent: (realtimeEvent) => safeSend(event.sender, teachingEventChannels.agentChatEvent, realtimeEvent),
                onEventBusReady: (eventBus) => retainAgentEventBus(streamId, eventBus)
              })
              productStreamResult = result
              return mapAgentChatStreamResultToRunResult(streamId, result)
            } catch (error) {
              if (invokerInput.signal.aborted || controller.signal.aborted) {
                productStreamResult = { canceled: true as const }
                return { streamId, canceled: true }
              }
              const message = errorMessage(error)
              context.logger.error(`Agent chat stream failed: ${message}`)
              productStreamResult = { error: true as const, message }
              return { streamId, error: message }
            }
          }
        })
        context.agentSessionFacades.attach(streamId, facade)
        try {
          // Idle prompt → accept + run. prompt() sets phase provider while live and
          // settles to idle/turn_boundary; do not pre-set provider (would busy-queue).
          const promptResult = await facade.prompt({
            text: payload.userInput,
            conversationId: payload.conversationId,
            expectedRevision: payload.expectedBranchRevision
          })
          if (!promptResult.ok) {
            // Unexpected on first turn (idle); fail closed without inventing a second loop.
            return {
              streamId,
              error: true as const,
              message: `Agent session rejected prompt: ${promptResult.reason}`
            }
          }
          if (productStreamResult !== undefined) {
            return { streamId, ...productStreamResult }
          }
          // Invoker returned without capturing (e.g. empty DEFAULT); map façade run.
          const run = promptResult.run
          if (run?.canceled) return { streamId, canceled: true as const }
          if (run?.error) return { streamId, error: true as const, message: run.error }
          return {
            streamId,
            error: true as const,
            message: 'Agent chat stream completed without a product result.'
          }
        } catch (error) {
          if (controller.signal.aborted) return { streamId, canceled: true as const }
          const message = errorMessage(error); context.logger.error(`Agent chat stream failed: ${message}`); return { streamId, error: true as const, message }
        } finally {
          // Detach when stream ends cleanly; cancel path uses abortAndDetach first.
          context.agentSessionFacades.detach(streamId)
          facade.setPhase('idle')
        }
      },
      reply: identityReply,
      streamCleanup: (event) => {
        const session = context.agentStreamSessions.get(event)
        if (!session) return
        if (context.activeAgentChatStreams.get(session.streamId) === session.controller) context.activeAgentChatStreams.delete(session.streamId)
        context.agentStreamSessions.delete(event)
        // Safety: drop façade if action finally did not run (e.g. parse failure).
        context.agentSessionFacades.detach(session.streamId)
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
        // B-01/B-02: cancel clears queued follow-up/steer (registry + optional façade).
        // steer ≠ silent drop on cancel; façade.abort also clearOnCancel+reopen its own queue.
        context.agentSessionFacades.abortAndDetach(streamId, 'cancel_agent_chat_stream')
        context.agentInputQueues.clearOnCancel(streamId, 'cancel_agent_chat_stream')
        cancelStreamAskPending(streamId); cancelStreamToolPermissionPending(streamId)
        return { canceled: Boolean(controller) }
      }, reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.steerAgentChatStream,
      parser: (payload) => parseSteerAgentChatPayload(payload),
      action: async (_event, payload) => {
        // Mid-run steer delegates to the attached façade (≠ abort). Product autoDrain stays false.
        const facade = context.agentSessionFacades.get(payload.streamId)
        if (!facade) return noActiveAgentSessionIpcResult()
        const result = await facade.steer({
          text: payload.text,
          conversationId: payload.conversationId,
          expectedRevision: payload.expectedRevision
        })
        return mapAgentSessionPromptResultToIpc(result, facade.snapshot())
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.followUpAgentChatStream,
      parser: (payload) => parseFollowUpAgentChatPayload(payload),
      action: async (_event, payload) => {
        // Mid-run follow-up: busy policy queues by default; does not flip autoDrain.
        const facade = context.agentSessionFacades.get(payload.streamId)
        if (!facade) return noActiveAgentSessionIpcResult()
        const result = await facade.followUp({
          text: payload.text,
          conversationId: payload.conversationId,
          expectedRevision: payload.expectedRevision
        })
        return mapAgentSessionPromptResultToIpc(result, facade.snapshot())
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.projectAgentSessionQueue,
      parser: (payload) => parseProjectAgentSessionQueuePayload(payload),
      action: (_event, payload) => {
        // Read-only queue projection (ADR-0091 / ADR-0089). Product autoDrain remains false.
        // Never drains, steers, prompts, aborts, or flips autoDrain.
        const facade = context.agentSessionFacades.get(payload.streamId)
        return runProjectAgentSessionQueueIpc(payload, facade)
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.answerAgentChatTool, parser: (payload) => decodeToolAnswerPayload(payload),
      action: (_event, payload) => { if (!resolveAskPending(payload.streamId, payload.toolCallId, payload.answers)) resolveToolPermissionPending(payload.streamId, payload.toolCallId, payload.answers); return { ok: true } },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.renameAgentConversation,
      parser: (payload) => parseRenameAgentConversationPayload(payload),
      action: async (_event, payload) => { const result = await service.renameAgentConversation(payload); analytics.invalidate(['conversation']); return result },
      reply: identityReply,
      streamCleanup: noStreamCleanup
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
    command({ channel: teachingInvokeChannels.projectAgentConversationSummaries, parser: (payload) => parseProjectAgentConversationSummariesPayload(payload), action: (_event, payload) => service.projectAgentConversationSummaries(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.readAgentConversationSessionTree, parser: (payload) => parseReadAgentConversationSessionTreePayload(payload), action: (_event, payload) => service.readAgentConversationSessionTree(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.openAgentConversationBranch, parser: (payload) => parseOpenAgentConversationBranchPayload(payload), action: (_event, payload) => service.openAgentConversationBranch(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.forkAgentConversationBranch, parser: (payload) => parseForkAgentConversationBranchPayload(payload), action: async (_event, payload) => { const result = await service.forkAgentConversationBranch(payload); analytics.invalidate(['conversation']); return result }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.replayAgentConversationBranch, parser: (payload) => parseReplayAgentConversationBranchPayload(payload), action: (_event, payload) => service.replayAgentConversationBranch(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.updateAgentConversationBranchStatus, parser: (payload) => parseUpdateAgentConversationBranchStatusPayload(payload), action: async (_event, payload) => { const result = await service.updateAgentConversationBranchStatus(payload); analytics.invalidate(['conversation']); return result }, reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.createAgentConversationCheckpoint, parser: (payload) => parseCreateAgentConversationCheckpointPayload(payload), action: (_event, payload) => service.createAgentConversationCheckpoint(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.resolveAgentConversationCheckpoint, parser: (payload) => parseResolveAgentConversationCheckpointPayload(payload), action: (_event, payload) => service.resolveAgentConversationCheckpoint(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.restoreAgentWriteRewind, parser: (payload) => parseRestoreAgentWriteRewindPayload(payload), action: (_event, payload) => service.restoreAgentWriteRewind(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listAgentWriteRewindJournal, parser: (payload) => parseListAgentWriteRewindJournalPayload(payload), action: (_event, payload) => service.listAgentWriteRewindJournal(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.queryAgentArchivedHistory, parser: (payload) => parseQueryAgentArchivedHistoryPayload(payload), action: (_event, payload) => service.queryAgentArchivedHistory(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.rebuildAgentHistoryIndex, parser: (payload) => parseRebuildAgentHistoryIndexPayload(payload), action: (_event, payload) => service.rebuildAgentHistoryIndex(payload), reply: identityReply, streamCleanup: noStreamCleanup }),
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
      action: (_event, request) => {
        if (!request) return { status: 'non_retryable_failure' as const, reason: 'invalid_request' as const }
        // Prefer coordinator host when composed so production sole-writer stays on main.
        if (context.turnCoordinatorHost) return context.turnCoordinatorHost.commitLearningOutcome(request)
        return service.commitLearningOutcome(request)
      },
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
      channel: teachingInvokeChannels.getAgentSandboxReadiness,
      parser: () => undefined,
      action: async () => {
        const loadedSettings = await settings.load()
        const mode = normalizeAgentSandboxMode(loadedSettings.tools?.sandboxMode, 'workspace_write')
        return resolveAgentSandboxReadiness({
          mode,
          windowsSandboxLevel: loadedSettings.tools?.windowsSandboxLevel
        })
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.getTeachingPresentation,
      parser: (payload) => parseGetTeachingPresentationPayload(payload),
      action: async () => {
        try {
          const workspaceId = (await service.getState()).activeWorkspace?.id
          if (!workspaceId || !context.turnCoordinatorHost) return null
          // This is a learner-safe read boundary. Do not surface host/ledger
          // failures (which may contain paths or diagnostic details) to renderer.
          return await context.turnCoordinatorHost.getTeachingPresentation(workspaceId)
            .then((snapshot) => parseTeachingPresentationSnapshot(snapshot))
            .catch(() => null)
        } catch {
          return null
        }
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.actOnTeachingPresentation,
      parser: (payload) => parseTeachingPresentationActionPayload(payload),
      action: async (_event, payload) => {
        try {
          const workspaceId = (await service.getState()).activeWorkspace?.id
          if (!workspaceId || !context.turnCoordinatorHost) return { status: 'unavailable' as const, snapshot: null }
          // Fail closed rather than forwarding host/ledger diagnostics through IPC.
          return await context.turnCoordinatorHost.actOnTeachingPresentation(workspaceId, payload)
            .then((result) => parseTeachingPresentationActionResult(result))
            .catch(() => ({ status: 'unavailable' as const, snapshot: null }))
        } catch {
          return { status: 'unavailable' as const, snapshot: null }
        }
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
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
    }),
    command({
      channel: teachingInvokeChannels.runTeachingDoctor,
      parser: (payload) => parseRunTeachingDoctorPayload(payload),
      action: async (_event, request) => runProductTeachingDoctor(request, {
        crashMarkerStore: context.crashMarkerStore ?? null,
        factsCollectors: [
          createTeachingDoctorConfigFactsCollector({
            load: () => context.settingsService.load()
          }),
          createTeachingDoctorSessionOutcomeScanFactsCollector({
            loadScan: async () => {
              const state = await context.workspaceService.getState()
              const ws = state.activeWorkspace
              if (!ws?.rootPath) return null
              // Thin composition: public ledger factory only — no peel of FileLearningSessionLedger internals.
              return createLearningSessionLedger({ workspaceRoot: ws.rootPath }).scan()
            }
          }),
          createTeachingDoctorCatalogDriftFactsCollector({
            loadPlan: async () => {
              const state = await context.workspaceService.getState()
              const ws = state.activeWorkspace
              if (!ws) return null
              const plan = await planLessonIndexReconciliation({
                rootPath: ws.rootPath,
                workspaceName: ws.name,
                workspaceId: ws.id,
                lessons: ws.lessons
              })
              return {
                requiresPersist: plan.requiresPersist,
                recoveredRelativePaths: plan.recoveredRelativePaths,
                removedRelativePaths: plan.removedRelativePaths
              }
            }
          }),
          createTeachingDoctorSourceGapFactsCollector({
            loadSummary: async () => {
              const state = await context.workspaceService.getState()
              const ws = state.activeWorkspace
              if (!ws) return null
              return {
                resourcesCount: Array.isArray(ws.resources) ? ws.resources.length : 0,
                referenceCount: typeof ws.referenceCount === 'number' ? ws.referenceCount : 0,
                assetsReady: ws.assetsReady === true
              }
            }
          }),
          ...(context.mcpFactsSource
            ? [
                createTeachingDoctorMcpFactsCollector({
                  loadConfig: () => context.mcpFactsSource!.loadConfig(),
                  listRuntime: () => context.mcpFactsSource!.listRuntime(),
                  getHostAggregates: () =>
                    context.mcpFactsSource!.getHostAggregates?.() ?? null
                })
              ]
            : [])
        ]
      }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.projectTeachingTurnReview,
      parser: (payload) => parseProjectTeachingTurnReviewPayload(payload),
      // Pure projection only — never auto-apply / installSkill / createMemory / write files.
      action: (_event, payload) => runProjectTeachingTurnReviewIpc(payload),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.decideTeachingTurnReview,
      parser: (payload) => parseDecideTeachingTurnReviewPayload(payload),
      // Decision submit maps to the same pure project path; approved ids are not an apply plan.
      action: (_event, payload) => runDecideTeachingTurnReviewIpc(payload),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.projectTeachingTurnReviewHandoff,
      parser: (payload) => parseProjectTeachingTurnReviewHandoffPayload(payload),
      // Pure handoff intents only — never auto-apply / installSkill / createMemory / write files.
      action: (_event, payload) => runProjectTeachingTurnReviewHandoffIpc(payload),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.getTeachingTurnReviewLastBundle,
      parser: (payload) => parseGetTeachingTurnReviewLastBundlePayload(payload),
      // Durable last-bundle read only — never auto-apply / installSkill / createMemory.
      action: async () =>
        runGetTeachingTurnReviewLastBundleIpc({ rootPath: app.getPath('userData') }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.saveTeachingTurnReviewLastBundle,
      parser: (payload) => parseSaveTeachingTurnReviewLastBundlePayload(payload),
      // Durable last-bundle write only — never auto-apply after save.
      action: async (_event, payload) =>
        runSaveTeachingTurnReviewLastBundleIpc(payload, { rootPath: app.getPath('userData') }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.readStudyPlanning,
      parser: (payload) => parseReadStudyPlanningPayload(payload),
      // ADR-0117: workspace-scoped snapshot read; registered roots only.
      action: async (_event, payload) =>
        runReadStudyPlanningIpc(payload, async (raw) => {
          const access = await resolveGitWorkspaceRoot(raw)
          return access.ok
            ? { ok: true as const, rootPath: access.rootPath }
            : { ok: false as const, message: access.message }
        }),
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.applyStudyPlanning,
      parser: (payload) => parseApplyStudyPlanningPayload(payload),
      // ADR-0117: sole-writer apply with revision CAS; no silent first-task bind here.
      action: async (_event, payload) =>
        runApplyStudyPlanningIpc(payload, async (raw) => {
          const access = await resolveGitWorkspaceRoot(raw)
          return access.ok
            ? { ok: true as const, rootPath: access.rootPath }
            : { ok: false as const, message: access.message }
        }),
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




