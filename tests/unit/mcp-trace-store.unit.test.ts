import { describe, expect, it } from 'vitest'

import {
  MCP_TRACE_DEFAULT_CAPACITY,
  MCP_TRACE_MAX_CAPACITY,
  MCP_TRACE_MAX_DURATION_MS,
  MCP_TRACE_MAX_IDENTIFIER_LENGTH,
  MCP_TRACE_MAX_RESULT_BYTES,
  createMcpTraceStore,
  type McpTraceAppendInput
} from '../../src/main/mcp/trace-store'

function traceInput(overrides: Partial<McpTraceAppendInput> = {}): McpTraceAppendInput {
  return {
    serverId: 'study_server',
    registeredToolName: 'mcp__study_server__lookup_notes',
    rawToolName: 'lookup_notes',
    durationMs: 43,
    cancelled: false,
    resultBytes: 512,
    truncated: false,
    spilled: false,
    resultKind: 'text',
    ...overrides
  }
}

describe('MCP process-local trace store (ADR-0013)', () => {
  it('stores only the allowlisted safe metadata and ignores untyped payload fields', () => {
    const store = createMcpTraceStore()
    const secret = 'TOP_SECRET_do_not_record'
    const entry = store.append({
      ...traceInput({ errorCode: 'mcp_result_invalid' }),
      args: { token: secret },
      content: `base64:${secret}`,
      url: `https://user:${secret}@example.test/private`,
      headers: { authorization: `Bearer ${secret}` },
      env: { TOKEN: secret },
      path: `/private/${secret}`,
      artifactRawId: secret
    } as unknown as McpTraceAppendInput)

    expect(entry).toEqual({
      sequence: 1,
      serverId: 'study_server',
      registeredToolName: 'mcp__study_server__lookup_notes',
      rawToolName: 'lookup_notes',
      durationMs: 43,
      cancelled: false,
      resultBytes: 512,
      truncated: false,
      spilled: false,
      resultKind: 'text',
      errorCode: 'mcp_result_invalid'
    })

    const serialized = JSON.stringify(store.snapshot())
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('authorization')
    expect(serialized).not.toContain('artifactRawId')
    expect(serialized).not.toContain('https://')
    expect(serialized).not.toContain('/private/')
  })

  it('rejects unsafe identifiers and replaces an invalid error code with a stable code', () => {
    const store = createMcpTraceStore()

    expect(
      store.append(
        traceInput({ rawToolName: 'https://example.test/?credential=TOP_SECRET' })
      )
    ).toBeNull()
    expect(store.size()).toBe(0)
    expect(
      store.append(
        traceInput({ registeredToolName: 'a'.repeat(MCP_TRACE_MAX_IDENTIFIER_LENGTH + 1) })
      )
    ).toBeNull()

    const entry = store.append(traceInput({ errorCode: 'Bearer TOP_SECRET' }))
    expect(entry?.errorCode).toBe('mcp_unknown_error')
    expect(JSON.stringify(store.snapshot())).not.toContain('TOP_SECRET')
  })

  it('caps storage capacity and evicts the oldest entries', () => {
    const store = createMcpTraceStore({ capacity: 2 })
    store.append(traceInput({ rawToolName: 'first' }))
    store.append(traceInput({ rawToolName: 'second' }))
    store.append(traceInput({ rawToolName: 'third' }))

    expect(store.capacity).toBe(2)
    expect(store.snapshot().map((entry) => [entry.sequence, entry.rawToolName])).toEqual([
      [2, 'second'],
      [3, 'third']
    ])

    expect(createMcpTraceStore({ capacity: Number.POSITIVE_INFINITY }).capacity).toBe(
      MCP_TRACE_DEFAULT_CAPACITY
    )
    expect(createMcpTraceStore({ capacity: 100_000 }).capacity).toBe(MCP_TRACE_MAX_CAPACITY)
    expect(createMcpTraceStore({ capacity: 0 }).capacity).toBe(1)
  })

  it('bounds numeric metadata and reduces malformed booleans/result kinds to safe values', () => {
    const store = createMcpTraceStore()
    const entry = store.append({
      ...traceInput(),
      durationMs: Number.MAX_SAFE_INTEGER,
      resultBytes: Number.MAX_SAFE_INTEGER,
      cancelled: 'yes',
      truncated: 1,
      spilled: 'true',
      resultKind: 'base64_payload' as McpTraceAppendInput['resultKind']
    } as unknown as McpTraceAppendInput)

    expect(entry).toMatchObject({
      durationMs: MCP_TRACE_MAX_DURATION_MS,
      resultBytes: MCP_TRACE_MAX_RESULT_BYTES,
      cancelled: false,
      truncated: false,
      spilled: false,
      resultKind: 'unknown'
    })
  })

  it('does not retain mutable caller input and returns frozen snapshots and entries', () => {
    const store = createMcpTraceStore()
    const input: { -readonly [K in keyof McpTraceAppendInput]: McpTraceAppendInput[K] } = {
      ...traceInput()
    }
    const appended = store.append(input)
    input.rawToolName = 'changed_after_append'
    input.errorCode = 'mcp_changed_after_append'

    const snapshot = store.snapshot()
    expect(snapshot[0]).toMatchObject({
      rawToolName: 'lookup_notes',
      errorCode: null
    })
    expect(Object.isFrozen(appended)).toBe(true)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot[0])).toBe(true)
    expect(() => Object.assign(snapshot[0] as object, { rawToolName: 'mutated' })).toThrow(TypeError)

    store.clear()
    expect(store.snapshot()).toEqual([])
  })
})
