/**
 * User MCP settings (ADR-0128 Phase D).
 * Default-off root switch; stdio server list; test connection; no marketplace / YOLO.
 */

import { Loader2, Network, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  McpListedToolSummary,
  McpRuntimeServerView,
  UserMcpConfigPublicV1,
  UserMcpServerPublicV1
} from '../../../../../shared/mcp/types'
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsTextInput,
  ToggleSwitch
} from '../SettingsPrimitives'

type StatusMessage =
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'success'; text: string }
  | null

type DraftServer = {
  id: string
  label: string
  enabled: boolean
  command: string
  argsText: string
  cwd: string
  createdAt: string
  updatedAt: string
  toolEffectOverrides: UserMcpServerPublicV1['toolEffectOverrides']
}

function nowIso(): string {
  return new Date().toISOString()
}

function splitArgs(text: string): string[] {
  return text
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function publicToDraft(server: UserMcpServerPublicV1): DraftServer {
  return {
    id: server.id,
    label: server.label,
    enabled: server.enabled,
    command: server.command ?? '',
    argsText: (server.args ?? []).join(' '),
    cwd: server.cwd ?? '',
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    toolEffectOverrides: server.toolEffectOverrides
  }
}

function draftToConfigDocument(
  enabled: boolean,
  servers: readonly DraftServer[]
): Record<string, unknown> {
  const stamp = nowIso()
  return {
    schemaVersion: 1,
    enabled,
    servers: servers.map((server) => ({
      id: server.id.trim(),
      label: server.label.trim() || server.id.trim(),
      enabled: server.enabled,
      transport: 'stdio',
      command: server.command.trim(),
      args: splitArgs(server.argsText),
      cwd: server.cwd.trim() ? server.cwd.trim() : null,
      // Secrets / envPlain are merged server-side from prior config by id.
      envSecretRefs: {},
      envPlain: {},
      url: null,
      headersSecretRefs: {},
      toolEffectOverrides: server.toolEffectOverrides ?? {},
      createdAt: server.createdAt || stamp,
      updatedAt: stamp
    }))
  }
}

function newDraftServer(existingIds: ReadonlySet<string>): DraftServer {
  let n = 1
  let id = 'my-server'
  while (existingIds.has(id)) {
    n += 1
    id = `my-server-${n}`
  }
  const stamp = nowIso()
  return {
    id,
    label: 'My MCP server',
    enabled: false,
    command: 'npx',
    argsText: '-y some-mcp-server',
    cwd: '',
    createdAt: stamp,
    updatedAt: stamp,
    toolEffectOverrides: {}
  }
}

export function UserMcpSettingsSection() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [rootEnabled, setRootEnabled] = useState(false)
  const [fingerprint, setFingerprint] = useState('')
  const [servers, setServers] = useState<DraftServer[]>([])
  const [runtime, setRuntime] = useState<readonly McpRuntimeServerView[]>([])
  const [testTools, setTestTools] = useState<Record<string, readonly McpListedToolSummary[]>>({})
  const [status, setStatus] = useState<StatusMessage>(null)
  const [dirty, setDirty] = useState(false)

  const api = window.teachingSystem
  const available =
    typeof api?.mcpGetConfig === 'function' &&
    typeof api?.mcpUpdateConfig === 'function' &&
    typeof api?.mcpTestServer === 'function' &&
    typeof api?.mcpListRuntime === 'function'

  const applyPublic = useCallback((config: UserMcpConfigPublicV1) => {
    setRootEnabled(config.enabled)
    setFingerprint(config.fingerprint)
    setServers(config.servers.map(publicToDraft))
    setDirty(false)
  }, [])

  const reload = useCallback(async () => {
    if (!available) {
      setLoading(false)
      setStatus({ kind: 'error', text: t('mcp.status.unavailable') })
      return
    }
    setLoading(true)
    setStatus({ kind: 'info', text: t('mcp.status.loading') })
    try {
      const [configResult, runtimeResult] = await Promise.all([
        api.mcpGetConfig(),
        api.mcpListRuntime()
      ])
      if (!configResult.ok) {
        setStatus({ kind: 'error', text: configResult.message || t('mcp.status.invalid') })
        return
      }
      applyPublic(configResult.config)
      setRuntime(runtimeResult.ok ? runtimeResult.servers : [])
      setStatus(null)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : t('mcp.status.unavailable')
      })
    } finally {
      setLoading(false)
    }
  }, [api, applyPublic, available, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const runtimeById = useMemo(() => {
    const map = new Map<string, McpRuntimeServerView>()
    for (const item of runtime) map.set(item.id, item)
    return map
  }, [runtime])

  const updateServer = (index: number, patch: Partial<DraftServer>): void => {
    setServers((prev) =>
      prev.map((server, i) => (i === index ? { ...server, ...patch } : server))
    )
    setDirty(true)
  }

  const removeServer = (index: number): void => {
    setServers((prev) => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  const addServer = (): void => {
    setServers((prev) => {
      const ids = new Set(prev.map((s) => s.id))
      return [...prev, newDraftServer(ids)]
    })
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!available) {
      setStatus({ kind: 'error', text: t('mcp.status.unavailable') })
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const result = await api.mcpUpdateConfig({
        expectedFingerprint: fingerprint,
        config: draftToConfigDocument(rootEnabled, servers)
      })
      if (!result.ok) {
        if (result.code === 'mcp_cas_conflict') {
          await reload()
          setStatus({ kind: 'error', text: t('mcp.status.casConflict') })
          return
        }
        setStatus({ kind: 'error', text: result.message || t('mcp.status.invalid') })
        return
      }
      applyPublic(result.config)
      const runtimeResult = await api.mcpListRuntime()
      setRuntime(runtimeResult.ok ? runtimeResult.servers : [])
      setStatus({ kind: 'success', text: t('mcp.status.saved') })
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : t('mcp.status.invalid')
      })
    } finally {
      setSaving(false)
    }
  }

  const testServer = async (serverId: string): Promise<void> => {
    if (!available) {
      setStatus({ kind: 'error', text: t('mcp.status.unavailable') })
      return
    }
    if (dirty) {
      // Persist first so test uses current form values.
      await save()
    }
    setTestingId(serverId)
    try {
      const result = await api.mcpTestServer({ serverId })
      if (!result.ok) {
        setStatus({
          kind: 'error',
          text: t('mcp.status.testFail', { message: result.message })
        })
        return
      }
      setTestTools((prev) => ({ ...prev, [serverId]: result.tools }))
      setStatus({
        kind: 'success',
        text: t('mcp.status.testOk', { count: result.tools.length })
      })
      const runtimeResult = await api.mcpListRuntime()
      setRuntime(runtimeResult.ok ? runtimeResult.servers : [])
    } catch (error) {
      setStatus({
        kind: 'error',
        text: t('mcp.status.testFail', {
          message: error instanceof Error ? error.message : 'unknown'
        })
      })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <SettingsPanel title={t('mcp.title')} subtitle={t('mcp.subtitle')}>
      <SettingsCard>
        <p className="settings-list-copy" data-testid="mcp-risk-note">
          {t('mcp.riskNote')}
        </p>
        <p className="settings-empty-note">{t('mcp.status.experimental')}</p>
        <SettingsRow label={t('mcp.rootEnabled.label')} detail={t('mcp.rootEnabled.detail')}>
          <ToggleSwitch
            checked={rootEnabled}
            onChange={(checked) => {
              setRootEnabled(checked)
              setDirty(true)
            }}
          />
        </SettingsRow>
        {!rootEnabled ? (
          <p className="settings-empty-note" data-testid="mcp-root-off-note">
            {t('mcp.status.disabledRoot')}
          </p>
        ) : null}
        <SettingsRow label={t('mcp.servers.save')}>
          <div className="settings-actions">
            <button
              className="ghost-button"
              type="button"
              onClick={() => void reload()}
              disabled={loading || saving}
              data-testid="mcp-reload"
            >
              <RefreshCw size={15} className={loading ? 'spin' : undefined} />
              {t('mcp.servers.reload')}
            </button>
            <button
              className="ghost-button strong"
              type="button"
              onClick={() => void save()}
              disabled={loading || saving || !dirty}
              data-testid="mcp-save"
            >
              {saving ? <Loader2 size={15} className="is-spinning" /> : <Network size={15} />}
              {saving ? t('mcp.servers.saving') : t('mcp.servers.save')}
            </button>
            <button
              className="ghost-button"
              type="button"
              onClick={addServer}
              disabled={loading || saving}
              data-testid="mcp-add-server"
            >
              <Plus size={15} />
              {t('mcp.servers.add')}
            </button>
          </div>
        </SettingsRow>
        {status ? (
          <div
            className="settings-empty-note"
            role={status.kind === 'error' ? 'alert' : 'status'}
            data-testid="mcp-status"
            data-kind={status.kind}
          >
            {status.text}
          </div>
        ) : null}
      </SettingsCard>

      <h3 style={{ margin: '0.75rem 0 0.5rem', fontSize: '0.95rem' }}>
        {t('mcp.servers.heading')}
      </h3>

      {loading ? (
        <SettingsCard>
          <p className="settings-list-copy">{t('mcp.status.loading')}</p>
        </SettingsCard>
      ) : null}

      {!loading && servers.length === 0 ? (
        <SettingsCard>
          <p className="settings-list-copy" data-testid="mcp-empty">
            {t('mcp.servers.empty')}
          </p>
        </SettingsCard>
      ) : null}

      {servers.map((server, index) => {
        const runtimeState = runtimeById.get(server.id)
        const tools = testTools[server.id]
        return (
          <SettingsCard key={`${server.createdAt}-${index}`}>
            <SettingsRow label={t('mcp.servers.enabled')}>
              <ToggleSwitch
                checked={server.enabled}
                onChange={(checked) => updateServer(index, { enabled: checked })}
              />
            </SettingsRow>
            <SettingsRow label={t('mcp.servers.id')} detail={t('mcp.servers.idHint')}>
              <SettingsTextInput
                value={server.id}
                onChange={(id) => updateServer(index, { id })}
              />
            </SettingsRow>
            <SettingsRow label={t('mcp.servers.label')}>
              <SettingsTextInput
                value={server.label}
                onChange={(label) => updateServer(index, { label })}
              />
            </SettingsRow>
            <SettingsRow label={t('mcp.servers.transport')}>
              <span className="settings-empty-note">{t('mcp.servers.transportStdio')}</span>
            </SettingsRow>
            <SettingsRow label={t('mcp.servers.command')}>
              <SettingsTextInput
                value={server.command}
                onChange={(command) => updateServer(index, { command })}
              />
            </SettingsRow>
            <SettingsRow label={t('mcp.servers.args')} detail={t('mcp.servers.argsHint')}>
              <SettingsTextInput
                value={server.argsText}
                onChange={(argsText) => updateServer(index, { argsText })}
              />
            </SettingsRow>
            <SettingsRow label={t('mcp.servers.cwd')} detail={t('mcp.servers.cwdHint')}>
              <SettingsTextInput
                value={server.cwd}
                placeholder="/absolute/path"
                onChange={(cwd) => updateServer(index, { cwd })}
              />
            </SettingsRow>
            <SettingsRow
              label={t('mcp.servers.runtime')}
              detail={
                runtimeState
                  ? `${t(`mcp.runtimeState.${runtimeState.state}`)}${
                      runtimeState.toolCount != null ? ` · ${runtimeState.toolCount}` : ''
                    }${runtimeState.errorCode ? ` · ${runtimeState.errorCode}` : ''}`
                  : t('mcp.runtimeState.idle')
              }
            >
              <div className="settings-actions">
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => void testServer(server.id)}
                  disabled={loading || saving || testingId === server.id || !server.id.trim()}
                  data-testid="mcp-test-server"
                >
                  {testingId === server.id ? (
                    <Loader2 size={15} className="is-spinning" />
                  ) : (
                    <Network size={15} />
                  )}
                  {testingId === server.id ? t('mcp.servers.testing') : t('mcp.servers.test')}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => removeServer(index)}
                  disabled={loading || saving}
                  data-testid="mcp-remove-server"
                >
                  <Trash2 size={15} />
                  {t('mcp.servers.remove')}
                </button>
              </div>
            </SettingsRow>
            {tools && tools.length > 0 ? (
              <div className="settings-list-copy" style={{ padding: '0 1rem 0.85rem' }}>
                <strong>{t('mcp.toolsSummary.heading')}</strong>
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
                  {tools.slice(0, 24).map((tool) => (
                    <li key={tool.registeredName || tool.name}>
                      <code>{tool.registeredName || tool.name}</code>
                      {' · '}
                      {t('mcp.toolsSummary.effect')}: {tool.effectClass}
                      {' · '}
                      {tool.registered
                        ? t('mcp.toolsSummary.registered')
                        : t('mcp.toolsSummary.skipped')}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </SettingsCard>
        )
      })}
    </SettingsPanel>
  )
}
