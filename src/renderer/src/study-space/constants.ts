import type { StudyModeId, StudyRoomId, StudySignalId, StudySnapshot } from './types'

export const STUDY_SPACE_STORAGE_KEY = 'studiumx:study-space:v1'
export const LEGACY_STUDY_SPACE_STORAGE_KEY = 'teachos:study-space:v1'
export const STUDY_SPACE_SESSION_CLIENT_KEY = 'studiumx:study-space:session-client:v1'
export const LEGACY_STUDY_SPACE_SESSION_CLIENT_KEY = 'teachos:study-space:session-client:v1'
export const STUDY_DAY_MS = 24 * 60 * 60 * 1000
export const STUDY_PRESENCE_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'
export const STUDY_PRESENCE_RELAY_URLS = [
  STUDY_PRESENCE_BROKER_URL,
  'wss://broker.hivemq.com:8884/mqtt'
]
export const STUDY_PRESENCE_TOPIC_ROOT = 'studiumx/study-space/v1'
export const STUDY_PRESENCE_PEER_TTL_MS = 35_000
export const STUDY_PRESENCE_HEARTBEAT_MS = 10_000
export const STUDY_PRESENCE_CONNECT_TIMEOUT_MS = 6500
export const STUDY_PRESENCE_CLIENT_PREFIX = 'studiumx'
export const STUDY_PUBLIC_SPACE_CODE = 'PUBLIC'

export const defaultStudySnapshot: StudySnapshot = {
  clientId: '',
  nickname: '',
  spaceCode: STUDY_PUBLIC_SPACE_CODE,
  presenceRelayUrl: STUDY_PRESENCE_BROKER_URL,
  signalId: 'reading',
  modeId: 'free',
  contractText: '',
  contractLocked: false,
  ambientEnabled: false,
  ambientVolume: 0.45,
  roomId: 'silent',
  seatIndex: 0,
  timerMode: 'focus',
  timerState: 'idle',
  focusMinutes: 25,
  breakMinutes: 5,
  remainingSeconds: 25 * 60,
  todayFocusSeconds: 0,
  todaySessions: 0,
  totalFocusSeconds: 0,
  totalSessions: 0,
  streakDays: 0,
  xp: 0,
  lastStudyDate: '',
  tasks: [
    { id: 'reading', title: '整理下一节课的重点', done: false },
    { id: 'review', title: '复盘一组检索练习', done: false }
  ]
}

export const studyModes: Array<{
  id: StudyModeId
  name: string
  detail: string
  focusMinutes: number
  breakMinutes: number
  roomId: StudyRoomId
  rule: string
}> = [
  {
    id: 'free',
    name: '自由自习',
    detail: '适合预习、整理笔记和轻量任务',
    focusMinutes: 25,
    breakMinutes: 5,
    roomId: 'silent',
    rule: '可以随时开始，保持任务清单清晰。'
  },
  {
    id: 'sync',
    name: '同频冲刺',
    detail: '适合和同学一起限时推进',
    focusMinutes: 45,
    breakMinutes: 10,
    roomId: 'silent',
    rule: '进入后先写本轮目标，尽量整轮不切任务。'
  },
  {
    id: 'deepwork',
    name: '深度沉浸',
    detail: '适合论文、项目和长时间材料阅读',
    focusMinutes: 90,
    breakMinutes: 15,
    roomId: 'silent',
    rule: '隐藏干扰，只保留一个主目标。'
  },
  {
    id: 'exam',
    name: '模拟考场',
    detail: '适合真题、闭卷训练和限时复盘',
    focusMinutes: 50,
    breakMinutes: 10,
    roomId: 'silent',
    rule: '默认静音，按考试节奏完成后复盘。'
  }
]

export const studySignals: Array<{
  id: StudySignalId
  label: string
  shortLabel: string
  detail: string
}> = [
  { id: 'reading', label: '阅读材料', shortLabel: '读', detail: '看书、论文、课程材料' },
  { id: 'writing', label: '写作输出', shortLabel: '写', detail: '笔记、论文、报告' },
  { id: 'practice', label: '刷题练习', shortLabel: '练', detail: '习题、代码、真题训练' },
  { id: 'review', label: '复盘整理', shortLabel: '复', detail: '整理错题、知识卡片' },
  { id: 'exam', label: '模拟考试', shortLabel: '考', detail: '计时、闭卷、复盘' }
]

export const studyRooms: Array<{
  id: StudyRoomId
  name: string
  tone: string
  capacity: number
  sessionMinutes: number
  breakMinutes: number
  tags: string[]
  seats: number
  light: string
  ambient: string
  backdrop: string
}> = [
  {
    id: 'silent',
    name: '自习室',
    tone: '把在线同桌、学习任务和番茄节奏集中在一个空间里',
    capacity: 36,
    sessionMinutes: 25,
    breakMinutes: 5,
    tags: ['在线同桌', '学习任务', '番茄节奏'],
    seats: 36,
    light: '自然光',
    ambient: '环境音',
    backdrop: 'study-backdrop-default'
  }
]
