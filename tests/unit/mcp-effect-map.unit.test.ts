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

describe('MCP effect map (ADR-0013)', () => {
  it('defaults to privileged', () => {
    expect(resolveMcpToolEffect('anything')).toBe('privileged')
    expect(resolveMcpToolEffect('x', {})).toBe('privileged')
  })

  it('ignores remote readOnlyHint when honorRemoteReadOnlyHint is off (default)', () => {
    expect(resolveMcpToolEffect('read_file')).toBe('privileged')
    expect(resolveMcpToolEffect('read_file', {})).toBe('privileged')
    expect(
      resolveMcpToolEffect('read_file', {}, {
        honorRemoteReadOnlyHint: false,
        annotations: { readOnlyHint: true, destructiveHint: false }
      })
    ).toBe('privileged')
    expect(resolveMcpToolEffect('read_file', { read_file: 'read' })).toBe('read')
  })

  it('maps trusted readOnlyHint to read when honorRemoteReadOnlyHint is true', () => {
    expect(
      resolveMcpToolEffect('remote_read', undefined, {
        honorRemoteReadOnlyHint: true,
        annotations: { readOnlyHint: true }
      })
    ).toBe('read')
    expect(
      resolveMcpToolEffect('remote_read', {}, {
        honorRemoteReadOnlyHint: true,
        annotations: { readOnlyHint: true, destructiveHint: false }
      })
    ).toBe('read')
  })

  it('does not map readOnlyHint when destructiveHint is true', () => {
    expect(
      resolveMcpToolEffect('risky', undefined, {
        honorRemoteReadOnlyHint: true,
        annotations: { readOnlyHint: true, destructiveHint: true }
      })
    ).toBe('privileged')
  })

  it('prefers explicit overrides over trusted readOnlyHint', () => {
    expect(
      resolveMcpToolEffect('echo', { echo: 'external_write' }, {
        honorRemoteReadOnlyHint: true,
        annotations: { readOnlyHint: true }
      })
    ).toBe('external_write')
    expect(
      resolveMcpToolEffect('echo', { echo: 'read' }, {
        honorRemoteReadOnlyHint: true,
        annotations: { readOnlyHint: false }
      })
    ).toBe('read')
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

describe('classifyToolEffect MCP path (ADR-0013)', () => {
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
