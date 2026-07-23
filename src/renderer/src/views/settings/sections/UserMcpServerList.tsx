import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  Network,
  Pencil,
  RefreshCw,
  KeyRound,
  Plus,
  Search,
  TestTube2,
  Trash2,
  UserRound
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  McpListedToolSummary,
  McpRuntimeServerState,
  McpRuntimeServerView,
  UserMcpServerPublicV1
} from '../../../../../shared/mcp/types'
import type { McpEffectiveServerPublicV1 } from '../../../../../shared/mcp/effective-view-public'
import { SettingsCard, ToggleSwitch } from '../SettingsPrimitives'
import {
  configuredMcpSecretCount,
  mcpServerCommandSummary,
  mcpServerMatchesSearch,
  serverMatchesActiveWorkspace
} from './user-mcp-settings-model'

type UserMcpServerListProps = {
  loading: boolean
  busy: boolean
  rootEnabled: boolean
  servers: readonly UserMcpServerPublicV1[]
  runtime: readonly McpRuntimeServerView[]
  /** Optional multi-source winner provenance (ADR-0137); secret-free only. */
  sourceByServerId?: ReadonlyMap<string, McpEffectiveServerPublicV1>
  testingId: string | null
  refreshingId: string | null
  authorizingId: string | null
  refreshAvailable: boolean
  authorizeAvailable: boolean
  deletingId: string | null
  testTools: Readonly<Record<string, readonly McpListedToolSummary[]>>
  workspaceRoot: string | null
  onAdd: () => void
  onEdit: (server: UserMcpServerPublicV1) => void
  onToggle: (server: UserMcpServerPublicV1, enabled: boolean) => void
  onTest: (server: UserMcpServerPublicV1) => void
  onRefresh: (server: UserMcpServerPublicV1) => void
  onAuthorize: (server: UserMcpServerPublicV1) => void
  onRevoke: (server: UserMcpServerPublicV1) => void
  onRequestDelete: (serverId: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (serverId: string) => void
}

export function UserMcpServerList({
  loading,
  busy,
  rootEnabled,
  servers,
  runtime,
  sourceByServerId,
  testingId,
  refreshingId,
  authorizingId,
  refreshAvailable,
  authorizeAvailable,
  deletingId,
  testTools,
  workspaceRoot,
  onAdd,
  onEdit,
  onToggle,
  onTest,
  onRefresh,
  onAuthorize,
  onRevoke,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete
}: UserMcpServerListProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [expandedToolsId, setExpandedToolsId] = useState<string | null>(null)

  const runtimeById = useMemo(() => {
    const map = new Map<string, McpRuntimeServerView>()
    for (const server of runtime) map.set(server.id, server)
    return map
  }, [runtime])

  const filteredServers = useMemo(
    () => servers.filter((server) => mcpServerMatchesSearch(server, runtimeById.get(server.id), query)),
    [query, runtimeById, servers]
  )

  return (
    <section className="mcp-list-section" aria-labelledby="mcp-server-list-heading">
      <div className="mcp-list-heading">
        <div>
          <h3 id="mcp-server-list-heading">{t('mcp.servers.heading')}</h3>
          <p>{t('mcp.servers.count', { count: servers.length })}</p>
        </div>
        <label className="mcp-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            disabled={loading}
            placeholder={t('mcp.servers.searchPlaceholder')}
            aria-label={t('mcp.servers.searchLabel')}
            data-testid="mcp-search"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <SettingsCard className="mcp-loading-card">
          <Loader2 size={18} className="is-spinning" />
          <span>{t('mcp.status.loading')}</span>
        </SettingsCard>
      ) : null}

      {!loading && servers.length === 0 ? (
        <SettingsCard className="mcp-empty-state" data-testid="mcp-empty">
          <div className="mcp-empty-icon" aria-hidden="true">
            <Network size={22} />
          </div>
          <strong>{t('mcp.servers.emptyTitle')}</strong>
          <p>{t('mcp.servers.empty')}</p>
          <button className="ghost-button strong" type="button" disabled={busy} onClick={onAdd}>
            <Plus size={15} />
            {t('mcp.servers.add')}
          </button>
        </SettingsCard>
      ) : null}

      {!loading && servers.length > 0 && filteredServers.length === 0 ? (
        <SettingsCard className="mcp-empty-state" data-testid="mcp-no-results">
          <Search size={20} aria-hidden="true" />
          <strong>{t('mcp.servers.noResultsTitle')}</strong>
          <p>{t('mcp.servers.noResults')}</p>
        </SettingsCard>
      ) : null}

      {!loading && filteredServers.length > 0 ? (
        <SettingsCard className="mcp-server-list" data-testid="mcp-server-list">
          {filteredServers.map((server) => {
            const runtimeState = runtimeById.get(server.id)
            const inActiveScope = serverMatchesActiveWorkspace(server, workspaceRoot)
            const effectiveState = resolveRuntimeState(
              rootEnabled,
              server.enabled && inActiveScope,
              runtimeState
            )
            const tools = testTools[server.id]
            const toolCount = runtimeState?.toolCount ?? tools?.length
            const secretCount = configuredMcpSecretCount(server)
            const isTesting = testingId === server.id
            const isRefreshing = refreshingId === server.id
            const isAuthorizing = authorizingId === server.id
            const isDeleting = deletingId === server.id
            const toolsExpanded = expandedToolsId === server.id
            const oauthConfigured = Boolean(server.oauth) && server.transport !== 'stdio'
            const authorization = runtimeState?.authorization ?? null
            const authorizationState =
              authorization?.state ?? (oauthConfigured ? 'authorization_required' : null)
            const canTest = rootEnabled && server.enabled && inActiveScope && !busy && !isTesting
            const canAuthorize =
              authorizeAvailable &&
              oauthConfigured &&
              rootEnabled &&
              server.enabled &&
              inActiveScope &&
              !busy &&
              !isAuthorizing
            const canRevoke =
              authorizeAvailable &&
              oauthConfigured &&
              authorizationState === 'authorized' &&
              !busy &&
              !isAuthorizing
            const canRefresh =
              refreshAvailable && rootEnabled && server.enabled && inActiveScope && !busy && !isRefreshing

            return (
              <div className="mcp-server-item" key={server.id} data-testid="mcp-server-row">
                <div className="mcp-server-row">
                  <div className="mcp-server-identity">
                    <div className="mcp-server-icon" aria-hidden="true">
                      <Network size={17} />
                      {effectiveState === 'connecting' || isTesting || isRefreshing ? (
                        <Loader2 className="mcp-status-spinner is-spinning" size={11} />
                      ) : (
                        <span className={`mcp-status-dot is-${effectiveState}`} />
                      )}
                    </div>
                    <div className="mcp-server-copy">
                      <div className="mcp-server-title-line">
                        <strong>{server.label}</strong>
                        <span className="mcp-badge">
                          <UserRound size={11} />
                          {t(
                            server.scope === 'workspace'
                              ? 'mcp.servers.workspaceScope'
                              : 'mcp.servers.userScope'
                          )}
                        </span>
                        <span className="mcp-badge">
                          {server.transport === 'http'
                            ? t('mcp.servers.streamableHttp')
                            : server.transport}
                        </span>
                        {sourceByServerId?.get(server.id) ? (
                          <span className="mcp-badge is-accent" data-testid="mcp-server-source-badge">
                            {t(`mcp.sources.kind.${sourceByServerId.get(server.id)!.sourceKind}`)}
                          </span>
                        ) : null}
                        {toolCount != null ? (
                          <span className="mcp-badge is-accent">
                            {t('mcp.servers.toolCount', { count: toolCount })}
                          </span>
                        ) : null}
                        {secretCount > 0 ? (
                          <span className="mcp-badge">
                            {t('mcp.servers.secretCount', { count: secretCount })}
                          </span>
                        ) : null}
                      </div>
                      <div className="mcp-command-summary" title={mcpServerCommandSummary(server)}>
                        {mcpServerCommandSummary(server)}
                      </div>
                      <div className="mcp-runtime-summary">
                        <span>{t(`mcp.runtimeState.${effectiveState}`)}</span>
                        {authorizationState ? (
                          <span data-testid="mcp-authorization-state">
                            {t(`mcp.authorizationState.${authorizationState}`)}
                          </span>
                        ) : null}
                        {server.scope === 'workspace' && server.workspaceRoot ? (
                          <span>{server.workspaceRoot}</span>
                        ) : server.cwd ? (
                          <span>{server.cwd}</span>
                        ) : null}
                      </div>
                      {runtimeState?.inventory ? (
                        <div className="mcp-runtime-summary" data-testid="mcp-inventory-summary">
                          <span>
                            {t('mcp.servers.inventorySummary', {
                              discovered: runtimeState.inventory.discoveredToolCount,
                              registered: runtimeState.inventory.registeredToolCount,
                              rejected: runtimeState.inventory.rejectedToolCount
                            })}
                          </span>
                          {runtimeState.inventory.stale ? (
                            <span>{t('mcp.servers.inventoryStale')}</span>
                          ) : null}
                        </div>
                      ) : null}
                      {runtimeState?.refresh?.retry &&
                      (runtimeState.refresh.retry.maxAttempts ?? 0) > 0 ? (
                        <div className="mcp-runtime-summary" data-testid="mcp-retry-summary">
                          <span>
                            {t('mcp.servers.retrySummary', {
                              attempt: runtimeState.refresh.retry.attemptCount,
                              max: runtimeState.refresh.retry.maxAttempts,
                              when: runtimeState.refresh.retry.retryAt
                                ? t('mcp.servers.retryAtSuffix', {
                                    time: runtimeState.refresh.retry.retryAt
                                  })
                                : ''
                            })}
                          </span>
                        </div>
                      ) : null}
                      {runtimeState?.diagnosticsLines &&
                      runtimeState.diagnosticsLines.length > 0 ? (
                        <div
                          className="mcp-runtime-summary is-muted"
                          data-testid="mcp-diagnostics-summary"
                          title={runtimeState.diagnosticsLines.join('\n')}
                        >
                          <span>
                            {t('mcp.servers.diagnosticsSummary')}:{' '}
                            {runtimeState.diagnosticsLines.slice(0, 2).join(' · ')}
                          </span>
                        </div>
                      ) : null}
                      {runtimeState?.errorCode || runtimeState?.lastErrorMessage ? (
                        <div className="mcp-runtime-error" role="status">
                          <CircleAlert size={13} />
                          <span>
                            {[runtimeState.errorCode, runtimeState.lastErrorMessage]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mcp-server-actions">
                    {tools && tools.length > 0 ? (
                      <button
                        className="mcp-icon-button"
                        type="button"
                        aria-label={t('mcp.servers.toggleTools', { name: server.label })}
                        title={t('mcp.toolsSummary.heading')}
                        onClick={() => setExpandedToolsId(toolsExpanded ? null : server.id)}
                      >
                        {toolsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    ) : null}
                    {refreshAvailable ? (
                      <button
                        className="mcp-icon-button"
                        type="button"
                        disabled={!canRefresh}
                        aria-label={t('mcp.servers.refreshAria', { name: server.label })}
                        title={
                          canRefresh ? t('mcp.servers.refresh') : t('mcp.servers.refreshDisabledHint')
                        }
                        data-testid="mcp-refresh-server"
                        onClick={() => onRefresh(server)}
                      >
                        {isRefreshing ? (
                          <Loader2 size={15} className="is-spinning" />
                        ) : (
                          <RefreshCw size={15} />
                        )}
                      </button>
                    ) : null}
                    {oauthConfigured && authorizeAvailable ? (
                      <button
                        className="mcp-icon-button"
                        type="button"
                        disabled={!canAuthorize}
                        aria-label={t(
                          authorizationState === 'authorized'
                            ? 'mcp.servers.reauthorizeAria'
                            : 'mcp.servers.authorizeAria',
                          { name: server.label }
                        )}
                        title={
                          canAuthorize
                            ? t(
                                authorizationState === 'authorized'
                                  ? 'mcp.servers.reauthorize'
                                  : 'mcp.servers.authorize'
                              )
                            : t('mcp.servers.authorizeDisabledHint')
                        }
                        data-testid="mcp-authorize-server"
                        onClick={() => onAuthorize(server)}
                      >
                        {isAuthorizing ? (
                          <Loader2 size={15} className="is-spinning" />
                        ) : (
                          <KeyRound size={15} />
                        )}
                      </button>
                    ) : null}
                    {oauthConfigured && authorizeAvailable && authorizationState === 'authorized' ? (
                      <button
                        className="mcp-icon-button is-danger"
                        type="button"
                        disabled={!canRevoke}
                        aria-label={t('mcp.servers.revokeAria', { name: server.label })}
                        title={t('mcp.servers.revoke')}
                        data-testid="mcp-revoke-authorization"
                        onClick={() => onRevoke(server)}
                      >
                        <CircleAlert size={15} />
                      </button>
                    ) : null}
                    <button
                      className="mcp-icon-button"
                      type="button"
                      disabled={!canTest}
                      aria-label={t('mcp.servers.testAria', { name: server.label })}
                      title={
                        canTest ? t('mcp.servers.test') : t('mcp.servers.testDisabledHint')
                      }
                      data-testid="mcp-test-server"
                      onClick={() => onTest(server)}
                    >
                      {isTesting ? (
                        <Loader2 size={15} className="is-spinning" />
                      ) : (
                        <TestTube2 size={15} />
                      )}
                    </button>
                    <button
                      className="mcp-icon-button"
                      type="button"
                      disabled={busy}
                      aria-label={t('mcp.servers.editAria', { name: server.label })}
                      title={t('mcp.servers.edit')}
                      data-testid="mcp-edit-server"
                      onClick={() => onEdit(server)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="mcp-icon-button is-danger"
                      type="button"
                      disabled={busy}
                      aria-label={t('mcp.servers.deleteAria', { name: server.label })}
                      title={t('mcp.servers.remove')}
                      data-testid="mcp-remove-server"
                      onClick={() => onRequestDelete(server.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                    <ToggleSwitch
                      checked={server.enabled}
                      disabled={busy}
                      ariaLabel={t('mcp.servers.toggleAria', { name: server.label })}
                      onChange={(enabled) => onToggle(server, enabled)}
                    />
                  </div>
                </div>

                {isDeleting ? (
                  <div className="mcp-delete-confirm" role="alertdialog" aria-modal="false">
                    <div>
                      <strong>{t('mcp.deleteConfirm.title', { name: server.label })}</strong>
                      <span>{t('mcp.deleteConfirm.detail')}</span>
                    </div>
                    <div className="settings-actions">
                      <button className="ghost-button" type="button" disabled={busy} onClick={onCancelDelete}>
                        {t('mcp.deleteConfirm.cancel')}
                      </button>
                      <button
                        className="ghost-button danger"
                        type="button"
                        disabled={busy}
                        data-testid="mcp-confirm-delete"
                        onClick={() => onConfirmDelete(server.id)}
                      >
                        <Trash2 size={14} />
                        {t('mcp.deleteConfirm.confirm')}
                      </button>
                    </div>
                  </div>
                ) : null}

                {toolsExpanded && tools ? (
                  <div className="mcp-tools-panel" data-testid="mcp-tools-panel">
                    <strong>{t('mcp.toolsSummary.heading')}</strong>
                    <p className="mcp-tools-hint is-muted">{t('mcp.toolsSummary.annotationsHint')}</p>
                    <div className="mcp-tools-list">
                      {tools.slice(0, 24).map((tool) => (
                        <div className="mcp-tool-row" key={tool.registeredName || tool.name}>
                          <code>{tool.registeredName || tool.name}</code>
                          <span title={t('mcp.toolsSummary.effect')}>{tool.effectClass}</span>
                          <span className={tool.registered ? 'is-success' : 'is-muted'}>
                            {tool.registered
                              ? t('mcp.toolsSummary.registered')
                              : t('mcp.toolsSummary.skipped')}
                          </span>
                          {tool.annotations ? (
                            <span
                              className="mcp-tool-annotations"
                              data-testid={`mcp-tool-annotations-${tool.name}`}
                              title={t('mcp.toolsSummary.annotationsTitle')}
                            >
                              {formatRemoteAnnotationHints(tool.annotations)}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

              </div>
            )
          })}
        </SettingsCard>
      ) : null}
    </section>
  )
}

function resolveRuntimeState(
  rootEnabled: boolean,
  serverEnabled: boolean,
  runtime: McpRuntimeServerView | undefined
): McpRuntimeServerState {
  if (!rootEnabled || !serverEnabled) return 'disabled'
  return runtime?.state ?? 'idle'
}

/**
 * Compact remote protocol hints for display only.
 * Never confuses these with StudiumX effectClass (ADR-0132 §2.7).
 */
function formatRemoteAnnotationHints(
  annotations: NonNullable<McpListedToolSummary['annotations']>
): string {
  const parts: string[] = []
  if (annotations.readOnlyHint === true) parts.push('readOnly')
  if (annotations.destructiveHint === true) parts.push('destructive')
  if (annotations.idempotentHint === true) parts.push('idempotent')
  if (annotations.openWorldHint === true) parts.push('openWorld')
  if (typeof annotations.title === 'string' && annotations.title.trim()) {
    parts.push(annotations.title.trim().slice(0, 48))
  }
  return parts.length > 0 ? parts.join(' · ') : '—'
}
