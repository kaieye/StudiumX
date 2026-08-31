import { ipcMain } from 'electron'
import { AgentInputQueueRegistry } from './ai/agent-input-queue'
import { AgentConversationTurnLane } from './ai/agent-conversation-turn-lane'
import { AgentSessionFacadeRegistry } from './ai/agent-session-facade'
import {
  type GatewayCommand,
  type GatewayContext,
  type TeachingIpcRegistration
} from './teaching-ipc-gateway-context'
import { createTeachingWorkspaceCommands } from './teaching-workspace-ipc-commands'
import { createTeachingCoreCommands } from './teaching-core-ipc-commands'
import { createAgentChatCommands } from './ai/agent-chat-ipc-commands'
import { createMindMapCommands } from './mindmap/mind-map-ipc-actions'
import { createMindMapInterchangeCommands } from './mindmap/mind-map-ipc-interchange'

export type { TeachingIpcRegistration } from './teaching-ipc-gateway-context'

/**
 * Register the fixed Electron IPC surface for Teaching. Electron remains internal;
 * this is intentionally not a public, replaceable transport abstraction.
 *
 * The gateway is a registrar/composition root: feature command groups live in
 * their own modules (`createTeachingWorkspaceCommands`,
 * `createAgentChatCommands`, `createMindMapCommands`,
 * `createMindMapInterchangeCommands`, `createTeachingCoreCommands`) and are
 * composed here. The duplicate-channel guard keeps the surface exactly one
 * handler per channel regardless of how groups are split.
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
  return [
    ...createTeachingWorkspaceCommands(context),
    ...createAgentChatCommands(context),
    ...createMindMapCommands(context),
    ...createMindMapInterchangeCommands(context),
    ...createTeachingCoreCommands(context)
  ]
}
