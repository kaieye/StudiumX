import { describe, expect, it } from 'vitest'

import {
  permissionKindForMcpEffect,
  resolveMcpToolEffect,
  validateToolEffectOverrides
} from '../../src/shared/mcp/effect-map'
import {
  classifyToolEffect,
  setMcpEffectLookup
} from '../../src/main/ai/tools/effect-policy'

describe('MCP effect map (ADR-0128 §6)', () => {
  it('defaults to privileged', () => {
    expect(resolveMcpToolEffect('anything')).toBe('privileged')
    expect(resolveMcpToolEffect('x', {})).toBe('privileged')
  })

  it('applies per-raw-name overrides', () => {
    expect(resolveMcpToolEffect('echo', { echo: 'read' })).toBe('read')
    expect(resolveMcpToolEffect('post', { post: 'external_write' })).toBe('external_write')
  })

  it('rejects invalid overrides', () => {
    expect(validateToolEffectOverrides({ a: 'nope' }).ok).toBe(false)
    expect(validateToolEffectOverrides({ a: 'read' }).ok).toBe(true)
  })

  it('maps non-read effects to interactive workspace_write permission kind', () => {
    expect(permissionKindForMcpEffect('read')).toBe('workspace_read')
    expect(permissionKindForMcpEffect('privileged')).toBe('workspace_write')
    expect(permissionKindForMcpEffect('external_write')).toBe('workspace_write')
    expect(permissionKindForMcpEffect('workspace_write')).toBe('workspace_write')
  })
})

describe('classifyToolEffect MCP path (ADR-0128 §6.1)', () => {
  it('defaults mcp__ tools to privileged when no runtime map', () => {
    setMcpEffectLookup(null)
    expect(classifyToolEffect('mcp__demo__echo')).toBe('privileged')
  })

  it('prefers runtime map argument then lookup hook', () => {
    setMcpEffectLookup((name) => (name === 'mcp__demo__from_lookup' ? 'read' : undefined))
    expect(
      classifyToolEffect('mcp__demo__from_map', new Map([['mcp__demo__from_map', 'external_write']]))
    ).toBe('external_write')
    expect(classifyToolEffect('mcp__demo__from_lookup')).toBe('read')
    setMcpEffectLookup(null)
  })

  it('does not treat non-mcp names via MCP lookup', () => {
    setMcpEffectLookup(() => 'read')
    // unknown static still privileged; known read tools stay read
    expect(classifyToolEffect('totally_unknown_tool_xyz')).toBe('privileged')
    setMcpEffectLookup(null)
  })
})

