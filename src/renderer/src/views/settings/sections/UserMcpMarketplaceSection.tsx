/**
 * Thin MCP marketplace catalog UI (ADR-0140 / ADR-0141).
 * Secret-free list / install / uninstall / emergency disable.
 * Optional remote catalog URLs (user-configured; no default phone-home).
 * Install never grants tool approval (YOLO).
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  McpMarketplaceCatalogEntryV1,
  McpMarketplaceInstallRecordV1
} from '../../../../../shared/mcp/marketplace-types'
import { SettingsPanel } from '../SettingsPrimitives'

type StatusMessage =
  | { kind: 'info' | 'error' | 'success'; text: string }
  | null

function urlsToText(urls: readonly string[]): string {
  return urls.join('\n')
}

function textToUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function UserMcpMarketplaceSection({
  workspaceRoot
}: {
  workspaceRoot: string | null
}) {
  const { t } = useTranslation()
  const api = window.teachingSystem
  const available =
    typeof api?.mcpMarketplaceList === 'function' &&
    typeof api?.mcpMarketplaceInstall === 'function' &&
    typeof api?.mcpMarketplaceUninstall === 'function'

  const catalogUrlsApi =
    typeof api?.mcpMarketplaceSetCatalogUrls === 'function' &&
    typeof api?.mcpMarketplaceRefreshCatalog === 'function'

  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const [catalog, setCatalog] = useState<readonly McpMarketplaceCatalogEntryV1[]>([])
  const [installs, setInstalls] = useState<readonly McpMarketplaceInstallRecordV1[]>([])
  const [emergencyDisabled, setEmergencyDisabled] = useState(false)
  const [catalogUrls, setCatalogUrls] = useState<readonly string[]>([])
  const [catalogUrlsText, setCatalogUrlsText] = useState('')
  const [status, setStatus] = useState<StatusMessage>(null)

  const reload = useCallback(async () => {
    if (!available) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await api.mcpMarketplaceList()
      if (result.ok) {
        setCatalog(result.catalog)
        setInstalls(result.installs)
        setEmergencyDisabled(result.emergencyDisabled)
        const urls = result.catalogUrls ?? []
        setCatalogUrls(urls)
        setCatalogUrlsText(urlsToText(urls))
      }
    } catch {
      setStatus({ kind: 'error', text: t('settings.mcpMarketplace.status.loadFail') })
    } finally {
      setLoading(false)
    }
  }, [api, available, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const installedIds = new Set(installs.map((i) => i.entryId))

  const onSaveCatalogUrls = async () => {
    if (!catalogUrlsApi) return
    setCatalogBusy(true)
    setStatus(null)
    try {
      const result = await api.mcpMarketplaceSetCatalogUrls({
        catalogUrls: textToUrls(catalogUrlsText)
      })
      if (result.ok) {
        setCatalogUrls(result.catalogUrls)
        setCatalogUrlsText(urlsToText(result.catalogUrls))
        setStatus({
          kind: 'success',
          text: t('settings.mcpMarketplace.status.catalogUrlsSaved', {
            count: result.catalogUrls.length
          })
        })
      } else {
        setStatus({
          kind: 'error',
          text: t('settings.mcpMarketplace.status.catalogUrlsSaveFail', {
            message: result.message
          })
        })
      }
    } catch {
      setStatus({
        kind: 'error',
        text: t('settings.mcpMarketplace.status.catalogUrlsSaveFail', { message: '' })
      })
    } finally {
      setCatalogBusy(false)
    }
  }

  const onRefreshCatalog = async () => {
    if (!catalogUrlsApi) return
    setCatalogBusy(true)
    setStatus(null)
    try {
      const result = await api.mcpMarketplaceRefreshCatalog()
      if (result.ok) {
        setCatalogUrls(result.catalogUrls)
        setCatalogUrlsText(urlsToText(result.catalogUrls))
        setStatus({
          kind: 'success',
          text: t('settings.mcpMarketplace.status.refreshOk', {
            fetched: result.fetched,
            merged: result.merged,
            errors: result.errors.length
          })
        })
        await reload()
      } else {
        setStatus({
          kind: 'error',
          text: t('settings.mcpMarketplace.status.refreshFail', { message: result.message })
        })
      }
    } catch {
      setStatus({
        kind: 'error',
        text: t('settings.mcpMarketplace.status.refreshFail', { message: '' })
      })
    } finally {
      setCatalogBusy(false)
    }
  }

  const onInstall = async (entryId: string, connect: boolean) => {
    if (!available || emergencyDisabled) return
    setBusyId(entryId)
    setStatus(null)
    try {
      const result = await api.mcpMarketplaceInstall({
        entryId,
        connect,
        workspaceRoot
      })
      if (result.ok) {
        setStatus({
          kind: 'success',
          text: t('settings.mcpMarketplace.status.installOk', {
            name: entryId,
            connected: result.connected === true ? t('settings.mcpMarketplace.connected') : ''
          })
        })
        await reload()
      } else {
        setStatus({
          kind: 'error',
          text: t('settings.mcpMarketplace.status.installFail', { message: result.message })
        })
      }
    } catch {
      setStatus({ kind: 'error', text: t('settings.mcpMarketplace.status.installFail', { message: '' }) })
    } finally {
      setBusyId(null)
    }
  }

  const onUninstall = async (entryId: string) => {
    if (!available) return
    setBusyId(entryId)
    setStatus(null)
    try {
      const result = await api.mcpMarketplaceUninstall({ entryId })
      if (result.ok) {
        setStatus({ kind: 'success', text: t('settings.mcpMarketplace.status.uninstallOk') })
        await reload()
      } else {
        setStatus({
          kind: 'error',
          text: t('settings.mcpMarketplace.status.uninstallFail', { message: result.message })
        })
      }
    } catch {
      setStatus({
        kind: 'error',
        text: t('settings.mcpMarketplace.status.uninstallFail', { message: '' })
      })
    } finally {
      setBusyId(null)
    }
  }

  if (!available) {
    return (
      <SettingsPanel
        title={t('settings.mcpMarketplace.title')}
        description={t('settings.mcpMarketplace.subtitle')}
      >
        <p className="text-sm text-muted-foreground">{t('settings.mcpMarketplace.unavailable')}</p>
      </SettingsPanel>
    )
  }

  return (
    <SettingsPanel
      title={t('settings.mcpMarketplace.title')}
      description={t('settings.mcpMarketplace.subtitle')}
    >
      <p className="mb-3 text-xs text-muted-foreground">{t('settings.mcpMarketplace.safetyNote')}</p>
      {emergencyDisabled ? (
        <p className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {t('settings.mcpMarketplace.emergencyBanner')}
        </p>
      ) : null}
      {status ? (
        <p
          className={
            status.kind === 'error'
              ? 'mb-2 text-sm text-destructive'
              : status.kind === 'success'
                ? 'mb-2 text-sm text-emerald-600'
                : 'mb-2 text-sm text-muted-foreground'
          }
        >
          {status.text}
        </p>
      ) : null}

      {catalogUrlsApi ? (
        <div
          className="mb-4 space-y-2 rounded border border-border px-3 py-3"
          data-testid="mcp-marketplace-catalog-urls"
        >
          <label className="block text-sm font-medium">
            {t('settings.mcpMarketplace.catalogUrlsLabel')}
          </label>
          <p className="text-xs text-muted-foreground">
            {t('settings.mcpMarketplace.catalogUrlsHint')}
          </p>
          <textarea
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
            rows={3}
            value={catalogUrlsText}
            disabled={catalogBusy || loading}
            data-testid="mcp-marketplace-catalog-urls-input"
            placeholder={t('settings.mcpMarketplace.catalogUrlsPlaceholder')}
            onChange={(event) => setCatalogUrlsText(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              disabled={catalogBusy || loading}
              data-testid="mcp-marketplace-catalog-urls-save"
              onClick={() => void onSaveCatalogUrls()}
            >
              {t('settings.mcpMarketplace.saveCatalogUrls')}
            </button>
            <button
              type="button"
              className="rounded border px-2 py-1 text-xs"
              disabled={catalogBusy || loading || catalogUrls.length === 0}
              data-testid="mcp-marketplace-refresh-catalog"
              onClick={() => void onRefreshCatalog()}
            >
              {t('settings.mcpMarketplace.refreshCatalog')}
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('settings.mcpMarketplace.loading')}</p>
      ) : catalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('settings.mcpMarketplace.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {catalog.map((entry) => {
            const installed = installedIds.has(entry.entryId)
            const busy = busyId === entry.entryId
            return (
              <li
                key={entry.entryId}
                className="flex flex-col gap-2 rounded border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium">{entry.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.publisher.displayName} · v{entry.version} · {entry.transportHint}
                    {entry.sourceKind === 'remote'
                      ? ` · ${t('settings.mcpMarketplace.sourceRemote')}`
                      : ''}
                    {installed ? ` · ${t('settings.mcpMarketplace.installed')}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!installed ? (
                    <>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        disabled={busy || emergencyDisabled}
                        onClick={() => void onInstall(entry.entryId, false)}
                      >
                        {t('settings.mcpMarketplace.install')}
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        disabled={busy || emergencyDisabled}
                        onClick={() => void onInstall(entry.entryId, true)}
                      >
                        {t('settings.mcpMarketplace.installConnect')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="rounded border px-2 py-1 text-xs"
                      disabled={busy}
                      onClick={() => void onUninstall(entry.entryId)}
                    >
                      {t('settings.mcpMarketplace.uninstall')}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </SettingsPanel>
  )
}
