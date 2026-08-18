import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { ToolDefinition } from '../../src/main/ai/provider-adapter'
import {
  TOOLS_SCHEMA_AUDIT,
  assertToolsSchemaStable,
  createToolsSchemaGuardState,
  evaluateToolsSchemaTransition,
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

describe('fingerprintToolDefinitions', () => {
  it('returns stable sha256 hex for the same tool surface', () => {
    const tools = [tool('read_workspace_file', { ...READ_PARAMS }), tool('search_workspace', { ...SEARCH_PARAMS })]
    const a = fingerprintToolDefinitions(tools)
    const b = fingerprintToolDefinitions(tools)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
    expect(a).toBe(b)
    // Independent recompute matches createHash over the same canonical payload.
    const again = fingerprintToolDefinitions([
      tool('search_workspace', { ...SEARCH_PARAMS }),
      tool('read_workspace_file', { ...READ_PARAMS })
    ])
    expect(again).toBe(a)
  })

  it('treats reordered tools and reordered parameter keys as equal', () => {
    const ordered = [
      tool('alpha', {
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a', 'b']
      }),
      tool('beta', { type: 'object', properties: { z: { type: 'boolean' } } })
    ]
    const reordered = [
      tool('beta', { type: 'object', properties: { z: { type: 'boolean' } } }),
      tool('alpha', {
        required: ['a', 'b'],
        type: 'object',
        properties: { b: { type: 'number' }, a: { type: 'string' } }
      })
    ]
    expect(fingerprintToolDefinitions(reordered)).toBe(fingerprintToolDefinitions(ordered))
  })

  it('ignores description-only edits so prompt copy does not bust the surface id', () => {
    const a = [tool('read_workspace_file', { ...READ_PARAMS }, 'Read a file')]
    const b = [tool('read_workspace_file', { ...READ_PARAMS }, 'Read a workspace file (updated copy)')]
    expect(fingerprintToolDefinitions(a)).toBe(fingerprintToolDefinitions(b))
  })

  it('changes when a tool is added', () => {
    const base = [tool('read_workspace_file', { ...READ_PARAMS })]
    const expanded = [
      tool('read_workspace_file', { ...READ_PARAMS }),
      tool('search_workspace', { ...SEARCH_PARAMS })
    ]
    expect(fingerprintToolDefinitions(expanded)).not.toBe(fingerprintToolDefinitions(base))
  })

  it('changes when a tool is removed', () => {
    const base = [
      tool('read_workspace_file', { ...READ_PARAMS }),
      tool('search_workspace', { ...SEARCH_PARAMS })
    ]
    const narrowed = [tool('read_workspace_file', { ...READ_PARAMS })]
    expect(fingerprintToolDefinitions(narrowed)).not.toBe(fingerprintToolDefinitions(base))
  })

  it('changes when parameter schema changes', () => {
    const base = [tool('read_workspace_file', { ...READ_PARAMS })]
    const changed = [
      tool('read_workspace_file', {
        type: 'object',
        properties: {
          path: { type: 'string' },
          encoding: { type: 'string' }
        },
        required: ['path']
      })
    ]
    expect(fingerprintToolDefinitions(changed)).not.toBe(fingerprintToolDefinitions(base))
  })

  it('includes MCP-style tool names in the surface fingerprint (ADR-0013)', () => {
    const staticOnly = [tool('read_workspace_file', { ...READ_PARAMS })]
    const withMcp = [
      tool('read_workspace_file', { ...READ_PARAMS }),
      tool('mcp__demo__list_files', {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      })
    ]
    const a = fingerprintToolDefinitions(staticOnly)
    const b = fingerprintToolDefinitions(withMcp)
    expect(a).not.toBe(b)
    // Same MCP surface stays stable
    expect(fingerprintToolDefinitions(withMcp)).toBe(b)
    // Mid-run expansion to add MCP tools fails closed as expanded
    const decision = evaluateToolsSchemaTransition(a, withMcp, staticOnly)
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.change).toBe('expanded')
      expect(decision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.expanded)
    }
  })

})

describe('evaluateToolsSchemaTransition', () => {
  const base = [
    tool('read_workspace_file', { ...READ_PARAMS }),
    tool('search_workspace', { ...SEARCH_PARAMS })
  ]

  it('establishes fingerprint on first turn (prev null)', () => {
    const decision = evaluateToolsSchemaTransition(null, base)
    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.changed).toBe(false)
    expect(decision.fingerprint).toBe(fingerprintToolDefinitions(base))
  })

  it('reports unchanged when fingerprint matches', () => {
    const prev = fingerprintToolDefinitions(base)
    const decision = evaluateToolsSchemaTransition(prev, [...base].reverse(), base)
    expect(decision).toEqual({ ok: true, fingerprint: prev, changed: false })
  })

  it('allows legitimate tool set narrowing with audit code', () => {
    const prev = fingerprintToolDefinitions(base)
    const narrowed = [tool('read_workspace_file', { ...READ_PARAMS })]
    const decision = evaluateToolsSchemaTransition(prev, narrowed, base)
    expect(decision.ok).toBe(true)
    if (!decision.ok || !decision.changed) {
      expect.fail('expected narrowed ok decision')
      return
    }
    expect(decision.change).toBe('narrowed')
    expect(decision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.narrowed)
    expect(decision.fingerprint).toBe(fingerprintToolDefinitions(narrowed))
  })

  it('fails closed when a tool is added (expansion)', () => {
    const prev = fingerprintToolDefinitions(base)
    const expanded = [
      ...base,
      tool('write_workspace_file', {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content']
      })
    ]
    const decision = evaluateToolsSchemaTransition(prev, expanded, base)
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.change).toBe('expanded')
    expect(decision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.expanded)
    expect(decision.reason).toContain('write_workspace_file')
  })

  it('fails closed when parameter schema changes (incompatible)', () => {
    const prev = fingerprintToolDefinitions(base)
    const next = [
      tool('read_workspace_file', {
        type: 'object',
        properties: {
          path: { type: 'string' },
          encoding: { type: 'string' }
        },
        required: ['path']
      }),
      tool('search_workspace', { ...SEARCH_PARAMS })
    ]
    const decision = evaluateToolsSchemaTransition(prev, next, base)
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.change).toBe('incompatible')
    expect(decision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.incompatible)
    expect(decision.reason).toContain('read_workspace_file')
  })

  it('fails closed as incompatible when fingerprint changes without prevTools', () => {
    const prev = fingerprintToolDefinitions(base)
    const decision = evaluateToolsSchemaTransition(prev, [tool('only_new', { type: 'object' })])
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.change).toBe('incompatible')
    expect(decision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.incompatible)
  })
})

describe('assertToolsSchemaStable', () => {
  const base = [
    tool('read_workspace_file', { ...READ_PARAMS }),
    tool('search_workspace', { ...SEARCH_PARAMS })
  ]

  it('remembers first-turn fingerprint and accepts identical re-offer', () => {
    const state = createToolsSchemaGuardState()
    const first = assertToolsSchemaStable(state, base)
    expect(first).toEqual({
      ok: true,
      fingerprint: fingerprintToolDefinitions(base),
      changed: false
    })
    const second = assertToolsSchemaStable(state, [...base].reverse())
    expect(second).toEqual(first)
  })

  it('allows narrow, restores original baseline, rejects tools beyond first-turn grant', () => {
    const state = createToolsSchemaGuardState()
    assertToolsSchemaStable(state, base)

    const narrowed = [tool('read_workspace_file', { ...READ_PARAMS })]
    const narrowDecision = assertToolsSchemaStable(state, narrowed)
    expect(narrowDecision.ok).toBe(true)
    if (!narrowDecision.ok || !narrowDecision.changed) {
      expect.fail('expected narrow')
      return
    }
    expect(narrowDecision.change).toBe('narrowed')
    expect(narrowDecision.auditCode).toBe(TOOLS_SCHEMA_AUDIT.narrowed)

    // Re-offering the original first-turn set is a restore, not expansion beyond the grant.
    const restored = assertToolsSchemaStable(state, base)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.changed).toBe(false)
    expect(restored.fingerprint).toBe(fingerprintToolDefinitions(base))

    // A tool that never existed in the first-turn grant is silent expansion.
    const beyond = [
      ...base,
      tool('shadow_tool', { type: 'object', properties: { x: { type: 'string' } } })
    ]
    const expand = assertToolsSchemaStable(state, beyond)
    expect(expand.ok).toBe(false)
    if (expand.ok) return
    expect(expand.change).toBe('expanded')
    expect(expand.auditCode).toBe(TOOLS_SCHEMA_AUDIT.expanded)
  })

  it('fails closed on mid-run parameter schema growth', () => {
    const state = createToolsSchemaGuardState()
    assertToolsSchemaStable(state, base)
    const grown = [
      tool('read_workspace_file', {
        type: 'object',
        properties: {
          path: { type: 'string' },
          encoding: { type: 'string' }
        },
        required: ['path']
      }),
      tool('search_workspace', { ...SEARCH_PARAMS })
    ]
    const decision = assertToolsSchemaStable(state, grown)
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.change).toBe('incompatible')
  })
})

describe('fingerprint determinism cross-check', () => {
  it('matches manual sha256 of sorted name+parameters payload shape', () => {
    const tools = [
      tool('b', { type: 'object', properties: { y: { type: 'string' }, x: { type: 'number' } } }),
      tool('a', { type: 'object', properties: { q: { type: 'boolean' } } })
    ]
    // Canonical order: name asc; object keys sorted in parameters JSON.
    const canonical = JSON.stringify([
      { name: 'a', parameters: JSON.stringify({ properties: { q: { type: 'boolean' } }, type: 'object' }) },
      {
        name: 'b',
        parameters: JSON.stringify({
          properties: { x: { type: 'number' }, y: { type: 'string' } },
          type: 'object'
        })
      }
    ])
    const expected = createHash('sha256').update(canonical).digest('hex')
    expect(fingerprintToolDefinitions(tools)).toBe(expected)
  })
})
