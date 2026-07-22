import { describe, expect, it } from 'vitest'

import {
  allocateUniqueRawToolNames,
  decodeMcpToolName,
  encodeMcpToolName,
  isMcpToolName,
  sanitizeRawToolName
} from '../../src/shared/mcp/tool-name'

describe('MCP tool names (ADR-0128 §5.1)', () => {
  it('encodes and decodes mcp__server__tool', () => {
    const name = encodeMcpToolName('demo', 'echo')
    expect(name).toBe('mcp__demo__echo')
    expect(isMcpToolName(name)).toBe(true)
    expect(decodeMcpToolName(name)).toEqual({ serverId: 'demo', rawToolName: 'echo' })
  })

  it('sanitizes unsafe raw tool names and allocates unique names', () => {
    expect(sanitizeRawToolName('foo/bar')).toBe('foo_bar')
    const map = allocateUniqueRawToolNames(['a b', 'a_b', 'a b'])
    expect(map.get('a b')).toBe('a_b')
    expect(map.get('a_b')).toBe('a_b_2')
    expect(map.get('a b')).toBeTruthy()
  })

  it('rejects non-MCP names', () => {
    expect(isMcpToolName('write_workspace_file')).toBe(false)
    expect(decodeMcpToolName('mcp__')).toBeNull()
  })
})