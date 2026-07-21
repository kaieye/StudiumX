/**
 * Settings Review section — thin project-first UI for teaching-turn review
 * candidates (ADOPTION S-09 residual / ADR-0097 + ADR-0111 + ADR-0114).
 *
 * - Primary: client-side demo bundle → projectTeachingTurnReview → render projection
 * - Optional: local approve/reject/defer + decideTeachingTurnReview → re-project
 * - After successful project/decide: pure client-side handoff intents (display only)
 * - Optional durable last-bundle load/save (userData cache only; never auto-apply)
 * - Never auto-applies; approved ids and handoff intents are display-only (not an apply plan)
 * - No skill install / memory write / consent navigation
 */

import { FileCheck2, FolderOpen, Loader2, Save } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  TeachingTurnReviewApprovalProjection,
  TeachingTurnReviewDecisionAction,
  TeachingTurnReviewHumanDecision
} from '../../../../../shared/teaching-turn-review-approve'
import type { TeachingTurnReviewBundle } from '../../../../../shared/teaching-turn-review'
import {
  projectTeachingTurnReviewHandoff,
  type TeachingTurnReviewHandoffProjection
} from '../../../../../shared/teaching-turn-review-handoff'
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsSelect
} from '../SettingsPrimitives'

/** Client-side sample bundle only — never treated as durable product queue. */
export function createDemoTeachingTurnReviewBundle(
  generatedAt: string = new Date().toISOString()
): TeachingTurnReviewBundle {
  return {
    turnId: 'demo-turn-review-settings',
    generatedAt,
    candidates: [
      {
        id: 'review:lesson_gap:v1',
        kind: 'lesson_gap',
        title: 'Possible lesson gap',
        summary:
          'This turn showed an explicit teaching gap signal. Consider a human-approved follow-up practice step — do not auto-write records.',
        requiresHumanApproval: true,
        payload: {
          signal: 'lesson_gap_phrase',
          diagnosticOnly: true
        }
      },
      {
        id: 'review:skill_pack_hint:v1',
        kind: 'skill_pack_hint',
        title: 'Skill-pack hint (human approve only)',
        summary:
          'Conversation mentions a reusable procedure. A human may later author a skill-pack — this candidate must not create skill files automatically.',
        requiresHumanApproval: true,
        payload: {
          signal: 'reusable_procedure_phrase',
          diagnosticOnly: true
        }
      },
      {
        id: 'review:memory_candidate:v1',
        kind: 'memory_candidate',
        title: 'Memory candidate (consent required)',
        summary:
          'A durable memory may be useful later. Opening consent remains a separate product path — this candidate must not write learner-profile or memory automatically.',
        requiresHumanApproval: true,
        payload: {
          signal: 'memory_phrase',
          diagnosticOnly: true
        }
      }
    ]
  }
}

type LocalAction = TeachingTurnReviewDecisionAction | 'pending'

function computeHandoff(
  nextProjection: TeachingTurnReviewApprovalProjection
): TeachingTurnReviewHandoffProjection | null {
  try {
    return projectTeachingTurnReviewHandoff(nextProjection)
  } catch {
    // Fail-soft display only — do not invent intents.
    return null
  }
}

export function TeachingTurnReviewSettingsSection() {
  const { t } = useTranslation()
  const [bundle, setBundle] = useState<TeachingTurnReviewBundle | null>(null)
  const [projection, setProjection] = useState<TeachingTurnReviewApprovalProjection | null>(null)
  const [handoff, setHandoff] = useState<TeachingTurnReviewHandoffProjection | null>(null)
  const [localActions, setLocalActions] = useState<Record<string, LocalAction>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastBundleStatus, setLastBundleStatus] = useState<string | null>(null)

  const decisionOptions = useMemo(
    () =>
      (
        [
          ['pending', t('review.decision.pending')],
          ['approve', t('review.decision.approve')],
          ['reject', t('review.decision.reject')],
          ['defer', t('review.decision.defer')]
        ] as const
      ).map(([value, label]) => ({ value: value as LocalAction, label })),
    [t]
  )

  const projectBundle = useCallback(
    async (
      nextBundle: TeachingTurnReviewBundle,
      decision?: TeachingTurnReviewHumanDecision
    ): Promise<boolean> => {
      const api = window.teachingSystem
      if (!api?.projectTeachingTurnReview) {
        setError(t('review.apiUnavailable'))
        return false
      }
      setBusy(true)
      setError(null)
      try {
        const result = await api.projectTeachingTurnReview(
          decision ? { bundle: nextBundle, decision } : { bundle: nextBundle }
        )
        if (!result.ok) {
          setError(result.reason || t('review.projectFailed'))
          setHandoff(null)
          return false
        }
        setBundle(nextBundle)
        setProjection(result.projection)
        setHandoff(computeHandoff(result.projection))
        const actions: Record<string, LocalAction> = {}
        for (const candidate of result.projection.candidates) {
          actions[candidate.id] = candidate.decision
        }
        setLocalActions(actions)
        return true
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : t('review.projectFailed'))
        setHandoff(null)
        return false
      } finally {
        setBusy(false)
      }
    },
    [t]
  )

  const handleDemoProject = useCallback(async (): Promise<void> => {
    const demo = createDemoTeachingTurnReviewBundle()
    setLastBundleStatus(null)
    await projectBundle(demo)
  }, [projectBundle])

  const handleLoadLastBundle = useCallback(async (): Promise<void> => {
    const api = window.teachingSystem
    if (!api?.getTeachingTurnReviewLastBundle || !api?.projectTeachingTurnReview) {
      setError(t('review.apiUnavailable'))
      return
    }
    setBusy(true)
    setError(null)
    setLastBundleStatus(null)
    try {
      const result = await api.getTeachingTurnReviewLastBundle()
      if (!result.ok) {
        setError(result.reason || t('review.loadLastFailed'))
        return
      }
      if (!result.snapshot) {
        setLastBundleStatus(t('review.loadLastEmpty'))
        return
      }
      // Project only — never auto-apply the durable cache.
      const projected = await api.projectTeachingTurnReview(
        result.snapshot.decision
          ? { bundle: result.snapshot.bundle, decision: result.snapshot.decision }
          : { bundle: result.snapshot.bundle }
      )
      if (!projected.ok) {
        setError(projected.reason || t('review.projectFailed'))
        setHandoff(null)
        return
      }
      setBundle(result.snapshot.bundle)
      setProjection(projected.projection)
      setHandoff(computeHandoff(projected.projection))
      const actions: Record<string, LocalAction> = {}
      for (const candidate of projected.projection.candidates) {
        actions[candidate.id] = candidate.decision
      }
      setLocalActions(actions)
      setLastBundleStatus(
        t('review.loadLastOk', {
          savedAt: result.snapshot.savedAt,
          source: result.snapshot.source
        })
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('review.loadLastFailed'))
    } finally {
      setBusy(false)
    }
  }, [t])

  const handleSaveLastBundle = useCallback(async (): Promise<void> => {
    if (!bundle) return
    const api = window.teachingSystem
    if (!api?.saveTeachingTurnReviewLastBundle) {
      setError(t('review.apiUnavailable'))
      return
    }

    const decisions = Object.entries(localActions)
      .filter((entry): entry is [string, TeachingTurnReviewDecisionAction] => entry[1] !== 'pending')
      .map(([candidateId, action]) => ({ candidateId, action }))

    const decision: TeachingTurnReviewHumanDecision | undefined =
      decisions.length > 0
        ? {
            turnId: bundle.turnId,
            decidedAt: new Date().toISOString(),
            decisions
          }
        : undefined

    setBusy(true)
    setError(null)
    setLastBundleStatus(null)
    try {
      const result = await api.saveTeachingTurnReviewLastBundle({
        bundle,
        ...(decision ? { decision } : {}),
        source: 'settings_demo'
      })
      if (!result.ok) {
        setError(result.reason || t('review.saveLastFailed'))
        return
      }
      setLastBundleStatus(t('review.saveLastOk'))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('review.saveLastFailed'))
    } finally {
      setBusy(false)
    }
  }, [bundle, localActions, t])

  const handleDecisionChange = useCallback((candidateId: string, action: LocalAction): void => {
    setLocalActions((current) => ({ ...current, [candidateId]: action }))
  }, [])

  const handleSubmitDecisions = useCallback(async (): Promise<void> => {
    if (!bundle) return
    const api = window.teachingSystem
    if (!api?.decideTeachingTurnReview) {
      setError(t('review.apiUnavailable'))
      return
    }

    const decisions = Object.entries(localActions)
      .filter((entry): entry is [string, TeachingTurnReviewDecisionAction] => entry[1] !== 'pending')
      .map(([candidateId, action]) => ({ candidateId, action }))

    const decision: TeachingTurnReviewHumanDecision = {
      turnId: bundle.turnId,
      decidedAt: new Date().toISOString(),
      decisions
    }

    setBusy(true)
    setError(null)
    try {
      const result = await api.decideTeachingTurnReview({ bundle, decision })
      if (!result.ok) {
        setError(result.reason || t('review.decideFailed'))
        setHandoff(null)
        return
      }
      setProjection(result.projection)
      setHandoff(computeHandoff(result.projection))
      const actions: Record<string, LocalAction> = {}
      for (const candidate of result.projection.candidates) {
        actions[candidate.id] = candidate.decision
      }
      setLocalActions(actions)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('review.decideFailed'))
      setHandoff(null)
    } finally {
      setBusy(false)
    }
  }, [bundle, localActions, t])

  const hasProjection = projection !== null
  const hasPendingOnly =
    hasProjection &&
    projection.candidates.every((candidate) => (localActions[candidate.id] ?? 'pending') === 'pending')
  const showHandoff =
    handoff !== null && (handoff.intents.length > 0 || handoff.unmappedCandidateIds.length > 0)

  return (
    <SettingsPanel title={t('review.title')} subtitle={t('review.subtitle')}>
      <SettingsCard>
        <div className="settings-list-copy" role="note" data-testid="review-advisory">
          <strong>{t('review.advisoryNote')}</strong>
          <span>{t('review.empty')}</span>
        </div>
        <SettingsRow label={t('review.demoProject')} detail={t('review.demoProjectDetail')}>
          <button
            className="ghost-button"
            type="button"
            data-testid="review-demo-project"
            disabled={busy}
            onClick={() => void handleDemoProject()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileCheck2 size={15} />}
            {t('review.demoProject')}
          </button>
        </SettingsRow>
        <SettingsRow label={t('review.loadLast')} detail={t('review.loadLastDetail')}>
          <button
            className="ghost-button"
            type="button"
            data-testid="review-load-last"
            disabled={busy}
            onClick={() => void handleLoadLastBundle()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FolderOpen size={15} />}
            {t('review.loadLast')}
          </button>
        </SettingsRow>
        <SettingsRow label={t('review.saveLast')} detail={t('review.saveLastDetail')}>
          <button
            className="ghost-button"
            type="button"
            data-testid="review-save-last"
            disabled={busy || !bundle}
            onClick={() => void handleSaveLastBundle()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {t('review.saveLast')}
          </button>
        </SettingsRow>
        {lastBundleStatus ? (
          <div className="settings-list-copy" data-testid="review-last-bundle-status">
            <span>{lastBundleStatus}</span>
          </div>
        ) : null}
        {error ? (
          <div className="settings-status-badge" data-state="failed" data-testid="review-error" role="alert">
            {error}
          </div>
        ) : null}
      </SettingsCard>

      {!hasProjection ? (
        <SettingsCard>
          <div className="settings-list-copy" data-testid="review-empty-state">
            <strong>{t('review.emptyTitle')}</strong>
            <span>{t('review.empty')}</span>
          </div>
        </SettingsCard>
      ) : (
        <>
          <SettingsCard>
            <div className="settings-list-copy">
              <strong>{t('review.candidatesHeading')}</strong>
              <span>
                {projection.turnId
                  ? t('review.turnMeta', { turnId: projection.turnId, generatedAt: projection.generatedAt })
                  : t('review.generatedAt', { generatedAt: projection.generatedAt })}
              </span>
            </div>
            {projection.candidates.map((candidate) => (
              <div
                key={candidate.id}
                className="settings-connector-row"
                data-testid={`review-candidate-${candidate.id}`}
              >
                <div className="settings-connector-main">
                  <div className="settings-list-copy">
                    <strong>{candidate.title}</strong>
                    <span>{candidate.summary}</span>
                    <span>
                      {t('review.kindLabel')}: {t(`review.kind.${candidate.kind}`, { defaultValue: candidate.kind })}
                    </span>
                    <span className="settings-status-badge" data-testid={`review-requires-${candidate.id}`}>
                      {t('review.requiresHumanApproval')}
                    </span>
                    {candidate.note ? (
                      <span>
                        {t('review.noteLabel')}: {candidate.note}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="settings-inline-group">
                  <span
                    className="settings-status-badge"
                    data-state={candidate.decision}
                    data-testid={`review-status-${candidate.id}`}
                  >
                    {t(`review.decision.${candidate.decision}`)}
                  </span>
                  <SettingsSelect
                    value={(localActions[candidate.id] ?? 'pending') as LocalAction}
                    options={decisionOptions}
                    onChange={(action) => handleDecisionChange(candidate.id, action)}
                  />
                </div>
              </div>
            ))}
            <SettingsRow label={t('review.submitDecisions')} detail={t('review.submitDecisionsDetail')}>
              <button
                className="ghost-button"
                type="button"
                data-testid="review-submit-decisions"
                disabled={busy || hasPendingOnly}
                onClick={() => void handleSubmitDecisions()}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : null}
                {t('review.submitDecisions')}
              </button>
            </SettingsRow>
          </SettingsCard>

          {projection.approvedCandidateIds.length > 0 ? (
            <SettingsCard>
              <div className="settings-list-copy" data-testid="review-approved-ids">
                <strong>{t('review.approvedIdsHeading')}</strong>
                <span>{t('review.approvedIdsNote')}</span>
                <div className="settings-inline-group">
                  {projection.approvedCandidateIds.map((id) => (
                    <span key={id} className="settings-status-badge" data-testid={`review-approved-chip-${id}`}>
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            </SettingsCard>
          ) : null}

          {showHandoff ? (
            <SettingsCard>
              <div className="settings-list-copy" data-testid="review-handoff">
                <strong>{t('review.handoffHeading')}</strong>
                <span>{t('review.handoffNote')}</span>
              </div>
              {handoff!.intents.map((intent) => (
                <div
                  key={intent.candidateId}
                  className="settings-connector-row"
                  data-testid={`review-handoff-intent-${intent.candidateId}`}
                >
                  <div className="settings-connector-main">
                    <div className="settings-list-copy">
                      <strong>
                        {t(`review.kind.${intent.kind}`, { defaultValue: intent.kind })} · {intent.candidateId}
                      </strong>
                      <span>
                        {t('review.handoffTargetLabel')}:{' '}
                        {t(`review.handoffTarget.${intent.target}`, { defaultValue: intent.target })}
                      </span>
                      <span className="settings-status-badge" data-testid={`review-handoff-consent-${intent.candidateId}`}>
                        {t('review.handoffRequiresConsent')}
                      </span>
                      <span data-testid={`review-handoff-reason-${intent.candidateId}`}>{intent.reason}</span>
                      <span className="settings-status-badge" data-state="pending" aria-disabled="true">
                        {t(`review.handoffTargetLater.${intent.target}`, {
                          defaultValue: t('review.handoffTargetLater.none')
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {handoff!.unmappedCandidateIds.length > 0 ? (
                <div className="settings-list-copy" data-testid="review-handoff-unmapped">
                  <strong>{t('review.handoffUnmappedHeading')}</strong>
                  <span>{t('review.handoffUnmappedNote')}</span>
                  <div className="settings-inline-group">
                    {handoff!.unmappedCandidateIds.map((id) => (
                      <span key={id} className="settings-status-badge" data-testid={`review-handoff-unmapped-chip-${id}`}>
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </SettingsCard>
          ) : null}
        </>
      )}
    </SettingsPanel>
  )
}
