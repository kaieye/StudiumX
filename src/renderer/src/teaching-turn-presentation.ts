import type { LearningOutcomeCommitResult } from '../../shared/teaching-types/learning-outcome'
import type { LearningOutcomeKind, LearningSessionSource } from '../../shared/teaching-types/learning-session'
import type { NextTeachingStepAction, NextTeachingStepDecision, NextTeachingStepReason } from '../../shared/teaching-types/next-teaching-step'

export type TeachingTurnPhaseId =
  | 'confirm_goal'
  | 'retrieval_practice'
  | 'explanation_retry'
  | 'save_continue'

export type TeachingTurnPhaseState = 'upcoming' | 'active' | 'needs_you' | 'waiting'

export type TeachingTurnActionKind =
  | 'confirm_goal'
  | 'begin_retrieval_practice'
  | 'retry'
  | 'continue'
  | 'wait'

/**
 * Renderer-safe event contract. Event payloads deliberately carry identity and a
 * phase request only: prompts, answers, assessment content, and provider data
 * stay in the owning domain modules.
 */
export type TeachingTurnEvent = {
  id: string
  operationId: string
  revision: number
  kind:
    | 'goal_confirmation_requested'
    | 'retrieval_practice_requested'
    | 'explanation_retry_requested'
    | 'save_continue_requested'
}

/** The canonical committer snapshot is the sole authority for save wording. */
export type TeachingTurnCanonicalSaveStatus =
  | 'not_started'
  | 'writing'
  | 'record_saved'
  | 'catalog_reconciling'
  | 'unavailable'
  | 'failed'

export type TeachingTurnSnapshot = {
  operation: {
    id: string
    revision: number
  }
  session: {
    id: string
    source: LearningSessionSource
    readOnly: boolean
    status: 'active' | 'completed' | 'legacy_read_only'
    outcome: Pick<{ kind: LearningOutcomeKind }, 'kind'> | null
  }
  /** Planner output is consumed verbatim; this module never derives a next step. */
  nextStep: Pick<NextTeachingStepDecision, 'action' | 'reason' | 'safeInputSummary'> | null
  context: {
    readiness: 'ready' | 'pending' | 'unavailable'
  }
  save: {
    canonicalStatus: TeachingTurnCanonicalSaveStatus
    /** Read-only committer result, used only to identify the already-settled outcome. */
    commit: LearningOutcomeCommitResult | null
  }
  event: TeachingTurnEvent | null
  /** Opaque, trusted source identifiers only; path-like or hash-like values are dropped. */
  sourceIds: readonly string[]
}

export type TeachingTurnPhase = {
  id: TeachingTurnPhaseId
  title: string
  state: TeachingTurnPhaseState
  statusText: string
}

export type TeachingTurnAction = {
  kind: TeachingTurnActionKind
  label: string
}

export type TeachingTurnAnnouncement = {
  id: string
  politeness: 'polite'
  message: string
}

export type TeachingTurnTechnicalDiagnostic = {
  state: 'waiting' | 'active' | 'complete' | 'attention'
  label: string
}

export type TeachingTurnPresentation = {
  phases: readonly TeachingTurnPhase[]
  activePhaseId: TeachingTurnPhaseId
  action: TeachingTurnAction | null
  sourceIds: readonly string[]
  announcement: TeachingTurnAnnouncement | null
  /** A collapsed, generic status adapter; never carries raw process data. */
  technicalDiagnostic: TeachingTurnTechnicalDiagnostic
  /** Stable opaque identity for focus and announcement de-duplication. */
  focusKey: string
}

export type TeachingTurnAnnouncementConsumption = {
  announcement: TeachingTurnAnnouncement | null
  emittedIds: readonly string[]
}

const PHASES: ReadonlyArray<Pick<TeachingTurnPhase, 'id' | 'title'>> = [
  { id: 'confirm_goal', title: '确认学习目标' },
  { id: 'retrieval_practice', title: '完成检索练习' },
  { id: 'explanation_retry', title: '讲解并重试' },
  { id: 'save_continue', title: '保存并继续' }
]

/**
 * Pure, deterministic learner-facing projection. It accepts only compact typed
 * snapshots/events and never reads domain state, creates records, or evaluates
 * learner answers.
 */
export function buildTeachingTurnPresentation(snapshot: TeachingTurnSnapshot): TeachingTurnPresentation {
  const selection = selectPhase(snapshot)
  const sourceIds = safeSourceIds(snapshot.sourceIds)
  const focusKey = opaqueKey(snapshot.operation.id, snapshot.operation.revision, selection.phaseId, selection.state)
  const savedAnnouncement = selection.saved
    ? {
        id: opaqueKey('saved', snapshot.operation.id, snapshot.operation.revision),
        politeness: 'polite' as const,
        message: '本次学习进展已保存。你可以继续下一步。'
      }
    : null

  return {
    phases: PHASES.map((phase) => ({
      ...phase,
      state: phase.id === selection.phaseId ? selection.state : 'upcoming',
      statusText: phase.id === selection.phaseId ? selection.statusText : '尚未开始'
    })),
    activePhaseId: selection.phaseId,
    action: selection.action,
    sourceIds,
    announcement: savedAnnouncement,
    technicalDiagnostic: selection.diagnostic,
    focusKey
  }
}

/**
 * Lets the state-owning adapter suppress repeat announcements after replay or
 * restart. The emitted IDs are opaque and contain no operation or record data.
 */
export function consumeTeachingTurnAnnouncement(
  presentation: TeachingTurnPresentation,
  emittedIds: readonly string[]
): TeachingTurnAnnouncementConsumption {
  const announcement = presentation.announcement
  if (!announcement || emittedIds.includes(announcement.id)) {
    return { announcement: null, emittedIds: uniqueSorted(emittedIds) }
  }
  return {
    announcement,
    emittedIds: uniqueSorted([...emittedIds, announcement.id])
  }
}

type PhaseSelection = {
  phaseId: TeachingTurnPhaseId
  state: Extract<TeachingTurnPhaseState, 'active' | 'needs_you' | 'waiting'>
  statusText: string
  action: TeachingTurnAction | null
  saved: boolean
  diagnostic: TeachingTurnTechnicalDiagnostic
}

function selectPhase(snapshot: TeachingTurnSnapshot): PhaseSelection {
  if (isContextOrResourceUnavailable(snapshot)) {
    return waitingForReadiness(snapshot)
  }

  const outcome = settledOutcomeKind(snapshot)
  if (outcome === 'needs_practice' || snapshot.nextStep?.action === 'contrast_and_retry') {
    return needsRetry()
  }

  if (snapshot.save.canonicalStatus === 'catalog_reconciling') {
    return saving('正在确认保存')
  }

  if (outcome === 'misconception_corrected' || outcome === 'established') {
    return saveOutcomeSelection(snapshot)
  }

  switch (snapshot.event?.kind) {
    case 'retrieval_practice_requested':
      return {
        phaseId: 'retrieval_practice',
        state: 'needs_you',
        statusText: '轮到你完成检索练习',
        action: { kind: 'begin_retrieval_practice', label: '开始检索练习' },
        saved: false,
        diagnostic: { state: 'active', label: '学习流程正在等待你的回答' }
      }
    case 'explanation_retry_requested':
      return needsRetry()
    case 'save_continue_requested':
      return saving(saveStatusText(snapshot.save.canonicalStatus))
    case 'goal_confirmation_requested':
    default:
      return confirmGoal(snapshot.nextStep)
  }
}

function isContextOrResourceUnavailable(snapshot: TeachingTurnSnapshot): boolean {
  return snapshot.context.readiness !== 'ready' || snapshot.nextStep?.action === 'wait_for_resources'
}

function waitingForReadiness(snapshot: TeachingTurnSnapshot): PhaseSelection {
  const needsClarification = snapshot.context.readiness === 'unavailable' || snapshot.nextStep?.action === 'request_goal_clarification'
  return {
    phaseId: 'confirm_goal',
    state: 'waiting',
    statusText: needsClarification ? '等待可用的学习上下文或澄清目标' : '正在等待学习资源',
    action: { kind: 'wait', label: '等待可用资源' },
    saved: false,
    diagnostic: { state: 'waiting', label: '学习流程正在等待可信上下文或资源' }
  }
}

function needsRetry(): PhaseSelection {
  return {
    phaseId: 'explanation_retry',
    state: 'needs_you',
    statusText: '需要再练习一次',
    action: { kind: 'retry', label: '查看讲解并重试' },
    saved: false,
    diagnostic: { state: 'attention', label: '学习流程已安排对比讲解和重试' }
  }
}

function saveOutcomeSelection(snapshot: TeachingTurnSnapshot): PhaseSelection {
  if (snapshot.save.canonicalStatus === 'record_saved') {
    return {
      phaseId: 'save_continue',
      state: 'needs_you',
      statusText: '学习进展已保存，可以继续',
      action: { kind: 'continue', label: '继续下一步' },
      saved: true,
      diagnostic: { state: 'complete', label: '学习记录已由规范保存状态确认' }
    }
  }
  return saving(saveStatusText(snapshot.save.canonicalStatus))
}

function saving(statusText: string): PhaseSelection {
  return {
    phaseId: 'save_continue',
    state: 'active',
    statusText,
    action: null,
    saved: false,
    diagnostic: { state: 'active', label: '学习流程正在等待规范保存状态' }
  }
}

function confirmGoal(nextStep: TeachingTurnSnapshot['nextStep']): PhaseSelection {
  if (nextStep?.action === 'request_goal_clarification') {
    return {
      phaseId: 'confirm_goal',
      state: 'needs_you',
      statusText: '请确认本次学习目标',
      action: { kind: 'confirm_goal', label: '确认学习目标' },
      saved: false,
      diagnostic: { state: 'waiting', label: '学习流程正在等待目标确认' }
    }
  }
  return {
    phaseId: 'confirm_goal',
    state: 'waiting',
    statusText: '正在准备下一步学习',
    action: { kind: 'wait', label: '等待下一步' },
    saved: false,
    diagnostic: { state: 'waiting', label: '学习流程正在等待已确认的下一步' }
  }
}

function settledOutcomeKind(snapshot: TeachingTurnSnapshot): LearningOutcomeKind | null {
  const committed = snapshot.save.commit
  if (committed?.status === 'committed' || committed?.status === 'already_committed') return committed.outcome.kind
  return snapshot.session.outcome?.kind ?? null
}

function saveStatusText(status: TeachingTurnCanonicalSaveStatus): string {
  switch (status) {
    case 'writing':
      return '正在保存学习进展'
    case 'catalog_reconciling':
      return '正在确认保存'
    case 'unavailable':
      return '保存状态暂时不可用，正在等待确认'
    case 'failed':
      return '保存尚未确认，正在等待安全重试'
    case 'record_saved':
      return '学习进展已保存，可以继续'
    case 'not_started':
    default:
      return '等待学习进展保存'
  }
}

function safeSourceIds(ids: readonly string[]): readonly string[] {
  return uniqueSorted(ids.filter((id) => isSafeSourceId(id)))
}

function isSafeSourceId(value: string): boolean {
  return value.length > 0 && value.length <= 80 &&
    /^[A-Za-z0-9._:-]+$/.test(value) &&
    !/^(?:[a-f0-9]{64}|sha(?:256)?[-_:])/i.test(value) &&
    !/(?:secret|token|password|answer|prompt|provider|key)/i.test(value)
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

function opaqueKey(...parts: Array<string | number>): string {
  let hash = 0x811c9dc5
  for (const part of parts) {
    const value = String(part)
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return `teaching-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export type { NextTeachingStepAction, NextTeachingStepReason }