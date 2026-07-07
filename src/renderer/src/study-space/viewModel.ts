import { STUDY_PRESENCE_PEER_TTL_MS, STUDY_PUBLIC_SPACE_CODE, studyModes, studyRooms, studySignals } from './constants'
import {
  formatStudyDuration,
  formatStudyEventTime,
  formatStudyHours,
  formatStudyPresenceAge,
  formatStudySeatLabel,
  getStudyRoomCycle,
  normalizeStudySeatIndex,
  studyInviteUrl,
  studyLevel,
  studyMemberFreshnessLabel,
  studyMemberStatusLabel,
  studySignalLabel
} from './domain'
import type { StudyPresencePeer, StudyPresenceStatus, StudyRoomCycle, StudyRoomEvent, StudyRoomEventKind, StudySnapshot, StudyTimerMode, StudyTimerState } from './types'

type StudyRoom = typeof studyRooms[number]
type StudyMode = typeof studyModes[number]

type StudyPresenceState = {
  status: StudyPresenceStatus
  peers: StudyPresencePeer[]
  events: StudyRoomEvent[]
  relay: string
  topic: string
  lastHeartbeatAt: number
  lastRemoteMessageAt: number
}

export type StudyRoomMember = StudyPresencePeer & {
  isSelf: boolean
}

export type StudyRoomSummary = {
  room: StudyRoom
  cycle: StudyRoomCycle
  online: number
  focusing: number
  latestText: string
  latestMeta: string
  hasRemote: boolean
  isActive: boolean
}

export type StudyPresenceProofRow = {
  label: string
  value: string
}

export type StudyHostActionKind = 'theater' | 'lock' | 'sync' | 'start'

export type StudySpaceViewModel = {
  activeRoom: StudyRoom
  activeMode: StudyMode
  roomCycle: StudyRoomCycle
  level: ReturnType<typeof studyLevel>
  presenceOnline: boolean
  activePeers: StudyPresencePeer[]
  online: number
  spaceOnline: number
  remoteOnline: number
  roomCapacityPercent: number
  localSeatLabel: string
  timerProgress: number
  followingRoomCycle: boolean
  completedTasks: number
  openTasks: number
  currentTask: StudySnapshot['tasks'][number] | undefined
  seatCount: number
  userSeat: number
  peersBySeat: Map<number, StudyPresencePeer>
  weeklyFocus: number[]
  badges: Array<{ label: string; unlocked: boolean }>
  roomMembers: StudyRoomMember[]
  roomFocusSeconds: number
  roomMaxFocusSeconds: number
  focusingCount: number
  liveDeskMembers: StudyRoomMember[]
  inviteUrl: string
  signalMixSummary: string
  remoteFreshCount: number
  topicTail: string
  relayHealthLabel: string
  remoteHeartbeatLabel: string
  remoteFreshValue: string
  presenceProofRows: StudyPresenceProofRow[]
  presenceProofText: string
  presenceTtlSeconds: number
  arrivalRosterMembers: StudyRoomMember[]
  roomEvents: StudyRoomEvent[]
  recentLiveEvents: StudyRoomEvent[]
  roomSummaries: StudyRoomSummary[]
  latestRoomEvent: StudyRoomEvent | undefined
  latestRemotePeer: StudyPresencePeer | undefined
  connectionLabel: string
  liveLineCode: 'IN' | 'GO' | 'OK' | 'UP' | 'PEER' | 'LIVE' | 'SYNC'
  liveLineText: string
  liveLineMeta: string
  liveLineClass: string
  connectionDetail: string
  liveSessionTitle: string
  liveSessionDetail: string
  inviteHint: string
  spaceKindLabel: string
  spaceOverviewKindLabel: string
  stageStatusLabel: string
  contractDisplay: string
  hostActionLabel: string
  hostActionKind: StudyHostActionKind
  hostBrief: string
  hostChecklist: Array<{ label: string; value: string }>
  roomFeed: string[]
  roomRules: string[]
}

function roomEventCode(kind: StudyRoomEventKind): 'IN' | 'GO' | 'OK' | 'UP' {
  if (kind === 'checkin') return 'IN'
  if (kind === 'focus_start') return 'GO'
  if (kind === 'task_done') return 'OK'
  return 'UP'
}

function connectionLabel(status: StudyPresenceStatus): string {
  if (status === 'online') return '实时在线'
  if (status === 'connecting') return '正在连接'
  return '本机席位'
}

function relayHealthLabel(status: StudyPresenceStatus): string {
  if (status === 'online') return '在线同步'
  if (status === 'connecting') return '连接中'
  return '本机席位'
}

function timerModeLabel(timerMode: StudyTimerMode): string {
  return timerMode === 'focus' ? '专注' : '休息'
}

function timerStateStageLabel(timerState: StudyTimerState, timerMode: StudyTimerMode): string {
  if (timerState === 'running') return timerMode === 'focus' ? '专注中' : '休息中'
  if (timerState === 'paused') return '已暂停'
  return '准备进入'
}

export function createStudySpaceViewModel(snapshot: StudySnapshot, presence: StudyPresenceState, nowMs: number): StudySpaceViewModel {
  const activeRoom = studyRooms.find((room) => room.id === snapshot.roomId) ?? studyRooms[0]
  const activeMode = studyModes.find((mode) => mode.id === snapshot.modeId) ?? studyModes[0]
  const roomCycle = getStudyRoomCycle(activeRoom, nowMs)
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
  const roomMembers: StudyRoomMember[] = [
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
      spaceCode: snapshot.spaceCode,
      seatIndex: userSeat,
      updatedAt: nowMs,
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
  const remoteFreshCount = activePeers.filter((peer) => nowMs - peer.updatedAt <= STUDY_PRESENCE_PEER_TTL_MS).length
  const presenceTtlSeconds = Math.round(STUDY_PRESENCE_PEER_TTL_MS / 1000)
  const topicTail = presence.topic.split('/').slice(-2).join('/')
  const currentRelayHealthLabel = relayHealthLabel(presence.status)
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
    { label: '本机心跳', value: formatStudyPresenceAge(presence.lastHeartbeatAt, nowMs) },
    { label: '最近远端', value: formatStudyPresenceAge(presence.lastRemoteMessageAt, nowMs) },
    { label: '远端新鲜度', value: `${remoteFreshCount}/${remoteOnline}` },
    { label: '会话身份', value: snapshot.clientId.slice(-4).toUpperCase() }
  ]
  const presenceProofText = [
    'StudiumX live proof',
    `space=${snapshot.spaceCode}`,
    `room=${activeRoom.name}`,
    `relay=${presence.relay}`,
    `topic=${presence.topic}`,
    `status=${presence.status}`,
    `sessionPeer=${snapshot.clientId}`,
    `localHeartbeat=${formatStudyPresenceAge(presence.lastHeartbeatAt, nowMs)}`,
    `lastRemote=${formatStudyPresenceAge(presence.lastRemoteMessageAt, nowMs)}`,
    `remotePeers=${remoteOnline}`,
    `freshPeers=${remoteFreshCount}`,
    `ttlSeconds=${presenceTtlSeconds}`,
    `invite=${inviteUrl}`
  ].join('\n')
  const arrivalRosterMembers = roomMembers.slice(0, 4)
  const roomEvents = presence.events
    .filter((event) => event.spaceCode === snapshot.spaceCode && event.roomId === snapshot.roomId)
    .slice(0, 8)
  const recentLiveEvents = roomEvents.slice(0, 3)
  const roomSummaries = studyRooms.map((room) => {
    const cycle = getStudyRoomCycle(room, nowMs)
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
        ? studyMemberFreshnessLabel(latestPeer, nowMs)
        : isLocalRoom
          ? '我的当前房间'
          : presence.status === 'online'
            ? '实时在线'
            : presence.status === 'connecting'
              ? '正在连接'
              : '本机席位'
    return {
      room,
      cycle,
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
  const currentConnectionLabel = connectionLabel(presence.status)
  const liveLineCode = latestRoomEvent
    ? roomEventCode(latestRoomEvent.kind)
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
      ? studyMemberFreshnessLabel(latestRemotePeer, nowMs)
      : currentConnectionLabel
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
    ? `最近远端消息 ${formatStudyPresenceAge(presence.lastRemoteMessageAt, nowMs)}，超过 ${presenceTtlSeconds} 秒未心跳会自动下线。`
    : presence.status === 'online'
      ? '打开一个独立同桌窗口会使用新的 session 身份，连接成功后本房间在线人数才会增加。'
      : '连接成功前会保留当前席位；你可以复制邀请或等待同步服务恢复。'
  const inviteHint = snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE
    ? '公共大厅不用邀请码；新建空间后可只邀请自己的同学进入。'
    : `把空间码 ${snapshot.spaceCode} 发给同学，对方输入后会进入同一个在线 presence 房间。`
  const spaceKindLabel = snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE ? '公共大厅' : '私密空间'
  const spaceOverviewKindLabel = snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE ? '公开大厅' : '私密房间'
  const stageStatusLabel = timerStateStageLabel(snapshot.timerState, snapshot.timerMode)
  const contractDisplay = snapshot.contractText.trim() || snapshot.tasks.find((task) => !task.done)?.title || activeMode.name
  const hostActionKind: StudyHostActionKind = snapshot.timerState === 'running'
    ? 'theater'
    : !snapshot.contractLocked && snapshot.timerMode === 'focus'
      ? 'lock'
      : !followingRoomCycle
        ? 'sync'
        : 'start'
  const hostActionLabel = hostActionKind === 'theater'
    ? '进入沉浸'
    : hostActionKind === 'lock'
      ? '锁定目标'
      : hostActionKind === 'sync'
        ? '跟随房间'
        : '开始专注'
  const hostBrief = snapshot.timerState === 'running'
    ? `${snapshot.nickname} 正在 ${formatStudySeatLabel(userSeat)} 专注，保持本轮目标不切换。`
    : snapshot.timerMode === 'break'
      ? `现在是同步休息，${formatStudyDuration(snapshot.remainingSeconds)} 后回到专注。`
      : `${formatStudySeatLabel(userSeat)} 已入座，锁定一个目标后跟随房间节奏开始。`
  const hostChecklist = [
    { label: '座位', value: `${formatStudySeatLabel(userSeat)} · ${snapshot.spaceCode}` },
    { label: '状态', value: `${studySignalLabel(snapshot.signalId)} · ${activeMode.name}` },
    { label: '目标', value: contractDisplay },
    { label: '节奏', value: `${timerModeLabel(roomCycle.phase)} · ${formatStudyDuration(roomCycle.remainingSeconds)}` }
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

  return {
    activeRoom,
    activeMode,
    roomCycle,
    level,
    presenceOnline,
    activePeers,
    online,
    spaceOnline,
    remoteOnline,
    roomCapacityPercent,
    localSeatLabel,
    timerProgress,
    followingRoomCycle,
    completedTasks,
    openTasks,
    currentTask,
    seatCount,
    userSeat,
    peersBySeat,
    weeklyFocus,
    badges,
    roomMembers,
    roomFocusSeconds,
    roomMaxFocusSeconds,
    focusingCount,
    liveDeskMembers,
    inviteUrl,
    signalMixSummary,
    remoteFreshCount,
    topicTail,
    relayHealthLabel: currentRelayHealthLabel,
    remoteHeartbeatLabel,
    remoteFreshValue,
    presenceProofRows,
    presenceProofText,
    presenceTtlSeconds,
    arrivalRosterMembers,
    roomEvents,
    recentLiveEvents,
    roomSummaries,
    latestRoomEvent,
    latestRemotePeer,
    connectionLabel: currentConnectionLabel,
    liveLineCode,
    liveLineText,
    liveLineMeta,
    liveLineClass,
    connectionDetail,
    liveSessionTitle,
    liveSessionDetail,
    inviteHint,
    spaceKindLabel,
    spaceOverviewKindLabel,
    stageStatusLabel,
    contractDisplay,
    hostActionLabel,
    hostActionKind,
    hostBrief,
    hostChecklist,
    roomFeed,
    roomRules
  }
}
