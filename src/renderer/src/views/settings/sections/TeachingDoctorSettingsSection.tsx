import { Copy, Loader2, Stethoscope } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  TeachingDoctorCheckItem,
  TeachingDoctorCheckResult,
  TeachingDoctorReport
} from '../../../../../shared/teaching-types'
import { AgentSessionQueueDiagnostics } from './AgentSessionQueueDiagnostics'
import { SettingsCard, SettingsPanel, SettingsRow } from '../SettingsPrimitives'

type DoctorViewState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ready'; report: TeachingDoctorReport }
  | { kind: 'error'; message: string }

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim()
    if (message) return message.slice(0, 400)
  }
  if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 400)
  return 'unknown error'
}

function exportSafeReportPayload(report: TeachingDoctorReport): Record<string, unknown> {
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    overallStatus: report.overallStatus,
    workspaceOpenPolicy: report.workspaceOpenPolicy,
    mode: report.mode,
    checks: report.checks.map((check) => ({
      checkId: check.checkId,
      result: check.result,
      summary: check.summary,
      recommendedAction: check.recommendedAction,
      ...(check.fixSuggestion
        ? {
            fixSuggestion: {
              title: check.fixSuggestion.title,
              steps: check.fixSuggestion.steps
            }
          }
        : {})
    }))
  }
}

function DoctorResultBadge({
  result,
  label,
  testId
}: {
  result: TeachingDoctorCheckResult
  label: string
  testId?: string
}) {
  return (
    <span className="settings-status-badge" data-state={result} data-testid={testId ?? `doctor-result-${result}`}>
      {label}
    </span>
  )
}

function DoctorCheckCard({
  check,
  t
}: {
  check: TeachingDoctorCheckItem
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  return (
    <div className="settings-card" data-testid="doctor-check" data-check-id={check.checkId}>
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>
            <code style={{ fontSize: '0.85em' }}>{check.checkId}</code>
          </strong>
          <span>{check.summary}</span>
          {check.recommendedAction ? (
            <span>
              {t('doctor.recommendedAction')}: {check.recommendedAction}
            </span>
          ) : null}
        </div>
        <div className="settings-row-control">
          <DoctorResultBadge result={check.result} label={t(`doctor.result.${check.result}`)} />
        </div>
      </div>
      {check.fixSuggestion ? (
        <div className="settings-list-copy" style={{ padding: '0 1rem 0.85rem' }} data-testid="doctor-fix-suggestion">
          <strong>
            {t('doctor.fixSuggestion')}: {check.fixSuggestion.title}
          </strong>
          <ol style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
            {check.fixSuggestion.steps.map((step, index) => (
              <li key={`${check.checkId}-step-${index}`}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Thin Settings Doctor UI (ADR-0095).
 * Calls existing product IPC only; never auto-repairs, uploads, or clears markers.
 */
export function TeachingDoctorSettingsSection() {
  const { t } = useTranslation()
  const [state, setState] = useState<DoctorViewState>({ kind: 'idle' })
  const [copied, setCopied] = useState(false)

  const runDoctor = useCallback(async () => {
    const run = window.teachingSystem?.runTeachingDoctor
    if (typeof run !== 'function') {
      setState({ kind: 'error', message: t('doctor.unavailable') })
      return
    }

    setState({ kind: 'running' })
    setCopied(false)
    try {
      const report = await run({ includeProcessCrashMarker: true })
      setState({ kind: 'ready', report })
    } catch (error) {
      setState({ kind: 'error', message: safeErrorMessage(error) })
    }
  }, [t])

  const copyReport = useCallback(async () => {
    if (state.kind !== 'ready') return
    try {
      const payload = JSON.stringify(exportSafeReportPayload(state.report), null, 2)
      await navigator.clipboard.writeText(payload)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [state])

  return (
    <SettingsPanel title={t('doctor.title')} subtitle={t('doctor.subtitle')}>
      <SettingsCard>
        <SettingsRow label={t('doctor.advisoryNote')} detail={t('doctor.empty')}>
          <div className="settings-inline-group">
            <button
              className="ghost-button strong"
              type="button"
              onClick={() => void runDoctor()}
              disabled={state.kind === 'running'}
              data-testid="doctor-run"
            >
              {state.kind === 'running' ? <Loader2 size={15} className="is-spinning" /> : <Stethoscope size={15} />}
              {state.kind === 'running' ? t('doctor.running') : t('doctor.run')}
            </button>
            {state.kind === 'ready' ? (
              <button className="ghost-button" type="button" onClick={() => void copyReport()} data-testid="doctor-copy">
                <Copy size={15} />
                {copied ? t('doctor.copied') : t('doctor.copy')}
              </button>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsCard>

      {state.kind === 'idle' ? (
        <SettingsCard>
          <p className="settings-list-copy" data-testid="doctor-empty">
            {t('doctor.empty')}
          </p>
        </SettingsCard>
      ) : null}

      {state.kind === 'error' ? (
        <SettingsCard>
          <p className="settings-list-copy" data-testid="doctor-error" role="alert">
            {t('doctor.error')}: {state.message}
          </p>
        </SettingsCard>
      ) : null}

      {state.kind === 'ready' ? (
        <>
          <SettingsCard>
            <SettingsRow
              label={t('doctor.overallStatus')}
              detail={`${t('doctor.generatedAt')}: ${state.report.generatedAt}`}
            >
              <DoctorResultBadge
                result={state.report.overallStatus}
                label={t(`doctor.result.${state.report.overallStatus}`)}
                testId="doctor-overall-status"
              />
            </SettingsRow>
          </SettingsCard>
          <div data-testid="doctor-checks">
            <h3 style={{ margin: '0.75rem 0 0.5rem', fontSize: '0.95rem' }}>{t('doctor.checks')}</h3>
            {state.report.checks.map((check) => (
              <DoctorCheckCard key={check.checkId} check={check} t={t} />
            ))}
          </div>
        </>
      ) : null}

      <AgentSessionQueueDiagnostics />
    </SettingsPanel>
  )
}
