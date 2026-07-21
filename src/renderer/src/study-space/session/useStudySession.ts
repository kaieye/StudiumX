import { useEffect, useRef, useState } from 'react'
import { formatStudySeatLabel, randomStudySpaceCode } from '../domain'
import { persistStudySnapshot, readStudySnapshot, syncStudyLocation } from './session-snapshot'
import type {
  StudyRoomEventKind,
  StudyRoomId,
  StudySnapshot,
  StudyTaskScheduleInput,
  StudyTaskUpdateInput,
  StudyTimerMode,
  StudyTimerPlanInput
} from '../types'
import { useStudyPresence } from '../useStudyPresence'
import { createStudySpaceViewModel } from '../viewModel'
import { STUDY_TASKS_CHANGED_EVENT } from '../assistantTodo'
import { listStudyTaskCategories, resolveStudyTaskCategory } from '../taskCategories'
import { appendStudyAnalyticsFacts, createStudyAnalyticsFactId } from '../../views/workbench/analytics/domain/activityLedger'
import { resolvedLocalTimeZone } from '../../views/workbench/analytics/domain/dateRange'
import { StudySessionLifecycle, type StudySessionLifecycleIntent } from './study-session-lifecycle'
import {
  attributionToTaskId,
  resolveStudyFocusAttribution,
  type EmptyStartChoice,
  type EmptyStartPolicy
} from './resolve-focus-attribution'

export type { EmptyStartChoice, EmptyStartPolicy }
import { normalizeQuickStartTitle } from '../../../../shared/study-planning'
import {
  dualWriteCompleteTask,
  dualWriteCreateTask,
  dualWriteUpsertScheduleFromV1,
  type CanonicalPlanningContext,
  type DualWriteResult
} from '../planning-dual-write'
import { dualWriteUpdateTask } from '../planning-task-update-dual-write'
import type { StudyPlanningApi } from '../planning-client'
import {
  commitV1Migration,
  dryRunV1Migration,
  formatMigrationConfirmMessage
} from '../planning-migration'
import { hydrateStudyTasksFromCanonical, studyTasksEqual } from '../planning-hydrate'
import {
  createCanonicalTimerSessionId,
  dualWriteFinishTimerSession,
  dualWritePauseTimerSession,
  dualWriteResumeTimerSession,
  dualWriteStartTimerSession,
  resolveTimerAttribution
} from '../planning-timer-dual-write'
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
   * Empty-start preference (product freeze #1 default ask_every_time).
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
  emptyStartPolicy = 'ask_every_time',
  onEmptyStartAsk,
  onPlanningWriteError,
  onFutureBlocksNeedDecision
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

  const viewModel = createStudySpaceViewModel(snapshot, presence, roomCycleNow)
  const roomEventSenderRef = useRef(presence.sendEvent)
  const lastSeatConflictResolutionRef = useRef('')
  /** Canonical TimerSession id for dual-write (independent of V1 analytics session id). */
  const canonicalTimerSessionIdRef = useRef<string | null>(null)

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
   * Slice D: publish focus TimerSession lifecycle to durable store.
   * V1 lifecycle remains UI clock; break auto-segments stay V1-only until full cutover.
   */
  const dualWriteFocusTimerTransition = (
    transition:
      | { kind: 'start'; taskId?: string | null; targetSeconds: number }
      | { kind: 'pause' }
      | { kind: 'resume' }
      | { kind: 'finish'; reason: 'manual' | 'cancelled' }
  ): void => {
    const ctx = resolvePlanningContext()
    if (transition.kind === 'start') {
      const sessionId = createCanonicalTimerSessionId()
      canonicalTimerSessionIdRef.current = sessionId
      const attr = resolveTimerAttribution(transition.taskId)
      void dualWriteStartTimerSession(ctx, {
        sessionId,
        taskId: attr.taskId,
        attributionReason: attr.attributionReason,
        targetSeconds: transition.targetSeconds,
        planId: 'classic_25_5'
      }).then(reportPlanningWrite)
      return
    }
    const sessionId = canonicalTimerSessionIdRef.current
    if (!sessionId) return
    if (transition.kind === 'pause') {
      void dualWritePauseTimerSession(ctx, sessionId).then(reportPlanningWrite)
      return
    }
    if (transition.kind === 'resume') {
      void dualWriteResumeTimerSession(ctx, sessionId).then(reportPlanningWrite)
      return
    }
    canonicalTimerSessionIdRef.current = null
    void dualWriteFinishTimerSession(ctx, sessionId, transition.reason).then(reportPlanningWrite)
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

    const ctx = resolvePlanningContext()
    const result = await commitV1Migration({
      api: ctx.api,
      workspaceRoot: ctx.workspaceRoot,
      v1Snapshot: v1Slice,
      userConfirmed: true,
      weekAnchorMidnightMs: weekAnchor
    })
    if (!result.ok) {
      const message = `Study planning migration failed (${result.error.code}): ${result.error.message}`
      onPlanningWriteError?.(message)
      return { ok: false, code: result.error.code, message: result.error.message }
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
  }


  const commitSnapshot = (next: StudySnapshot): StudySnapshot => {
    snapshotRef.current = next
    setSnapshot(next)
    return next
  }

  const dispatchLifecycleIntents = (intents: StudySessionLifecycleIntent[]): void => {
    for (const intent of intents) {
      if (intent.kind === 'analytics') {
        appendStudyAnalyticsFacts(intent.clientId, intent.facts, {
          ...(intent.localToday ? { localToday: intent.localToday } : {}),
          ...(intent.updatedAt ? { updatedAt: intent.updatedAt } : {})
        })
      } else if (intent.kind === 'presence') {
        roomEventSenderRef.current(intent.event, intent.text, intent.target)
      } else {
        void showNotification(intent.title, intent.body)
      }
    }
  }

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
    persistStudySnapshot(snapshot)
  }, [snapshot])

  useEffect(() => {
    const syncImportedTasks = (event: Event): void => {
      const tasks = (event as CustomEvent<StudySnapshot['tasks']>).detail
      if (!Array.isArray(tasks)) return
      const current = snapshotRef.current
      const next = { ...current, tasks }
      recordTaskMutation(current, next)
      commitSnapshot(next)
    }
    window.addEventListener(STUDY_TASKS_CHANGED_EVENT, syncImportedTasks)
    return () => window.removeEventListener(STUDY_TASKS_CHANGED_EVENT, syncImportedTasks)
  }, [workspaceId])

  /**
   * Sole-read hydrate: when workspace root is active, replace UI task list from
   * canonical snapshot.json if it has tasks. Keep V1 when canonical empty / fail.
   * Timer/presence stay on V1 host until Slice D.
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
      if (result.kind !== 'applied') return
      const current = snapshotRef.current
      // Re-check race at apply time (getCurrentHostTasks already checked inside hydrate).
      if (!studyTasksEqual(current.tasks, expectedHostTasks)) return
      const next = result.snapshot
      // Preserve any host shell fields that advanced during the await (timer etc.).
      const merged: StudySnapshot = {
        ...current,
        tasks: next.tasks
      }
      if (studyTasksEqual(current.tasks, merged.tasks)) return
      recordTaskMutation(current, merged)
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

  useEffect(() => {
    const id = window.setInterval(() => setRoomCycleNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (snapshot.timerState !== 'running') return undefined
    const id = window.setInterval(() => {
      const current = snapshotRef.current
      if (current.timerState !== 'running') return
      const advanced = lifecycle.advance(current, { taskId: selectedTaskId, workspaceId })
      dispatchLifecycleIntents(advanced.intents)
      commitSnapshot(advanced.snapshot)
      if (advanced.completed && current.timerMode === 'focus') {
        dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
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

  const saveTimerPlan = (input: StudyTimerPlanInput): void => {
    const plan = { ...input, id: makeTimerPlanId() }
    commitSnapshot(saveStudyTimerPlan(snapshotRef.current, plan))
  }

  const applyTimerPlan = (planId: string): void => {
    const plan = snapshotRef.current.timerPlans.find((item) => item.id === planId)
    if (plan) commitSnapshot(applyStudyTimerPlan(snapshotRef.current, plan))
  }

  const removeTimerPlan = (planId: string): void => {
    commitSnapshot(removeStudyTimerPlan(snapshotRef.current, planId))
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
    if (taskId === null) {
      setSelectedTaskId(null)
      return
    }
    const exists = snapshotRef.current.tasks.some((task) => task.id === taskId)
    setSelectedTaskId(exists ? taskId : null)
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
      // Create temporary inbox task in V1 cache (+ dual-write) then attribute timer to it.
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
    const result = addStudyTask(current, title, taskId)
    if (!result.added) return null
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    if (selectedTaskIdProp === undefined) {
      setInternalSelectedTaskId(taskId)
    }
    void dualWriteCreateTask(resolvePlanningContext(), {
      id: taskId,
      title,
      categoryId: null,
      source: 'quick_start'
    }).then(reportPlanningWrite)
    return taskId
  }

  const toggleTimer = async (taskId?: string | null): Promise<void> => {
    // Pause/resume of an already-running or paused timer does not re-open empty-start.
    const current = snapshotRef.current
    if (current.timerState === 'running' || current.timerState === 'paused') {
      const prevState = current.timerState
      const result = lifecycle.toggle(current, {
        taskId: selectedTaskId,
        workspaceId,
        activeModeName: viewModel.activeMode.name
      })
      dispatchLifecycleIntents(result.intents)
      commitSnapshot(result.snapshot)
      // Dual-write pause/resume for focus sessions only (break stays V1 until full cutover).
      if (current.timerMode === 'focus' && !result.completed) {
        if (prevState === 'running' && result.snapshot.timerState === 'paused') {
          dualWriteFocusTimerTransition({ kind: 'pause' })
        } else if (prevState === 'paused' && result.snapshot.timerState === 'running') {
          dualWriteFocusTimerTransition({ kind: 'resume' })
        }
      }
      if (result.completed && current.timerMode === 'focus') {
        dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
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
    // Dual-write start for focus only — freezes planSnapshot on durable store.
    if (
      before.timerMode === 'focus'
      && before.timerState === 'idle'
      && result.snapshot.timerState === 'running'
    ) {
      dualWriteFocusTimerTransition({
        kind: 'start',
        taskId: resolvedTaskId,
        targetSeconds: result.snapshot.remainingSeconds
      })
    }
  }

  const followRoomCycle = async (): Promise<void> => {
    const resolvedTaskId = await resolveFocusTaskId()
    if (resolvedTaskId === undefined) return
    if (resolvedTaskId && selectedTaskIdProp === undefined && resolvedTaskId !== selectedTaskId) {
      setInternalSelectedTaskId(resolvedTaskId)
    }
    const result = lifecycle.followRoomCycle(snapshotRef.current, {
      taskId: resolvedTaskId,
      workspaceId,
      room: viewModel.activeRoom,
      phase: viewModel.roomCycle.phase,
      remainingSeconds: viewModel.roomCycle.remainingSeconds,
      activeModeName: viewModel.activeMode.name
    })
    dispatchLifecycleIntents(result.intents)
    commitSnapshot(result.snapshot)
  }

  const chooseSeat = (seatIndex: number): void => {
    if (seatIndex === viewModel.userSeat || viewModel.blockedSeatIndexes.has(seatIndex)) return
    const current = snapshotRef.current
    commitSnapshot(chooseStudySeatSnapshot(current, seatIndex))
    emitRoomEvent('checkin', `${current.nickname} 换到 ${formatStudySeatLabel(seatIndex)}。`)
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
    const finished = lifecycle.finish(prev, 'canceled', { taskId: selectedTaskId, workspaceId })
    dispatchLifecycleIntents(finished.intents)
    commitSnapshot(resetStudyTimer({ ...finished.snapshot, timerState: 'idle' }))
    if (prev.timerMode === 'focus' && prev.timerState !== 'idle') {
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
    const finished = lifecycle.finish(latest, 'interrupted', { taskId: resolvedTaskId, workspaceId })
    dispatchLifecycleIntents(finished.intents)
    if (latest.timerMode === 'focus' && latest.timerState !== 'idle') {
      dualWriteFocusTimerTransition({ kind: 'finish', reason: 'manual' })
    }
    const switched = switchStudyTimerMode({ ...finished.snapshot, timerState: 'idle' }, timerMode)
    const started = lifecycle.toggle(switched, {
      taskId: resolvedTaskId,
      workspaceId,
      activeModeName: viewModel.activeMode.name
    })
    dispatchLifecycleIntents(started.intents)
    commitSnapshot(started.snapshot)
    if (
      timerMode === 'focus'
      && started.snapshot.timerState === 'running'
    ) {
      dualWriteFocusTimerTransition({
        kind: 'start',
        taskId: resolvedTaskId,
        targetSeconds: started.snapshot.remainingSeconds
      })
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
    })
    return true
  }

  const updateTask = (taskId: string, updateInput: StudyTaskUpdateInput): boolean => {
    const current = snapshotRef.current
    const result = updateStudyTask(current, taskId, updateInput)
    if (!result.updated) return false
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    // Dual-write title/category + schedule (week-drag) to canonical (ADR-0117).
    // V1 remains UI cache; done→open reopen has no store command yet (skip via payload builder).
    void dualWriteUpdateTask(resolvePlanningContext(), {
      taskId,
      update: updateInput
    }).then((dw) => {
      if (dw.task) reportPlanningWrite(dw.task)
      if (dw.schedule) reportPlanningWrite(dw.schedule)
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
        // Second complete_task with decision applies block disposition (idempotent task already done).
        const follow = await dualWriteCompleteTask(resolvePlanningContext(), taskId, {
          futureBlocksDecision: answer.decision,
          ...(answer.decision === 'reassign'
            ? { reassignTaskId: answer.reassignTaskId ?? null }
            : {})
        })
        reportPlanningWrite(follow)
      })
    }
  }

  const removeDoneTasks = (): void => {
    const current = snapshotRef.current
    const next = removeDoneStudyTasks(current)
    recordTaskMutation(current, next)
    commitSnapshot(next)
  }

  const removeTask = (taskId: string): void => {
    const current = snapshotRef.current
    const next = removeStudyTask(current, taskId)
    recordTaskMutation(current, next)
    if (selectedTaskIdProp === undefined && internalSelectedTaskId === taskId) {
      setInternalSelectedTaskId(null)
    }
    commitSnapshot(next)
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
    chooseSeat,
    runHostAction,
    resetTimer,
    startTimerInMode,
    saveTimerPlan,
    applyTimerPlan,
    removeTimerPlan,
    addTask,
    addScheduledTask,
    updateTask,
    toggleTask,
    removeTask,
    removeDoneTasks,
    /** Slice B: dry-run + confirm + import_migration_commit (does not erase V1). */
    migrateV1ToCanonicalPlanning
  }
}
