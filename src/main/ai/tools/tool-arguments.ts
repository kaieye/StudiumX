/**
 * Strict tool-argument parsing shared by dispatcher and legacy execution adapters.
 */

export const TOOL_CANCELED_MESSAGE = '工具调用已取消。'

export class ToolArgumentParseError extends Error {
  readonly code = 'invalid_tool_arguments' as const

  constructor(message = '工具参数不是合法 JSON。') {
    super(message)
    this.name = 'ToolArgumentParseError'
  }
}

/**
 * Parse tool-call arguments.
 * Empty / whitespace-only input is treated as `{}`.
 * Illegal JSON fails with ToolArgumentParseError (no silent `{}`).
 */
export function parseToolArguments(raw: string): unknown {
  if (!raw || !raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new ToolArgumentParseError()
  }
}
