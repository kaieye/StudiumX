/**
 * User MCP settings (ADR-0128).
 * Default-off user/workspace servers over stdio, Streamable HTTP, or SSE; no marketplace / remote sync / YOLO.
 */

import { Plus, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  McpListedToolSummary,
  McpRuntimeServerView,
  UserMcpConfigPublicV1,
  UserMcpServerPublicV1
} from '../../../../../shared/mcp/types'
import { SettingsPanel, ToggleSwitch } from '../SettingsPrimitives'
import { UserMcpServerEditor } from './UserMcpServerEditor'
import { UserMcpServerList } from './UserMcpServerList'
import {
  createDraftMcpServer,
  draftMcpServersToConfigUpdate,
  normalizeDraftMcpServer,
  nowIso,
  publicMcpConfigToDrafts,
  publicMcpServerToDraft,
  type DraftMcpServer
} from './user-mcp-settings-model'

type StatusMessage =
  | { kind: 'info'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'success'; text: string }
  | null

type EditorState =
  | { mode: 'create'; draft: DraftMcpServer }
  | { mode: 'edit'; draft: DraftMcpServer; originalServer: UserMcpServerPublicV1 }

export function UserMcpSettingsSection({ workspaceRoot }: { workspaceRoot: string | null }) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [config, setConfig] = useState<UserMcpConfigPublicV1 | null>(null)
  const [runtime, setRuntime] = useState<readonly McpRuntimeServerView[]>([])
  const [testTools, setTestTools] = useState<Record<string, readonly McpListedToolSummary[]>>({})
  const [status, setStatus] = useState<StatusMessage>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const api = window.teachingSystem
  const available =
    typeof api?.mcpGetConfig === 'function' &&
    typeof api?.mcpUpdateConfig === 'function' &&
    typeof api?.mcpTestServer === 'function' &&
    typeof api?.mcpListRuntime === 'function'

  const rootEnabled = config?.enabled ?? false
  const servers = config?.servers ?? []
  const busy = loading || saving || testingId != null
  const existingIds = useMemo(() => new Set(servers.map((server) => server.id)), [servers])

  const refreshRuntime = useCallback(async (): Promise<void> => {
    if (!available) return
    try {
      const result = await api.mcpListRuntime()
      setRuntime(result.ok ? result.servers : [])
    } catch {
      // Runtime polling is best-effort. Explicit operations still surface errors.
    }
  }, [api, available])

  const reload = useCallback(async (): Promise<void> => {
    setEditor(null)
    setDeletingId(null)
    if (!available) {
      setLoading(false)
      setConfig(null)
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
        setConfig(null)
        setStatus({ kind: 'error', text: configResult.message || t('mcp.status.invalid') })
        return
      }
      setConfig(configResult.config)
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
  }, [api, available, t])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!available || loading) return
    const timer = window.setInterval(() => void refreshRuntime(), 5_000)
    return () => window.clearInterval(timer)
  }, [available, loading, refreshRuntime])

  const persistConfig = useCallback(
    async (
      nextEnabled: boolean,
      nextServers: readonly DraftMcpServer[]
    ): Promise<UserMcpConfigPublicV1 | null> => {
      if (!available || !config) {
        setStatus({ kind: 'error', text: t('mcp.status.unavailable') })
        return null
      }
      setSaving(true)
      setStatus(null)
      try {
        const update = draftMcpServersToConfigUpdate(nextEnabled, nextServers)
        const result = await api.mcpUpdateConfig({
          expectedFingerprint: config.fingerprint,
          config: update.config,
          secretChanges: update.secretChanges
        })
        if (!result.ok) {
          if (result.code === 'mcp_cas_conflict') {
            await reload()
            setStatus({ kind: 'error', text: t('mcp.status.casConflict') })
            return null
          }
          setStatus({ kind: 'error', text: result.message || t('mcp.status.invalid') })
          return null
        }
        setConfig(result.config)
        await refreshRuntime()
        return result.config
      } catch (error) {
        setStatus({
          kind: 'error',
          text: error instanceof Error ? error.message : t('mcp.status.invalid')
        })
        return null
      } finally {
        setSaving(false)
      }
    },
    [api, available, config, refreshRuntime, reload, t]
  )

  const requestRootToggle = (enabled: boolean): void => {
    if (!config || saving) return
    void persistConfig(enabled, publicMcpConfigToDrafts(config))
  }

  const openCreateEditor = (): void => {
    setDeletingId(null)
    setStatus(null)
    setEditor({ mode: 'create', draft: createDraftMcpServer(existingIds) })
  }

  const openEditEditor = (server: UserMcpServerPublicV1): void => {
    setDeletingId(null)
    setStatus(null)
    setEditor({ mode: 'edit', draft: publicMcpServerToDraft(server), originalServer: server })
  }

  const closeEditor = (): void => {
    setStatus(null)
    setEditor(null)
  }

  const saveEditor = async (draft: DraftMcpServer): Promise<boolean> => {
    if (!config || !editor) return false
    const normalized = normalizeDraftMcpServer(
      draft,
      existingIds,
      editor.mode === 'edit' ? editor.originalServer.id : undefined
    )
    const currentDrafts = publicMcpConfigToDrafts(config)
    const nextServers =
      editor.mode === 'create'
        ? [...currentDrafts, normalized]
        : currentDrafts.map((server) =>
            server.id === editor.originalServer.id
              ? { ...normalized, id: editor.originalServer.id }
              : server
          )
    const saved = await persistConfig(config.enabled, nextServers)
    if (!saved) return false
    setEditor(null)
    return true
  }

  const toggleServer = async (
    server: UserMcpServerPublicV1,
    enabled: boolean
  ): Promise<void> => {
    if (!config) return
    const stamp = nowIso()
    const nextServers = publicMcpConfigToDrafts(config).map((draft) =>
      draft.id === server.id ? { ...draft, enabled, updatedAt: stamp } : draft
    )
    await persistConfig(config.enabled, nextServers)
  }

  const deleteServer = async (serverId: string): Promise<void> => {
    if (!config) return
    const nextServers = publicMcpConfigToDrafts(config).filter((draft) => draft.id !== serverId)
    const saved = await persistConfig(config.enabled, nextServers)
    if (!saved) return
    setDeletingId(null)
    setTestTools((current) => {
      const next = { ...current }
      delete next[serverId]
      return next
    })
  }

  const testServer = async (server: UserMcpServerPublicV1): Promise<void> => {
    if (!available || !rootEnabled || !server.enabled) return
    setTestingId(server.id)
    setStatus({ kind: 'info', text: t('mcp.status.testing', { name: server.label }) })
    try {
      const result = await api.mcpTestServer({
        serverId: server.id,
        workspaceRoot: workspaceRoot ?? undefined
      })
      if (!result.ok) {
        setStatus({
          kind: 'error',
          text: t('mcp.status.testFail', { message: result.message })
        })
        await refreshRuntime()
        return
      }
      setTestTools((current) => ({ ...current, [server.id]: result.tools }))
      setStatus({
        kind: 'success',
        text: t('mcp.status.testOk', { count: result.tools.length })
      })
      await refreshRuntime()
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
      {editor ? (
        <>
          {status ? (
            <div
              className={`mcp-page-status is-${status.kind}`}
              role={status.kind === 'error' ? 'alert' : 'status'}
              data-testid="mcp-status"
              data-kind={status.kind}
            >
              {status.text}
            </div>
          ) : null}
          <UserMcpServerEditor
            key={editor.mode === 'create' ? editor.draft.createdAt : editor.originalServer.id}
            mode={editor.mode}
            initialDraft={editor.draft}
            workspaceRoot={workspaceRoot}
            busy={saving}
            onCancel={closeEditor}
            onSave={saveEditor}
          />
        </>
      ) : (
        <>
          <div className="mcp-page-toolbar" data-testid="mcp-root-control">
            <div className="mcp-page-toolbar-copy">
              <strong>{t('mcp.rootEnabled.label')}</strong>
              <span>{t('mcp.rootEnabled.detail')}</span>
            </div>
            <div className="settings-actions">
              <ToggleSwitch
                checked={rootEnabled}
                disabled={busy || !config}
                ariaLabel={t('mcp.rootEnabled.label')}
                onChange={requestRootToggle}
              />
              <button
                className="mcp-toolbar-button"
                type="button"
                disabled={busy || deletingId != null}
                aria-label={t('mcp.servers.reload')}
                title={t('mcp.servers.reload')}
                data-testid="mcp-reload"
                onClick={() => void reload()}
              >
                <RefreshCw size={15} className={loading ? 'is-spinning' : undefined} />
              </button>
              <button
                className="ghost-button strong"
                type="button"
                disabled={busy || !config || deletingId != null}
                data-testid="mcp-add-server"
                onClick={openCreateEditor}
              >
                <Plus size={15} />
                {t('mcp.servers.add')}
              </button>
            </div>
          </div>

          {status ? (
            <div
              className={`mcp-page-status is-${status.kind}`}
              role={status.kind === 'error' ? 'alert' : 'status'}
              data-testid="mcp-status"
              data-kind={status.kind}
            >
              {status.text}
            </div>
          ) : null}

          <UserMcpServerList
            loading={loading}
            busy={busy}
            rootEnabled={rootEnabled}
            servers={servers}
            runtime={runtime}
            testingId={testingId}
            deletingId={deletingId}
            testTools={testTools}
            workspaceRoot={workspaceRoot}
            onAdd={openCreateEditor}
            onEdit={openEditEditor}
            onToggle={(server, enabled) => void toggleServer(server, enabled)}
            onTest={(server) => void testServer(server)}
            onRequestDelete={setDeletingId}
            onCancelDelete={() => setDeletingId(null)}
            onConfirmDelete={(serverId) => void deleteServer(serverId)}
          />
        </>
      )}
    </SettingsPanel>
  )
}
