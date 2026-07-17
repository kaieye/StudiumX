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
import { appendStudyAnalyticsFacts, createStudyAnalyticsFactId } from '../../views/workbench/analytics/domain/activityLedger'
import { resolvedLocalTimeZone } from '../../views/workbench/analytics/domain/dateRange'
import { StudySessionLifecycle, type StudySessionLifecycleIntent } from './study-session-lifecycle'
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

type UseStudySessionOptions = {
  showNotification: (title: string, body: string) => Promise<void>
  openFocusTheater: () => void
  /** Optional Teaching workspace captured only as explicit task/session attribution. */
  workspaceId?: string
  /** Optional explicitly selected task; omitted means the session stays unattributed. */
  selectedTaskId?: string | null
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
  selectedTaskId
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
  const [roomCycleNow, setRoomCycleNow] = useState(() => Date.now())
  const presence = useStudyPresence(snapshot)

  const viewModel = createStudySpaceViewModel(snapshot, presence, roomCycleNow)
  const roomEventSenderRef = useRef(presence.sendEvent)
  const lastSeatConflictResolutionRef = useRef('')

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

  const recordTaskMutation = (before: StudySnapshot, after: StudySnapshot): void => {
    dispatchLifecycleIntents(lifecycle.recordTaskMutation(before, after, workspaceId))
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

  const toggleTimer = (taskId: string | null = selectedTaskId ?? null): void => {
    const result = lifecycle.toggle(snapshotRef.current, {
      taskId,
      workspaceId,
      activeModeName: viewModel.activeMode.name
    })
    dispatchLifecycleIntents(result.intents)
    commitSnapshot(result.snapshot)
  }

  const followRoomCycle = (): void => {
    const result = lifecycle.followRoomCycle(snapshotRef.current, {
      taskId: selectedTaskId,
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
      followRoomCycle()
      return
    }
    toggleTimer()
  }

  const resetTimer = (): void => {
    const finished = lifecycle.finish(snapshotRef.current, 'canceled', { taskId: selectedTaskId, workspaceId })
    dispatchLifecycleIntents(finished.intents)
    commitSnapshot(resetStudyTimer({ ...finished.snapshot, timerState: 'idle' }))
  }

  const startTimerInMode = (timerMode: StudyTimerMode): void => {
    const current = snapshotRef.current
    if (current.timerMode === timerMode) {
      toggleTimer()
      return
    }

    // A mode tab is only a preview. Finalize the active session and reset the
    // next mode when its explicit start button is pressed, not when the tab is selected.
    const finished = lifecycle.finish(current, 'interrupted', { taskId: selectedTaskId, workspaceId })
    dispatchLifecycleIntents(finished.intents)
    const switched = switchStudyTimerMode({ ...finished.snapshot, timerState: 'idle' }, timerMode)
    const started = lifecycle.toggle(switched, {
      taskId: selectedTaskId ?? null,
      workspaceId,
      activeModeName: viewModel.activeMode.name
    })
    dispatchLifecycleIntents(started.intents)
    commitSnapshot(started.snapshot)
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
    startTimerInMode,
    saveTimerPlan,
    applyTimerPlan,
    removeTimerPlan,
    addTask,
    addScheduledTask,
    updateTask,
    toggleTask,
    removeTask,
    removeDoneTasks
  }
}
