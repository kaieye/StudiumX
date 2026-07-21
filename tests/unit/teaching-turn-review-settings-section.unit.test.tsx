import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import {
  createDemoTeachingTurnReviewBundle,
  TeachingTurnReviewSettingsSection
} from '../../src/renderer/src/views/settings/sections/TeachingTurnReviewSettingsSection'
import type { TeachingTurnReviewApprovalProjection } from '../../src/shared/teaching-turn-review-approve'
import type { TeachingTurnReviewLastBundleSnapshot } from '../../src/shared/teaching-turn-review-last-bundle'
import { fireEvent, renderUi, screen, waitFor } from '../helpers/render'

const DEMO_FIXED = '2026-07-21T12:00:00.000Z'

function projectionFromBundle(
  decisionById: Record<string, 'approve' | 'reject' | 'defer' | 'pending'> = {},
  options?: { includeUnknownKind?: boolean }
): TeachingTurnReviewApprovalProjection {
  const bundle = createDemoTeachingTurnReviewBundle(DEMO_FIXED)
  const approvedCandidateIds: string[] = []
  const rejectedCandidateIds: string[] = []
  const deferredCandidateIds: string[] = []
  const candidates = bundle.candidates.map((candidate) => {
    const decision = decisionById[candidate.id] ?? 'pending'
    if (decision === 'approve') approvedCandidateIds.push(candidate.id)
    if (decision === 'reject') rejectedCandidateIds.push(candidate.id)
    if (decision === 'defer') deferredCandidateIds.push(candidate.id)
    return {
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      requiresHumanApproval: true as const,
      decision
    }
  })

  if (options?.includeUnknownKind) {
    const unknownId = 'review:unknown_kind:v1'
    approvedCandidateIds.push(unknownId)
    candidates.push({
      id: unknownId,
      kind: 'other',
      title: 'Unknown kind',
      summary: 'Fail-closed unknown kind for unmapped handoff display.',
      requiresHumanApproval: true as const,
      decision: 'approve'
    })
  }

  return {
    turnId: bundle.turnId,
    generatedAt: bundle.generatedAt,
    candidates,
    approvedCandidateIds,
    rejectedCandidateIds,
    deferredCandidateIds
  }
}

function sampleSnapshot(
  overrides?: Partial<TeachingTurnReviewLastBundleSnapshot>
): TeachingTurnReviewLastBundleSnapshot {
  const bundle = createDemoTeachingTurnReviewBundle(DEMO_FIXED)
  return {
    version: 1,
    savedAt: '2026-07-21T13:00:00.000Z',
    source: 'settings_demo',
    bundle,
    decision: {
      turnId: bundle.turnId,
      decidedAt: '2026-07-21T12:30:00.000Z',
      decisions: [{ candidateId: 'review:lesson_gap:v1', action: 'approve' }]
    },
    ...overrides
  }
}

function stubTeachingSystem(api: {
  projectTeachingTurnReview: ReturnType<typeof vi.fn>
  decideTeachingTurnReview: ReturnType<typeof vi.fn>
  getTeachingTurnReviewLastBundle?: ReturnType<typeof vi.fn>
  saveTeachingTurnReviewLastBundle?: ReturnType<typeof vi.fn>
}): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    value: api
  })
}

describe('TeachingTurnReviewSettingsSection', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('shows empty/help state before projection', () => {
    renderUi(<TeachingTurnReviewSettingsSection />)
    expect(screen.getByTestId('review-empty-state')).toBeInTheDocument()
    expect(screen.getByTestId('review-advisory')).toHaveTextContent(/Never auto-apply/i)
  })

  it('projects demo candidates via projectTeachingTurnReview', async () => {
    const projectTeachingTurnReview = vi.fn(async () => ({
      ok: true as const,
      projection: projectionFromBundle()
    }))
    const decideTeachingTurnReview = vi.fn()
    stubTeachingSystem({ projectTeachingTurnReview, decideTeachingTurnReview })

    renderUi(<TeachingTurnReviewSettingsSection />)
    fireEvent.click(screen.getByTestId('review-demo-project'))

    await waitFor(() => {
      expect(projectTeachingTurnReview).toHaveBeenCalledTimes(1)
    })

    const payload = projectTeachingTurnReview.mock.calls[0]?.[0] as {
      bundle: { candidates: Array<{ requiresHumanApproval: boolean; kind: string }> }
    }
    expect(payload.bundle.candidates).toHaveLength(3)
    expect(payload.bundle.candidates.every((c) => c.requiresHumanApproval === true)).toBe(true)
    expect(payload.bundle.candidates.some((c) => c.kind === 'lesson_gap')).toBe(true)
    expect(payload.bundle.candidates.some((c) => c.kind === 'memory_candidate')).toBe(true)

    await waitFor(() => {
      expect(screen.getByTestId('review-candidate-review:lesson_gap:v1')).toBeInTheDocument()
      expect(screen.getByTestId('review-candidate-review:skill_pack_hint:v1')).toBeInTheDocument()
      expect(screen.getByTestId('review-candidate-review:memory_candidate:v1')).toBeInTheDocument()
    })
    expect(screen.getByText('Possible lesson gap')).toBeInTheDocument()
    expect(screen.getByTestId('review-requires-review:lesson_gap:v1')).toHaveTextContent(
      /Requires human approval/i
    )
    expect(screen.queryByTestId('review-empty-state')).not.toBeInTheDocument()
    // Pending projection has no approved handoff intents
    expect(screen.queryByTestId('review-handoff')).not.toBeInTheDocument()
  })

  it('submits local decisions via decideTeachingTurnReview and shows approved id chips (not apply plan)', async () => {
    const projectTeachingTurnReview = vi.fn(async () => ({
      ok: true as const,
      projection: projectionFromBundle()
    }))
    const decideTeachingTurnReview = vi.fn(async () => ({
      ok: true as const,
      projection: projectionFromBundle({
        'review:lesson_gap:v1': 'approve',
        'review:skill_pack_hint:v1': 'reject',
        'review:memory_candidate:v1': 'approve'
      })
    }))
    stubTeachingSystem({ projectTeachingTurnReview, decideTeachingTurnReview })

    renderUi(<TeachingTurnReviewSettingsSection />)
    fireEvent.click(screen.getByTestId('review-demo-project'))
    await waitFor(() =>
      expect(screen.getByTestId('review-candidate-review:lesson_gap:v1')).toBeInTheDocument()
    )

    const pendingTriggers = screen
      .getAllByRole('button')
      .filter((btn) => (btn.textContent ?? '').includes('Pending'))
    expect(pendingTriggers.length).toBeGreaterThan(0)
    fireEvent.click(pendingTriggers[0]!)

    const approveOptions = await screen.findAllByRole('option', { name: /^Approve$/i })
    fireEvent.click(approveOptions[0]!)

    fireEvent.click(screen.getByTestId('review-submit-decisions'))
    await waitFor(() => {
      expect(decideTeachingTurnReview).toHaveBeenCalledTimes(1)
    })

    const decidePayload = decideTeachingTurnReview.mock.calls[0]?.[0] as {
      decision: { decisions: Array<{ action: string; candidateId: string }> }
      autoApply?: unknown
    }
    expect(decidePayload.decision.decisions.some((d) => d.action === 'approve')).toBe(true)
    expect(decidePayload).not.toHaveProperty('autoApply')

    await waitFor(() => {
      expect(screen.getByTestId('review-approved-ids')).toBeInTheDocument()
      expect(screen.getByTestId('review-approved-chip-review:lesson_gap:v1')).toHaveTextContent(
        'review:lesson_gap:v1'
      )
    })
    expect(screen.getByTestId('review-approved-ids')).toHaveTextContent(/not an apply plan/i)

    // Pure client-side handoff intents for approved mapped kinds
    await waitFor(() => {
      expect(screen.getByTestId('review-handoff')).toBeInTheDocument()
      expect(screen.getByTestId('review-handoff-intent-review:lesson_gap:v1')).toBeInTheDocument()
      expect(screen.getByTestId('review-handoff-intent-review:memory_candidate:v1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('review-handoff-intent-review:lesson_gap:v1')).toHaveTextContent(
      /Lesson follow-up/i
    )
    expect(screen.getByTestId('review-handoff-intent-review:memory_candidate:v1')).toHaveTextContent(
      /Memory consent/i
    )
    expect(screen.getByTestId('review-handoff-consent-review:lesson_gap:v1')).toHaveTextContent(
      /Requires product consent later/i
    )
    expect(screen.queryByTestId('review-handoff-intent-review:skill_pack_hint:v1')).not.toBeInTheDocument()
    // No Apply control for handoff
    expect(screen.queryByRole('button', { name: /^Apply$/i })).not.toBeInTheDocument()
    expect(screen.getByTestId('review-handoff')).toHaveTextContent(/Not an apply plan/i)
    expect(screen.getByTestId('review-handoff')).toHaveTextContent(/never auto-apply/i)
  })

  it('renders unmapped approved ids when unknown kind is approved', async () => {
    const projectTeachingTurnReview = vi.fn(async () => ({
      ok: true as const,
      projection: projectionFromBundle()
    }))
    const decideTeachingTurnReview = vi.fn(async () => ({
      ok: true as const,
      projection: projectionFromBundle(
        {
          'review:lesson_gap:v1': 'approve'
        },
        { includeUnknownKind: true }
      )
    }))
    stubTeachingSystem({ projectTeachingTurnReview, decideTeachingTurnReview })

    renderUi(<TeachingTurnReviewSettingsSection />)
    fireEvent.click(screen.getByTestId('review-demo-project'))
    await waitFor(() =>
      expect(screen.getByTestId('review-candidate-review:lesson_gap:v1')).toBeInTheDocument()
    )

    const pendingTriggers = screen
      .getAllByRole('button')
      .filter((btn) => (btn.textContent ?? '').includes('Pending'))
    fireEvent.click(pendingTriggers[0]!)
    const approveOptions = await screen.findAllByRole('option', { name: /^Approve$/i })
    fireEvent.click(approveOptions[0]!)
    fireEvent.click(screen.getByTestId('review-submit-decisions'))

    await waitFor(() => {
      expect(screen.getByTestId('review-handoff')).toBeInTheDocument()
      expect(screen.getByTestId('review-handoff-intent-review:lesson_gap:v1')).toBeInTheDocument()
      expect(screen.getByTestId('review-handoff-unmapped')).toBeInTheDocument()
      expect(screen.getByTestId('review-handoff-unmapped-chip-review:unknown_kind:v1')).toHaveTextContent(
        'review:unknown_kind:v1'
      )
    })
    expect(screen.queryByRole('button', { name: /^Apply$/i })).not.toBeInTheDocument()
  })

  it('loads last durable bundle via get IPC then projects (never auto-apply)', async () => {
    const snapshot = sampleSnapshot()
    const getTeachingTurnReviewLastBundle = vi.fn(async () => ({
      ok: true as const,
      snapshot
    }))
    const projectTeachingTurnReview = vi.fn(async () => ({
      ok: true as const,
      projection: projectionFromBundle({
        'review:lesson_gap:v1': 'approve'
      })
    }))
    const decideTeachingTurnReview = vi.fn()
    const saveTeachingTurnReviewLastBundle = vi.fn()
    stubTeachingSystem({
      projectTeachingTurnReview,
      decideTeachingTurnReview,
      getTeachingTurnReviewLastBundle,
      saveTeachingTurnReviewLastBundle
    })

    renderUi(<TeachingTurnReviewSettingsSection />)
    fireEvent.click(screen.getByTestId('review-load-last'))

    await waitFor(() => {
      expect(getTeachingTurnReviewLastBundle).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(projectTeachingTurnReview).toHaveBeenCalledTimes(1)
    })

    const projectPayload = projectTeachingTurnReview.mock.calls[0]?.[0] as {
      bundle: { turnId: string; candidates: Array<{ requiresHumanApproval: boolean }> }
      decision?: { decisions: Array<{ action: string }> }
      autoApply?: unknown
    }
    expect(projectPayload.bundle.turnId).toBe(snapshot.bundle.turnId)
    expect(projectPayload.bundle.candidates.every((c) => c.requiresHumanApproval === true)).toBe(true)
    expect(projectPayload.decision?.decisions[0]?.action).toBe('approve')
    expect(projectPayload).not.toHaveProperty('autoApply')

    await waitFor(() => {
      expect(screen.getByTestId('review-candidate-review:lesson_gap:v1')).toBeInTheDocument()
      expect(screen.getByTestId('review-last-bundle-status')).toHaveTextContent(/Projected only/i)
    })
    // Load path must not call save or invent an Apply control
    expect(saveTeachingTurnReviewLastBundle).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Apply$/i })).not.toBeInTheDocument()
  })

  it('shows empty status when last durable snapshot is missing', async () => {
    const getTeachingTurnReviewLastBundle = vi.fn(async () => ({
      ok: true as const,
      snapshot: null
    }))
    const projectTeachingTurnReview = vi.fn()
    stubTeachingSystem({
      projectTeachingTurnReview,
      decideTeachingTurnReview: vi.fn(),
      getTeachingTurnReviewLastBundle
    })

    renderUi(<TeachingTurnReviewSettingsSection />)
    fireEvent.click(screen.getByTestId('review-load-last'))

    await waitFor(() => {
      expect(screen.getByTestId('review-last-bundle-status')).toHaveTextContent(
        /No durable last-bundle snapshot/i
      )
    })
    expect(projectTeachingTurnReview).not.toHaveBeenCalled()
    expect(screen.getByTestId('review-empty-state')).toBeInTheDocument()
  })

  it('saves current local bundle as last durable snapshot with settings_demo source', async () => {
    const projectTeachingTurnReview = vi.fn(async () => ({
      ok: true as const,
      projection: projectionFromBundle()
    }))
    const saveTeachingTurnReviewLastBundle = vi.fn(async () => ({ ok: true as const }))
    stubTeachingSystem({
      projectTeachingTurnReview,
      decideTeachingTurnReview: vi.fn(),
      getTeachingTurnReviewLastBundle: vi.fn(),
      saveTeachingTurnReviewLastBundle
    })

    renderUi(<TeachingTurnReviewSettingsSection />)
    expect(screen.getByTestId('review-save-last')).toBeDisabled()

    fireEvent.click(screen.getByTestId('review-demo-project'))
    await waitFor(() =>
      expect(screen.getByTestId('review-candidate-review:lesson_gap:v1')).toBeInTheDocument()
    )

    fireEvent.click(screen.getByTestId('review-save-last'))
    await waitFor(() => {
      expect(saveTeachingTurnReviewLastBundle).toHaveBeenCalledTimes(1)
    })

    const savePayload = saveTeachingTurnReviewLastBundle.mock.calls[0]?.[0] as {
      bundle: { candidates: Array<{ requiresHumanApproval: boolean }> }
      source: string
      decision?: unknown
      autoApply?: unknown
    }
    expect(savePayload.source).toBe('settings_demo')
    expect(savePayload.bundle.candidates.every((c) => c.requiresHumanApproval === true)).toBe(true)
    expect(savePayload).not.toHaveProperty('autoApply')
    expect(savePayload).not.toHaveProperty('applyPlan')

    await waitFor(() => {
      expect(screen.getByTestId('review-last-bundle-status')).toHaveTextContent(/settings_demo/i)
      expect(screen.getByTestId('review-last-bundle-status')).toHaveTextContent(/Not applied/i)
    })
    expect(screen.queryByRole('button', { name: /^Apply$/i })).not.toBeInTheDocument()
  })

  it('createDemoTeachingTurnReviewBundle stays human-gated and payload-safe', () => {
    const bundle = createDemoTeachingTurnReviewBundle(DEMO_FIXED)
    expect(bundle.candidates).toHaveLength(3)
    const kinds = bundle.candidates.map((c) => c.kind).sort()
    expect(kinds).toEqual(['lesson_gap', 'memory_candidate', 'skill_pack_hint'])
    for (const candidate of bundle.candidates) {
      expect(candidate.requiresHumanApproval).toBe(true)
      expect(candidate).not.toHaveProperty('applyPlan')
      expect(JSON.stringify(candidate.payload ?? {})).not.toMatch(
        /autoApply|applyPlan|skillFileContent|writePath/
      )
    }
  })
})
