/**
 * Read-only diagnostics for main-process agent session queue projection
 * (ADOPTION B-02 residual / ADR-0098).
 *
 * - Calls projectAgentSessionQueue with streamId only (no free-text preview)
 * - Displays export-safe fields; never drains / steers / aborts / flips autoDrain
 * - Does not replace renderer-local agentBusyFollowUpQueue (ADR-0067)
 */

import { Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  AgentSessionQueueProjection,
  ProjectAgentSessionQueueResult
} from '../../../../../shared/teaching-types/agent-session-queue'
import { projectActiveAgentSessionQueue } from '../../../app-shell/agent-session-queue-client'
import { SettingsCard, SettingsRow, SettingsTextInput } from '../SettingsPrimitives'

type QueueViewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; projection: AgentSessionQueueProjection }
  | { kind: 'error'; message: string }

function reasonMessage(
  result: Extract<ProjectAgentSessionQueueResult, { ok: false }>,
  t: (key: string) => string
): string {
  if (result.reason === 'no_active_session') return t('queueDiagnostics.noActiveSession')
  if (result.reason === 'missing_stream_id') return t('queueDiagnostics.missingStreamId')
  if (result.reason === 'api_unavailable') return t('queueDiagnostics.unavailable')
  return result.reason || t('queueDiagnostics.error')
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message) return message.slice(0, 400)
  }
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 400)
  return 'unknown error'
}

/**
 * Thin Settings card: paste streamId (product conversation id) and refresh
 * main-queue snapshot. Mounted under Teaching Doctor diagnostics home.
 */
export function AgentSessionQueueDiagnostics({
  initialStreamId = ''
}: {
  /** Optional default stream/conversation id; user can still edit. */
  initialStreamId?: string
}) {
  const { t } = useTranslation()
  const [streamId, setStreamId] = useState(initialStreamId)
  const [state, setState] = useState<QueueViewState>({ kind: 'idle' })

  const refresh = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const result = await projectActiveAgentSessionQueue(
        window.teachingSystem,
        streamId
      )
      if (!result.ok) {
        setState({ kind: 'error', message: reasonMessage(result, t) })
        return
      }
      setState({ kind: 'ready', projection: result.projection })
    } catch (error) {
      setState({ kind: 'error', message: safeErrorMessage(error) })
    }
  }, [streamId, t])

  return (
    <div data-testid="queue-diagnostics" style={{ marginTop: '1.25rem' }}>
      <h3 style={{ margin: '0.75rem 0 0.5rem', fontSize: '0.95rem' }}>
        {t('queueDiagnostics.title')}
      </h3>
      <p className="settings-list-copy" data-testid="queue-diagnostics-note">
        {t('queueDiagnostics.subtitle')}
      </p>

      <SettingsCard>
        <SettingsRow
          label={t('queueDiagnostics.streamId')}
          detail={t('queueDiagnostics.streamIdDetail')}
        >
          <SettingsTextInput
            value={streamId}
            placeholder={t('queueDiagnostics.streamIdPlaceholder')}
            onChange={setStreamId}
          />
        </SettingsRow>
        <SettingsRow label={t('queueDiagnostics.refresh')} detail={t('queueDiagnostics.readOnlyNote')}>
          <button
            className="ghost-button strong"
            type="button"
            onClick={() => void refresh()}
            disabled={state.kind === 'loading'}
            data-testid="queue-diagnostics-refresh"
          >
            {state.kind === 'loading' ? (
              <Loader2 size={15} className="is-spinning" />
            ) : (
              <RefreshCw size={15} />
            )}
            {state.kind === 'loading'
              ? t('queueDiagnostics.refreshing')
              : t('queueDiagnostics.refresh')}
          </button>
        </SettingsRow>
      </SettingsCard>

      {state.kind === 'idle' ? (
        <SettingsCard>
          <p className="settings-list-copy" data-testid="queue-diagnostics-empty">
            {t('queueDiagnostics.empty')}
          </p>
        </SettingsCard>
      ) : null}

      {state.kind === 'error' ? (
        <SettingsCard>
          <p className="settings-list-copy" data-testid="queue-diagnostics-error" role="alert">
            {t('queueDiagnostics.error')}: {state.message}
          </p>
        </SettingsCard>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <SettingsCard>
            <SettingsRow label={t('queueDiagnostics.busy')}>
              <span
                className="settings-status-badge"
                data-state={state.projection.busy ? 'warning' : 'ok'}
                data-testid="queue-diagnostics-busy"
              >
                {state.projection.busy
                  ? t('queueDiagnostics.busyTrue')
                  : t('queueDiagnostics.busyFalse')}
              </span>
            </SettingsRow>
            <SettingsRow label={t('queueDiagnostics.phase')}>
              <code data-testid="queue-diagnostics-phase">{state.projection.phase}</code>
            </SettingsRow>
            <SettingsRow
              label={t('queueDiagnostics.autoDrain')}
              detail={t('queueDiagnostics.autoDrainExpectedFalse')}
            >
              <span
                className="settings-status-badge"
                data-state={state.projection.autoDrain ? 'fail' : 'ok'}
                data-testid="queue-diagnostics-autodrain"
                data-autodrain={state.projection.autoDrain ? 'true' : 'false'}
              >
                {state.projection.autoDrain
                  ? t('queueDiagnostics.autoDrainTrue')
                  : t('queueDiagnostics.autoDrainFalse')}
              </span>
            </SettingsRow>
            <SettingsRow label={t('queueDiagnostics.queueDepth')}>
              <span data-testid="queue-diagnostics-depth">
                {state.projection.queueDepth} / {state.projection.queueCapacity}
              </span>
            </SettingsRow>
            {state.projection.closed !== undefined ? (
              <SettingsRow label={t('queueDiagnostics.closed')}>
                <span data-testid="queue-diagnostics-closed">
                  {state.projection.closed
                    ? t('queueDiagnostics.closedTrue')
                    : t('queueDiagnostics.closedFalse')}
                </span>
              </SettingsRow>
            ) : null}
          </SettingsCard>

          <div data-testid="queue-diagnostics-entries">
            <h4 style={{ margin: '0.75rem 0 0.5rem', fontSize: '0.9rem' }}>
              {t('queueDiagnostics.entries')} ({state.projection.entries.length})
            </h4>
            {state.projection.entries.length === 0 ? (
              <SettingsCard>
                <p className="settings-list-copy">{t('queueDiagnostics.entriesEmpty')}</p>
              </SettingsCard>
            ) : (
              state.projection.entries.map((entry) => (
                <SettingsCard key={entry.id}>
                  <div
                    className="settings-row"
                    data-testid="queue-diagnostics-entry"
                    data-entry-id={entry.id}
                  >
                    <div className="settings-row-copy">
                      <strong>
                        <code style={{ fontSize: '0.85em' }}>{entry.kind}</code>
                      </strong>
                      <span>
                        {t('queueDiagnostics.enqueuedAt')}: {entry.enqueuedAt}
                      </span>
                      <span>
                        id: <code style={{ fontSize: '0.85em' }}>{entry.id}</code>
                      </span>
                    </div>
                  </div>
                </SettingsCard>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
