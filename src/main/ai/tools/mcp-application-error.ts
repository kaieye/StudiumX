/**
 * Narrow adapter error for an MCP server's protocol-level application failure.
 *
 * This is deliberately distinct from a transport/timeout error: untrusted MCP
 * error wording must not be allowed to change ToolOutcome status classification.
 * The message passed here has already been MCP-normalized at the bridge boundary.
 */
export class McpApplicationToolError extends Error {
  readonly code = 'mcp_application_error' as const

  constructor(message: string) {
    super(message)
    this.name = 'McpApplicationToolError'
  }
}

export function isMcpApplicationToolError(error: unknown): error is McpApplicationToolError {
  return error instanceof McpApplicationToolError
}
