import type { ToolCall } from '../provider-adapter'
import type { ToolCallContext, ToolHandlerMap } from './registry'

export type ToolExecutionResult = {
  toolCallId: string
  name: string
  content: string
  isError: boolean
}

export async function executeToolCall(
  toolHandlers: ToolHandlerMap,
  call: ToolCall,
  callCtx?: ToolCallContext
): Promise<ToolExecutionResult> {
  const name = call.function.name
  try {
    const handler = toolHandlers[name]
    if (!handler) throw new Error(`未知工具：${name}`)
    const content = await handler(parseToolArguments(call.function.arguments), callCtx)
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
      content: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
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
