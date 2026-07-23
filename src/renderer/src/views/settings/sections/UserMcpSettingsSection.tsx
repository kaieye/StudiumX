/**
 * User MCP settings: list + status, add/edit, optional import, OAuth authorize.
 * Public config DTOs stay secret-free (refs / placeholders only).
 * No marketplace UI (product surface stays list/editor only).
 */

import { Plus, RefreshCw, Search, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  parseMcpImportText,
  selectMcpImportDrafts,
  type McpImportPreview,
  type McpImportRiskFlag
} from '../../../../../shared/mcp/import-export'
import type {
  McpListedToolSummary,
  McpRuntimeServerView,
  UserMcpConfigPublicV1,
  UserMcpServerPublicV1
} from '../../../../../shared/mcp/types'
import type { McpEffectiveViewPublicV1 } from '../../../../../shared/mcp/effective-view-public'
import { SettingsPanel } from '../SettingsPrimitives'
import { UserMcpServerEditor } from './UserMcpServerEditor'
import { UserMcpServerList } from './UserMcpServerList'
import {
  createDraftMcpServer,
  draftMcpServersToConfigUpdate,
  importServerDraftToDraftMcpServer,
  mergeImportDraftsIntoConfig,
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
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [authorizingId, setAuthorizingId] = useState<string | null>(null)
  const [config, setConfig] = useState<UserMcpConfigPublicV1 | null>(null)
  const [runtime, setRuntime] = useState<readonly McpRuntimeServerView[]>([])
  const [effectiveView, setEffectiveView] = useState<McpEffectiveViewPublicV1 | null>(null)
  const [testTools, setTestTools] = useState<Record<string, readonly McpListedToolSummary[]>>({})
  const [status, setStatus] = useState<StatusMessage>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<McpImportPreview | null>(null)
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set())
  const [importError, setImportError] = useState<string | null>(null)
  const [listQuery, setListQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const migratedRootOnRef = useRef(false)

  const api = window.teachingSystem
  const available =
    typeof api?.mcpGetConfig === 'function' &&
    typeof api?.mcpUpdateConfig === 'function' &&
    typeof api?.mcpTestServer === 'function' &&
    typeof api?.mcpListRuntime === 'function'

  const refreshAvailable = typeof api?.mcpRefreshServer === 'function'
  const authorizeAvailable =
    typeof api?.mcpAuthorizeServer === 'function' &&
    typeof api?.mcpRevokeAuthorization === 'function'
  const effectiveViewAvailable = typeof api?.mcpGetEffectiveView === 'function'
  // Zcode-like: no product "enable MCP" gate — treat MCP as available once configured.
  const rootEnabled = true
  const servers = config?.servers ?? []
  const busy =
    loading || saving || testingId != null || refreshingId != null || authorizingId != null
  const existingIds = useMemo(() => new Set(servers.map((server) => server.id)), [servers])

  const sourceByServerId = useMemo(() => {
    const map = new Map<string, McpEffectiveViewPublicV1['effectiveServers'][number]>()
    for (const entry of effectiveView?.effectiveServers ?? []) {
      map.set(entry.id, entry)
    }
    return map
  }, [effectiveView])

  const refreshRuntime = useCallback(async (): Promise<void> => {
    if (!available) return
    try {
      const result = await api.mcpListRuntime()
      setRuntime(result.ok ? result.servers : [])
    } catch {
      // Runtime polling is best-effort.
    }
  }, [api, available])

  const reload = useCallback(async (): Promise<void> => {
    setEditor(null)
    setDeletingId(null)
    if (!available) {
      setLoading(false)
      setConfig(null)
      setEffectiveView(null)
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
      if (effectiveViewAvailable) {
        try {
          const ev = await api.mcpGetEffectiveView({ workspaceRoot })
          setEffectiveView(ev.ok ? ev.view : null)
        } catch {
          setEffectiveView(null)
        }
      } else {
        setEffectiveView(null)
      }
      setStatus(null)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : t('mcp.status.unavailable')
      })
    } finally {
      setLoading(false)
    }
  }, [api, available, effectiveViewAvailable, t, workspaceRoot])

  useEffect(() => {
    void reload()
  }, [reload])

  const persistConfig = useCallback(
    async (nextServers: readonly DraftMcpServer[]): Promise<UserMcpConfigPublicV1 | null> => {
      if (!available || !config) {
        setStatus({ kind: 'error', text: t('mcp.status.unavailable') })
        return null
      }
      setSaving(true)
      setStatus(null)
      try {
        // Root MCP stays on (no enable switch); auto-connect stays on for Zcode-like discovery.
        const update = draftMcpServersToConfigUpdate(true, nextServers, {
          autoConnect: true,
          honorRemoteReadOnlyHint: config.honorRemoteReadOnlyHint === true
        })
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
        if (effectiveViewAvailable) {
          try {
            const ev = await api.mcpGetEffectiveView({ workspaceRoot })
            setEffectiveView(ev.ok ? ev.view : null)
          } catch {
            setEffectiveView(null)
          }
        }
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
    [api, available, config, effectiveViewAvailable, refreshRuntime, reload, t, workspaceRoot]
  )

  /** Migrate legacy root-off configs once when the page loads (no enable switch). */
  useEffect(() => {
    if (!available || !config || config.enabled === true || saving || loading) return
    if (migratedRootOnRef.current) return
    migratedRootOnRef.current = true
    void (async () => {
      const saved = await persistConfig(publicMcpConfigToDrafts(config))
      if (!saved) return
      if (typeof api?.mcpAutoConnectNow === 'function') {
        try {
          await api.mcpAutoConnectNow({ workspaceRoot })
          await refreshRuntime()
        } catch {
          // best-effort
        }
      }
    })()
  }, [api, available, config, loading, persistConfig, refreshRuntime, saving, workspaceRoot])

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
    const saved = await persistConfig(nextServers)
    if (!saved) return false
    setEditor(null)
    if (typeof api?.mcpAutoConnectNow === 'function') {
      try {
        await api.mcpAutoConnectNow({ workspaceRoot })
        await refreshRuntime()
      } catch {
        // best-effort
      }
    }
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
    const saved = await persistConfig(nextServers)
    if (saved && enabled && typeof api?.mcpAutoConnectNow === 'function') {
      try {
        await api.mcpAutoConnectNow({ workspaceRoot })
        await refreshRuntime()
      } catch {
        // best-effort
      }
    }
  }

  const deleteServer = async (serverId: string): Promise<void> => {
    if (!config) return
    const nextServers = publicMcpConfigToDrafts(config).filter((draft) => draft.id !== serverId)
    const saved = await persistConfig(nextServers)
    if (!saved) return
    setDeletingId(null)
    setTestTools((current) => {
      const next = { ...current }
      delete next[serverId]
      return next
    })
  }

  const refreshServer = async (server: UserMcpServerPublicV1): Promise<void> => {
    if (!available || !refreshAvailable) return
    setRefreshingId(server.id)
    setStatus({ kind: 'info', text: t('mcp.status.refreshing', { name: server.label }) })
    try {
      const result = await api.mcpRefreshServer({
        serverId: server.id,
        workspaceRoot: workspaceRoot ?? undefined
      })
      if (!result.ok) {
        setStatus({ kind: 'error', text: t('mcp.status.refreshFail') })
        await refreshRuntime()
        return
      }
      setStatus({ kind: 'success', text: t('mcp.status.refreshOk') })
      await refreshRuntime()
    } catch {
      setStatus({ kind: 'error', text: t('mcp.status.refreshFail') })
    } finally {
      setRefreshingId(null)
    }
  }

  const authorizeServer = async (server: UserMcpServerPublicV1): Promise<void> => {
    if (!available || !authorizeAvailable) return
    setAuthorizingId(server.id)
    setStatus({ kind: 'info', text: t('mcp.status.authorizing', { name: server.label }) })
    try {
      const result = await api.mcpAuthorizeServer({
        serverId: server.id,
        workspaceRoot: workspaceRoot ?? undefined
      })
      if (!result.ok) {
        setStatus({
          kind: 'error',
          text: t('mcp.status.authorizeFail', {
            message: result.message || t('mcp.status.invalid')
          })
        })
        return
      }
      setStatus({
        kind: 'success',
        text:
          'opened' in result && (result as { opened?: boolean }).opened === true
            ? t('mcp.status.authorizeOpened', { name: server.label })
            : t('mcp.status.authorizeOk', { name: server.label })
      })
      await refreshRuntime()
    } catch (error) {
      setStatus({
        kind: 'error',
        text: t('mcp.status.authorizeFail', {
          message: error instanceof Error ? error.message : 'unknown'
        })
      })
    } finally {
      setAuthorizingId(null)
    }
  }

  const revokeAuthorization = async (server: UserMcpServerPublicV1): Promise<void> => {
    if (!available || !authorizeAvailable) return
    setAuthorizingId(server.id)
    setStatus({ kind: 'info', text: t('mcp.status.revoking', { name: server.label }) })
    try {
      const result = await api.mcpRevokeAuthorization({
        serverId: server.id
      })
      if (!result.ok) {
        setStatus({
          kind: 'error',
          text: t('mcp.status.revokeFail', {
            message: result.message || t('mcp.status.invalid')
          })
        })
        return
      }
      setStatus({ kind: 'success', text: t('mcp.status.revokeOk', { name: server.label }) })
      await refreshRuntime()
    } catch (error) {
      setStatus({
        kind: 'error',
        text: t('mcp.status.revokeFail', {
          message: error instanceof Error ? error.message : 'unknown'
        })
      })
    } finally {
      setAuthorizingId(null)
    }
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

  const openImport = (): void => {
    setDeletingId(null)
    setEditor(null)
    setImportOpen(true)
    setImportText('')
    setImportPreview(null)
    setImportSelected(new Set())
    setImportError(null)
    setStatus(null)
  }

  const closeImport = (): void => {
    setImportOpen(false)
    setImportText('')
    setImportPreview(null)
    setImportSelected(new Set())
    setImportError(null)
  }

  const parseImport = (): void => {
    if (!config) return
    const result = parseMcpImportText(importText, { existingIds })
    if (!result.ok) {
      setImportPreview(null)
      setImportSelected(new Set())
      setImportError(t('mcp.import.parseError', { reason: result.reason }))
      return
    }
    setImportError(null)
    setImportPreview(result)
    setImportSelected(
      new Set(result.drafts.filter((draft) => draft.selectedByDefault).map((draft) => draft.draftKey))
    )
  }

  const onImportFile = async (file: File | null): Promise<void> => {
    if (!file) return
    try {
      const text = await file.text()
      setImportText(text)
      setImportError(null)
      setImportPreview(null)
    } catch {
      setImportError(t('mcp.import.parseError', { reason: 'file read failed' }))
    }
  }

  const confirmImport = async (): Promise<void> => {
    if (!config || !importPreview) return
    if (importSelected.size === 0) {
      setImportError(t('mcp.import.emptySelection'))
      return
    }
    const { selected } = selectMcpImportDrafts(importPreview, importSelected)
    const importedDrafts = selected.map(importServerDraftToDraftMcpServer)
    const nextServers = mergeImportDraftsIntoConfig(
      publicMcpConfigToDrafts(config),
      importedDrafts
    )
    setStatus({ kind: 'info', text: t('mcp.status.importing') })
    const saved = await persistConfig(nextServers)
    if (!saved) return
    closeImport()
    setStatus({
      kind: 'success',
      text: t('mcp.import.success', { count: selected.length })
    })
    if (typeof api?.mcpAutoConnectNow === 'function') {
      try {
        await api.mcpAutoConnectNow({ workspaceRoot })
        await refreshRuntime()
      } catch {
        // best-effort
      }
    }
  }

  const riskLabel = (risk: McpImportRiskFlag): string => t(`mcp.import.risk.${risk}`)

  return (
    <SettingsPanel title={t('mcp.title')} subtitle={t('mcp.subtitle')}>
      {importOpen ? (
        <div className="mcp-import-panel" data-testid="mcp-import-panel">
          <div className="mcp-page-toolbar">
            <div className="mcp-page-toolbar-copy">
              <strong>{t('mcp.import.title')}</strong>
              <span>{t('mcp.import.detail')}</span>
            </div>
            <div className="settings-actions">
              <button
                className="ghost-button"
                type="button"
                disabled={saving}
                data-testid="mcp-import-cancel"
                onClick={closeImport}
              >
                {t('mcp.import.cancel')}
              </button>
            </div>
          </div>

          <label className="settings-field">
            <span>{t('mcp.import.pasteLabel')}</span>
            <textarea
              data-testid="mcp-import-text"
              value={importText}
              rows={10}
              placeholder={t('mcp.import.pastePlaceholder')}
              disabled={saving}
              onChange={(event) => {
                setImportText(event.target.value)
                setImportPreview(null)
                setImportError(null)
              }}
            />
          </label>

          <div className="settings-actions" style={{ marginBottom: '0.75rem' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              data-testid="mcp-import-file"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                void onImportFile(file)
                event.target.value = ''
              }}
            />
            <button
              className="ghost-button"
              type="button"
              disabled={saving}
              data-testid="mcp-import-choose-file"
              onClick={() => fileInputRef.current?.click()}
            >
              {t('mcp.import.chooseFile')}
            </button>
            <button
              className="ghost-button strong"
              type="button"
              disabled={saving || !importText.trim()}
              data-testid="mcp-import-parse"
              onClick={parseImport}
            >
              {t('mcp.import.parse')}
            </button>
          </div>

          {importError ? (
            <div className="mcp-page-status is-error" role="alert" data-testid="mcp-import-error">
              {importError}
            </div>
          ) : null}

          {importPreview ? (
            <div className="mcp-import-preview" data-testid="mcp-import-preview">
              <p data-testid="mcp-import-summary">
                {t('mcp.import.parsed', {
                  count: importPreview.drafts.length,
                  shape: t(`mcp.import.sourceShape.${importPreview.sourceShape}`)
                })}{' '}
                {importPreview.report.skippedCount > 0
                  ? t('mcp.import.skipped', { count: importPreview.report.skippedCount })
                  : null}{' '}
                {importPreview.report.conflictCount > 0
                  ? t('mcp.import.conflicts', { count: importPreview.report.conflictCount })
                  : null}
              </p>
              <div className="settings-actions" style={{ marginBottom: '0.5rem' }}>
                <button
                  className="ghost-button"
                  type="button"
                  data-testid="mcp-import-select-all"
                  onClick={() =>
                    setImportSelected(new Set(importPreview.drafts.map((draft) => draft.draftKey)))
                  }
                >
                  {t('mcp.import.selectAll')}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  data-testid="mcp-import-select-none"
                  onClick={() => setImportSelected(new Set())}
                >
                  {t('mcp.import.selectNone')}
                </button>
              </div>
              <ul className="mcp-import-list" data-testid="mcp-import-list">
                {importPreview.drafts.map((draft) => (
                  <li key={draft.draftKey} data-testid={`mcp-import-item-${draft.proposedId}`}>
                    <label className="mcp-import-item">
                      <input
                        type="checkbox"
                        checked={importSelected.has(draft.draftKey)}
                        onChange={(event) => {
                          setImportSelected((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(draft.draftKey)
                            else next.delete(draft.draftKey)
                            return next
                          })
                        }}
                      />
                      <span>
                        <strong>{draft.label}</strong> ({draft.proposedId}) · {draft.transport}
                        {draft.note ? (
                          <em> — {t('mcp.import.noteConflict', { id: draft.proposedId })}</em>
                        ) : null}
                      </span>
                      <span className="mcp-import-risks">
                        {draft.risks.map((risk) => (
                          <span
                            key={risk}
                            className={`mcp-risk-badge risk-${risk}`}
                            data-testid={`mcp-risk-${draft.proposedId}-${risk}`}
                          >
                            {riskLabel(risk)}
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button
                className="ghost-button strong"
                type="button"
                disabled={saving || importSelected.size === 0}
                data-testid="mcp-import-confirm"
                onClick={() => void confirmImport()}
              >
                {saving ? t('mcp.import.confirming') : t('mcp.import.confirm')}
              </button>
            </div>
          ) : null}
        </div>
      ) : editor ? (
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
          {/* Search + icon actions on one row (Zcode-like toolbar) */}
          <div className="mcp-page-actions" data-testid="mcp-page-actions">
            <div className="mcp-search mcp-search-bar">
              <Search size={15} aria-hidden="true" />
              <input
                id="mcp-server-search"
                type="search"
                value={listQuery}
                disabled={loading}
                placeholder={t('mcp.servers.searchPlaceholder')}
                aria-label={t('mcp.servers.searchLabel')}
                data-testid="mcp-search"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setListQuery(event.target.value)}
              />
            </div>
            <div className="mcp-page-action-buttons">
              <button
                className="mcp-toolbar-button"
                type="button"
                disabled={busy || !config || deletingId != null}
                data-testid="mcp-import-open"
                aria-label={t('mcp.servers.importAria')}
                title={t('mcp.servers.import')}
                onClick={openImport}
              >
                <Upload size={15} />
              </button>
              <button
                className="mcp-toolbar-button is-accent"
                type="button"
                disabled={busy || !config || deletingId != null}
                data-testid="mcp-add-server"
                aria-label={t('mcp.servers.add')}
                title={t('mcp.servers.add')}
                onClick={openCreateEditor}
              >
                <Plus size={15} />
              </button>
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
            sourceByServerId={sourceByServerId}
            testingId={testingId}
            refreshingId={refreshingId}
            authorizingId={authorizingId}
            refreshAvailable={refreshAvailable}
            authorizeAvailable={authorizeAvailable}
            deletingId={deletingId}
            testTools={testTools}
            workspaceRoot={workspaceRoot}
            hideSearch
            searchQuery={listQuery}
            onSearchQueryChange={setListQuery}
            onEdit={openEditEditor}
            onToggle={(server, enabled) => void toggleServer(server, enabled)}
            onTest={(server) => void testServer(server)}
            onRefresh={(server) => void refreshServer(server)}
            onAuthorize={(server) => void authorizeServer(server)}
            onRevoke={(server) => void revokeAuthorization(server)}
            onRequestDelete={setDeletingId}
            onCancelDelete={() => setDeletingId(null)}
            onConfirmDelete={(serverId) => void deleteServer(serverId)}
          />
        </>
      )}
    </SettingsPanel>
  )
}
