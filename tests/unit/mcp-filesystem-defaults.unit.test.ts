import { describe, expect, it } from 'vitest'

import { resolveFilesystemInjectionDefaults } from '../../src/shared/mcp/filesystem-mcp-defaults'

describe('resolveFilesystemInjectionDefaults (ADR-0141)', () => {
  it('defaults filesystem package args to granted', () => {
    const result = resolveFilesystemInjectionDefaults({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      allowFilesystemDefault: true
    })
    expect(result.workspaceRootInjection).toBe('granted')
    expect(result.injectionIdentity).toBe('filesystem_mcp')
  })

  it('honors explicit off', () => {
    const result = resolveFilesystemInjectionDefaults({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      workspaceRootInjection: 'off',
      allowFilesystemDefault: true
    })
    expect(result.workspaceRootInjection).toBe('off')
  })

  it('does not default non-fs stdio servers', () => {
    const result = resolveFilesystemInjectionDefaults({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'some-other-mcp'],
      allowFilesystemDefault: true
    })
    expect(result.workspaceRootInjection).toBe('off')
  })

  it('never grants for http', () => {
    const result = resolveFilesystemInjectionDefaults({
      transport: 'http',
      url: 'https://example.com/mcp',
      allowFilesystemDefault: true
    })
    expect(result.workspaceRootInjection).toBe('off')
  })
})
