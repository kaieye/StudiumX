import { describe, expect, it } from 'vitest'

import type { ToolCall } from '../../src/main/ai/provider-adapter'
import { ToolDispatcher } from '../../src/main/ai/tools/dispatcher'
import type { ToolContext } from '../../src/main/ai/tools/registry'
import { McpApplicationToolError } from '../../src/main/ai/tools/mcp-application-error'
import type { McpSessionManager, McpSnapshotTool } from '../../src/main/mcp/session-manager'
import { createMcpToolEntry } from '../../src/main/mcp/tool-bridge'

const tool: McpSnapshotTool = {
  registeredName: 'mcp__demo__lookup',
  serverId: 'demo',
  rawToolName: 'lookup',
  description: 'lookup',
  descriptionTruncated: false,
  parameters: { type: 'object' },
  effectClass: 'read'
}

describe('MCP tool bridge result boundaries (ADR-0134)', () => {
  it('raises a typed failure for a normalized MCP application error', async () => {
    const sessionManager = {
      callTool: async () => ({
        ok: false as const,
        code: 'mcp_call_failed' as const,
        message: 'remote failure',
        status: 'failed' as const,
        isError: true,
        errorCode: 'mcp_application_error' as const,
        modelText: 'remote failure: request timed out',
        byteCount: 31,
        truncated: false,
        spilled: false,
        artifactRefs: [],
        normalizedContent: []
      })
    } as unknown as McpSessionManager

    const entry = createMcpToolEntry(tool, sessionManager)

    await expect(entry.handler({}, {} as ToolContext)).rejects.toMatchObject({
      name: 'McpApplicationToolError',
      code: 'mcp_application_error',
      message: 'remote failure: request timed out'
    } satisfies Partial<McpApplicationToolError>)

    const dispatcher = new ToolDispatcher({
      handlers: {
        [tool.registeredName]: (args, callCtx) =>
          entry.handler(args, {} as ToolContext, callCtx)
      }
    })
    const outcome = await dispatcher.dispatch({
      id: 'mcp-application-error',
      type: 'function',
      function: { name: tool.registeredName, arguments: '{}' }
    } satisfies ToolCall)

    expect(outcome.status).toBe('failed')
    if (outcome.status === 'failed') {
      expect(outcome.error.code).toBe('mcp_application_error')
      expect(outcome.error.message).toBe('remote failure: request timed out')
    }
  })
})
