import { Check, CheckCircle2, ChevronDown, Coffee, Copy, DoorOpen, ExternalLink, GitBranch, Info, KeyRound, LinkIcon, Lock, Maximize2, Monitor, Pause, Play, Plus, RefreshCw, RotateCcw, Settings, ShieldCheck, Sparkles, Star, Target, Timer, Trophy, Users, Volume2, VolumeX, X, Zap } from 'lucide-react'
import type { CSSProperties, FormEvent } from 'react'
import { Fragment, useEffect, useRef, useState } from 'react'
import studyRoomAmbience from '../assets/study-room-ambience.webp'
import { STUDY_PRESENCE_BROKER_URL, STUDY_PRESENCE_PEER_TTL_MS, STUDY_PUBLIC_SPACE_CODE, studyModes, studyRooms, studySignals } from './constants'
import { defaultStudySeatIndex, formatStudyDuration, formatStudyEventTime, formatStudyHours, formatStudyPresenceAge, formatStudySeatLabel, getStudyRoomCycle, nextStudyStreak, normalizeStudyRelayUrl, normalizeStudySeatIndex, normalizeStudySpaceCode, persistStudySnapshot, randomStudySpaceCode, readStudySnapshot, studyInviteUrl, studyLevel, studyMemberFreshnessLabel, studyMemberStatusLabel, studyPlantStage, studySignalLabel, studySignalShortLabel, studyVerificationUrl, syncStudyLocation, todayKey } from './domain'
import { useStudyAmbient } from './useStudyAmbient'
import { useStudyPresence } from './useStudyPresence'
import type { StudyPresencePeer, StudyRoomEventKind, StudySnapshot, StudyTimerMode } from './types'
import './styles.css'

type StudySpaceProps = {
  showNotification: (title: string, body: string) => Promise<void>
}

export function StudySpace({ showNotification }: StudySpaceProps) {
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => readStudySnapshot())
  const [roomCycleNow, setRoomCycleNow] = useState(() => Date.now())
  const [taskInput, setTaskInput] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [spaceDraft, setSpaceDraft] = useState('')
  const [relayDraft, setRelayDraft] = useState(snapshot.presenceRelayUrl)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [proofCopyState, setProofCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [verifyOpenState, setVerifyOpenState] = useState<'idle' | 'opened' | 'blocked'>('idle')
  const [focusTheaterOpen, setFocusTheaterOpen] = useState(false)
  const presence = useStudyPresence(snapshot)
  const activeRoom = studyRooms.find((room) => room.id === snapshot.roomId) ?? studyRooms[0]
  const activeMode = studyModes.find((mode) => mode.id === snapshot.modeId) ?? studyModes[0]
  const roomCycle = getStudyRoomCycle(activeRoom, roomCycleNow)
  useStudyAmbient(snapshot.roomId, snapshot.ambientEnabled, snapshot.ambientVolume)
  const level = studyLevel(snapshot.xp)
  const presenceOnline = presence.status === 'online'
  const activePeers = presenceOnline
    ? presence.peers.filter((peer) => peer.spaceCode === snapshot.spaceCode && peer.roomId === snapshot.roomId)
    : []
  const spacePeers = presenceOnline
    ? presence.peers.filter((peer) => peer.spaceCode === snapshot.spaceCode)
    : []
  const online = presenceOnline ? activePeers.length + 1 : 0
  const spaceOnline = presenceOnline ? spacePeers.length + 1 : 0
  const remoteOnline = presenceOnline ? activePeers.length : 0
  const roomCapacityPercent = Math.min(100, Math.round((online / activeRoom.capacity) * 100))
  const localSeatLabel = presenceOnline ? `${spaceOnline} 人在 ${snapshot.spaceCode}` : `本机席位 · ${snapshot.spaceCode}`
  const timerTotalSeconds = (snapshot.timerMode === 'focus' ? snapshot.focusMinutes : snapshot.breakMinutes) * 60
  const timerProgress = timerTotalSeconds > 0 ? Math.round(((timerTotalSeconds - snapshot.remainingSeconds) / timerTotalSeconds) * 100) : 0
  const followingRoomCycle = snapshot.timerState === 'running'
    && snapshot.timerMode === roomCycle.phase
    && snapshot.focusMinutes === activeRoom.sessionMinutes
    && snapshot.breakMinutes === activeRoom.breakMinutes
  const completedTasks = snapshot.tasks.filter((task) => task.done).length
  const openTasks = snapshot.tasks.length - completedTasks
  const currentTask = snapshot.tasks.find((task) => !task.done)
  const seatCount = activeRoom.seats
  const userSeat = normalizeStudySeatIndex(snapshot.seatIndex, snapshot.roomId, snapshot.clientId)
  const peersBySeat = new Map<number, StudyPresencePeer>()
  activePeers.forEach((peer) => {
    const seatIndex = normalizeStudySeatIndex(peer.seatIndex, peer.roomId, peer.clientId)
    if (!peersBySeat.has(seatIndex)) peersBySeat.set(seatIndex, peer)
  })
  const weeklyFocus = [0.42, 0.66, 0.28, 0.74, 0.54, 0.86, Math.min(1, snapshot.todayFocusSeconds / Math.max(1, snapshot.focusMinutes * 60 * 4))]
  const badges = [
    { label: '首个番茄', unlocked: snapshot.totalSessions >= 1 },
    { label: '稳定三连', unlocked: snapshot.streakDays >= 3 },
    { label: '十小时', unlocked: snapshot.totalFocusSeconds >= 10 * 3600 },
    { label: '任务清空', unlocked: snapshot.tasks.length > 0 && completedTasks === snapshot.tasks.length }
  ]
  const roomMembers = [
    {
      clientId: snapshot.clientId,
      nickname: snapshot.nickname,
      signalId: snapshot.signalId,
      status: snapshot.timerState,
      timerMode: snapshot.timerMode,
      todayFocusSeconds: snapshot.todayFocusSeconds,
      todaySessions: snapshot.todaySessions,
      streakDays: snapshot.streakDays,
      focusMinutes: snapshot.focusMinutes,
      roomId: snapshot.roomId,
      seatIndex: userSeat,
      updatedAt: roomCycleNow,
      isSelf: true
    },
    ...activePeers.map((peer) => ({
      ...peer,
      isSelf: false
    }))
  ].sort((left, right) => right.todayFocusSeconds - left.todayFocusSeconds)
  const roomFocusSeconds = roomMembers.reduce((sum, member) => sum + member.todayFocusSeconds, 0)
  const roomMaxFocusSeconds = Math.max(1, ...roomMembers.map((member) => member.todayFocusSeconds))
  const focusingCount = roomMembers.filter((member) => member.status === 'running' && member.timerMode === 'focus').length
  const liveDeskMembers = roomMembers.slice(0, 5)
  const inviteUrl = studyInviteUrl(snapshot.spaceCode, snapshot.roomId)
  const signalMix = studySignals.map((signal) => {
    const members = roomMembers.filter((member) => member.signalId === signal.id)
    return {
      ...signal,
      count: members.length,
      focusing: members.filter((member) => member.status === 'running' && member.timerMode === 'focus').length
    }
  })
  const activeSignalMix = signalMix.filter((signal) => signal.count > 0)
  const signalMixSummary = activeSignalMix.length > 0
    ? activeSignalMix.map((signal) => `${signal.label} ${signal.count}`).join('、')
    : `${studySignalLabel(snapshot.signalId)} 1`
  const remoteFreshCount = activePeers.filter((peer) => roomCycleNow - peer.updatedAt <= STUDY_PRESENCE_PEER_TTL_MS).length
  const topicTail = presence.topic.split('/').slice(-2).join('/')
  const relayHealthLabel = presence.status === 'online'
    ? '在线同步'
    : presence.status === 'connecting'
      ? '连接中'
      : '本机席位'
  const remoteHeartbeatLabel = remoteOnline > 0
    ? `${remoteFreshCount}/${remoteOnline} 心跳`
    : presence.status === 'online'
      ? '等待心跳'
      : presence.status === 'connecting'
        ? '连接中'
        : '待同步'
  const remoteFreshValue = remoteOnline > 0
    ? `${remoteFreshCount}/${remoteOnline}`
    : presence.status === 'online'
      ? '待加入'
      : presence.status === 'connecting'
        ? '连接中'
        : '待同步'
  const presenceProofRows = [
    { label: '本机心跳', value: formatStudyPresenceAge(presence.lastHeartbeatAt, roomCycleNow) },
    { label: '最近远端', value: formatStudyPresenceAge(presence.lastRemoteMessageAt, roomCycleNow) },
    { label: '远端新鲜度', value: `${remoteFreshCount}/${remoteOnline}` },
    { label: '会话身份', value: snapshot.clientId.slice(-4).toUpperCase() }
  ]
  const arrivalRosterMembers = roomMembers.slice(0, 4)
  const roomEvents = presence.events
    .filter((event) => event.spaceCode === snapshot.spaceCode && event.roomId === snapshot.roomId)
    .slice(0, 8)
  const recentLiveEvents = roomEvents.slice(0, 3)
  const roomSummaries = studyRooms.map((room) => {
    const roomCycleInfo = getStudyRoomCycle(room, roomCycleNow)
    const roomPeers = presenceOnline
      ? presence.peers.filter((peer) => peer.spaceCode === snapshot.spaceCode && peer.roomId === room.id)
      : []
    const isLocalRoom = snapshot.roomId === room.id
    const roomOnline = presenceOnline ? roomPeers.length + (isLocalRoom ? 1 : 0) : 0
    const roomFocusing = presenceOnline
      ? roomPeers.filter((peer) => peer.status === 'running' && peer.timerMode === 'focus').length
        + (isLocalRoom && snapshot.timerState === 'running' && snapshot.timerMode === 'focus' ? 1 : 0)
      : 0
    const latestPeer = roomPeers.slice().sort((left, right) => right.updatedAt - left.updatedAt)[0]
    const roomPeerClientIds = new Set(roomPeers.map((peer) => peer.clientId))
    const latestEvent = presence.events.find((event) => (
      event.spaceCode === snapshot.spaceCode
      && event.roomId === room.id
      && (
        roomPeerClientIds.has(event.clientId)
        || (isLocalRoom && event.clientId === snapshot.clientId)
      )
    ))
    const latestText = latestEvent
      ? latestEvent.text
      : latestPeer
        ? `${latestPeer.nickname} · ${formatStudySeatLabel(normalizeStudySeatIndex(latestPeer.seatIndex, latestPeer.roomId, latestPeer.clientId))} · ${studyMemberStatusLabel(latestPeer.status, latestPeer.timerMode)}`
        : isLocalRoom
          ? `${snapshot.nickname} · ${formatStudySeatLabel(userSeat)} · ${studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}`
          : presence.status === 'online'
            ? '等待同学入座'
            : presence.status === 'connecting'
              ? '连接中'
              : '待同步'
    const latestMeta = latestEvent
      ? formatStudyEventTime(latestEvent.createdAt)
      : latestPeer
        ? studyMemberFreshnessLabel(latestPeer, roomCycleNow)
        : isLocalRoom
          ? '我的当前房间'
          : presence.status === 'online'
            ? '实时在线'
            : presence.status === 'connecting'
              ? '正在连接'
              : '本机席位'
    return {
      room,
      cycle: roomCycleInfo,
      online: roomOnline,
      focusing: roomFocusing,
      latestText,
      latestMeta,
      hasRemote: roomPeers.length > 0,
      isActive: isLocalRoom
    }
  })
  const latestRoomEvent = roomEvents[0]
  const latestRemotePeer = activePeers
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
  const connectionLabel = presence.status === 'online'
    ? '实时在线'
    : presence.status === 'connecting'
      ? '正在连接'
      : '本机席位'
  const liveLineCode = latestRoomEvent
    ? latestRoomEvent.kind === 'checkin'
      ? 'IN'
      : latestRoomEvent.kind === 'focus_start'
        ? 'GO'
        : latestRoomEvent.kind === 'task_done'
          ? 'OK'
          : 'UP'
    : latestRemotePeer
      ? 'PEER'
      : presence.status === 'online'
        ? 'LIVE'
        : 'SYNC'
  const liveLineText = latestRoomEvent
    ? latestRoomEvent.text
    : latestRemotePeer
      ? `${latestRemotePeer.nickname} 在 ${formatStudySeatLabel(normalizeStudySeatIndex(latestRemotePeer.seatIndex, latestRemotePeer.roomId, latestRemotePeer.clientId))} · ${studySignalLabel(latestRemotePeer.signalId)} · ${studyMemberStatusLabel(latestRemotePeer.status, latestRemotePeer.timerMode)}`
      : presence.status === 'online'
        ? '实时教室已连接，签到或开始专注后会同步到同空间同房间。'
        : presence.status === 'connecting'
          ? '正在进入在线教室，连接成功后会显示真实同桌。'
          : '已保留你的真实席位，邀请同学或同步恢复后会显示同桌。'
  const liveLineMeta = latestRoomEvent
    ? formatStudyEventTime(latestRoomEvent.createdAt)
    : latestRemotePeer
      ? studyMemberFreshnessLabel(latestRemotePeer, roomCycleNow)
      : connectionLabel
  const liveLineClass = latestRoomEvent ? ` is-${latestRoomEvent.kind}` : latestRemotePeer ? ' has-peer' : ' is-empty'
  const connectionDetail = presence.status === 'online'
    ? `人数来自同空间的实时同步：本房间 ${online} 人，整个空间 ${spaceOnline} 人。`
    : presence.status === 'connecting'
      ? '正在进入在线教室，连接前只保留当前席位。'
      : '同步服务暂不可用，页面会保留你的本机席位，在线人数不会虚增。'
  const liveSessionTitle = remoteOnline > 0
    ? `已收到 ${remoteOnline} 个远端同桌`
    : presence.status === 'online'
      ? '一键验证真实在线人数'
      : '等待在线教室连接'
  const liveSessionDetail = remoteOnline > 0
    ? `最近远端消息 ${formatStudyPresenceAge(presence.lastRemoteMessageAt, roomCycleNow)}，超过 ${Math.round(STUDY_PRESENCE_PEER_TTL_MS / 1000)} 秒未心跳会自动下线。`
    : presence.status === 'online'
      ? '打开一个独立同桌窗口会使用新的 session 身份，连接成功后本房间在线人数才会增加。'
      : '连接成功前会保留当前席位；你可以复制邀请或等待同步服务恢复。'
  const inviteHint = snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE
    ? '公共大厅不用邀请码；新建空间后可只邀请自己的同学进入。'
    : `把空间码 ${snapshot.spaceCode} 发给同学，对方输入后会进入同一个在线 presence 房间。`
  const stageStatusLabel = snapshot.timerState === 'running'
    ? snapshot.timerMode === 'focus'
      ? '专注中'
      : '休息中'
    : snapshot.timerState === 'paused'
      ? '已暂停'
      : '准备进入'
  const contractDisplay = snapshot.contractText.trim() || snapshot.tasks.find((task) => !task.done)?.title || activeMode.name
  const hostActionLabel = snapshot.timerState === 'running'
    ? '进入沉浸'
    : !snapshot.contractLocked && snapshot.timerMode === 'focus'
      ? '锁定目标'
      : !followingRoomCycle
        ? '跟随房间'
        : '开始专注'
  const hostActionIcon = snapshot.timerState === 'running'
    ? <Maximize2 size={14} />
    : !snapshot.contractLocked && snapshot.timerMode === 'focus'
      ? <ShieldCheck size={14} />
      : !followingRoomCycle
        ? <RefreshCw size={14} />
        : <Play size={14} />
  const hostBrief = snapshot.timerState === 'running'
    ? `${snapshot.nickname} 正在 ${formatStudySeatLabel(userSeat)} 专注，保持本轮目标不切换。`
    : snapshot.timerMode === 'break'
      ? `现在是同步休息，${formatStudyDuration(snapshot.remainingSeconds)} 后回到专注。`
      : `${formatStudySeatLabel(userSeat)} 已入座，锁定一个目标后跟随房间节奏开始。`
  const hostChecklist = [
    { label: '座位', value: `${formatStudySeatLabel(userSeat)} · ${snapshot.spaceCode}` },
    { label: '状态', value: `${studySignalLabel(snapshot.signalId)} · ${activeMode.name}` },
    { label: '目标', value: contractDisplay },
    { label: '节奏', value: `${roomCycle.phase === 'focus' ? '专注' : '休息'} · ${formatStudyDuration(roomCycle.remainingSeconds)}` }
  ]
  const roomFeed = [
    `${activeRoom.name} 当前 ${focusingCount} 人正在专注，今日合计 ${formatStudyHours(roomFocusSeconds)}h。`,
    snapshot.timerState === 'running'
      ? `${snapshot.nickname} 正在进行 ${snapshot.focusMinutes} 分钟专注轮次：${contractDisplay}。`
      : `${snapshot.nickname} 已入座，等待开始下一轮。`,
    `学习状态分布：${signalMixSummary}。`,
    `你的座位是 ${formatStudySeatLabel(userSeat)}；点击空座可换到更合适的位置。`,
    `房间第 ${roomCycle.round} 轮正在${roomCycle.phase === 'focus' ? '专注' : '休息'}，${formatStudyDuration(roomCycle.remainingSeconds)} 后切换到${roomCycle.nextLabel}。`,
    completedTasks > 0 ? `今日已完成 ${completedTasks} 个学习任务。` : '先写下本轮目标，再开始番茄钟。',
    presence.status === 'online'
      ? `空间 ${snapshot.spaceCode} 已连接实时自习室，远端同学 ${remoteOnline} 人。`
      : '在线同步不可用时，先保留你的本机席位。'
  ]
  const roomRules = [
    snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE ? '公共大厅：任何 StudiumX 用户都可进入' : `私密空间：凭 ${snapshot.spaceCode} 加入`,
    `${activeMode.name}：${activeMode.rule}`,
    activeRoom.id === 'exam' ? '考试模拟间默认静音，不播放环境音' : `${activeRoom.ambient} 可在右侧开关`,
    '在线状态只广播匿名座位和学习信号，不上传学习任务内容'
  ]
  const roomEventSenderRef = useRef(presence.sendEvent)
  const lastFocusCompletionEventRef = useRef('')
  const timerTransitionRef = useRef({
    timerMode: snapshot.timerMode,
    timerState: snapshot.timerState,
    todaySessions: snapshot.todaySessions,
    totalSessions: snapshot.totalSessions
  })

  const emitRoomEvent = (kind: StudyRoomEventKind, text: string): void => {
    presence.sendEvent(kind, text)
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
    if (!focusTheaterOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setFocusTheaterOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusTheaterOpen])

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

  const selectRoom = (room: typeof studyRooms[number]): void => {
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

  const selectStudyMode = (mode: typeof studyModes[number]): void => {
    const targetRoom = snapshot.timerState === 'running' ? snapshot.roomId : mode.roomId
    if (targetRoom !== snapshot.roomId) {
      const roomName = studyRooms.find((room) => room.id === targetRoom)?.name ?? activeRoom.name
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

  const defaultContractText = (): string => {
    const firstOpenTask = snapshot.tasks.find((task) => !task.done)?.title
    return firstOpenTask || activeMode.name
  }

  const toggleContract = (): void => {
    setSnapshot((current) => ({
      ...current,
      contractText: (current.contractText.trim() || defaultContractText()).slice(0, 120),
      contractLocked: !current.contractLocked
    }))
  }

  const saveNickname = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const nickname = nicknameDraft.trim().slice(0, 18)
    if (nickname) {
      setSnapshot((current) => ({ ...current, nickname }))
    }
    setEditingName(false)
  }

  const joinSpace = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const spaceCode = normalizeStudySpaceCode(spaceDraft)
    setSnapshot((current) => ({ ...current, spaceCode }))
    setSpaceDraft('')
    setCopyState('idle')
  }

  const createSpace = (): void => {
    const spaceCode = randomStudySpaceCode()
    setSnapshot((current) => ({ ...current, spaceCode }))
    setSpaceDraft('')
    setCopyState('idle')
  }

  const saveRelayUrl = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const relayUrl = normalizeStudyRelayUrl(relayDraft)
    setRelayDraft(relayUrl)
    setSnapshot((current) => ({ ...current, presenceRelayUrl: relayUrl }))
  }

  const resetRelayUrl = (): void => {
    setRelayDraft(STUDY_PRESENCE_BROKER_URL)
    setSnapshot((current) => ({ ...current, presenceRelayUrl: STUDY_PRESENCE_BROKER_URL }))
  }

  const copyInvite = async (): Promise<void> => {
    const text = `StudiumX 学习空间：${activeRoom.name}\n链接：${inviteUrl}\n空间码：${snapshot.spaceCode}\n进入后会加入同一在线自习室；另开窗口或标签页会使用独立同桌身份。`
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2200)
    } catch {
      setCopyState('failed')
    }
  }

  const copyPresenceProof = async (): Promise<void> => {
    const text = [
      `StudiumX live proof`,
      `space=${snapshot.spaceCode}`,
      `room=${activeRoom.name}`,
      `relay=${presence.relay}`,
      `topic=${presence.topic}`,
      `status=${presence.status}`,
      `sessionPeer=${snapshot.clientId}`,
      `localHeartbeat=${formatStudyPresenceAge(presence.lastHeartbeatAt, roomCycleNow)}`,
      `lastRemote=${formatStudyPresenceAge(presence.lastRemoteMessageAt, roomCycleNow)}`,
      `remotePeers=${remoteOnline}`,
      `freshPeers=${remoteFreshCount}`,
      `ttlSeconds=${Math.round(STUDY_PRESENCE_PEER_TTL_MS / 1000)}`,
      `invite=${inviteUrl}`
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setProofCopyState('copied')
      window.setTimeout(() => setProofCopyState('idle'), 2200)
    } catch {
      setProofCopyState('failed')
    }
  }

  const openVerificationWindow = (): void => {
    const opened = window.open(studyVerificationUrl(inviteUrl), '_blank')
    if (opened) {
      opened.focus()
      setVerifyOpenState('opened')
      window.setTimeout(() => setVerifyOpenState('idle'), 2200)
    } else {
      setVerifyOpenState('blocked')
    }
  }

  const toggleTimer = (): void => {
    if (snapshot.timerState !== 'running' && snapshot.timerMode === 'focus') {
      emitRoomEvent('focus_start', `${snapshot.nickname} 开始专注：${contractDisplay}`)
    }
    setSnapshot((current) => ({
      ...current,
      timerState: current.timerState === 'running' ? 'paused' : 'running',
      ...(current.timerState === 'running'
        ? {}
        : {
            contractText: (current.contractText.trim() || current.tasks.find((task) => !task.done)?.title || activeMode.name).slice(0, 120),
            contractLocked: current.timerMode === 'focus' ? true : current.contractLocked
          })
    }))
  }

  const followRoomCycle = (): void => {
    const nextContract = (snapshot.contractText.trim() || defaultContractText()).slice(0, 120)
    if (roomCycle.phase === 'focus') {
      emitRoomEvent('focus_start', `${snapshot.nickname} 跟随房间第 ${roomCycle.round} 轮开始专注：${nextContract}`)
    }
    setSnapshot((current) => ({
      ...current,
      focusMinutes: activeRoom.sessionMinutes,
      breakMinutes: activeRoom.breakMinutes,
      timerMode: roomCycle.phase,
      timerState: 'running',
      remainingSeconds: roomCycle.remainingSeconds,
      contractText: nextContract,
      contractLocked: roomCycle.phase === 'focus'
    }))
  }

  const chooseSeat = (seatIndex: number): void => {
    if (seatIndex === userSeat || peersBySeat.has(seatIndex)) return
    const seatLabel = formatStudySeatLabel(seatIndex)
    setSnapshot((current) => ({ ...current, seatIndex }))
    emitRoomEvent('checkin', `${snapshot.nickname} 换到 ${seatLabel}。`)
  }

  const runHostAction = (): void => {
    if (snapshot.timerState === 'running') {
      setFocusTheaterOpen(true)
      return
    }
    if (!snapshot.contractLocked && snapshot.timerMode === 'focus') {
      toggleContract()
      return
    }
    if (!followingRoomCycle) {
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

  const addTask = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const title = taskInput.trim()
    if (!title) return
    setSnapshot((current) => ({
      ...current,
      tasks: [{ id: `${Date.now()}`, title: title.slice(0, 80), done: false }, ...current.tasks].slice(0, 8)
    }))
    setTaskInput('')
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
  const roomBackdropStyle = {
    '--study-room-image': `url(${studyRoomAmbience})`
  } as CSSProperties

  return (
    <section
      className={`study-space ${activeRoom.backdrop}${snapshot.timerState === 'running' ? ' is-running' : ''}${snapshot.timerMode === 'break' ? ' is-break' : ''}`}
      style={roomBackdropStyle}
      aria-label="学习空间"
    >
      <div className="study-hero">
        <div className="study-hero-copy">
          <span className="study-eyebrow"><DoorOpen size={14} /> 在线自习室</span>
          <h1>{activeRoom.name}</h1>
          <p>{activeRoom.tone}</p>
          <div className="study-hero-meta">
            <span className={`study-presence-pill is-${presence.status}`}>
              <span />
              {presence.status === 'online' ? `${online} 人在线` : presence.status === 'connecting' ? '连接教室中' : '离线，仅本机'}
            </span>
            <span>空间 {snapshot.spaceCode}</span>
            <span>{activeRoom.light}</span>
            <span>{activeRoom.ambient}</span>
            <span>{presence.status === 'online' ? '实时同步' : presence.status === 'connecting' ? '连接同步' : '本机模式'}</span>
          </div>
          <div className={`study-hero-livebar is-${presence.status}${latestRemotePeer ? ' has-peer' : ''}`} aria-label="首屏实时房间状态">
            <span>{liveLineCode}</span>
            <strong>{liveLineText}</strong>
            <em>{liveLineMeta}</em>
            <div>
              <small>{focusingCount} 专注</small>
              <small>{remoteHeartbeatLabel}</small>
              <small>{online}/{activeRoom.capacity}</small>
            </div>
          </div>
        </div>
        <div className="study-header-stats" aria-label="学习统计">
          <span><Zap size={15} /> 连续 {snapshot.streakDays}</span>
          <span><Trophy size={15} /> 等级 {level.level}</span>
          <span><Target size={15} /> {completedTasks}/{snapshot.tasks.length}</span>
          <form className="study-hero-join" onSubmit={joinSpace}>
            <KeyRound size={14} />
            <input
              value={spaceDraft}
              onChange={(event) => setSpaceDraft(event.target.value)}
              placeholder="输入空间码"
              aria-label="加入在线自习空间码"
              maxLength={18}
            />
            <button type="submit">加入</button>
          </form>
        </div>
      </div>

      <details className="study-arrival" aria-label="在线自习室设置">
        <summary className="study-arrival-summary">
          <span><Settings size={14} /> 房间设置与联机验证</span>
          <strong>{online}/{activeRoom.capacity} 在线 · {remoteOnline} 远端 · {relayHealthLabel}</strong>
          <ChevronDown size={14} />
        </summary>
        <div className="study-arrival-body">
        <div className="study-arrival-live">
          <div className="study-arrival-head">
            <div>
              <span className="study-kicker"><Users size={14} /> 真实在线</span>
              <h2>同桌在线</h2>
            </div>
            <span className={`study-relay-badge is-${presence.status}`}>{relayHealthLabel}</span>
          </div>
          <div className="study-arrival-counts">
            <div>
              <strong>{online}</strong>
              <span>本房间在线</span>
            </div>
            <div>
              <strong>{spaceOnline}</strong>
              <span>本空间在线</span>
            </div>
            <div>
              <strong>{remoteOnline}</strong>
              <span>远端会话</span>
            </div>
          </div>
          <div className={`study-room-pulse is-${presence.status}${latestRemotePeer ? ' has-peer' : ''}`} aria-label="房间实时脉搏">
            <div className="study-room-pulse-main">
              <span>{liveLineCode}</span>
              <div>
                <strong>{liveLineText}</strong>
                <small>{liveLineMeta}</small>
              </div>
            </div>
            <div className="study-room-pulse-stats">
              <div>
                <strong>{focusingCount}</strong>
                <span>专注中</span>
              </div>
              <div>
                <strong>{remoteFreshValue}</strong>
                <span>远端心跳</span>
              </div>
              <div>
                <strong>{online}/{activeRoom.capacity}</strong>
                <span>容量</span>
              </div>
            </div>
            <div className="study-room-pulse-meter" aria-hidden="true">
              <span style={{ width: `${roomCapacityPercent}%` }} />
            </div>
          </div>
          <div className="study-arrival-roster" aria-label="入座同桌">
            {arrivalRosterMembers.map((member) => (
              <div className={`study-arrival-roster-seat${member.isSelf ? ' is-me' : ''}`} key={member.clientId}>
                <span>{member.nickname.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{member.isSelf ? '我的席位' : member.nickname}</strong>
                  <small>{formatStudySeatLabel(normalizeStudySeatIndex(member.seatIndex, member.roomId, member.clientId))} · {studyMemberStatusLabel(member.status, member.timerMode)} · {studyMemberFreshnessLabel(member, roomCycleNow)}</small>
                </div>
              </div>
            ))}
            <div className="study-arrival-roster-seat is-empty">
              <span><Plus size={13} /></span>
              <div>
                <strong>{presence.status === 'online' ? '等待同桌入座' : '等待同步服务'}</strong>
                <small>{presence.status === 'online' ? '复制邀请或打开同桌窗口后才会增加人数' : '同步恢复后才会显示远端席位'}</small>
              </div>
            </div>
          </div>
          <div className={`study-presence-test is-${presence.status}${remoteOnline > 0 ? ' has-peer' : ''}`}>
            <div>
              <span className="study-kicker"><Monitor size={14} /> 邀请同桌</span>
              <strong>{liveSessionTitle}</strong>
              <p>{liveSessionDetail}</p>
            </div>
            <button type="button" onClick={openVerificationWindow} disabled={presence.status !== 'online'}>
              <ExternalLink size={14} />
              {remoteOnline > 0 ? '再开一个同桌' : verifyOpenState === 'opened' ? '已打开同桌窗口' : verifyOpenState === 'blocked' ? '窗口被拦截' : '开同桌窗口'}
            </button>
          </div>
          <div className="study-arrival-actions">
            <button type="button" onClick={() => void copyInvite()}>
              <Copy size={14} />
              {copyState === 'copied' ? '已复制邀请' : '复制邀请'}
            </button>
            <button type="button" onClick={createSpace}>
              <Lock size={14} />
              新建私密空间
            </button>
          </div>
          <details className="study-online-proof">
            <summary>
              <span><GitBranch size={14} /> 在线证明</span>
              <ChevronDown size={14} />
            </summary>
            <div className="study-online-proof-grid">
              <div className="study-online-proof-topic">
                <span>Presence topic</span>
                <strong>{topicTail}</strong>
              </div>
              <div className="study-online-proof-topic">
                <span>Relay</span>
                <strong>{presence.relay}</strong>
              </div>
              {presenceProofRows.map((row) => (
                <div className="study-proof-row" key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => void copyPresenceProof()}>
              <Copy size={13} />
              {proofCopyState === 'copied' ? '已复制证明' : proofCopyState === 'failed' ? '复制失败' : '复制在线证明'}
            </button>
          </details>
          <div className="study-arrival-link" title={inviteUrl}>
            <LinkIcon size={13} />
            <span>{inviteUrl}</span>
          </div>
          <div className="study-invite-strip" aria-label="房间邀请状态">
            <div title={inviteHint}>
              <span>空间码</span>
              <strong>{snapshot.spaceCode}</strong>
            </div>
            <div>
              <span>空间类型</span>
              <strong>{snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE ? '公共大厅' : '私密空间'}</strong>
            </div>
            <div>
              <span>邀请</span>
              <strong>{copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '待发送'}</strong>
            </div>
            <div>
              <span>验证</span>
              <strong>{remoteOnline > 0 ? '已见远端' : verifyOpenState === 'opened' ? '窗口已开' : verifyOpenState === 'blocked' ? '被拦截' : '待验证'}</strong>
            </div>
          </div>
        </div>

        <div className="study-arrival-focus">
          <div className="study-arrival-head">
            <div>
              <span className="study-kicker"><Timer size={14} /> 房间节奏</span>
              <h2>{roomCycle.phase === 'focus' ? '同频专注中' : '同步休息中'}</h2>
            </div>
            <strong className="study-arrival-clock">{formatStudyDuration(roomCycle.remainingSeconds)}</strong>
          </div>
          <p>第 {roomCycle.round} 轮，下一段是{roomCycle.nextLabel}。当前目标：{contractDisplay}</p>
          <div className="study-arrival-meter" aria-hidden="true">
            <span style={{ width: `${roomCapacityPercent}%` }} />
          </div>
          <div className="study-arrival-actions">
            <button type="button" onClick={followRoomCycle}>
              <RefreshCw size={14} />
              跟随房间
            </button>
            <button type="button" onClick={() => setFocusTheaterOpen(true)}>
              <Maximize2 size={14} />
              沉浸开始
            </button>
          </div>
        </div>

        <div className="study-arrival-rooms">
          <div className="study-arrival-head">
            <div>
              <span className="study-kicker"><DoorOpen size={14} /> 自习房间</span>
              <h2>选择房间</h2>
            </div>
            <span>{snapshot.spaceCode}</span>
          </div>
          <div className="study-arrival-room-grid">
            {roomSummaries.map(({ room, cycle, online: roomOnline, focusing: roomFocusing, isActive }) => (
              <button
                className={`study-arrival-room${isActive ? ' is-active' : ''}`}
                key={room.id}
                type="button"
                onClick={() => selectRoom(room)}
              >
                <strong>{room.name}</strong>
                <span>{roomOnline}/{room.capacity} · {roomFocusing} 专注 · {cycle.phase === 'focus' ? '专注' : '休息'} {formatStudyDuration(cycle.remainingSeconds)}</span>
              </button>
            ))}
          </div>
          <details className="study-relay-settings">
            <summary>
              <span><Settings size={14} /> 连接设置</span>
              <ChevronDown size={14} />
            </summary>
            <form className="study-arrival-relay" onSubmit={saveRelayUrl}>
              <GitBranch size={14} />
              <input
                value={relayDraft}
                onChange={(event) => setRelayDraft(event.target.value)}
                placeholder={STUDY_PRESENCE_BROKER_URL}
                aria-label="MQTT WebSocket relay 地址"
              />
              <button type="submit">连接</button>
              <button type="button" onClick={resetRelayUrl}>默认</button>
            </form>
            <div className="study-relay-status">
              <span>当前 relay</span>
              <strong>{presence.relay}</strong>
              <em>失败时会自动尝试备用公共 relay。</em>
            </div>
          </details>
        </div>
        </div>
      </details>

      <div className="study-layout">
        <section className="study-room-stage" aria-label="在线自习室">
          <div className="study-cinema" aria-label="沉浸式在线自习室">
            <div className="study-cinema-topbar">
              <div>
                <span className="study-kicker"><Users size={14} /> 真实在线</span>
                <h2>{activeRoom.name}</h2>
              </div>
              <div className="study-cinema-status">
                <span className={`study-presence-pill is-${presence.status}`}>
                  <span />
                  {presence.status === 'online' ? `${online}/${activeRoom.capacity}` : presence.status === 'connecting' ? '连接中' : '离线'}
                </span>
                <button
                  className="study-name-button"
                  type="button"
                  onClick={() => {
                    setNicknameDraft(snapshot.nickname)
                    setEditingName(true)
                  }}
                >
                  {snapshot.nickname}
                </button>
              </div>
            </div>

            <div className="study-cinema-center">
              <span>{stageStatusLabel}</span>
              <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
              <p>{contractDisplay}</p>
              <div className="study-cinema-actions">
                <button type="button" onClick={runHostAction}>
                  {hostActionIcon}
                  {hostActionLabel}
                </button>
                <button type="button" onClick={followRoomCycle}>
                  <RefreshCw size={14} />
                  同步房间
                </button>
                <button type="button" onClick={() => void copyInvite()}>
                  <Copy size={14} />
                  {copyState === 'copied' ? '已复制' : '邀请'}
                </button>
                <button type="button" onClick={() => setFocusTheaterOpen(true)}>
                  <Maximize2 size={14} />
                  全屏
                </button>
              </div>
            </div>

            <div className="study-cinema-peer-strip" aria-label="在线同桌">
              {roomMembers.slice(0, 7).map((member) => (
                <span className={member.isSelf ? 'is-me' : ''} key={member.clientId} title={`${formatStudySeatLabel(member.seatIndex)} · ${member.nickname} · ${studySignalLabel(member.signalId)} · ${studyMemberFreshnessLabel(member, roomCycleNow)}`}>
                  {member.isSelf ? '我' : studySignalShortLabel(member.signalId)}
                </span>
              ))}
            </div>

            <div className={`study-cinema-liveline${liveLineClass}`} aria-label="房间实时动态">
              <span>{liveLineCode}</span>
              <p>{liveLineText}</p>
              <em>{liveLineMeta}</em>
            </div>

            <div className="study-live-desk" aria-label="实时同桌桌面">
              <div className="study-live-desk-head">
                <div>
                  <span className="study-kicker"><Users size={14} /> 实时同桌</span>
                  <strong>{online} 个席位在线 · {focusingCount} 人专注</strong>
                </div>
                <em>{remoteHeartbeatLabel}</em>
              </div>
              <div className="study-live-desk-grid">
                <div className="study-live-roster" aria-label="实时同桌状态">
                  {liveDeskMembers.map((member) => {
                    const seatLabel = formatStudySeatLabel(normalizeStudySeatIndex(member.seatIndex, member.roomId, member.clientId))
                    const focusShare = Math.max(8, Math.round((member.todayFocusSeconds / roomMaxFocusSeconds) * 100))
                    return (
                      <div className={`study-live-peer${member.isSelf ? ' is-me' : ''}${member.status === 'running' ? ' is-running' : ''}`} key={member.clientId}>
                        <span>{member.isSelf ? '我' : studySignalShortLabel(member.signalId)}</span>
                        <div>
                          <strong>{member.nickname}</strong>
                          <small>{seatLabel} · {studySignalLabel(member.signalId)} · {formatStudyHours(member.todayFocusSeconds)}h</small>
                          <i style={{ width: `${focusShare}%` }} />
                        </div>
                        <em>{studyMemberStatusLabel(member.status, member.timerMode)}</em>
                      </div>
                    )
                  })}
                  {remoteOnline === 0 ? (
                    <div className="study-live-peer is-empty">
                      <span><Plus size={12} /></span>
                      <div>
                        <strong>{presence.status === 'online' ? '等待远端同桌' : '等待重新同步'}</strong>
                        <small>{presence.status === 'online' ? '邀请进入后这里会出现真实席位' : '连接恢复后才显示远端席位'}</small>
                        <i />
                      </div>
                      <em>{connectionLabel}</em>
                    </div>
                  ) : null}
                </div>
                <div className="study-live-events" aria-label="最近房间动态">
                  {recentLiveEvents.length > 0 ? recentLiveEvents.map((event) => (
                    <div className={`study-live-event is-${event.kind}`} key={event.id}>
                      <span>{event.kind === 'checkin' ? 'IN' : event.kind === 'focus_start' ? 'GO' : event.kind === 'task_done' ? 'OK' : 'UP'}</span>
                      <p>{event.text}</p>
                      <em>{formatStudyEventTime(event.createdAt)}</em>
                    </div>
                  )) : (
                    <div className="study-live-event is-empty">
                      <span>--</span>
                      <p>签到、开始或完成专注后会同步到同房间。</p>
                      <em>{connectionLabel}</em>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="study-cinema-seat-deck">
              <div className="study-cinema-seat-head">
                <div>
                  <span>{localSeatLabel}</span>
                  <strong>{focusingCount} 人专注中 · {signalMixSummary}</strong>
                </div>
                <em>{presence.status === 'online' ? `${remoteOnline} 远端` : presence.status === 'connecting' ? '连接中' : '离线'}</em>
              </div>
              <div className="study-seat-room" aria-label="真实在线座位图">
                <div className="study-seat-front" aria-hidden="true">
                  <span>FOCUS BOARD</span>
                  <strong>{activeRoom.sessionMinutes}/{activeRoom.breakMinutes}</strong>
                </div>
                <div className="study-seat-map">
                  {Array.from({ length: seatCount }, (_, index) => {
                    const peer = peersBySeat.get(index)
                    const isUser = index === userSeat
                    const isOccupied = Boolean(peer) || isUser
                    const seatLabel = formatStudySeatLabel(index)
                    const seatNickname = isUser ? snapshot.nickname : peer?.nickname
                    const seatSignal = isUser ? snapshot.signalId : peer?.signalId
                    const seatStatus = isUser
                      ? studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)
                      : peer
                        ? studyMemberStatusLabel(peer.status, peer.timerMode)
                        : '可入座'
                    const seatFreshness = isUser
                      ? '本机心跳'
                      : peer
                        ? studyMemberFreshnessLabel(peer, roomCycleNow)
                        : ''
                    const isAisleStart = index > 0 && index % 12 === 0
                    return (
                      <Fragment key={index}>
                        {isAisleStart ? <div className="study-seat-aisle" aria-hidden="true"><span>{index === 12 ? '中排静音区' : '后排自由区'}</span></div> : null}
                        <button
                          type="button"
                          className={`study-seat${isUser ? ' is-user' : ''}${isOccupied ? ' is-occupied' : ' is-empty'}${peer?.status === 'running' ? ' is-focusing' : ''}`}
                          title={isUser ? `${seatLabel} · ${snapshot.nickname}（我）· ${studySignalLabel(snapshot.signalId)} · ${studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)} · ${seatFreshness}` : peer ? `${seatLabel} · ${peer.nickname} · ${studySignalLabel(peer.signalId)} · ${studyMemberStatusLabel(peer.status, peer.timerMode)} · ${seatFreshness}` : `${seatLabel} · 空座，点击入座`}
                          aria-label={isUser ? `${seatLabel} · ${snapshot.nickname}（我）· ${studySignalLabel(snapshot.signalId)} · ${studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)} · ${seatFreshness}` : peer ? `${seatLabel} · ${peer.nickname} · ${studySignalLabel(peer.signalId)} · ${studyMemberStatusLabel(peer.status, peer.timerMode)} · ${seatFreshness}` : `${seatLabel} · 空座，点击入座`}
                          disabled={Boolean(peer) && !isUser}
                          onClick={() => chooseSeat(index)}
                        >
                          <span className="study-seat-avatar" aria-hidden="true">
                            {isUser ? '我' : peer ? studySignalShortLabel(peer.signalId) : ''}
                          </span>
                          <span className="study-seat-label">{seatNickname ?? '空座'}</span>
                          <span className="study-seat-meta">{seatSignal ? `${studySignalShortLabel(seatSignal)} · ${seatStatus}` : seatStatus}</span>
                          <small>{String(index + 1).padStart(2, '0')}</small>
                        </button>
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="study-host-card" aria-label="房间主持">
            <div className="study-host-copy">
              <span className="study-kicker"><Sparkles size={14} /> 房间引导</span>
              <strong>{hostBrief}</strong>
            </div>
            <div className="study-host-checklist">
              {hostChecklist.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="study-host-actions">
              <button type="button" onClick={runHostAction}>
                {hostActionIcon}
                {hostActionLabel}
              </button>
              <button type="button" onClick={() => setFocusTheaterOpen(true)}>
                <Maximize2 size={14} />
                沉浸视图
              </button>
            </div>
          </div>
          <div className={`study-cycle-card is-${roomCycle.phase}`} aria-label="房间同步轮次">
            <div>
              <span>第 {roomCycle.round} 轮</span>
              <strong>{roomCycle.phase === 'focus' ? `${activeRoom.sessionMinutes} 分钟同频专注` : `${activeRoom.breakMinutes} 分钟同步休息`}</strong>
              <small>下一段：{roomCycle.nextLabel}</small>
            </div>
            <div className="study-cycle-countdown">
              <strong>{formatStudyDuration(roomCycle.remainingSeconds)}</strong>
              <span>{followingRoomCycle ? '正在跟随房间节奏' : '与房间轮次同频'}</span>
            </div>
            <button type="button" onClick={followRoomCycle}>
              {followingRoomCycle ? '重新同步' : '跟随节奏'}
            </button>
            <div className="study-cycle-track" aria-hidden="true">
              <span style={{ width: `${roomCycle.progress}%` }} />
            </div>
          </div>
          <div className="study-room-strip" aria-label="在线房间目录">
            {roomSummaries.map(({ room, cycle, online: roomOnline, focusing: roomFocusing, latestText, latestMeta, hasRemote, isActive }) => {
              const roomFill = Math.min(100, Math.round((roomOnline / room.capacity) * 100))
              return (
                <button
                  key={room.id}
                  type="button"
                  className={`study-room-tab${isActive ? ' is-active' : ''}${hasRemote ? ' has-remote' : ''}`}
                  onClick={() => selectRoom(room)}
                >
                  <span className="study-room-tab-head">
                    <strong>{room.name}</strong>
                    <em>{cycle.phase === 'focus' ? '专注' : '休息'}</em>
                  </span>
                  <span className="study-room-tab-meta">
                    <em>{roomOnline}/{room.capacity}</em>
                    <em>{roomFocusing} 专注</em>
                  </span>
                  <span className="study-room-tab-cycle">
                    {formatStudyDuration(cycle.remainingSeconds)} 后{cycle.nextLabel}
                  </span>
                  <span className="study-room-tab-activity">
                    <b>{latestText}</b>
                    <small>{latestMeta}</small>
                  </span>
                  <span className="study-room-tab-meter" aria-hidden="true">
                    <i style={{ width: `${roomFill}%` }} />
                  </span>
                </button>
              )
            })}
          </div>
          <div className="study-room-tags">
            {activeRoom.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
          <div className="study-room-rules" aria-label="房间规则">
            {roomRules.map((rule, index) => (
              <span key={index}>{rule}</span>
            ))}
          </div>
        </section>

        <section className="study-panel study-work-panel study-mode-panel" aria-label="学习模式和专注契约">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><ShieldCheck size={14} /> 专注契约</span>
              <h2>学习模式</h2>
            </div>
            <span className="study-session-label">{activeMode.name}</span>
          </div>
          <div className="study-mode-grid">
            {studyModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`study-mode-card${snapshot.modeId === mode.id ? ' is-active' : ''}`}
                onClick={() => selectStudyMode(mode)}
                disabled={snapshot.timerState === 'running'}
              >
                <strong>{mode.name}</strong>
                <span>{mode.focusMinutes}/{mode.breakMinutes} · {mode.detail}</span>
              </button>
            ))}
          </div>
          <div className={`study-contract${snapshot.contractLocked ? ' is-locked' : ''}`}>
            <label htmlFor="study-contract-input">本轮承诺</label>
            <textarea
              id="study-contract-input"
              value={snapshot.contractText}
              disabled={snapshot.contractLocked}
              maxLength={120}
              onChange={(event) => setSnapshot((current) => ({ ...current, contractText: event.target.value.slice(0, 120) }))}
              placeholder="例如：完成第 3 章笔记，做完 20 道题，或读完论文方法部分"
            />
            <div>
              <span>{snapshot.contractLocked ? '已锁定，完成本轮后自动释放' : activeMode.rule}</span>
              <button type="button" onClick={toggleContract}>
                {snapshot.contractLocked ? '解锁' : '锁定契约'}
              </button>
            </div>
          </div>
          <div className="study-signal-picker" aria-label="学习状态">
            <div>
              <span className="study-kicker"><Sparkles size={14} /> 学习状态</span>
              <strong>{studySignalLabel(snapshot.signalId)}</strong>
            </div>
            <div>
              {studySignals.map((signal) => (
                <button
                  key={signal.id}
                  type="button"
                  className={snapshot.signalId === signal.id ? 'is-active' : ''}
                  onClick={() => setSnapshot((current) => ({ ...current, signalId: signal.id }))}
                  title={signal.detail}
                >
                  {signal.shortLabel}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="study-panel study-work-panel study-timer-panel" aria-label="番茄时钟">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><Timer size={14} /> 番茄钟</span>
              <h2>{snapshot.timerMode === 'focus' ? '专注轮次' : '恢复时间'}</h2>
            </div>
            <span className="study-session-label">{snapshot.focusMinutes}/{snapshot.breakMinutes}</span>
          </div>
          <div className="study-timer-face" style={{ '--study-progress': `${timerProgress}%` } as CSSProperties}>
            <span>{formatStudyDuration(snapshot.remainingSeconds)}</span>
            <small>{snapshot.timerState === 'running' ? '进行中' : snapshot.timerState === 'paused' ? '已暂停' : '准备好'}</small>
          </div>
          <div className="study-timer-actions">
            <button className="primary-button" type="button" onClick={toggleTimer}>
              {snapshot.timerState === 'running' ? <Pause size={15} /> : <Play size={15} />}
              {snapshot.timerState === 'running' ? '暂停' : '开始'}
            </button>
            <button className="ghost-button" type="button" onClick={resetTimer}>
              <RotateCcw size={15} />
              重置
            </button>
            <button className="ghost-button" type="button" onClick={() => setFocusTheaterOpen(true)}>
              <Maximize2 size={15} />
              沉浸
            </button>
          </div>
          <div className="study-presets" aria-label="专注时长">
            {[
              [25, 5],
              [45, 10],
              [50, 10],
              [90, 15]
            ].map(([focus, rest]) => (
              <button
                key={focus}
                type="button"
                className={snapshot.focusMinutes === focus && snapshot.breakMinutes === rest ? 'is-active' : ''}
                onClick={() => updateTimerPreset(focus, rest)}
              >
                {focus}/{rest}
              </button>
            ))}
          </div>
          <div className="study-mode-switch" role="tablist" aria-label="计时模式">
            <button type="button" className={snapshot.timerMode === 'focus' ? 'is-active' : ''} onClick={() => switchTimerMode('focus')}>专注</button>
            <button type="button" className={snapshot.timerMode === 'break' ? 'is-active' : ''} onClick={() => switchTimerMode('break')}>休息</button>
          </div>
          <div className="study-ambient-control">
            <button
              type="button"
              className={snapshot.ambientEnabled ? 'is-active' : ''}
              onClick={() => setSnapshot((current) => ({ ...current, ambientEnabled: !current.ambientEnabled }))}
              disabled={snapshot.roomId === 'exam'}
            >
              {snapshot.ambientEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              {snapshot.roomId === 'exam' ? '考场静音' : activeRoom.ambient}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={snapshot.ambientVolume}
              disabled={!snapshot.ambientEnabled || snapshot.roomId === 'exam'}
              onChange={(event) => setSnapshot((current) => ({ ...current, ambientVolume: Number(event.target.value) }))}
              aria-label="环境音音量"
            />
          </div>
        </section>

        <section className="study-panel study-companion-panel" aria-label="在线同学">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><Coffee size={14} /> 同桌</span>
              <h2>真实在线</h2>
            </div>
            <span className={`study-relay-badge is-${presence.status}`}>{connectionLabel}</span>
          </div>
          <div className={`study-companion-hero is-${presence.status}`}>
            <div>
              <span>{presence.status === 'online' ? '在线房间' : presence.status === 'connecting' ? '正在入场' : '本机席位'}</span>
              <strong>{presence.status === 'online' ? `${online} 人在 ${activeRoom.name}` : presence.status === 'connecting' ? '连接同步服务' : '等待同桌加入'}</strong>
              <p>{remoteOnline > 0 ? `${remoteOnline} 位远端同学刚刚心跳，座位图和同桌列表会实时更新。` : presence.status === 'online' ? '复制邀请或打开验证窗口后，真实远端 session 才会进入这里。' : `先保留 ${formatStudySeatLabel(userSeat)}，连接恢复或同学进入后才会增加在线人数。`}</p>
            </div>
            <div>
              <button type="button" onClick={() => void copyInvite()}>
                <Copy size={13} />
                {copyState === 'copied' ? '已复制' : '复制邀请'}
              </button>
              <button type="button" onClick={openVerificationWindow} disabled={presence.status !== 'online'}>
                <ExternalLink size={13} />
                {remoteOnline > 0 ? '再开同桌' : '验证在线'}
              </button>
            </div>
          </div>
          <div className={`study-room-board is-${presence.status}${latestRemotePeer ? ' has-peer' : ''}`} aria-label="房间状态板">
            <div className="study-room-board-head">
              <span>{liveLineCode}</span>
              <div>
                <strong>{liveLineText}</strong>
                <small>{liveLineMeta}</small>
              </div>
            </div>
            <div className="study-room-board-grid">
              <div>
                <span>我的席位</span>
                <strong>{formatStudySeatLabel(userSeat)}</strong>
                <small>{studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}</small>
              </div>
              <div>
                <span>远端心跳</span>
                <strong>{remoteFreshValue}</strong>
                <small>{formatStudyPresenceAge(presence.lastRemoteMessageAt, roomCycleNow)}</small>
              </div>
              <div>
                <span>房间容量</span>
                <strong>{online}/{activeRoom.capacity}</strong>
                <small>空间 {spaceOnline} 人</small>
              </div>
              <div>
                <span>同步房间</span>
                <strong>{snapshot.spaceCode}</strong>
                <small>{activeRoom.name} · {relayHealthLabel}</small>
              </div>
            </div>
            <div className="study-room-board-roster" aria-label="房间席位头像">
              {roomMembers.slice(0, 8).map((member) => (
                <span className={member.isSelf ? 'is-me' : ''} key={member.clientId} title={`${member.nickname} · ${formatStudySeatLabel(member.seatIndex)} · ${studyMemberFreshnessLabel(member, roomCycleNow)}`}>
                  {member.isSelf ? '我' : member.nickname.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {remoteOnline === 0 ? <em>等待远端同桌</em> : null}
            </div>
          </div>
          <div className="study-classmate-list">
            <div className="study-classmate-head">
              <div>
                <span className="study-kicker"><Users size={14} /> 正在同桌</span>
                <strong>{remoteOnline === 0 ? '先显示你的真实席位' : `${remoteOnline} 位远端同学在场`}</strong>
              </div>
              <span>{connectionLabel}</span>
            </div>
            <div className="study-classmate-row is-me">
              <span>{snapshot.nickname.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{snapshot.nickname}</strong>
                <small>{formatStudySeatLabel(userSeat)} · {studySignalLabel(snapshot.signalId)} · {snapshot.timerMode === 'focus' ? `${snapshot.focusMinutes}m 专注` : '休息中'} · {contractDisplay} · 本机心跳</small>
              </div>
              <em>{studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}</em>
            </div>
            {activePeers.length === 0 ? (
              <div className="study-empty-online">
                {presence.status === 'online' ? '当前房间还没有其他同学。打开另一个客户端或邀请朋友进入同一房间后，人数和座位才会增加。' : '正在连接在线教室，连接失败时不会显示模拟人数。'}
              </div>
            ) : activePeers.map((peer) => (
              <div className="study-classmate-row" key={peer.clientId}>
                <span>{peer.nickname.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{peer.nickname}</strong>
                  <small>{formatStudySeatLabel(normalizeStudySeatIndex(peer.seatIndex, peer.roomId, peer.clientId))} · {studySignalLabel(peer.signalId)} · {peer.timerMode === 'focus' ? `${peer.focusMinutes}m 专注` : '休息中'} · 连续 {peer.streakDays} · {studyMemberFreshnessLabel(peer, roomCycleNow)}</small>
                </div>
                <em>{studyMemberStatusLabel(peer.status, peer.timerMode)}</em>
              </div>
            ))}
          </div>
          <div className="study-room-actions" aria-label="房间互动">
            <button type="button" onClick={() => emitRoomEvent('checkin', `${snapshot.nickname} 在 ${activeRoom.name} 签到。`)}>
              <CheckCircle2 size={13} />
              签到
            </button>
            <button type="button" onClick={() => emitRoomEvent('cheer', `${snapshot.nickname} 给同桌们加油。`)}>
              <Zap size={13} />
              加油
            </button>
            <button type="button" onClick={() => emitRoomEvent('cheer', `${snapshot.nickname} 休息提醒：记得喝水和放松眼睛。`)}>
              <Coffee size={13} />
              休息提醒
            </button>
          </div>
          <div className="study-event-stream" aria-label="实时互动流">
            {roomEvents.length === 0 ? (
              <div className="study-event-empty">还没有实时互动。签到或开始专注后，同空间同房间的同学会看到动态。</div>
            ) : roomEvents.map((event) => (
              <div className={`study-event-row is-${event.kind}`} key={event.id}>
                <span>{event.kind === 'checkin' ? 'IN' : event.kind === 'focus_start' ? 'GO' : event.kind === 'task_done' ? 'OK' : 'UP'}</span>
                <div>
                  <strong>{event.nickname}<small>{formatStudyEventTime(event.createdAt)}</small></strong>
                  <p>{event.text}</p>
                </div>
              </div>
            ))}
          </div>
          <details className="study-room-digest">
            <summary>
              <span><Info size={13} /> 房间摘要</span>
              <ChevronDown size={14} />
            </summary>
            <div className="study-room-feed" aria-label="房间动态">
              {roomFeed.map((item, index) => (
                <div key={index} className="study-feed-row">
                  <span>{index + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </details>
          <div className="study-invite-note">
            <Info size={14} />
            <span>{connectionDetail}</span>
          </div>
          <div className="study-leaderboard" aria-label="本房间专注榜">
            <div className="study-leaderboard-head">
              <strong>本房间专注榜</strong>
              <span>{roomMembers.length} 人</span>
            </div>
            {roomMembers.slice(0, 5).map((member, index) => (
              <div className={`study-leader-row${member.isSelf ? ' is-me' : ''}`} key={member.clientId}>
                <span>{index + 1}</span>
                <strong>{member.nickname}</strong>
                <em>{studySignalShortLabel(member.signalId)} · {formatStudyHours(member.todayFocusSeconds)}h · {studyMemberFreshnessLabel(member, roomCycleNow)}</em>
              </div>
            ))}
          </div>
          <details className="study-live-proof" aria-label="在线同步证明">
            <summary>
              <span><GitBranch size={13} /> 在线来源</span>
              <ChevronDown size={14} />
            </summary>
            <div className="study-live-proof-head">
              <div>
                <strong>{presence.topic}</strong>
              </div>
              <div className="study-live-proof-actions">
                <button type="button" onClick={openVerificationWindow}>
                  <ExternalLink size={13} />
                  {verifyOpenState === 'opened' ? '已打开' : verifyOpenState === 'blocked' ? '被拦截' : '打开验证窗口'}
                </button>
                <button type="button" onClick={() => void copyPresenceProof()}>
                  <Copy size={13} />
                  {proofCopyState === 'copied' ? '已复制' : proofCopyState === 'failed' ? '复制失败' : '复制证明'}
                </button>
              </div>
            </div>
            <div className="study-live-proof-grid">
              {presenceProofRows.map((row) => (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
            <p>人数只来自当前 topic 的 MQTT 心跳；每个窗口使用独立 session presence 身份，超过 {Math.round(STUDY_PRESENCE_PEER_TTL_MS / 1000)} 秒未心跳会自动下线。</p>
          </details>
        </section>

        <section className="study-panel study-work-panel study-task-panel" aria-label="学习任务">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><CheckCircle2 size={14} /> 今日清单</span>
              <h2>学习任务</h2>
            </div>
            <button className="study-clear-button" type="button" onClick={removeDoneTasks}>清除完成</button>
          </div>
          <div className="study-task-summary" aria-label="任务执行摘要">
            <div>
              <span>本轮目标</span>
              <strong>{currentTask?.title ?? '今日任务已清空'}</strong>
            </div>
            <div>
              <span>未完成</span>
              <strong>{openTasks}</strong>
            </div>
            <div>
              <span>已完成</span>
              <strong>{completedTasks}</strong>
            </div>
          </div>
          <form className="study-task-form" onSubmit={addTask}>
            <input
              value={taskInput}
              onChange={(event) => setTaskInput(event.target.value)}
              placeholder="添加本轮目标"
              maxLength={80}
            />
            <button type="submit" aria-label="添加任务"><Plus size={15} /></button>
          </form>
          <div className="study-task-list">
            {snapshot.tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                className={`study-task-row${task.done ? ' is-done' : ''}`}
                onClick={() => toggleTask(task.id)}
              >
                <span>{task.done ? <Check size={13} /> : null}</span>
                <strong>{task.title}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="study-panel study-work-panel study-growth-panel" aria-label="成长系统">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><Star size={14} /> 养成</span>
              <h2>{studyPlantStage(snapshot.xp)}</h2>
            </div>
            <span className="study-xp">{level.current}/{level.next} XP</span>
          </div>
          <div className="study-level-track"><span style={{ width: `${level.progress}%` }} /></div>
          <div className="study-growth-grid">
            <div><strong>{formatStudyHours(snapshot.totalFocusSeconds)}h</strong><span>累计专注</span></div>
            <div><strong>{snapshot.totalSessions}</strong><span>完成番茄</span></div>
            <div><strong>{snapshot.todaySessions}</strong><span>今日轮次</span></div>
          </div>
          <div className="study-week-bars" aria-label="一周专注">
            {weeklyFocus.map((value, index) => (
              <span key={index}><i style={{ height: `${Math.max(12, Math.round(value * 100))}%` }} /></span>
            ))}
          </div>
          <div className="study-badges">
            {badges.map((badge) => (
              <span key={badge.label} className={badge.unlocked ? 'is-unlocked' : ''}>
                <Trophy size={12} />
                {badge.label}
              </span>
            ))}
          </div>
        </section>
      </div>

      <div className="study-space-overview" aria-label="空间概览">
        <div>
          <span>空间类型</span>
          <strong>{snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE ? '公开大厅' : '私密房间'}</strong>
        </div>
        <div>
          <span>当前模式</span>
          <strong>{activeMode.name}</strong>
        </div>
        <div>
          <span>本轮契约</span>
          <strong>{snapshot.contractLocked ? '已锁定' : contractDisplay}</strong>
        </div>
        <div>
          <span>房间节奏</span>
          <strong>{roomCycle.phase === 'focus' ? '专注中' : '休息中'} · {formatStudyDuration(roomCycle.remainingSeconds)}</strong>
        </div>
        <div>
          <span>实时人数</span>
          <strong>{presence.status === 'online' ? `${online} / ${activeRoom.capacity}` : '离线'}</strong>
        </div>
      </div>
      {focusTheaterOpen ? (
        <div className={`study-theater is-${snapshot.timerMode}`} role="dialog" aria-modal="true" aria-label="沉浸专注视图">
          <div className="study-theater-surface">
            <div className="study-theater-topbar">
              <div>
                <span className={`study-presence-pill is-${presence.status}`}>
                  <span />
                  {presence.status === 'online' ? `${online} 人在线` : presence.status === 'connecting' ? '连接中' : '离线'}
                </span>
                <strong>{activeRoom.name}</strong>
              </div>
              <button type="button" aria-label="关闭沉浸视图" onClick={() => setFocusTheaterOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="study-theater-center">
              <span>{snapshot.timerMode === 'focus' ? '专注中' : '恢复中'}</span>
              <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
              <p>{contractDisplay}</p>
              <div className="study-theater-host">
                {hostChecklist.map((item) => (
                  <span key={item.label}><em>{item.label}</em>{item.value}</span>
                ))}
              </div>
              <div className="study-theater-progress" aria-hidden="true">
                <span style={{ width: `${timerProgress}%` }} />
              </div>
            </div>
            <div className="study-theater-bottom">
              <div className="study-theater-cycle">
                <span>房间第 {roomCycle.round} 轮</span>
                <strong>{roomCycle.phase === 'focus' ? '同频专注' : '同步休息'} · {formatStudyDuration(roomCycle.remainingSeconds)}</strong>
              </div>
              <div className="study-theater-peers" aria-label="在线同桌">
                {roomMembers.slice(0, 6).map((member) => (
                  <span className={member.isSelf ? 'is-me' : ''} key={member.clientId} title={`${formatStudySeatLabel(member.seatIndex)} · ${member.nickname} · ${studySignalLabel(member.signalId)} · ${studyMemberStatusLabel(member.status, member.timerMode)} · ${studyMemberFreshnessLabel(member, roomCycleNow)}`}>
                    {studySignalShortLabel(member.signalId)}
                  </span>
                ))}
              </div>
              <div className="study-theater-actions">
                <button type="button" onClick={toggleTimer}>
                  {snapshot.timerState === 'running' ? <Pause size={15} /> : <Play size={15} />}
                  {snapshot.timerState === 'running' ? '暂停' : '开始'}
                </button>
                <button type="button" onClick={followRoomCycle}>同步房间</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {editingName ? (
        <div className="study-name-modal-backdrop" role="presentation" onClick={() => setEditingName(false)}>
          <form className="study-name-modal" onSubmit={saveNickname} onClick={(event) => event.stopPropagation()}>
            <h2>在线身份</h2>
            <p>这个昵称只用于自习室 presence 心跳，不会上传任务内容。</p>
            <input value={nicknameDraft} onChange={(event) => setNicknameDraft(event.target.value)} maxLength={18} autoFocus />
            <div>
              <button className="ghost-button" type="button" onClick={() => setEditingName(false)}>取消</button>
              <button className="primary-button" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  )
}
