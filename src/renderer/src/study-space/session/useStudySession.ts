import { useEffect, useRef, useState } from 'react'
import { STUDY_PRESENCE_BROKER_URL, studyRooms } from '../constants'
import {
  formatStudySeatLabel,
  persistStudySnapshot,
  randomStudySpaceCode,
  readStudySnapshot,
  syncStudyLocation
} from '../domain'
import type { StudyRoomEventKind, StudyRoomId, StudySnapshot, StudyTaskScheduleInput, StudyTaskUpdateInput, StudyTimerMode } from '../types'
import { useStudyAmbient } from '../useStudyAmbient'
import { useStudyPresence } from '../useStudyPresence'
import { createStudySpaceViewModel } from '../viewModel'
import { STUDY_TASKS_CHANGED_EVENT } from '../assistantTodo'
import {
  addStudyTask,
  addScheduledStudyTask,
  chooseStudySeatSnapshot,
  defaultStudyContractText,
  deriveStudyHostAction,
  followStudyRoomCycle,
  joinStudySpace,
  removeDoneStudyTasks,
  resetStudyRelayUrl,
  resetStudyTimer,
  saveStudyNickname,
  saveStudyRelayUrl,
  selectStudyRoomSnapshot,
  setStudyAmbientVolume,
  setStudySpaceCode,
  switchStudyTimerMode,
  tickStudyTimer,
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

type StudyRoom = typeof studyRooms[number]

type UseStudySessionOptions = {
  showNotification: (title: string, body: string) => Promise<void>
  openFocusTheater: () => void
}

export function useStudySession({ showNotification, openFocusTheater }: UseStudySessionOptions) {
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => readStudySnapshot())
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

  const defaultContractText = (): string => {
    return defaultStudyContractText(snapshot, viewModel.activeMode.name)
  }

  const emitRoomEvent = (kind: StudyRoomEventKind, text: string, target?: StudyPresenceTarget): void => {
    presence.sendEvent(kind, text, target)
  }

  useEffect(() => {
    roomEventSenderRef.current = presence.sendEvent
  }, [presence.sendEvent])

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
      setSnapshot((current) => ({ ...current, tasks }))
    }
    window.addEventListener(STUDY_TASKS_CHANGED_EVENT, syncImportedTasks)
    return () => window.removeEventListener(STUDY_TASKS_CHANGED_EVENT, syncImportedTasks)
  }, [])

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
    setSnapshot((current) => {
      if (
        current.clientId !== snapshot.clientId
        || current.spaceCode !== snapshot.spaceCode
        || current.roomId !== snapshot.roomId
        || current.seatIndex !== previousSeatIndex
        || current.seatClaimedAt !== previousSeatClaimedAt
      ) {
        return current
      }
      return chooseStudySeatSnapshot(current, nextSeatIndex)
    })
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
      setSnapshot((current) => tickStudyTimer(current))
    }, 1000)
    return () => window.clearInterval(id)
  }, [snapshot.timerState])

  const updateTimerPreset = (focusMinutes: number, breakMinutes: number): void => {
    setSnapshot((current) => updateStudyTimerPreset(current, focusMinutes, breakMinutes))
  }

  const selectRoom = (room: StudyRoom): void => {
    if (room.id !== snapshot.roomId) {
      presence.sendEvent('checkin', `${snapshot.nickname} 进入 ${room.name}。`, { roomId: room.id })
    }
    setSnapshot((current) => selectStudyRoomSnapshot(current, room))
  }

  const toggleContract = (): void => {
    setSnapshot((current) => toggleStudyContract(current, defaultStudyContractText(current, viewModel.activeMode.name)))
  }

  const updateContractText = (contractText: string): void => {
    setSnapshot((current) => updateStudyContractText(current, contractText))
  }

  const saveNickname = (nicknameInput: string): void => {
    setSnapshot((current) => saveStudyNickname(current, nicknameInput))
  }

  const joinSpace = (spaceInput: string): void => {
    setSnapshot((current) => joinStudySpace(current, spaceInput))
  }

  const createSpace = (): void => {
    const spaceCode = randomStudySpaceCode()
    setSnapshot((current) => setStudySpaceCode(current, spaceCode))
  }

  const saveRelayUrl = (relayInput: string): string => {
    let relayUrl = STUDY_PRESENCE_BROKER_URL
    setSnapshot((current) => {
      const result = saveStudyRelayUrl(current, relayInput)
      relayUrl = result.relayUrl
      return result.snapshot
    })
    return relayUrl
  }

  const resetRelayUrl = (): void => {
    setSnapshot((current) => resetStudyRelayUrl(current))
  }

  const toggleTimer = (): void => {
    if (snapshot.timerState !== 'running' && snapshot.timerMode === 'focus') {
      emitRoomEvent('focus_start', `${snapshot.nickname} 开始专注：${viewModel.contractDisplay}`)
    }
    setSnapshot((current) => toggleStudyTimer(current, defaultStudyContractText(current, viewModel.activeMode.name)))
  }

  const followRoomCycle = (): void => {
    const nextContract = (snapshot.contractText.trim() || defaultContractText()).slice(0, 120)
    if (viewModel.roomCycle.phase === 'focus') {
      emitRoomEvent('focus_start', `${snapshot.nickname} 跟随第 ${viewModel.roomCycle.round} 轮开始专注：${nextContract}`)
    }
    setSnapshot((current) => followStudyRoomCycle({
      snapshot: current,
      room: viewModel.activeRoom,
      phase: viewModel.roomCycle.phase,
      remainingSeconds: viewModel.roomCycle.remainingSeconds,
      fallbackContract: defaultStudyContractText(current, viewModel.activeMode.name)
    }))
  }

  const chooseSeat = (seatIndex: number): void => {
    if (seatIndex === viewModel.userSeat || viewModel.blockedSeatIndexes.has(seatIndex)) return
    const seatLabel = formatStudySeatLabel(seatIndex)
    setSnapshot((current) => chooseStudySeatSnapshot(current, seatIndex))
    emitRoomEvent('checkin', `${snapshot.nickname} 换到 ${seatLabel}。`)
  }

  const runHostAction = (): void => {
    const action = deriveStudyHostAction(snapshot, viewModel.followingRoomCycle)
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
    setSnapshot((current) => resetStudyTimer(current))
  }

  const switchTimerMode = (timerMode: StudyTimerMode): void => {
    setSnapshot((current) => switchStudyTimerMode(current, timerMode))
  }

  const addTask = (titleInput: string): boolean => {
    if (!titleInput.trim()) return false
    const taskId = `${Date.now()}`
    setSnapshot((current) => addStudyTask(current, titleInput, taskId).snapshot)
    return true
  }

  const addScheduledTask = (titleInput: string, schedule: StudyTaskScheduleInput): boolean => {
    if (!titleInput.trim()) return false
    const taskId = `scheduled-${Date.now()}`
    setSnapshot((current) => addScheduledStudyTask(current, titleInput, taskId, schedule).snapshot)
    return true
  }

  const updateTask = (taskId: string, updateInput: StudyTaskUpdateInput): boolean => {
    if (!snapshot.tasks.some((task) => task.id === taskId)) return false
    setSnapshot((current) => updateStudyTask(current, taskId, updateInput).snapshot)
    return true
  }

  const toggleTask = (taskId: string): void => {
    const task = snapshot.tasks.find((item) => item.id === taskId)
    if (task && !task.done) {
      emitRoomEvent('task_done', `${snapshot.nickname} 完成任务：${task.title}`)
    }
    setSnapshot((current) => toggleStudyTask(current, taskId))
  }

  const removeDoneTasks = (): void => {
    setSnapshot((current) => removeDoneStudyTasks(current))
  }

  const toggleAmbientEnabled = (): void => {
    setSnapshot((current) => toggleStudyAmbient(current))
  }

  const setAmbientVolume = (ambientVolume: number): void => {
    setSnapshot((current) => setStudyAmbientVolume(current, ambientVolume))
  }

  return {
    snapshot,
    presence,
    roomCycleNow,
    viewModel,
    emitRoomEvent,
    updateTimerPreset,
    selectRoom,
    toggleContract,
    updateContractText,
    saveNickname,
    joinSpace,
    createSpace,
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
    removeDoneTasks,
    toggleAmbientEnabled,
    setAmbientVolume
  }
}
