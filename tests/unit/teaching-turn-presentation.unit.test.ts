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
    await user.tab()
    expect(screen.getByText('来源摘要')).toBeVisible()
    expect(screen.queryByRole('log')).toBeNull()
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
    expect(screen.getByText('规划中')).toBeVisible()
    expect(screen.getByText('思考过程')).toBeVisible()
    expect(screen.getByText('调用工具：search_notes')).toBeVisible()
    expect(screen.getByText('正在准备回复')).toBeVisible()
    expect(screen.queryByText('{"query":"momentum"}')).toBeNull()
    expect(screen.queryByText('查看工具参数')).toBeNull()
  })

})