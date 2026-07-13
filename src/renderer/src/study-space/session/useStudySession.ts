import { useEffect, useRef, useState } from 'react'
import type { StudyTaskAttribution } from '../../../../shared/teaching-types/analytics'
import { STUDY_PRESENCE_BROKER_URL } from '../constants'
import {
  formatStudySeatLabel,
  persistStudySnapshot,
  randomStudySpaceCode,
  readStudySnapshot,
  syncStudyLocation
} from '../domain'
import type {
  StudyRoomEventKind,
  StudyRoomId,
  StudySnapshot,
  StudyTaskScheduleInput,
  StudyTaskUpdateInput,
  StudyTimerMode
} from '../types'
import { useStudyAmbient } from '../useStudyAmbient'
import { useStudyPresence } from '../useStudyPresence'
import { createStudySpaceViewModel } from '../viewModel'
import { STUDY_TASKS_CHANGED_EVENT } from '../assistantTodo'
import {
  appendStudyAnalyticsFacts,
  createStudyAnalyticsFactId,
  createTaskActivityFacts
} from '../../views/workbench/analytics/domain/activityLedger'
import {
  getLocalDateKey,
  resolvedLocalTimeZone
} from '../../views/workbench/analytics/domain/dateRange'
import {
  advanceActiveStudySession,
  createActiveStudySession,
  finalizeActiveStudySession,
  pauseActiveStudySession,
  remainingActiveStudySessionSeconds,
  resumeActiveStudySession,
  type ActiveStudySessionV1
} from '../../views/workbench/analytics/domain/sessionFacts'
import type { ReliableTimerSample } from '../../views/workbench/analytics/domain/reliableTimer'
import {
  addStudyTask,
  addScheduledStudyTask,
  advanceStudyTimerBySeconds,
  chooseStudySeatSnapshot,
  defaultStudyContractText,
  deriveStudyHostAction,
  followStudyRoomCycle,
  joinStudySpace,
  removeDoneStudyTasks,
  removeStudyTask,
  resetStudyRelayUrl,
  resetStudyTimer,
  saveStudyNickname,
  saveStudyRelayUrl,
  setStudyAmbientVolume,
  setStudySpaceCode,
  switchStudyTimerMode,
  toggleStudyAmbient,
  toggleStudyContract,
  toggleStudyTask,
  toggleStudyTimer,
  updateStudyContractText,
  updateStudyTask,
  updateStudyTimerPreset
} from './transitions'

type StudyPresenceTarget = {
  roomId?: StudyRoomId
  spaceCode?: string
}

type UseStudySessionOptions = {
  showNotification: (title: string, body: string) => Promise<void>
  openFocusTheater: () => void
  /** Optional Teaching workspace captured only as explicit task/session attribution. */
  workspaceId?: string
  /** Optional explicitly selected task; omitted means the session stays unattributed. */
  selectedTaskId?: string | null
}

function timerSample(): ReliableTimerSample {
  const monotonicMs = typeof performance !== 'undefined' && Number.isFinite(performance.now())
    ? performance.now()
    : undefined
  return { wallMs: Date.now(), ...(monotonicMs === undefined ? {} : { monotonicMs }) }
}

function explicitTaskAttribution(
  snapshot: StudySnapshot,
  taskId: string | null | undefined,
  workspaceId?: string
): StudyTaskAttribution {
  if (!taskId) return { kind: 'unattributed', reason: 'no_task_selected' }
  const task = snapshot.tasks.find((item) => item.id === taskId)
  if (!task) return { kind: 'unattributed', reason: 'task_missing' }
  return {
    kind: 'explicit',
    capturedAt: 'session_start',
    taskId: task.id,
    taskTitleSnapshot: task.title,
    ...(workspaceId ? { workspaceId } : {})
  }
}

function createSessionFromSnapshot(
  snapshot: StudySnapshot,
  sample: ReliableTimerSample,
  taskId: string | null | undefined,
  workspaceId?: string,
  legacy = false
): ActiveStudySessionV1 {
  const session = createActiveStudySession({
    id: createStudyAnalyticsFactId('study-session', sample.wallMs),
    clientId: snapshot.clientId,
    timerMode: snapshot.timerMode,
    plannedSeconds: snapshot.remainingSeconds,
    sample,
    timeZone: resolvedLocalTimeZone(),
    context: {
      modeId: snapshot.modeId,
      roomId: snapshot.roomId,
      signalId: snapshot.signalId,
      spaceCode: snapshot.spaceCode
    },
    taskAttribution: legacy
      ? { kind: 'unattributed', reason: 'legacy_session' }
      : explicitTaskAttribution(snapshot, taskId, workspaceId)
  })
  return snapshot.timerState === 'paused'
    ? pauseActiveStudySession(session, { sample, timeZone: session.currentTimeZone })
    : session
}

export function useStudySession({
  showNotification,
  openFocusTheater,
  workspaceId,
  selectedTaskId
}: UseStudySessionOptions) {
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => readStudySnapshot())
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const activeSessionRef = useRef<ActiveStudySessionV1 | null>(null)
  const [roomCycleNow, setRoomCycleNow] = useState(() => Date.now())
  const presence = useStudyPresence(snapshot)
  useStudyAmbient(snapshot.ambientEnabled, snapshot.ambientVolume)

  const viewModel = createStudySpaceViewModel(snapshot, presence, roomCycleNow)
  const roomEventSenderRef = useRef(presence.sendEvent)
  const lastFocusCompletionEventRef = useRef('')
  const lastSeatConflictResolutionRef = useRef('')
  const timerTransitionRef = useRef({
    timerMode: snapshot.timerMode,
    timerState: snapshot.timerState,
    todaySessions: snapshot.todaySessions,
    totalSessions: snapshot.totalSessions
  })

  const commitSnapshot = (next: StudySnapshot): StudySnapshot => {
    snapshotRef.current = next
    setSnapshot(next)
    return next
  }

  const appendSessionFact = (session: ActiveStudySessionV1, outcome: 'completed' | 'interrupted' | 'canceled'): void => {
    const fact = finalizeActiveStudySession(session, outcome)
    appendStudyAnalyticsFacts(fact.clientId, [fact], {
      localToday: getLocalDateKey(Date.now(), resolvedLocalTimeZone()),
      updatedAt: fact.recordedAt
    })
  }

  const applyAdvancedSession = (
    current: StudySnapshot,
    session: ActiveStudySessionV1,
    activeDeltaSeconds: number,
    activeSecondsByLocalDate: Partial<Record<string, number>>,
    completed: boolean
  ): StudySnapshot => {
    const completedFact = completed ? finalizeActiveStudySession(session, 'completed') : null
    const next = advanceStudyTimerBySeconds(current, {
      activeSeconds: activeDeltaSeconds,
      remainingSeconds: remainingActiveStudySessionSeconds(session),
      completed,
      localToday: getLocalDateKey(Date.now(), resolvedLocalTimeZone()),
      ...(current.timerMode === 'focus'
        ? { focusSecondsByLocalDate: activeSecondsByLocalDate }
        : {}),
      ...(completedFact ? { xpEarned: completedFact.xpEarned } : {})
    })
    if (completedFact) {
      appendStudyAnalyticsFacts(completedFact.clientId, [completedFact], {
        localToday: getLocalDateKey(Date.now(), resolvedLocalTimeZone()),
        updatedAt: completedFact.recordedAt
      })
      activeSessionRef.current = null
    }
    return next
  }

  const advanceRunningSession = (current: StudySnapshot, sample: ReliableTimerSample): {
    snapshot: StudySnapshot
    completed: boolean
  } => {
    const session = activeSessionRef.current
      ?? createSessionFromSnapshot(current, sample, selectedTaskId, workspaceId, true)
    const advanced = advanceActiveStudySession(session, {
      sample,
      timeZone: resolvedLocalTimeZone()
    })
    activeSessionRef.current = advanced.session
    return {
      snapshot: applyAdvancedSession(
        current,
        advanced.session,
        advanced.activeDeltaSeconds,
        advanced.activeSecondsByLocalDate,
        advanced.completed
      ),
      completed: advanced.completed
    }
  }

  const finishActiveSession = (
    current: StudySnapshot,
    outcome: 'interrupted' | 'canceled',
    sample = timerSample()
  ): StudySnapshot => {
    let session = activeSessionRef.current
    if (!session) return current
    let next = current
    if (session.timer.status === 'running') {
      const advanced = advanceActiveStudySession(session, { sample, timeZone: resolvedLocalTimeZone() })
      session = advanced.session
      activeSessionRef.current = session
      next = applyAdvancedSession(
        current,
        session,
        advanced.activeDeltaSeconds,
        advanced.activeSecondsByLocalDate,
        advanced.completed
      )
      if (advanced.completed) return next
    } else {
      session = resumeActiveStudySession(session, { sample, timeZone: resolvedLocalTimeZone() })
    }
    appendSessionFact(session, outcome)
    activeSessionRef.current = null
    return next
  }

  const recordTaskMutation = (before: StudySnapshot, after: StudySnapshot): void => {
    const facts = createTaskActivityFacts(before.tasks, after.tasks, {
      clientId: before.clientId,
      ...(workspaceId ? { workspaceId } : {}),
      occurredAtMs: Date.now(),
      timeZone: resolvedLocalTimeZone()
    })
    if (facts.length > 0) appendStudyAnalyticsFacts(before.clientId, facts)
  }

  const emitRoomEvent = (kind: StudyRoomEventKind, text: string, target?: StudyPresenceTarget): void => {
    presence.sendEvent(kind, text, target)
  }

  useEffect(() => {
    roomEventSenderRef.current = presence.sendEvent
  }, [presence.sendEvent])

  useEffect(() => {
    if (activeSessionRef.current || snapshotRef.current.timerState === 'idle') return
    activeSessionRef.current = createSessionFromSnapshot(
      snapshotRef.current,
      timerSample(),
      selectedTaskId,
      workspaceId,
      true
    )
  }, [selectedTaskId, workspaceId])

  useEffect(() => {
    const previous = timerTransitionRef.current
    timerTransitionRef.current = {
      timerMode: snapshot.timerMode,
      timerState: snapshot.timerState,
      todaySessions: snapshot.todaySessions,
      totalSessions: snapshot.totalSessions
    }

    const completedFocus = snapshot.timerMode === 'break'
      && snapshot.timerState === 'idle'
      && snapshot.totalSessions > previous.totalSessions
    if (completedFocus) {
      const completionKey = `${snapshot.clientId}:${snapshot.roomId}:${snapshot.totalSessions}:${snapshot.todaySessions}:${snapshot.focusMinutes}:${snapshot.breakMinutes}`
      if (lastFocusCompletionEventRef.current !== completionKey) {
        lastFocusCompletionEventRef.current = completionKey
        roomEventSenderRef.current(
          'task_done',
          `${snapshot.nickname} 完成 ${snapshot.focusMinutes} 分钟专注，进入 ${snapshot.breakMinutes} 分钟休息。`,
          { roomId: snapshot.roomId, spaceCode: snapshot.spaceCode }
        )
      }
      void showNotification('自习室', `完成 ${snapshot.focusMinutes} 分钟专注，进入休息。`)
      return
    }

    const completedBreak = previous.timerMode === 'break'
      && previous.timerState === 'running'
      && snapshot.timerMode === 'focus'
      && snapshot.timerState === 'idle'
    if (completedBreak) {
      void showNotification('自习室', '休息结束，可以开始下一轮专注。')
    }
  }, [
    showNotification,
    snapshot.breakMinutes,
    snapshot.clientId,
    snapshot.focusMinutes,
    snapshot.nickname,
    snapshot.roomId,
    snapshot.spaceCode,
    snapshot.timerMode,
    snapshot.timerState,
    snapshot.todaySessions,
    snapshot.totalSessions
  ])

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
      const advanced = advanceRunningSession(current, timerSample())
      commitSnapshot(advanced.snapshot)
    }, 1000)
    return () => window.clearInterval(id)
  }, [snapshot.timerState, selectedTaskId, workspaceId])

  const updateTimerPreset = (focusMinutes: number, breakMinutes: number): void => {
    commitSnapshot(updateStudyTimerPreset(snapshotRef.current, focusMinutes, breakMinutes))
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

  const toggleTimer = (taskId: string | null = selectedTaskId ?? null): void => {
    const current = snapshotRef.current
    const sample = timerSample()
    if (current.timerState === 'running') {
      const advanced = advanceRunningSession(current, sample)
      if (advanced.completed) {
        commitSnapshot(advanced.snapshot)
        return
      }
      const session = activeSessionRef.current
      if (session) {
        activeSessionRef.current = pauseActiveStudySession(session, {
          sample,
          timeZone: resolvedLocalTimeZone()
        })
      }
      commitSnapshot(toggleStudyTimer(advanced.snapshot, defaultStudyContractText(advanced.snapshot, viewModel.activeMode.name)))
      return
    }

    if (current.timerState === 'paused') {
      const session = activeSessionRef.current
        ?? createSessionFromSnapshot(current, sample, taskId, workspaceId, true)
      activeSessionRef.current = resumeActiveStudySession(session, {
        sample,
        timeZone: resolvedLocalTimeZone()
      })
      commitSnapshot(toggleStudyTimer(current, defaultStudyContractText(current, viewModel.activeMode.name)))
      return
    }

    activeSessionRef.current = createSessionFromSnapshot(current, sample, taskId, workspaceId)
    if (current.timerMode === 'focus') {
      emitRoomEvent('focus_start', `${current.nickname} 开始专注：${viewModel.contractDisplay}`)
    }
    commitSnapshot(toggleStudyTimer(current, defaultStudyContractText(current, viewModel.activeMode.name)))
  }

  const followRoomCycle = (): void => {
    const current = finishActiveSession(snapshotRef.current, 'interrupted')
    const nextContract = (
      current.contractText.trim() || defaultStudyContractText(current, viewModel.activeMode.name)
    ).slice(0, 120)
    if (viewModel.roomCycle.phase === 'focus') {
      emitRoomEvent('focus_start', `${current.nickname} 跟随第 ${viewModel.roomCycle.round} 轮开始专注：${nextContract}`)
    }
    const next = followStudyRoomCycle({
      snapshot: current,
      room: viewModel.activeRoom,
      phase: viewModel.roomCycle.phase,
      remainingSeconds: viewModel.roomCycle.remainingSeconds,
      fallbackContract: defaultStudyContractText(current, viewModel.activeMode.name)
    })
    activeSessionRef.current = createSessionFromSnapshot(next, timerSample(), selectedTaskId, workspaceId)
    commitSnapshot(next)
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
      followRoomCycle()
      return
    }
    toggleTimer()
  }

  const resetTimer = (): void => {
    const finished = finishActiveSession(snapshotRef.current, 'canceled')
    commitSnapshot(resetStudyTimer({ ...finished, timerState: 'idle' }))
  }

  const switchTimerMode = (timerMode: StudyTimerMode): void => {
    const finished = finishActiveSession(snapshotRef.current, 'interrupted')
    commitSnapshot(switchStudyTimerMode({ ...finished, timerState: 'idle' }, timerMode))
  }

  const addTask = (titleInput: string): boolean => {
    if (!titleInput.trim()) return false
    const current = snapshotRef.current
    const result = addStudyTask(current, titleInput, createStudyAnalyticsFactId('task'))
    if (!result.added) return false
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    return true
  }

  const addScheduledTask = (
    titleInput: string,
    schedule: StudyTaskScheduleInput,
    categoryId?: string | null
  ): boolean => {
    if (!titleInput.trim()) return false
    const current = snapshotRef.current
    const result = addScheduledStudyTask(
      current,
      titleInput,
      createStudyAnalyticsFactId('scheduled-task'),
      schedule,
      categoryId
    )
    if (!result.added) return false
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    return true
  }

  const updateTask = (taskId: string, updateInput: StudyTaskUpdateInput): boolean => {
    const current = snapshotRef.current
    const result = updateStudyTask(current, taskId, updateInput)
    if (!result.updated) return false
    recordTaskMutation(current, result.snapshot)
    commitSnapshot(result.snapshot)
    return true
  }

  const toggleTask = (taskId: string): void => {
    const current = snapshotRef.current
    const task = current.tasks.find((item) => item.id === taskId)
    if (task && !task.done) {
      emitRoomEvent('task_done', `${current.nickname} 完成任务：${task.title}`)
    }
    const next = toggleStudyTask(current, taskId)
    recordTaskMutation(current, next)
    commitSnapshot(next)
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
    commitSnapshot(next)
  }

  const toggleAmbientEnabled = (): void => {
    commitSnapshot(toggleStudyAmbient(snapshotRef.current))
  }

  const setAmbientVolume = (ambientVolume: number): void => {
    commitSnapshot(setStudyAmbientVolume(snapshotRef.current, ambientVolume))
  }

  return {
    snapshot,
    presence,
    roomCycleNow,
    viewModel,
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
    switchTimerMode,
    addTask,
    addScheduledTask,
    updateTask,
    toggleTask,
    removeTask,
    removeDoneTasks,
    toggleAmbientEnabled,
    setAmbientVolume
  }
}
