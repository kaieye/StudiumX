import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserMcpSettingsSection } from '../../src/renderer/src/views/settings/sections/UserMcpSettingsSection'
import type {
  McpRuntimeServerView,
  TeachingSystemApi,
  UserMcpConfigPublicV1,
  UserMcpServerPublicV1
} from '../../src/shared/teaching-types'
import '../../src/renderer/src/i18n'

const originalTeachingSystem = window.teachingSystem

function installTeachingSystem(api: Partial<TeachingSystemApi> | undefined): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: api as TeachingSystemApi
  })
}

function server(
  id: string,
  overrides: Partial<UserMcpServerPublicV1> = {}
): UserMcpServerPublicV1 {
  return {
    id,
    label: `${id} server`,
    enabled: true,
    scope: 'user',
    workspaceRoot: null,
    transport: 'stdio',
    command: 'npx',
    args: ['-y', `@example/${id}`],
    cwd: null,
    envSecretConfigured: {},
    envPlain: {},
    envPlainKeys: [],
    url: null,
    headersSecretConfigured: {},
    headersPlain: {},
    timeoutMs: null,
    toolEffectOverrides: {},
    oauth: null,
    workspaceRootInjection: 'off' as const,
    injectionIdentity: null,
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
    ...overrides
  }
}

function config(
  servers: readonly UserMcpServerPublicV1[],
  enabled = true,
  fingerprint = 'fp-1'
): UserMcpConfigPublicV1 {
  return { schemaVersion: 1, enabled, autoConnect: false, honorRemoteReadOnlyHint: false, servers, fingerprint }
}

function createMutableApi(
  initial: UserMcpConfigPublicV1,
  runtime: readonly McpRuntimeServerView[] = []
): {
  api: Partial<TeachingSystemApi>
  mcpUpdateConfig: ReturnType<typeof vi.fn>
  mcpTestServer: ReturnType<typeof vi.fn>
  mcpRefreshServer: ReturnType<typeof vi.fn>
  current: () => UserMcpConfigPublicV1
} {
  let current = initial
  let revision = 1
  const mcpUpdateConfig = vi.fn(async (payload: { expectedFingerprint: string; config: unknown }) => {
    const document = payload.config as {
      enabled: boolean
      servers: Array<{
        id: string
        label: string
        enabled: boolean
        scope: 'user' | 'workspace'
        workspaceRoot: string | null
        transport: 'stdio' | 'http' | 'sse'
        command: string | null
        args: string[]
        cwd: string | null
        envSecretRefs: Record<string, string>
        envPlain: Record<string, string>
        url: string | null
        headersSecretRefs: Record<string, string>
        headersPlain: Record<string, string>
        timeoutMs: number | null
        createdAt: string
        updatedAt: string
        toolEffectOverrides: UserMcpServerPublicV1['toolEffectOverrides']
      }>
    }
    revision += 1
    current = {
      schemaVersion: 1,
      enabled: document.enabled,
      autoConnect: (document as { autoConnect?: boolean }).autoConnect === true,
      honorRemoteReadOnlyHint:
        (document as { honorRemoteReadOnlyHint?: boolean }).honorRemoteReadOnlyHint === true,
      fingerprint: `fp-${revision}`,
      servers: document.servers.map((item) => {
        const previous = current.servers.find((candidate) => candidate.id === item.id)
        return {
          ...item,
          envSecretConfigured: Object.fromEntries(
            Object.keys(item.envSecretRefs).map((key) => [key, true])
          ),
          envPlainKeys: Object.keys(item.envPlain),
          headersSecretConfigured: Object.fromEntries(
            Object.keys(item.headersSecretRefs).map((key) => [key, true])
          ),
          // The mutable UI harness does not materialize refs; preserve prior public flags too.
          ...(previous
            ? {
                envSecretConfigured: {
                  ...previous.envSecretConfigured,
                  ...Object.fromEntries(Object.keys(item.envSecretRefs).map((key) => [key, true]))
                },
                headersSecretConfigured: {
                  ...previous.headersSecretConfigured,
                  ...Object.fromEntries(
                    Object.keys(item.headersSecretRefs).map((key) => [key, true])
                  )
                }
              }
            : {})
        }
      })
    }
    return { ok: true as const, config: current }
  })
  const mcpTestServer = vi.fn(async ({ serverId }: { serverId: string }) => ({
    ok: true as const,
    serverId,
    tools: []
  }))
  const mcpRefreshServer = vi.fn(async ({ serverId }: { serverId: string }) => ({
    ok: true as const,
    serverId,
    tools: []
  }))
  return {
    api: {
      mcpGetConfig: vi.fn(async () => ({ ok: true as const, config: current })),
      mcpUpdateConfig,
      mcpListRuntime: vi.fn(async () => ({ ok: true as const, servers: runtime })),
      mcpTestServer,
      mcpRefreshServer
    },
    mcpUpdateConfig,
    mcpTestServer,
    mcpRefreshServer,
    current: () => current
  }
}

beforeEach(() => {
  installTeachingSystem(undefined)
})

afterEach(() => {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: originalTeachingSystem
  })
})

describe('UserMcpSettingsSection', () => {
  it('renders a compact runtime-aware list and filters servers locally', async () => {
    const alpha = server('alpha')
    const beta = server('beta', {
      transport: 'http',
      command: null,
      args: [],
      url: 'https://example.com/mcp'
    })
    const harness = createMutableApi(config([alpha, beta]), [
      { id: 'alpha', state: 'connected', toolCount: 3 },
      {
        id: 'beta',
        state: 'error',
        errorCode: 'mcp_server_unavailable',
        lastErrorMessage: 'Unable to connect'
      }
    ])
    installTeachingSystem(harness.api)
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot={null} />)

    await screen.findByText('alpha server')
    expect(screen.getAllByTestId('mcp-server-row')).toHaveLength(2)
    expect(screen.getByText(/3 个工具|3 tools/)).toBeInTheDocument()
    expect(screen.getByText('https://example.com/mcp')).toBeInTheDocument()
    expect(screen.getByText(/Unable to connect/)).toBeInTheDocument()
    expect(screen.queryByTestId('mcp-editor')).not.toBeInTheDocument()

    await user.type(screen.getByTestId('mcp-search'), 'example.com')
    expect(screen.queryByText('alpha server')).not.toBeInTheDocument()
    expect(screen.getByText('beta server')).toBeInTheDocument()
  })

  it('renders collapsible multi-source configuration view when IPC is available', async () => {
    const mcpGetEffectiveView = vi.fn(async () => ({
      ok: true as const,
      view: {
        enabled: true,
        autoConnect: false,
        effectiveServers: [
          {
            id: 'alpha',
            label: 'alpha server',
            sourceKind: 'user' as const,
            sourceLabel: 'userData/mcp/config.v1.json',
            enabled: true,
            transport: 'stdio' as const,
            state: 'connected' as const
          }
        ],
        shadowed: [
          {
            id: 'alpha',
            sourceKind: 'workspace' as const,
            sourceLabel: '.studiumx/mcp.json',
            shadowedBy: {
              id: 'alpha',
              sourceKind: 'user' as const,
              sourceLabel: 'userData/mcp/config.v1.json'
            }
          }
        ],
        warnings: []
      }
    }))
    installTeachingSystem({
      mcpGetConfig: vi.fn(async () => ({ ok: true as const, config: config([server('alpha')]) })),
      mcpUpdateConfig: vi.fn(),
      mcpListRuntime: vi.fn(async () => ({
        ok: true as const,
        servers: [{ id: 'alpha', state: 'connected' as const, toolCount: 1 }]
      })),
      mcpTestServer: vi.fn(),
      mcpGetEffectiveView
    })
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot={null} />)

    await screen.findByText('alpha server')
    expect(mcpGetEffectiveView).toHaveBeenCalled()
    expect(screen.getByTestId('mcp-sources-section')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-server-source-badge')).toBeInTheDocument()

    await user.click(screen.getByTestId('mcp-sources-toggle'))
    expect(screen.getByTestId('mcp-sources-body')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-source-winner-alpha')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-sources-shadowed')).toBeInTheDocument()
  })

  it('refreshes a server only from the explicit action without using test-server', async () => {
    const mcpListRuntime = vi.fn(async () => ({
      ok: true as const,
      servers: [
        {
          id: 'alpha',
          state: 'connected' as const,
          toolCount: 2,
          inventory: {
            generation: 4,
            stale: true,
            discoveredToolCount: 2,
            registeredToolCount: 2,
            rejectedToolCount: 0
          }
        }
      ]
    }))
    const mcpTestServer = vi.fn()
    const mcpRefreshServer = vi.fn(async ({ serverId }: { serverId: string }) => ({
      ok: true as const,
      serverId,
      tools: []
    }))
    installTeachingSystem({
      mcpGetConfig: vi.fn(async () => ({ ok: true as const, config: config([server('alpha')]) })),
      mcpUpdateConfig: vi.fn(),
      mcpListRuntime,
      mcpTestServer,
      mcpRefreshServer
    })
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot="/tmp/course" />)
    await screen.findByText('alpha server')
    expect(screen.getByTestId('mcp-inventory-summary')).toHaveTextContent(
      /2 discovered.*2 registered.*0 rejected|已发现 2.*已注册 2.*已拒绝 0/i
    )
    expect(screen.getByTestId('mcp-inventory-summary')).toHaveTextContent(
      /inventory changed|工具清单已变更/i
    )

    expect(mcpRefreshServer).not.toHaveBeenCalled()
    expect(mcpTestServer).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('mcp-refresh-server'))

    await waitFor(() =>
      expect(mcpRefreshServer).toHaveBeenCalledWith({
        serverId: 'alpha',
        workspaceRoot: '/tmp/course'
      })
    )
    expect(mcpTestServer).not.toHaveBeenCalled()
    expect(mcpListRuntime).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('mcp-status')).toHaveTextContent(/工具已刷新|tools refreshed/i)
  })

  it('keeps add cancellable and saves standard whitespace-separated arguments immediately', async () => {
    const harness = createMutableApi(config([], false))
    installTeachingSystem(harness.api)
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot={null} />)
    await screen.findByTestId('mcp-empty')

    await user.click(screen.getByTestId('mcp-add-server'))
    expect(within(screen.getByTestId('mcp-editor')).queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mcp-root-control')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /返回服务器列表|Back to server list/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/^参数$|^Arguments$/)).not.toBeVisible()
    await user.click(screen.getByText(/高级选项|Advanced options/))
    expect(screen.getByLabelText(/^参数$|^Arguments$/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: /取消|Cancel/ }))
    expect(screen.queryByTestId('mcp-editor')).not.toBeInTheDocument()
    expect(harness.mcpUpdateConfig).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('mcp-add-server'))
    await user.type(screen.getByLabelText(/^名称$|^Name$/), 'Example MCP')
    await user.type(screen.getByLabelText(/^命令$|^Command$/), 'npx')
    fireEvent.change(screen.getByLabelText(/^参数$|^Arguments$/), {
      target: { value: '-y   @example/server' }
    })
    await user.click(screen.getByTestId('mcp-editor-save'))

    await waitFor(() => expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(1))
    const submitted = harness.mcpUpdateConfig.mock.calls[0]?.[0].config as {
      servers: Array<{ id: string; args: string[]; enabled: boolean }>
    }
    expect(submitted.servers[0]?.id).toBe('example-mcp')
    expect(submitted.servers[0]?.args).toEqual(['-y', '@example/server'])
    expect(submitted.servers[0]?.enabled).toBe(true)
    await screen.findByText('Example MCP')
    expect(screen.queryByTestId('mcp-status')).not.toBeInTheDocument()
  })

  it('preserves the internal id and configured secrets while editing, then confirms deletion', async () => {
    const existing = server('locked', {
      envSecretConfigured: { API_TOKEN: true },
      envPlain: { LOG_LEVEL: 'debug' },
      envPlainKeys: ['LOG_LEVEL']
    })
    const harness = createMutableApi(config([existing]))
    installTeachingSystem(harness.api)
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot={null} />)
    await screen.findByText('locked server')

    await user.click(screen.getByTestId('mcp-edit-server'))
    expect(screen.queryByLabelText(/Server ID|服务器 ID/)).not.toBeInTheDocument()
    expect(
      (screen.getByLabelText(/环境变量|Environment variables/) as HTMLTextAreaElement).value
    ).toContain('<configured>')
    const commandInput = screen.getByLabelText(/^命令$|^Command$/)
    await user.clear(commandInput)
    await user.type(commandInput, 'node')
    await user.click(screen.getByTestId('mcp-editor-save'))
    await waitFor(() => expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(1))
    expect(harness.current().servers[0]?.id).toBe('locked')
    const submitted = harness.mcpUpdateConfig.mock.calls[0]?.[0].config as {
      servers: Array<{ envSecretRefs: Record<string, string> }>
    }
    expect(submitted.servers[0]?.envSecretRefs.API_TOKEN).toBe('mcp-secret:keep')

    await user.click(screen.getByTestId('mcp-remove-server'))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(1)
    await user.click(screen.getByTestId('mcp-confirm-delete'))
    await waitFor(() => expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(2))
    await screen.findByTestId('mcp-empty')
  })

  it('accepts common wrapped MCP JSON for Streamable HTTP', async () => {
    const harness = createMutableApi(config([]))
    installTeachingSystem(harness.api)
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot={null} />)
    await screen.findByTestId('mcp-empty')
    await user.click(screen.getByTestId('mcp-add-server'))
    await user.click(screen.getByRole('tab', { name: 'JSON' }))
    fireEvent.change(screen.getByTestId('mcp-editor-json'), {
      target: {
        value: JSON.stringify({
          mcpServers: {
            remote: {
              type: 'streamableHttp',
              url: 'https://example.com/mcp',
              timeoutMs: 45000,
              headers: { Authorization: 'Bearer example' }
            }
          }
        })
      }
    })
    await user.click(screen.getByTestId('mcp-editor-save'))

    await waitFor(() => expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(1))
    const payload = harness.mcpUpdateConfig.mock.calls[0]?.[0] as {
      config: { servers: Array<Record<string, unknown>> }
      secretChanges?: Record<string, { headers?: Record<string, string> }>
    }
    expect(payload.config.servers[0]).toMatchObject({
      id: 'remote',
      label: 'remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      timeoutMs: 45000,
      headersSecretRefs: { Authorization: 'mcp-secret:pending' }
    })
    expect(payload.secretChanges?.remote?.headers?.Authorization).toBe('Bearer example')
  })

  it('binds workspace scope to the active workspace and sends it when testing', async () => {
    const harness = createMutableApi(config([]))
    installTeachingSystem(harness.api)
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot="/tmp/course" />)
    await screen.findByTestId('mcp-empty')
    await user.click(screen.getByTestId('mcp-add-server'))
    await user.type(screen.getByLabelText(/^名称$|^Name$/), 'Workspace MCP')
    await user.selectOptions(screen.getByLabelText(/^范围$|^Scope$/), 'workspace')
    await user.type(screen.getByLabelText(/^命令$|^Command$/), 'node')
    await user.click(screen.getByTestId('mcp-editor-save'))

    await waitFor(() => expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(1))
    const submitted = harness.mcpUpdateConfig.mock.calls[0]?.[0].config as {
      servers: Array<{ scope: string; workspaceRoot: string | null }>
    }
    expect(submitted.servers[0]).toMatchObject({
      scope: 'workspace',
      workspaceRoot: '/tmp/course'
    })

    await user.click(screen.getByTestId('mcp-test-server'))
    await waitFor(() => expect(harness.mcpTestServer).toHaveBeenCalledTimes(1))
    expect(harness.mcpTestServer).toHaveBeenCalledWith({
      serverId: 'workspace-mcp',
      workspaceRoot: '/tmp/course'
    })
  })

  it('does not test unsaved editor values when persistence fails', async () => {
    const currentConfig = config([server('alpha')])
    const mcpUpdateConfig = vi.fn(async () => ({
      ok: false as const,
      code: 'mcp_invalid_config' as const,
      message: 'rejected config'
    }))
    const mcpTestServer = vi.fn()
    installTeachingSystem({
      mcpGetConfig: vi.fn(async () => ({ ok: true as const, config: currentConfig })),
      mcpUpdateConfig,
      mcpListRuntime: vi.fn(async () => ({ ok: true as const, servers: [] })),
      mcpTestServer
    })
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot={null} />)
    await screen.findByText('alpha server')
    await user.click(screen.getByTestId('mcp-edit-server'))
    const commandInput = screen.getByLabelText(/^命令$|^Command$/)
    await user.clear(commandInput)
    await user.type(commandInput, 'replacement-command')
    await user.click(screen.getByTestId('mcp-editor-save'))

    await waitFor(() => expect(mcpUpdateConfig).toHaveBeenCalledTimes(1))
    expect(screen.getByTestId('mcp-editor')).toBeInTheDocument()
    expect(screen.getByTestId('mcp-status')).toHaveTextContent('rejected config')
    expect(mcpTestServer).not.toHaveBeenCalled()
  })

  it('toggles MCP immediately without confirmation or success cards', async () => {
    const harness = createMutableApi(config([server('alpha')], false))
    installTeachingSystem(harness.api)
    const user = userEvent.setup()

    render(<UserMcpSettingsSection workspaceRoot={null} />)
    await screen.findByText('alpha server')

    const rootSwitch = within(screen.getByTestId('mcp-root-control')).getByRole('switch')
    await user.click(rootSwitch)

    await waitFor(() => expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(1))
    const submitted = harness.mcpUpdateConfig.mock.calls[0]?.[0].config as {
      enabled: boolean
      autoConnect: boolean
    }
    expect(submitted.enabled).toBe(true)
    // ADR-0141: enabling root defaults smart-connect on.
    expect(submitted.autoConnect).toBe(true)
    expect(screen.queryByTestId('mcp-enable-confirm')).not.toBeInTheDocument()
    await waitFor(() => expect(rootSwitch).toHaveAttribute('aria-checked', 'true'))
    expect(screen.queryByTestId('mcp-status')).not.toBeInTheDocument()

    await user.click(rootSwitch)
    await waitFor(() => expect(harness.mcpUpdateConfig).toHaveBeenCalledTimes(2))
    const disabledSubmission = harness.mcpUpdateConfig.mock.calls[1]?.[0].config as {
      enabled: boolean
      autoConnect: boolean
    }
    expect(disabledSubmission.enabled).toBe(false)
    expect(disabledSubmission.autoConnect).toBe(false)
    await waitFor(() => expect(rootSwitch).toHaveAttribute('aria-checked', 'false'))
    expect(screen.queryByTestId('mcp-status')).not.toBeInTheDocument()
  })
})
