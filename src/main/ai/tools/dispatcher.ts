/**
 * Typed tool dispatcher: effect policy → strict argument parse → handler → ToolOutcome.
 *
 * Thin orchestration over existing ToolHandlerMap handlers. Does not register new
 * shell/MCP tools; does not replace registry permission gates for workspace writes.
 */

import type { ToolCall } from '../provider-adapter'
import { agentOperationId } from '../agent-run-types'
import type { ToolCallContext, ToolHandlerMap } from './registry'
import {
  authorizeToolEffect,
  classifyToolEffect,
  type EffectAuthorizationInput
} from './effect-policy'
import {
  parseToolArguments,
  ToolArgumentParseError,
  TOOL_CANCELED_MESSAGE
} from './tool-arguments'
import {
  buildToolOutcomeCorrelation,
  type ToolEffectClass,
  type ToolOutcome,
  type ToolOutcomeCorrelation,
  type ToolOutcomeError
} from './tool-outcome'
import { enforceToolResultBudget } from './annotations'

export type ToolDispatcherOptions = Readonly<{
  handlers: ToolHandlerMap
  /** Optional effect-class allow-list for this dispatch scope. */
  allowedEffects?: readonly ToolEffectClass[]
  /** Optional tool-name allow predicate (capability / projection policy). */
  allowsTool?: (toolName: string) => boolean
  /**
   * Optional audit hook after outcome is produced (metadata only).
   * Must not log secrets, raw learner answers, or provider payloads.
   */
  onOutcome?: (outcome: ToolOutcome) => void
}>

export class ToolDispatcher {
  constructor(private readonly options: ToolDispatcherOptions) {}

  async dispatch(call: ToolCall, callCtx?: ToolCallContext): Promise<ToolOutcome> {
    const name = call.function.name
    const toolCallId = call.id
    const effectClass = classifyToolEffect(name)
    const operationId = resolveOperationId(callCtx?.runId, toolCallId)
    const correlation = buildToolOutcomeCorrelation({
      toolCallId,
      runId: callCtx?.runId,
      operationId
    })

    const base = {
      toolCallId,
      name,
      effectClass,
      ...(operationId ? { operationId } : {}),
      correlation
    }

    const finish = (outcome: ToolOutcome): ToolOutcome => {
      this.options.onOutcome?.(outcome)
      return outcome
    }

    if (callCtx?.signal?.aborted) {
      return finish(
        terminalOutcome(base, 'cancelled', {
          code: 'tool_canceled',
          message: TOOL_CANCELED_MESSAGE
        })
      )
    }

    const auth = authorizeToolEffect({
      toolName: name,
      effectClass,
      allowedEffects: this.options.allowedEffects,
      allowsTool: this.options.allowsTool
    } satisfies EffectAuthorizationInput)

    if (!auth.allowed) {
      return finish(
        terminalOutcome(base, 'denied', {
          code: auth.code,
          message: auth.reason
        })
      )
    }

    let args: unknown
    try {
      args = parseToolArguments(call.function.arguments)
    } catch (error) {
      const message =
        error instanceof ToolArgumentParseError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error)
      return finish(
        terminalOutcome(base, 'failed', {
          code: 'invalid_tool_arguments',
          message
        })
      )
    }

    const handler = this.options.handlers[name]
    if (!handler) {
      return finish(
        terminalOutcome(base, 'failed', {
          code: 'unknown_tool',
          message: `未知工具：${name}`
        })
      )
    }

    try {
      const content = await handler(args, callCtx)
      if (callCtx?.signal?.aborted) {
        return finish(
          terminalOutcome(base, 'cancelled', {
            code: 'tool_canceled',
            message: TOOL_CANCELED_MESSAGE
          })
        )
      }
      const budgeted = enforceToolResultBudget(content)
      return finish({
        ...base,
        status: 'succeeded',
        content: budgeted.content,
        isError: false
      })
    } catch (error) {
      if (callCtx?.signal?.aborted || isAbortError(error)) {
        return finish(
          terminalOutcome(base, 'cancelled', {
            code: 'tool_canceled',
            message: TOOL_CANCELED_MESSAGE
          })
        )
      }
      if (isTimeoutError(error)) {
        return finish(
          terminalOutcome(base, 'timed_out', {
            code: 'tool_timed_out',
            message: error instanceof Error ? error.message : '工具调用超时。'
          })
        )
      }
      return finish(
        terminalOutcome(base, 'failed', {
          code: 'tool_execution_error',
          message: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }
}

function resolveOperationId(runId: string | undefined, toolCallId: string): string | undefined {
  if (!runId?.trim() || !toolCallId.trim()) return undefined
  try {
    return agentOperationId(runId, toolCallId)
  } catch {
    // Invalid id characters must not break dispatch; omit correlation id.
    return undefined
  }
}

type OutcomeBaseFields = {
  toolCallId: string
  name: string
  effectClass: ToolEffectClass
  operationId?: string
  correlation: ToolOutcomeCorrelation
}

function terminalOutcome(
  base: OutcomeBaseFields,
  status: 'failed' | 'cancelled' | 'denied' | 'timed_out',
  error: ToolOutcomeError
): ToolOutcome {
  return {
    ...base,
    status,
    content: JSON.stringify({ error: error.message, code: error.code }),
    error,
    isError: true
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || /aborted|abort|canceled|cancelled/i.test(error.message)
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(error.message)
}

