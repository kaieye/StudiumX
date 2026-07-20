import type { ToolCall } from '../provider-adapter'
import type { ToolCallContext, ToolHandlerMap } from './registry'
import { ToolDispatcher } from './dispatcher'
import {
  parseToolArguments,
  ToolArgumentParseError,
  TOOL_CANCELED_MESSAGE
} from './tool-arguments'
import type { ToolOutcome } from './tool-outcome'

export type ToolExecutionResult = {
  toolCallId: string
  name: string
  content: string
  isError: boolean
}

export { parseToolArguments, ToolArgumentParseError, TOOL_CANCELED_MESSAGE }

/**
 * Legacy thin adapter over ToolDispatcher for callers not yet migrated to ToolOutcome.
 * Preserves ToolExecutionResult shape; structured handler error JSON still sets isError.
 */
export async function executeToolCall(
  toolHandlers: ToolHandlerMap,
  call: ToolCall,
  callCtx?: ToolCallContext
): Promise<ToolExecutionResult> {
  const dispatcher = new ToolDispatcher({ handlers: toolHandlers })
  const outcome = await dispatcher.dispatch(call, callCtx)
  return toolOutcomeToExecutionResult(outcome)
}

export function toolOutcomeToExecutionResult(outcome: ToolOutcome): ToolExecutionResult {
  return {
    toolCallId: outcome.toolCallId,
    name: outcome.name,
    content: outcome.content,
    // Legacy path: terminal statuses are errors; succeeded content may still carry
    // structured { error } JSON from older handlers (registry permission denials).
    isError: outcome.status !== 'succeeded' || toolContentLooksLikeError(outcome.content)
  }
}

export function toolContentLooksLikeError(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') return false
    const record = parsed as Record<string, unknown>
    return typeof record.error === 'string' && record.ok !== true
  } catch {
    return false
  }
}
