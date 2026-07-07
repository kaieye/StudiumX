import { useEffect, useRef, useState } from 'react'
import { STUDY_PRESENCE_BROKER_URL, studyModes, studyRooms } from '../constants'
import {
  formatStudySeatLabel,
  nextStudyStreak,
  normalizeStudyRelayUrl,
  normalizeStudySeatIndex,
  normalizeStudySpaceCode,
  persistStudySnapshot,
  randomStudySpaceCode,
  readStudySnapshot,
  syncStudyLocation,
  todayKey
} from '../domain'
import type { StudyRoomEventKind, StudyRoomId, StudySignalId, StudySnapshot, StudyTimerMode } from '../types'
import { useStudyAmbient } from '../useStudyAmbient'
import { useStudyPresence } from '../useStudyPresence'
import { createStudySpaceViewModel } from '../viewModel'

type StudyPresenceTarget = {
  roomId?: StudyRoomId
  spaceCode?: string
}

type StudyRoom = typeof studyRooms[number]
type StudyMode = typeof studyModes[number]

type UseStudySessionOptions = {
  showNotification: (title: string, body: string) => Promise<void>
  openFocusTheater: () => void
}

export function useStudySession({ showNotification, openFocusTheater }: UseStudySessionOptions) {
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => readStudySnapshot())
  const [roomCycleNow, setRoomCycleNow] = useState(() => Date.now())
  const presence = useStudyPresence(snapshot)
  useStudyAmbient(snapshot.roomId, snapshot.ambientEnabled, snapshot.ambientVolume)

  const viewModel = createStudySpaceViewModel(snapshot, presence, roomCycleNow)
  const roomEventSenderRef = useRef(presence.sendEvent)
  const lastFocusCompletionEventRef = useRef('')
  const timerTransitionRef = useRef({
    timerMode: snapshot.timerMode,
    timerState: snapshot.timerState,
    todaySessions: snapshot.todaySessions,
    totalSessions: snapshot.totalSessions
  })

  const defaultContractText = (): string => {
    const firstOpenTask = snapshot.tasks.find((task) => !task.done)?.title
    return firstOpenTask || viewModel.activeMode.name
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
      void showNotification('学习空间', `完成 ${snapshot.focusMinutes} 分钟专注，进入休息。`)
      return
    }

    const completedBreak = previous.timerMode === 'break'
      && previous.timerState === 'running'
      && snapshot.timerMode === 'focus'
      && snapshot.timerState === 'idle'
    if (completedBreak) {
      void showNotification('学习空间', '休息结束，可以开始下一轮专注。')
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
    syncStudyLocation(snapshot.spaceCode, snapshot.roomId)
  }, [snapshot.roomId, snapshot.spaceCode])

  useEffect(() => {
    const id = window.setInterval(() => setRoomCycleNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (snapshot.timerState !== 'running') return undefined
    const id = window.setInterval(() => {
      setSnapshot((current) => {
        const today = todayKey()
        const studyingFocus = current.timerMode === 'focus'
        const streakDays = studyingFocus ? nextStudyStreak(current.lastStudyDate, current.streakDays) : current.streakDays
        const lastStudyDate = studyingFocus ? today : current.lastStudyDate
        const todayFocusSeconds = studyingFocus ? current.todayFocusSeconds + 1 : current.todayFocusSeconds
        const totalFocusSeconds = studyingFocus ? current.totalFocusSeconds + 1 : current.totalFocusSeconds

        if (current.remainingSeconds > 1) {
          return {
            ...current,
            remainingSeconds: current.remainingSeconds - 1,
            todayFocusSeconds,
            totalFocusSeconds,
            streakDays,
            lastStudyDate
          }
        }

        if (current.timerMode === 'focus') {
          return {
            ...current,
            timerMode: 'break',
            timerState: 'idle',
            remainingSeconds: current.breakMinutes * 60,
            contractLocked: false,
            todayFocusSeconds,
            todaySessions: current.todaySessions + 1,
            totalFocusSeconds,
            totalSessions: current.totalSessions + 1,
            streakDays,
            xp: current.xp + Math.max(10, current.focusMinutes * 2),
            lastStudyDate
          }
        }

        return {
          ...current,
          timerMode: 'focus',
          timerState: 'idle',
          remainingSeconds: current.focusMinutes * 60
        }
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [snapshot.timerState])

  const updateTimerPreset = (focusMinutes: number, breakMinutes: number): void => {
    setSnapshot((current) => ({
      ...current,
      focusMinutes,
      breakMinutes,
      timerMode: 'focus',
      timerState: current.timerState === 'running' ? current.timerState : 'idle',
      remainingSeconds: current.timerState === 'running' ? current.remainingSeconds : focusMinutes * 60
    }))
  }

  const selectRoom = (room: StudyRoom): void => {
    if (room.id !== snapshot.roomId) {
      presence.sendEvent('checkin', `${snapshot.nickname} 进入 ${room.name}。`, { roomId: room.id })
    }
    setSnapshot((current) => ({
      ...current,
      roomId: room.id,
      seatIndex: normalizeStudySeatIndex(current.seatIndex, room.id, current.clientId),
      focusMinutes: current.timerState === 'running' ? current.focusMinutes : room.sessionMinutes,
      breakMinutes: current.timerState === 'running' ? current.breakMinutes : room.breakMinutes,
      remainingSeconds: current.timerState === 'running' ? current.remainingSeconds : room.sessionMinutes * 60,
      timerMode: current.timerState === 'running' ? current.timerMode : 'focus'
    }))
  }

  const selectStudyMode = (mode: StudyMode): void => {
    const targetRoom = snapshot.timerState === 'running' ? snapshot.roomId : mode.roomId
    if (targetRoom !== snapshot.roomId) {
      const roomName = studyRooms.find((room) => room.id === targetRoom)?.name ?? viewModel.activeRoom.name
      presence.sendEvent('checkin', `${snapshot.nickname} 切换到 ${roomName}。`, { roomId: targetRoom })
    }
    setSnapshot((current) => ({
      ...current,
      modeId: mode.id,
      roomId: current.timerState === 'running' ? current.roomId : mode.roomId,
      seatIndex: current.timerState === 'running' ? current.seatIndex : normalizeStudySeatIndex(current.seatIndex, mode.roomId, current.clientId),
      focusMinutes: current.timerState === 'running' ? current.focusMinutes : mode.focusMinutes,
      breakMinutes: current.timerState === 'running' ? current.breakMinutes : mode.breakMinutes,
      remainingSeconds: current.timerState === 'running' ? current.remainingSeconds : mode.focusMinutes * 60,
      timerMode: current.timerState === 'running' ? current.timerMode : 'focus',
      ambientEnabled: mode.id === 'exam' ? false : current.ambientEnabled
    }))
  }

  const toggleContract = (): void => {
    setSnapshot((current) => ({
      ...current,
      contractText: (current.contractText.trim() || defaultContractText()).slice(0, 120),
      contractLocked: !current.contractLocked
    }))
  }

  const updateContractText = (contractText: string): void => {
    setSnapshot((current) => ({ ...current, contractText: contractText.slice(0, 120) }))
  }

  const saveNickname = (nicknameInput: string): void => {
    const nickname = nicknameInput.trim().slice(0, 18)
    if (nickname) {
      setSnapshot((current) => ({ ...current, nickname }))
    }
  }

  const joinSpace = (spaceInput: string): void => {
    const spaceCode = normalizeStudySpaceCode(spaceInput)
    setSnapshot((current) => ({ ...current, spaceCode }))
  }

  const createSpace = (): void => {
    const spaceCode = randomStudySpaceCode()
    setSnapshot((current) => ({ ...current, spaceCode }))
  }

  const saveRelayUrl = (relayInput: string): string => {
    const relayUrl = normalizeStudyRelayUrl(relayInput)
    setSnapshot((current) => ({ ...current, presenceRelayUrl: relayUrl }))
    return relayUrl
  }

  const resetRelayUrl = (): void => {
    setSnapshot((current) => ({ ...current, presenceRelayUrl: STUDY_PRESENCE_BROKER_URL }))
  }

  const toggleTimer = (): void => {
    if (snapshot.timerState !== 'running' && snapshot.timerMode === 'focus') {
      emitRoomEvent('focus_start', `${snapshot.nickname} 开始专注：${viewModel.contractDisplay}`)
    }
    setSnapshot((current) => ({
      ...current,
      timerState: current.timerState === 'running' ? 'paused' : 'running',
      ...(current.timerState === 'running'
        ? {}
        : {
            contractText: (current.contractText.trim() || current.tasks.find((task) => !task.done)?.title || viewModel.activeMode.name).slice(0, 120),
            contractLocked: current.timerMode === 'focus' ? true : current.contractLocked
          })
    }))
  }

  const followRoomCycle = (): void => {
    const nextContract = (snapshot.contractText.trim() || defaultContractText()).slice(0, 120)
    if (viewModel.roomCycle.phase === 'focus') {
      emitRoomEvent('focus_start', `${snapshot.nickname} 跟随房间第 ${viewModel.roomCycle.round} 轮开始专注：${nextContract}`)
    }
    setSnapshot((current) => ({
      ...current,
      focusMinutes: viewModel.activeRoom.sessionMinutes,
      breakMinutes: viewModel.activeRoom.breakMinutes,
      timerMode: viewModel.roomCycle.phase,
      timerState: 'running',
      remainingSeconds: viewModel.roomCycle.remainingSeconds,
      contractText: nextContract,
      contractLocked: viewModel.roomCycle.phase === 'focus'
    }))
  }

  const chooseSeat = (seatIndex: number): void => {
    if (seatIndex === viewModel.userSeat || viewModel.peersBySeat.has(seatIndex)) return
    const seatLabel = formatStudySeatLabel(seatIndex)
    setSnapshot((current) => ({ ...current, seatIndex }))
    emitRoomEvent('checkin', `${snapshot.nickname} 换到 ${seatLabel}。`)
  }

  const runHostAction = (): void => {
    if (snapshot.timerState === 'running') {
      openFocusTheater()
      return
    }
    if (!snapshot.contractLocked && snapshot.timerMode === 'focus') {
      toggleContract()
      return
    }
    if (!viewModel.followingRoomCycle) {
      followRoomCycle()
      return
    }
    toggleTimer()
  }

  const resetTimer = (): void => {
    setSnapshot((current) => ({
      ...current,
      timerState: 'idle',
      contractLocked: false,
      remainingSeconds: (current.timerMode === 'focus' ? current.focusMinutes : current.breakMinutes) * 60
    }))
  }

  const switchTimerMode = (timerMode: StudyTimerMode): void => {
    setSnapshot((current) => ({
      ...current,
      timerMode,
      timerState: current.timerState === 'running' ? 'paused' : current.timerState,
      remainingSeconds: (timerMode === 'focus' ? current.focusMinutes : current.breakMinutes) * 60
    }))
  }

  const addTask = (titleInput: string): boolean => {
    const title = titleInput.trim()
    if (!title) return false
    setSnapshot((current) => ({
      ...current,
      tasks: [{ id: `${Date.now()}`, title: title.slice(0, 80), done: false }, ...current.tasks].slice(0, 8)
    }))
    return true
  }

  const toggleTask = (taskId: string): void => {
    const task = snapshot.tasks.find((item) => item.id === taskId)
    if (task && !task.done) {
      emitRoomEvent('task_done', `${snapshot.nickname} 完成任务：${task.title}`)
    }
    setSnapshot((current) => ({
      ...current,
      tasks: current.tasks.map((task) => task.id === taskId ? { ...task, done: !task.done } : task)
    }))
  }

  const removeDoneTasks = (): void => {
    setSnapshot((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => !task.done)
    }))
  }

  const selectSignal = (signalId: StudySignalId): void => {
    setSnapshot((current) => ({ ...current, signalId }))
  }

  const toggleAmbientEnabled = (): void => {
    setSnapshot((current) => ({ ...current, ambientEnabled: !current.ambientEnabled }))
  }

  const setAmbientVolume = (ambientVolume: number): void => {
    setSnapshot((current) => ({ ...current, ambientVolume }))
  }

  return {
    snapshot,
    presence,
    roomCycleNow,
    viewModel,
    emitRoomEvent,
    updateTimerPreset,
    selectRoom,
    selectStudyMode,
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
    toggleTask,
    removeDoneTasks,
    selectSignal,
    toggleAmbientEnabled,
    setAmbientVolume
  }
}
