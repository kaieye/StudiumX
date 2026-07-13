import type { AgentEventBus } from './ai/agent-event-bus'
import { registerToolPermissionPending } from './ai/tool-permission-pending'
import type { ToolPermissionResolver } from './ai/tools/registry'

/**
 * Keeps permission wait/resume state and its paired tool events together so a
 * conversation turn cannot publish a request without restoring run state.
 */
export function createConversationPermissionResolver(options: {
  runId: string
  signal: AbortSignal | undefined
  eventBus: AgentEventBus
  onWaiting: (permissionId: string) => Promise<void>
  onResolved: () => Promise<void>
}): ToolPermissionResolver {
  return async (request) => {
    const argumentsJson = JSON.stringify(request)
    await options.onWaiting(request.id)
    const pendingDecision = registerToolPermissionPending(options.runId, request.id, options.signal)
    void pendingDecision.catch(() => undefined)
    options.eventBus.publishTool({
      toolCall: {
        id: request.id,
        name: 'tool_permission',
        arguments: argumentsJson
      },
      permissionRequest: request
    })

    let decision
    try {
      decision = await pendingDecision
    } finally {
      await options.onResolved().catch(() => undefined)
    }

    options.eventBus.publishTool({
      toolCall: {
        id: request.id,
        name: 'tool_permission',
        arguments: argumentsJson
      },
      result: JSON.stringify(decision),
      isError: decision.decision === 'deny',
      permissionRequest: request
    })
    return decision
  }
}
