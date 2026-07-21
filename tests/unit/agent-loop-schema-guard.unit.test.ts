import { describe, expect, it, vi } from 'vitest'

import type { ToolDefinition } from '../../src/main/ai/provider-adapter'
import { applyToolsSchemaGuard } from '../../src/main/ai/agent-loop-schema-guard'
import {
  TOOLS_SCHEMA_AUDIT,
  createToolsSchemaGuardState,
  fingerprintToolDefinitions
} from '../../src/main/ai/tools/tools-schema-fingerprint'

function tool(
  name: string,
  parameters: Record<string, unknown>,
  description = `${name} tool`
): ToolDefinition {
  return {
    type: 'function',
    function: { name, description, parameters }
  }
}

const READ_PARAMS = {
  type: 'object',
  properties: {
    path: { type: 'string' }
  },
  required: ['path']
} as const

const SEARCH_PARAMS = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    limit: { type: 'number' }
  },
  required: ['query']
} as const

describe('applyToolsSchemaGuard', () => {
  it('establishes baseline on first call without emit (ok, unchanged)', () => {
    const state = createToolsSchemaGuardState()
    const emit = vi.fn()
    const tools = [tool('read_workspace_file', { ...READ_PARAMS })]

    const decision = applyToolsSchemaGuard(state, tools, emit)

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected ok')
    expect(decision.changed).toBe(false)
    expect(decision.fingerprint).toBe(fingerprintToolDefinitions(tools))
    expect(emit).not.toHaveBeenCalled()
  })

  it('re-offer of the same surface stays silent (ok, unchanged)', () => {
    const state = createToolsSchemaGuardState()
    const emit = vi.fn()
    const tools = [
      tool('read_workspace_file', { ...READ_PARAMS }),
      tool('search_workspace', { ...SEARCH_PARAMS })
    ]

    applyToolsSchemaGuard(state, tools, emit)
    emit.mockClear()

    const decision = applyToolsSchemaGuard(state, tools, emit)

    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error('expected ok')
    expect(decision.changed).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('emits thinking status with audit code when tools/schema narrows mid-run', () => {
    const state = createToolsSchemaGuardState()
    const emit = vi.fn()
    const baseline = [
      tool('read_workspace_file', { ...READ_PARAMS }),
      tool('search_workspace', { ...SEARCH_PARAMS })
    ]
    const narrowed = [tool('read_workspace_file', { ...READ_PARAMS })]

    applyToolsSchemaGuard(state, baseline, emit)
    emit.mockClear()

    const decision = applyToolsSchemaGuard(state, narrowed, emit)

    expect(decision.ok).toBe(true)
    if (!decision.ok || !decision.changed) throw new Error('expected ok narrowed')
    expect(decision.change).toBe('narrowed')
    expect(decision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.narrowed)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      type: 'status',
      status: 'thinking',
      message: `[${TOOLS_SCHEMA_AUDIT.narrowed}] Tools/schema narrowed mid-run (fingerprint=${decision.fingerprint.slice(0, 12)}).`
    })
  })

  it('emits error status and returns fail-closed decision on expansion', () => {
    const state = createToolsSchemaGuardState()
    const emit = vi.fn()
    const baseline = [tool('read_workspace_file', { ...READ_PARAMS })]
    const expanded = [
      tool('read_workspace_file', { ...READ_PARAMS }),
      tool('search_workspace', { ...SEARCH_PARAMS })
    ]

    applyToolsSchemaGuard(state, baseline, emit)
    emit.mockClear()

    const decision = applyToolsSchemaGuard(state, expanded, emit)

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected fail')
    expect(decision.change).toBe('expanded')
    expect(decision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.expanded)
    expect(decision.reason.length).toBeGreaterThan(0)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      type: 'status',
      status: 'error',
      message: `[${decision.auditCode}] ${decision.reason}`
    })
  })

  it('emits error status and returns fail-closed decision on incompatible schema change', () => {
    const state = createToolsSchemaGuardState()
    const emit = vi.fn()
    const baseline = [tool('read_workspace_file', { ...READ_PARAMS })]
    const incompatible = [
      tool('read_workspace_file', {
        type: 'object',
        properties: {
          path: { type: 'string' },
          encoding: { type: 'string' }
        },
        required: ['path', 'encoding']
      })
    ]

    applyToolsSchemaGuard(state, baseline, emit)
    emit.mockClear()

    const decision = applyToolsSchemaGuard(state, incompatible, emit)

    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error('expected fail')
    expect(decision.change === 'expanded' || decision.change === 'incompatible').toBe(true)
    expect(
      decision.auditCode === TOOLS_SCHEMA_AUDIT.expanded ||
        decision.auditCode === TOOLS_SCHEMA_AUDIT.incompatible
    ).toBe(true)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      type: 'status',
      status: 'error',
      message: `[${decision.auditCode}] ${decision.reason}`
    })
  })
})
