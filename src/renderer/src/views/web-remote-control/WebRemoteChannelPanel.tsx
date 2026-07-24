/**
 * Message-channel config UI for web remote control.
 * Layout and sections follow the third-party bot manager pattern:
 * left list · provider pick · detail with token/bind/workspaces/reply/delete.
 * Runtime is not wired — UI is complete and honest about planned connection.
 */

import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Link2,
  Loader2,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  Unplug
} from 'lucide-react'
import QRCode from 'qrcode'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { RemoteChannelBrandIcon } from './RemoteChannelBrandIcon'

export type RemoteChannelProviderId = 'weixin' | 'feishu' | 'lark' | 'telegram'

export type RemoteChannelProvider = {
  id: RemoteChannelProviderId
  brandClass: string
  /** Primary setup style for the detail form. */
  setup: 'scan' | 'token'
}

export const REMOTE_CHANNEL_PROVIDERS: readonly RemoteChannelProvider[] = [
  { id: 'weixin', brandClass: 'wrc-brand-weixin', setup: 'scan' },
  { id: 'feishu', brandClass: 'wrc-brand-feishu', setup: 'scan' },
  { id: 'lark', brandClass: 'wrc-brand-lark', setup: 'scan' },
  { id: 'telegram', brandClass: 'wrc-brand-telegram', setup: 'token' }
] as const

type ReplyMode = 'assistant_changes' | 'assistant_toolcalls_changes' | 'summary_changes'
type WorkspaceMode = 'all' | 'selected'

type StoredChannel = {
  id: string
  provider: RemoteChannelProviderId
  name: string
  enabled: boolean
  replyMode: ReplyMode
  workspaceMode: WorkspaceMode
  /** Local-only note / placeholder credential mask — never a real secret store. */
  credentialHint: string
  note: string
  updatedAt: number
}

const STORAGE_KEY = 'studiumx.web-remote-control.channels.v1'
const REPLY_MODES: readonly ReplyMode[] = [
  'assistant_changes',
  'assistant_toolcalls_changes',
  'summary_changes'
]

function loadStoredChannels(): StoredChannel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => normalizeChannel(item))
      .filter((item): item is StoredChannel => item != null)
  } catch {
    return []
  }
}

function normalizeChannel(value: unknown): StoredChannel | null {
  if (value == null || typeof value !== 'object') return null
  const item = value as Partial<StoredChannel>
  if (typeof item.id !== 'string' || typeof item.provider !== 'string') return null
  if (!REMOTE_CHANNEL_PROVIDERS.some((p) => p.id === item.provider)) return null
  return {
    id: item.id,
    provider: item.provider as RemoteChannelProviderId,
    name: typeof item.name === 'string' ? item.name : '',
    enabled: item.enabled !== false,
    replyMode: REPLY_MODES.includes(item.replyMode as ReplyMode)
      ? (item.replyMode as ReplyMode)
      : 'assistant_changes',
    workspaceMode: item.workspaceMode === 'selected' ? 'selected' : 'all',
    credentialHint: typeof item.credentialHint === 'string' ? item.credentialHint : '',
    note: typeof item.note === 'string' ? item.note : '',
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now()
  }
}

function saveStoredChannels(channels: readonly StoredChannel[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(channels))
  } catch {
    /* ignore quota */
  }
}

function providerMeta(id: RemoteChannelProviderId): RemoteChannelProvider {
  return REMOTE_CHANNEL_PROVIDERS.find((item) => item.id === id) ?? REMOTE_CHANNEL_PROVIDERS[0]!
}

function createChannelId(): string {
  return `channel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function mockBindCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

export type WebRemoteChannelPanelProps = {
  workspacePath?: string
  workspaceId?: string
  /** When true, show manage/config subview inside the remote-control dialog. */
  manageOpen: boolean
  onManageOpenChange: (open: boolean) => void
  entryProvider: RemoteChannelProviderId | null
  onEntryProviderChange: (provider: RemoteChannelProviderId | null) => void
}

export function WebRemoteChannelPanel({
  workspacePath,
  workspaceId,
  manageOpen,
  onManageOpenChange,
  entryProvider,
  onEntryProviderChange
}: WebRemoteChannelPanelProps) {
  const { t } = useTranslation()
  const [channels, setChannels] = useState<StoredChannel[]>(() => loadStoredChannels())

  const countByProvider = useMemo(() => {
    const map = new Map<RemoteChannelProviderId, number>()
    for (const channel of channels) {
      map.set(channel.provider, (map.get(channel.provider) ?? 0) + 1)
    }
    return map
  }, [channels])

  const openProvider = (provider: RemoteChannelProviderId): void => {
    onEntryProviderChange(provider)
    onManageOpenChange(true)
  }

  const openManage = (): void => {
    onEntryProviderChange(null)
    onManageOpenChange(true)
  }

  const persist = (next: StoredChannel[]): void => {
    setChannels(next)
    saveStoredChannels(next)
  }

  if (manageOpen) {
    return (
      <RemoteChannelsManager
        entryProvider={entryProvider}
        workspacePath={workspacePath}
        workspaceId={workspaceId}
        channels={channels}
        onChange={persist}
        onBack={() => {
          onManageOpenChange(false)
          onEntryProviderChange(null)
        }}
      />
    )
  }

  return (
    <section className="wrc-card wrc-side-card" data-testid="web-remote-control-side-card">
        <div className="wrc-card-heading">
          <Bot className="wrc-card-heading-icon" size={16} strokeWidth={1.9} />
          <div>
            <div className="wrc-card-heading-title">{t('webRemoteControl.botChannel.title')}</div>
            <p className="wrc-card-heading-desc">{t('webRemoteControl.botChannel.description')}</p>
          </div>
        </div>

        <div className="wrc-channel-grid">
          {REMOTE_CHANNEL_PROVIDERS.map((provider) => {
            const count = countByProvider.get(provider.id) ?? 0
            const badge =
              count > 0 ? t('webRemoteControl.botChannel.configuredCount', { count }) : null
            return (
              <button
                key={provider.id}
                type="button"
                className="wrc-channel-card"
                onClick={() => openProvider(provider.id)}
                data-testid={`web-remote-channel-${provider.id}`}
              >
                <span className={`wrc-channel-icon ${provider.brandClass}`} aria-hidden="true">
                  <RemoteChannelBrandIcon provider={provider.id} size={24} />
                </span>
                <span className="wrc-channel-copy">
                  <span className="wrc-channel-title-row">
                    <span className="wrc-channel-title">
                      {t(`webRemoteControl.botChannel.${provider.id}.title`)}
                    </span>
                    {badge ? <span className="wrc-channel-badge">{badge}</span> : null}
                  </span>
                  <span className="wrc-channel-desc">
                    {t(`webRemoteControl.botChannel.${provider.id}.description`)}
                  </span>
                  <span className="wrc-channel-action">
                    {t('webRemoteControl.botChannel.configure')}
                    <ChevronRight size={14} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="wrc-channel-manage">
          <button
            type="button"
            className="ghost-button wrc-manage-bots-btn"
            data-testid="web-remote-control-open-bots"
            onClick={openManage}
          >
            <Bot size={14} />
            {t('webRemoteControl.botChannel.manageBots')}
          </button>
        </div>
    </section>
  )
}

type RemoteChannelsManagerProps = {
  entryProvider: RemoteChannelProviderId | null
  workspacePath?: string
  workspaceId?: string
  channels: StoredChannel[]
  onChange: (channels: StoredChannel[]) => void
}

type BindSession = {
  botId: string
  code: string
  createdAt: number
  expiresAt: number
  ttlMs: number
}

type ScanSession = {
  botId: string
  provider: RemoteChannelProviderId
  userCode: string
  qrDataUrl: string | null
  status: 'pending' | 'scanned' | 'success' | 'failed'
  createdAt: number
}

function RemoteChannelsManager({
  entryProvider,
  workspacePath,
  workspaceId,
  channels,
  onChange,
  onBack
}: RemoteChannelsManagerProps & { onBack: () => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  const open = true
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [tokenDraft, setTokenDraft] = useState('')
  const [secretSaving, setSecretSaving] = useState(false)
  const [bindSession, setBindSession] = useState<BindSession | null>(null)
  const [scanSession, setScanSession] = useState<ScanSession | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [notice, setNotice] = useState<string | null>(null)
  const [botFatherQr, setBotFatherQr] = useState<string | null>(null)

  const selected = channels.find((item) => item.id === selectedId) ?? null
  const selectedMeta = selected ? providerMeta(selected.provider) : null

  useEffect(() => {
    if (!open) return
    setNotice(null)
    setBindSession(null)
    setScanSession(null)
    setTokenDraft('')
    setRenaming(false)
    if (entryProvider) {
      setCreating(false)
      setSelectedId(() => {
        const existing = channels.find((item) => item.provider === entryProvider)
        if (existing) return existing.id
        const created: StoredChannel = {
          id: createChannelId(),
          provider: entryProvider,
          name: t(`webRemoteControl.botChannel.${entryProvider}.title`),
          enabled: true,
          replyMode: 'assistant_changes',
          workspaceMode: 'all',
          credentialHint: '',
          note: '',
          updatedAt: Date.now()
        }
        onChange([...channels, created])
        return created.id
      })
      return
    }
    setCreating(false)
    setSelectedId((prev) => prev ?? channels[0]?.id ?? null)
    // Only re-seed when the dialog opens or entry provider changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryProvider])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onBack()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onBack])

  useEffect(() => {
    if (!open || !bindSession) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [open, bindSession])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Decorative BotFather link QR (public @BotFather deep link) — not a product phone-home.
    void QRCode.toDataURL('https://t.me/BotFather', {
      margin: 1,
      width: 220,
      color: { dark: '#182033', light: '#ffffff' }
    })
      .then((url) => {
        if (!cancelled) setBotFatherQr(url)
      })
      .catch(() => {
        if (!cancelled) setBotFatherQr(null)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!selected) return
    setNameDraft(selected.name)
    setRenaming(false)
  }, [selected?.id, selected?.name])

  function createChannel(provider: RemoteChannelProviderId): StoredChannel {
    return {
      id: createChannelId(),
      provider,
      name: t(`webRemoteControl.botChannel.${provider}.title`),
      enabled: true,
      replyMode: 'assistant_changes',
      workspaceMode: 'all',
      credentialHint: '',
      note: '',
      updatedAt: Date.now()
    }
  }

  const patchSelected = (patch: Partial<StoredChannel>): void => {
    if (!selected) return
    const next = channels.map((item) =>
      item.id === selected.id ? { ...item, ...patch, updatedAt: Date.now() } : item
    )
    onChange(next)
  }

  const startCreate = (): void => {
    setCreating(true)
    setSelectedId(null)
    setNotice(null)
    setBindSession(null)
    setScanSession(null)
  }

  const chooseProvider = (provider: RemoteChannelProviderId): void => {
    const created = createChannel(provider)
    onChange([...channels, created])
    setCreating(false)
    setSelectedId(created.id)
    setNotice(t('webRemoteControl.botChannel.createdHint'))
  }

  const removeSelected = (): void => {
    if (!selected) return
    if (!window.confirm(t('webRemoteControl.botChannel.confirmDelete'))) return
    const next = channels.filter((item) => item.id !== selected.id)
    onChange(next)
    setSelectedId(next[0]?.id ?? null)
    setBindSession(null)
    setScanSession(null)
  }

  const saveToken = async (): Promise<void> => {
    if (!selected || !tokenDraft.trim()) return
    setSecretSaving(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 350))
      // Mask only — real secret storage/runtime is not implemented.
      const masked =
        tokenDraft.trim().length <= 8
          ? '••••••••'
          : `${tokenDraft.trim().slice(0, 4)}••••${tokenDraft.trim().slice(-4)}`
      patchSelected({ credentialHint: masked })
      setTokenDraft('')
      setNotice(t('webRemoteControl.botChannel.secretSavedLocal'))
    } finally {
      setSecretSaving(false)
    }
  }

  const clearCredential = (): void => {
    if (!selected) return
    patchSelected({ credentialHint: '' })
    setBindSession(null)
    setScanSession(null)
    setNotice(t('webRemoteControl.botChannel.secretRemoved'))
  }

  const startScanRegistration = async (): Promise<void> => {
    if (!selected) return
    const userCode = mockBindCode()
    const payload = `studiumx-channel-setup:${selected.provider}:${userCode}`
    let qrDataUrl: string | null = null
    try {
      qrDataUrl = await QRCode.toDataURL(payload, {
        margin: 1,
        width: 220,
        color: { dark: '#182033', light: '#ffffff' }
      })
    } catch {
      qrDataUrl = null
    }
    setScanSession({
      botId: selected.id,
      provider: selected.provider,
      userCode,
      qrDataUrl,
      status: 'pending',
      createdAt: Date.now()
    })
    setNotice(t('webRemoteControl.botChannel.scanStarted'))
  }

  const startBindCode = (): void => {
    if (!selected) return
    const ttlMs = 5 * 60 * 1000
    const createdAt = Date.now()
    setBindSession({
      botId: selected.id,
      code: mockBindCode(),
      createdAt,
      expiresAt: createdAt + ttlMs,
      ttlMs
    })
  }

  const copyBindCommand = async (): Promise<void> => {
    if (!bindSession) return
    try {
      await navigator.clipboard.writeText(`/bind ${bindSession.code}`)
      setNotice(t('webRemoteControl.botChannel.bindCommandCopied'))
    } catch {
      setNotice(t('webRemoteControl.botChannel.copyFailed'))
    }
  }

  const bindExpired = bindSession ? now >= bindSession.expiresAt : false
  const bindRemainingMs = bindSession ? Math.max(0, bindSession.expiresAt - now) : 0
  const bindProgress = bindSession
    ? Math.max(0, Math.min(100, (bindRemainingMs / bindSession.ttlMs) * 100))
    : 0

  const workspaceLabel =
    workspacePath?.split(/[/\\]/).filter(Boolean).pop() ||
    workspacePath ||
    t('webRemoteControl.botChannel.currentWorkspaceFallback')

  return (
    <div className="wrc-bots-subview" data-testid="web-remote-channels-dialog">
      <header className="wrc-bots-header wrc-bots-header--subview">
        <button
          type="button"
          className="wrc-back-icon-btn"
          onClick={onBack}
          aria-label={t('webRemoteControl.botChannel.back')}
          title={t('webRemoteControl.botChannel.back')}
          data-testid="web-remote-channels-back"
        >
          <ArrowLeft size={18} strokeWidth={1.9} />
        </button>
        <div className="wrc-bots-header-title">
          <div>
            <h2 id={titleId}>{t('webRemoteControl.botChannel.manageTitle')}</h2>
            <p>{t('webRemoteControl.botChannel.manageDescription')}</p>
          </div>
        </div>
      </header>

<div className="wrc-bots-body">
          <aside className="wrc-bots-aside">
            <button type="button" className="ghost-button wrc-bots-add" onClick={startCreate}>
              <Plus size={15} />
              {t('webRemoteControl.botChannel.addBot')}
            </button>
            <div className="wrc-bots-list">
              {channels.length === 0 ? (
                <div className="wrc-bots-empty">
                  {creating
                    ? t('webRemoteControl.botChannel.selectProviderHint')
                    : t('webRemoteControl.botChannel.empty')}
                </div>
              ) : (
                channels.map((channel) => {
                  const meta = providerMeta(channel.provider)
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      className={`wrc-bots-list-item${channel.id === selectedId && !creating ? ' is-active' : ''}`}
                      onClick={() => {
                        setCreating(false)
                        setSelectedId(channel.id)
                        setNotice(null)
                        setBindSession(null)
                        setScanSession(null)
                      }}
                    >
                      <span className={`wrc-channel-icon ${meta.brandClass}`}>
                        <RemoteChannelBrandIcon provider={channel.provider} size={20} />
                      </span>
                      <span className="wrc-bots-list-copy">
                        <strong>
                          {channel.name || t(`webRemoteControl.botChannel.${channel.provider}.title`)}
                        </strong>
                        <small>{t(`webRemoteControl.botChannel.${channel.provider}.title`)}</small>
                      </span>
                      <span className={`wrc-bots-dot${channel.enabled ? ' is-on' : ''}`} />
                    </button>
                  )
                })
              )}
            </div>
          </aside>

          <div className="wrc-bots-main">
            {creating ? (
              <div className="wrc-bots-create">
                <h3>{t('webRemoteControl.botChannel.newTitle')}</h3>
                <p>{t('webRemoteControl.botChannel.newDescription')}</p>
                <div className="wrc-bots-provider-grid">
                  {REMOTE_CHANNEL_PROVIDERS.map((provider) => {
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        className="wrc-bots-provider-card"
                        onClick={() => chooseProvider(provider.id)}
                      >
                        <span className={`wrc-channel-icon ${provider.brandClass}`}>
                          <RemoteChannelBrandIcon provider={provider.id} size={24} />
                        </span>
                        <span>
                          <strong>{t(`webRemoteControl.botChannel.${provider.id}.title`)}</strong>
                          <small>{t(`webRemoteControl.botChannel.${provider.id}.description`)}</small>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : selected && selectedMeta ? (
              <div className="wrc-bots-detail-scroll">
                {/* Header: icon · name · status · enable */}
                <div className="wrc-bot-detail-header">
                  <span className={`wrc-channel-icon ${selectedMeta.brandClass} wrc-channel-icon--lg`}>
                    <RemoteChannelBrandIcon provider={selected.provider} size={28} />
                  </span>
                  <div className="wrc-bot-detail-heading">
                    {renaming ? (
                      <input
                        className="wrc-bot-name-input"
                        autoFocus
                        value={nameDraft}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onBlur={() => {
                          patchSelected({ name: nameDraft.trim() || selected.name })
                          setRenaming(false)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur()
                          }
                          if (event.key === 'Escape') {
                            setNameDraft(selected.name)
                            setRenaming(false)
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="wrc-bot-name-button"
                        onClick={() => setRenaming(true)}
                      >
                        {selected.name || t(`webRemoteControl.botChannel.${selected.provider}.title`)}
                      </button>
                    )}
                    <div className="wrc-bot-status-line">
                      <span
                        className={`wrc-bots-dot${selected.credentialHint ? ' is-on' : ''}`}
                      />
                      <span>
                        {selected.credentialHint
                          ? t('webRemoteControl.botChannel.connected')
                          : t('webRemoteControl.botChannel.unbound')}
                      </span>
                    </div>
                  </div>
                  <label className="wrc-bot-enable">
                    <span>{t('webRemoteControl.botChannel.enabled')}</span>
                    <input
                      type="checkbox"
                      checked={selected.enabled}
                      onChange={(event) => patchSelected({ enabled: event.target.checked })}
                    />
                  </label>
                </div>

                {/* Token / registration section */}
                <ChannelSettingsBlock
                  label={t('webRemoteControl.botChannel.botToken')}
                  description={t(`webRemoteControl.botChannel.botTokenDescription.${selected.provider}`)}
                  control={
                    selected.credentialHint ? (
                      <div className="wrc-bot-token-actions">
                        <span className="wrc-bot-connected-pill">
                          <span className="wrc-bots-dot is-on" />
                          {t('webRemoteControl.botChannel.connected')}
                        </span>
                        <button type="button" className="ghost-button wrc-inline-btn" onClick={clearCredential}>
                          <Unplug size={14} />
                          {t('webRemoteControl.botChannel.unbind')}
                        </button>
                      </div>
                    ) : selectedMeta.setup === 'token' ? (
                      <button
                        type="button"
                        className="ghost-button wrc-inline-btn"
                        onClick={() => window.open('https://t.me/BotFather', '_blank', 'noopener,noreferrer')}
                      >
                        <Link2 size={14} />
                        {t('webRemoteControl.botChannel.openBotFather')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost-button wrc-inline-btn"
                        onClick={() => void startScanRegistration()}
                      >
                        <QrCode size={14} />
                        {t('webRemoteControl.botChannel.scanQrCode')}
                      </button>
                    )
                  }
                  detail={
                    !selected.credentialHint && selectedMeta.setup === 'token' ? (
                      <div className="wrc-setup-panel">
                        {botFatherQr ? (
                          <img
                            src={botFatherQr}
                            alt={t('webRemoteControl.botChannel.telegramBotFatherQrAlt')}
                            className="wrc-setup-qr"
                            width={160}
                            height={160}
                          />
                        ) : null}
                        <div className="wrc-setup-copy">
                          <p>{t('webRemoteControl.botChannel.telegramBotFatherScanHint')}</p>
                          <code className="wrc-mono">@BotFather</code>
                          <div className="wrc-token-row">
                            <input
                              type="password"
                              value={tokenDraft}
                              onChange={(event) => setTokenDraft(event.target.value)}
                              placeholder={t('webRemoteControl.botChannel.credentialPlaceholder')}
                              disabled={secretSaving}
                            />
                            <button
                              type="button"
                              className="ghost-button wrc-inline-btn"
                              disabled={secretSaving || !tokenDraft.trim()}
                              onClick={() => void saveToken()}
                            >
                              {secretSaving ? <Loader2 className="wrc-spin" size={14} /> : <Check size={14} />}
                              {t('webRemoteControl.botChannel.saveSecret')}
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : !selected.credentialHint &&
                      scanSession &&
                      scanSession.botId === selected.id ? (
                      <div className="wrc-setup-panel">
                        {scanSession.qrDataUrl ? (
                          <img
                            src={scanSession.qrDataUrl}
                            alt={t(`webRemoteControl.botChannel.scanQrAlt.${selected.provider}`)}
                            className="wrc-setup-qr"
                            width={160}
                            height={160}
                          />
                        ) : null}
                        <div className="wrc-setup-copy">
                          <p>{t(`webRemoteControl.botChannel.scanHint.${selected.provider}`)}</p>
                          <code className="wrc-mono">{scanSession.userCode}</code>
                          <p className="wrc-setup-status">
                            <Loader2 className="wrc-spin" size={12} />
                            {t(`webRemoteControl.botChannel.scanStatus.${scanSession.status}`)}
                          </p>
                          <p className="wrc-setup-footnote">{t('webRemoteControl.botChannel.scanFootnote')}</p>
                        </div>
                      </div>
                    ) : selected.credentialHint &&
                      bindSession &&
                      bindSession.botId === selected.id ? (
                      <div className="wrc-bind-panel">
                        <div className="wrc-bind-top">
                          <div>
                            <div className="wrc-bind-title">{t('webRemoteControl.botChannel.bindCommand')}</div>
                            <p>{t('webRemoteControl.botChannel.bindCommandGuide')}</p>
                          </div>
                          <button type="button" className="ghost-button wrc-inline-btn" onClick={startBindCode}>
                            <RefreshCw size={13} />
                            {t('webRemoteControl.botChannel.refreshBindCode')}
                          </button>
                        </div>
                        <div className="wrc-bind-command">
                          <code className={bindExpired ? 'is-expired' : ''}>/bind {bindSession.code}</code>
                          <button
                            type="button"
                            className="ghost-button wrc-inline-btn"
                            disabled={bindExpired}
                            onClick={() => void copyBindCommand()}
                          >
                            <Copy size={14} />
                            {t('webRemoteControl.botChannel.copyBindCommand')}
                          </button>
                        </div>
                        <ol className="wrc-bind-steps">
                          <li>{t('webRemoteControl.botChannel.bindStep.copy')}</li>
                          <li>{t('webRemoteControl.botChannel.bindStep.openChat')}</li>
                          <li>{t('webRemoteControl.botChannel.bindStep.send')}</li>
                        </ol>
                        <div className="wrc-bind-timer">
                          <Clock3 size={13} />
                          {bindExpired
                            ? t('webRemoteControl.botChannel.bindCodeExpired')
                            : t('webRemoteControl.botChannel.bindCodeExpires', {
                                time: formatRemaining(bindRemainingMs)
                              })}
                        </div>
                        <div className="wrc-bind-progress">
                          <div
                            className={`wrc-bind-progress-bar${bindExpired ? ' is-expired' : bindProgress <= 10 ? ' is-danger' : bindProgress <= 30 ? ' is-warn' : ''}`}
                            style={{ transform: `scaleX(${bindProgress / 100})` }}
                          />
                        </div>
                      </div>
                    ) : selected.credentialHint ? (
                      <div className="wrc-bot-token-actions wrc-bot-token-actions--start">
                        <button type="button" className="ghost-button wrc-inline-btn" onClick={startBindCode}>
                          <Link2 size={14} />
                          {t('webRemoteControl.botChannel.bind')}
                        </button>
                        <span className="wrc-credential-mask">{selected.credentialHint}</span>
                      </div>
                    ) : null
                  }
                />

                {/* Reply granularity */}
                <ChannelSettingsBlock
                  label={t('webRemoteControl.botChannel.replyGranularity')}
                  description={t('webRemoteControl.botChannel.replyGranularityDescription')}
                  control={
                    <select
                      className="wrc-select"
                      value={selected.replyMode}
                      onChange={(event) =>
                        patchSelected({ replyMode: event.target.value as ReplyMode })
                      }
                    >
                      {REPLY_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {t(`webRemoteControl.botChannel.replyMode.${mode}`)}
                        </option>
                      ))}
                    </select>
                  }
                />

                {/* Allowed workspaces */}
                <ChannelSettingsBlock
                  label={t('webRemoteControl.botChannel.allowedWorkspaces')}
                  description={
                    selected.workspaceMode === 'all'
                      ? t('webRemoteControl.botChannel.allowedWorkspacesAll')
                      : t('webRemoteControl.botChannel.allowedWorkspacesSelected', { count: 1 })
                  }
                  control={
                    <select
                      className="wrc-select"
                      value={selected.workspaceMode}
                      onChange={(event) =>
                        patchSelected({
                          workspaceMode: event.target.value === 'selected' ? 'selected' : 'all'
                        })
                      }
                    >
                      <option value="all">{t('webRemoteControl.botChannel.workspaceMode.all')}</option>
                      <option value="selected">
                        {t('webRemoteControl.botChannel.workspaceMode.selected')}
                      </option>
                    </select>
                  }
                  detail={
                    selected.workspaceMode === 'selected' ? (
                      <div className="wrc-workspace-pick">
                        <div className="wrc-workspace-pick-item is-checked">
                          <span className="wrc-check" aria-hidden="true">
                            <Check size={12} />
                          </span>
                          <div>
                            <strong>{workspaceLabel}</strong>
                            {workspacePath ? <small>{workspacePath}</small> : null}
                            {workspaceId ? <small>id: {workspaceId}</small> : null}
                          </div>
                        </div>
                      </div>
                    ) : null
                  }
                />

                {/* Notes */}
                <ChannelSettingsBlock
                  label={t('webRemoteControl.botChannel.fields.note')}
                  description={t('webRemoteControl.botChannel.fields.noteHint')}
                  control={null}
                  detail={
                    <textarea
                      className="wrc-textarea"
                      rows={3}
                      value={selected.note}
                      onChange={(event) => patchSelected({ note: event.target.value })}
                      placeholder={t('webRemoteControl.botChannel.fields.notePlaceholder')}
                    />
                  }
                />

                {/* Delete */}
                <ChannelSettingsBlock
                  label={t('webRemoteControl.botChannel.delete')}
                  description={t('webRemoteControl.botChannel.deleteDescription')}
                  control={
                    <button type="button" className="ghost-button wrc-inline-btn wrc-danger-btn" onClick={removeSelected}>
                      <Trash2 size={14} />
                      {t('webRemoteControl.botChannel.delete')}
                    </button>
                  }
                />

                <p className="wrc-bots-runtime-note">{t('webRemoteControl.botChannel.runtimeUnavailable')}</p>
              </div>
            ) : (
              <div className="wrc-bots-empty-main">{t('webRemoteControl.botChannel.emptyMain')}</div>
            )}

            {notice ? <div className="wrc-bots-notice">{notice}</div> : null}
          </div>
        </div>
    </div>
  )
}

function ChannelSettingsBlock({
  label,
  description,
  control,
  detail
}: {
  label: string
  description: string
  control: ReactNode
  detail?: React.ReactNode
}) {
  return (
    <section className="wrc-settings-block">
      <div className="wrc-settings-block-row">
        <div className="wrc-settings-block-copy">
          <strong>{label}</strong>
          <span>{description}</span>
        </div>
        {control ? <div className="wrc-settings-block-control">{control}</div> : null}
      </div>
      {detail ? <div className="wrc-settings-block-detail">{detail}</div> : null}
    </section>
  )
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
