import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { setupUser, renderUi, screen, waitFor } from '../helpers/render'
import { AgentConversationReader } from '../../src/renderer/src/views/agent-conversation/AgentConversationReader'
import {
  buildTeachingTurnPresentation,
  consumeTeachingTurnAnnouncement,
  type TeachingTurnSnapshot
} from '../../src/renderer/src/teaching-turn-presentation'

const decision = (action: TeachingTurnSnapshot['nextStep']['action'], reason: TeachingTurnSnapshot['nextStep']['reason']) => ({
  schemaVersion: 1 as const,
  action,
  reason,
  safeInputSummary: {
    missionId: 'mission-1',
    courseId: 'course-1',
    latestSession: { id: 'session-1', source: 'canonical' as const, readOnly: false },
    durableOutcome: { status: 'trusted' as const, id: 'outcome-1', kind: 'misconception_corrected' as const },
    evidence: { status: 'verified' as const },
    resources: { readiness: 'ready' as const, availableCount: 1 },
    provenance: { outcomeEvidenceEventIds: ['event-1'], resourceIds: ['source-1'] }
  }
})

function snapshot(overrides: Partial<TeachingTurnSnapshot> = {}): TeachingTurnSnapshot {
  return {
    operation: { id: 'operation-1', revision: 1 },
    session: { id: 'session-1', source: 'canonical', readOnly: false, status: 'active', outcome: null },
    nextStep: decision('request_goal_clarification', 'no_next_goal'),
    context: { readiness: 'ready' },
    save: { canonicalStatus: 'not_started', commit: null },
    event: { id: 'event-1', operationId: 'operation-1', revision: 1, kind: 'goal_confirmation_requested' },
    sourceIds: ['source-1'],
    ...overrides
  }
}

describe('TeachingTurnPresentation', () => {
  it('projects each typed learner event into exactly one of the four learner phases', () => {
    const cases: Array<[TeachingTurnSnapshot['event'], string]> = [
      [{ id: 'goal', operationId: 'operation-1', revision: 1, kind: 'goal_confirmation_requested' }, 'confirm_goal'],
      [{ id: 'retrieve', operationId: 'operation-1', revision: 1, kind: 'retrieval_practice_requested' }, 'retrieval_practice'],
      [{ id: 'retry', operationId: 'operation-1', revision: 1, kind: 'explanation_retry_requested' }, 'explanation_retry'],
      [{ id: 'save', operationId: 'operation-1', revision: 1, kind: 'save_continue_requested' }, 'save_continue']
    ]

    for (const [event, activePhase] of cases) {
      const presentation = buildTeachingTurnPresentation(snapshot({ event }))
      expect(presentation.phases).toHaveLength(4)
      expect(presentation.phases.filter((phase) => phase.state === 'active' || phase.state === 'needs_you')).toHaveLength(1)
      expect(presentation.activePhaseId).toBe(activePhase)
    }
  })

  it('publishes stable accessible names for the learner region, active status, and trusted source list', () => {
    const presentation = buildTeachingTurnPresentation(snapshot({
      nextStep: decision('contrast_and_retry', 'needs_practice'),
      session: { id: 'session-1', source: 'canonical', readOnly: false, status: 'active', outcome: { kind: 'needs_practice' } }
    }))

    expect(presentation.accessibleNames).toEqual({
      region: '学习流程',
      phaseList: '学习流程阶段',
      currentPhase: '当前阶段：讲解并重试。需要再练习一次',
      sourceList: '可信来源标识'
    })
  })

  it('keeps needs_practice in retry and gates corrected success on canonical record confirmation', () => {
    const retry = buildTeachingTurnPresentation(snapshot({
      nextStep: decision('contrast_and_retry', 'needs_practice'),
      save: { canonicalStatus: 'record_saved', commit: { status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false } }
    }))
    expect(retry.activePhaseId).toBe('explanation_retry')
    expect(JSON.stringify(retry)).not.toContain('已掌握')
    expect(JSON.stringify(retry)).not.toContain('已保存')

    const awaitingRecord = buildTeachingTurnPresentation(snapshot({
      nextStep: decision('continue_next_session', 'misconception_corrected_with_next_goal'),
      save: { canonicalStatus: 'writing', commit: { status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true } }
    }))
    expect(awaitingRecord.activePhaseId).toBe('save_continue')
    expect(awaitingRecord.announcement).toBeNull()

    const saved = buildTeachingTurnPresentation(snapshot({
      nextStep: decision('continue_next_session', 'misconception_corrected_with_next_goal'),
      save: { canonicalStatus: 'record_saved', commit: { status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true } }
    }))
    expect(saved.activePhaseId).toBe('save_continue')
    expect(saved.announcement?.message).toContain('已保存')
  })

  it('treats catalog reconciliation as confirmation in progress instead of another saved claim', () => {
    const presentation = buildTeachingTurnPresentation(snapshot({
      nextStep: decision('continue_next_session', 'misconception_corrected_with_next_goal'),
      save: { canonicalStatus: 'catalog_reconciling', commit: { status: 'already_committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true } }
    }))

    expect(presentation.activePhaseId).toBe('save_continue')
    expect(presentation.phases.find((phase) => phase.id === 'save_continue')).toMatchObject({ state: 'active', statusText: '正在确认保存' })
    expect(presentation.announcement).toBeNull()
    expect(JSON.stringify(presentation)).not.toContain('已保存')
  })

  it('downgrades unavailable context or resources to a conservative wait without a continue action', () => {
    const presentation = buildTeachingTurnPresentation(snapshot({
      nextStep: decision('continue_next_session', 'misconception_corrected_with_next_goal'),
      context: { readiness: 'unavailable' },
      save: { canonicalStatus: 'record_saved', commit: { status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true } }
    }))

    expect(presentation.activePhaseId).toBe('confirm_goal')
    expect(presentation.action?.kind).toBe('wait')
    expect(presentation.action?.kind).not.toBe('continue')
  })

  it('allow-lists only learner-safe identifiers and never projects raw teaching or technical payloads', () => {
    const rawPrompt = 'RAW-PROMPT-DO-NOT-SHOW'
    const rawAnswer = 'RAW-ANSWER-DO-NOT-SHOW'
    const chainOfThought = 'CHAIN-OF-THOUGHT-DO-NOT-SHOW'
    const secret = 'sk-secret-do-not-show'
    const path = 'C:\\private\\answer-key.md'
    const hash = 'a'.repeat(64)
    const presentation = buildTeachingTurnPresentation({
      ...snapshot(),
      event: {
        id: 'safe-event', operationId: 'operation-1', revision: 1, kind: 'retrieval_practice_requested',
        ...({ prompt: rawPrompt, answer: rawAnswer, reasoning: chainOfThought, provider: secret, path, hash } as object)
      } as TeachingTurnSnapshot['event'],
      sourceIds: ['source-1', path, hash, secret]
    })
    const serialized = JSON.stringify(presentation)

    for (const forbidden of [rawPrompt, rawAnswer, chainOfThought, secret, path, hash, 'answer-key', 'provider']) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(serialized).toContain('source-1')
  })

  it('is deterministic across replay and emits a saved announcement only once per operation revision', () => {
    const input = snapshot({
      nextStep: decision('continue_next_session', 'misconception_corrected_with_next_goal'),
      save: { canonicalStatus: 'record_saved', commit: { status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true } }
    })
    const first = buildTeachingTurnPresentation(input)
    const replay = buildTeachingTurnPresentation(structuredClone(input))
    expect(replay).toEqual(first)

    const announced = consumeTeachingTurnAnnouncement(first, [])
    expect(announced.announcement).toEqual(first.announcement)
    const restarted = consumeTeachingTurnAnnouncement(replay, announced.emittedIds)
    expect(restarted.announcement).toBeNull()
    expect(restarted.emittedIds).toEqual(announced.emittedIds)
  })

  it('supports keyboard focus, actions, source disclosure, and a restrained live status in the reader', async () => {
    const presentation = buildTeachingTurnPresentation(snapshot({
      event: { id: 'retrieve', operationId: 'operation-1', revision: 1, kind: 'retrieval_practice_requested' }
    }))
    const calls: string[] = []
    const user = setupUser()
    renderUi(createElement(AgentConversationReader, {
      presentation: undefined,
      teachingPresentation: presentation,
      onTeachingAction: (action) => calls.push(action.kind)
    }))

    const action = screen.getByRole('button', { name: '开始检索练习' })
    await waitFor(() => expect(action).toHaveFocus())
    await user.keyboard('{Enter}')
    expect(calls).toEqual(['begin_retrieval_practice'])
    expect(screen.getByRole('status', { name: '当前阶段：完成检索练习。轮到你完成检索练习' })).toBeVisible()
    expect(document.querySelector('.teaching-turn-panel__your-turn')).toHaveAttribute('data-phase-state', 'needs_you')
    expect(document.querySelector('.teaching-turn-panel.is-your-turn')).toBeTruthy()
    const sourceDisclosure = screen.getByText('来源摘要')
    await user.click(sourceDisclosure)
    expect(screen.getByRole('list', { name: '可信来源标识' })).toHaveTextContent('来源 source-1')
    expect(screen.queryByRole('log')).toBeNull()

    const diagnosticSummary = screen.getByText('技术诊断', { selector: 'summary' })
    diagnosticSummary.focus()
    expect(diagnosticSummary).toHaveFocus()
    await user.click(diagnosticSummary)
    expect((document.querySelector('.teaching-turn-panel__diagnostic') as HTMLDetailsElement).open).toBe(true)
  })


  it('renders a collapsed-by-default technical diagnostic from the typed presentation adapter only', async () => {
    const presentation = buildTeachingTurnPresentation(snapshot({
      event: { id: 'retrieve', operationId: 'operation-1', revision: 1, kind: 'retrieval_practice_requested' }
    }))
    const user = setupUser()
    renderUi(createElement(AgentConversationReader, {
      presentation: undefined,
      teachingPresentation: presentation
    }))

    const diagnostic = document.querySelector('.teaching-turn-panel__diagnostic') as HTMLDetailsElement
    expect(diagnostic).toBeTruthy()
    expect(diagnostic.open).toBe(false)
    expect(diagnostic).not.toHaveAttribute('open')

    const summary = screen.getByText('技术诊断', { selector: 'summary' })
    expect(summary).toHaveAttribute('aria-label', `技术诊断：${presentation.technicalDiagnostic.label}`)

    summary.focus()
    expect(summary).toHaveFocus()
    await user.click(summary)
    expect(diagnostic.open).toBe(true)
    expect(screen.getByText(presentation.technicalDiagnostic.label)).toBeVisible()
    expect(diagnostic.querySelector('[data-diagnostic-state]')?.getAttribute('data-diagnostic-state')).toBe(presentation.technicalDiagnostic.state)
  })

  it('does not leak secrets, learner answers, absolute paths, or provider payloads through the diagnostic disclosure', async () => {
    const presentation = buildTeachingTurnPresentation({
      ...snapshot({
        event: { id: 'retry', operationId: 'operation-1', revision: 1, kind: 'explanation_retry_requested' }
      }),
      sourceIds: ['source-1', 'secret-token-not-rendered', 'raw-private-answer', 'C:\\private\\answer-key.md', 'a'.repeat(64)]
    })
    const user = setupUser()
    const { container } = renderUi(createElement(AgentConversationReader, {
      presentation: undefined,
      teachingPresentation: presentation
    }))

    const diagnostic = container.querySelector('.teaching-turn-panel__diagnostic') as HTMLDetailsElement
    await user.click(diagnostic.querySelector('summary')!)
    expect(diagnostic.open).toBe(true)

    const rendered = container.textContent ?? ''
    for (const forbidden of [
      'secret-token-not-rendered',
      'raw-private-answer',
      'C:\\private\\answer-key.md',
      'answer-key',
      'a'.repeat(64),
      'RAW-PROMPT',
      'RAW-ANSWER',
      'sk-secret'
    ]) {
      expect(rendered).not.toContain(forbidden)
    }
    expect(rendered).toContain(presentation.technicalDiagnostic.label)
    expect(JSON.stringify(presentation)).not.toContain('secret-token-not-rendered')
  })

  it('keeps deterministic accessible names and diagnostic wording across replay', () => {
    const input = snapshot({
      event: { id: 'save', operationId: 'operation-1', revision: 3, kind: 'save_continue_requested' },
      nextStep: decision('continue_next_session', 'misconception_corrected_with_next_goal'),
      save: { canonicalStatus: 'record_saved', commit: { status: 'committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true } }
    })
    const first = buildTeachingTurnPresentation(input)
    const replay = buildTeachingTurnPresentation(structuredClone(input))
    expect(replay.accessibleNames).toEqual(first.accessibleNames)
    expect(replay.technicalDiagnostic).toEqual(first.technicalDiagnostic)
    expect(replay.focusKey).toEqual(first.focusKey)
  })
  it('renders live reasoning, tool activity, and preparation status in the process panel', () => {
    renderUi(createElement(AgentConversationReader, {
      presentation: {
        turnId: 'assistant-1', active: true, answeredAsks: [],
        items: [
          { id: 'reasoning', kind: 'reasoning', label: '思考过程', detail: '正在检查可信资料', state: 'active' },
          { id: 'tool', kind: 'tool_call', label: '调用工具：search_notes', state: 'complete' },
          { id: 'answering', kind: 'status', label: '正在准备回复', state: 'active' }
        ]
      }
    }))

    expect(screen.getByRole('region', { name: 'AI 处理过程' })).toBeVisible()
    expect(screen.getByText('思考中')).toBeVisible()
    expect(screen.getByText('进行中')).toBeVisible()
    expect(screen.getByText('思考过程')).toBeVisible()
    expect(screen.getByText('调用工具：search_notes')).toBeVisible()
    expect(screen.getByText('正在准备回复')).toBeVisible()
    expect(screen.queryByText('{"query":"momentum"}')).toBeNull()
    expect(screen.queryByText('查看工具参数')).toBeNull()
  })

})
describe('authoritative teaching presentation snapshot adapter', () => {
  it('renders the host-projected contrast-and-retry action without deriving planner reasons in the renderer', async () => {
    const { buildTeachingTurnPresentationFromSnapshot } = await import('../../src/renderer/src/teaching-turn-presentation')
    const presentation = buildTeachingTurnPresentationFromSnapshot({
      schemaVersion: 1,
      operationId: 'a'.repeat(64),
      revision: 7,
      nextStep: {
        action: 'contrast_and_retry',
        label: '对照后再试一次',
        description: '先比较关键差异，再用新的提示重试。'
      }
    })
    expect(presentation).toMatchObject({
      activePhaseId: 'explanation_retry',
      action: { kind: 'retry', label: '对照后再试一次' }
    })
    const calls: string[] = []
    renderUi(createElement(AgentConversationReader, {
      presentation: undefined,
      teachingPresentation: presentation,
      onTeachingAction: (action) => calls.push(action.kind)
    }))
    await setupUser().click(screen.getByRole('button', { name: '对照后再试一次' }))
    expect(calls).toEqual(['retry'])
    expect(JSON.stringify(presentation)).not.toMatch(/prompt|reason|path|token|secret/i)
  })

  it('renders the host-projected due-review action without item details or renderer-derived review state', async () => {
    const { buildTeachingTurnPresentationFromSnapshot } = await import('../../src/renderer/src/teaching-turn-presentation')
    const presentation = buildTeachingTurnPresentationFromSnapshot({
      schemaVersion: 1,
      operationId: 'b'.repeat(64),
      revision: 8,
      nextStep: {
        action: 'review_due',
        label: '开始复习',
        description: '先完成一项到期复习，再继续新的学习内容。'
      }
    })
    expect(presentation).toMatchObject({
      activePhaseId: 'retrieval_practice',
      action: { kind: 'review_due', label: '开始复习' }
    })
    const calls: string[] = []
    renderUi(createElement(AgentConversationReader, {
      presentation: undefined,
      teachingPresentation: presentation,
      onTeachingAction: (action) => calls.push(action.kind)
    }))
    await setupUser().click(screen.getByRole('button', { name: '开始复习' }))
    expect(calls).toEqual(['review_due'])
    expect(JSON.stringify(presentation)).not.toMatch(/itemId|lessonId|path|prompt|reason|token|secret/i)
  })
})
