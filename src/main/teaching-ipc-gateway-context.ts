/**
 * Shared command infrastructure for the Teaching IPC gateway composition root.
 *
 * Owns the fixed `GatewayCommand` envelope, the parse-before-action `command()`
 * helper, the composition-root `GatewayContext`, and the small shared helpers
 * every feature command group uses. Feature command groups
 * (`createXCommands(context)` factories in their own modules) return
 * `GatewayCommand[]` so `teaching-ipc-gateway.ts` stays a thin registrar.
 *
 * Electron remains internal; this is intentionally not a public, replaceable
 * transport abstraction (ADR-0004 host runner, teaching-ipc-contract).
 */
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { AgentEventBus } from './ai/agent-event-bus'
import { AgentInputQueueRegistry } from './ai/agent-input-queue'
import {
  AgentConversationTurnLane,
  type ConversationLaneKey
} from './ai/agent-conversation-turn-lane'
import {
  AgentSessionFacade,
  AgentSessionFacadeRegistry
} from './ai/agent-session-facade'
import type { Logger } from './logger'
import type { SkillLibraryService } from './skill-library'
import type { TeachingSettingsService } from './teaching-settings'
import type { TeachingWorkspaceService } from './teaching-workspace'
import type { TeachingTurnCoordinatorHost } from './teaching-turn-coordinator-host'
import type { LearningAnalyticsService } from './teaching/services/learning-analytics'
import type { ProductTeachingDoctorCrashMarkerStore } from './observability'
import type { MindMapStore } from './mindmap/mind-map-store'
import type { TeachingSettingsV1 } from '../shared/teaching-types'

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
   * Optional local crash-marker store for product TeachingDoctor IPC (ADR-0007).
   * Read-only for this channel; clear is a separate deliberate effect.
   */
  crashMarkerStore?: ProductTeachingDoctorCrashMarkerStore | null
  /**
   * Optional mind-map repository factory for host-owned composition and fault-injection tests.
   * Production callers use the durable file-backed store by default.
   */
  mindMapStoreFactory?: (rootPath: string) => MindMapStore
  /**
   * Optional user MCP status source for TeachingDoctor (ADR-0013).
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

export type GatewayContext = TeachingIpcRegistration & {
  activeAgentChatStreams: Map<string, AbortController>
  retainedAgentEventBuses: Map<string, AgentEventBus>
  agentStreamSessions: WeakMap<IpcMainInvokeEvent, Set<AgentStreamSession>>
  /**
   * Per-stream busy follow-up/steer queues (B-01 / B-02).
   * Cancel always clears via clearOnCancel. Façade owns drain policy; gateway
   * only holds the optional registry for stream-keyed attach/abort.
   */
  agentInputQueues: AgentInputQueueRegistry
  /**
   * Optional AgentSessionFacade registry (B-02). Service layer may attach a
   * façade per streamId; cancel aborts + detaches when present. Does not replace
   * TeachingSessionProtocol (ADR-0001).
   */
  agentSessionFacades: AgentSessionFacadeRegistry
  /** Main-only ADR-0004 lane; its snapshot deliberately contains no turn text. */
  conversationTurnLane: AgentConversationTurnLane
  /** Exact stream-to-lane bindings used to bridge the legacy cancel capability safely. */
  conversationTurnStreams: Map<string, ConversationTurnStreamBinding>
  /** Private reservation-to-renderer ownership; never projected through lane snapshots or DTOs. */
  conversationTurnOwners: Map<string, ConversationTurnOwnerBinding>
  /** Canonical legacy streams are guarded from racing a migrated host lane. */
  legacyConversationTargets: Map<string, ConversationLaneKey>
  /** Weakly remembers senders whose preview lifecycle hooks are already installed. */
  previewBindingLifecycleSenders: WeakSet<WebContents>
}

export type AgentStreamSession = { streamId: string; controller: AbortController; payload: unknown }

export type ConversationTurnStreamBinding = {
  target: ConversationLaneKey
  activeTurnId: string
  controller: AbortController
  facade: AgentSessionFacade
}

export type ConversationTurnOwnerBinding = {
  target: ConversationLaneKey
  clientRequestId: string
  sender: WebContents
}

export type GatewayCommand = {
  channel: string
  invoke: (event: IpcMainInvokeEvent, args: unknown[]) => Promise<unknown>
}

export type CommandDeclaration<Payload, Result> = {
  channel: string
  parser: (...args: unknown[]) => Payload | Promise<Payload>
  action: (event: IpcMainInvokeEvent, payload: Payload) => Result | Promise<Result>
  reply: (result: Result) => unknown
  streamCleanup: (event: IpcMainInvokeEvent, payload: Payload) => void
}

export const identityReply = <Value>(value: Value): Value => value
export const noStreamCleanup = (): void => {}

export function command<Payload, Result>(declaration: CommandDeclaration<Payload, Result>): GatewayCommand {
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

export function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload)
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
