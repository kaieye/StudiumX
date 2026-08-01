import { useEffect, useRef, useState } from 'react'
import { formatStudySeatLabel, randomStudySpaceCode } from '../domain'
import {
  isDefaultStudyTaskSeed,
  persistStudySnapshot,
  readStudySnapshot,
  syncStudyLocation
} from './session-snapshot'
import type {
  StudyRoomEventKind,
  StudyRoomId,
  StudySnapshot,
  StudyTaskCategoryId,
  StudyTaskScheduleInput,
  StudyTaskUpdateInput,
  StudyTimerMode,
  StudyTimerPlanInput
} from '../types'
import { useStudyPresence } from '../useStudyPresence'
import { createStudySpaceViewModel } from '../viewModel'
import { STUDY_TASKS_CHANGED_EVENT } from '../assistantTodo'
import {
  listStudyTaskCategories,
  readStudyTaskCategories,
  resolveStudyTaskCategory,
  persistStudyTaskCategories
} from '../taskCategories'
import { appendStudyAnalyticsFacts, createStudyAnalyticsFactId } from '../../views/workbench/analytics/domain/activityLedger'
import { getLocalDateKey, resolvedLocalTimeZone } from '../../views/workbench/analytics/domain/dateRange'
import type { StudySessionFact } from '../../../../shared/teaching-types/analytics'
import { applyStudyProgressionAwards } from '../study-progression'
import {
  claimStudyProgressionFactsEvent,
  STUDY_PROGRESSION_FACTS_EVENT
} from '../study-progression-events'
import {
  filterV1SessionCompletionAnalyticsIntents,
  projectTimerSessionCloseForHost,
  resolveTaskTitleSnapshot
} from '../planning-timer-session-analytics'
import {
  applyTimerSessionFocusCounterCredit,
  stripV1LiveFocusCounterMutation
} from '../planning-timer-session-focus-counters'
import { StudySessionLifecycle, type StudySessionLifecycleIntent } from './study-session-lifecycle'
import {
  attributionToTaskId,
  resolveStudyFocusAttribution,
  type EmptyStartChoice,
  type EmptyStartPolicy
} from './resolve-focus-attribution'

export type { EmptyStartChoice, EmptyStartPolicy }
import {
  computeExtendedBreakTargetSeconds,
  extendTimerSessionTarget,
  monFirstScheduleToIntervalMs,
  normalizePhasePromptExtendMinutes,
  normalizeQuickStartTitle,
  projectBreakEndHandoffPlan,
  projectPhaseHandoffPlan,
  resolveBreakEndHandoffIntent,
  resolveFocusCompleteHandoffIntent,
  resolvePhasePromptAnswerIntent
} from '../../../../shared/study-planning'
import { pickPrimaryScheduleBlockForTask } from '../planning-hydrate'
import { resolveFocusBlockIdForScheduleUpsert } from '../planning-schedule-block-adapter'
import {
  dualWriteCompleteTask,
  dualWriteCreateTask,
  dualWriteReopenTask,
  dualWriteUpsertScheduleFromV1,
  type CanonicalPlanningContext,
  type DualWriteResult
} from '../planning-dual-write'
import { dualWriteAssistantImportTasks } from '../planning-assistant-import-dual-write'
import { dualWriteUpdateTask } from '../planning-task-update-dual-write'
import { dualWriteDeleteTask, dualWriteRemoveDoneTasks, collectDoneTaskIds } from '../planning-task-delete-dual-write'
import { dualWriteClassificationPromptAnswer } from '../planning-classification-dual-write'
import { dualWriteBatchClassifyTasks } from '../planning-batch-classify-dual-write'
import {
  dualWriteSetClassificationPromptOptOut,
  dualWriteSetPreferences,
  dualWriteSetEmptyStartPolicy,
  dualWriteSetSimulationWindow
} from '../planning-preferences-dual-write'
import type { RecurrenceRule } from '../../../../shared/study-planning'
import {
  normalizeEmptyStartCategoryId,
  normalizeEmptyStartPolicy
} from '../planning-study-prefs-ui'
import {
  dualWriteCreateFocusBlock,
  dualWriteDeleteScheduleBlock,
  recomputePrimaryV1Schedule,
  removeBlockFromLocalCache,
  shouldClearV1ScheduleAfterDelete,
  upsertBlockInLocalCache
} from '../planning-multi-block-dual-write'
import { buildFocusScheduleBlockFromV1 } from '../planning-schedule-block-adapter'
import type { StudyPlanningApi } from '../planning-client'
import {
  commitV1Migration,
  dryRunV1Migration,
  formatMigrationConfirmMessage
} from '../planning-migration'
import {
  hydrateStudyTasksFromCanonical,
  studyTasksEqual
} from '../planning-hydrate'
import {
  shouldOfferMigrationBanner,
  type MigrationBannerSummary
} from '../planning-migration-banner'
import {
  buildV1AuthorityArchivePayload,
  canExecuteV1Demote,
  canOfferV1Demote,
  demoteV1LocalStorageKeys,
  exportV1AuthorityArchiveDownload,
  isV1LocalAuthorityDemoted,
  readV1LocalAuthorityDemotedAtMs,
  writeV1LocalAuthorityDemotedMarker,
  type V1DemoteOfferSummary
} from '../planning-v1-authority-demote'
import { resolveBreakPhaseFromPlan } from '../planning-timer-display'
import {
  applyRoomCycleTimerSession,
  applyTimerSessionTransition,
  projectAndMergeTimerClock
} from '../planning-timer-session-bridge'
import {
  mergeTimerWakeShellIntoSnapshot,
  projectRehydrateActiveTimerSession,
  projectTimerSessionAfterWake,
  type TimerWakeAction,
  type TimerWakeSignal
} from '../planning-timer-sleep-hooks'
import { subscribePlanningTimerOsPower, type SystemPowerSubscribeApi } from '../planning-timer-os-power'
import {
  dualWriteCopyTimerPlan,
  dualWriteDeleteTimerPlan,
  dualWriteRenameTimerPlan,
  dualWriteSaveTimerPlan,
  dualWriteSetDefaultTimerPlan
} from '../planning-timer-plan-dual-write'
import {
  isReadonlyTimerPlanId,
  renameTimerPlanInV1List,
  resolveTimerPlanShellForCatalog
} from '../planning-timer-plan-catalog-ui'
import {
  resolvePlanV2ForStart,
  resolveStartTargetSeconds,
  isOpenContinuousPlanV2
} from '../planning-timer-plan-kind'
import {
  decideAndApplyLifecycleNotification,
  type NotificationHostLiveContext
} from '../planning-notification-host'
import type { ScheduleBlock, TimerSessionRecord } from '../../../../shared/study-planning'
import {
  addStudyTask,
  addScheduledStudyTask,
  chooseStudySeatSnapshot,
  defaultStudyContractText,
  deriveStudyHostAction,
  joinStudySpace,
  removeDoneStudyTasks,
  removeStudyTask,
  resetStudyRelayUrl,
  applyStudyTimerPlan,
  removeStudyTimerPlan,
  resetStudyTimer,
  saveStudyNickname,
  saveStudyRelayUrl,
  setStudySpaceCode,
  switchStudyTimerMode,
  toggleStudyContract,
  toggleStudyTask,
  updateStudyContractText,
  updateStudyTask,
  updateStudyTimerPreset,
  saveStudyTimerPlan
} from './transitions'

type StudyPresenceTarget = {
  roomId?: StudyRoomId
  spaceCode?: string
}


/** Structured empty-start sheet answer (cutover C). Legacy EmptyStartChoice still accepted. */
export type EmptyStartAskAnswer =
  | { choice: 'pick_task'; taskId: string }
  | { choice: 'quick_start'; title?: string }
  | { choice: 'unattributed' }

/** STC-306: host asks how to handle future ScheduleBlocks after complete. */
export type FutureBlocksAskAnswer =
  | { decision: 'cancel_blocks' | 'keep_as_review' | 'reassign'; reassignTaskId?: string | null }
  | { decision: 'dismiss' }

/** STC-406/407: host asks to classify an inbox task after complete (non-blocking). */
export type ClassificationPromptAskAnswer =
  | { action: 'classify'; categoryId: string }
  | { action: 'keep_inbox' }
  | { action: 'later' }
  | { action: 'never_prompt' }

/** STC-205: host asks after focus countdown whether to start rest (freeze #3). */
export type PhasePromptAskAnswer =
  | { action: 'start_break' }
  | { action: 'skip_break' }
  | { action: 'later' }
  | { action: 'extend_and_start'; extendMinutes: number }

/** STC-206 / freeze #5: host asks how to credit a stale wall gap (>120 min default). */
export type ReconcileAskAnswer =
  | { action: 'confirm_all' }
  | { action: 'truncate_to_target' }
  | { action: 'discard_gap' }
  | { action: 'later' }

type UseStudySessionOptions = {
  showNotification: (title: string, body: string) => Promise<void>
  openFocusTheater: () => void
  /** Optional Teaching workspace captured only as explicit task/session attribution. */
  workspaceId?: string
  /**
   * Active workspace filesystem root for canonical StudyPlanning writes (ADR-0117).
   * When missing, task mutations stay V1-local and dual-write is skipped (fail-closed).
   */
  workspaceRoot?: string | null
  /** TeachingSystemApi slice; defaults to window.teachingSystem when omitted. */
  planningApi?: StudyPlanningApi | null
  /** Optional explicitly selected task; omitted means the session stays unattributed. */
  selectedTaskId?: string | null
  /**
   * Empty-start preference (product default remember_quick_start → 「其他」).
   * When start has no explicit/selected task, never auto-bind first open task.
   */
  emptyStartPolicy?: EmptyStartPolicy
  /**
   * Called when empty-start requires a user choice (STC-401 sheet / host).
   * Return a structured answer (or legacy EmptyStartChoice), or null/undefined to abort.
   * May be async when host opens a dialog sheet.
   */
  onEmptyStartAsk?: (
    policy: EmptyStartPolicy
  ) => EmptyStartAskAnswer | EmptyStartChoice | null | undefined | Promise<EmptyStartAskAnswer | EmptyStartChoice | null | undefined>
  /**
   * Surface canonical dual-write failures (revision conflict / io).
   * Does not roll back V1 UI cache in this partial cutover slice.
   */
  onPlanningWriteError?: (message: string) => void
  /**
   * STC-306 / freeze #7: after complete, when durable effects include
   * future_blocks_need_decision, ask host how to handle future blocks.
   * dismiss keeps blocks planned (no silent cancel).
   */
  onFutureBlocksNeedDecision?: (input: {
    taskId: string
    taskTitle: string
    futureBlockIds: string[]
  }) => FutureBlocksAskAnswer | null | undefined | Promise<FutureBlocksAskAnswer | null | undefined>
  /**
   * STC-406/407: after complete, when durable effects include
   * classification_prompt_suggested, ask host to classify inbox task.
   * later / dismiss never rolls back completion.
   */
  onClassificationPromptAsk?: (input: {
    taskId: string
    taskTitle: string
  }) => ClassificationPromptAskAnswer | null | undefined | Promise<ClassificationPromptAskAnswer | null | undefined>
  /**
   * STC-205 / freeze #3: after focus countdown completes with breakPolicy ask,
   * host shows PhasePromptSheet (start break / skip / later).
   * later / dismiss never forges rest completion.
   */
  onPhasePromptAsk?: (input: {
    completed: TimerSessionRecord
  }) => PhasePromptAskAnswer | null | undefined | Promise<PhasePromptAskAnswer | null | undefined>
  /**
   * STC-206 / freeze #5: when TimerSession enters needs_reconcile (stale gap),
   * host shows ReconcileSheet (confirm_all / truncate / discard / later).
   * later keeps needs_reconcile; never silently credits sleep as focus.
   */
  onReconcileAsk?: (input: {
    session: TimerSessionRecord
    gapSeconds: number
  }) => ReconcileAskAnswer | null | undefined | Promise<ReconcileAskAnswer | null | undefined>
  /**
   * STC-601/602/605: live host signals for lifecycle notifications
   * (fullscreen / quietUntil / notifications.enabled / permission).
   * Prefer a getter so decisions read current values, not mount-time snapshots.
   */
  getNotificationHostContext?: () => NotificationHostLiveContext
}

function timerSample() {
  const monotonicMs = typeof performance !== 'undefined' && Number.isFinite(performance.now())
    ? performance.now()
    : undefined
  return { wallMs: Date.now(), ...(monotonicMs === undefined ? {} : { monotonicMs }) }
}

export function useStudySession({
  showNotification,
  openFocusTheater,
  workspaceId,
  workspaceRoot = null,
  planningApi = null,
  selectedTaskId: selectedTaskIdProp,
  emptyStartPolicy: emptyStartPolicyProp,
  onEmptyStartAsk,
  onPlanningWriteError,
  onFutureBlocksNeedDecision,
  onClassificationPromptAsk,
  onPhasePromptAsk,
  onReconcileAsk,
  getNotificationHostContext
}: UseStudySessionOptions) {
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => readStudySnapshot())
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const lifecycleRef = useRef<StudySessionLifecycle | null>(null)
  const lifecycle = lifecycleRef.current ?? (lifecycleRef.current = new StudySessionLifecycle({
    sample: timerSample,
    timeZone: resolvedLocalTimeZone,
    createFactId: createStudyAnalyticsFactId
  }))
  /** Controlled when parent passes selectedTaskId; otherwise session owns focus-task selection. */
  const [internalSelectedTaskId, setInternalSelectedTaskId] = useState<string | null>(null)
  const selectedTaskId = selectedTaskIdProp !== undefined ? selectedTaskIdProp : internalSelectedTaskId
  const [roomCycleNow, setRoomCycleNow] = useState(() => Date.now())
  const presence = useStudyPresence(snapshot)

  const roomEventSenderRef = useRef(presence.sendEvent)
  const lastSeatConflictResolutionRef = useRef('')
  /** Canonical TimerSession id for dual-write (independent of V1 analytics session id). */
  const canonicalTimerSessionIdRef = useRef<string | null>(null)
  /**
   * Slice D remainder: local focus TimerSession is UI clock authority.
   * Dual-write publishes transitions only; ticks advance this record purely in memory.
   */
  const canonicalFocusSessionRef = useRef<TimerSessionRecord | null>(null)
  /**
   * STC-304 remainder: sole-read canonical TimerSession list (hydrate / finish dual-write).
   * Not the open-clock authority (local canonicalFocusSessionRef is).
   */
  const [timerSessions, setTimerSessions] = useState<TimerSessionRecord[]>([])
  /**
   * STC-503: React-visible mirror of local TimerSession for planSnapshot UI.
   * Updated only on structural transitions (start/pause/resume/finish/room-cycle),
   * not on per-tick advance — planSnapshot is frozen at start.
   */
  const [activeTimerSession, setActiveTimerSession] = useState<TimerSessionRecord | null>(null)
  // After activeTimerSession: countup exam dual-write stores elapsed in remainingSeconds.
  const viewModel = createStudySpaceViewModel(snapshot, presence, roomCycleNow, {
    timerClockMode: activeTimerSession?.clockMode === 'countup' ? 'countup' : 'countdown',
    timerTargetSeconds: activeTimerSession?.targetSeconds ?? null
  })
  /** STC-206: avoid re-opening reconcile sheet while host Promise is pending. */
  const reconcilePromptInFlightRef = useRef(false)
  /**
   * STC-307: canonical ScheduleBlock rows for multi-block week projection.
   * Not teaching authority for tasks (tasks still V1 UI cache + hydrate sole-read);
   * blocks cache is rebuilt from hydrate / successful schedule dual-write snapshots.
   */
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([])
  /** Sole-read category catalog from snapshot.categories (null = use V1 localStorage). */
  const [canonicalCategories, setCanonicalCategories] = useState<
    import('../types').StudyTaskCategory[] | null
  >(null)
  /** STC-502: local mirror of preferences.defaultTimerPlanId (canonical via set_preferences). */
  const [defaultTimerPlanId, setDefaultTimerPlanId] = useState<string | null>('classic_25_5')
  /**
   * STC-404: sole-read emptyStartPolicy + classificationPromptOptOut.
   * Host prop is initial/default only; hydrate + setters update local sole-read mirror.
   */
  const [emptyStartPolicy, setEmptyStartPolicy] = useState<EmptyStartPolicy>(
    () => normalizeEmptyStartPolicy(emptyStartPolicyProp)
  )
  const [emptyStartCategoryId, setEmptyStartCategoryId] = useState<string>('other')
  const [classificationPromptOptOut, setClassificationPromptOptOut] = useState(false)
  /**
   * STC-703: sole-read preferences.recurrenceRules for schedule page host wire.
   * Hydrate + set_preferences dual-write refresh only; no auto-expand.
   */
  const [recurrenceRules, setRecurrenceRules] = useState<RecurrenceRule[]>([])
  const emptyStartPolicyRef = useRef(emptyStartPolicy)
  emptyStartPolicyRef.current = emptyStartPolicy
  const emptyStartCategoryIdRef = useRef(emptyStartCategoryId)
  emptyStartCategoryIdRef.current = emptyStartCategoryId
  const classificationPromptOptOutRef = useRef(classificationPromptOptOut)
  classificationPromptOptOutRef.current = classificationPromptOptOut
  /**
   * Slice B UX: offer migration when hydrate keeps V1 and canonical is empty (or missing path).
   * Host shows MigrationBannerSheet; confirm runs migrateV1 with skipConfirm.
   */
  const [migrationOffer, setMigrationOffer] = useState<{
    summary: MigrationBannerSummary
    reason: string
  } | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [migrationError, setMigrationError] = useState<string | null>(null)
  const migrationDismissedRef = useRef(false)
  /**
   * Sole-authority demote offer (separate from migration confirm).
   * Surfaced after successful migrate or hydrate applied — never auto-erases.
   */
  const [v1DemoteOffer, setV1DemoteOffer] = useState<V1DemoteOfferSummary | null>(null)
  const [v1DemoteBusy, setV1DemoteBusy] = useState(false)
  const [v1DemoteError, setV1DemoteError] = useState<string | null>(null)
  const [v1AuthorityDemoted, setV1AuthorityDemoted] = useState(() => isV1LocalAuthorityDemoted())
  const v1DemoteDismissedRef = useRef(false)
  const migrationCommittedThisSessionRef = useRef(false)
  const scheduleBlocksRef = useRef(scheduleBlocks)
  scheduleBlocksRef.current = scheduleBlocks

  const resolvePlanningContext = (): CanonicalPlanningContext => {
    const api =
      planningApi ??
      (typeof window !== 'undefined' ? (window.teachingSystem as StudyPlanningApi | undefined) : undefined)
    return {
      api: api ?? null,
      workspaceRoot: workspaceRoot ?? null
    }
  }

  const reportPlanningWrite = (result: DualWriteResult): void => {
    if (result.kind !== 'canonical_failed') return
    const err = result.result.error
    const message = `Study planning write failed (${err.code}): ${err.message}`
    onPlanningWriteError?.(message)
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(message)
    }
  }

  /**
   * When TimerSession is segment authority, suppress V1 study_session facts so the
   * ledger does not double-count; presence/notification intents still flow.
   */
  const dispatchLifecycleIntentsRespectingTimerSession = (
    intents: StudySessionLifecycleIntent[]
  ): void => {
    if (canonicalFocusSessionRef.current) {
      dispatchLifecycleIntents(filterV1SessionCompletionAnalyticsIntents(intents))
      return
    }
    dispatchLifecycleIntents(intents)
  }

  /**
   * Project closed TimerSession → StudySessionFact + optional shell stats; discard
   * parallel V1 ActiveStudySession so finish/advance cannot re-emit a second fact.
   */
  const emitTimerSessionCloseAnalytics = (
    session: TimerSessionRecord | null | undefined,
    outcome: StudySessionFact['outcome'],
    host: StudySnapshot,
    options?: { applyShellStats?: boolean; discardV1Twin?: boolean }
  ): StudySnapshot => {
    const discardV1Twin = options?.discardV1Twin !== false
    if (!session) {
      if (discardV1Twin) lifecycle.discardActiveSessionWithoutAnalytics()
      return host
    }
    const endedAtMs = session.endedAtMs ?? Date.now()
    const closed: TimerSessionRecord = {
      ...session,
      state:
        outcome === 'completed'
          ? 'completed'
          : session.state === 'cancelled'
            ? 'cancelled'
            : session.state === 'completed'
              ? 'completed'
              : 'cancelled',
      endedAtMs
    }
    const recordedAtMs = Date.now()
    const timeZone = resolvedLocalTimeZone()
    const localToday = getLocalDateKey(recordedAtMs, timeZone)
    const title = resolveTaskTitleSnapshot(host.tasks, closed.taskId)
    const { fact, host: next } = projectTimerSessionCloseForHost({
      session: closed,
      host,
      outcome,
      workspaceId,
      taskTitleSnapshot: title,
      recordedAtMs,
      timeZone,
      applyShellStats: options?.applyShellStats === true,
      localToday
    })
    if (fact) {
      appendStudyAnalyticsFacts(host.clientId, [fact], {
        localToday,
        updatedAt: fact.recordedAt
      })
    }
    if (discardV1Twin) lifecycle.discardActiveSessionWithoutAnalytics()
    return next
  }

  /**
   * Slice D+: TimerSession local UI clock + durable dual-write (focus + break).
   * Logic peels to planning-timer-session-bridge (no per-tick advance thrash).
   * STC-304 remainder: refresh sole-read timerSessions cache from finish dual-write snapshot.
   */
  const refreshTimerSessionsFromDualWrite = (result: DualWriteResult): void => {
    if (result.kind === 'canonical_ok' && result.result.snapshot?.timerSessions) {
      setTimerSessions(result.result.snapshot.timerSessions.slice())
    }
  }

  const dualWriteFocusTimerTransition = (
    transition: Parameters<typeof applyTimerSessionTransition>[0]['transition']
  ): ReturnType<typeof applyTimerSessionTransition> => {
    // STC-504: freeze default / applied plan into local session (continuous open countup supported).
    const preferredPlanId = defaultTimerPlanId ?? 'classic_25_5'
    const resolvedPlan =
      transition.kind === 'start' && !transition.plan
        ? resolvePlanV2ForStart({
            planId: transition.planId ?? preferredPlanId,
            userPlans: snapshotRef.current.timerPlans
          })
        : null
    const next = applyTimerSessionTransition({
      transition:
        transition.kind === 'start' && resolvedPlan
          ? {
              ...transition,
              plan: resolvedPlan,
              planId: resolvedPlan.id,
              // Open continuous: do not force V1 remainingSeconds target.
              targetSeconds: isOpenContinuousPlanV2(resolvedPlan)
                ? null
                : (transition.targetSeconds ??
                  resolveStartTargetSeconds(resolvedPlan) ??
                  transition.targetSeconds)
            }
          : transition,
      ctx: resolvePlanningContext(),
      refs: {
        sessionId: canonicalTimerSessionIdRef.current,
        session: canonicalFocusSessionRef.current
      },
      planId: preferredPlanId,
      onWrite: (result) => {
        reportPlanningWrite(result)
        // After finish/switch, actual minutes must include closed segments for task detail.
        if (transition.kind === 'finish' || transition.kind === 'switch_task') {
          refreshTimerSessionsFromDualWrite(result)
        }
      }
    })
    canonicalTimerSessionIdRef.current = next.sessionId
    canonicalFocusSessionRef.current = next.session
    // STC-503: structural transition only (planSnapshot frozen; no per-tick setState).
    setActiveTimerSession(next.session)
    return next
  }

  /**
   * STC-205: apply post-focus break handoff without re-running V1 auto break start
   * when policy is ask/none/reminder_only. For automatic, start break from frozen plan.
   */
  const applyFocusCompleteWithoutAutoBreak = (host: StudySnapshot): StudySnapshot => {
    // Keep V1 analytics/session-count fields from lifecycle advance, but freeze break
    // as idle so the user (or automatic path below) owns the next start.
    return {
      ...host,
      timerMode: 'break',
      timerState: 'idle',
      remainingSeconds: Math.max(1, host.breakMinutes * 60),
      contractLocked: false
    }
  }

  const startBreakFromCompletedHandoff = (
    completed: TimerSessionRecord,
    userConfirmed: boolean,
    options?: { extendMinutes?: number }
  ): void => {
    const handoff = projectPhaseHandoffPlan(completed)
    if (!handoff) return
    if (handoff.disposition === 'suppress' || handoff.disposition === 'remind') return
    const extendMinutes = normalizePhasePromptExtendMinutes(options?.extendMinutes)
    const targetSeconds =
      extendMinutes != null
        ? computeExtendedBreakTargetSeconds({
            baseMinutes: handoff.nextBreakMinutes,
            extendMinutes,
            phase: handoff.nextPhase
          })
        : handoff.targetSeconds
    const breakMinutes = Math.max(1, Math.ceil(targetSeconds / 60))
    dualWriteFocusTimerTransition({
      kind: 'start_from_completed',
      completed,
      phase: handoff.nextPhase,
      userConfirmed,
      targetSeconds
    })
    const latest = snapshotRef.current
    const next: StudySnapshot = {
      ...latest,
      timerMode: 'break',
      timerState: 'running',
      breakMinutes,
      remainingSeconds: targetSeconds,
      contractLocked: false
    }
    if (canonicalFocusSessionRef.current) {
      commitSnapshot(projectAndMergeFocusTimerClock(next, Date.now(), { fullState: true }).snapshot)
    } else {
      commitSnapshot(next)
    }
  }

  /**
   * STC-205: after focus segment closes, respect breakPolicy (freeze #3/#6).
   * - automatic → start break immediately (userConfirmed not required)
   * - ask → PhasePromptSheet via host
   * - reminder_only / none → idle break shell; no auto start
   */
  const handleFocusSegmentComplete = async (
    completedFocus: TimerSessionRecord | null,
    hostAfterAdvance: StudySnapshot
  ): Promise<void> => {
    // Normalize to completed so pure handoff + startNextPhaseFromCompleted accept it
    // even when V1 lifecycle finished a tick before TimerSession local advance.
    const normalizedCompleted: TimerSessionRecord | null =
      completedFocus && completedFocus.phase === 'focus'
        ? {
            ...completedFocus,
            state: 'completed',
            endedAtMs: completedFocus.endedAtMs ?? Date.now()
          }
        : completedFocus

    // Close durable focus session first.
    dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })

    // Sole-authority demotion: TimerSession → analytics fact + shell stats; drop V1 twin.
    // If V1 lifecycle already completed the segment (break/idle + sessions/xp), only emit
    // the fact — do not re-bump shell stats.
    const v1AlreadyCompletedShell =
      hostAfterAdvance.timerMode === 'break' && hostAfterAdvance.timerState === 'idle'
    const hostWithAnalytics = emitTimerSessionCloseAnalytics(
      normalizedCompleted,
      'completed',
      hostAfterAdvance,
      { applyShellStats: !v1AlreadyCompletedShell }
    )

    const handoff = projectPhaseHandoffPlan(normalizedCompleted)
    if (!handoff) {
      // No frozen plan / not focus — keep V1 auto handoff shell as-is (stats already applied).
      commitSnapshot(hostWithAnalytics)
      return
    }

    // Sole disposition → intent table (shared pure module; host only applies effects).
    const intent = resolveFocusCompleteHandoffIntent(handoff)

    if (intent.kind === 'suppress_to_focus_idle') {
      // breakPolicy none: stay ready — prefer focus idle for next start.
      commitSnapshot({
        ...hostWithAnalytics,
        timerMode: 'focus',
        timerState: 'idle',
        remainingSeconds: Math.max(1, hostWithAnalytics.focusMinutes * 60),
        contractLocked: false
      })
      return
    }

    const idleBreakShell = applyFocusCompleteWithoutAutoBreak({
      ...hostWithAnalytics,
      breakMinutes: intent.breakMinutes
    })

    if (intent.kind === 'auto_start_break') {
      commitSnapshot(idleBreakShell)
      startBreakFromCompletedHandoff(normalizedCompleted!, true)
      return
    }

    if (intent.kind === 'remind') {
      commitSnapshot(idleBreakShell)
      // Soft in-app reminder only; do not start break TimerSession.
      void showNotification(intent.notifyTitle, intent.notifyBody)
      return
    }

    // intent.kind === 'prompt' (ask)
    commitSnapshot(idleBreakShell)
    if (!onPhasePromptAsk || !normalizedCompleted) return
    try {
      const answer = await onPhasePromptAsk({ completed: normalizedCompleted })
      const answerIntent = resolvePhasePromptAnswerIntent({
        action: answer?.action,
        extendMinutes:
          answer?.action === 'extend_and_start' ? answer.extendMinutes : undefined
      })
      if (answerIntent.kind === 'noop') return
      if (answerIntent.kind === 'skip_to_focus_idle') {
        // Skip: idle focus shell; do not forge rest.
        const latest = snapshotRef.current
        commitSnapshot({
          ...latest,
          timerMode: 'focus',
          timerState: 'idle',
          remainingSeconds: Math.max(1, latest.focusMinutes * 60),
          contractLocked: false
        })
        return
      }
      if (answerIntent.kind === 'start_break') {
        startBreakFromCompletedHandoff(normalizedCompleted, true)
        return
      }
      if (answerIntent.kind === 'extend_and_start') {
        startBreakFromCompletedHandoff(normalizedCompleted, true, {
          extendMinutes: answerIntent.extendMinutes
        })
      }
    } catch {
      // Fail-closed: leave idle break shell; never auto-start on prompt error.
    }
  }


  /**
   * STC-205 remainder / §10.3: after rest segment closes, do not silent-start next focus.
   * - automatic → start next focus from frozen planSnapshot
   * - ask / none → idle focus shell (no intermediate break-end prompt page)
   * - reminder_only → idle focus shell + soft notify
   */
  const startNextFromCompletedBreak = (
    completed: TimerSessionRecord,
    userConfirmed: boolean,
    phase: 'focus' | 'wrap_up'
  ): void => {
    const handoff = projectBreakEndHandoffPlan(completed)
    if (!handoff) return
    const targetSeconds =
      phase === 'wrap_up' ? handoff.wrapUpTargetSeconds : handoff.focusTargetSeconds
    // Break sessions store taskId null; reattach current selection for next focus.
    const focusTaskId =
      phase === 'focus' ? selectedTaskId ?? completed.taskId ?? null : null
    dualWriteFocusTimerTransition({
      kind: 'start_from_completed',
      completed,
      phase,
      userConfirmed,
      ...(targetSeconds !== null && targetSeconds !== undefined
        ? { targetSeconds }
        : {}),
      ...(phase === 'focus' ? { taskId: focusTaskId } : {})
    })
    const latest = snapshotRef.current
    const isWrap = phase === 'wrap_up'
    // wrap_up uses break shell mode (not core focus analytics path); focus uses focus shell.
    const next: StudySnapshot = {
      ...latest,
      timerMode: isWrap ? 'break' : 'focus',
      timerState: 'running',
      ...(isWrap
        ? { breakMinutes: Math.max(1, handoff.wrapUpMinutes || 1) }
        : handoff.focusTargetSeconds != null
          ? { focusMinutes: Math.max(1, Math.ceil(handoff.focusTargetSeconds / 60)) }
          : {}),
      remainingSeconds:
        targetSeconds != null && targetSeconds > 0
          ? targetSeconds
          : isWrap
            ? Math.max(1, handoff.wrapUpMinutes * 60)
            : Math.max(1, latest.focusMinutes * 60),
      contractLocked: false
    }
    if (canonicalFocusSessionRef.current) {
      commitSnapshot(projectAndMergeFocusTimerClock(next, Date.now(), { fullState: true }).snapshot)
    } else {
      commitSnapshot(next)
    }
  }

  const handleBreakSegmentComplete = async (
    completedBreak: TimerSessionRecord | null,
    hostAfterAdvance: StudySnapshot
  ): Promise<void> => {
    const normalizedCompleted: TimerSessionRecord | null =
      completedBreak &&
      (completedBreak.phase === 'short_break' || completedBreak.phase === 'long_break')
        ? {
            ...completedBreak,
            state: 'completed',
            endedAtMs: completedBreak.endedAtMs ?? Date.now()
          }
        : completedBreak

    // Close durable break session first.
    dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })

    // Sole-authority demotion: TimerSession → analytics fact; break does not bump sessions/xp.
    const hostWithAnalytics = emitTimerSessionCloseAnalytics(
      normalizedCompleted,
      'completed',
      hostAfterAdvance,
      { applyShellStats: false }
    )

    const handoff = projectBreakEndHandoffPlan(normalizedCompleted)
    if (!handoff) {
      // No frozen plan / not break — keep V1 auto handoff shell as-is (legacy).
      commitSnapshot(hostWithAnalytics)
      return
    }

    // Sole disposition → intent table (shared pure module; host only applies effects).
    const intent = resolveBreakEndHandoffIntent(handoff)

    const idleFocusShell: StudySnapshot = {
      ...hostWithAnalytics,
      timerMode: 'focus',
      timerState: 'idle',
      remainingSeconds: Math.max(
        1,
        handoff.focusTargetSeconds != null
          ? handoff.focusTargetSeconds
          : hostAfterAdvance.focusMinutes * 60
      ),
      contractLocked: false
    }

    if (intent.kind === 'auto_start_focus') {
      commitSnapshot(idleFocusShell)
      startNextFromCompletedBreak(normalizedCompleted!, true, 'focus')
      return
    }

    if (intent.kind === 'remind') {
      commitSnapshot(idleFocusShell)
      void showNotification(intent.notifyTitle, intent.notifyBody)
      return
    }

    // ask / none / suppress: leave idle focus shell — no intermediate break-end page.
    commitSnapshot(idleFocusShell)
  }

  /** Sole-read clock into V1 remainingSeconds cache (focus + break). */
  const projectAndMergeFocusTimerClock = (
    host: StudySnapshot,
    nowMs = Date.now(),
    options?: { fullState?: boolean }
  ): {
    snapshot: StudySnapshot
    completed: boolean
    needsReconcile: boolean
    gapSeconds: number
  } => {
    const projected = projectAndMergeTimerClock({
      host,
      session: canonicalFocusSessionRef.current,
      nowMs,
      fullState: options?.fullState === true
    })
    canonicalFocusSessionRef.current = projected.session
    return {
      snapshot: projected.snapshot,
      completed: projected.completed,
      needsReconcile: projected.needsReconcile,
      gapSeconds: projected.gapSeconds
    }
  }

  /**
   * STC-206: pause UI shell, ask host, apply local + dual-write reconcile.
   * later: leave needs_reconcile + paused shell (no silent credit).
   */
  const handleNeedsReconcile = async (
    session: TimerSessionRecord,
    gapSeconds: number,
    hostSnapshot: StudySnapshot
  ): Promise<void> => {
    if (reconcilePromptInFlightRef.current) return
    reconcilePromptInFlightRef.current = true
    try {
      // Pin local session + paused UI so tick stops inventing time.
      canonicalFocusSessionRef.current = session
      setActiveTimerSession(session)
      const pausedShell: StudySnapshot = {
        ...hostSnapshot,
        timerState: 'paused',
        remainingSeconds: hostSnapshot.remainingSeconds
      }
      commitSnapshot(pausedShell)

      // Best-effort pin durable advance so store also sees needs_reconcile.
      dualWriteFocusTimerTransition({ kind: 'pin_needs_reconcile' })

      if (!onReconcileAsk) return
      const answer = await onReconcileAsk({ session, gapSeconds })
      if (!answer || answer.action === 'later') return

      const decision =
        answer.action === 'confirm_all' ||
        answer.action === 'truncate_to_target' ||
        answer.action === 'discard_gap'
          ? answer.action
          : null
      if (!decision) return

      dualWriteFocusTimerTransition({ kind: 'reconcile_stale', decision })
      const latest = snapshotRef.current
      const after = canonicalFocusSessionRef.current
      if (!after) {
        commitSnapshot({ ...latest, timerState: 'idle' })
        return
      }
      if (after.state === 'completed' || after.state === 'cancelled') {
        // Reconcile may complete countdown; hand off like normal completion.
        if (after.phase === 'focus' && after.state === 'completed') {
          void handleFocusSegmentComplete(after, {
            ...latest,
            remainingSeconds: 0,
            timerState: 'idle'
          })
        } else if (
          (after.phase === 'short_break' || after.phase === 'long_break') &&
          after.state === 'completed'
        ) {
          void handleBreakSegmentComplete(after, {
            ...latest,
            remainingSeconds: 0,
            timerState: 'idle'
          })
        } else {
          dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
          commitSnapshot({
            ...latest,
            remainingSeconds: 0,
            timerState: 'idle',
            timerMode: after.phase === 'focus' ? 'focus' : 'break'
          })
        }
        return
      }
      // Resumed running after reconcile.
      const projected = projectAndMergeFocusTimerClock(
        {
          ...latest,
          timerState: 'running',
          timerMode: after.phase === 'focus' ? 'focus' : 'break'
        },
        Date.now(),
        { fullState: true }
      )
      setActiveTimerSession(canonicalFocusSessionRef.current)
      commitSnapshot(projected.snapshot)
    } catch {
      // Fail-closed: leave needs_reconcile / paused shell.
    } finally {
      reconcilePromptInFlightRef.current = false
    }
  }

  /**
   * STC-206 remainder: apply pure wake / sleep pin result (visibility, pagehide, rehydrate).
   * Never silently credits long sleep; opens reconcile when needs_reconcile.
   */
  const applyTimerWakeAction = (
    action: TimerWakeAction,
    hostSnapshot: StudySnapshot
  ): void => {
    if (action.type === 'noop') return
    canonicalFocusSessionRef.current = action.session
    if (action.session.id) {
      canonicalTimerSessionIdRef.current = action.session.id
    }
    setActiveTimerSession(action.session)

    // handleNeedsReconcile already dual-writes pin_needs_reconcile; avoid double thrash.
    if (action.pinDurableAdvance && !action.needsReconcile) {
      dualWriteFocusTimerTransition({ kind: 'pin_needs_reconcile' })
    }

    if (action.needsReconcile) {
      void handleNeedsReconcile(
        action.session,
        action.gapSeconds || action.session.pendingReconcileSeconds || 0,
        hostSnapshot
      )
      return
    }

    if (action.completed) {
      const closed = action.session
      const wasFocus = closed.phase === 'focus'
      const wasBreak = closed.phase === 'short_break' || closed.phase === 'long_break'
      if (wasFocus) {
        const completedSession: TimerSessionRecord = {
          ...closed,
          state: 'completed',
          endedAtMs: closed.endedAtMs ?? Date.now()
        }
        void handleFocusSegmentComplete(completedSession, {
          ...hostSnapshot,
          remainingSeconds: 0,
          timerState: 'idle'
        })
      } else if (wasBreak) {
        const completedSession: TimerSessionRecord = {
          ...closed,
          state: 'completed',
          endedAtMs: closed.endedAtMs ?? Date.now()
        }
        void handleBreakSegmentComplete(completedSession, {
          ...hostSnapshot,
          remainingSeconds: 0,
          timerState: 'idle'
        })
      } else {
        dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
        commitSnapshot({
          ...hostSnapshot,
          remainingSeconds: 0,
          timerState: 'idle',
          timerMode: closed.phase === 'focus' ? 'focus' : 'break'
        })
      }
      return
    }

    const projected = projectAndMergeFocusTimerClock(
      {
        ...hostSnapshot,
        timerState: action.session.state === 'running' ? 'running' : hostSnapshot.timerState,
        timerMode: action.session.phase === 'focus' ? 'focus' : 'break'
      },
      Date.now(),
      { fullState: true }
    )
    setActiveTimerSession(canonicalFocusSessionRef.current)
    commitSnapshot(projected.snapshot)
  }

  /** STC-206: visibility resume / pagehide → pure wake then pin/reconcile. */
  const handleTimerWakeSignal = (signal: TimerWakeSignal): void => {
    const session = canonicalFocusSessionRef.current
    if (!session) return
    const action = projectTimerSessionAfterWake({ session, signal })
    if (action.type === 'noop') return
    applyTimerWakeAction(action, snapshotRef.current)
  }

  /**
   * Slice B: dry-run V1 local snapshot → user confirm → import_migration_commit durable.
   * Does not erase localStorage (ADR-0117 ≥30 days / explicit erase later).
   */
  const migrateV1ToCanonicalPlanning = async (options?: {
    weekAnchorMidnightMs?: number
    skipConfirm?: boolean
  }): Promise<
    | { ok: true; revision: number; summary: { taskCount: number; scheduleBlockCount: number; timerPlanCount: number } }
    | { ok: false; code: string; message: string }
  > => {
    const current = snapshotRef.current
    const v1Slice = {
      tasks: current.tasks,
      timerPlans: current.timerPlans,
      simulationStartTime: current.simulationStartTime,
      simulationEndTime: current.simulationEndTime,
      focusMinutes: current.focusMinutes,
      breakMinutes: current.breakMinutes
    }
    const weekAnchor =
      options?.weekAnchorMidnightMs ??
      (() => {
        const d = new Date()
        d.setHours(0, 0, 0, 0)
        // Align to Monday of current week (local)
        const day = d.getDay()
        const diff = day === 0 ? -6 : 1 - day
        d.setDate(d.getDate() + diff)
        return d.getTime()
      })()

    const dry = dryRunV1Migration(v1Slice, { weekAnchorMidnightMs: weekAnchor })
    if (!dry.ok) {
      setMigrationError(dry.message)
      return { ok: false, code: dry.code, message: dry.message }
    }

    if (!options?.skipConfirm) {
      if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
        return {
          ok: false,
          code: 'confirm_unavailable',
          message: 'Migration requires user confirm; window.confirm unavailable'
        }
      }
      const accepted = window.confirm(formatMigrationConfirmMessage(dry))
      if (!accepted) {
        return { ok: false, code: 'user_cancelled', message: 'User cancelled V1 migration' }
      }
    }

    setMigrationBusy(true)
    setMigrationError(null)
    try {
      const ctx = resolvePlanningContext()
      const result = await commitV1Migration({
        api: ctx.api,
        workspaceRoot: ctx.workspaceRoot,
        v1Snapshot: v1Slice,
        userConfirmed: true,
        weekAnchorMidnightMs: weekAnchor,
        // Seed active simulation window into preferences (not schedule history).
        preferences: {
          simulationStartTime: v1Slice.simulationStartTime,
          simulationEndTime: v1Slice.simulationEndTime
        },
        // Seed category catalog (dedupe keep color/id); no localStorage erase.
        categories: readStudyTaskCategories()
      })
      if (!result.ok) {
        const message = `Study planning migration failed (${result.error.code}): ${result.error.message}`
        onPlanningWriteError?.(message)
        setMigrationError(result.error.message)
        return { ok: false, code: result.error.code, message: result.error.message }
      }

      // Re-hydrate sole-read so UI tasks/blocks come from canonical authority.
      const host = snapshotRef.current
      const hydrate = await hydrateStudyTasksFromCanonical(
        { api: ctx.api, workspaceRoot: ctx.workspaceRoot },
        host
      )
      if (hydrate.kind === 'applied') {
        setScheduleBlocks(hydrate.scheduleBlocks.slice())
        setTimerSessions(hydrate.timerSessions.slice())
        setDefaultTimerPlanId(hydrate.defaultTimerPlanId ?? 'classic_25_5')
        setEmptyStartPolicy(hydrate.emptyStartPolicy)
        setEmptyStartCategoryId(hydrate.emptyStartCategoryId)
        setClassificationPromptOptOut(hydrate.classificationPromptOptOut)
        setRecurrenceRules(hydrate.recurrenceRules.slice())
        if (hydrate.categories) {
          setCanonicalCategories(hydrate.categories)
          if (!(v1AuthorityDemoted || isV1LocalAuthorityDemoted())) {
            persistStudyTaskCategories(hydrate.categories)
          }
        }
        const live = snapshotRef.current
        const merged: StudySnapshot = {
          ...live,
          tasks: hydrate.snapshot.tasks,
          ...(hydrate.timerPlansProjected > 0 ? { timerPlans: hydrate.snapshot.timerPlans } : {}),
          ...(hydrate.simulationStartTime && hydrate.simulationEndTime
            ? {
                simulationStartTime: hydrate.simulationStartTime,
                simulationEndTime: hydrate.simulationEndTime
              }
            : {})
        }
        if (!studyTasksEqual(live.tasks, merged.tasks)) {
          recordTaskMutation(live, merged)
        }
        commitSnapshot(merged)
      }

      setMigrationOffer(null)
      migrationDismissedRef.current = true
      migrationCommittedThisSessionRef.current = true
      // Offer demote separately — migration never erases localStorage.
      if (
        !v1DemoteDismissedRef.current &&
        !isV1LocalAuthorityDemoted() &&
        canOfferV1Demote({
          migrationCommitted: true,
          hydrateApplied: false,
          canonicalTaskCount: dry.summary.taskCount,
          hostTaskCount: snapshotRef.current.tasks.length,
          workspaceAvailable: Boolean(resolvePlanningContext().workspaceRoot?.trim()),
          alreadyDemoted: false
        })
      ) {
        const cats = readStudyTaskCategories()
        setV1DemoteOffer({
          taskCount: dry.summary.taskCount,
          timerPlanCount: dry.summary.timerPlanCount,
          categoryCount: cats.length,
          reason: 'post_migrate'
        })
        setV1DemoteError(null)
      }
      return {
        ok: true,
        revision: result.revision,
        summary: {
          taskCount: dry.summary.taskCount,
          scheduleBlockCount: dry.summary.scheduleBlockCount,
          timerPlanCount: dry.summary.timerPlanCount
        }
      }
    } finally {
      setMigrationBusy(false)
    }
  }

  const dismissMigrationOffer = (mode: 'dismiss' | 'later' = 'later'): void => {
    setMigrationOffer(null)
    setMigrationError(null)
    if (mode === 'dismiss') {
      migrationDismissedRef.current = true
    }
  }

  const confirmMigrationOffer = async (): Promise<
    | { ok: true; revision: number; summary: { taskCount: number; scheduleBlockCount: number; timerPlanCount: number } }
    | { ok: false; code: string; message: string }
  > => {
    return migrateV1ToCanonicalPlanning({ skipConfirm: true })
  }



  const dismissV1DemoteOffer = (mode: 'dismiss' | 'later' = 'later'): void => {
    setV1DemoteOffer(null)
    setV1DemoteError(null)
    if (mode === 'dismiss') {
      v1DemoteDismissedRef.current = true
    }
  }

  /**
   * Explicit user confirm: backup/export first, then strip V1 task authority.
   * Fail-closed — never erase without confirm + successful export.
   */
  const confirmV1DemoteOffer = async (): Promise<
    | { ok: true; demotedAtMs: number }
    | { ok: false; code: string; message: string }
  > => {
    if (isV1LocalAuthorityDemoted()) {
      setV1AuthorityDemoted(true)
      setV1DemoteOffer(null)
      return { ok: true, demotedAtMs: readV1LocalAuthorityDemotedAtMs() ?? Date.now() }
    }
    const current = snapshotRef.current
    const categories = readStudyTaskCategories()
    let rawStudy: string | null = null
    let rawCats: string | null = null
    try {
      rawStudy = window.localStorage.getItem('studiumx:study-space:v1')
      rawCats = window.localStorage.getItem('studiumx:study-task-categories:v1')
    } catch {
      // best-effort raw capture
    }
    const archive = buildV1AuthorityArchivePayload({
      snapshot: current,
      categories,
      rawStudySpaceJson: rawStudy,
      rawCategoriesJson: rawCats
    })
    setV1DemoteBusy(true)
    setV1DemoteError(null)
    try {
      const exported = exportV1AuthorityArchiveDownload(archive)
      if (!exported.ok) {
        setV1DemoteError(exported.message)
        return { ok: false, code: exported.code, message: exported.message }
      }
      if (
        !canExecuteV1Demote({
          userConfirmed: true,
          lastBackupExportOk: true,
          workspaceAvailable: Boolean(resolvePlanningContext().workspaceRoot?.trim()),
          alreadyDemoted: false
        })
      ) {
        const message = 'Demote gate refused (confirm/backup/workspace).'
        setV1DemoteError(message)
        return { ok: false, code: 'gate_refused', message }
      }
      const demote = demoteV1LocalStorageKeys({
        userConfirmed: true,
        backupExportOk: true,
        eraseTasks: true,
        eraseCategories: categories.length > 0,
        keepPresenceKeys: true,
        rewritePresenceShell: true,
        presenceSource: current
      })
      if (!demote.ok) {
        setV1DemoteError(demote.message)
        return { ok: false, code: demote.code, message: demote.message }
      }
      // Dual-write durable marker when workspace/API available (optional).
      const ctx = resolvePlanningContext()
      void dualWriteSetPreferences(ctx, {
        v1LocalAuthorityDemotedAtMs: demote.demotedAtMs
      }).then(reportPlanningWrite)
      setV1AuthorityDemoted(true)
      writeV1LocalAuthorityDemotedMarker(demote.demotedAtMs)
      // Keep live UI tasks (canonical sole-read already applied); strip only storage shell.
      // Do not wipe in-memory task list — authority is workspace, UI still shows sole-read tasks.
      setV1DemoteOffer(null)
      v1DemoteDismissedRef.current = true
      return { ok: true, demotedAtMs: demote.demotedAtMs }
    } finally {
      setV1DemoteBusy(false)
    }
  }
  const commitSnapshot = (next: StudySnapshot): StudySnapshot => {
    const current = snapshotRef.current
    // Analytics intents can settle XP immediately before their accompanying UI
    // state transition is committed. Keep that newer local reward settlement
    // instead of letting the older transition snapshot overwrite it.
    const preserveProgression =
      current.dailyXpProgress.awardedXp > next.dailyXpProgress.awardedXp
      && current.xp >= next.xp
    const resolved = preserveProgression
      ? { ...next, xp: Math.max(next.xp, current.xp), dailyXpProgress: current.dailyXpProgress }
      : next
    snapshotRef.current = resolved
    setSnapshot(resolved)
    return resolved
  }

  const dispatchLifecycleIntents = (intents: StudySessionLifecycleIntent[]): void => {
    for (const intent of intents) {
      if (intent.kind === 'analytics') {
        const localToday = intent.localToday ?? getLocalDateKey(Date.now(), resolvedLocalTimeZone())
        const awarded = applyStudyProgressionAwards(snapshotRef.current, intent.facts, localToday)
        if (awarded !== snapshotRef.current) {
          snapshotRef.current = awarded
          setSnapshot(awarded)
        }
        appendStudyAnalyticsFacts(intent.clientId, intent.facts, {
          localToday,
          ...(intent.updatedAt ? { updatedAt: intent.updatedAt } : {})
        })
      } else if (intent.kind === 'presence') {
        roomEventSenderRef.current(intent.event, intent.text, intent.target)
      } else {
        // STC-601/602/605: live host context (fullscreen/DND/permission/master switch).
        // App showNotification remains the delivery host (in-app + its own OS path).
        const live = getNotificationHostContext?.() ?? {}
        decideAndApplyLifecycleNotification({
          intent,
          live,
          showInApp: showNotification
        })
      }
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onProgressionFacts = (event: Event) => {
      const detail = claimStudyProgressionFactsEvent(event)
      if (!detail) return
      const awarded = applyStudyProgressionAwards(snapshotRef.current, detail.facts, detail.localToday)
      if (awarded !== snapshotRef.current) {
        snapshotRef.current = awarded
        setSnapshot(awarded)
      }
    }
    window.addEventListener(STUDY_PROGRESSION_FACTS_EVENT, onProgressionFacts)
    return () => window.removeEventListener(STUDY_PROGRESSION_FACTS_EVENT, onProgressionFacts)
  }, [])

  const decorateTasksForLedger = (tasks: StudySnapshot['tasks']) => {
    const categories = listStudyTaskCategories()
    return tasks.map((task) => {
      const categoryId = task.categoryId ?? 'study'
      const category = resolveStudyTaskCategory(categoryId, categories)
      return {
        ...task,
        categoryId,
        ...(category?.name ? { categoryName: category.name } : {})
      }
    })
  }

  const recordTaskMutation = (before: StudySnapshot, after: StudySnapshot): void => {
    // Snapshot category display names onto lifecycle facts so analytics category pies
    // do not depend solely on the current task inventory join.
    const intents = lifecycle.recordTaskMutation(
      { ...before, tasks: decorateTasksForLedger(before.tasks) as StudySnapshot['tasks'] },
      { ...after, tasks: decorateTasksForLedger(after.tasks) as StudySnapshot['tasks'] },
      workspaceId
    )
    dispatchLifecycleIntents(intents)
  }

  const emitRoomEvent = (kind: StudyRoomEventKind, text: string, target?: StudyPresenceTarget): void => {
    presence.sendEvent(kind, text, target)
  }

  useEffect(() => {
    roomEventSenderRef.current = presence.sendEvent
  }, [presence.sendEvent])

  useEffect(() => {
    lifecycle.recover(snapshotRef.current, { taskId: selectedTaskId, workspaceId })
  }, [lifecycle, selectedTaskId, workspaceId])

  useEffect(() => {
    const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : ''
    persistStudySnapshot(snapshot, {
      workspaceAvailable: root.length > 0,
      demoted: v1AuthorityDemoted || isV1LocalAuthorityDemoted()
    })
  }, [snapshot, workspaceRoot, v1AuthorityDemoted])

  useEffect(() => {
    /**
     * AssistantTodoCapture still writes V1 localStorage + dispatches this event.
     * Keep V1 UI cache for responsiveness, then dual-write **added** tasks so
     * hydrate sole-read does not erase assistant invents (sole-authority demotion).
     * No auto-erase of localStorage; dual-write failures do not roll back V1.
     */
    const syncImportedTasks = (event: Event): void => {
      const tasks = (event as CustomEvent<StudySnapshot['tasks']>).detail
      if (!Array.isArray(tasks)) return
      const current = snapshotRef.current
      const previousTasks = current.tasks.slice()
      const next = { ...current, tasks }
      recordTaskMutation(current, next)
      commitSnapshot(next)
      void dualWriteAssistantImportTasks(
        resolvePlanningContext(),
        previousTasks,
        tasks
      ).then((batch) => {
        for (const write of batch.writes) {
          reportPlanningWrite(write)
        }
      })
    }
    window.addEventListener(STUDY_TASKS_CHANGED_EVENT, syncImportedTasks)
    return () => window.removeEventListener(STUDY_TASKS_CHANGED_EVENT, syncImportedTasks)
  }, [workspaceId])

  /**
   * Sole-read hydrate: when workspace root is active, replace UI tasks/timerPlans
   * from canonical snapshot.json if it has tasks. Also sole-read
   * preferences.defaultTimerPlanId + scheduleBlocks + timerSessions cache.
   * Keep V1 when canonical empty / fail. Presence shell stays host-owned.
   */
  useEffect(() => {
    let cancelled = false
    const root = typeof workspaceRoot === 'string' ? workspaceRoot.trim() : ''
    if (!root) return

    const ctx = resolvePlanningContext()
    const hostAtStart = snapshotRef.current
    const expectedHostTasks = hostAtStart.tasks.slice()

    void hydrateStudyTasksFromCanonical(
      {
        api: ctx.api,
        workspaceRoot: ctx.workspaceRoot
      },
      hostAtStart,
      {
        expectedHostTasks,
        getCurrentHostTasks: () => snapshotRef.current.tasks
      }
    ).then((result) => {
      if (cancelled) return
      if (result.kind === 'kept_v1') {
        if (
          !migrationDismissedRef.current &&
          shouldOfferMigrationBanner({
            migrationSuggested: result.migrationSuggested,
            hostTaskCount: snapshotRef.current.tasks.length,
            hostHasOnlyDefaultTasks: isDefaultStudyTaskSeed(snapshotRef.current.tasks),
            reason: result.reason
          })
        ) {
          const current = snapshotRef.current
          const dry = dryRunV1Migration(
            {
              tasks: current.tasks,
              timerPlans: current.timerPlans,
              simulationStartTime: current.simulationStartTime,
              simulationEndTime: current.simulationEndTime,
              focusMinutes: current.focusMinutes,
              breakMinutes: current.breakMinutes
            }
          )
          if (dry.ok) {
            setMigrationOffer({
              summary: {
                taskCount: dry.summary.taskCount,
                scheduleBlockCount: dry.summary.scheduleBlockCount,
                timerPlanCount: dry.summary.timerPlanCount,
                suggestedWindowCount: dry.summary.suggestedWindowCount
              },
              reason: result.reason
            })
            setMigrationError(null)
          }
        }
        return
      }
      if (result.kind !== 'applied') return
      // Canonical applied — clear any migration prompt.
      setMigrationOffer(null)
      setMigrationError(null)
      // Offer demote when sole-read applied + V1 still co-caches (never auto-erase).
      if (
        !v1DemoteDismissedRef.current &&
        !isV1LocalAuthorityDemoted() &&
        canOfferV1Demote({
          migrationCommitted: migrationCommittedThisSessionRef.current,
          hydrateApplied: true,
          canonicalTaskCount: result.snapshot.tasks.length,
          hostTaskCount: snapshotRef.current.tasks.length,
          workspaceAvailable: true,
          alreadyDemoted: false
        })
      ) {
        const cats = readStudyTaskCategories()
        setV1DemoteOffer({
          taskCount: Math.max(result.snapshot.tasks.length, snapshotRef.current.tasks.length),
          timerPlanCount: snapshotRef.current.timerPlans.length,
          categoryCount: cats.length,
          reason: migrationCommittedThisSessionRef.current ? 'post_migrate' : 'post_hydrate'
        })
        setV1DemoteError(null)
      }
      // Always refresh blocks + timerSessions + prefs on successful read (even if task list race-skips).
      setScheduleBlocks(result.scheduleBlocks.slice())
      setTimerSessions(result.timerSessions.slice())
      // Fall back to classic only when preference is unset; keep last applied id when present.
      const resolvedDefaultId = result.defaultTimerPlanId ?? 'classic_25_5'
      setDefaultTimerPlanId(resolvedDefaultId)
      setEmptyStartPolicy(result.emptyStartPolicy)
      setEmptyStartCategoryId(result.emptyStartCategoryId)
      setClassificationPromptOptOut(result.classificationPromptOptOut)
      setRecurrenceRules(result.recurrenceRules.slice())
      if (result.categories) {
        setCanonicalCategories(result.categories)
        if (!(v1AuthorityDemoted || isV1LocalAuthorityDemoted())) {
          persistStudyTaskCategories(result.categories)
        }
      }
      // STC-206: cold-start reattach of durable open TimerSession (running/paused/needs_reconcile).
      // Fail-closed if local UI already owns a live session (no clobber mid-run).
      if (!cancelled) {
        const reattach = projectRehydrateActiveTimerSession({
          timerSessions: result.timerSessions,
          nowMs: Date.now(),
          localSession: canonicalFocusSessionRef.current
        })
        if (reattach.kind === 'reattach') {
          canonicalTimerSessionIdRef.current = reattach.session.id
          canonicalFocusSessionRef.current = reattach.session
          setActiveTimerSession(reattach.session)
          const host = snapshotRef.current
          const shelled = mergeTimerWakeShellIntoSnapshot(host, reattach.shell)
          // handleNeedsReconcile pins when reconcile; short-gap reattach still pins advance.
          if (reattach.pinDurableAdvance && !reattach.needsReconcile) {
            dualWriteFocusTimerTransition({ kind: 'pin_needs_reconcile' })
          }
          if (reattach.needsReconcile) {
            commitSnapshot({
              ...shelled,
              timerState: 'paused'
            })
            void handleNeedsReconcile(
              reattach.session,
              reattach.gapSeconds,
              { ...shelled, timerState: 'paused' }
            )
          } else {
            commitSnapshot(shelled)
          }
        }
      }
      const current = snapshotRef.current
      // Re-check race at apply time (getCurrentHostTasks already checked inside hydrate).
      if (!studyTasksEqual(current.tasks, expectedHostTasks)) return
      const next = result.snapshot
      // Preserve host shell fields that advanced during the await (timer etc.).
      // Sole-read tasks always; overlay timerPlans when canonical projected any.
      const mergedBase: StudySnapshot = {
        ...current,
        tasks: next.tasks,
        ...(result.timerPlansProjected > 0 ? { timerPlans: next.timerPlans } : {}),
        ...(result.simulationStartTime && result.simulationEndTime
          ? {
              simulationStartTime: result.simulationStartTime,
              simulationEndTime: result.simulationEndTime
            }
          : {})
      }
      // Cold start: when idle, re-apply default plan fields so restart restores last applied plan.
      // Skip when a live timer session is running/paused (planSnapshot is frozen for the run).
      let merged: StudySnapshot = mergedBase
      const idleForDefault =
        mergedBase.timerState !== 'running'
        && mergedBase.timerState !== 'paused'
        && !canonicalFocusSessionRef.current
      if (idleForDefault) {
        const defaultId = resolvedDefaultId
        const defaultPlan = resolveTimerPlanShellForCatalog(defaultId, mergedBase.timerPlans)
        if (defaultPlan) {
          merged = applyStudyTimerPlan(mergedBase, defaultPlan)
        }
      }
      const tasksUnchanged = studyTasksEqual(current.tasks, merged.tasks)
      const plansUnchanged =
        result.timerPlansProjected === 0 ||
        JSON.stringify(current.timerPlans) === JSON.stringify(merged.timerPlans)
      const simUnchanged =
        current.simulationStartTime === merged.simulationStartTime &&
        current.simulationEndTime === merged.simulationEndTime
      const presetUnchanged =
        current.focusMinutes === merged.focusMinutes
        && current.breakMinutes === merged.breakMinutes
        && current.remainingSeconds === merged.remainingSeconds
      if (tasksUnchanged && plansUnchanged && simUnchanged && presetUnchanged) return
      if (!tasksUnchanged) {
        recordTaskMutation(current, merged)
      }
      commitSnapshot(merged)
    })

    return () => {
      cancelled = true
    }
    // resolvePlanningContext / snapshotRef intentionally not deps — re-run on workspace only.
  }, [workspaceRoot, planningApi])

  useEffect(() => {
    syncStudyLocation(snapshot.spaceCode, snapshot.roomId)
  }, [snapshot.roomId, snapshot.spaceCode])

  useEffect(() => {
    if (!viewModel.userSeatConflict) {
      lastSeatConflictResolutionRef.current = ''
      return
    }

    const nextSeatIndex = viewModel.nextAvailableSeat
    const conflictKey = [
      snapshot.spaceCode,
      snapshot.roomId,
      snapshot.clientId,
      viewModel.userSeat,
      snapshot.seatClaimedAt,
      viewModel.seatConflictWinnerClientId,
      nextSeatIndex ?? 'full'
    ].join(':')
    if (lastSeatConflictResolutionRef.current === conflictKey) return
    lastSeatConflictResolutionRef.current = conflictKey

    if (nextSeatIndex === null) {
      roomEventSenderRef.current(
        'checkin',
        `${snapshot.nickname} 的座位发生冲突，当前房间暂无空座。`,
        { roomId: snapshot.roomId, spaceCode: snapshot.spaceCode }
      )
      return
    }

    const previousSeatIndex = viewModel.userSeat
    const previousSeatClaimedAt = snapshot.seatClaimedAt
    const current = snapshotRef.current
    if (
      current.clientId === snapshot.clientId
      && current.spaceCode === snapshot.spaceCode
      && current.roomId === snapshot.roomId
      && current.seatIndex === previousSeatIndex
      && current.seatClaimedAt === previousSeatClaimedAt
    ) {
      commitSnapshot(chooseStudySeatSnapshot(current, nextSeatIndex))
    }
    roomEventSenderRef.current(
      'checkin',
      `${snapshot.nickname} 的座位冲突，已换到 ${formatStudySeatLabel(nextSeatIndex)}。`,
      { roomId: snapshot.roomId, spaceCode: snapshot.spaceCode }
    )
  }, [
    snapshot.clientId,
    snapshot.nickname,
    snapshot.roomId,
    snapshot.seatClaimedAt,
    snapshot.spaceCode,
    viewModel.nextAvailableSeat,
    viewModel.seatConflictWinnerClientId,
    viewModel.userSeat,
    viewModel.userSeatConflict
  ])

  /**
   * STC-206 remainder: OS sleep / tab hide resume + pagehide pin.
   * Renderer-only (no new IPC event channel). Long gap → needs_reconcile via pure wake.
   */
  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return undefined

    const onVisibility = (): void => {
      handleTimerWakeSignal({
        kind: 'visibility_resume',
        nowMs: Date.now(),
        visibilityState: document.visibilityState
      })
    }
    const onPageHide = (): void => {
      handleTimerWakeSignal({
        kind: 'pagehide',
        nowMs: Date.now()
      })
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
    // handleTimerWakeSignal closes over stable refs; re-bind only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only wake listeners
  }, [])

  /**
   * ADR-0129 OS bridge: main powerMonitor suspend/resume -> existing wake path.
   * Thin subscribe only; pin stays renderer dual-write (no main sole-writer).
   */
  useEffect(() => {
    const api =
      typeof window !== 'undefined'
        ? (window.teachingSystem as SystemPowerSubscribeApi | undefined)
        : undefined
    return subscribePlanningTimerOsPower({
      api,
      onWake: handleTimerWakeSignal
    })
    // handleTimerWakeSignal closes over stable refs; re-bind only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only OS power subscribe
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setRoomCycleNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (snapshot.timerState !== 'running') return undefined
    const id = window.setInterval(() => {
      const current = snapshotRef.current
      if (current.timerState !== 'running') return

      // TimerSession sole-read display for focus + break (pure local advance, no disk thrash).
      // Mode handoff is product-path (STC-205); analytics facts from TimerSession on close.
      // Live focus-second counters credit from TimerSession deltas (not V1 twin).
      if (canonicalFocusSessionRef.current) {
        const hostBefore = current
        const previousSession = canonicalFocusSessionRef.current
        const advanced = lifecycle.advance(hostBefore, { taskId: selectedTaskId, workspaceId })
        // Suppress V1 study_session completion facts; TimerSession projects them on close.
        dispatchLifecycleIntentsRespectingTimerSession(advanced.intents)
        // Drop V1 twin focus-second mutation; keep completion shell (sessions/xp/mode) if any.
        const stripped = stripV1LiveFocusCounterMutation({
          hostBefore,
          hostAfterV1Advance: advanced.snapshot
        })
        const projected = projectAndMergeFocusTimerClock(stripped)
        const localToday = getLocalDateKey(Date.now(), resolvedLocalTimeZone())
        const creditedSnapshot = applyTimerSessionFocusCounterCredit({
          host: projected.snapshot,
          previousSession,
          nextSession: canonicalFocusSessionRef.current,
          localToday
        })
        if (projected.needsReconcile && canonicalFocusSessionRef.current) {
          const reconSession = canonicalFocusSessionRef.current
          void handleNeedsReconcile(
            reconSession,
            projected.gapSeconds || reconSession.pendingReconcileSeconds || 0,
            creditedSnapshot
          )
          return
        }
        if (advanced.completed) {
          const closed = canonicalFocusSessionRef.current
          const wasFocus =
            hostBefore.timerMode === 'focus' &&
            closed &&
            closed.phase === 'focus'
          const wasBreak =
            closed &&
            (closed.phase === 'short_break' || closed.phase === 'long_break')
          if (wasFocus) {
            void handleFocusSegmentComplete(closed, creditedSnapshot)
          } else if (wasBreak) {
            void handleBreakSegmentComplete(closed, creditedSnapshot)
          } else {
            dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
            commitSnapshot(creditedSnapshot)
          }
          return
        }
        // TimerSession hit target first: close + handoff (focus) or pin remaining 0.
        if (projected.completed) {
          const closed = canonicalFocusSessionRef.current
          const wasFocus =
            hostBefore.timerMode === 'focus' &&
            closed &&
            closed.phase === 'focus'
          const wasBreak =
            closed &&
            (closed.phase === 'short_break' || closed.phase === 'long_break')
          if (wasFocus && closed) {
            // Ensure closed session is marked completed for handoff projection.
            const completedSession: TimerSessionRecord = {
              ...closed,
              state: 'completed',
              endedAtMs: Date.now()
            }
            void handleFocusSegmentComplete(completedSession, {
              ...creditedSnapshot,
              remainingSeconds: 0
            })
          } else if (wasBreak && closed) {
            const completedSession: TimerSessionRecord = {
              ...closed,
              state: 'completed',
              endedAtMs: Date.now()
            }
            void handleBreakSegmentComplete(completedSession, {
              ...creditedSnapshot,
              remainingSeconds: 0
            })
          } else {
            dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
            commitSnapshot({ ...creditedSnapshot, remainingSeconds: 0 })
          }
          return
        }
        commitSnapshot(creditedSnapshot)
        return
      }

      const advanced = lifecycle.advance(current, { taskId: selectedTaskId, workspaceId })
      dispatchLifecycleIntents(advanced.intents)
      if (advanced.completed) {
        if (current.timerMode === 'focus') {
          // No canonical session: keep V1 auto handoff (legacy path).
          dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
          commitSnapshot(advanced.snapshot)
        } else {
          dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
          commitSnapshot(advanced.snapshot)
        }
      } else {
        commitSnapshot(advanced.snapshot)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [snapshot.timerState, selectedTaskId, workspaceId])

  const updateTimerPreset = (focusMinutes: number, breakMinutes: number): void => {
    commitSnapshot(updateStudyTimerPreset(snapshotRef.current, focusMinutes, breakMinutes))
  }

  const makeTimerPlanId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `timer-plan-${crypto.randomUUID()}`
    return `timer-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  /**
   * Upsert a timer plan (optional id keeps identity) and apply it to the active preset.
   * `applyOnly: true` updates the active timer/window without writing the catalog.
   * Returns the catalog plan id when saved, or null for apply-only.
   */
  const saveTimerPlan = (
    input: StudyTimerPlanInput & { id?: string; applyOnly?: boolean }
  ): string | null => {
    const ctx = resolvePlanningContext()
    if (input.applyOnly) {
      const shell = {
        id: input.id?.trim() || 'apply-only',
        name: input.name?.trim() || '',
        focusMinutes: input.focusMinutes,
        breakMinutes: input.breakMinutes,
        simulationStartTime: input.simulationStartTime,
        simulationEndTime: input.simulationEndTime,
        longBreakMinutes: input.longBreakMinutes,
        longBreakEvery: input.longBreakEvery,
        breakPolicy: input.breakPolicy,
        kind: input.kind,
        clockMode: input.clockMode,
        continuousMode: input.continuousMode,
        continuousTarget: input.continuousTarget,
        rhythmSequence: input.rhythmSequence
      }
      commitSnapshot(applyStudyTimerPlan(snapshotRef.current, shell))
      void dualWriteSetSimulationWindow(ctx, {
        simulationStartTime: shell.simulationStartTime,
        simulationEndTime: shell.simulationEndTime
      }).then(reportPlanningWrite)
      return null
    }
    const id = input.id?.trim() || makeTimerPlanId()
    const plan = {
      name: input.name,
      focusMinutes: input.focusMinutes,
      breakMinutes: input.breakMinutes,
      simulationStartTime: input.simulationStartTime,
      simulationEndTime: input.simulationEndTime,
      longBreakMinutes: input.longBreakMinutes,
      longBreakEvery: input.longBreakEvery,
      breakPolicy: input.breakPolicy,
      kind: input.kind,
      clockMode: input.clockMode,
      continuousMode: input.continuousMode,
      continuousTarget: input.continuousTarget,
      rhythmSequence: input.rhythmSequence,
      id
    }
    commitSnapshot(saveStudyTimerPlan(snapshotRef.current, plan))
    // Dual-write custom plan into canonical catalog (TimerPlanV2).
    void dualWriteSaveTimerPlan(ctx, plan).then(reportPlanningWrite)
    // Sole-authority demotion: active simulation window → preferences (not plan field).
    void dualWriteSetSimulationWindow(ctx, {
      simulationStartTime: plan.simulationStartTime,
      simulationEndTime: plan.simulationEndTime
    }).then(reportPlanningWrite)
    return id
  }

  const applyTimerPlan = (planId: string): void => {
    const plan = resolveTimerPlanShellForCatalog(planId, snapshotRef.current.timerPlans)
    if (!plan) return
    commitSnapshot(applyStudyTimerPlan(snapshotRef.current, plan))
    // Persist as default so cold start restores the last applied plan (not classic seed).
    const id = plan.id.trim()
    if (id) {
      setDefaultTimerPlanId(id)
      void dualWriteSetDefaultTimerPlan(resolvePlanningContext(), id).then(reportPlanningWrite)
    }
    // Apply selects local preset; also dual-write active simulation window preferences.
    void dualWriteSetSimulationWindow(resolvePlanningContext(), {
      simulationStartTime: plan.simulationStartTime,
      simulationEndTime: plan.simulationEndTime
    }).then(reportPlanningWrite)
  }

  const removeTimerPlan = (planId: string): void => {
    if (isReadonlyTimerPlanId(planId)) return
    commitSnapshot(removeStudyTimerPlan(snapshotRef.current, planId))
    void dualWriteDeleteTimerPlan(resolvePlanningContext(), planId).then(reportPlanningWrite)
  }

  /**
   * STC-501/502: copy a catalog plan as custom (V1 cache + durable copy_timer_plan).
   * Source may be a user plan already in snapshot.timerPlans.
   */
  const copyTimerPlan = (sourcePlanId: string, newName?: string): string | null => {
    const source = resolveTimerPlanShellForCatalog(sourcePlanId, snapshotRef.current.timerPlans)
    if (!source) return null
    const newId = makeTimerPlanId()
    const name = (newName?.trim() || `${source.name} 副本`).slice(0, 24)
    const copied = {
      ...source,
      id: newId,
      name
    }
    commitSnapshot(saveStudyTimerPlan(snapshotRef.current, copied))
    void dualWriteCopyTimerPlan(resolvePlanningContext(), {
      sourceId: sourcePlanId,
      newId,
      newName: name
    }).then(reportPlanningWrite)
    return newId
  }

  /**
   * STC-502: rename custom plan only (builtin identity readonly).
   * Returns false when refused so UI can keep rename draft open.
   */
  const renameTimerPlan = (planId: string, name: string): boolean => {
    // System seeds may be renamed (materialized under the same id); only delete is blocked.
    const current = snapshotRef.current
    const renamed = renameTimerPlanInV1List(current.timerPlans, planId, name)
    if (!renamed.ok) return false
    const plan = renamed.plans.find((p) => p.id === planId)
    if (!plan) return false
    commitSnapshot({ ...current, timerPlans: renamed.plans })
    void dualWriteRenameTimerPlan(resolvePlanningContext(), {
      planId,
      name: plan.name,
      focusMinutes: plan.focusMinutes,
      breakMinutes: plan.breakMinutes,
      longBreakMinutes: plan.longBreakMinutes,
      longBreakEvery: plan.longBreakEvery,
      breakPolicy: plan.breakPolicy,
      kind: plan.kind,
      clockMode: plan.clockMode,
      continuousMode: plan.continuousMode,
      continuousTarget: plan.continuousTarget,
      rhythmSequence: plan.rhythmSequence,
      simulationStartTime: plan.simulationStartTime,
      simulationEndTime: plan.simulationEndTime
    }).then(reportPlanningWrite)
    return true
  }

  /**
   * STC-502: set default TimerPlan preference (V1 mirror + set_preferences dual-write).
   */
  const setDefaultTimerPlan = (planId: string): void => {
    const id = planId.trim()
    if (!id) return
    setDefaultTimerPlanId(id)
    void dualWriteSetDefaultTimerPlan(resolvePlanningContext(), id).then(reportPlanningWrite)
  }

  /**
   * STC-404: set empty-start preference (session sole-read + set_preferences dual-write).
   */
  const setEmptyStartPolicyPreference = (policy: EmptyStartPolicy): void => {
    const next = normalizeEmptyStartPolicy(policy)
    setEmptyStartPolicy(next)
    void dualWriteSetEmptyStartPolicy(resolvePlanningContext(), next).then(reportPlanningWrite)
  }

  /**
   * Empty-start category preference (session sole-read + set_preferences dual-write).
   * Always pairs with remember_quick_start so empty timer start creates a temp task.
   */
  const setEmptyStartCategoryIdPreference = (categoryId: string): void => {
    const known = (canonicalCategories ?? listStudyTaskCategories()).map((c) => c.id)
    const next = normalizeEmptyStartCategoryId(categoryId, known)
    setEmptyStartCategoryId(next)
    // Product path: category picker implies quick_start (not ask / unattributed).
    setEmptyStartPolicy('remember_quick_start')
    void dualWriteSetPreferences(resolvePlanningContext(), {
      emptyStartCategoryId: next,
      emptyStartPolicy: 'remember_quick_start'
    }).then(reportPlanningWrite)
  }

  /**
   * STC-404/406: restore or enable classification prompt opt-out preference.
   */
  const setClassificationPromptOptOutPreference = (optOut: boolean): void => {
    setClassificationPromptOptOut(optOut === true)
    void dualWriteSetClassificationPromptOptOut(
      resolvePlanningContext(),
      optOut === true
    ).then(reportPlanningWrite)
  }

  /**
   * STC-703: full-replace durable recurrenceRules (sole-read mirror + set_preferences).
   * Prefer re-read mirror from dual-write snapshot when present (same pattern as other prefs).
   * Explicit host/page save only — never auto-expand / silent invent.
   * Returns true only on canonical_ok (or skipped with optimistic local mirror when no workspace).
   */
  const setRecurrenceRulesPreference = async (
    rules: readonly RecurrenceRule[]
  ): Promise<boolean> => {
    const next = Array.isArray(rules) ? rules.slice() : []
    setRecurrenceRules(next)
    const result = await dualWriteSetPreferences(resolvePlanningContext(), {
      recurrenceRules: next
    })
    reportPlanningWrite(result)
    if (result.kind === 'canonical_ok') {
      const fromSnap = result.result.snapshot?.preferences?.recurrenceRules
      if (Array.isArray(fromSnap)) {
        setRecurrenceRules(fromSnap.slice())
      }
      return true
    }
    if (result.kind === 'canonical_skipped') {
      // No workspace/API — local mirror only; page may still show fail for durable save.
      return false
    }
    return false
  }


  const toggleContract = (): void => {
    const current = snapshotRef.current
    commitSnapshot(toggleStudyContract(current, defaultStudyContractText(current, viewModel.activeMode.name)))
  }

  const updateContractText = (contractText: string): void => {
    commitSnapshot(updateStudyContractText(snapshotRef.current, contractText))
  }

  const saveNickname = (nicknameInput: string): void => {
    commitSnapshot(saveStudyNickname(snapshotRef.current, nicknameInput))
  }

  const joinSpace = (spaceInput: string): void => {
    commitSnapshot(joinStudySpace(snapshotRef.current, spaceInput))
  }

  const enterRandomSpace = (): void => {
    commitSnapshot(setStudySpaceCode(snapshotRef.current, randomStudySpaceCode()))
  }

  const saveRelayUrl = (relayInput: string): string => {
    const result = saveStudyRelayUrl(snapshotRef.current, relayInput)
    commitSnapshot(result.snapshot)
    return result.relayUrl
  }

  const resetRelayUrl = (): void => {
    commitSnapshot(resetStudyRelayUrl(snapshotRef.current))
  }

  const setSelectedTaskId = (taskId: string | null): void => {
    if (selectedTaskIdProp !== undefined) return
    setInternalSelectedTaskId(taskId)
  }

  const selectTask = (taskId: string | null): void => {
    const nextId =
      taskId === null
        ? null
        : snapshotRef.current.tasks.some((task) => task.id === taskId)
          ? taskId
          : null
    setSelectedTaskId(nextId)

    // STC-204 product path: mid-run focus task switch → switch_session_task dual-write.
    const active = canonicalFocusSessionRef.current
    if (
      active &&
      (active.state === 'running' || active.state === 'paused') &&
      active.phase === 'focus' &&
      (active.taskId ?? null) !== (nextId ?? null)
    ) {
      const hostBefore = snapshotRef.current
      const next = dualWriteFocusTimerTransition({ kind: 'switch_task', newTaskId: nextId })
      const closed = next.closedSession
      if (closed) {
        const hostWithAnalytics = emitTimerSessionCloseAnalytics(closed, 'interrupted', hostBefore, {
          discardV1Twin: true
        })
        if (hostWithAnalytics !== hostBefore) {
          commitSnapshot(hostWithAnalytics)
        }
      }
    }
  }

  /**
   * Prefer explicit task, then selected focus task. Never silent-bind first open task (STC-401).
   * When empty, consult emptyStartPolicy / onEmptyStartAsk (may open EmptyStartSheet).
   * Returns null for unattributed; undefined means start aborted (ask dismissed).
   */
  const resolveFocusTaskId = async (
    explicit?: string | null
  ): Promise<string | null | undefined> => {
    const tasks = snapshotRef.current.tasks
    const firstPass = resolveStudyFocusAttribution({
      ...(explicit !== undefined ? { explicitTaskId: explicit } : {}),
      selectedTaskId,
      tasks,
      emptyStartPolicy
    })
    let attr = firstPass
    let pickOverride: string | null = null
    let quickStartTitle: string | undefined

    if (attr.kind === 'ask') {
      if (!onEmptyStartAsk) {
        // No UI host: never silent-bind first open task; start unattributed (freeze #1 spirit).
        return null
      }
      const raw = await onEmptyStartAsk(attr.policy)
      if (raw == null) return undefined

      let userChoice: EmptyStartChoice
      if (typeof raw === 'string') {
        userChoice = raw
      } else {
        userChoice = raw.choice
        if (raw.choice === 'pick_task') pickOverride = raw.taskId
        if (raw.choice === 'quick_start') quickStartTitle = raw.title
      }

      const selectedForPick =
        userChoice === 'pick_task'
          ? (pickOverride ?? selectedTaskId)
          : selectedTaskId

      attr = resolveStudyFocusAttribution({
        ...(explicit !== undefined ? { explicitTaskId: explicit } : {}),
        selectedTaskId: selectedForPick,
        tasks,
        emptyStartPolicy,
        userChoice
      })
      if (attr.kind === 'ask') return undefined
    }

    if (attr.kind === 'quick_start') {
      // Create temporary task under builtin 「其他」 (+ dual-write) then attribute timer to it.
      const title = normalizeQuickStartTitle(quickStartTitle)
      const createdId = createQuickStartTask(title)
      if (!createdId) return undefined
      return createdId
    }

    const mapped = attributionToTaskId(attr)
    if (mapped === 'ask') return undefined
    if (mapped === 'quick_start') {
      const createdId = createQuickStartTask(normalizeQuickStartTitle(quickStartTitle))
      return createdId ?? undefined
    }
    return mapped
  }

  /**
   * V1 UI path for STC-402 quick_start: create temporary task with shared id,
   * dual-write create_task source=quick_start (not full store quick_start session —
   * TimerSession durable is Slice D).
   */
  const createQuickStartTask = (titleInput: string): string | null => {
    const title = normalizeQuickStartTitle(titleInput)
    const current = snapshotRef.current
    const taskId = createStudyAnalyticsFactId('quick-start')
    // Empty-start / quick-start attributes time to emptyStartCategoryId (default 「其他」).
    const categoryId = normalizeEmptyStartCategoryId(
      emptyStartCategoryIdRef.current,
      (canonicalCategories ?? listStudyTaskCategories()).map((c) => c.id)
    )
    const result = addStudyTask(current, title, taskId, categoryId)
    if (!result.added) return null
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    if (selectedTaskIdProp === undefined) {
      setInternalSelectedTaskId(taskId)
    }
    void dualWriteCreateTask(resolvePlanningContext(), {
      id: taskId,
      title,
      categoryId,
      source: 'quick_start'
    }).then(reportPlanningWrite)
    return taskId
  }

  const toggleTimer = async (taskId?: string | null): Promise<void> => {
    // Pause/resume of an already-running or paused timer does not re-open empty-start.
    const current = snapshotRef.current
    if (current.timerState === 'running' || current.timerState === 'paused') {
      // STC-206: if still awaiting reconcile, re-open sheet instead of silent resume discard.
      const pending = canonicalFocusSessionRef.current
      if (
        pending &&
        pending.state === 'needs_reconcile' &&
        current.timerState === 'paused'
      ) {
        void handleNeedsReconcile(
          pending,
          pending.pendingReconcileSeconds ?? 0,
          current
        )
        return
      }
      const prevState = current.timerState
      const result = lifecycle.toggle(current, {
        taskId: selectedTaskId,
        workspaceId,
        activeModeName: viewModel.activeMode.name
      })
      dispatchLifecycleIntentsRespectingTimerSession(result.intents)
      // Dual-write pause/resume/finish for focus + break TimerSessions.
      if (!result.completed) {
        if (prevState === 'running' && result.snapshot.timerState === 'paused') {
          dualWriteFocusTimerTransition({ kind: 'pause' })
        } else if (prevState === 'paused' && result.snapshot.timerState === 'running') {
          dualWriteFocusTimerTransition({ kind: 'resume' })
        }
      }
      if (result.completed) {
        const closed = canonicalFocusSessionRef.current
        const wasFocus =
          current.timerMode === 'focus' &&
          closed &&
          closed.phase === 'focus'
        const wasBreak =
          closed &&
          (closed.phase === 'short_break' || closed.phase === 'long_break')
        if (wasFocus && closed) {
          const completedSession: TimerSessionRecord = {
            ...closed,
            state: closed.state === 'completed' ? closed.state : 'completed',
            endedAtMs: closed.endedAtMs ?? Date.now()
          }
          void handleFocusSegmentComplete(completedSession, result.snapshot)
        } else if (wasBreak && closed) {
          const completedSession: TimerSessionRecord = {
            ...closed,
            state: closed.state === 'completed' ? closed.state : 'completed',
            endedAtMs: closed.endedAtMs ?? Date.now()
          }
          void handleBreakSegmentComplete(completedSession, result.snapshot)
        } else {
          dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
          const v1AlreadyCompletedShell =
            result.snapshot.timerMode === 'break' && result.snapshot.timerState === 'idle'
          const hostAfter = emitTimerSessionCloseAnalytics(
            closed,
            'completed',
            result.snapshot,
            {
              applyShellStats:
                current.timerMode === 'focus' && !v1AlreadyCompletedShell
            }
          )
          commitSnapshot(hostAfter)
        }
        return
      }
      // Sole-read: after pause/resume, project local TimerSession into remainingSeconds.
      if (canonicalFocusSessionRef.current) {
        commitSnapshot(projectAndMergeFocusTimerClock(result.snapshot, Date.now(), { fullState: true }).snapshot)
      } else {
        commitSnapshot(result.snapshot)
      }
      return
    }

    const resolvedTaskId = await resolveFocusTaskId(taskId)
    if (resolvedTaskId === undefined) return
    if (resolvedTaskId && selectedTaskIdProp === undefined && resolvedTaskId !== selectedTaskId) {
      setInternalSelectedTaskId(resolvedTaskId)
    }
    const before = snapshotRef.current
    const result = lifecycle.toggle(before, {
      taskId: resolvedTaskId,
      workspaceId,
      activeModeName: viewModel.activeMode.name
    })
    dispatchLifecycleIntents(result.intents)
    commitSnapshot(result.snapshot)
    // Dual-write start for focus + break — freezes planSnapshot on durable store.
    if (before.timerState === 'idle' && result.snapshot.timerState === 'running') {
      if (before.timerMode === 'focus') {
        dualWriteFocusTimerTransition({
          kind: 'start',
          taskId: resolvedTaskId,
          targetSeconds: result.snapshot.remainingSeconds,
          phase: 'focus'
        })
      } else {
        const breakPhase = resolveBreakPhaseFromPlan({
          breakMinutes: result.snapshot.breakMinutes
        })
        dualWriteFocusTimerTransition({
          kind: 'start',
          taskId: null,
          targetSeconds: result.snapshot.remainingSeconds,
          phase: breakPhase
        })
      }
      // Align V1 remainingSeconds cache with sole-read TimerSession projection.
      if (canonicalFocusSessionRef.current) {
        commitSnapshot(projectAndMergeFocusTimerClock(result.snapshot).snapshot)
      }
    }
  }

  const followRoomCycle = async (): Promise<void> => {
    // Empty-start / attribution first — same gate as toggleTimer personal start.
    const resolvedTaskId = await resolveFocusTaskId()
    if (resolvedTaskId === undefined) return
    if (resolvedTaskId && selectedTaskIdProp === undefined && resolvedTaskId !== selectedTaskId) {
      setInternalSelectedTaskId(resolvedTaskId)
    }
    const roomPhase = viewModel.roomCycle.phase
    const room = viewModel.activeRoom
    // V1 lifecycle: finish prior session (interrupted) + align clock to room cycle.
    const priorSession = canonicalFocusSessionRef.current
    const result = lifecycle.followRoomCycle(snapshotRef.current, {
      taskId: resolvedTaskId,
      workspaceId,
      room,
      phase: roomPhase,
      remainingSeconds: viewModel.roomCycle.remainingSeconds,
      activeModeName: viewModel.activeMode.name
    })
    if (priorSession) {
      dispatchLifecycleIntents(filterV1SessionCompletionAnalyticsIntents(result.intents))
      // Prior segment fact from TimerSession (interrupted); room cycle starts a new segment.
      void emitTimerSessionCloseAnalytics(priorSession, 'interrupted', result.snapshot, {
        applyShellStats: false,
        // followRoomCycle already created the next V1 twin for the room segment.
        discardV1Twin: false
      })
    } else {
      dispatchLifecycleIntents(result.intents)
    }
    commitSnapshot(result.snapshot)
    // Canonical TimerSession: finish prior + start with room remaining/phase.
    // targetSeconds = room remaining (not personal focusMinutes * 60).
    if (result.snapshot.timerState === 'running') {
      const nextRefs = applyRoomCycleTimerSession({
        ctx: resolvePlanningContext(),
        refs: {
          sessionId: canonicalTimerSessionIdRef.current,
          session: canonicalFocusSessionRef.current
        },
        roomPhase,
        remainingSeconds: result.snapshot.remainingSeconds,
        taskId: roomPhase === 'focus' ? resolvedTaskId : null,
        breakMinutes: result.snapshot.breakMinutes,
        onWrite: (writeResult) => {
          reportPlanningWrite(writeResult)
          // Prefer finish snapshots that include a newly closed segment.
          // Ignore pure start applies that race after finish (same store revision chain).
          if (
            writeResult.kind === 'canonical_ok' &&
            writeResult.result.snapshot?.timerSessions?.some(
              (s) => s.state === 'completed' || s.state === 'cancelled'
            )
          ) {
            refreshTimerSessionsFromDualWrite(writeResult)
          }
        }
      })
      canonicalTimerSessionIdRef.current = nextRefs.sessionId
      canonicalFocusSessionRef.current = nextRefs.session
      setActiveTimerSession(nextRefs.session)
      if (canonicalFocusSessionRef.current) {
        commitSnapshot(projectAndMergeFocusTimerClock(result.snapshot).snapshot)
      }
    }
  }

  const runHostAction = (): void => {
    const current = snapshotRef.current
    const action = deriveStudyHostAction(current, viewModel.followingRoomCycle)
    if (action === 'open_focus_theater') {
      openFocusTheater()
      return
    }
    if (action === 'lock_contract') {
      toggleContract()
      return
    }
    if (action === 'follow_room_cycle') {
      void followRoomCycle()
      return
    }
    void toggleTimer()
  }

  const resetTimer = (): void => {
    const prev = snapshotRef.current
    const closedSession = canonicalFocusSessionRef.current
    const finished = lifecycle.finish(prev, 'canceled', { taskId: selectedTaskId, workspaceId })
    // When TimerSession is authority, suppress V1 study_session cancel fact and project from it.
    if (closedSession) {
      dispatchLifecycleIntents(filterV1SessionCompletionAnalyticsIntents(finished.intents))
      dualWriteFocusTimerTransition({ kind: 'finish', reason: 'cancelled' })
      const hostAfter = emitTimerSessionCloseAnalytics(
        closedSession,
        'canceled',
        finished.snapshot,
        { applyShellStats: false }
      )
      commitSnapshot(resetStudyTimer({ ...hostAfter, timerState: 'idle' }))
      return
    }
    dispatchLifecycleIntents(finished.intents)
    commitSnapshot(resetStudyTimer({ ...finished.snapshot, timerState: 'idle' }))
    if (prev.timerState !== 'idle') {
      dualWriteFocusTimerTransition({ kind: 'finish', reason: 'cancelled' })
    }
  }

  const startTimerInMode = async (timerMode: StudyTimerMode): Promise<void> => {
    const current = snapshotRef.current
    if (current.timerMode === timerMode && (current.timerState === 'running' || current.timerState === 'paused')) {
      await toggleTimer()
      return
    }

    const resolvedTaskId = await resolveFocusTaskId()
    if (resolvedTaskId === undefined) return
    if (resolvedTaskId && selectedTaskIdProp === undefined && resolvedTaskId !== selectedTaskId) {
      setInternalSelectedTaskId(resolvedTaskId)
    }
    const latest = snapshotRef.current
    if (latest.timerMode === timerMode) {
      await toggleTimer(resolvedTaskId)
      return
    }

    // A mode tab is only a preview. Finalize the active session and reset the
    // next mode when its explicit start button is pressed, not when the tab is selected.
    const closedSession = canonicalFocusSessionRef.current
    const finished = lifecycle.finish(latest, 'interrupted', { taskId: resolvedTaskId, workspaceId })
    let hostAfterFinish = finished.snapshot
    if (closedSession && latest.timerState !== 'idle') {
      dispatchLifecycleIntents(filterV1SessionCompletionAnalyticsIntents(finished.intents))
      dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
      hostAfterFinish = emitTimerSessionCloseAnalytics(
        closedSession,
        'interrupted',
        finished.snapshot,
        { applyShellStats: false }
      )
    } else {
      dispatchLifecycleIntents(finished.intents)
      if (latest.timerState !== 'idle') {
        dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
      }
    }
    const switched = switchStudyTimerMode({ ...hostAfterFinish, timerState: 'idle' }, timerMode)
    const started = lifecycle.toggle(switched, {
      taskId: resolvedTaskId,
      workspaceId,
      activeModeName: viewModel.activeMode.name
    })
    dispatchLifecycleIntents(started.intents)
    commitSnapshot(started.snapshot)
    if (started.snapshot.timerState === 'running') {
      if (timerMode === 'focus') {
        dualWriteFocusTimerTransition({
          kind: 'start',
          taskId: resolvedTaskId,
          targetSeconds: started.snapshot.remainingSeconds,
          phase: 'focus'
        })
      } else {
        const breakPhase = resolveBreakPhaseFromPlan({
          breakMinutes: started.snapshot.breakMinutes
        })
        dualWriteFocusTimerTransition({
          kind: 'start',
          taskId: null,
          targetSeconds: started.snapshot.remainingSeconds,
          phase: breakPhase
        })
      }
      if (canonicalFocusSessionRef.current) {
        commitSnapshot(projectAndMergeFocusTimerClock(started.snapshot).snapshot)
      }
    }
  }

  const addTask = (titleInput: string): boolean => {
    if (!titleInput.trim()) return false
    const current = snapshotRef.current
    const taskId = createStudyAnalyticsFactId('task')
    const result = addStudyTask(current, titleInput, taskId)
    if (!result.added) return false
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    // Dual-write: same id into workspace canonical (ADR-0117). Fire-and-forget; V1 remains UI cache.
    void dualWriteCreateTask(resolvePlanningContext(), {
      id: taskId,
      title: titleInput.trim().slice(0, 80),
      categoryId: null,
      source: 'manual'
    }).then(reportPlanningWrite)
    return true
  }

  const addScheduledTask = (
    titleInput: string,
    schedule: StudyTaskScheduleInput,
    categoryId?: string | null
  ): boolean => {
    if (!titleInput.trim()) return false
    const current = snapshotRef.current
    const taskId = createStudyAnalyticsFactId('scheduled-task')
    const result = addScheduledStudyTask(
      current,
      titleInput,
      taskId,
      schedule,
      categoryId
    )
    if (!result.added) return false
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    const ctx = resolvePlanningContext()
    const title = titleInput.trim().slice(0, 80)
    void dualWriteCreateTask(ctx, {
      id: taskId,
      title,
      categoryId: categoryId ?? null,
      source: 'manual'
    }).then(async (createResult) => {
      reportPlanningWrite(createResult)
      if (createResult.kind === 'canonical_skipped' || createResult.kind === 'canonical_failed') return
      const now = new Date()
      const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const day = localMidnight.getDay()
      const weekAnchor = new Date(localMidnight)
      weekAnchor.setDate(localMidnight.getDate() - day)
      const blockResult = await dualWriteUpsertScheduleFromV1(ctx, {
        taskId,
        schedule,
        weekAnchorMidnightMs: weekAnchor.getTime()
      })
      reportPlanningWrite(blockResult)
      if (blockResult.kind === 'canonical_ok' && blockResult.result.snapshot?.scheduleBlocks) {
        setScheduleBlocks(blockResult.result.snapshot.scheduleBlocks.slice())
      }
    })
    return true
  }

  const updateTask = (
    taskId: string,
    updateInput: StudyTaskUpdateInput,
    options?: { blockId?: string; weekAnchorMidnightMs?: number }
  ): boolean => {
    const current = snapshotRef.current
    const nowMs = Date.now()
    const weekAnchor =
      options?.weekAnchorMidnightMs
      ?? (() => {
        const d = new Date(nowMs)
        const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        localMidnight.setDate(localMidnight.getDate() - localMidnight.getDay())
        return localMidnight.getTime()
      })()

    // STC-307: when moving a concrete ScheduleBlock, optimistically patch block cache first.
    // V1.task.schedule only mirrors the primary block (rebuildable cache), not every block.
    let nextHost = current
    let hostUpdated = false
    if (updateInput.schedule) {
      const blocks = scheduleBlocksRef.current
      const resolvedBlockId =
        (typeof options?.blockId === 'string' && options.blockId.trim())
        || resolveFocusBlockIdForScheduleUpsert(blocks, taskId, nowMs)
      const interval = monFirstScheduleToIntervalMs({
        weekday: updateInput.schedule.weekday,
        startMinutes: updateInput.schedule.startMinutes,
        endMinutes: updateInput.schedule.endMinutes,
        weekAnchorMidnightMs: weekAnchor
      })
      if (interval) {
        const existing = blocks.find((b) => b.id === resolvedBlockId)
        const nextBlock: ScheduleBlock = {
          id: resolvedBlockId,
          taskId,
          kind: 'focus',
          startAtMs: interval.startAtMs,
          endAtMs: interval.endAtMs,
          locked: existing?.locked ?? false,
          source: existing?.source ?? 'manual',
          status: existing && existing.status !== 'cancelled' ? existing.status : 'planned',
          revision: (existing?.revision ?? 0) + 1,
          ...(existing?.planId ? { planId: existing.planId } : {}),
          ...(existing?.planRevision !== undefined ? { planRevision: existing.planRevision } : {})
        }
        const without = blocks.filter((b) => b.id !== resolvedBlockId)
        const nextBlocks = [...without, nextBlock]
        setScheduleBlocks(nextBlocks)
        scheduleBlocksRef.current = nextBlocks

        const primary = pickPrimaryScheduleBlockForTask(nextBlocks, taskId, nowMs)
        const isPrimary = !primary || primary.id === resolvedBlockId
        if (isPrimary) {
          const result = updateStudyTask(current, taskId, updateInput)
          if (!result.updated) return false
          nextHost = result.snapshot
          hostUpdated = true
        } else {
          // Non-primary block move: keep V1 primary schedule cache as-is.
          hostUpdated = true
          nextHost = current
        }
        // Dual-write always targets the resolved block id.
        void dualWriteUpdateTask(resolvePlanningContext(), {
          taskId,
          update: updateInput,
          weekAnchorMidnightMs: weekAnchor,
          blockId: resolvedBlockId
        }).then((dw) => {
          if (dw.task) reportPlanningWrite(dw.task)
          if (dw.schedule) {
            reportPlanningWrite(dw.schedule)
            if (dw.schedule.kind === 'canonical_ok' && dw.schedule.result.snapshot?.scheduleBlocks) {
              setScheduleBlocks(dw.schedule.result.snapshot.scheduleBlocks.slice())
            }
          }
        })
        if (hostUpdated && nextHost !== current) {
          recordTaskMutation(current, nextHost)
          commitSnapshot(nextHost)
        }
        return true
      }
    }

    const result = updateStudyTask(current, taskId, updateInput)
    if (!result.updated) return false
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    // Dual-write title/category + schedule (week-drag) to canonical (ADR-0117).
    // V1 remains UI cache; done→open reopen uses dualWriteReopenTask (not update_task).
    // STC-307: optional blockId targets the real ScheduleBlock (not always block:task:v1).
    void dualWriteUpdateTask(resolvePlanningContext(), {
      taskId,
      update: updateInput,
      ...(options?.weekAnchorMidnightMs !== undefined
        ? { weekAnchorMidnightMs: options.weekAnchorMidnightMs }
        : {}),
      ...(options?.blockId ? { blockId: options.blockId } : {})
    }).then((dw) => {
      if (dw.task) reportPlanningWrite(dw.task)
      if (dw.schedule) {
        reportPlanningWrite(dw.schedule)
        if (dw.schedule.kind === 'canonical_ok' && dw.schedule.result.snapshot?.scheduleBlocks) {
          setScheduleBlocks(dw.schedule.result.snapshot.scheduleBlocks.slice())
        }
      }
    })
    return true
  }

  const toggleTask = (taskId: string): void => {
    const current = snapshotRef.current
    const task = current.tasks.find((item) => item.id === taskId)
    const completing = Boolean(task && !task.done)
    if (completing && task) {
      emitRoomEvent('task_done', `${current.nickname} 完成任务：${task.title}`)
    }
    const next = toggleStudyTask(current, taskId)
    recordTaskMutation(current, next)
    // Completing the current focus task drops selection so empty-start policy applies next.
    if (
      selectedTaskIdProp === undefined
      && internalSelectedTaskId === taskId
      && task
      && !task.done
    ) {
      setInternalSelectedTaskId(null)
    }
    commitSnapshot(next)
    if (completing) {
      const title = task?.title ?? taskId
      void dualWriteCompleteTask(resolvePlanningContext(), taskId).then(async (result) => {
        reportPlanningWrite(result)
        if (result.kind !== 'canonical_ok') return
        const effects = result.result.effects

        // STC-306: future blocks first (may require second complete_task).
        const need = effects.find(
          (e): e is { type: 'future_blocks_need_decision'; taskId: string; blockIds: string[] } =>
            e.type === 'future_blocks_need_decision'
        )
        if (need && onFutureBlocksNeedDecision) {
          const answer = await onFutureBlocksNeedDecision({
            taskId,
            taskTitle: title,
            futureBlockIds: need.blockIds
          })
          if (answer && answer.decision !== 'dismiss') {
            // Second complete_task with decision applies block disposition (idempotent task already done).
            const follow = await dualWriteCompleteTask(resolvePlanningContext(), taskId, {
              futureBlocksDecision: answer.decision,
              ...(answer.decision === 'reassign'
                ? { reassignTaskId: answer.reassignTaskId ?? null }
                : {})
            })
            reportPlanningWrite(follow)
          }
        }

        // STC-406/407: classification is non-blocking; never rolls back complete.
        const classifyNeed = effects.find(
          (e): e is { type: 'classification_prompt_suggested'; taskId: string } =>
            e.type === 'classification_prompt_suggested'
        )
        if (
          classifyNeed &&
          onClassificationPromptAsk &&
          !classificationPromptOptOutRef.current
        ) {
          const classAnswer = await onClassificationPromptAsk({
            taskId,
            taskTitle: title
          })
          if (!classAnswer || classAnswer.action === 'later' || classAnswer.action === 'keep_inbox') {
            return
          }
          if (classAnswer.action === 'classify') {
            const categoryId = classAnswer.categoryId.trim()
            if (!categoryId) return
            // Optimistic V1 cache: done task gains category (inbox projection clears).
            const host = snapshotRef.current
            const patched = updateStudyTask(host, taskId, { categoryId: categoryId as StudyTaskCategoryId })
            if (patched.updated) {
              recordTaskMutation(host, patched.snapshot)
              commitSnapshot(patched.snapshot)
            }
            const dw = await dualWriteClassificationPromptAnswer(resolvePlanningContext(), {
              taskId,
              action: 'classify',
              selectedCategoryId: categoryId
            })
            if (dw) reportPlanningWrite(dw)
            return
          }
          if (classAnswer.action === 'never_prompt') {
            setClassificationPromptOptOut(true)
            const dw = await dualWriteClassificationPromptAnswer(resolvePlanningContext(), {
              taskId,
              action: 'never_prompt'
            })
            if (dw) reportPlanningWrite(dw)
          }
        }
      })
    } else {
      // done → open: reopen_task sole-authority demotion (history TimerSession keeps taskId).
      void dualWriteReopenTask(resolvePlanningContext(), taskId).then(reportPlanningWrite)
    }
  }

  const removeDoneTasks = (): void => {
    const current = snapshotRef.current
    const doneIds = collectDoneTaskIds(current.tasks)
    const next = removeDoneStudyTasks(current)
    recordTaskMutation(current, next)
    // Drop local schedule blocks for removed done tasks (rebuildable from canonical).
    if (doneIds.length > 0) {
      const drop = new Set(doneIds)
      const remainingBlocks = scheduleBlocksRef.current.filter((b) => !b.taskId || !drop.has(b.taskId))
      if (remainingBlocks.length !== scheduleBlocksRef.current.length) {
        setScheduleBlocks(remainingBlocks)
        scheduleBlocksRef.current = remainingBlocks
      }
    }
    commitSnapshot(next)
    // Canonical soft-cancel each done task (cancel future blocks; no per-task sheet storm).
    if (doneIds.length > 0) {
      void dualWriteRemoveDoneTasks(resolvePlanningContext(), doneIds).then((results) => {
        for (const r of results) reportPlanningWrite(r)
      })
    }
  }

  /**
   * STC-408: classify many inbox tasks with one category (V1 cache + batch_classify_tasks).
   * Does not open per-task classification prompts.
   */
  const batchClassifyTasks = (taskIds: readonly string[], categoryId: string): void => {
    const cat = categoryId.trim()
    if (!cat) return
    const ids = taskIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim())
    if (ids.length === 0) return

    const host = snapshotRef.current
    let next = host
    let any = false
    for (const id of ids) {
      const patched = updateStudyTask(next, id, {
        categoryId: cat as StudyTaskCategoryId
      })
      if (patched.updated) {
        any = true
        next = patched.snapshot
      }
    }
    if (any) {
      recordTaskMutation(host, next)
      commitSnapshot(next)
    }
    void dualWriteBatchClassifyTasks(resolvePlanningContext(), {
      taskIds: ids,
      categoryId: cat
    }).then(reportPlanningWrite)
  }


  const removeTask = (taskId: string): void => {
    const current = snapshotRef.current
    const task = current.tasks.find((item) => item.id === taskId)
    const title = task?.title ?? taskId
    const next = removeStudyTask(current, taskId)
    recordTaskMutation(current, next)
    if (selectedTaskIdProp === undefined && internalSelectedTaskId === taskId) {
      setInternalSelectedTaskId(null)
    }
    // Optimistic local cache: also drop focus blocks for this task (rebuildable from canonical).
    const remainingBlocks = scheduleBlocksRef.current.filter((b) => b.taskId !== taskId)
    if (remainingBlocks.length !== scheduleBlocksRef.current.length) {
      setScheduleBlocks(remainingBlocks)
      scheduleBlocksRef.current = remainingBlocks
    }
    commitSnapshot(next)

    // Canonical soft-delete (status → cancelled) + optional future-blocks disposition (§7.3).
    void dualWriteDeleteTask(resolvePlanningContext(), taskId).then(async (result) => {
      reportPlanningWrite(result)
      if (result.kind !== 'canonical_ok') return
      if (result.result.snapshot?.scheduleBlocks) {
        setScheduleBlocks(result.result.snapshot.scheduleBlocks.slice())
      }
      const need = result.result.effects.find(
        (e): e is { type: 'future_blocks_need_decision'; taskId: string; blockIds: string[] } =>
          e.type === 'future_blocks_need_decision'
      )
      if (!need || !onFutureBlocksNeedDecision) return
      const answer = await onFutureBlocksNeedDecision({
        taskId,
        taskTitle: title,
        futureBlockIds: need.blockIds
      })
      if (!answer || answer.decision === 'dismiss') return
      const follow = await dualWriteDeleteTask(resolvePlanningContext(), taskId, {
        futureBlocksDecision: answer.decision,
        ...(answer.decision === 'reassign'
          ? { reassignTaskId: answer.reassignTaskId ?? null }
          : {})
      })
      reportPlanningWrite(follow)
      if (follow.kind === 'canonical_ok' && follow.result.snapshot?.scheduleBlocks) {
        setScheduleBlocks(follow.result.snapshot.scheduleBlocks.slice())
      }
    })
  }

  /**
   * STC-307: add another focus ScheduleBlock for a task (multi-block).
   * Does not clone Task. V1.task.schedule only updates when the new block becomes primary.
   */
  const createFocusBlock = (
    taskId: string,
    schedule: StudyTaskScheduleInput,
    options?: { weekAnchorMidnightMs?: number; blockId?: string }
  ): string | null => {
    const current = snapshotRef.current
    if (!current.tasks.some((t) => t.id === taskId)) return null
    if (schedule.endMinutes <= schedule.startMinutes) return null

    const nowMs = Date.now()
    const weekAnchor =
      options?.weekAnchorMidnightMs
      ?? (() => {
        const d = new Date(nowMs)
        const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        localMidnight.setDate(localMidnight.getDate() - localMidnight.getDay())
        return localMidnight.getTime()
      })()

    const blockId =
      (typeof options?.blockId === 'string' && options.blockId.trim())
        ? options.blockId.trim()
        : `block:${taskId}:${nowMs}`

    const built = buildFocusScheduleBlockFromV1({
      taskId,
      schedule,
      weekAnchorMidnightMs: weekAnchor,
      blockId,
      existing: null
    })
    if (!built.ok) return null

    const nextBlocks = upsertBlockInLocalCache(scheduleBlocksRef.current, built.block)
    setScheduleBlocks(nextBlocks)
    scheduleBlocksRef.current = nextBlocks

    const primary = pickPrimaryScheduleBlockForTask(nextBlocks, taskId, nowMs)
    if (primary && primary.id === blockId) {
      const result = updateStudyTask(current, taskId, { schedule })
      if (result.updated) {
        recordTaskMutation(current, result.snapshot)
        commitSnapshot(result.snapshot)
      }
    }

    void dualWriteCreateFocusBlock(resolvePlanningContext(), {
      taskId,
      schedule,
      weekAnchorMidnightMs: weekAnchor,
      blockId
    }).then((dw) => {
      reportPlanningWrite(dw)
      if (dw.kind === 'canonical_ok' && dw.result.snapshot?.scheduleBlocks) {
        setScheduleBlocks(dw.result.snapshot.scheduleBlocks.slice())
      }
    })
    return blockId
  }

  /**
   * STC-307: delete one ScheduleBlock by id (not the whole Task).
   * Rebuilds V1 primary schedule cache from remaining focus blocks.
   */
  const deleteScheduleBlock = (taskId: string, blockId: string): boolean => {
    const trimmed = blockId.trim()
    if (!trimmed) return false
    const current = snapshotRef.current
    if (!current.tasks.some((t) => t.id === taskId)) return false

    const nowMs = Date.now()
    const before = scheduleBlocksRef.current
    const existing = before.find((b) => b.id === trimmed)
    // Allow delete even when cache is empty (canonical-only); still dual-write.
    if (existing && existing.locked) return false

    const nextBlocks = removeBlockFromLocalCache(before, trimmed)
    setScheduleBlocks(nextBlocks)
    scheduleBlocksRef.current = nextBlocks

    const clearV1 = shouldClearV1ScheduleAfterDelete({
      blocksBefore: before,
      deletedBlockId: trimmed,
      taskId,
      nowMs
    })
    if (clearV1) {
      const result = updateStudyTask(current, taskId, { schedule: null })
      if (result.updated) {
        recordTaskMutation(current, result.snapshot)
        commitSnapshot(result.snapshot)
      }
    } else {
      const primarySchedule = recomputePrimaryV1Schedule(nextBlocks, taskId, nowMs)
      if (primarySchedule) {
        const result = updateStudyTask(current, taskId, { schedule: primarySchedule })
        if (result.updated) {
          recordTaskMutation(current, result.snapshot)
          commitSnapshot(result.snapshot)
        }
      }
    }

    void dualWriteDeleteScheduleBlock(resolvePlanningContext(), { blockId: trimmed }).then((dw) => {
      reportPlanningWrite(dw)
      if (dw.kind === 'canonical_ok' && dw.result.snapshot?.scheduleBlocks) {
        setScheduleBlocks(dw.result.snapshot.scheduleBlocks.slice())
      }
    })
    return true
  }


  /**
   * STC-205 / §10.3: extend countdown target on active break (or focus) session.
   * Pure local target bump (UI clock authority); does not rewrite planSnapshot.
   * No new durable command — finish dual-write still closes the local session.
   */
  const extendActiveTimerTarget = (input?: {
    addMinutes?: number
    addSeconds?: number
  }): boolean => {
    const session = canonicalFocusSessionRef.current
    if (!session) return false
    const nowMs = Date.now()
    const result = extendTimerSessionTarget({
      session,
      nowMs,
      ...(input?.addSeconds !== undefined ? { addSeconds: input.addSeconds } : {}),
      ...(input?.addMinutes !== undefined ? { addMinutes: input.addMinutes } : {})
    })
    if (!result.ok) return false
    canonicalFocusSessionRef.current = result.session
    if (result.session.id) {
      canonicalTimerSessionIdRef.current = result.session.id
    }
    setActiveTimerSession(result.session)
    const latest = snapshotRef.current
    const isBreak =
      result.session.phase === 'short_break' || result.session.phase === 'long_break'
    const shell: StudySnapshot = {
      ...latest,
      timerMode: isBreak ? 'break' : 'focus',
      timerState:
        result.session.state === 'running'
          ? 'running'
          : result.session.state === 'paused'
            ? 'paused'
            : latest.timerState,
      ...(isBreak
        ? { breakMinutes: Math.max(1, Math.ceil(result.nextTargetSeconds / 60)) }
        : { focusMinutes: Math.max(1, Math.ceil(result.nextTargetSeconds / 60)) })
    }
    commitSnapshot(projectAndMergeFocusTimerClock(shell, nowMs, { fullState: true }).snapshot)
    return true
  }

  return {
    snapshot,
    presence,
    roomCycleNow,
    viewModel,
    selectedTaskId,
    selectTask,
    emitRoomEvent,
    updateTimerPreset,
    toggleContract,
    updateContractText,
    saveNickname,
    joinSpace,
    enterRandomSpace,
    saveRelayUrl,
    resetRelayUrl,
    toggleTimer,
    followRoomCycle,
    runHostAction,
    resetTimer,
    startTimerInMode,
    saveTimerPlan,
    applyTimerPlan,
    removeTimerPlan,
    copyTimerPlan,
    renameTimerPlan,
    setDefaultTimerPlan,
    defaultTimerPlanId,
    emptyStartPolicy,
    setEmptyStartPolicyPreference,
    emptyStartCategoryId,
    setEmptyStartCategoryIdPreference,
    classificationPromptOptOut,
    setClassificationPromptOptOutPreference,
    /** STC-703: sole-read preferences.recurrenceRules for schedule host wire. */
    recurrenceRules,
    setRecurrenceRulesPreference,
    addTask,
    addScheduledTask,
    updateTask,
    toggleTask,
    removeTask,
    removeDoneTasks,
    /** STC-408: batch classify inbox tasks (one category, no prompt storm). */
    batchClassifyTasks,
    /** STC-307 multi-block week: canonical ScheduleBlock cache (hydrate / dual-write). */
    scheduleBlocks,
    canonicalCategories,
    /** STC-304 remainder: canonical TimerSession cache for task-detail actual (hydrate / finish dual-write). */
    timerSessions,
    /** STC-503: live local TimerSession (planSnapshot) for active-vs-next plan UI. */
    activeTimerSession,
    /** STC-205: extend active countdown target (break mid-run / focus optional). */
    extendActiveTimerTarget,
    /** STC-307: add another focus block for a task (no Task clone). */
    createFocusBlock,
    /** STC-307: delete one ScheduleBlock by id. */
    deleteScheduleBlock,
    /** Slice B: dry-run V1 local snapshot → user confirm → import_migration_commit durable. */
    migrateV1ToCanonicalPlanning,
    /** Slice B UX: hydrate-driven migration banner offer (null when none). */
    migrationOffer,
    migrationBusy,
    migrationError,
    confirmMigrationOffer,
    dismissMigrationOffer,
    /** Sole-authority demote sheet offer (null when none). */
    v1DemoteOffer,
    v1DemoteBusy,
    v1DemoteError,
    v1AuthorityDemoted,
    confirmV1DemoteOffer,
    dismissV1DemoteOffer
  }
}
