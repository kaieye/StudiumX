import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { cancelStreamAskPending, resolveAskPending } from './ai/ask-pending'
import { cancelStreamToolPermissionPending, resolveToolPermissionPending } from './ai/tool-permission-pending'
import type { AgentEventBus } from './ai/agent-event-bus'
import { AgentInputQueueRegistry } from './ai/agent-input-queue'
import {
  AgentConversationTurnLane,
  type AgentConversationTurnLaneActiveReservation,
  type ConversationLaneKey,
  type SubmitConversationTurnIntent
} from './ai/agent-conversation-turn-lane'
import { AgentSessionFacade, AgentSessionFacadeRegistry } from './ai/agent-session-facade'
import {
  mapAgentSessionPromptResultToIpc,
  noActiveAgentSessionIpcResult,
  rejectExplicitSkillInvocationSteerFollowUp
} from './ai/agent-chat-steer-followup-ipc'
import { runProjectAgentSessionQueueIpc } from './ai/agent-session-queue-ipc'
import {
  mapAgentChatStreamResultToRunResult,
  mapProductAgentChatInvokerPayload
} from './ai/product-agent-chat-invoker'
import { openExternalHttpUrl } from './external-links'
import { actOnAppUpdate, checkForAppUpdates, openAppUpdateDialog } from './app-updater'
import type { Logger } from './logger'
import { isPathInsideConfiguredRoot, isRealPathInsideRoot } from './path-access'
import { fetchUpstreamModels, probeModelProvider } from './provider-connection'
import type { SkillLibraryService } from './skill-library'
import { getSkillOrchestrationEligibility } from './builtin-skill-orchestration-policy'
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
  parseReadWorkspaceMarkdownPayload, parseRecordProgressPayload, parseRemoveGitWorktreePayload, parseReplayAgentChatEventsPayload, parseSteerAgentChatPayload, parseFollowUpAgentChatPayload, parseProjectAgentSessionQueuePayload, parsePreviewSkillOrchestrationPayload,
  parseSaveAgentConversationPayload, parseSaveWorkspaceMarkdownPayload, parseSettingsPatch,
  parseUpdateAgentConversationBranchStatusPayload, parseUpdateMemoryPayload, parseUpdateMissionPayload, parseSetWorkspaceTrustPayload,
  parseWorkspaceItemMetaPayload,
  parseSubmitConversationTurnIntent,
  parseCancelConversationTurnIntent,
  parseWorkspaceItemRemovePayload, parseWorkspaceRemovePayload, parseRunTeachingDoctorPayload, parseProjectTeachingTurnReviewPayload, parseDecideTeachingTurnReviewPayload, parseProjectTeachingTurnReviewHandoffPayload, parseGetTeachingTurnReviewLastBundlePayload, parseSaveTeachingTurnReviewLastBundlePayload, requireStreamId, requireString,
  requireWindowControlAction,
  parseMindMapListPayload, parseMindMapCreatePayload, parseMindMapAccessPayload, parseMindMapAssetImportPayload, parseMindMapAssetReadPayload, parseMindMapUpdatePayload, parseMindMapFlushPayload, parseMindMapSourceRefreshPayload, parseMindMapGeneratePayload, parseMindMapProposalGeneratePayload, parseMindMapCancelGenerationPayload, parseMindMapImportPayload, parseMindMapMarkdownImportPayload, parseMindMapOpmlImportPayload, parseMindMapExportPayload, parseMindMapMarkdownExportPayload, parseMindMapOpmlExportPayload, parseMindMapSvgExportPayload, parseMindMapPngExportPayload
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
import { createMindMapStore } from './mindmap/mind-map-store'
import {
  parseMindMapSourceRefreshApplyPayload
} from './mindmap/mind-map-ipc-commands'
import { previewMindMapSourceRefresh } from './mindmap/mind-map-source-refresh'
import { MindMapAssetError, MindMapAssetStore } from './mindmap/mind-map-assets'
import type { MindMapStore } from './mindmap/mind-map-store'
import {
  cancelMindMapGeneration,
  generateMindMap,
  generateMindMapProposal,
  MindMapGenerationError
} from './mindmap/mind-map-generation'
import {
  MindMapLessonError,
  MindMapSelectedFileError,
  resolveMindMapLesson,
  resolveMindMapNotes,
  resolveSelectedMindMapFile
} from './mindmap/mind-map-selected-file'
import { exportMindMapMarkdownFile } from './mindmap/markdown-file'
import { importMindMapMarkdownFile } from './mindmap/markdown-import-file'
import { importMindMapOpmlFile } from './mindmap/opml-import-file'
import { exportMindMapOpmlFile } from './mindmap/opml-file'
import { exportMindMapSvgFile } from './mindmap/svg-file'
import { exportMindMapPngFile } from './mindmap/png-file'
import { parseMindMapProposalApplyPayload } from './mindmap/mind-map-proposal-ipc'
import {
  exportXmindFileV2,
  readXmindFileWithCompatibilityReport
} from './mindmap/xmind-file'
import type { AgentChatStreamPayload, AgentChatTurn, AgentConversationTurnStartedRealtimeEvent, AgentRealtimeEvent, AnalyticsExportRequest, AppUpdateAction, ClearAnalyticsRequest, LearningAnalyticsRequest, MindMapStreamStep, TeachingSettingsV1 } from '../shared/teaching-types'
import type { MindMapAssetRef, MindMapDocumentV2 } from '../shared/mindmap/domain/types'
import type { MindMapDocument } from '../shared/mindmap/mind-map-types'
import {
  HOME_MIND_MAP_WORKSPACE_ID,
  type MindMapUpdateResult
} from '../shared/teaching-types/mindmap'
import { migrateV1ToV2 } from '../shared/mindmap/migrations'
import { applyMindMapProposal as applyReviewedMindMapProposal } from '../shared/mindmap/commands/mind-map-proposal'
import { applyMindMapCommand } from '../shared/mindmap/commands/mind-map-reducer'
import { buildMindMapSourceRefreshCommand } from '../shared/mindmap/commands/mind-map-source-refresh'
import { buildMindMapProposalRequest } from '../shared/mindmap/commands/mind-map-proposal-request'
import { assessMindMapExportSnapshotReadiness } from '../shared/mindmap/export-readiness'
import { getMindMapSvgExportDimensions } from '../shared/mindmap/svg-export'
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
   * Optional mind-map repository factory for host-owned composition and fault-injection tests.
   * Production callers use the durable file-backed store by default.
   */
  mindMapStoreFactory?: (rootPath: string) => MindMapStore
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
  agentStreamSessions: WeakMap<Electron.IpcMainInvokeEvent, Set<AgentStreamSession>>
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
  /** Main-only ADR-0170 lane; its snapshot deliberately contains no turn text. */
  conversationTurnLane: AgentConversationTurnLane
  /** Exact stream-to-lane bindings used to bridge the legacy cancel capability safely. */
  conversationTurnStreams: Map<string, ConversationTurnStreamBinding>
  /** Private reservation-to-renderer ownership; never projected through lane snapshots or DTOs. */
  conversationTurnOwners: Map<string, ConversationTurnOwnerBinding>
  /** Canonical legacy streams are guarded from racing a migrated host lane. */
  legacyConversationTargets: Map<string, ConversationLaneKey>
  /** Weakly remembers senders whose preview lifecycle hooks are already installed. */
  previewBindingLifecycleSenders: WeakSet<Electron.WebContents>
}

type AgentStreamSession = { streamId: string; controller: AbortController; payload: unknown }

type ConversationTurnStreamBinding = {
  target: ConversationLaneKey
  activeTurnId: string
  controller: AbortController
  facade: AgentSessionFacade
}

type ConversationTurnOwnerBinding = {
  target: ConversationLaneKey
  clientRequestId: string
  sender: Electron.WebContents
}

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
    conversationTurnLane: new AgentConversationTurnLane(),
    conversationTurnStreams: new Map(),
    conversationTurnOwners: new Map(),
    legacyConversationTargets: new Map(),
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

  /**
   * Root of the global home mind-map location (`<defaultRoot>/MindMaps`),
   * separate from every teaching workspace's `mindmaps/` folder. Maps created
   * directly on the home page live here.
   */
  let homeMindMapRoot: string | null = null
  const resolveHomeMindMapRoot = async (): Promise<string> => {
    if (homeMindMapRoot) return homeMindMapRoot
    const loaded = await settings.load()
    const defaultRoot = loaded.workspace.defaultRoot || app.getPath('documents')
    homeMindMapRoot = join(defaultRoot, 'MindMaps')
    return homeMindMapRoot
  }

  /**
   * Mind-map store for a resolved root. The home location writes maps directly
   * into its root (`MindMaps/`); every workspace store uses the default
   * `mindmaps/` subfolder. Test factories are honored for workspace roots.
   */
  const getMindMapStore = (rootPath: string): MindMapStore => {
    const factory = context.mindMapStoreFactory ?? createMindMapStore
    if (homeMindMapRoot && resolve(rootPath) === resolve(homeMindMapRoot)) {
      return createMindMapStore(rootPath, '')
    }
    return factory(rootPath)
  }
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

  /**
   * Resolve the workspace root for mind-map IPC. Prefers the explicitly provided
   * registered `workspaceId`; otherwise falls back to the active workspace root.
   */
  const resolveMindMapWorkspaceRoot = async (workspaceId: string): Promise<string> => {
    // The reserved home sentinel addresses the global MindMaps location
    // (`~/Documents/StudiumX Workspaces/MindMaps`), independent of any teaching
    // workspace. It reuses the same per-document IPC lanes unchanged.
    if (workspaceId === HOME_MIND_MAP_WORKSPACE_ID) {
      return resolveHomeMindMapRoot()
    }
    const state = await service.getState()
    if (workspaceId) {
      // Mind-map IPC envelopes carry the registered workspace identifier. Keep
      // the path lookup as a compatibility fallback for older callers, but do
      // not require renderers to expose a workspace root as an identifier.
      const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId)
      if (workspace) return workspace.rootPath

      const access = await resolveRegisteredWorkspaceRoot(state.workspaces, workspaceId)
      if (access.ok) return access.rootPath
      throw new Error(`Mind map workspace unavailable: ${access.message}`)
    }
    const activeRoot = state.activeWorkspace?.rootPath
    if (!activeRoot) throw new Error('Mind map requires an active teaching workspace.')
    return activeRoot
  }

  /**
   * Normalize a `MindMapGenerationError` into a structured, renderer-safe error.
   * Provider/transport details are classified by the generation module; we surface
   * the canonical message and keep the error kind for the caller.
   */
  /** Narrow guard: a strict envelope parser returned null → structured error. */
  const requireMindMapPayload = <Payload>(payload: Payload | null, channel: string): Payload => {
    if (payload === null) throw new Error(`Invalid IPC payload for ${channel}.`)
    return payload
  }

  const mindMapGenerationIpcError = (error: unknown): Error => {
    if (error instanceof MindMapGenerationError) {
      return new Error(`Mind map generation failed (${error.kind}): ${error.message}`)
    }
    return error instanceof Error ? error : new Error(String(error))
  }

  /** Normalize selected-file failures without returning absolute paths or raw content. */
  const mindMapSelectedFileIpcError = (error: unknown): Error => {
    if (error instanceof MindMapSelectedFileError) {
      return new Error(`Mind map selected file failed (${error.code}): ${error.message}`)
    }
    return new Error('Mind map selected file could not be resolved safely.')
  }

  /** Normalize fixed `NOTES.md` failures without returning absolute paths or raw content. */
  const mindMapNotesIpcError = (error: unknown): Error => {
    if (error instanceof MindMapSelectedFileError) {
      return new Error(`Mind map notes failed (${error.code}): ${error.message}`)
    }
    return new Error('Mind map NOTES.md could not be resolved safely.')
  }

  /** Normalize Lesson failures without returning absolute paths or raw HTML. */
  const mindMapLessonIpcError = (error: unknown): Error => {
    if (error instanceof MindMapLessonError) {
      return new Error(`Mind map lesson failed (${error.code}): ${error.message}`)
    }
    return new Error('Mind map Lesson could not be resolved safely.')
  }

  /** Unwrap a CAS update result, surfacing a revision conflict as a structured error. */
  const unwrapMindMapUpdate = (result: MindMapUpdateResult, channel: string): MindMapDocumentV2 => {
    if (result.ok) return result.document
    throw new Error(
      `Mind map save conflict on ${channel}: expected revision ${result.expectedRevision}, current revision ${result.currentRevision}`
    )
  }

  /**
   * Imports are a two-phase repository operation: create establishes the
   * destination identity, then update publishes the imported document. If the
   * second phase fails (including a CAS conflict), remove the destination so a
   * failed import cannot leave an empty product or durable-write artifacts.
   */
  const persistImportedMindMap = async (
    rootPath: string,
    imported: MindMapDocumentV2,
    fallbackTitle: string,
    channel: string
  ): Promise<MindMapDocumentV2> => {
    const store = getMindMapStore(rootPath)
    let created: MindMapDocumentV2 | undefined
    try {
      created = await store.create(imported.title || fallbackTitle)
      const result = await store.update(
        created.id,
        {
          ...imported,
          id: created.id,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt
        },
        created.revision
      )
      return unwrapMindMapUpdate(result, channel)
    } catch (error) {
      if (created) await store.remove(created.id).catch(() => undefined)
      throw error
    }
  }

  /**
   * ADR-0170 host runner. This function accepts only an already-reserved lane
   * identity; it is deliberately not a general replacement for the legacy IPC
   * stream entry point.
   */
  const startReservedConversationTurn = (reservation: AgentConversationTurnLaneActiveReservation): void => {
    const owner = findConversationTurnOwner(context, reservation)
    if (!owner || owner.sender.isDestroyed()) {
      // A queued reservation must never inherit a prior renderer's event sink.
      // If its owner disappeared before activation, cancel this exact lane and
      // clear its FIFO rather than starting a model run without a safe receiver.
      const cancelled = context.conversationTurnLane.cancel({
        target: reservation.target,
        clientRequestId: `host-owner-unavailable:${reservation.streamId}:${reservation.activeTurnId}`,
        expectedActiveTurnId: reservation.activeTurnId
      })
      if (cancelled.code === 'cancelled') {
        clearConversationTurnOwnersForTarget(context, reservation.target)
        context.conversationTurnLane.complete({
          target: reservation.target,
          activeTurnId: reservation.activeTurnId,
          streamId: reservation.streamId
        })
      }
      return
    }
    // This is deliberately sent on the typed realtime event channel rather
    // than as an untyped side channel. A direct starter already knows its
    // stream from the disposition; a queued owner uses this correlation to
    // begin projecting the newly activated stream.
    safeSend(owner.sender, teachingEventChannels.agentChatEvent, conversationTurnStartedEvent(reservation))
    void runReservedConversationTurn(owner.sender, reservation)
  }

  const runReservedConversationTurn = async (
    sender: Electron.WebContents,
    reservation: AgentConversationTurnLaneActiveReservation
  ): Promise<void> => {
    const { streamId, activeTurnId, intent } = reservation
    let releaseTarget = reservation.target
    const controller = new AbortController()
    let productStreamResult: Awaited<ReturnType<TeachingWorkspaceService['agentChatStream']>> | undefined
    const runtime = { eventBus: null as AgentEventBus | null }
    let latestRealtimeSequence = 0
    let terminalObserved = false

    const forwardRealtimeEvent = (event: AgentRealtimeEvent): void => {
      latestRealtimeSequence = Math.max(latestRealtimeSequence, event.sequence)
      if (event.kind === 'terminal') terminalObserved = true
      safeSend(sender, teachingEventChannels.agentChatEvent, event)
    }

    const facade = new AgentSessionFacade({
      streamId,
      conversationId: reservation.target.kind === 'canonical' ? reservation.target.conversationId : undefined,
      createAbortController: () => controller,
      // The lane, rather than the façade, is the sole automatic queue consumer
      // for this migrated host path.
      autoDrain: false,
      run: async (invokerInput) => {
        try {
          const canonical = await loadCanonicalConversationForReservation(service, reservation)
          // Cancellation may arrive while canonical state is being read. Do not
          // start a provider run after the exact lane reservation was cancelled.
          if (invokerInput.signal.aborted || controller.signal.aborted) return { streamId, canceled: true }
          // The renderer revision is only an observation. Every reservation,
          // including one promoted from FIFO, starts from the just-read canonical
          // branch revision rather than rejecting or reusing a stale claim.
          const payload = conversationReservationPayload({ reservation, canonical })
          const result = await service.agentChatStream(payload, {
            streamId,
            signal: invokerInput.signal,
            onChunk: (chunk) => safeSend(sender, teachingEventChannels.agentChatChunk, chunk),
            onStatus: (status) => safeSend(sender, teachingEventChannels.agentChatStatus, status),
            onTool: (toolEvent) => safeSend(sender, teachingEventChannels.agentChatTool, toolEvent),
            onRealtimeEvent: forwardRealtimeEvent,
            onEventBusReady: (eventBus) => {
              runtime.eventBus = eventBus
              retainAgentEventBus(streamId, eventBus)
            }
          })
          productStreamResult = result
          if ('error' in result && result.error) return { streamId, error: result.message, stopReason: result.stopReason }
          if ('canceled' in result && result.canceled) return { streamId, canceled: true }
          if ('resourceStopped' in result && result.resourceStopped) return {
            streamId,
            resourceStopped: true,
            status: result.status,
            message: result.message,
            stopReason: result.stopReason,
            usage: result.usage
          }
          if (!('turns' in result)) return { streamId, error: 'conversation_turn_result_unavailable' }

          // The runtime may return a complete transcript, but it must prove the
          // canonical prefix byte-for-byte before host is permitted to persist it.
          // A delta-only or divergent response is not safe to append by guesswork.
          const turns = mergeHostConversationTurns(canonical?.record.turns ?? [], result.turns)
          if (!turns) throw new Error('conversation_transcript_prefix_mismatch')
          const saved = await service.saveAgentConversation({
            workspaceId: reservation.target.workspaceId,
            runId: streamId,
            mode: intent.mode,
            conversationId: reservation.target.kind === 'canonical' ? reservation.target.conversationId : null,
            ...(canonical ? { expectedBranchRevision: canonical.revision } : {}),
            selectedLessonPath: null,
            selectedCourseRelativePath: null,
            turns
          })
          analytics.invalidate(['conversation'])

          if (reservation.target.kind === 'pending') {
            const canonicalTarget: ConversationLaneKey = {
              kind: 'canonical',
              workspaceId: reservation.target.workspaceId,
              scope: reservation.target.scope,
              conversationId: saved.conversation.id
            }
            const promotion = context.conversationTurnLane.promotePending({
              pendingTarget: reservation.target,
              canonicalTarget
            })
            if (promotion.code !== 'rekeyed') {
              // Do not allow a stale pending FIFO to execute if its canonical
              // rekey cannot be made atomically (for example, a canonical lane
              // appeared while the first save was settling).
              const cancelled = context.conversationTurnLane.cancel({
                target: reservation.target,
                clientRequestId: `host-promotion-failed:${streamId}:${activeTurnId}`,
                expectedActiveTurnId: activeTurnId
              })
              if (cancelled.code === 'cancelled') {
                clearConversationTurnOwnersForTarget(context, reservation.target)
              }
              return { streamId, error: 'conversation_lane_promotion_failed' }
            }
            releaseTarget = promotion.target
            moveConversationTurnOwnersToCanonicalTarget(context, reservation.target, promotion.target)
            const binding = context.conversationTurnStreams.get(streamId)
            if (binding && binding.activeTurnId === activeTurnId) binding.target = promotion.target
            safeSend(sender, teachingEventChannels.agentChatEvent, {
              sequence: 0,
              streamId,
              kind: 'conversation_promoted',
              createdAt: new Date().toISOString(),
              conversationId: saved.conversation.id
            })
          }
          return mapAgentChatStreamResultToRunResult(streamId, result)
        } catch (error) {
          if (invokerInput.signal.aborted || controller.signal.aborted) return { streamId, canceled: true }
          // Do not log model/save errors here: their text can contain provider,
          // transcript, or tool-sensitive data. The lane is released below.
          return { streamId, error: error instanceof Error ? error.name : 'conversation_turn_failed' }
        }
      }
    })

    context.conversationTurnStreams.set(streamId, { target: reservation.target, activeTurnId, controller, facade })
    context.activeAgentChatStreams.set(streamId, controller)
    context.agentSessionFacades.attach(streamId, facade)

    let failed = false
    try {
      const prompt = await facade.prompt({
        text: intent.text,
        conversationId: reservation.target.kind === 'canonical' ? reservation.target.conversationId : undefined
      })
      failed = !prompt.ok || Boolean(productStreamResult && 'error' in productStreamResult && productStreamResult.error)
      // A pre-run canonical rejection is represented by the façade result rather
      // than a service result, and must still unlock the exact reservation.
      if (prompt.ok && prompt.run?.error) failed = true
    } catch {
      failed = !controller.signal.aborted
    } finally {
      // A failure before runTeachingConversationTurnActive creates its event bus
      // would otherwise leave the renderer's optimistic draft permanently busy.
      if (failed && !terminalObserved) {
        const message = '对话未能完成，请重试。'
        if (runtime.eventBus) {
          runtime.eventBus.publishTerminal('error', message)
        } else {
          forwardRealtimeEvent(conversationTurnFailedEvent(streamId, latestRealtimeSequence + 1, message))
        }
      }
      context.conversationTurnStreams.delete(streamId)
      context.conversationTurnOwners.delete(conversationTurnOwnerKey(releaseTarget, intent.clientRequestId))
      if (context.activeAgentChatStreams.get(streamId) === controller) context.activeAgentChatStreams.delete(streamId)
      context.agentSessionFacades.detach(streamId)
      facade.setPhase('idle')
      cancelStreamAskPending(streamId)
      cancelStreamToolPermissionPending(streamId)

      const resourceTerminal = Boolean(productStreamResult && 'resourceStopped' in productStreamResult && productStreamResult.resourceStopped)
      const release = resourceTerminal
        ? context.conversationTurnLane.suspend({ target: releaseTarget, activeTurnId, streamId })
        : failed
          ? context.conversationTurnLane.fail({ target: releaseTarget, activeTurnId, streamId })
          : context.conversationTurnLane.complete({ target: releaseTarget, activeTurnId, streamId })
      // Resource terminals require explicit user continuation; never drain queued
      // follow-ups after a resource boundary. Retry exhaustion remains fail-path behavior.
      if (!resourceTerminal && release.code === 'released' && release.next) startReservedConversationTurn(release.next)
    }
  }

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
    command({ channel: teachingInvokeChannels.checkForAppUpdates, parser: () => undefined, action: () => checkForAppUpdates(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.openAppUpdateDialog, parser: () => undefined, action: () => openAppUpdateDialog(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.appUpdateAction, parser: (action) => action as AppUpdateAction, action: (_event, action) => actOnAppUpdate(action), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getAppVersion, parser: () => undefined, action: () => app.getVersion(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.getSettings, parser: () => undefined, action: () => settings.load(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listInterruptedAgentRuns, parser: () => undefined, action: () => service.listInterruptedAgentRuns(), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.listTerminalAgentRunNotices, parser: () => undefined, action: () => service.listTerminalAgentRunNotices(), reply: identityReply, streamCleanup: noStreamCleanup }),
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
    command({
      channel: teachingInvokeChannels.listSkills,
      parser: () => undefined,
      action: async () => {
        const catalog = await skills.listSkills()
        // The renderer consumes this projection for product surfaces only. The
        // planner retains the host registry as its final fail-closed authority.
        return {
          ...catalog,
          skills: catalog.skills.map((skill) => ({
            ...skill,
            orchestration: getSkillOrchestrationEligibility(skill)
          }))
        }
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.previewSkillOrchestration,
      parser: (payload) => parsePreviewSkillOrchestrationPayload(payload),
      action: (_event, payload) => {
        // Read-only preview (ADR-0163): reuses the turn's host assembly + pure
        // plan(), reads the ADR-0156 continuity state but never advances or
        // persists it. No ledger write, no outcome, no Evidence, no tool run.
        return service.previewSkillOrchestration(payload)
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({ channel: teachingInvokeChannels.installSkill, parser: (skillId) => requireString(skillId, 'skillId'), action: (_event, skillId) => skills.installSkill(skillId), reply: identityReply, streamCleanup: noStreamCleanup }),
    command({ channel: teachingInvokeChannels.uninstallSkill, parser: (skillId) => requireString(skillId, 'skillId'), action: (_event, skillId) => skills.uninstallSkill(skillId), reply: identityReply, streamCleanup: noStreamCleanup }),
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
      channel: teachingInvokeChannels.submitConversationTurn,
      parser: (payload) => parseSubmitConversationTurnIntent(payload),
      action: async (event, intent) => {
        // Do not create a host reservation that would race a legacy stream for
        // the exact same canonical conversation. Legacy remains compatible, but
        // cannot become a second producer for a migrated lane.
        if (intent.target.kind === 'canonical' && hasLegacyConversationTarget(context, intent.target)) {
          return { code: 'rejected' as const, reason: 'branch_unavailable' as const }
        }

        // The lane owns exact identity validation. The façade is only an
        // injection adapter, and its unsafe busy policy would otherwise queue a
        // steer behind this one reservation (with autoDrain deliberately off).
        // Reject before creating a lane receipt unless this exact active facade
        // is at an actual injection boundary; never retarget/demote to follow-up.
        if (intent.delivery === 'steer' && !canInjectHostLaneSteer(context, intent)) {
          return { code: 'refresh_required' as const, reason: 'active_turn_mismatch' as const }
        }

        const disposition = context.conversationTurnLane.submit(intent)
        if (disposition.code === 'started' || disposition.code === 'queued') {
          // Queued dispositions intentionally have no future streamId in the
          // frozen public contract. The host retains the submitter binding so
          // its eventual active stream projects only to that renderer.
          context.conversationTurnOwners.set(conversationTurnOwnerKey(intent.target, intent.clientRequestId), {
            target: intent.target,
            clientRequestId: intent.clientRequestId,
            sender: event.sender
          })
        }
        if (disposition.code === 'started') {
          const reservation: AgentConversationTurnLaneActiveReservation = {
            target: intent.target,
            activeTurnId: disposition.activeTurnId,
            streamId: disposition.streamId,
            intent
          }
          startReservedConversationTurn(reservation)
          return disposition
        }
        if (disposition.code === 'steered') {
          const binding = context.conversationTurnStreams.get(disposition.streamId)
          if (!binding || binding.activeTurnId !== disposition.activeTurnId || !sameConversationLaneKey(binding.target, intent.target)) {
            // Never use a newer stream/facade as a fallback target.
            return { code: 'refresh_required' as const, reason: 'active_turn_mismatch' as const }
          }
          const steerResult = await binding.facade.steer({ text: intent.text })
          // An unsafe façade boundary must not silently become a deferred
          // follow-up: the lane's exact `steer` intent is never retargeted.
          if (!steerResult.ok || steerResult.disposition !== 'steered') {
            return { code: 'refresh_required' as const, reason: 'active_turn_mismatch' as const }
          }
        }
        return disposition
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.cancelConversationTurn,
      parser: (payload) => parseCancelConversationTurnIntent(payload),
      action: (_event, intent) => {
        // The lane is authoritative for exact active-turn CAS and queue clearing.
        // A non-cancel disposition must never trigger best-effort stream cleanup.
        const disposition = context.conversationTurnLane.cancel(intent)
        if (disposition.code !== 'cancelled') return disposition

        // Bind cleanup to both the exact active turn and exact lane key. Never
        // fall back to another stream, even if the pending lane was promoted.
        const match = findConversationTurnStreamBinding(
          context,
          intent.target,
          disposition.cancelledActiveTurnId
        )
        if (!match) return disposition

        const { streamId, binding } = match
        clearConversationTurnOwnersForTarget(context, binding.target)
        if (!binding.controller.signal.aborted) binding.controller.abort()
        if (context.activeAgentChatStreams.get(streamId) === binding.controller) {
          context.activeAgentChatStreams.delete(streamId)
        }
        context.agentSessionFacades.abortAndDetach(streamId, 'cancel_conversation_turn')
        context.agentInputQueues.clearOnCancel(streamId, 'cancel_conversation_turn')
        cancelStreamAskPending(streamId)
        cancelStreamToolPermissionPending(streamId)
        // Do not complete/release here: the active host run owns final lane
        // release. lane.cancel already cleared its exact FIFO, so finalization
        // cannot promote a cancelled successor.
        return disposition
      },
      reply: identityReply,
      streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.agentChatStream, parser: (payload) => parseAgentChatStreamPayload(payload),
      action: async (event, payload) => {
        const suppliedStreamId = payload.streamId
        const legacyTarget = legacyCanonicalConversationTarget(payload)
        if (legacyTarget && hasActiveConversationLane(context, legacyTarget)) {
          return {
            streamId: suppliedStreamId ?? '',
            error: true as const,
            message: 'Agent conversation is already managed by the host lane.'
          }
        }
        // A retry may reuse an id only after the earlier run settled. While it
        // is active, reject the duplicate instead of replacing its controller
        // and letting two turns share one stream identity.
        if (suppliedStreamId && context.activeAgentChatStreams.has(suppliedStreamId)) {
          return {
            streamId: suppliedStreamId,
            error: true as const,
            message: 'Agent chat stream id is already active.'
          }
        }
        const streamId = suppliedStreamId ?? `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
        const controller = new AbortController()
        context.activeAgentChatStreams.set(streamId, controller)
        if (legacyTarget) context.legacyConversationTargets.set(streamId, legacyTarget)
        const senderSessions = context.agentStreamSessions.get(event) ?? new Set<AgentStreamSession>()
        senderSessions.add({ streamId, controller, payload })
        context.agentStreamSessions.set(event, senderSessions)
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
      streamCleanup: (event, payload) => {
        const senderSessions = context.agentStreamSessions.get(event)
        const session = [...(senderSessions ?? [])].find((candidate) => candidate.payload === payload)
        // A duplicate supplied stream id is rejected before it owns the sender
        // session. Its generic command cleanup must not detach the live turn.
        if (!session || session.payload !== payload) return
        if (context.activeAgentChatStreams.get(session.streamId) === session.controller) context.activeAgentChatStreams.delete(session.streamId)
        context.legacyConversationTargets.delete(session.streamId)
        senderSessions?.delete(session)
        if (senderSessions?.size === 0) context.agentStreamSessions.delete(event)
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
        const laneBinding = context.conversationTurnStreams.get(streamId)
        if (laneBinding) {
          // The public compatibility API only exposes streamId. Bind it to the
          // exact active lane identity before clearing any queue; no best-effort
          // retargeting is permitted.
          const cancelled = context.conversationTurnLane.cancel({
            target: laneBinding.target,
            clientRequestId: `legacy-stream-cancel:${streamId}:${laneBinding.activeTurnId}`,
            expectedActiveTurnId: laneBinding.activeTurnId
          })
          if (cancelled.code !== 'cancelled') return { canceled: false }
          clearConversationTurnOwnersForTarget(context, laneBinding.target)
          laneBinding.controller.abort()
          context.activeAgentChatStreams.delete(streamId)
          context.agentSessionFacades.abortAndDetach(streamId, 'cancel_agent_chat_stream')
          context.agentInputQueues.clearOnCancel(streamId, 'cancel_agent_chat_stream')
          cancelStreamAskPending(streamId); cancelStreamToolPermissionPending(streamId)
          return { canceled: true }
        }
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
        // Host-lane streams accept only the exact ADR-0170 submit delivery:'steer'
        // path. Legacy APIs must not discover or drive their façade.
        if (context.conversationTurnStreams.has(payload.streamId)) return noActiveAgentSessionIpcResult()
        // Mid-run steer delegates to the attached façade (≠ abort). Product autoDrain stays false.
        const facade = context.agentSessionFacades.get(payload.streamId)
        if (!facade) return noActiveAgentSessionIpcResult()
        const explicitSkillRejection = rejectExplicitSkillInvocationSteerFollowUp(payload.text, facade.snapshot())
        if (explicitSkillRejection) return explicitSkillRejection
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
        // Host-lane streams are isolated from the legacy follow-up façade path.
        if (context.conversationTurnStreams.has(payload.streamId)) return noActiveAgentSessionIpcResult()
        // Mid-run follow-up: busy policy queues by default; does not flip autoDrain.
        const facade = context.agentSessionFacades.get(payload.streamId)
        if (!facade) return noActiveAgentSessionIpcResult()
        const explicitSkillRejection = rejectExplicitSkillInvocationSteerFollowUp(payload.text, facade.snapshot())
        if (explicitSkillRejection) return explicitSkillRejection
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
      action: (_event, payload) => {
        if (resolveAskPending(payload.streamId, payload.toolCallId, payload.answers)) return { ok: true }
        if (resolveToolPermissionPending(payload.streamId, payload.toolCallId, payload.answers)) return { ok: true }
        throw new Error('No pending Ask or tool permission request matches this stream and tool call.')
      },
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
    }),
    command({
      channel: teachingInvokeChannels.listMindMaps,
      parser: (payload) => parseMindMapListPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'listMindMaps')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).list()
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.listMindMapLibrary,
      parser: () => undefined,
      action: async () => {
        const state = await service.getState()
        // Home cards live in the global MindMaps folder; each registered
        // workspace is a folder of its own per-workspace maps. Folders are
        // reported even when a workspace has no maps so the home page can show
        // every workspace folder.
        const homeRoot = await resolveHomeMindMapRoot()
        const home = await getMindMapStore(homeRoot).list()
        const workspaces = await Promise.all(
          state.workspaces.map(async (workspace) => ({
            workspaceId: workspace.id,
            name: workspace.name,
            documents: await getMindMapStore(workspace.rootPath).list()
          }))
        )
        return { home, workspaces }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.createMindMap,
      parser: (payload) => parseMindMapCreatePayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'createMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).create(p.title, p.structureClass)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.readMindMap,
      parser: (payload) => parseMindMapAccessPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'readMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).read(p.id)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapAsset,
      parser: (payload) => parseMindMapAssetImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapAsset')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        // The document id is part of the capability envelope. Resolve it before
        // opening a native picker so an asset cannot be imported into a stale or
        // unknown mind-map context.
        await getMindMapStore(root).read(p.id)
        const options: Electron.OpenDialogOptions = {
          title: '选择思维导图图片',
          properties: ['openFile', 'dontAddToRecent'],
          filters: [
            {
              name: 'Images',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']
            }
          ]
        }
        const mainWindow = BrowserWindow.getFocusedWindow()
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options)
        const sourcePath = result.filePaths[0]
        if (result.canceled || !sourcePath) return { canceled: true as const }

        const assetStore = new MindMapAssetStore({ rootPath: join(root, 'mindmap-assets') })
        const asset = await assetStore.importFromFile({
          id: randomUUID(),
          fileName: basename(sourcePath),
          sourcePath
        })
        if (!isMindMapImageAsset(asset)) {
          await assetStore.remove(asset).catch(() => undefined)
          throw new Error('Selected mind-map asset is not a supported image.')
        }
        // Return only metadata. The renderer must attach the id through the
        // canonical asset.create + topic.update transaction before it is used.
        return { canceled: false as const, asset }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.readMindMapAsset,
      parser: (payload) => parseMindMapAssetReadPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'readMindMapAsset')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const document = await getMindMapStore(root).read(p.id)
        const asset = document.assets.find((candidate) => candidate.id === p.assetId)
        if (!asset) return null
        if (!isMindMapImageAsset(asset)) {
          throw new Error('Mind-map asset is not an image.')
        }
        const assetStore = new MindMapAssetStore({ rootPath: join(root, 'mindmap-assets') })
        const bytes = await assetStore.read(asset)
        const mimeType = mindMapImageMimeType(asset)
        if (!mimeType) throw new Error('Mind-map image MIME type is unavailable.')
        return {
          asset,
          dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.updateMindMap,
      parser: (payload) => parseMindMapUpdatePayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'updateMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        return getMindMapStore(root).update(p.id, p.doc, p.expectedRevision)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.flushMindMap,
      parser: (payload) => parseMindMapFlushPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'flushMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        await getMindMapStore(root).flush(p.id)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.previewMindMapSourceRefresh,
      parser: (payload) => parseMindMapSourceRefreshPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'previewMindMapSourceRefresh')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const current = await getMindMapStore(root).read(p.id)
        const preview = await previewMindMapSourceRefresh(current, root)
        return {
          documentId: current.id,
          revision: current.revision,
          ...preview
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.applyMindMapSourceRefresh,
      parser: (payload) => parseMindMapSourceRefreshApplyPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'applyMindMapSourceRefresh')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)
        const current = await store.read(p.id)

        // A preview is only a review snapshot. Do not even construct a reducer
        // command when the canonical document has moved since that preview.
        if (current.revision !== p.expectedRevision) {
          return {
            ok: false as const,
            code: 'revision_stale' as const,
            expectedRevision: p.expectedRevision,
            currentRevision: current.revision
          }
        }

        const built = buildMindMapSourceRefreshCommand(
          current,
          p.updates,
          new Date().toISOString()
        )
        if (!built.ok) return built

        // An empty confirmation list is an explicit no-op and never creates a
        // revision. The source files are never written by this lane.
        if (built.command === null) {
          return {
            ok: true as const,
            document: current,
            command: null,
            inverse: null,
            appliedSourceIds: built.appliedSourceIds
          }
        }

        const applied = applyMindMapCommand(current, built.command)
        if (!applied.ok) {
          return {
            ok: false as const,
            code: 'command_invalid' as const,
            error: applied.error,
            command: built.command
          }
        }

        // Store CAS closes the read/reduce/write race if another edit lands
        // after the revision check above.
        const persisted = await store.update(p.id, applied.document, p.expectedRevision)
        if (!persisted.ok) return persisted
        return {
          ok: true as const,
          document: persisted.document,
          command: built.command,
          inverse: applied.inverse,
          appliedSourceIds: built.appliedSourceIds
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.applyMindMapProposal,
      parser: (payload) => parseMindMapProposalApplyPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'applyMindMapProposal')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)
        const current = await store.read(p.id)

        // Check the caller's revision before reducing provider commands. This
        // keeps a stale review from even being evaluated against a newer
        // canonical snapshot; the store CAS below closes the read/write race.
        if (current.revision !== p.expectedRevision) {
          return {
            ok: false as const,
            code: 'revision_stale' as const,
            expectedRevision: p.expectedRevision,
            currentRevision: current.revision
          }
        }

        const applied = applyReviewedMindMapProposal(
          current,
          p.proposal.items,
          p.decisions
        )
        if (!applied.ok) {
          return {
            ok: false as const,
            code: 'command_invalid' as const,
            proposalId: p.proposal.proposalId,
            error: applied.error,
            command: applied.command,
            acceptedIds: applied.acceptedIds,
            rejectedIds: applied.rejectedIds
          }
        }

        // A review that accepts no items is an explicit no-op. It still returns
        // the current snapshot, but never creates a durable revision.
        if (applied.command === null) {
          return {
            ok: true as const,
            proposalId: p.proposal.proposalId,
            document: current,
            command: null,
            inverse: null,
            acceptedIds: applied.acceptedIds,
            rejectedIds: applied.rejectedIds
          }
        }

        const persisted = await store.update(p.id, applied.document, p.expectedRevision)
        if (!persisted.ok) {
          return persisted
        }
        return {
          ok: true as const,
          proposalId: p.proposal.proposalId,
          document: persisted.document,
          command: applied.command,
          inverse: applied.inverse,
          acceptedIds: applied.acceptedIds,
          rejectedIds: applied.rejectedIds
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.generateMindMapProposal,
      parser: (payload) => parseMindMapProposalGeneratePayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'generateMindMapProposal')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)
        const current = await store.read(p.id)
        let selectedFileContext
        let notesContext
        let lessonContext
        if (p.scope === 'selected-file') {
          if (!p.selectedFile) {
            throw new Error('Invalid mind-map proposal request (invalid_source_refs): selected-file scope requires a selected file.')
          }
          try {
            selectedFileContext = await resolveSelectedMindMapFile(root, p.selectedFile.workspacePath)
          } catch (error) {
            throw mindMapSelectedFileIpcError(error)
          }
        } else if (p.scope === 'notes') {
          try {
            notesContext = await resolveMindMapNotes(root)
          } catch (error) {
            throw mindMapNotesIpcError(error)
          }
        } else if (p.scope === 'lesson') {
          if (!p.lesson) {
            throw new Error('Invalid mind-map proposal request (invalid_source_refs): lesson scope requires a Lesson.')
          }
          try {
            lessonContext = await resolveMindMapLesson(root, p.lesson.workspacePath)
          } catch (error) {
            throw mindMapLessonIpcError(error)
          }
        } else if (p.selectedFile !== undefined) {
          throw new Error('Invalid mind-map proposal request (source_out_of_scope): selectedFile is only valid for selected-file scope.')
        }
        const built = buildMindMapProposalRequest({
          document: current,
          scope: p.scope,
          sheetId: p.sheetId,
          selectedTopicIds: p.selectedTopicIds,
          sourceRefs: p.sourceRefs,
          selectedFileRef: selectedFileContext?.sourceRef,
          notesRef: notesContext?.sourceRef,
          lessonRef: lessonContext?.sourceRef
        })
        if (!built.ok) {
          throw new Error(`Invalid mind-map proposal request (${built.code}): ${built.message}`)
        }

        const loadedSettings = await settings.load()
        let proposal
        try {
          proposal = await generateMindMapProposal({
            title: current.title,
            prompt: p.prompt,
            settings: loadedSettings,
            document: current,
            request: built.request,
            selectedFileContext,
            notesContext,
            lessonContext,
            generationId: p.generationId
          })
        } catch (error) {
          throw mindMapGenerationIpcError(error)
        }

        // Read-only by construction: the proposal is returned with the exact
        // snapshot revision that must be supplied to the later CAS apply lane.
        return {
          documentId: current.id,
          revision: current.revision,
          request: built.request,
          proposal
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.deleteMindMap,
      parser: (payload) => parseMindMapAccessPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'deleteMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        await getMindMapStore(root).remove(p.id)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.generateMindMap,
      parser: (payload) => parseMindMapGeneratePayload(payload),
      action: async (event, payload) => {
        const p = requireMindMapPayload(payload, 'generateMindMap')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const loadedSettings = await settings.load()
        let selectedFileContext
        let lessonContext
        if (p.selectedFile) {
          try {
            selectedFileContext = await resolveSelectedMindMapFile(root, p.selectedFile.workspacePath)
          } catch (error) {
            throw mindMapSelectedFileIpcError(error)
          }
        } else if (p.lesson) {
          try {
            lessonContext = await resolveMindMapLesson(root, p.lesson.workspacePath)
          } catch (error) {
            throw mindMapLessonIpcError(error)
          }
        }
        const generationId = p.generationId ?? randomUUID()
        const sendStatus = (
          step: MindMapStreamStep,
          message?: string
        ): void => {
          safeSend(event.sender, teachingEventChannels.mindMapStreamStatus, {
            generationId,
            step,
            ...(message ? { message } : {})
          })
        }
        let streamStarted = false
        sendStatus('calling')
        let generated: MindMapDocument
        try {
          generated = await generateMindMap({
            title: p.title,
            prompt: p.prompt,
            settings: loadedSettings,
            selectedFileContext,
            lessonContext,
            generationId
          }, (delta) => {
            if (!streamStarted) {
              streamStarted = true
              sendStatus('streaming')
            }
            safeSend(event.sender, teachingEventChannels.mindMapStreamChunk, {
              generationId,
              delta
            })
          })
          sendStatus('validating')
        } catch (error) {
          const step = error instanceof MindMapGenerationError && error.kind === 'cancelled'
            ? 'cancelled'
            : 'error'
          sendStatus(step, errorMessage(error))
          throw mindMapGenerationIpcError(error)
        }
        sendStatus('rendering')
        try {
          const migrated = migrateV1ToV2(generated)
          if (!migrated.ok) {
            throw new Error(`Mind map generation output failed migration: ${migrated.error.message}`)
          }
          // Persist the generated sheets behind a canonical document created by the
          // store (authoritative id + timestamps), then return the persisted doc.
          const store = getMindMapStore(root)
          const created = await store.create(p.title)
          const result = await store.update(
            created.id,
            { ...migrated.value, id: created.id, createdAt: created.createdAt, updatedAt: created.updatedAt },
            created.revision
          )
          const persisted = unwrapMindMapUpdate(result, 'generateMindMap')
          sendStatus('done')
          return persisted
        } catch (error) {
          // Keep renderer lifecycle state correlated even when migration or the
          // canonical persistence boundary fails after provider settlement.
          sendStatus('error', errorMessage(error))
          throw mindMapGenerationIpcError(error)
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.cancelMindMapGeneration,
      parser: (payload) => parseMindMapCancelGenerationPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'cancelMindMapGeneration')
        // Resolve the registered workspace before touching the process-owned
        // generation registry. Cancellation is an IPC capability, not a
        // renderer-only loading-state change.
        await resolveMindMapWorkspaceRoot(p.workspaceId)
        return { canceled: cancelMindMapGeneration(p.generationId) }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapXmind,
      parser: (payload) => parseMindMapImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapXmind')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const assetStore = new MindMapAssetStore({ rootPath: join(root, 'mindmap-assets') })
        let createdAsset: MindMapAssetRef | undefined
        try {
          const imported = await readXmindFileWithCompatibilityReport(p.sourcePath, {
            importEmbeddedImage: async (image) => {
              const id = stableXmindAssetId(image.zipPath, image.bytes)
              const importInput = {
                id,
                fileName: image.fileName,
                mimeType: image.mimeType,
                content: image.bytes
              }
              try {
                const asset = await assetStore.importFromBytes(importInput)
                createdAsset = asset
                return asset
              } catch (error) {
                if (!(error instanceof MindMapAssetError) || error.code !== 'asset_exists') {
                  throw error
                }
                // Re-importing the same XMind should be idempotent. Verify the
                // existing bytes before reusing its metadata; never trust an
                // id-only collision.
                const existingRef: MindMapAssetRef = {
                  id,
                  fileName: image.fileName,
                  mimeType: image.mimeType
                }
                const existingBytes = await assetStore.read(existingRef)
                const incomingBytes = Buffer.from(image.bytes)
                if (
                  existingBytes.byteLength !== incomingBytes.byteLength ||
                  !existingBytes.equals(incomingBytes)
                ) {
                  throw new Error('Mind-map asset id collision for embedded XMind image')
                }
                return {
                  ...existingRef,
                  sizeBytes: existingBytes.byteLength,
                  sha256: createHash('sha256').update(existingBytes).digest('hex')
                }
              }
            }
          })
          const migrated = migrateV1ToV2(imported.document)
          if (!migrated.ok) {
            throw new Error(`Imported mind map failed migration: ${migrated.error.message}`)
          }
          const document = await persistImportedMindMap(
            root,
            { ...migrated.value, assets: imported.assets ?? [] },
            '导入的思维导图',
            'importMindMapXmind'
          )
          // Keep the v2 document fields at the top level so legacy renderer and
          // preload callers continue to read `id`, `title`, and `sheets`
          // unchanged.  The report is response metadata, not canonical document
          // state, and therefore is deliberately not persisted in the store.
          return {
            ...document,
            compatibilityReport: imported.compatibilityReport
          }
        } catch (error) {
          if (createdAsset) await assetStore.remove(createdAsset).catch(() => undefined)
          throw error
        }
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapMarkdown,
      parser: (payload) => parseMindMapMarkdownImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapMarkdown')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const imported = await importMindMapMarkdownFile(p.sourcePath)
        return persistImportedMindMap(
          root,
          imported,
          '导入的思维导图',
          'importMindMapMarkdown'
        )
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.importMindMapOpml,
      parser: (payload) => parseMindMapOpmlImportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'importMindMapOpml')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const imported = await importMindMapOpmlFile(p.sourcePath)
        return persistImportedMindMap(
          root,
          imported,
          '导入的思维导图',
          'importMindMapOpml'
        )
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapXmind,
      parser: (payload) => parseMindMapExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapXmind')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot. The renderer
        // proof is advisory input; readiness is decided again in the host so
        // XMind cannot retain the legacy race that the other export formats
        // already reject.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map XMind export refused: ${readiness.reasons.join(', ')}`
          )
        }
        return exportXmindFileV2(doc, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapMarkdown,
      parser: (payload) => parseMindMapMarkdownExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapMarkdown')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot.  The renderer
        // proof is only advisory input; readiness is decided again here so a
        // stale or dirty candidate can never be serialized accidentally.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map Markdown export refused: ${readiness.reasons.join(', ')}`
          )
        }
        return exportMindMapMarkdownFile(doc, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapOpml,
      parser: (payload) => parseMindMapOpmlExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapOpml')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot.  The renderer
        // proof is only advisory input; readiness is decided again here so a
        // stale or dirty candidate can never be serialized accidentally.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map OPML export refused: ${readiness.reasons.join(', ')}`
          )
        }
        return exportMindMapOpmlFile(doc, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapSvg,
      parser: (payload) => parseMindMapSvgExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapSvg')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot.  The renderer
        // proof is only advisory input; readiness is decided again here so a
        // stale or dirty candidate can never be serialized accidentally.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map SVG export refused: ${readiness.reasons.join(', ')}`
          )
        }
        const sheet = doc.sheets.find((candidate) => candidate.id === p.sheetId)
        if (!sheet) {
          throw new Error(`Mind map SVG export refused: sheet ${p.sheetId} is unavailable`)
        }
        if (p.input.title !== sheet.title) {
          throw new Error('Mind map SVG export refused: layout title does not match the current sheet')
        }
        return exportMindMapSvgFile(p.input, p.destinationDirectory)
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    }),
    command({
      channel: teachingInvokeChannels.exportMindMapPng,
      parser: (payload) => parseMindMapPngExportPayload(payload),
      action: async (_event, payload) => {
        const p = requireMindMapPayload(payload, 'exportMindMapPng')
        const root = await resolveMindMapWorkspaceRoot(p.workspaceId)
        const store = getMindMapStore(root)

        // Flush first, then read a fresh repository snapshot. The renderer
        // proof is advisory input; readiness is decided again in the host.
        await store.flush(p.id)
        const doc = await store.read(p.id)
        const readiness = assessMindMapExportSnapshotReadiness({
          snapshotRevision: p.snapshotRevision,
          durableRevision: doc.revision,
          expectedRevision: p.expectedRevision,
          pendingWrites: p.pendingWrites,
          dirty: p.dirty
        })
        if (!readiness.ready) {
          throw new Error(
            `Mind map PNG export refused: ${readiness.reasons.join(', ')}`
          )
        }
        const sheet = doc.sheets.find((candidate) => candidate.id === p.sheetId)
        if (!sheet) {
          throw new Error(`Mind map PNG export refused: sheet ${p.sheetId} is unavailable`)
        }
        if (p.input.title !== sheet.title) {
          throw new Error('Mind map PNG export refused: layout title does not match the current sheet')
        }
        return exportMindMapPngFile(
          { ...p, title: p.input.title },
          p.destinationDirectory,
          getMindMapSvgExportDimensions(p.input)
        )
      },
      reply: identityReply, streamCleanup: noStreamCleanup
    })
  ]
}

type CanonicalConversationForReservation = {
  record: { turns: AgentChatTurn[]; branch?: { revision?: number; status?: string } }
  revision: number
}

async function loadCanonicalConversationForReservation(
  service: TeachingWorkspaceService,
  reservation: AgentConversationTurnLaneActiveReservation
): Promise<CanonicalConversationForReservation | null> {
  if (reservation.target.kind === 'pending') return null
  const record = await service.readAgentConversation({
    workspaceId: reservation.target.workspaceId,
    conversationId: reservation.target.conversationId,
    scope: reservation.target.scope
  })
  const revision = record.branch?.revision
  if (record.branch?.status !== 'active' || !Number.isSafeInteger(revision) || (revision ?? -1) < 0) {
    throw new Error('canonical_conversation_unavailable')
  }
  return { record, revision: revision as number }
}

function conversationReservationPayload(input: {
  reservation: AgentConversationTurnLaneActiveReservation
  canonical: CanonicalConversationForReservation | null
}): AgentChatStreamPayload {
  const { reservation, canonical } = input
  const turns = canonical?.record.turns ?? []
  return {
    streamId: reservation.streamId,
    workspaceId: reservation.target.workspaceId,
    mode: reservation.intent.mode,
    ...(reservation.target.kind === 'canonical'
      ? { conversationId: reservation.target.conversationId, expectedBranchRevision: canonical?.revision }
      : {}),
    messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
    ...(turns.length ? { messageTurnIds: turns.map((turn) => turn.id) } : {}),
    userInput: reservation.intent.text,
    ...(reservation.intent.skillIds?.length ? { skillIds: reservation.intent.skillIds } : {})
  }
}

/**
 * A complete runtime transcript may be persisted only when it proves the exact
 * canonical prefix. Host never guesses that a delta belongs after the latest
 * record: doing so would turn a stale or divergent response into a force write.
 */
function mergeHostConversationTurns(
  canonicalTurns: readonly AgentChatTurn[],
  streamTurns: readonly AgentChatTurn[]
): AgentChatTurn[] | null {
  if (streamTurns.length < canonicalTurns.length) return null
  if (!canonicalTurns.every((turn, index) => sameHostConversationTurn(turn, streamTurns[index]))) return null
  return [...streamTurns]
}

function sameHostConversationTurn(left: AgentChatTurn, right: AgentChatTurn | undefined): boolean {
  if (!right) return false
  return left.id === right.id && left.role === right.role && left.content === right.content
}

function conversationTurnStartedEvent(
  reservation: AgentConversationTurnLaneActiveReservation
): AgentConversationTurnStartedRealtimeEvent {
  return {
    sequence: 0,
    streamId: reservation.streamId,
    kind: 'conversation_turn_started',
    createdAt: new Date().toISOString(),
    activeTurnId: reservation.activeTurnId,
    clientRequestId: reservation.intent.clientRequestId,
    ...(reservation.target.kind === 'canonical' ? { conversationId: reservation.target.conversationId } : {})
  }
}

function conversationTurnFailedEvent(streamId: string, sequence: number, message: string): AgentRealtimeEvent {
  return {
    sequence,
    streamId,
    kind: 'terminal',
    createdAt: new Date().toISOString(),
    outcome: 'error',
    message
  }
}

function conversationTurnOwnerKey(target: ConversationLaneKey, clientRequestId: string): string {
  return JSON.stringify([
    target.kind,
    target.workspaceId,
    target.scope,
    target.kind === 'canonical' ? target.conversationId : target.pendingConversationId,
    clientRequestId
  ])
}

function findConversationTurnOwner(
  context: GatewayContext,
  reservation: AgentConversationTurnLaneActiveReservation
): ConversationTurnOwnerBinding | null {
  const binding = context.conversationTurnOwners.get(
    conversationTurnOwnerKey(reservation.target, reservation.intent.clientRequestId)
  )
  return binding && sameConversationLaneKey(binding.target, reservation.target) ? binding : null
}

function clearConversationTurnOwnersForTarget(context: GatewayContext, target: ConversationLaneKey): void {
  for (const [key, binding] of context.conversationTurnOwners) {
    if (sameConversationLaneKey(binding.target, target)) context.conversationTurnOwners.delete(key)
  }
}

function moveConversationTurnOwnersToCanonicalTarget(
  context: GatewayContext,
  pendingTarget: ConversationLaneKey,
  canonicalTarget: ConversationLaneKey
): void {
  for (const [key, binding] of [...context.conversationTurnOwners]) {
    if (!sameConversationLaneKey(binding.target, pendingTarget)) continue
    context.conversationTurnOwners.delete(key)
    const moved: ConversationTurnOwnerBinding = { ...binding, target: canonicalTarget }
    context.conversationTurnOwners.set(conversationTurnOwnerKey(canonicalTarget, moved.clientRequestId), moved)
  }
}

function findConversationTurnStreamBinding(
  context: GatewayContext,
  target: ConversationLaneKey,
  activeTurnId: string
): { streamId: string; binding: ConversationTurnStreamBinding } | null {
  for (const [streamId, binding] of context.conversationTurnStreams) {
    if (binding.activeTurnId === activeTurnId && sameConversationLaneKey(binding.target, target)) {
      return { streamId, binding }
    }
  }
  return null
}

function canInjectHostLaneSteer(
  context: GatewayContext,
  intent: SubmitConversationTurnIntent
): boolean {
  const expectedActiveTurnId = intent.expectedActiveTurnId
  if (!expectedActiveTurnId) return false
  const lane = context.conversationTurnLane.snapshot().lanes.find((candidate) => sameConversationLaneKey(candidate.key, intent.target))
  const active = lane?.active
  if (!active || active.activeTurnId !== expectedActiveTurnId) return false
  const binding = context.conversationTurnStreams.get(active.streamId)
  return Boolean(
    binding &&
    binding.activeTurnId === expectedActiveTurnId &&
    sameConversationLaneKey(binding.target, intent.target) &&
    binding.facade.snapshot().phase === 'turn_boundary'
  )
}

function sameConversationLaneKey(left: ConversationLaneKey, right: ConversationLaneKey): boolean {
  return left.kind === right.kind &&
    left.workspaceId === right.workspaceId &&
    left.scope === right.scope &&
    (left.kind === 'canonical' && right.kind === 'canonical'
      ? left.conversationId === right.conversationId
      : left.kind === 'pending' && right.kind === 'pending'
        ? left.pendingConversationId === right.pendingConversationId
        : false)
}

function legacyCanonicalConversationTarget(payload: AgentChatStreamPayload): ConversationLaneKey | null {
  if (!payload.workspaceId || !payload.conversationId) return null
  return {
    kind: 'canonical',
    workspaceId: payload.workspaceId,
    scope: payload.mode === 'temporary' ? 'temporary' : 'workspace',
    conversationId: payload.conversationId
  }
}

function hasActiveConversationLane(context: GatewayContext, target: ConversationLaneKey): boolean {
  return context.conversationTurnLane.snapshot().lanes.some((lane) =>
    lane.active !== undefined && sameConversationLaneKey(lane.key, target)
  )
}

function hasLegacyConversationTarget(context: GatewayContext, target: ConversationLaneKey): boolean {
  return [...context.legacyConversationTargets.values()].some((legacy) => sameConversationLaneKey(legacy, target))
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

function mindMapImageMimeType(asset: MindMapAssetRef): string | null {
  const explicit = asset.mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  if (explicit?.startsWith('image/')) return explicit
  const extension = extname(asset.fileName).toLowerCase()
  return {
    '.gif': 'image/gif',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp'
  }[extension] ?? null
}

function isMindMapImageAsset(asset: MindMapAssetRef): boolean {
  return mindMapImageMimeType(asset) !== null
}

function stableXmindAssetId(zipPath: string, bytes: Uint8Array): string {
  return `xmind-${createHash('sha256')
    .update(zipPath)
    .update('\0')
    .update(bytes)
    .digest('hex')
    .slice(0, 32)}`
}
