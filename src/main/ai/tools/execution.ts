import type { ToolCall } from '../provider-adapter'
import type { ToolCallContext, ToolHandlerMap } from './registry'

export type ToolExecutionResult = {
  toolCallId: string
  name: string
  content: string
  isError: boolean
}

const TOOL_CANCELED_MESSAGE = '工具调用已取消。'

export async function executeToolCall(
  toolHandlers: ToolHandlerMap,
  call: ToolCall,
  callCtx?: ToolCallContext
): Promise<ToolExecutionResult> {
  const name = call.function.name
  try {
    assertToolNotCanceled(callCtx)
    const handler = toolHandlers[name]
    if (!handler) throw new Error(`未知工具：${name}`)
    const content = await handler(parseToolArguments(call.function.arguments), callCtx)
    assertToolNotCanceled(callCtx)
    return {
      toolCallId: call.id,
      name,
      content,
      isError: toolContentLooksLikeError(content)
    }
  } catch (error) {
    return {
      toolCallId: call.id,
      name,
      content: JSON.stringify({ error: toolExecutionErrorMessage(error, callCtx) }),
      isError: true
    }
  }
}

export function parseToolArguments(raw: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function assertToolNotCanceled(callCtx?: ToolCallContext): void {
  if (callCtx?.signal?.aborted) throw new Error(TOOL_CANCELED_MESSAGE)
}

function toolExecutionErrorMessage(error: unknown, callCtx?: ToolCallContext): string {
  if (callCtx?.signal?.aborted || isAbortError(error)) return TOOL_CANCELED_MESSAGE
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || /aborted|abort|canceled|cancelled/i.test(error.message)
}

function toolContentLooksLikeError(content: string): boolean {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') return false
    const record = parsed as Record<string, unknown>
    return typeof record.error === 'string' && record.ok !== true
  } catch {
    return false
  }
}
