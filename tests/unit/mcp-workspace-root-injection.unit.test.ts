/**
 * ADR-0013: controlled stdio workspace-root injection.
 */
import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'

import {
  canonicalizePath,
  isPathContained,
  resolveInjectedStdioServer
} from '../../src/main/mcp/workspace-root-injection'
import type { UserMcpServerV1 } from '../../src/shared/mcp/types'

function stdioServer(overrides: Partial<UserMcpServerV1> = {}): UserMcpServerV1 {
  return {
    id: 'fs',
    label: 'Filesystem',
    enabled: true,
    scope: 'user',
    workspaceRoot: null,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    cwd: null,
    envSecretRefs: {},
    envPlain: {},
    url: null,
    headersSecretRefs: {},
    headersPlain: {},
    timeoutMs: null,
    toolEffectOverrides: {},
    oauth: null,
    workspaceRootInjection: 'off',
    injectionIdentity: null,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides
  }
}

describe('resolveInjectedStdioServer', () => {
  const active = resolve('/tmp/studiumx-workspace-f')

  it('does not inject by default (off)', () => {
    const result = resolveInjectedStdioServer(stdioServer(), active)
    expect(result.injected).toBe(false)
    expect(result.reason).toBe('not_granted')
    expect(result.effectiveArgs).toEqual(stdioServer().args)
  })

  it('does not inject into http/sse', () => {
    const result = resolveInjectedStdioServer(
      stdioServer({
        transport: 'http',
        command: null,
        url: 'https://example.com/mcp',
        args: [],
        workspaceRootInjection: 'granted'
      }),
      active
    )
    expect(result.injected).toBe(false)
    expect(result.reason).toBe('not_stdio')
  })

  it('does not inject without active root', () => {
    const result = resolveInjectedStdioServer(
      stdioServer({ workspaceRootInjection: 'granted' }),
      '  '
    )
    expect(result.injected).toBe(false)
    expect(result.reason).toBe('no_active_root')
  })

  it('appends active root once when granted', () => {
    const server = stdioServer({
      workspaceRootInjection: 'granted',
      injectionIdentity: 'filesystem_mcp'
    })
    const result = resolveInjectedStdioServer(server, active)
    expect(result.injected).toBe(true)
    expect(result.effectiveArgs).toEqual([...server.args, canonicalizePath(active)])
    expect(result.server.args).toEqual(result.effectiveArgs)
    expect(result.injectedRoot).toBe(canonicalizePath(active))
  })

  it('does not duplicate an exact path segment already present', () => {
    const root = canonicalizePath(active)!
    const server = stdioServer({
      workspaceRootInjection: 'granted',
      args: ['-y', '@modelcontextprotocol/server-filesystem', root]
    })
    const result = resolveInjectedStdioServer(server, active)
    expect(result.injected).toBe(false)
    expect(result.reason).toBe('already_present')
    expect(result.effectiveArgs).toEqual(server.args)
  })

  it('rejects workspace scope mismatch', () => {
    const bound = resolve('/tmp/other-workspace')
    const result = resolveInjectedStdioServer(
      stdioServer({
        scope: 'workspace',
        workspaceRoot: bound,
        workspaceRootInjection: 'granted'
      }),
      active
    )
    expect(result.injected).toBe(false)
    expect(result.reason).toBe('workspace_scope_mismatch')
  })

  it('allows workspace scope when active is under bound root', () => {
    const bound = resolve('/tmp/studiumx-bound')
    const nested = resolve('/tmp/studiumx-bound/project')
    const result = resolveInjectedStdioServer(
      stdioServer({
        scope: 'workspace',
        workspaceRoot: bound,
        workspaceRootInjection: 'granted'
      }),
      nested
    )
    expect(result.injected).toBe(true)
    expect(result.effectiveArgs.at(-1)).toBe(canonicalizePath(nested))
  })

  it('never copies secrets into effective args', () => {
    const server = stdioServer({
      workspaceRootInjection: 'granted',
      envSecretRefs: { TOKEN: 'ref-1' },
      envPlain: { FOO: 'bar' }
    })
    const result = resolveInjectedStdioServer(server, active)
    expect(result.injected).toBe(true)
    expect(result.server.envSecretRefs).toEqual({ TOKEN: 'ref-1' })
    expect(result.effectiveArgs.join(' ')).not.toContain('ref-1')
    expect(result.effectiveArgs.join(' ')).not.toContain('bar')
  })
})

describe('path helpers', () => {
  it('canonicalizePath requires absolute after resolve', () => {
    expect(canonicalizePath(resolve('/tmp/x'))).toBe(resolve('/tmp/x'))
    expect(canonicalizePath('')).toBeNull()
  })

  it('isPathContained compares equality and prefix', () => {
    const root = resolve('/tmp/root')
    const child = resolve('/tmp/root/child')
    const other = resolve('/tmp/elsewhere')
    expect(isPathContained(root, root)).toBe(true)
    expect(isPathContained(child, root)).toBe(true)
    expect(isPathContained(other, root)).toBe(false)
  })
})
