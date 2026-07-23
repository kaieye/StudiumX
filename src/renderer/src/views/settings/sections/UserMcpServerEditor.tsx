import { ArrowLeft, Braces, FormInput, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { McpServerScope, McpTransportKind } from '../../../../../shared/mcp/types'
import { SettingsCard } from '../SettingsPrimitives'
import {
  draftMcpServerToJson,
  jsonToDraftMcpServer,
  type DraftMcpServer,
  validateDraftMcpServer
} from './user-mcp-settings-model'

type UserMcpServerEditorProps = {
  mode: 'create' | 'edit'
  initialDraft: DraftMcpServer
  workspaceRoot: string | null
  busy: boolean
  onCancel: () => void
  onSave: (server: DraftMcpServer) => Promise<boolean>
}

type EditorFormat = 'form' | 'json'

export function UserMcpServerEditor({
  mode,
  initialDraft,
  workspaceRoot,
  busy,
  onCancel,
  onSave
}: UserMcpServerEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(initialDraft)
  const [format, setFormat] = useState<EditorFormat>('form')
  const [jsonText, setJsonText] = useState(() => draftMcpServerToJson(initialDraft))
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const editing = mode === 'edit'

  const update = (patch: Partial<DraftMcpServer>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setValidationError(null)
  }

  const updateName = (label: string): void => {
    update({ label })
    if (format !== 'json') return
    const parsed = jsonToDraftMcpServer(jsonText, draft)
    if (parsed.ok) setJsonText(draftMcpServerToJson({ ...parsed.draft, label }))
  }

  const updateScope = (scope: McpServerScope): void => {
    update({
      scope,
      workspaceRoot:
        scope === 'workspace' ? workspaceRoot ?? draft.workspaceRoot : ''
    })
  }

  const changeFormat = (next: EditorFormat): void => {
    if (next === format) return
    if (next === 'json') {
      setJsonText(draftMcpServerToJson(draft))
      setFormat(next)
      setValidationError(null)
      return
    }
    const parsed = jsonToDraftMcpServer(jsonText, draft)
    if (!parsed.ok) {
      setValidationError(t(`mcp.validation.${parsed.error}`))
      return
    }
    setDraft(parsed.draft)
    setFormat(next)
    setValidationError(null)
  }

  const submit = async (): Promise<void> => {
    let candidate = draft
    if (format === 'json') {
      const parsed = jsonToDraftMcpServer(jsonText, draft)
      if (!parsed.ok) {
        setValidationError(t(`mcp.validation.${parsed.error}`))
        return
      }
      candidate = parsed.draft
      setDraft(parsed.draft)
    }
    const error = validateDraftMcpServer(candidate)
    if (error) {
      setValidationError(t(`mcp.validation.${error}`))
      return
    }
    setSubmitting(true)
    try {
      await onSave(candidate)
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = busy || submitting
  const workspaceUnavailable = !workspaceRoot && draft.scope !== 'workspace'

  return (
    <SettingsCard className="mcp-editor-card">
      <div className="mcp-editor-shell" data-testid="mcp-editor">
        <button
          className="mcp-editor-back"
          type="button"
          disabled={disabled}
          onClick={onCancel}
        >
          <ArrowLeft size={14} />
          {t('mcp.editor.backToServers')}
        </button>

        <div className="mcp-editor-topline">
          <div className="mcp-editor-heading-copy">
            <h3>{t(editing ? 'mcp.editor.editTitle' : 'mcp.editor.createTitle')}</h3>
            <p>{t(editing ? 'mcp.editor.editDetail' : 'mcp.editor.createDetail')}</p>
          </div>

          <div className="mcp-editor-format" role="tablist" aria-label={t('mcp.editor.format')}>
            <button
              type="button"
              role="tab"
              aria-selected={format === 'form'}
              className={format === 'form' ? 'is-active' : ''}
              disabled={disabled}
              onClick={() => changeFormat('form')}
            >
              <FormInput size={14} />
              {t('mcp.editor.form')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={format === 'json'}
              className={format === 'json' ? 'is-active' : ''}
              disabled={disabled}
              onClick={() => changeFormat('json')}
            >
              <Braces size={14} />
              {t('mcp.editor.json')}
            </button>
          </div>
        </div>

        <div className="mcp-editor-grid">
          <div className="mcp-editor-primary-row">
            <label className="mcp-field">
              <span>{t('mcp.servers.label')}</span>
              <input
                className="settings-input"
                value={draft.label}
                disabled={disabled}
                placeholder={t('mcp.editor.labelPlaceholder')}
                aria-label={t('mcp.servers.label')}
                onChange={(event) => updateName(event.target.value)}
              />
            </label>

            <label className="mcp-field">
              <span>{t('mcp.servers.scope')}</span>
              <select
                className="settings-input"
                value={draft.scope}
                disabled={disabled}
                aria-label={t('mcp.servers.scope')}
                onChange={(event) => updateScope(event.target.value as McpServerScope)}
              >
                <option value="user">{t('mcp.servers.userScope')}</option>
                <option value="workspace" disabled={workspaceUnavailable}>
                  {t('mcp.servers.workspaceScope')}
                </option>
              </select>
              {draft.scope === 'workspace' ? (
                <small>{draft.workspaceRoot || t('mcp.editor.workspaceUnavailable')}</small>
              ) : null}
            </label>
          </div>

          {format === 'json' ? (
            <label className="mcp-field mcp-field-wide">
              <span>{t('mcp.editor.jsonConfig')}</span>
              <textarea
                className="settings-textarea mcp-json-textarea"
                value={jsonText}
                disabled={disabled}
                rows={18}
                spellCheck={false}
                aria-label={t('mcp.editor.jsonConfig')}
                data-testid="mcp-editor-json"
                onChange={(event) => {
                  setJsonText(event.target.value)
                  setValidationError(null)
                }}
              />
              <small>{t('mcp.editor.jsonHint')}</small>
            </label>
          ) : (
            <McpServerForm draft={draft} disabled={disabled} update={update} />
          )}
        </div>

        {validationError ? (
          <div className="mcp-inline-alert is-error" role="alert" data-testid="mcp-editor-error">
            {validationError}
          </div>
        ) : null}

        <div className="mcp-editor-footer">
          <button className="ghost-button" type="button" disabled={disabled} onClick={onCancel}>
            {t('mcp.editor.cancel')}
          </button>
          <button
            className="ghost-button strong"
            type="button"
            disabled={disabled}
            data-testid="mcp-editor-save"
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 size={15} className="is-spinning" /> : null}
            {submitting
              ? t('mcp.editor.saving')
              : t(editing ? 'mcp.editor.save' : 'mcp.editor.add')}
          </button>
        </div>
      </div>
    </SettingsCard>
  )
}

function McpServerForm({
  draft,
  disabled,
  update
}: {
  draft: DraftMcpServer
  disabled: boolean
  update: (patch: Partial<DraftMcpServer>) => void
}) {
  const { t } = useTranslation()
  const setTransport = (transport: McpTransportKind): void => update({ transport })

  return (
    <div className="mcp-editor-core">
      <div className="mcp-field mcp-field-wide">
        <span>{t('mcp.servers.type')}</span>
        <div className="mcp-transport-control" role="group" aria-label={t('mcp.servers.type')}>
          {(['stdio', 'http', 'sse'] as const).map((transport) => (
            <button
              key={transport}
              type="button"
              className={draft.transport === transport ? 'is-active' : ''}
              disabled={disabled}
              onClick={() => setTransport(transport)}
            >
              {transport === 'http' ? t('mcp.servers.streamableHttp') : transport}
            </button>
          ))}
        </div>
      </div>

      {draft.transport === 'stdio' ? (
        <label className="mcp-field mcp-field-wide">
          <span>{t('mcp.servers.command')}</span>
          <input
            className="settings-input"
            value={draft.command}
            disabled={disabled}
            placeholder="npx"
            aria-label={t('mcp.servers.command')}
            onChange={(event) => update({ command: event.target.value })}
          />
        </label>
      ) : (
        <label className="mcp-field mcp-field-wide">
          <span>{t('mcp.servers.url')}</span>
          <input
            className="settings-input"
            value={draft.url}
            disabled={disabled}
            placeholder="https://example.com/mcp"
            aria-label={t('mcp.servers.url')}
            onChange={(event) => update({ url: event.target.value })}
          />
        </label>
      )}

      <details className="mcp-editor-advanced">
        <summary>{t('mcp.editor.advanced')}</summary>
        <div className="mcp-editor-advanced-grid">
          {draft.transport === 'stdio' ? (
            <>
              <label className="mcp-field mcp-field-wide">
                <span>{t('mcp.servers.args')}</span>
                <input
                  className="settings-input"
                  value={draft.argsText}
                  disabled={disabled}
                  placeholder="-y @modelcontextprotocol/server-example"
                  aria-label={t('mcp.servers.args')}
                  onChange={(event) => update({ argsText: event.target.value })}
                />
                <small>{t('mcp.servers.argsHint')}</small>
              </label>
              <label className="mcp-field">
                <span>{t('mcp.servers.cwd')}</span>
                <input
                  className="settings-input"
                  value={draft.cwd}
                  disabled={disabled}
                  placeholder={t('mcp.servers.cwdPlaceholder')}
                  aria-label={t('mcp.servers.cwd')}
                  onChange={(event) => update({ cwd: event.target.value })}
                />
              </label>
              <TimeoutField draft={draft} disabled={disabled} update={update} />
              <label className="mcp-field mcp-field-wide">
                <span>{t('mcp.servers.env')}</span>
                <textarea
                  className="settings-textarea mcp-record-textarea"
                  value={draft.envText}
                  disabled={disabled}
                  rows={6}
                  spellCheck={false}
                  aria-label={t('mcp.servers.env')}
                  onChange={(event) => update({ envText: event.target.value })}
                />
                <small>{t('mcp.servers.envHint')}</small>
              </label>
              <label className="mcp-field mcp-field-wide mcp-checkbox-field">
                <span>{t('mcp.servers.workspaceRootInjection')}</span>
                <input
                  type="checkbox"
                  checked={draft.workspaceRootInjection === 'granted'}
                  disabled={disabled}
                  aria-label={t('mcp.servers.workspaceRootInjection')}
                  onChange={(event) =>
                    update({
                      workspaceRootInjection: event.target.checked ? 'granted' : 'off',
                      // Stamp identity so normalize can tell explicit off from "never configured".
                      injectionIdentity:
                        event.target.checked
                          ? draft.injectionIdentity ?? 'filesystem_mcp'
                          : draft.injectionIdentity ?? 'generic'
                    })
                  }
                />
                <small>{t('mcp.servers.workspaceRootInjectionHint')}</small>
              </label>
            </>
          ) : (
            <>
              <TimeoutField draft={draft} disabled={disabled} update={update} />
              <label className="mcp-field mcp-field-wide">
                <span>{t('mcp.servers.headers')}</span>
                <textarea
                  className="settings-textarea mcp-record-textarea"
                  value={draft.headersText}
                  disabled={disabled}
                  rows={6}
                  spellCheck={false}
                  aria-label={t('mcp.servers.headers')}
                  onChange={(event) => update({ headersText: event.target.value })}
                />
                <small>{t('mcp.servers.headersHint')}</small>
              </label>
            </>
          )}
        </div>
      </details>
    </div>
  )
}

function TimeoutField({
  draft,
  disabled,
  update
}: {
  draft: DraftMcpServer
  disabled: boolean
  update: (patch: Partial<DraftMcpServer>) => void
}) {
  const { t } = useTranslation()

  return (
    <label className="mcp-field mcp-timeout-field">
      <span>{t('mcp.servers.timeout')}</span>
      <input
        className="settings-input"
        inputMode="numeric"
        value={draft.timeoutText}
        disabled={disabled}
        placeholder="30000"
        aria-label={t('mcp.servers.timeout')}
        onChange={(event) => update({ timeoutText: event.target.value })}
      />
    </label>
  )
}
