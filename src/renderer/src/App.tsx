import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Bell,
  BookCopy,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coffee,
  Copy,
  DoorOpen,
  Eye,
  EyeOff,
  ExternalLink,
  FileCheck2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  History,
  Info,
  KeyRound,
  LibraryBig,
  Loader2,
  Lock,
  Maximize2,
  MessageSquare,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Palette,
  Pause,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Square,
  Sun,
  Target,
  Timer,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Play,
  SendHorizontal,
  Upload,
  Trash2,
  X,
  Wrench,
  Zap
} from 'lucide-react'
import type { CSSProperties, ErrorInfo, FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Component, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { create } from 'zustand'
import i18n from './i18n'
import studyRoomAmbience from './assets/study-room-ambience.webp'
import { buildAgentProcessTimeline } from './agent-process-timeline'
import {
  courseRelativePathForAgentConversation,
  isCourseAgentConversationPath
} from '../../shared/agent-conversation-catalog'
import {
  activeTeachingConversationSummary,
  agentTurnsToMessages,
  applyAgentChatChunkToPending,
  applyAgentChatStatusToPending,
  applyAgentChatToolEventToPending,
  cancelPendingAgentConversation,
  createAgentConversationTurnDraft,
  failPendingAgentConversation,
  findConversationSummary,
  finishPendingAgentConversationSave,
  isPendingConversationSummary,
  reconcileAgentTurnsWithLocalProcess,
  syncPendingAgentConversation,
  type PendingAgentConversation,
  type SidebarConversationSummary
} from './agent-conversation-state'
import { listSidebarWorkspaceFolders } from '../../shared/course-sidebar'
import {
  DEFAULT_LESSON_STYLE_ID,
  LESSON_STYLES,
  normalizeLessonStyleId,
  type LessonStyleId,
  type LessonStyleTokens
} from '../../shared/lesson-styles'
import { buildLessonStyleSampleHtml } from './lesson-style-sample'
import { classifyProviderError } from '../../shared/provider-error'
import { deriveWorkspaceRemovalUiPatch } from '../../shared/workspace-removal-state'
import {
  PARALLEL_SEARCH_MODES,
  TEACHING_MODEL_PROVIDER_PRESETS,
  WEB_SEARCH_BACKENDS,
  type AgentChatMessage,
  type AgentChatProcessEvent,
  type AgentChatStreamChunk,
  type AgentChatStreamStatus,
  type AgentChatStreamToolEvent,
  type AgentChatMode,
  type AgentChatTurn,
  type AgentConversationSummary,
  type CreateTeachingMemoryPayload,
  type GitBranchPayload,
  type LessonStreamChunk,
  type LessonStreamStatus,
  type LessonSummary,
  type ListUpstreamModelsResult,
  type ProgressSummary,
  type ProbeProviderPayload,
  type ProbeProviderResult,
  type RemoveTeachingGitWorktreePayload,
  type ReviewCard,
  type SettingsSection,
  type TeachingGitBranchesResult,
  type TeachingGitBranchRow,
  type TeachingGitWorktreesResult,
  type TeachingMemoryDiagnostics,
  type TeachingMemoryRecord,
  type TeachingMemoryScope,
  type TeachingModelProviderProfile,
  type ModelReasoningEffort,
  type TeachingAppState,
  type TeachingRuntimeState,
  type TeachingSettingsPatch,
  type TeachingSettingsV1,
  type TeachingWorkspaceSummary,
  type UpdateTeachingMemoryPayload,
  type WebSearchBackend,
  type WindowControlAction,
  type WorkspaceFileNode,
  type WorkspaceItemKind,
  type WorkspaceItemRemoveMode,
  type WorkspaceView
} from '../../shared/teaching-types'

// ================================================================
// Types
// ================================================================

type ErrorSeverity = 'error' | 'warning' | 'info'

type UserError = {
  message: string
  severity: ErrorSeverity
  detail?: string
}

type DialogMode = 'chat' | 'teaching'

type CoursePreviewFile = {
  title: string
  relativePath: string
  absolutePath: string
}

type ResourcePreviewFile = {
  id: string
  title: string
  html: string
}

type StudyTimerMode = 'focus' | 'break'
type StudyTimerState = 'idle' | 'running' | 'paused'
type StudyRoomId = 'silent' | 'sprint' | 'deep' | 'exam'
type StudyModeId = 'free' | 'sync' | 'deepwork' | 'exam'
type StudyPresenceStatus = 'connecting' | 'online' | 'offline'
type StudyRoomEventKind = 'checkin' | 'focus_start' | 'task_done' | 'cheer'
type StudyRoomCyclePhase = 'focus' | 'break'

type StudyTask = {
  id: string
  title: string
  done: boolean
}

type StudyPresencePeer = {
  clientId: string
  roomId: StudyRoomId
  spaceCode: string
  nickname: string
  status: StudyTimerState
  timerMode: StudyTimerMode
  focusMinutes: number
  todayFocusSeconds: number
  todaySessions: number
  streakDays: number
  updatedAt: number
}

type StudyRoomEvent = {
  id: string
  clientId: string
  spaceCode: string
  roomId: StudyRoomId
  nickname: string
  kind: StudyRoomEventKind
  text: string
  createdAt: number
}

type StudyRoomCycle = {
  phase: StudyRoomCyclePhase
  round: number
  elapsedSeconds: number
  remainingSeconds: number
  totalSeconds: number
  progress: number
  nextLabel: string
}

type StudySnapshot = {
  clientId: string
  nickname: string
  spaceCode: string
  modeId: StudyModeId
  contractText: string
  contractLocked: boolean
  ambientEnabled: boolean
  ambientVolume: number
  roomId: StudyRoomId
  timerMode: StudyTimerMode
  timerState: StudyTimerState
  focusMinutes: number
  breakMinutes: number
  remainingSeconds: number
  todayFocusSeconds: number
  todaySessions: number
  totalFocusSeconds: number
  totalSessions: number
  streakDays: number
  xp: number
  lastStudyDate: string
  tasks: StudyTask[]
}

type LessonGenerationOptions = {
  prompt?: string
  messages?: AgentChatMessage[]
}

type StoreState = {
  view: WorkspaceView
  settingsSection: SettingsSection
  sidebarCollapsed: boolean
  loading: boolean
  generating: boolean
  error: UserError | null
  searchQuery: string
  taskPrompt: string
  overviewDialogMode: DialogMode
  lessonReaderOpen: boolean
  selectedCoursePreviewFile: CoursePreviewFile | null
  selectedResourcePreviewFile: ResourcePreviewFile | null
  selectedCourseRelativePath: string | null
  selectedCourseWorkspaceId: string | null
  appState: TeachingAppState
  settings: TeachingSettingsV1
  setView: (view: WorkspaceView) => void
  setOverviewDialogMode: (mode: DialogMode) => void
  openLessonLibrary: () => void
  openTeachingConversationView: () => void
  openWorkspaceTeachingMode: () => void
  selectCourseFolder: (relativePath: string | null, workspaceId?: string | null) => void
  setSettingsSection: (section: SettingsSection) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  openSettings: (section?: SettingsSection) => void
  setSearchQuery: (query: string) => void
  setTaskPrompt: (prompt: string) => void
  clearError: () => void
  initialize: () => Promise<void>
  updateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  pickDefaultRoot: () => Promise<void>
  selectWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: () => Promise<void>
  importWorkspace: () => Promise<boolean>
  importWorkspacePath: (rootPath: string) => Promise<boolean>
  updateMission: () => Promise<void>
  applyLessonStyle: (styleId: LessonStyleId) => Promise<void>
  generateLesson: (options?: LessonGenerationOptions) => Promise<void>
  generateLessonStream: (options?: LessonGenerationOptions) => Promise<void>
  loadLesson: (lesson: LessonSummary) => Promise<void>
  loadCourseHtmlFile: (file: CoursePreviewFile) => Promise<void>
  openResourceHtmlPreview: (file: ResourcePreviewFile) => void
  closeResourceHtmlPreview: () => void
  openPath: (path: string) => Promise<void>
  openImportLocation: (path?: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  showNotification: (title: string, body: string) => Promise<void>
  probeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  listUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  listGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  removeGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<void>
  listMemory: (workspaceRoot?: string) => Promise<void>
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<boolean>
  updateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<boolean>
  deleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  loadMemoryDiagnostics: () => Promise<void>
  loadReviewCards: () => Promise<void>
  recordProgress: (lessonId: string, results: Array<{ lessonId: string; question: string; correct: boolean }>) => Promise<void>
  reviewCards: ReviewCard[]
  progress: ProgressSummary | null
  memoryRecords: TeachingMemoryRecord[]
  memoryDiagnostics: TeachingMemoryDiagnostics | null
  agentTurns: AgentChatTurn[]
  activeConversationId: string | null
  agentChatBusy: boolean
  agentStatus: string
  agentInput: string
  agentInputHistory: string[]
  agentToolsSupported: boolean | null
  pendingAgentConversation: PendingAgentConversation | null
  gitBranchesRoot: string
  gitBranchesResult: TeachingGitBranchesResult | null
  gitBranchesLoading: boolean
  setAgentInput: (input: string) => void
  rememberAgentInput: (input: string) => void
  clearAgentChat: () => void
  cancelAgentChat: () => Promise<void>
  restorePendingAgentConversation: () => void
  loadGitBranches: (workspaceRoot: string, options?: { force?: boolean }) => Promise<void>
  setGitBranchesResult: (workspaceRoot: string, result: TeachingGitBranchesResult) => void
  loadAgentConversation: (conversationId: string, workspaceId?: string | null) => Promise<void>
  agentChat: (inputOverride?: string, options?: { mode?: AgentChatMode }) => Promise<void>
  setWorkspaceItemMeta: (payload: { workspaceId?: string | null; relativePath: string; pinned?: boolean | null; archived?: boolean | null }) => Promise<void>
  removeWorkspaceItem: (payload: { workspaceId?: string | null; relativePath: string; kind: WorkspaceItemKind; mode?: WorkspaceItemRemoveMode }) => Promise<void>
  removeWorkspace: (payload: { workspaceId: string; mode?: WorkspaceItemRemoveMode }) => Promise<void>
}

// ================================================================
// Constants
// ================================================================

const navItems = [
  { id: 'overview', icon: Bot },
  { id: 'resources', icon: LibraryBig },
  { id: 'studio', icon: DoorOpen }
] satisfies Array<{ id: WorkspaceView; icon: LucideIcon }>

const defaultRuntime: TeachingRuntimeState = {
  status: 'idle',
  currentStep: 'ready',
  queuedTasks: 0,
  providerLabel: 'Local structured generator'
}

const emptyAppState: TeachingAppState = {
  workspaces: [],
  activeWorkspace: null,
  temporaryConversations: [],
  previewHtml: '',
  previewUrl: '',
  selectedLessonPath: null,
  runtime: defaultRuntime
}

const emptySettings: TeachingSettingsV1 = {
  version: 1,
  locale: 'zh-CN',
  theme: 'system',
  uiFontScale: 1,
  density: 'comfortable',
  provider: {
    activeProviderId: 'deepseek',
    providers: TEACHING_MODEL_PROVIDER_PRESETS.map((preset) => ({ ...preset, apiKey: '' })),
    proxy: {
      enabled: false,
      url: ''
    }
  },
  generator: {
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    endpointFormat: 'chat_completions',
    temperature: 0.4,
    maxOutputTokens: 4096,
    lessonDurationMinutes: 15,
    includeRetrievalPractice: true,
    generateReference: true,
    generateLearningRecord: true,
    structuredOutput: true,
    streaming: false,
    reasoningEffort: 'auto',
    requestTimeoutMs: 60_000
  },
  workspace: {
    defaultRoot: '',
    confirmBeforeGenerating: false,
    autoOpenGeneratedLesson: false,
    showAllCourseFiles: false,
    lessonStyleId: DEFAULT_LESSON_STYLE_ID
  },
  worktree: {
    rootPath: ''
  },
  memory: {
    enabled: true,
    maxInjected: 4
  },
  tools: {
    enabled: false,
    workspaceRead: true,
    webSearch: true,
    webFetch: false,
    maxIterations: 8
  },
  webSearch: {
    backend: 'auto',
    fallbackEnabled: true,
    maxResults: 5,
    searxngUrl: '',
    braveApiKey: '',
    firecrawlApiKey: '',
    firecrawlApiUrl: '',
    tavilyApiKey: '',
    exaApiKey: '',
    parallelApiKey: '',
    parallelSearchMode: 'agentic',
    xaiApiKey: '',
    xaiModel: 'grok-4.3'
  },
  notifications: {
    enabled: true,
    lessonGenerated: true,
    workspaceImported: true,
    errors: true
  },
  privacy: {
    maskApiKeys: true,
    allowExternalLinks: true
  },
  appBehavior: {
    openAtLogin: false,
    startMinimized: false,
    closeAction: 'quit',
    closeToTray: false
  },
  log: {
    enabled: true,
    retentionDays: 14
  }
}

function normalizeRendererSettings(input: TeachingSettingsPatch | TeachingSettingsV1 | null | undefined): TeachingSettingsV1 {
  const settings = input ?? {}

  return {
    ...emptySettings,
    ...settings,
    provider: {
      ...emptySettings.provider,
      ...(settings.provider ?? {}),
      proxy: {
        ...emptySettings.provider.proxy,
        ...(settings.provider?.proxy ?? {})
      },
      providers:
        Array.isArray(settings.provider?.providers) && settings.provider.providers.length > 0
          ? settings.provider.providers
          : emptySettings.provider.providers
    },
    generator: {
      ...emptySettings.generator,
      ...(settings.generator ?? {})
    },
    workspace: {
      ...emptySettings.workspace,
      ...(settings.workspace ?? {})
    },
    worktree: {
      ...emptySettings.worktree,
      ...(settings.worktree ?? {})
    },
    memory: {
      ...emptySettings.memory,
      ...(settings.memory ?? {})
    },
    tools: {
      ...emptySettings.tools,
      ...(settings.tools ?? {})
    },
    webSearch: {
      ...emptySettings.webSearch,
      ...(settings.webSearch ?? {})
    },
    notifications: {
      ...emptySettings.notifications,
      ...(settings.notifications ?? {})
    },
    privacy: {
      ...emptySettings.privacy,
      ...(settings.privacy ?? {})
    },
    appBehavior: {
      ...emptySettings.appBehavior,
      ...(settings.appBehavior ?? {})
    },
    log: {
      ...emptySettings.log,
      ...(settings.log ?? {})
    }
  }
}

const defaultPrompt = ''

const nextPrompt = '基于当前 mission，生成下一节短小、可复习、带检索练习的 HTML lesson。'

const settingsNavItems = [
  { id: 'general', icon: Settings },
  { id: 'appearance', icon: Palette },
  { id: 'model', icon: Bot },
  { id: 'generation', icon: SlidersHorizontal },
  { id: 'tools', icon: Wrench },
  { id: 'search', icon: Search },
  { id: 'workspace', icon: FolderOpen },
  { id: 'worktree', icon: GitBranch },
  { id: 'memory', icon: BrainCircuit },
  { id: 'notifications', icon: Bell },
  { id: 'privacy', icon: Lock },
  { id: 'about', icon: Info }
] satisfies Array<{ id: SettingsSection; icon: LucideIcon }>

const webSearchBackendOptions = WEB_SEARCH_BACKENDS
  .filter((backend) => backend !== 'duckduckgo')
  .map((backend) => ({ value: backend, label: webSearchBackendLabel(backend) }))

const parallelSearchModeOptions = PARALLEL_SEARCH_MODES.map((mode) => ({
  value: mode,
  label: mode
}))

const modelSettingsProviderIds = ['deepseek', 'glm', 'custom'] as const

function webSearchBackendLabel(backend: WebSearchBackend): string {
  switch (backend) {
    case 'auto':
      return 'Auto'
    case 'firecrawl':
      return 'Firecrawl'
    case 'parallel':
      return 'Parallel'
    case 'tavily':
      return 'Tavily'
    case 'exa':
      return 'Exa'
    case 'searxng':
      return 'SearXNG'
    case 'brave':
      return 'Brave Search'
    case 'ddgs':
    case 'duckduckgo':
      return 'DDGS / DuckDuckGo'
    case 'xai':
      return 'xAI Grok'
  }
}

function isInputComposing(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number }
  return Boolean(nativeEvent.isComposing || nativeEvent.keyCode === 229)
}

const STUDY_SPACE_STORAGE_KEY = 'teachos:study-space:v1'
const STUDY_DAY_MS = 24 * 60 * 60 * 1000
const STUDY_PRESENCE_BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'
const STUDY_PRESENCE_TOPIC_ROOT = 'studiumx/study-space/v1'
const STUDY_PRESENCE_PEER_TTL_MS = 35_000
const STUDY_PRESENCE_HEARTBEAT_MS = 10_000
const STUDY_PRESENCE_CLIENT_PREFIX = 'studiumx'
const STUDY_PUBLIC_SPACE_CODE = 'PUBLIC'

const defaultStudySnapshot: StudySnapshot = {
  clientId: '',
  nickname: '',
  spaceCode: STUDY_PUBLIC_SPACE_CODE,
  modeId: 'free',
  contractText: '',
  contractLocked: false,
  ambientEnabled: false,
  ambientVolume: 0.45,
  roomId: 'silent',
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

const studyModes: Array<{
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
    roomId: 'sprint',
    rule: '进入后先写本轮目标，尽量整轮不切任务。'
  },
  {
    id: 'deepwork',
    name: '深度沉浸',
    detail: '适合论文、项目和长时间材料阅读',
    focusMinutes: 90,
    breakMinutes: 15,
    roomId: 'deep',
    rule: '隐藏干扰，只保留一个主目标。'
  },
  {
    id: 'exam',
    name: '模拟考场',
    detail: '适合真题、闭卷训练和限时复盘',
    focusMinutes: 50,
    breakMinutes: 10,
    roomId: 'exam',
    rule: '默认静音，按考试节奏完成后复盘。'
  }
]

const studyRooms: Array<{
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
    name: '静音自习室',
    tone: '低噪、长坐、适合跟读和预习',
    capacity: 36,
    sessionMinutes: 25,
    breakMinutes: 5,
    tags: ['课程预习', '笔记整理', '轻专注'],
    seats: 36,
    light: '晨光',
    ambient: '翻书声',
    backdrop: 'study-backdrop-silent'
  },
  {
    id: 'sprint',
    name: '冲刺教室',
    tone: '公开冲刺、按轮次一起开始',
    capacity: 32,
    sessionMinutes: 45,
    breakMinutes: 10,
    tags: ['作业收尾', '限时刷题', '高效率'],
    seats: 32,
    light: '白炽灯',
    ambient: '键盘声',
    backdrop: 'study-backdrop-sprint'
  },
  {
    id: 'deep',
    name: '深度学习舱',
    tone: '90 分钟沉浸、隐藏干扰',
    capacity: 24,
    sessionMinutes: 90,
    breakMinutes: 15,
    tags: ['论文阅读', '项目推进', '长周期'],
    seats: 24,
    light: '夜灯',
    ambient: '雨声',
    backdrop: 'study-backdrop-deep'
  },
  {
    id: 'exam',
    name: '考试模拟间',
    tone: '整点模拟、休息后复盘',
    capacity: 40,
    sessionMinutes: 50,
    breakMinutes: 10,
    tags: ['真题训练', '倒计时', '复盘'],
    seats: 40,
    light: '考场灯',
    ambient: '无背景音',
    backdrop: 'study-backdrop-exam'
  }
]

function studyRoomCycleOffset(roomId: StudyRoomId): number {
  const roomIndex = studyRooms.findIndex((room) => room.id === roomId)
  return Math.max(0, roomIndex) * 7 * 60
}

function getStudyRoomCycle(room: typeof studyRooms[number], nowMs = Date.now()): StudyRoomCycle {
  const focusSeconds = room.sessionMinutes * 60
  const breakSeconds = room.breakMinutes * 60
  const cycleSeconds = focusSeconds + breakSeconds
  const anchorMs = Date.UTC(2026, 0, 1, 0, 0, 0)
  const elapsedSinceAnchor = Math.max(0, Math.floor((nowMs - anchorMs) / 1000) + studyRoomCycleOffset(room.id))
  const round = Math.floor(elapsedSinceAnchor / cycleSeconds) + 1
  const cycleElapsed = elapsedSinceAnchor % cycleSeconds
  const phase: StudyRoomCyclePhase = cycleElapsed < focusSeconds ? 'focus' : 'break'
  const elapsedSeconds = phase === 'focus' ? cycleElapsed : cycleElapsed - focusSeconds
  const totalSeconds = phase === 'focus' ? focusSeconds : breakSeconds
  const remainingSeconds = Math.max(1, totalSeconds - elapsedSeconds)
  return {
    phase,
    round,
    elapsedSeconds,
    remainingSeconds,
    totalSeconds,
    progress: Math.round((elapsedSeconds / totalSeconds) * 100),
    nextLabel: phase === 'focus' ? `${room.breakMinutes} 分钟休息` : `${room.sessionMinutes} 分钟专注`
  }
}

function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function randomStudyClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${STUDY_PRESENCE_CLIENT_PREFIX}-${crypto.randomUUID()}`
  }
  return `${STUDY_PRESENCE_CLIENT_PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function defaultStudyNickname(clientId: string): string {
  return `同学 ${clientId.slice(-4).toUpperCase()}`
}

function normalizeStudyRoomId(input: unknown): StudyRoomId {
  return studyRooms.some((room) => room.id === input) ? input as StudyRoomId : defaultStudySnapshot.roomId
}

function normalizeStudyModeId(input: unknown): StudyModeId {
  return studyModes.some((mode) => mode.id === input) ? input as StudyModeId : defaultStudySnapshot.modeId
}

function normalizeStudySpaceCode(input: unknown): string {
  if (typeof input !== 'string') return STUDY_PUBLIC_SPACE_CODE
  const value = input.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 18)
  return value.length >= 3 ? value : STUDY_PUBLIC_SPACE_CODE
}

function randomStudySpaceCode(): string {
  const bytes = new Uint8Array(3)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
  }
  return `ROOM-${Array.from(bytes).map((byte) => byte.toString(36).padStart(2, '0').toUpperCase()).join('')}`
}

function studyPresenceTopic(spaceCode: string): string {
  return `${STUDY_PRESENCE_TOPIC_ROOT}/${normalizeStudySpaceCode(spaceCode).toLowerCase()}/presence`
}

function normalizeStudyTasks(input: unknown): StudyTask[] {
  if (!Array.isArray(input)) return defaultStudySnapshot.tasks
  const tasks = input
    .filter((item): item is Partial<StudyTask> => Boolean(item) && typeof item === 'object')
    .map((item, index) => ({
      id: typeof item.id === 'string' && item.id ? item.id : `task-${index}`,
      title: typeof item.title === 'string' ? item.title.trim().slice(0, 80) : '',
      done: Boolean(item.done)
    }))
    .filter((item) => item.title)
    .slice(0, 8)
  return tasks.length > 0 ? tasks : defaultStudySnapshot.tasks
}

function normalizeStudySnapshot(input: unknown): StudySnapshot {
  const raw = input && typeof input === 'object' ? input as Partial<StudySnapshot> : {}
  const clientId = typeof raw.clientId === 'string' && raw.clientId.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)
    ? raw.clientId
    : randomStudyClientId()
  const nickname = typeof raw.nickname === 'string' && raw.nickname.trim()
    ? raw.nickname.trim().slice(0, 18)
    : defaultStudyNickname(clientId)
  const spaceCode = normalizeStudySpaceCode(raw.spaceCode)
  const modeId = normalizeStudyModeId(raw.modeId)
  const roomId = normalizeStudyRoomId(raw.roomId)
  const timerMode = raw.timerMode === 'break' ? 'break' : 'focus'
  const focusMinutes = clampNumber(raw.focusMinutes, 5, 120, defaultStudySnapshot.focusMinutes)
  const breakMinutes = clampNumber(raw.breakMinutes, 1, 45, defaultStudySnapshot.breakMinutes)
  const maxRemaining = (timerMode === 'focus' ? focusMinutes : breakMinutes) * 60
  const lastStudyDate = typeof raw.lastStudyDate === 'string' ? raw.lastStudyDate : ''
  const isToday = lastStudyDate === todayKey()
  return {
    clientId,
    nickname,
    spaceCode,
    modeId,
    contractText: typeof raw.contractText === 'string' ? raw.contractText.trim().slice(0, 120) : '',
    contractLocked: Boolean(raw.contractLocked),
    ambientEnabled: Boolean(raw.ambientEnabled),
    ambientVolume: clampNumber(raw.ambientVolume, 0, 1, defaultStudySnapshot.ambientVolume),
    roomId,
    timerMode,
    timerState: raw.timerState === 'running' || raw.timerState === 'paused' ? raw.timerState : 'idle',
    focusMinutes,
    breakMinutes,
    remainingSeconds: clampNumber(raw.remainingSeconds, 1, maxRemaining, maxRemaining),
    todayFocusSeconds: isToday ? clampNumber(raw.todayFocusSeconds, 0, 24 * 60 * 60, 0) : 0,
    todaySessions: isToday ? clampNumber(raw.todaySessions, 0, 99, 0) : 0,
    totalFocusSeconds: clampNumber(raw.totalFocusSeconds, 0, 100_000 * 60, 0),
    totalSessions: clampNumber(raw.totalSessions, 0, 100_000, 0),
    streakDays: clampNumber(raw.streakDays, 0, 10_000, 0),
    xp: clampNumber(raw.xp, 0, 1_000_000, 0),
    lastStudyDate,
    tasks: normalizeStudyTasks(raw.tasks)
  }
}

function readStudySnapshot(): StudySnapshot {
  try {
    const stored = window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)
    return normalizeStudySnapshot(stored ? JSON.parse(stored) : null)
  } catch {
    return defaultStudySnapshot
  }
}

function persistStudySnapshot(snapshot: StudySnapshot): void {
  try {
    window.localStorage.setItem(STUDY_SPACE_STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Study progress should stay usable even when storage is unavailable.
  }
}

function formatStudyDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatStudyHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600
  return hours >= 10 ? hours.toFixed(0) : hours.toFixed(1)
}

function formatStudyEventTime(createdAt: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  if (elapsedSeconds < 45) return '刚刚'
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} 分钟前`
  return `${Math.floor(elapsedSeconds / 3600)} 小时前`
}

function studyMemberStatusLabel(status: StudyTimerState, timerMode: StudyTimerMode): string {
  if (status === 'running') return timerMode === 'focus' ? '在线专注' : '休息中'
  if (status === 'paused') return '暂停'
  return '准备'
}

function studyLevel(xp: number): { level: number; current: number; next: number; progress: number } {
  const level = Math.max(1, Math.floor(xp / 120) + 1)
  const current = xp % 120
  return { level, current, next: 120, progress: Math.min(100, Math.round((current / 120) * 100)) }
}

function studyPlantStage(xp: number): string {
  if (xp >= 720) return '成林'
  if (xp >= 420) return '开花'
  if (xp >= 180) return '抽枝'
  if (xp >= 60) return '发芽'
  return '种子'
}

function nextStudyStreak(lastStudyDate: string, currentStreak: number, now = new Date()): number {
  const today = todayKey(now)
  if (lastStudyDate === today) return currentStreak || 1
  const yesterday = new Date(now.getTime() - STUDY_DAY_MS).toISOString().slice(0, 10)
  return lastStudyDate === yesterday ? currentStreak + 1 : 1
}

function mqttEncodeString(value: string): number[] {
  const encoded = new TextEncoder().encode(value)
  return [encoded.length >> 8, encoded.length & 0xff, ...encoded]
}

function mqttEncodeRemainingLength(length: number): number[] {
  const bytes: number[] = []
  let value = length
  do {
    let byte = value % 128
    value = Math.floor(value / 128)
    if (value > 0) byte |= 128
    bytes.push(byte)
  } while (value > 0)
  return bytes
}

function mqttPacket(type: number, variableHeader: number[] = [], payload: number[] = []): Uint8Array {
  const body = [...variableHeader, ...payload]
  return new Uint8Array([type, ...mqttEncodeRemainingLength(body.length), ...body])
}

function mqttConnectPacket(clientId: string): Uint8Array {
  return mqttPacket(
    0x10,
    [...mqttEncodeString('MQTT'), 0x04, 0x02, 0x00, 0x2d],
    mqttEncodeString(clientId.slice(0, 48))
  )
}

function mqttSubscribePacket(topic: string, packetId: number): Uint8Array {
  return mqttPacket(
    0x82,
    [packetId >> 8, packetId & 0xff],
    [...mqttEncodeString(topic), 0x00]
  )
}

function mqttPublishPacket(topic: string, message: string): Uint8Array {
  return mqttPacket(0x30, mqttEncodeString(topic), Array.from(new TextEncoder().encode(message)))
}

function mqttSend(socket: WebSocket, packet: Uint8Array): void {
  const body = new ArrayBuffer(packet.byteLength)
  new Uint8Array(body).set(packet)
  socket.send(body)
}

function mqttReadRemainingLength(bytes: Uint8Array, offset: number): { value: number; nextOffset: number } | null {
  let multiplier = 1
  let value = 0
  let cursor = offset
  while (cursor < bytes.length) {
    const byte = bytes[cursor]
    value += (byte & 127) * multiplier
    cursor += 1
    if ((byte & 128) === 0) return { value, nextOffset: cursor }
    multiplier *= 128
    if (multiplier > 128 * 128 * 128) return null
  }
  return null
}

function mqttReadString(bytes: Uint8Array, offset: number): { value: string; nextOffset: number } | null {
  if (offset + 2 > bytes.length) return null
  const length = (bytes[offset] << 8) + bytes[offset + 1]
  const start = offset + 2
  const end = start + length
  if (end > bytes.length) return null
  return { value: new TextDecoder().decode(bytes.slice(start, end)), nextOffset: end }
}

function mqttParsePublish(data: ArrayBuffer): { topic: string; message: string } | null {
  const bytes = new Uint8Array(data)
  if ((bytes[0] >> 4) !== 3) return null
  const remaining = mqttReadRemainingLength(bytes, 1)
  if (!remaining) return null
  const packetEnd = remaining.nextOffset + remaining.value
  if (packetEnd > bytes.length) return null
  const topic = mqttReadString(bytes, remaining.nextOffset)
  if (!topic) return null
  return {
    topic: topic.value,
    message: new TextDecoder().decode(bytes.slice(topic.nextOffset, packetEnd))
  }
}

function normalizePresencePeer(input: unknown): StudyPresencePeer | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<StudyPresencePeer> & { type?: string }
  if (raw.type !== 'study-presence') return null
  if (typeof raw.clientId !== 'string' || !raw.clientId.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)) return null
  const roomId = normalizeStudyRoomId(raw.roomId)
  const spaceCode = normalizeStudySpaceCode(raw.spaceCode)
  const nickname = typeof raw.nickname === 'string' && raw.nickname.trim()
    ? raw.nickname.trim().slice(0, 18)
    : defaultStudyNickname(raw.clientId)
  const status: StudyTimerState = raw.status === 'running' || raw.status === 'paused' ? raw.status : 'idle'
  return {
    clientId: raw.clientId,
    roomId,
    spaceCode,
    nickname,
    status,
    timerMode: raw.timerMode === 'break' ? 'break' : 'focus',
    focusMinutes: clampNumber(raw.focusMinutes, 5, 120, 25),
    todayFocusSeconds: clampNumber(raw.todayFocusSeconds, 0, 24 * 60 * 60, 0),
    todaySessions: clampNumber(raw.todaySessions, 0, 99, 0),
    streakDays: clampNumber(raw.streakDays, 0, 10_000, 0),
    updatedAt: clampNumber(raw.updatedAt, 0, Date.now() + 60_000, Date.now())
  }
}

function normalizeStudyRoomEvent(input: unknown): StudyRoomEvent | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<StudyRoomEvent> & { type?: string }
  if (raw.type !== 'study-event') return null
  if (typeof raw.clientId !== 'string' || !raw.clientId.startsWith(STUDY_PRESENCE_CLIENT_PREFIX)) return null
  const kind = raw.kind === 'checkin' || raw.kind === 'focus_start' || raw.kind === 'task_done' || raw.kind === 'cheer'
    ? raw.kind
    : null
  if (!kind) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 80) : `${raw.clientId}-${raw.createdAt ?? Date.now()}`
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 90) : ''
  if (!text) return null
  return {
    id,
    clientId: raw.clientId,
    spaceCode: normalizeStudySpaceCode(raw.spaceCode),
    roomId: normalizeStudyRoomId(raw.roomId),
    nickname: typeof raw.nickname === 'string' && raw.nickname.trim()
      ? raw.nickname.trim().slice(0, 18)
      : defaultStudyNickname(raw.clientId),
    kind,
    text,
    createdAt: clampNumber(raw.createdAt, Date.now() - STUDY_DAY_MS, Date.now() + 60_000, Date.now())
  }
}

function useStudyPresence(snapshot: StudySnapshot): {
  status: StudyPresenceStatus
  peers: StudyPresencePeer[]
  events: StudyRoomEvent[]
  relay: string
  sendEvent: (kind: StudyRoomEventKind, text: string) => void
} {
  const [status, setStatus] = useState<StudyPresenceStatus>('connecting')
  const [peers, setPeers] = useState<StudyPresencePeer[]>([])
  const [events, setEvents] = useState<StudyRoomEvent[]>([])
  const snapshotRef = useRef(snapshot)
  const socketRef = useRef<WebSocket | null>(null)
  const subscribedRef = useRef(false)
  const activeTopic = studyPresenceTopic(snapshot.spaceCode)

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    let closed = false
    let reconnectTimer: number | undefined
    let heartbeatTimer: number | undefined
    let pruneTimer: number | undefined
    let packetId = 1

    const publishPresence = (): void => {
      const socket = socketRef.current
      if (!socket || socket.readyState !== WebSocket.OPEN || !subscribedRef.current) return
      const current = snapshotRef.current
      const message = JSON.stringify({
        type: 'study-presence',
        clientId: current.clientId,
        spaceCode: current.spaceCode,
        roomId: current.roomId,
        nickname: current.nickname,
        status: current.timerState,
        timerMode: current.timerMode,
        focusMinutes: current.focusMinutes,
        todayFocusSeconds: current.todayFocusSeconds,
        todaySessions: current.todaySessions,
        streakDays: current.streakDays,
        updatedAt: Date.now()
      })
      mqttSend(socket, mqttPublishPacket(activeTopic, message))
    }

    const prunePeers = (): void => {
      const nowMs = Date.now()
      setPeers((current) => current.filter((peer) => nowMs - peer.updatedAt <= STUDY_PRESENCE_PEER_TTL_MS))
      setEvents((current) => current.filter((event) => nowMs - event.createdAt <= 2 * 60 * 60 * 1000))
    }

    const connect = (): void => {
      setStatus('connecting')
      subscribedRef.current = false
      const socket = new WebSocket(STUDY_PRESENCE_BROKER_URL, 'mqtt')
      socket.binaryType = 'arraybuffer'
      socketRef.current = socket

      socket.addEventListener('open', () => {
        mqttSend(socket, mqttConnectPacket(snapshotRef.current.clientId))
      })

      socket.addEventListener('message', (event) => {
        if (!(event.data instanceof ArrayBuffer)) return
        const bytes = new Uint8Array(event.data)
        const packetType = bytes[0] >> 4
        if (packetType === 2) {
          mqttSend(socket, mqttSubscribePacket(activeTopic, packetId++))
          setStatus('online')
          return
        }
        if (packetType === 9) {
          subscribedRef.current = true
          publishPresence()
          return
        }
        const publish = mqttParsePublish(event.data)
        if (!publish || publish.topic !== activeTopic) return
        try {
          const peer = normalizePresencePeer(JSON.parse(publish.message))
          if (peer) {
            if (peer.clientId === snapshotRef.current.clientId) return
            setPeers((current) => [peer, ...current.filter((item) => item.clientId !== peer.clientId)].slice(0, 80))
            return
          }
          const event = normalizeStudyRoomEvent(JSON.parse(publish.message))
          if (!event || event.clientId === snapshotRef.current.clientId) return
          setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 80))
        } catch {
          // Ignore malformed public relay payloads.
        }
      })

      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null
        subscribedRef.current = false
        setStatus('offline')
        if (!closed) reconnectTimer = window.setTimeout(connect, 5000)
      })

      socket.addEventListener('error', () => {
        setStatus('offline')
        socket.close()
      })
    }

    connect()
    setPeers([])
    setEvents([])
    heartbeatTimer = window.setInterval(() => {
      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) mqttSend(socket, new Uint8Array([0xc0, 0x00]))
      publishPresence()
    }, STUDY_PRESENCE_HEARTBEAT_MS)
    pruneTimer = window.setInterval(prunePeers, 5000)

    return () => {
      closed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (heartbeatTimer) window.clearInterval(heartbeatTimer)
      if (pruneTimer) window.clearInterval(pruneTimer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [activeTopic])

  useEffect(() => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN && subscribedRef.current) {
      mqttSend(socket, mqttPublishPacket(activeTopic, JSON.stringify({
        type: 'study-presence',
        clientId: snapshot.clientId,
        spaceCode: snapshot.spaceCode,
        roomId: snapshot.roomId,
        nickname: snapshot.nickname,
        status: snapshot.timerState,
        timerMode: snapshot.timerMode,
        focusMinutes: snapshot.focusMinutes,
        todayFocusSeconds: snapshot.todayFocusSeconds,
        todaySessions: snapshot.todaySessions,
        streakDays: snapshot.streakDays,
        updatedAt: Date.now()
      })))
    }
  }, [activeTopic, snapshot.clientId, snapshot.focusMinutes, snapshot.nickname, snapshot.roomId, snapshot.spaceCode, snapshot.streakDays, snapshot.timerMode, snapshot.timerState])

  const sendEvent = (kind: StudyRoomEventKind, text: string): void => {
    const current = snapshotRef.current
    const event: StudyRoomEvent = {
      id: `${current.clientId}-${Date.now()}-${kind}`,
      clientId: current.clientId,
      spaceCode: current.spaceCode,
      roomId: current.roomId,
      nickname: current.nickname,
      kind,
      text: text.trim().slice(0, 90),
      createdAt: Date.now()
    }
    if (!event.text) return
    setEvents((items) => [event, ...items.filter((item) => item.id !== event.id)].slice(0, 80))
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN && subscribedRef.current) {
      mqttSend(socket, mqttPublishPacket(activeTopic, JSON.stringify({ type: 'study-event', ...event })))
    }
  }

  return { status, peers, events, relay: STUDY_PRESENCE_BROKER_URL.replace(/^wss?:\/\//, ''), sendEvent }
}

function useStudyAmbient(roomId: StudyRoomId, enabled: boolean, volume: number): void {
  useEffect(() => {
    if (!enabled || roomId === 'exam') return undefined
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return undefined

    const context = new AudioContextCtor()
    const gain = context.createGain()
    gain.gain.value = Math.min(0.16, Math.max(0, volume) * 0.16)
    gain.connect(context.destination)

    const filter = context.createBiquadFilter()
    filter.connect(gain)
    const bufferSize = Math.max(1, Math.floor(context.sampleRate * 2))
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < bufferSize; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (roomId === 'deep' ? 0.8 : 0.32)
    }

    if (roomId === 'deep') {
      filter.type = 'lowpass'
      filter.frequency.value = 850
    } else if (roomId === 'sprint') {
      filter.type = 'bandpass'
      filter.frequency.value = 1250
      filter.Q.value = 0.7
    } else {
      filter.type = 'highpass'
      filter.frequency.value = 420
    }

    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.connect(filter)
    void context.resume().catch(() => undefined)
    source.start()

    return () => {
      source.stop()
      source.disconnect()
      filter.disconnect()
      gain.disconnect()
      void context.close().catch(() => undefined)
    }
  }, [enabled, roomId, volume])
}

// ================================================================
// Settings helpers — resolve active provider, runtime label, theme side effects
// ================================================================

const DARK_THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'
type ResolvedTheme = 'light' | 'dark'

function activeModelProvider(settings: TeachingSettingsV1): TeachingModelProviderProfile {
  const provider =
    settings.provider.providers.find((item) => item.id === settings.generator.providerId) ??
    settings.provider.providers.find((item) => item.id === settings.provider.activeProviderId) ??
    settings.provider.providers[0]
  return provider
}

function runtimeProviderLabel(settings: TeachingSettingsV1): string {
  const provider = activeModelProvider(settings)
  const model = settings.generator.model || i18n.t('common.auto')
  return `${provider?.name ?? i18n.t('common.modelProvider')} · ${model}`
}

function providerHost(provider: TeachingModelProviderProfile): string {
  try {
    return new URL(provider.baseUrl).hostname.toLowerCase()
  } catch {
    return provider.baseUrl.toLowerCase()
  }
}

function formatLessonIndex(id: string): string {
  const numeric = id.match(/\d+/)?.[0]
  if (!numeric) return id
  return String(Number.parseInt(numeric, 10)).padStart(2, '0')
}

function stripLessonIndexPrefix(name: string, id: string): string {
  if (!id || !name.startsWith(id)) return name
  const rest = name.slice(id.length).replace(/^[\s._-]+/, '')
  return rest || name
}

function isDeepSeekReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = providerHost(provider)
  return provider.id === 'deepseek' || host.includes('deepseek.com') || /^deepseek[-_.]/i.test(model)
}

function isClaudeReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  return provider.id === 'anthropic' || /^claude-(opus|sonnet|haiku|fable|mythos)/i.test(model)
}

function isMiniMaxOpenAiProvider(provider: TeachingModelProviderProfile): boolean {
  const host = providerHost(provider)
  return host.includes('minimaxi.com') && !provider.baseUrl.toLowerCase().includes('/anthropic')
}

function supportsOpenAiReasoningEffort(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = providerHost(provider)
  return (
    provider.id === 'custom' ||
    provider.id === 'xiaomi' ||
    host.includes('openai.com') ||
    host.includes('xiaomimimo.com') ||
    /^mimo[-_.]/i.test(model) ||
    /^o\d/i.test(model) ||
    /^gpt-5/i.test(model)
  )
}

function reasoningEffortOptionsForSettings(settings: TeachingSettingsV1): ModelReasoningEffort[] {
  const provider = activeModelProvider(settings)
  const model = settings.generator.model
  if (isDeepSeekReasoningProvider(provider, model)) return ['auto', 'high', 'max']
  if (isClaudeReasoningProvider(provider, model)) return ['auto', 'off', 'low', 'medium', 'high', 'xhigh', 'max']
  if (isMiniMaxOpenAiProvider(provider)) return ['auto', 'off', 'high']
  if (supportsOpenAiReasoningEffort(provider, model)) return ['auto', 'off', 'low', 'medium', 'high']
  return ['auto']
}

function selectedReasoningEffort(settings: TeachingSettingsV1): ModelReasoningEffort {
  const value = settings.generator.reasoningEffort ?? 'auto'
  return reasoningEffortOptionsForSettings(settings).includes(value) ? value : 'auto'
}

function reasoningEffortLabel(effort: ModelReasoningEffort): string {
  return i18n.t(`reasoning.effort.${effort}`)
}

function reasoningEffortDescription(effort: ModelReasoningEffort): string {
  return i18n.t(`reasoning.description.${effort}`)
}

function systemThemePreference(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia(DARK_THEME_MEDIA_QUERY).matches ? 'dark' : 'light'
}

function resolveThemePreference(theme: TeachingSettingsV1['theme']): ResolvedTheme {
  return theme === 'system' ? systemThemePreference() : theme
}

function applySettingsSideEffects(settings: TeachingSettingsV1): void {
  const root = document.documentElement
  const resolvedTheme = resolveThemePreference(settings.theme)
  root.dataset.theme = settings.theme
  root.dataset.resolvedTheme = resolvedTheme
  root.dataset.density = settings.density
  root.style.fontSize = `${settings.uiFontScale * 100}%`
  root.style.colorScheme = resolvedTheme
  void i18n.changeLanguage(settings.locale)
}

// ================================================================
// Error Mapping — converts raw errors to user-friendly messages
// ================================================================

function toUserError(error: unknown): UserError {
  const raw = error instanceof Error ? error.message : String(error)

  // IPC validation errors
  if (raw.includes('No handler registered for')) {
    return {
      message: i18n.t('errors.ipcHandlerMissing.message'),
      severity: 'warning',
      detail: i18n.t('errors.ipcHandlerMissing.detail')
    }
  }

  if (raw.includes('未配置 API Key') || raw.includes('No API key') || raw.includes('API Key is required')) {
    return {
      message: i18n.t('errors.noApiKey.message'),
      severity: 'warning',
      detail: i18n.t('errors.noApiKey.detail')
    }
  }

  const providerError = classifyProviderError(raw)
  if (providerError) {
    const suffix = providerError.providerMessage ? ` ${providerError.providerMessage}` : ''
    if (providerError.kind === 'insufficient_balance') {
      return {
        message: i18n.t('errors.providerInsufficientBalance.message'),
        severity: 'warning',
        detail: `${i18n.t('errors.providerInsufficientBalance.detail')}${suffix}`
      }
    }
    if (providerError.kind === 'authentication') {
      return {
        message: i18n.t('errors.providerAuth.message'),
        severity: 'warning',
        detail: `${i18n.t('errors.providerAuth.detail')}${suffix}`
      }
    }
    if (providerError.kind === 'rate_limit') {
      return {
        message: i18n.t('errors.providerRateLimit.message'),
        severity: 'warning',
        detail: `${i18n.t('errors.providerRateLimit.detail')}${suffix}`
      }
    }
    return {
      message: i18n.t('errors.providerHttp.message'),
      severity: 'warning',
      detail: `${i18n.t('errors.providerHttp.detail', { status: providerError.status ?? '-' })}${suffix}`
    }
  }

  if (raw.includes('IPC payload field')) {
    const field = raw.match(/"([^"]+)"/)?.[1] ?? i18n.t('errors.missingField.fallbackField')
    return {
      message: i18n.t('errors.missingField.message'),
      severity: 'warning',
      detail: i18n.t('errors.missingField.detail', { field })
    }
  }

  if (raw.includes('IPC payload must be an object')) {
    return {
      message: i18n.t('errors.badPayload.message'),
      severity: 'warning',
      detail: i18n.t('errors.badPayload.detail')
    }
  }

  if (raw.includes('Unsupported window control action')) {
    return {
      message: i18n.t('errors.windowControl.message'),
      severity: 'info',
      detail: i18n.t('errors.windowControl.detail')
    }
  }

  // Workspace errors
  if (raw.includes('Workspace not found')) {
    return {
      message: i18n.t('errors.workspaceNotFound.message'),
      severity: 'warning',
      detail: i18n.t('errors.workspaceNotFound.detail')
    }
  }

  if (raw.includes('not a directory') || raw.includes('Selected path')) {
    return {
      message: i18n.t('errors.invalidPath.message'),
      severity: 'warning',
      detail: i18n.t('errors.invalidPath.detail')
    }
  }

  if (raw.includes('Mission prompt is required')) {
    return {
      message: i18n.t('errors.emptyMission.message'),
      severity: 'info',
      detail: i18n.t('errors.emptyMission.detail')
    }
  }

  if (raw.includes('Lesson prompt is required')) {
    return {
      message: i18n.t('errors.emptyTask.message'),
      severity: 'info',
      detail: i18n.t('errors.emptyTask.detail')
    }
  }

  if (raw.includes('outside the workspace lessons directory') || raw.includes('Path is outside')) {
    return {
      message: i18n.t('errors.pathRestricted.message'),
      severity: 'warning',
      detail: i18n.t('errors.pathRestricted.detail')
    }
  }

  // File system errors
  if (raw.includes('ENOENT') || raw.includes('no such file')) {
    return {
      message: i18n.t('errors.fileNotFound.message'),
      severity: 'warning',
      detail: i18n.t('errors.fileNotFound.detail')
    }
  }

  if (raw.includes('EACCES') || raw.includes('permission denied')) {
    return {
      message: i18n.t('errors.accessDenied.message'),
      severity: 'error',
      detail: i18n.t('errors.accessDenied.detail')
    }
  }

  // Generic fallback — don't expose raw stack traces
  if (raw.includes('Error:') || raw.includes('TypeError:') || raw.includes('at ')) {
    return {
      message: i18n.t('errors.generic.message'),
      severity: 'error',
      detail: i18n.t('errors.generic.stackDetail')
    }
  }

  return {
    message: raw || i18n.t('errors.generic.message'),
    severity: 'error',
    detail: i18n.t('errors.generic.detail')
  }
}

// ================================================================
// App Error Boundary
// ================================================================

type ErrorBoundaryProps = { children: ReactNode }
type ErrorBoundaryState = { error: Error | null }

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[TeachOS] uncaught render error:', error, info.componentStack)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children

    const userError = toUserError(this.state.error)
    return (
      <div className="app-frame">
        <div className="error-boundary-card">
          <div className="assistant-badge" style={{ margin: '0 auto 16px' }}>
            <AlertTriangle size={16} />
            {i18n.t('errorBoundary.badge')}
          </div>
          <h2>{userError.message}</h2>
          <p>{userError.detail ?? i18n.t('errorBoundary.fallbackDetail')}</p>
          <button type="button" onClick={this.handleReload}>
            <RefreshCw size={15} />
            {i18n.t('errorBoundary.reload')}
          </button>
        </div>
      </div>
    )
  }
}

// ================================================================
// Zustand Store
// ================================================================

const AGENT_INPUT_HISTORY_STORAGE_KEY = 'teachos:agent-input-history'
const MAX_AGENT_INPUT_HISTORY = 20

function appendAgentInputHistory(history: string[], input: string): string[] {
  const value = input.trim()
  if (!value) return history
  const withoutCurrent = history.filter((item) => item !== value)
  return [...withoutCurrent, value].slice(-MAX_AGENT_INPUT_HISTORY)
}

function mergeAgentInputHistory(...sources: Array<string[] | undefined>): string[] {
  return sources.flat().reduce<string[]>((history, input) => appendAgentInputHistory(history, input ?? ''), [])
}

function normalizeAgentInputHistory(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.reduce<string[]>((history, item) => {
    if (typeof item !== 'string') return history
    return appendAgentInputHistory(history, item)
  }, [])
}

function readPersistedAgentInputHistory(): string[] {
  try {
    const stored = window.localStorage.getItem(AGENT_INPUT_HISTORY_STORAGE_KEY)
    if (!stored) return []
    return normalizeAgentInputHistory(JSON.parse(stored))
  } catch {
    return []
  }
}

function persistAgentInputHistory(history: string[]): void {
  try {
    window.localStorage.setItem(
      AGENT_INPUT_HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(-MAX_AGENT_INPUT_HISTORY))
    )
  } catch {
    // Input history is a convenience feature; storage failures should not block sending.
  }
}

const useAppStore = create<StoreState>((set, get) => ({
  view: 'agent',
  settingsSection: 'general',
  sidebarCollapsed: false,
  loading: true,
  generating: false,
  error: null,
  searchQuery: '',
  taskPrompt: defaultPrompt,
  overviewDialogMode: 'chat',
  lessonReaderOpen: false,
  selectedCoursePreviewFile: null,
  selectedResourcePreviewFile: null,
  selectedCourseRelativePath: null,
  selectedCourseWorkspaceId: null,
  appState: emptyAppState,
  settings: emptySettings,
  reviewCards: [],
  progress: null,
  memoryRecords: [],
  memoryDiagnostics: null,
  agentTurns: [],
  activeConversationId: null,
  agentChatBusy: false,
  agentStatus: '',
  agentInput: '',
  agentInputHistory: readPersistedAgentInputHistory(),
  agentToolsSupported: null,
  pendingAgentConversation: null,
  gitBranchesRoot: '',
  gitBranchesResult: null,
  gitBranchesLoading: false,
  setAgentInput: (agentInput) => set({ agentInput }),
  rememberAgentInput: (input) => {
    const nextHistory = appendAgentInputHistory(get().agentInputHistory, input)
    set({ agentInputHistory: nextHistory })
    persistAgentInputHistory(nextHistory)
  },
  clearAgentChat: () => {
    if (get().agentChatBusy && get().pendingAgentConversation) {
      set({ agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null })
      return
    }
    set({ agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentChatBusy: false, pendingAgentConversation: null })
  },
  cancelAgentChat: async () => {
    const api = window.teachingSystem
    const pending = get().pendingAgentConversation
    if (!pending || !get().agentChatBusy) return
    set(cancelPendingAgentConversation({
      pending,
      activeConversationId: get().activeConversationId,
      preserveToolsSupported: true
    }))
    await api?.cancelAgentChatStream(pending.summary.id).catch(() => undefined)
  },
  restorePendingAgentConversation: () => {
    const pending = get().pendingAgentConversation
    if (!pending) return
    const courseRelativePath = courseRelativePathForAgentConversation(pending.summary.relativePath)
    set({
      view: pending.mode === 'teaching' ? 'overview' : 'agent',
      overviewDialogMode: pending.mode === 'teaching' ? 'teaching' : get().overviewDialogMode,
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      agentTurns: pending.turns,
      activeConversationId: pending.summary.id,
      agentStatus: pending.status,
      agentToolsSupported: pending.toolsSupported,
      selectedCourseRelativePath: courseRelativePath,
      selectedCourseWorkspaceId: courseRelativePath ? pending.workspaceId : null
    })
  },
  loadGitBranches: async (workspaceRoot, options) => {
    const root = workspaceRoot.trim()
    const api = window.teachingSystem
    if (!root || !api) {
      set({ gitBranchesRoot: '', gitBranchesResult: null, gitBranchesLoading: false })
      return
    }
    const current = get()
    if (!options?.force && current.gitBranchesRoot === root && (current.gitBranchesResult || current.gitBranchesLoading)) return

    set({
      gitBranchesRoot: root,
      gitBranchesLoading: true,
      ...(current.gitBranchesRoot === root ? {} : { gitBranchesResult: null })
    })
    try {
      const result = await api.listGitBranches(root)
      if (get().gitBranchesRoot === root) {
        set({ gitBranchesResult: result, gitBranchesLoading: false })
      }
    } catch (error) {
      if (get().gitBranchesRoot === root) {
        set({ gitBranchesLoading: false, error: toUserError(error) })
      }
    }
  },
  setGitBranchesResult: (workspaceRoot, gitBranchesResult) => {
    const root = workspaceRoot.trim()
    set({ gitBranchesRoot: root, gitBranchesResult, gitBranchesLoading: false })
  },
  setView: (view) => {
    set(view === 'resources' ? { view, selectedResourcePreviewFile: null } : { view })
    if (view === 'review') void get().loadReviewCards()
  },
  setOverviewDialogMode: (overviewDialogMode) => set({ overviewDialogMode }),
  openLessonLibrary: () => set({ view: 'lessons', lessonReaderOpen: false, selectedCoursePreviewFile: null, selectedResourcePreviewFile: null }),
  openTeachingConversationView: () => set({
    view: 'overview',
    overviewDialogMode: 'teaching',
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null
  }),
  openWorkspaceTeachingMode: () => {
    get().clearAgentChat()
    set({
      view: 'overview',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      selectedResourcePreviewFile: null,
      selectedCourseRelativePath: null,
      selectedCourseWorkspaceId: null
    })
  },
  selectCourseFolder: (selectedCourseRelativePath, workspaceId) => {
    const targetWorkspace = workspaceId
      ? get().appState.workspaces.find((workspace) => workspace.id === workspaceId) ?? null
      : get().appState.activeWorkspace
    const selectedCourse = selectedCourseRelativePath
      ? targetWorkspace?.courses.find((course) => sameRelativePath(course.relativePath, selectedCourseRelativePath)) ?? null
      : null
    const hasCourseContent = selectedCourseRelativePath
      ? Boolean(selectedCourse && selectedCourse.sessionCount > 0)
      : Boolean(targetWorkspace?.lessons.length)
    set({
      view: hasCourseContent ? 'lessons' : 'overview',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      selectedResourcePreviewFile: null,
      selectedCourseRelativePath,
      selectedCourseWorkspaceId: selectedCourse ? targetWorkspace?.id ?? null : null,
      ...(!hasCourseContent
        ? { agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentChatBusy: false, pendingAgentConversation: null }
        : {})
    })
  },
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  openSettings: (section = 'general') => set({ view: 'settings', settingsSection: section }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setTaskPrompt: (taskPrompt) => set({ taskPrompt }),
  clearError: () => set({ error: null }),
  initialize: async () => {
    set({ loading: true, error: null })
    const api = window.teachingSystem
    if (!api) {
      console.warn('[TeachOS] preload API is not available; renderer is running without window.teachingSystem.')
      set({ loading: false, error: null })
      return
    }
    try {
      const [state, rawSettings] = await Promise.all([
        api.getState(),
        api.getSettings()
      ])
      const settings = normalizeRendererSettings(rawSettings)
      applySettingsSideEffects(settings)
      set({
        appState: state,
        settings,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        loading: false
      })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  updateSettings: async (patch) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const settings = normalizeRendererSettings(await api.updateSettings(patch))
      applySettingsSideEffects(settings)
      set({ settings, error: null })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  pickDefaultRoot: async () => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const currentPath = get().settings.workspace.defaultRoot
      const result = await api.pickDirectory(currentPath)
      if (result.canceled || !result.path) return
      await get().updateSettings({ workspace: { defaultRoot: result.path } })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  selectWorkspace: async (workspaceId) => {
    const api = window.teachingSystem
    if (!api) return
    set({ loading: true, error: null })
    try {
      const state = await api.selectWorkspace(workspaceId)
      set({
        appState: state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  createWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return
    const name = window.prompt(i18n.t('dialogs.createNameTitle'), i18n.t('dialogs.createNameDefault'))
    if (!name) return
    const prompt = window.prompt(i18n.t('dialogs.createMissionTitle'), i18n.t('dialogs.createMissionDefault', { name }))
    if (!prompt) return
    set({ loading: true, error: null })
    try {
      const state = await api.createWorkspace({ name, prompt })
      set({
        appState: state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  importWorkspace: async () => {
    const api = window.teachingSystem
    if (!api) return false
    set({ loading: true, error: null })
    try {
      const result = await api.importWorkspace()
      if (result.canceled || !result.state) {
        set({ loading: false })
        return false
      }
      set({
        appState: result.state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: result.state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.workspaceImported) {
        const wsName = result.state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName')
        void get().showNotification(i18n.t('notify.imported.title'), i18n.t('notify.imported.body', { name: wsName }))
      }
      return true
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification(i18n.t('notify.importFailed.title'), toUserError(error).message)
      }
      return false
    }
  },
  importWorkspacePath: async (rootPath) => {
    const api = window.teachingSystem
    if (!api) return false
    const path = rootPath.trim()
    if (!path) {
      set({ error: { message: i18n.t('errors.invalidPath.message'), severity: 'warning', detail: i18n.t('errors.invalidPath.detail') } })
      return false
    }
    set({ loading: true, error: null })
    try {
      const state = await api.importWorkspacePath(path)
      set({
        appState: state,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        selectedCourseRelativePath: null,
        selectedCourseWorkspaceId: null,
        taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
        agentTurns: [],
        activeConversationId: null,
        agentStatus: '',
        agentToolsSupported: null,
        pendingAgentConversation: null,
        loading: false
      })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.workspaceImported) {
        const wsName = state.activeWorkspace?.name ?? i18n.t('notify.imported.fallbackName')
        void get().showNotification(i18n.t('notify.imported.title'), i18n.t('notify.imported.body', { name: wsName }))
      }
      return true
    } catch (error) {
      const userError = toUserError(error)
      set({ loading: false, error: userError })
      const settings = get().settings
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification(i18n.t('notify.importFailed.title'), userError.message)
      }
      return false
    }
  },
  openImportLocation: async (path) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.openImportLocation(path)
      if (!result.ok) {
        set({ error: { message: i18n.t('errors.openPath'), severity: 'warning', detail: result.message } })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  updateMission: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    const newPrompt = window.prompt(i18n.t('dialogs.updateMissionTitle'), workspace.missionExcerpt)
    if (!newPrompt) return
    set({ loading: true, error: null })
    try {
      const state = await api.updateMission({ workspaceId: workspace.id, prompt: newPrompt })
      set({ appState: state, loading: false })
    } catch (error) {
      set({ loading: false, error: toUserError(error) })
    }
  },
  applyLessonStyle: async (styleId) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const workspace = get().appState.activeWorkspace
      if (workspace) {
        const state = await api.applyLessonStyle({ workspaceId: workspace.id, styleId })
        set({ appState: state })
      }
      await get().updateSettings({ workspace: { lessonStyleId: styleId } })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  generateLesson: async (options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = (options?.prompt ?? get().taskPrompt).trim()
    const settings = get().settings
    if (!workspace || !prompt) return
    const lessonMessages = options?.messages ?? (
      activeTeachingConversationSummary({
        state: get().appState,
        workspaceId: workspace.id,
        activeConversationId: get().activeConversationId,
        pendingAgentConversation: get().pendingAgentConversation
      })
        ? agentTurnsToMessages(get().agentTurns)
        : []
    )
    if (
      settings.workspace.confirmBeforeGenerating &&
      !window.confirm(i18n.t('dialogs.confirmGenerate'))
    ) {
      return
    }
    set({
      generating: true,
      error: null,
      appState: {
        ...get().appState,
        runtime: {
          status: 'working',
          currentStep: 'calling model',
          queuedTasks: 1,
          providerLabel: runtimeProviderLabel(settings)
        }
      }
    })
    try {
      const result = await api.generateLesson({
        workspaceId: workspace.id,
        prompt,
        courseName: suggestedCourseName(workspace, prompt),
        messages: lessonMessages
      })
      set({
        view: 'lessons',
        lessonReaderOpen: true,
        selectedCourseRelativePath: result.lesson.courseRelativePath,
        selectedCourseWorkspaceId: workspace.id,
        selectedCoursePreviewFile: lessonToCoursePreviewFile(result.lesson),
        appState: result.state,
        taskPrompt: nextPrompt,
        generating: false
      })
      if (settings.workspace.autoOpenGeneratedLesson) {
        void get().openPath(result.lesson.absolutePath)
      }
      if (settings.notifications.enabled && settings.notifications.lessonGenerated) {
        const suffix = result.source === 'fallback'
          ? (result.reason ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: result.reason }) : i18n.t('notify.lessonGenerated.fallbackNoReason'))
          : ''
        void get().showNotification(i18n.t('notify.lessonGenerated.title'), i18n.t('notify.lessonGenerated.body', { title: result.lesson.title, path: result.lesson.relativePath, suffix }))
      }
    } catch (error) {
      const userError = toUserError(error)
      set({
        generating: false,
        error: userError,
        appState: { ...get().appState, runtime: { ...defaultRuntime, status: 'error' } }
      })
      if (settings.notifications.enabled && settings.notifications.errors) {
        void get().showNotification(i18n.t('notify.generateFailed.title'), userError.message)
      }
    }
  },
  generateLessonStream: async (options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const prompt = (options?.prompt ?? get().taskPrompt).trim()
    const settings = get().settings
    if (!workspace || !prompt) return
    const lessonMessages = options?.messages ?? (
      activeTeachingConversationSummary({
        state: get().appState,
        workspaceId: workspace.id,
        activeConversationId: get().activeConversationId,
        pendingAgentConversation: get().pendingAgentConversation
      })
        ? agentTurnsToMessages(get().agentTurns)
        : []
    )
    if (
      settings.workspace.confirmBeforeGenerating &&
      !window.confirm(i18n.t('dialogs.confirmGenerate'))
    ) {
      return
    }
    set({
      generating: true,
      error: null,
      appState: {
        ...get().appState,
        runtime: {
          status: 'working',
          currentStep: 'calling model',
          queuedTasks: 1,
          providerLabel: runtimeProviderLabel(settings)
        }
      }
    })
    let liveText = ''
    try {
      const done = await api.generateLessonStream(
        {
          workspaceId: workspace.id,
          prompt,
          courseName: suggestedCourseName(workspace, prompt),
          messages: lessonMessages
        },
        (chunk: LessonStreamChunk) => {
          liveText += chunk.delta
          set({ appState: { ...get().appState, previewHtml: streamingPreviewHtml(liveText, workspace), previewUrl: '' } })
        },
        (status: LessonStreamStatus) => {
          set({
            appState: {
              ...get().appState,
              runtime: { ...get().appState.runtime, currentStep: stepLabel(status.step) }
            }
          })
        }
      )
      if ('error' in done && done.error) {
        const userError = toUserError(new Error(done.message))
        set({ generating: false, error: userError })
        if (settings.notifications.enabled && settings.notifications.errors) {
          void get().showNotification(i18n.t('notify.generateFailed.title'), userError.message)
        }
        return
      }
      if (!('error' in done) && done.kind === 'lesson') {
        set({
          view: 'lessons',
          lessonReaderOpen: true,
          selectedCourseRelativePath: done.lesson.courseRelativePath,
          selectedCourseWorkspaceId: workspace.id,
          selectedCoursePreviewFile: lessonToCoursePreviewFile(done.lesson),
          appState: done.state,
          taskPrompt: nextPrompt,
          generating: false
        })
        if (settings.workspace.autoOpenGeneratedLesson) {
          void get().openPath(done.lesson.absolutePath)
        }
        if (settings.notifications.enabled && settings.notifications.lessonGenerated) {
          const suffix = done.source === 'fallback'
            ? (done.reason ? i18n.t('notify.lessonGenerated.fallbackWithReason', { reason: done.reason }) : i18n.t('notify.lessonGenerated.fallbackNoReason'))
            : ''
          void get().showNotification(i18n.t('notify.lessonGenerated.title'), i18n.t('notify.lessonGenerated.body', { title: done.lesson.title, path: done.lesson.relativePath, suffix }))
        }
      }
    } catch (error) {
      const userError = toUserError(error)
      set({
        generating: false,
        error: userError,
        appState: { ...get().appState, runtime: { ...defaultRuntime, status: 'error' } }
      })
    }
  },
  loadAgentConversation: async (conversationId, workspaceId) => {
    const api = window.teachingSystem
    if (!api) return
    const requestedWorkspaceId = workspaceId ?? get().appState.activeWorkspace?.id ?? null
    const workspace = requestedWorkspaceId
      ? get().appState.workspaces.find((item) => item.id === requestedWorkspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    set({ error: null })
    try {
      const conversation = await api.readAgentConversation({ workspaceId: workspace.id, conversationId })
      const latestUserTurn = [...conversation.turns].reverse().find((turn) => turn.role === 'user')
      const conversationCourseRelativePath = courseRelativePathForAgentConversation(conversation.relativePath)
      const isTeachingConversation = Boolean(conversationCourseRelativePath)
      set({
        appState: workspace.id === get().appState.activeWorkspace?.id
          ? get().appState
          : await api.selectWorkspace(workspace.id),
        view: isTeachingConversation ? 'overview' : 'agent',
        overviewDialogMode: isTeachingConversation ? 'teaching' : get().overviewDialogMode,
        lessonReaderOpen: false,
        selectedCoursePreviewFile: null,
        agentTurns: conversation.turns,
        activeConversationId: conversation.id,
        agentStatus: '',
        agentToolsSupported: null,
        agentInput: '',
        selectedCourseRelativePath: conversationCourseRelativePath,
        selectedCourseWorkspaceId: conversationCourseRelativePath ? workspace.id : null,
        taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : get().taskPrompt
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  agentChat: async (inputOverride, options) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    const input = (inputOverride ?? get().agentInput).trim()
    if (!workspace || !input || get().agentChatBusy) return
    const mode: AgentChatMode = options?.mode ?? (get().overviewDialogMode === 'teaching' ? 'teaching' : 'temporary')
    const draft = createAgentConversationTurnDraft({
      state: get().appState,
      workspace,
      input,
      mode,
      activeConversationId: get().activeConversationId,
      currentTurns: get().agentTurns,
      selectedCourseRelativePath: get().selectedCourseRelativePath,
      currentSelectedLessonPath: get().appState.selectedLessonPath,
      createdAt: new Date().toISOString(),
      idSeed: Date.now()
    })
    const {
      pendingConversationId,
      sourceConversationId,
      selectedCourseRelativePath,
      selectedLessonPath,
      assistantId,
      priorMessages,
      initialTurns,
      pendingConversation
    } = draft
    set({
      agentChatBusy: true,
      agentInput: '',
      agentStatus: pendingConversation.status,
      agentToolsSupported: null,
      agentTurns: initialTurns,
      activeConversationId: pendingConversationId,
      pendingAgentConversation: pendingConversation
    })
    try {
      const done = await api.agentChatStream(
        { streamId: pendingConversationId, workspaceId: workspace.id, mode, messages: priorMessages, userInput: input },
        (chunk: AgentChatStreamChunk) => {
          const patch = applyAgentChatChunkToPending({
            pending: get().pendingAgentConversation,
            activeConversationId: get().activeConversationId,
            assistantId,
            chunk
          })
          if (patch) set(patch)
        },
        (status: AgentChatStreamStatus) => {
          const patch = applyAgentChatStatusToPending({
            pending: get().pendingAgentConversation,
            activeConversationId: get().activeConversationId,
            assistantId,
            status
          })
          if (patch) set(patch)
        },
        (event: AgentChatStreamToolEvent) => {
          const patch = applyAgentChatToolEventToPending({
            pending: get().pendingAgentConversation,
            activeConversationId: get().activeConversationId,
            assistantId,
            event
          })
          if (patch) set(patch)
        }
      )
      if ('canceled' in done) {
        const pending = get().pendingAgentConversation
        if (!pending || pending.summary.id !== pendingConversationId) return
        set(cancelPendingAgentConversation({ pending, activeConversationId: get().activeConversationId }))
        return
      }
      if ('error' in done && done.error) {
        const pending = get().pendingAgentConversation
        if (!pending || pending.summary.id !== pendingConversationId) return
        const userError = toUserError(new Error(done.message))
        set({
          error: userError,
          ...failPendingAgentConversation({
            pending,
            activeConversationId: get().activeConversationId,
            assistantId
          })
        })
        return
      }
      if (!('error' in done)) {
        const pending = get().pendingAgentConversation
        if (!pending || pending.summary.id !== pendingConversationId) return
        const latestUserTurn = [...done.turns].reverse().find((turn) => turn.role === 'user')
        const reconciledTurns = reconcileAgentTurnsWithLocalProcess(done.turns, pending.turns)
        const savePatch = syncPendingAgentConversation({
          pending,
          pendingConversationId,
          activeConversationId: get().activeConversationId,
          patch: {
            turns: reconciledTurns,
            status: '保存对话…',
            toolsSupported: done.toolsSupported
          }
        })
        if (savePatch) set(savePatch)
        set({
          taskPrompt: latestUserTurn?.content?.trim() ? latestUserTurn.content.trim() : get().taskPrompt
        })
        try {
          const saved = await api.saveAgentConversation({
            workspaceId: workspace.id,
            mode,
            conversationId: pending?.sourceConversationId ?? null,
            selectedLessonPath,
            selectedCourseRelativePath,
            turns: reconciledTurns
          })
          set({
            appState: saved.state,
            ...finishPendingAgentConversationSave({
              pending,
              activeConversationId: get().activeConversationId,
              savedConversationId: saved.conversation.id,
              turns: reconciledTurns,
              toolsSupported: done.toolsSupported
            })
          })
          // Lessons generated inside the conversation (generate_lesson tool):
          // saved.state already contains them; mirror the direct-generation
          // notifications and auto-open behavior without yanking the user
          // away from the conversation.
          const generatedLessons = done.generatedLessons ?? []
          if (generatedLessons.length > 0) {
            const settings = get().settings
            const latest = generatedLessons[generatedLessons.length - 1]
            if (latest && settings.workspace.autoOpenGeneratedLesson) {
              void get().openPath(latest.absolutePath)
            }
            if (latest && settings.notifications.enabled && settings.notifications.lessonGenerated) {
              void get().showNotification(
                i18n.t('notify.lessonGenerated.title'),
                i18n.t('notify.lessonGenerated.body', { title: latest.title, path: latest.relativePath, suffix: '' })
              )
            }
          }
        } catch (saveError) {
          set({ error: toUserError(saveError) })
        } finally {
          if (get().pendingAgentConversation?.summary.id && get().pendingAgentConversation?.summary.id !== pendingConversationId) return
          const visiblePatch = get().activeConversationId === pendingConversationId
            ? { agentStatus: '' }
            : {}
          set({ agentChatBusy: false, ...visiblePatch })
        }
      }
    } catch (error) {
      const pending = get().pendingAgentConversation
      if (!pending || pending.summary.id !== pendingConversationId) return
      const userError = toUserError(error)
      set({
        error: userError,
        ...failPendingAgentConversation({
          pending,
          activeConversationId: get().activeConversationId,
          assistantId
        })
      })
    }
  },
  setWorkspaceItemMeta: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = payload.workspaceId
      ? get().appState.workspaces.find((item) => item.id === payload.workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    try {
      const state = await api.setWorkspaceItemMeta({
        workspaceId: workspace.id,
        relativePath: payload.relativePath,
        pinned: payload.pinned,
        archived: payload.archived
      })
      const archivesWorkspaceRoot = normalizeRelativePath(payload.relativePath) === '' && payload.archived === true
      const clearsCurrentContext =
        archivesWorkspaceRoot &&
        (get().appState.activeWorkspace?.id === workspace.id ||
          get().selectedCourseWorkspaceId === workspace.id ||
          get().pendingAgentConversation?.workspaceId === workspace.id)
      set({
        appState: state,
        error: null,
        ...(clearsCurrentContext
          ? {
              lessonReaderOpen: false,
              selectedCoursePreviewFile: null,
              selectedCourseRelativePath: null,
              selectedCourseWorkspaceId: null,
              taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
              agentTurns: [],
              activeConversationId: null,
              agentStatus: '',
              agentInput: '',
              agentToolsSupported: null,
              agentChatBusy: false,
              pendingAgentConversation: null,
            }
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  removeWorkspaceItem: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = payload.workspaceId
      ? get().appState.workspaces.find((item) => item.id === payload.workspaceId) ?? get().appState.activeWorkspace
      : get().appState.activeWorkspace
    if (!workspace) return
    const removalSnapshot = {
      activeConversationId: get().activeConversationId,
      selectedCoursePreviewFile: get().selectedCoursePreviewFile,
      selectedCourseRelativePath: get().selectedCourseRelativePath
    }
    try {
      const state = await api.removeWorkspaceItem({
        workspaceId: workspace.id,
        relativePath: payload.relativePath,
        kind: payload.kind,
        mode: payload.mode ?? 'disk'
      })
      const uiPatch = deriveWorkspaceRemovalUiPatch(payload, removalSnapshot, state)
      set({
        appState: state,
        error: null,
        ...(uiPatch.clearActiveConversation
          ? { agentTurns: [], activeConversationId: null, agentStatus: '', agentInput: '', agentToolsSupported: null, agentChatBusy: false, pendingAgentConversation: null }
          : {}),
        ...(uiPatch.clearSelectedCoursePreview
          ? { lessonReaderOpen: false, selectedCoursePreviewFile: null }
          : {}),
        ...(uiPatch.clearSelectedCourseFolder
          ? { selectedCourseRelativePath: null, selectedCourseWorkspaceId: null }
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  removeWorkspace: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.workspaces.find((item) => item.id === payload.workspaceId)
    if (!workspace) return
    const previous = get()
    const clearsCurrentContext =
      previous.appState.activeWorkspace?.id === workspace.id ||
      previous.selectedCourseWorkspaceId === workspace.id ||
      previous.pendingAgentConversation?.workspaceId === workspace.id
    try {
      const state = await api.removeWorkspace({
        workspaceId: workspace.id,
        mode: payload.mode ?? 'disk'
      })
      set({
        appState: state,
        error: null,
        ...(clearsCurrentContext
          ? {
              view: state.activeWorkspace ? previous.view : 'overview',
              lessonReaderOpen: false,
              selectedCoursePreviewFile: null,
              selectedCourseRelativePath: null,
              selectedCourseWorkspaceId: null,
              taskPrompt: state.activeWorkspace?.lessons.length ? nextPrompt : defaultPrompt,
              agentTurns: [],
              activeConversationId: null,
              agentStatus: '',
              agentInput: '',
              agentToolsSupported: null,
              agentChatBusy: false,
              pendingAgentConversation: null,
            }
          : {})
      })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadLesson: async (lesson) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    set({
      view: 'lessons',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: true,
      selectedCoursePreviewFile: lessonToCoursePreviewFile(lesson),
      selectedResourcePreviewFile: null,
      appState: {
        ...get().appState,
        selectedLessonPath: lesson.absolutePath,
        previewHtml: loadingPreviewHtml(workspace),
        previewUrl: ''
      },
      selectedCourseRelativePath: lesson.courseRelativePath,
      selectedCourseWorkspaceId: workspace.id
    })
    try {
      const result = await api.readLesson({
        workspaceId: workspace.id,
        lessonPath: lesson.absolutePath
      })
      set({ appState: { ...get().appState, selectedLessonPath: lesson.absolutePath, previewHtml: result.html, previewUrl: result.url } })
    } catch (error) {
      set({ error: toUserError(error), appState: { ...get().appState, previewHtml: emptyPreviewHtml(workspace), previewUrl: '' } })
    }
  },
  loadCourseHtmlFile: async (file) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    set({
      view: 'lessons',
      overviewDialogMode: 'teaching',
      lessonReaderOpen: true,
      selectedCoursePreviewFile: file,
      selectedResourcePreviewFile: null,
      appState: {
        ...get().appState,
        selectedLessonPath: file.absolutePath,
        previewHtml: loadingPreviewHtml(workspace),
        previewUrl: ''
      },
      selectedCourseRelativePath: courseRelativePathForFile(file.relativePath),
      selectedCourseWorkspaceId: workspace.id
    })
    try {
      const result = await api.readLesson({
        workspaceId: workspace.id,
        lessonPath: file.absolutePath
      })
      set({
        appState: { ...get().appState, selectedLessonPath: file.absolutePath, previewHtml: result.html, previewUrl: result.url },
        selectedCoursePreviewFile: file
      })
    } catch (error) {
      set({ error: toUserError(error), appState: { ...get().appState, previewHtml: emptyPreviewHtml(workspace), previewUrl: '' } })
    }
  },
  openResourceHtmlPreview: (selectedResourcePreviewFile) => {
    set({
      view: 'resources',
      lessonReaderOpen: false,
      selectedCoursePreviewFile: null,
      selectedResourcePreviewFile
    })
  },
  closeResourceHtmlPreview: () => set({ selectedResourcePreviewFile: null }),
  openPath: async (path) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.openPath(path)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? i18n.t('errors.openPath'))) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  openExternal: async (url) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.openExternal(url)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? i18n.t('errors.openExternal'))) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  showNotification: async (title, body) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      await api.showNotification({ title, body })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  probeProvider: async (payload) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'TeachOS preload API unavailable.' }
    try {
      return await api.probeProvider(payload)
    } catch (error) {
      return { ok: false, message: toUserError(error).message }
    }
  },
  listUpstreamModels: async (payload) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, message: 'TeachOS preload API unavailable.' }
    try {
      return await api.listUpstreamModels(payload)
    } catch (error) {
      return { ok: false, message: toUserError(error).message }
    }
  },
  listGitWorktrees: async (workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return { ok: false, reason: 'error', message: 'TeachOS preload API unavailable.' }
    try {
      return await api.listGitWorktrees(workspaceRoot)
    } catch (error) {
      return { ok: false, reason: 'error', message: toUserError(error).message }
    }
  },
  removeGitWorktree: async (payload) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const result = await api.removeGitWorktree(payload)
      if (!result.ok) {
        set({ error: toUserError(new Error(result.message ?? 'Failed to remove worktree.')) })
      }
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  listMemory: async (workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const memoryRecords = await api.listMemory(workspaceRoot)
      set({ memoryRecords })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  createMemory: async (payload) => {
    const api = window.teachingSystem
    if (!api) return false
    try {
      const memory = await api.createMemory(payload)
      set((state) => ({ memoryRecords: [memory, ...state.memoryRecords.filter((item) => item.id !== memory.id)] }))
      void get().loadMemoryDiagnostics()
      return true
    } catch (error) {
      set({ error: toUserError(error) })
      return false
    }
  },
  updateMemory: async (memoryId, patch) => {
    const api = window.teachingSystem
    if (!api) return false
    try {
      const memory = await api.updateMemory(memoryId, patch)
      set((state) => ({
        memoryRecords: state.memoryRecords.map((item) => (item.id === memoryId ? memory : item))
      }))
      void get().loadMemoryDiagnostics()
      return true
    } catch (error) {
      set({ error: toUserError(error) })
      return false
    }
  },
  deleteMemory: async (memoryId, workspaceRoot) => {
    const api = window.teachingSystem
    if (!api) return
    try {
      await api.deleteMemory(memoryId, workspaceRoot)
      set((state) => ({ memoryRecords: state.memoryRecords.filter((item) => item.id !== memoryId) }))
      void get().loadMemoryDiagnostics()
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadMemoryDiagnostics: async () => {
    const api = window.teachingSystem
    if (!api) return
    try {
      const memoryDiagnostics = await api.getMemoryDiagnostics()
      set({ memoryDiagnostics })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  },
  loadReviewCards: async () => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) {
      set({ reviewCards: [] })
      return
    }
    try {
      const result = await api.listReviewCards(workspace.id)
      set({ reviewCards: result.cards })
      void api.getProgress(workspace.id).then((res) => set({ progress: res.progress })).catch(() => {})
    } catch (error) {
      set({ error: toUserError(error), reviewCards: [] })
    }
  },
  recordProgress: async (lessonId, results) => {
    const api = window.teachingSystem
    if (!api) return
    const workspace = get().appState.activeWorkspace
    if (!workspace) return
    try {
      const res = await api.recordProgress({ workspaceId: workspace.id, lessonId, results })
      set({ progress: res.progress })
    } catch (error) {
      set({ error: toUserError(error) })
    }
  }
}))

// ================================================================
// Main App Component
// ================================================================

const DEFAULT_SIDEBAR_WIDTH = 232
const MIN_SIDEBAR_WIDTH = 176
const MAX_SIDEBAR_WIDTH = 340

function App() {
  const platform = window.teachingSystem?.platform ?? 'win32'
  const isMac = platform === 'darwin'
  const showTitlebar = !isMac
  const { settings, sidebarCollapsed } = useAppStore()
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const appShellStyle = { '--sidebar-width': `${sidebarWidth}px` } as CSSProperties

  useEffect(() => {
    applySettingsSideEffects(settings)
    if (settings.theme !== 'system' || typeof window.matchMedia !== 'function') return

    const themeMedia = window.matchMedia(DARK_THEME_MEDIA_QUERY)
    const handleThemeChange = (): void => applySettingsSideEffects(settings)
    themeMedia.addEventListener('change', handleThemeChange)
    return () => themeMedia.removeEventListener('change', handleThemeChange)
  }, [settings])

  return (
    <AppErrorBoundary>
      <div className="app-frame">
        {showTitlebar && <WindowTitlebar />}
        <div
          className={`app-shell${isMac ? ' platform-darwin' : ''}${sidebarCollapsed ? ' is-sidebar-collapsed' : ''}`}
          data-density={settings.density}
          style={appShellStyle}
        >
          {isMac && <MacTrafficLights />}
          <Sidebar />
          <SidebarResizer disabled={sidebarCollapsed} onResize={setSidebarWidth} width={sidebarWidth} />
          <MainArea />
        </div>
      </div>
    </AppErrorBoundary>
  )
}

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

function SidebarResizer({
  disabled,
  onResize,
  width
}: {
  disabled: boolean
  onResize: (width: number) => void
  width: number
}) {
  const { t } = useTranslation()
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return

    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      onResize(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    }

    const finishResize = (): void => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishResize)
      window.removeEventListener('pointercancel', finishResize)
      document.body.classList.remove('is-sidebar-resizing')
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }

    document.body.classList.add('is-sidebar-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishResize)
    window.addEventListener('pointercancel', finishResize)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onResize(clampSidebarWidth(width - 12))
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      onResize(clampSidebarWidth(width + 12))
    }
  }

  return (
    <div
      aria-label={t('sidebarResizer.aria')}
      aria-orientation="vertical"
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuenow={width}
      className={`sidebar-resizer${disabled ? ' is-disabled' : ''}`}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      role="separator"
      tabIndex={disabled ? -1 : 0}
    />
  )
}

// ================================================================
// Window Titlebar (Windows / Linux)
// ================================================================

function WindowTitlebar() {
  const { t } = useTranslation()
  const controlWindow = (action: WindowControlAction): void => {
    void window.teachingSystem?.controlWindow(action)
  }

  return (
    <div className="window-titlebar" role="group" aria-label={t('titlebar.group')}>
      <div className="window-controls">
        <button
          className="window-control-btn"
          type="button"
          aria-label={t('titlebar.minimize')}
          title={t('titlebar.minimize')}
          onClick={() => controlWindow('minimize')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="window-control-btn"
          type="button"
          aria-label={t('titlebar.maximize')}
          title={t('titlebar.maximize')}
          onClick={() => controlWindow('toggle-maximize')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          className="window-control-btn window-control-btn--close"
          type="button"
          aria-label={t('titlebar.close')}
          title={t('titlebar.close')}
          onClick={() => controlWindow('close')}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ================================================================
// Mac Traffic Lights Overlay
// ================================================================

function MacTrafficLights() {
  const { t } = useTranslation()
  const controlWindow = (action: WindowControlAction): void => {
    void window.teachingSystem?.controlWindow(action)
  }

  return (
    <div className="mac-traffic-lights" role="group" aria-label={t('titlebar.group')}>
      <button
        className="mac-traffic-light mac-traffic-light--close"
        type="button"
        aria-label={t('titlebar.close')}
        title={t('titlebar.close')}
        onClick={() => controlWindow('close')}
      />
      <button
        className="mac-traffic-light mac-traffic-light--minimize"
        type="button"
        aria-label={t('titlebar.minimize')}
        title={t('titlebar.minimize')}
        onClick={() => controlWindow('minimize')}
      />
      <button
        className="mac-traffic-light mac-traffic-light--maximize"
        type="button"
        aria-label={t('titlebar.maximize')}
        title={t('titlebar.maximize')}
        onClick={() => controlWindow('toggle-maximize')}
      />
    </div>
  )
}

// ================================================================
// Sidebar
// ================================================================

function Sidebar() {
  const { t } = useTranslation()
  const {
    view,
    sidebarCollapsed,
    settings,
    appState,
    setView,
    openSettings,
    showNotification
  } = useAppStore()

  const active = appState.activeWorkspace
  const selectedLessonPath = appState.selectedLessonPath
  const lessonReaderOpen = useAppStore((s) => s.lessonReaderOpen)
  const [coursesExpanded, setCoursesExpanded] = useState(true)
  const [conversationsExpanded, setConversationsExpanded] = useState(true)

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} aria-label={t('sidebar.aria')}>
      <nav className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'is-active' : ''}`}
              type="button"
              onClick={() => {
                if (item.id === 'overview') {
                  useAppStore.getState().setOverviewDialogMode('teaching')
                  useAppStore.getState().clearAgentChat()
                  useAppStore.setState({
                    selectedCourseRelativePath: null,
                    selectedCourseWorkspaceId: null,
                    lessonReaderOpen: false,
                    selectedCoursePreviewFile: null,
                    selectedResourcePreviewFile: null
                  })
                }
                if (item.id === 'resources') {
                  useAppStore.getState().closeResourceHtmlPreview()
                }
                setView(item.id)
              }}
            >
              <Icon size={17} />
              <span className="collapsible-label">{t(`nav.${item.id}`)}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar-content">
        <WorkspaceCourseSection
          workspaces={appState.workspaces}
          activeWorkspaceId={active?.id ?? null}
          expanded={coursesExpanded}
          selectedLessonPath={view === 'lessons' && lessonReaderOpen ? selectedLessonPath : null}
          onToggle={() => setCoursesExpanded((expanded) => !expanded)}
        />
        <SidebarConversationSection
          workspace={active}
          conversations={appState.temporaryConversations}
          expanded={conversationsExpanded}
          onToggle={() => setConversationsExpanded((expanded) => !expanded)}
        />
      </div>

      <div className="sidebar-footer">
        <button className="avatar-button" type="button" onClick={() => openSettings('general')}>
          <span className="avatar">C</span>
        </button>
        <button
          className={`icon-button${settings.notifications.enabled ? '' : ' is-muted'}`}
          type="button"
          aria-label={t('sidebar.notifications')}
          onClick={() => {
            openSettings('notifications')
            void showNotification(t('sidebar.notificationCenterTitle'), settings.notifications.enabled ? t('sidebar.notificationCenterOn') : t('sidebar.notificationCenterOff'))
          }}
          title={t('sidebar.notifications')}
        >
          <Bell size={16} />
        </button>
        <button className="icon-button" type="button" aria-label={t('sidebar.settings')} onClick={() => openSettings('model')} title={t('sidebar.settings')}>
          <Settings size={16} />
        </button>
      </div>
    </aside>
  )
}

function WorkspaceCourseSection({
  workspaces,
  activeWorkspaceId,
  expanded,
  selectedLessonPath,
  onToggle
}: {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspaceId: string | null
  expanded: boolean
  selectedLessonPath: string | null
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const selectWorkspace = useAppStore((s) => s.selectWorkspace)
  const loadLesson = useAppStore((s) => s.loadLesson)
  const loadCourseHtmlFile = useAppStore((s) => s.loadCourseHtmlFile)
  const loadAgentConversation = useAppStore((s) => s.loadAgentConversation)
  const view = useAppStore((s) => s.view)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const openPath = useAppStore((s) => s.openPath)
  const selectCourseFolder = useAppStore((s) => s.selectCourseFolder)
  const showAllCourseFiles = useAppStore((s) => s.settings.workspace.showAllCourseFiles)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const workspacesWithPending = useMemo(
    () => withPendingCourseConversation(workspaces, pendingAgentConversation),
    [pendingAgentConversation, workspaces]
  )
  const workspaceFolders = useMemo(
    () => listSidebarWorkspaceFolders(workspacesWithPending, showAllCourseFiles),
    [showAllCourseFiles, workspacesWithPending]
  )
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  useEffect(() => {
    if (!expanded) setExpandedPaths(new Set())
  }, [expanded])

  const togglePath = (workspaceId: string, relativePath: string): void => {
    const key = workspaceNodeKey(workspaceId, relativePath)
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const ensureWorkspaceSelected = async (workspaceId: string): Promise<void> => {
    if (workspaceId !== activeWorkspaceId) {
      await selectWorkspace(workspaceId)
    }
  }

  return (
    <>
      <div className="sidebar-section sidebar-section--courses">
        <div className="section-heading section-heading--folder">
          <button
            className="section-folder-button"
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? t('sidebar.collapseCourses') : t('sidebar.expandCourses')}
            title={expanded ? t('sidebar.collapseCourses') : t('sidebar.expandCourses')}
            onClick={onToggle}
          >
            <span className="collapsible-label">{t('sidebar.courses')}</span>
            <span className="section-folder-chevron" aria-hidden="true">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
          <button
            className="section-add-button"
            type="button"
            aria-label={t('sidebar.addCourseProject')}
            title={t('sidebar.addCourseProject')}
            onClick={(event) => {
              event.stopPropagation()
              setImportDialogOpen(true)
            }}
          >
            <Plus size={14} />
          </button>
        </div>
        <div
          className={`sidebar-disclosure${expanded ? ' is-open' : ''}`}
          aria-hidden={!expanded}
          inert={!expanded ? true : undefined}
        >
          <div className="sidebar-disclosure-inner">
            {workspaceFolders.length > 0 ? (
              <div className="workspace-file-tree workspace-file-tree--courses" role="tree">
                {workspaceFolders.map(({ workspace, node }) => (
                  <WorkspaceFileNodeRow
                    key={workspaceNodeKey(workspace.id, node.relativePath)}
                    node={node}
                    workspace={workspace}
                    level={0}
                    treeRoot="courses"
                    expandedPaths={expandedPaths}
                    selectedLessonPath={selectedLessonPath}
                    activeConversationId={view === 'agent' ? activeConversationId : null}
                    onToggle={togglePath}
                    onEnsureWorkspaceSelected={() => ensureWorkspaceSelected(workspace.id)}
                    onOpenPath={(path) => void openPath(path)}
                    onOpenHtmlFile={(file) => void loadCourseHtmlFile(file)}
                    onOpenCourse={(relativePath) => selectCourseFolder(relativePath, workspace.id)}
                    onOpenLesson={(lesson) => {
                      void loadLesson(lesson)
                    }}
                    onOpenConversation={(conversationId) => void loadAgentConversation(conversationId, workspace.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="workspace-conversation-empty">{t('sidebar.emptyCourses')}</div>
            )}
          </div>
        </div>
      </div>
      {importDialogOpen ? <ImportWorkspaceDialog onClose={() => setImportDialogOpen(false)} /> : null}
    </>
  )
}

function ImportWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const titleId = useId()
  const settings = useAppStore((s) => s.settings)
  const activeWorkspace = useAppStore((s) => s.appState.activeWorkspace)
  const loading = useAppStore((s) => s.loading)
  const importWorkspace = useAppStore((s) => s.importWorkspace)
  const importWorkspacePath = useAppStore((s) => s.importWorkspacePath)
  const openImportLocation = useAppStore((s) => s.openImportLocation)
  const [path, setPath] = useState(settings.workspace.defaultRoot || activeWorkspace?.rootPath || '')

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const handleChoose = async (): Promise<void> => {
    if (await importWorkspace()) onClose()
  }

  const handleImportPath = async (): Promise<void> => {
    if (await importWorkspacePath(path)) onClose()
  }

  const handleOpenManager = (): void => {
    void openImportLocation(path.trim() || undefined)
  }

  return createPortal(
    <div
      className="import-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="import-dialog-header">
          <div>
            <span>{t('workspaceImport.eyebrow')}</span>
            <h2 id={titleId}>{t('workspaceImport.title')}</h2>
          </div>
          <button type="button" className="settings-close-button" onClick={onClose} aria-label={t('workspaceImport.close')}>
            <X size={16} />
          </button>
        </div>
        <label className="import-dialog-field">
          <span>{t('workspaceImport.pathLabel')}</span>
          <input
            autoFocus
            type="text"
            value={path}
            placeholder={t('workspaceImport.pathPlaceholder')}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void handleImportPath()
              }
            }}
          />
        </label>
        <div className="import-dialog-tools">
          <button type="button" className="ghost-button" onClick={() => void handleChoose()} disabled={loading}>
            <FolderOpen size={15} />
            {t('workspaceImport.choose')}
          </button>
          <button type="button" className="ghost-button" onClick={handleOpenManager} disabled={loading}>
            <ArrowUpRight size={15} />
            {t('workspaceImport.manage')}
          </button>
        </div>
        <div className="import-dialog-footer">
          <button type="button" className="ghost-button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="primary-button" onClick={() => void handleImportPath()} disabled={loading || !path.trim()}>
            <Upload size={15} />
            {t('workspaceImport.import')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}

function SidebarConversationSection({
  workspace,
  conversations,
  expanded,
  onToggle
}: {
  workspace: TeachingWorkspaceSummary | null
  conversations: AgentConversationSummary[]
  expanded: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const loadAgentConversation = useAppStore((s) => s.loadAgentConversation)
  const restorePendingAgentConversation = useAppStore((s) => s.restorePendingAgentConversation)
  const view = useAppStore((s) => s.view)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const storedPendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const pendingAgentConversation = storedPendingAgentConversation &&
    storedPendingAgentConversation.workspaceId === workspace?.id &&
    !isCourseAgentConversationPath(storedPendingAgentConversation.summary.relativePath)
    ? storedPendingAgentConversation
    : null
  const conversationsWithPending: SidebarConversationSummary[] = pendingAgentConversation ? [pendingAgentConversation.summary, ...conversations.filter((conversation) => !sameRelativePath(conversation.relativePath, pendingAgentConversation.summary.relativePath))] : conversations
  const ensureActiveWorkspace = async (): Promise<void> => {}

  return (
    <div className="sidebar-section sidebar-section--conversations" aria-label={t('sidebar.conversations')}>
      <div className="section-heading section-heading--folder sidebar-conversation-heading">
        <button
          className="section-folder-button"
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? t('sidebar.collapseConversations') : t('sidebar.expandConversations')}
          title={expanded ? t('sidebar.collapseConversations') : t('sidebar.expandConversations')}
          onClick={onToggle}
        >
          <span className="collapsible-label">{t('sidebar.conversations')}</span>
          <span className="section-folder-chevron" aria-hidden="true">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </button>
      </div>
      <div
        className={`sidebar-disclosure${expanded ? ' is-open' : ''}`}
        aria-hidden={!expanded}
        inert={!expanded ? true : undefined}
      >
        <div className="sidebar-disclosure-inner">
          <div className="workspace-conversation-list is-flat">
            {conversationsWithPending.length === 0 ? (
              <div className="workspace-conversation-empty">{t('sidebar.emptyConversations')}</div>
            ) : (
              conversationsWithPending.map((conversation) => (
                <ConversationListRow
                  key={conversation.id}
                  conversation={conversation}
                  isActiveConversation={view === 'agent' && conversation.id === activeConversationId}
                  onEnsureSelected={ensureActiveWorkspace}
                  onOpen={() => conversation.pending ? restorePendingAgentConversation() : void loadAgentConversation(conversation.id, conversation.workspaceId)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type RowContextMenuPoint = { left: number; top: number }

const ROW_CONTEXT_MENU_EDGE_GAP = 8
const ROW_CONTEXT_MENU_MIN_WIDTH = 164
const ROW_CONTEXT_MENU_ESTIMATED_HEIGHT = 118

function clampRowContextMenuPoint(left: number, top: number, width: number, height: number): RowContextMenuPoint {
  return {
    left: Math.min(Math.max(ROW_CONTEXT_MENU_EDGE_GAP, left), Math.max(ROW_CONTEXT_MENU_EDGE_GAP, window.innerWidth - width - ROW_CONTEXT_MENU_EDGE_GAP)),
    top: Math.min(Math.max(ROW_CONTEXT_MENU_EDGE_GAP, top), Math.max(ROW_CONTEXT_MENU_EDGE_GAP, window.innerHeight - height - ROW_CONTEXT_MENU_EDGE_GAP))
  }
}

function sameRowContextMenuPoint(left: RowContextMenuPoint, right: RowContextMenuPoint): boolean {
  return Math.abs(left.left - right.left) < 0.5 && Math.abs(left.top - right.top) < 0.5
}

function RowContextMenu({
  pinned,
  onTogglePin,
  onArchive,
  onRemove,
  showPin = true,
  showArchive = true
}: {
  pinned: boolean
  onTogglePin: () => void
  onArchive: () => void
  onRemove: () => void
  showPin?: boolean
  showArchive?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [menuPoint, setMenuPoint] = useState<RowContextMenuPoint | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const close = (): void => setOpen(false)
  const openMenu = (trigger: HTMLButtonElement): void => {
    const rect = trigger.getBoundingClientRect()
    setMenuPoint(
      clampRowContextMenuPoint(
        rect.right - ROW_CONTEXT_MENU_MIN_WIDTH,
        rect.bottom + 6,
        ROW_CONTEXT_MENU_MIN_WIDTH,
        ROW_CONTEXT_MENU_ESTIMATED_HEIGHT
      )
    )
    setOpen(true)
  }
  const run = (action: () => void): void => {
    close()
    action()
  }

  useLayoutEffect(() => {
    if (!open || !menuPoint) return
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextPoint = clampRowContextMenuPoint(menuPoint.left, menuPoint.top, rect.width, rect.height)
    setMenuPoint((current) => {
      if (!current) return nextPoint
      if (sameRowContextMenuPoint(current, nextPoint)) return current
      return nextPoint
    })
  }, [menuPoint, open])

  useEffect(() => {
    if (!open) return

    const closeMenu = (): void => setOpen(false)
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeMenu()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [open])

  return (
    <div ref={wrapRef} className={`row-context-menu${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="row-context-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('sidebar.rowActions')}
        title={t('sidebar.rowActions')}
        onClick={(event) => {
          event.stopPropagation()
          if (open) close()
          else openMenu(event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && menuPoint ? createPortal(
        <div
          ref={menuRef}
          className="row-context-menu-dropdown"
          role="menu"
          style={{ left: menuPoint.left, top: menuPoint.top, minWidth: ROW_CONTEXT_MENU_MIN_WIDTH }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          {showPin ? (
            <button type="button" role="menuitem" className="row-context-menu-item" onClick={() => run(onTogglePin)}>
              {pinned ? <PinOff size={13} /> : <Pin size={13} />}
              <span>{pinned ? t('sidebar.unpin') : t('sidebar.pin')}</span>
            </button>
          ) : null}
          {showArchive ? (
            <button type="button" role="menuitem" className="row-context-menu-item" onClick={() => run(onArchive)}>
              <Archive size={13} />
              <span>{t('sidebar.archive')}</span>
            </button>
          ) : null}
          {showPin || showArchive ? <div className="row-context-menu-separator" role="separator" /> : null}
          <button type="button" role="menuitem" className="row-context-menu-item is-danger" onClick={() => run(onRemove)}>
            <Trash2 size={13} />
            <span>{t('sidebar.remove')}</span>
          </button>
        </div>,
        document.body
      ) : null}
    </div>
  )
}

function RemoveWorkspaceItemDialog({
  itemName,
  itemKind,
  onClose,
  onRemoveFromList,
  onRemoveFromDisk
}: {
  itemName: string
  itemKind: WorkspaceItemKind
  onClose: () => void
  onRemoveFromList: () => void
  onRemoveFromDisk: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  const kindLabel = itemKind === 'conversation'
    ? t('sidebar.removeDialog.kindConversation')
    : itemKind === 'directory'
      ? t('sidebar.removeDialog.kindFolder')
    : t('sidebar.removeDialog.kindFile')

  return createPortal(
    <div
      className="remove-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="remove-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="remove-dialog-header">
          <span className="remove-dialog-icon" aria-hidden="true">
            <AlertTriangle size={18} />
          </span>
          <div>
            <span>{kindLabel}</span>
            <h2 id={titleId}>{t('sidebar.removeDialog.title', { name: itemName })}</h2>
          </div>
          <button type="button" className="settings-close-button" onClick={onClose} aria-label={t('sidebar.removeDialog.close')}>
            <X size={16} />
          </button>
        </div>
        <p id={descriptionId} className="remove-dialog-detail">
          {t('sidebar.removeDialog.detail')}
        </p>
        <div className="remove-dialog-options">
          <button type="button" className="remove-dialog-option" onClick={onRemoveFromList}>
            <span className="remove-dialog-option-icon">
              <Archive size={17} />
            </span>
            <span>
              <strong>{t('sidebar.removeDialog.listTitle')}</strong>
              <small>{t('sidebar.removeDialog.listDetail')}</small>
            </span>
          </button>
          <button type="button" className="remove-dialog-option is-danger" onClick={onRemoveFromDisk}>
            <span className="remove-dialog-option-icon">
              <Trash2 size={17} />
            </span>
            <span>
              <strong>{t('sidebar.removeDialog.diskTitle')}</strong>
              <small>{t('sidebar.removeDialog.diskDetail')}</small>
            </span>
          </button>
        </div>
        <div className="remove-dialog-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </section>
    </div>,
    document.body
  )
}

function ConversationListRow({
  conversation,
  isActiveConversation,
  onOpen,
  onEnsureSelected
}: {
  conversation: SidebarConversationSummary
  isActiveConversation: boolean
  onOpen: () => void
  onEnsureSelected: () => Promise<void>
}) {
  const { t } = useTranslation()
  const setWorkspaceItemMeta = useAppStore((s) => s.setWorkspaceItemMeta)
  const removeWorkspaceItem = useAppStore((s) => s.removeWorkspaceItem)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)

  const handlePin = async (): Promise<void> => {
    await onEnsureSelected()
    void setWorkspaceItemMeta({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, pinned: !conversation.pinned })
  }
  const handleArchive = async (): Promise<void> => {
    await onEnsureSelected()
    void setWorkspaceItemMeta({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, archived: true })
  }
  const handleRemoveFromList = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    await onEnsureSelected()
    void removeWorkspaceItem({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, kind: 'conversation', mode: 'list' })
  }
  const handleRemoveFromDisk = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    await onEnsureSelected()
    void removeWorkspaceItem({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, kind: 'conversation', mode: 'disk' })
  }

  return (
    <div
      className={`workspace-conversation-row ${isActiveConversation ? 'is-selected' : ''}${conversation.pending ? ' is-pending' : ''}`}
      title={conversation.absolutePath}
    >
      <button type="button" className="workspace-conversation-main" onClick={onOpen}>
        {conversation.pending ? <Loader2 className="spin" size={13} /> : conversation.pinned ? <Pin size={11} className="row-pin-indicator" /> : <MessageSquare size={13} />}
        <span className="workspace-conversation-body">
          <span className="workspace-conversation-title">{conversation.title}</span>
          {conversation.pending ? <span className="workspace-conversation-meta">{t('sidebar.pendingConversation')}</span> : null}
        </span>
      </button>
      {!conversation.pending && (
        <RowContextMenu
          pinned={!!conversation.pinned}
          onTogglePin={() => void handlePin()}
          onArchive={() => void handleArchive()}
          onRemove={() => setRemoveDialogOpen(true)}
        />
      )}
      {removeDialogOpen ? (
        <RemoveWorkspaceItemDialog
          itemName={conversation.title}
          itemKind="conversation"
          onClose={() => setRemoveDialogOpen(false)}
          onRemoveFromList={() => void handleRemoveFromList()}
          onRemoveFromDisk={() => void handleRemoveFromDisk()}
        />
      ) : null}
    </div>
  )
}

function WorkspaceFileNodeRow({
  node,
  workspace,
  level,
  treeRoot,
  expandedPaths,
  selectedLessonPath,
  activeConversationId,
  onToggle,
  onEnsureWorkspaceSelected,
  onOpenPath,
  onOpenHtmlFile,
  onOpenCourse,
  onOpenLesson,
  onOpenConversation
}: {
  node: WorkspaceFileNode
  workspace: TeachingWorkspaceSummary
  level: number
  treeRoot?: 'courses'
  expandedPaths: Set<string>
  selectedLessonPath: string | null
  activeConversationId: string | null
  onToggle: (workspaceId: string, relativePath: string) => void
  onEnsureWorkspaceSelected: () => Promise<void>
  onOpenPath: (path: string) => void
  onOpenHtmlFile?: (file: CoursePreviewFile) => void
  onOpenCourse?: (relativePath: string, workspaceId: string) => void
  onOpenLesson: (lesson: LessonSummary) => void
  onOpenConversation: (conversationId: string) => void
}) {
  const setWorkspaceItemMeta = useAppStore((s) => s.setWorkspaceItemMeta)
  const removeWorkspaceItem = useAppStore((s) => s.removeWorkspaceItem)
  const removeWorkspace = useAppStore((s) => s.removeWorkspace)
  const restorePendingAgentConversation = useAppStore((s) => s.restorePendingAgentConversation)
  const setOverviewDialogMode = useAppStore((s) => s.setOverviewDialogMode)
  const openWorkspaceTeachingMode = useAppStore((s) => s.openWorkspaceTeachingMode)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const isDirectory = node.kind === 'directory'
  const nodeKey = workspaceNodeKey(workspace.id, node.relativePath)
  const isExpanded = expandedPaths.has(nodeKey)
  const lesson = (workspace.lessons ?? []).find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const conversation = (workspace.conversations ?? []).find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const isPendingConversation = isPendingConversationSummary(conversation)
  const isWorkspaceFolder = treeRoot === 'courses' && level === 0 && isDirectory && normalizeRelativePath(node.relativePath) === ''
  const isCourseFolder = treeRoot === 'courses' && isDirectory && !isWorkspaceFolder && isSidebarCourseFolderPath(node.relativePath)
  const isHtmlFile = !isDirectory && node.name.toLowerCase().endsWith('.html')
  const isSelected = Boolean(
    (((lesson || (treeRoot === 'courses' && isHtmlFile)) && node.absolutePath === selectedLessonPath) ||
      (conversation && conversation.id === activeConversationId))
  )
  const itemKind: WorkspaceItemKind = conversation ? 'conversation' : isDirectory ? 'directory' : 'file'
  const itemLabel = conversation?.title ?? lesson?.title ?? node.name
  const Icon = isDirectory
    ? isExpanded
      ? FolderOpen
      : Folder
    : conversation
      ? MessageSquare
      : FileText

  const handleOpen = async (): Promise<void> => {
    if (treeRoot === 'courses') {
      setOverviewDialogMode('teaching')
    }
    if (isDirectory) {
      if (isWorkspaceFolder) {
        await onEnsureWorkspaceSelected()
        openWorkspaceTeachingMode()
        onToggle(workspace.id, node.relativePath)
        return
      }
      if (isCourseFolder) {
        await onEnsureWorkspaceSelected()
        onOpenCourse?.(node.relativePath, workspace.id)
        onToggle(workspace.id, node.relativePath)
        return
      }
      onToggle(workspace.id, node.relativePath)
      return
    }
    await onEnsureWorkspaceSelected()
    if (lesson) {
      onOpenLesson(lesson)
      return
    }
    if (conversation) {
      if (isPendingConversation) restorePendingAgentConversation()
      else onOpenConversation(conversation.id)
      return
    }
    if (treeRoot === 'courses' && onOpenHtmlFile && node.name.toLowerCase().endsWith('.html')) {
      onOpenHtmlFile({
        title: titleFromFileName(node.name),
        relativePath: node.relativePath,
        absolutePath: node.absolutePath
      })
      return
    }
    onOpenPath(node.absolutePath)
  }

  const handlePin = async (): Promise<void> => {
    if (isWorkspaceFolder) {
      void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: '', pinned: !node.pinned })
      return
    }
    await onEnsureWorkspaceSelected()
    void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: node.relativePath, pinned: !node.pinned })
  }
  const handleArchive = async (): Promise<void> => {
    if (isWorkspaceFolder) {
      void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: '', archived: true })
      return
    }
    await onEnsureWorkspaceSelected()
    void setWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: node.relativePath, archived: true })
  }
  const handleRemoveFromList = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    if (isWorkspaceFolder) {
      void removeWorkspace({ workspaceId: workspace.id, mode: 'list' })
      return
    }
    await onEnsureWorkspaceSelected()
    void removeWorkspaceItem({ workspaceId: workspace.id, relativePath: node.relativePath, kind: itemKind, mode: 'list' })
  }
  const handleRemoveFromDisk = async (): Promise<void> => {
    setRemoveDialogOpen(false)
    if (isWorkspaceFolder) {
      void removeWorkspace({ workspaceId: workspace.id, mode: 'disk' })
      return
    }
    await onEnsureWorkspaceSelected()
    void removeWorkspaceItem({ workspaceId: workspace.id, relativePath: node.relativePath, kind: itemKind, mode: 'disk' })
  }

  return (
    <div className="workspace-node">
      <div
        className={`workspace-node-row ${isSelected ? 'is-selected' : ''} ${isDirectory ? 'is-directory' : ''} ${isHtmlFile ? 'is-html-file' : ''} ${conversation ? 'is-conversation' : ''} ${isPendingConversation ? 'is-pending' : ''} ${isWorkspaceFolder ? 'is-workspace-folder' : ''} ${isCourseFolder ? 'is-course-folder' : ''}`}
        style={{ paddingLeft: 4 + level * 12 }}
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
      >
        <button
          className="workspace-node-button"
          type="button"
          title={node.absolutePath}
          aria-expanded={isDirectory ? isExpanded : undefined}
          onClick={() => void handleOpen()}
        >
          {isPendingConversation ? <Loader2 className="spin" size={13} /> : <Icon size={13} />}
          {node.pinned ? <Pin size={10} className="row-pin-indicator" /> : null}
          <span className="collapsible-label">{conversation?.title ?? lesson?.sessionName ?? node.name}</span>
          {isDirectory ? (
            <span className="workspace-node-chevron" aria-hidden="true">
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
          ) : null}
        </button>
        {!isPendingConversation ? (
          <RowContextMenu
            pinned={!!node.pinned}
            onTogglePin={() => void handlePin()}
            onArchive={() => void handleArchive()}
            onRemove={() => setRemoveDialogOpen(true)}
          />
        ) : null}
        {removeDialogOpen ? (
          <RemoveWorkspaceItemDialog
            itemName={itemLabel}
            itemKind={itemKind}
            onClose={() => setRemoveDialogOpen(false)}
            onRemoveFromList={() => void handleRemoveFromList()}
            onRemoveFromDisk={() => void handleRemoveFromDisk()}
          />
        ) : null}
      </div>
      {isDirectory && node.children?.length ? (
        <div
          className={`workspace-node-children${isExpanded ? ' is-open' : ''}${isWorkspaceFolder || isCourseFolder ? ' is-course-children' : ''}`}
          aria-hidden={!isExpanded}
          inert={!isExpanded ? true : undefined}
        >
          <div className="workspace-node-children-inner">
            {node.children.map((child) => (
              <WorkspaceFileNodeRow
                key={workspaceNodeKey(workspace.id, child.relativePath)}
                node={child}
                workspace={workspace}
                level={level + 1}
                treeRoot={treeRoot}
                expandedPaths={expandedPaths}
                selectedLessonPath={selectedLessonPath}
                activeConversationId={activeConversationId}
                onToggle={onToggle}
                onEnsureWorkspaceSelected={onEnsureWorkspaceSelected}
                onOpenPath={onOpenPath}
                onOpenHtmlFile={onOpenHtmlFile}
                onOpenCourse={onOpenCourse}
                onOpenLesson={onOpenLesson}
                onOpenConversation={onOpenConversation}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ================================================================
// Overview pickers: project folder + git branch
// ================================================================

/** Parent folder name, shown muted to disambiguate same-named projects. */
function workspaceContextLabel(rootPath: string, name: string): string {
  const parts = rootPath.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean)
  if (parts.length < 2) return ''
  const parent = parts[parts.length - 2] ?? ''
  return !parent || parent.toLowerCase() === name.toLowerCase() ? '' : parent
}

function sameRelativePath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/') === right.replace(/\\/g, '/')
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function withPendingCourseConversation(
  workspaces: TeachingWorkspaceSummary[],
  pendingAgentConversation: PendingAgentConversation | null
): TeachingWorkspaceSummary[] {
  if (!pendingAgentConversation || !isCourseAgentConversationPath(pendingAgentConversation.summary.relativePath)) return workspaces
  const courseRelativePath = courseRelativePathForAgentConversation(pendingAgentConversation.summary.relativePath)
  if (!courseRelativePath) return workspaces

  let changed = false
  const nextWorkspaces = workspaces.map((workspace) => {
    if (workspace.id !== pendingAgentConversation.workspaceId) return workspace
    let workspaceChanged = false
    const conversations = upsertConversationSummary(workspace.conversations, pendingAgentConversation.summary)
    if (conversations !== workspace.conversations) workspaceChanged = true
    const courses = workspace.courses.map((course) => {
      if (!sameRelativePath(course.relativePath, courseRelativePath)) return course
      const courseConversations = upsertConversationSummary(course.conversations, pendingAgentConversation.summary)
      if (courseConversations === course.conversations) return course
      workspaceChanged = true
      return {
        ...course,
        conversations: courseConversations,
        sessionCount: course.sessions.length + courseConversations.length
      }
    })
    if (!workspaceChanged) return workspace
    changed = true
    return {
      ...workspace,
      conversations,
      courses
    }
  })

  return changed ? nextWorkspaces : workspaces
}

function upsertConversationSummary(
  conversations: AgentConversationSummary[],
  conversation: AgentConversationSummary
): AgentConversationSummary[] {
  const withoutCurrent = conversations.filter((item) =>
    item.id !== conversation.id && !sameRelativePath(item.relativePath, conversation.relativePath)
  )
  if (withoutCurrent.length === conversations.length && conversations[0]?.id === conversation.id) return conversations
  return [conversation, ...withoutCurrent]
}

function workspaceNodeKey(workspaceId: string, relativePath: string): string {
  return `${workspaceId}:${normalizeRelativePath(relativePath)}`
}

function isSidebarCourseFolderPath(relativePath: string): boolean {
  const normalized = normalizeRelativePath(relativePath)
  return normalized === 'lessons' || /^courses\/[^/]+$/i.test(normalized)
}

function userTurnInputHistory(turns: AgentChatTurn[]): string[] {
  return turns
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.content)
}

function titleFromFileName(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{4}-/, '')
    .replace(/-reference$/i, '')
  const title = stem
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
  return title || fileName
}

function courseRelativePathForFile(relativePath: string): string | null {
  const parts = normalizeRelativePath(relativePath).split('/').filter(Boolean)
  if (parts[0] === 'courses' && parts[1]) return `courses/${parts[1]}`
  if (parts[0] === 'lessons') return 'lessons'
  return null
}

function lessonToCoursePreviewFile(lesson: LessonSummary): CoursePreviewFile {
  return {
    title: lesson.sessionName || lesson.title,
    relativePath: lesson.relativePath,
    absolutePath: lesson.absolutePath
  }
}

/** Truncate the middle of a string so long branch names fit the trigger button. */
function middleEllipsize(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 1) return '…'
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`
}

function usePickerOutsideClose(open: boolean, wrapRef: RefObject<HTMLDivElement | null>, setOpen: (v: boolean) => void): void {
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && wrapRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open, wrapRef, setOpen])
}

function ProjectFolderPicker({ mode = 'workspace' }: { mode?: 'workspace' | 'temporary' }) {
  const { t } = useTranslation()
  const workspaces = useAppStore((s) => s.appState.workspaces)
  const active = useAppStore((s) => s.appState.activeWorkspace)
  const selectWorkspace = useAppStore((s) => s.selectWorkspace)
  const importWorkspace = useAppStore((s) => s.importWorkspace)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  usePickerOutsideClose(open, wrapRef, setOpen)

  const showSearch = workspaces.length > 5
  useEffect(() => {
    if (open && showSearch) window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [open, showSearch])

  const filtered = useMemo(() => {
    const list = workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      rootPath: w.rootPath,
      context: workspaceContextLabel(w.rootPath, w.name)
    }))
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((w) => w.name.toLowerCase().includes(q) || w.rootPath.toLowerCase().includes(q))
  }, [workspaces, query])

  const label = active?.name ?? t('overview.selectWorkspace')

  if (mode === 'temporary') {
    return (
      <div className="overview-picker overview-project-picker">
        <button
          type="button"
          className="overview-picker-trigger"
          title={t('overview.temporarySessionTitle')}
          disabled
        >
          <MessageSquare size={15} strokeWidth={1.8} />
          <span className="overview-picker-label">{t('overview.temporarySession')}</span>
        </button>
      </div>
    )
  }

  const handleSelect = async (id: string): Promise<void> => {
    if (acting) return
    if (id === active?.id) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await selectWorkspace(id)
      setOpen(false)
      setQuery('')
    } finally {
      setActing(false)
    }
  }

  const handleAdd = async (): Promise<void> => {
    if (acting) return
    setActing(true)
    try {
      await importWorkspace()
      setOpen(false)
      setQuery('')
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-project-picker">
      <button
        type="button"
        className="overview-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title={active?.rootPath ?? t('overview.importWorkspace')}
        disabled={acting}
      >
        <Folder size={15} strokeWidth={1.8} />
        <span className="overview-picker-label">{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu" role="listbox">
          {showSearch ? (
            <div className="overview-picker-search">
              <Search size={14} strokeWidth={1.8} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setOpen(false)
                  }
                }}
                placeholder={t('overview.searchWorkspaces')}
              />
            </div>
          ) : null}

          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{t('overview.workspaces')}</div>
            {filtered.map((w) => {
              const isCurrent = w.id === active?.id
              return (
                <button
                  key={w.id}
                  type="button"
                  className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                  onClick={() => void handleSelect(w.id)}
                  disabled={acting}
                  title={w.rootPath}
                >
                  <Folder size={14} strokeWidth={1.8} className="overview-picker-option-icon" />
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{w.name}</span>
                    {w.context ? <span className="overview-picker-option-context">{w.context}</span> : null}
                  </span>
                  {isCurrent ? <Check size={15} /> : null}
                </button>
              )
            })}
            {filtered.length === 0 ? (
              <div className="overview-picker-empty">
                {workspaces.length === 0 ? t('overview.noWorkspaces') : t('overview.noMatch')}
              </div>
            ) : null}
          </div>

          <div className="overview-picker-footer">
            <button
              type="button"
              className="overview-picker-option"
              onClick={() => void handleAdd()}
              disabled={acting}
            >
              <FolderPlus size={14} strokeWidth={1.9} className="overview-picker-option-icon" />
              <span className="overview-picker-option-title">{t('overview.importWorkspace')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function GitBranchPicker({ workspaceRoot }: { workspaceRoot: string }) {
  const { t } = useTranslation()
  const root = workspaceRoot.trim()
  const {
    gitBranchesRoot,
    gitBranchesResult,
    gitBranchesLoading,
    loadGitBranches,
    setGitBranchesResult
  } = useAppStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [acting, setActing] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const result = gitBranchesRoot === root ? gitBranchesResult : null
  const loading = gitBranchesRoot === root ? gitBranchesLoading : false

  // Reload branches whenever the workspace changes (incl. right after an
  // import/select switches the active workspace) and on mount. The cancel
  // guard keeps a stale fetch from overwriting a newer one.
  useEffect(() => {
    setOpen(false)
    setQuery('')
    setActing(null)
    void loadGitBranches(root)
  }, [loadGitBranches, root])

  // Refresh + focus when the dropdown opens.
  useEffect(() => {
    if (!open || !root) return
    void loadGitBranches(root, { force: true })
    window.setTimeout(() => inputRef.current?.focus(), 0)
  }, [loadGitBranches, open, root])

  usePickerOutsideClose(open, wrapRef, setOpen)

  const branches = useMemo<TeachingGitBranchRow[]>(
    () => (result?.ok ? result.branches : []),
    [result]
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return branches
    return branches.filter((b) => b.name.toLowerCase().includes(q))
  }, [branches, query])

  const trimmed = query.trim()
  const exactExists = branches.some((b) => b.name === trimmed)
  const canCreate = trimmed.length > 0 && !exactExists
  const currentBranch = result?.ok ? result.currentBranch : null

  const label = !root
    ? t('overview.gitNoWorkspace')
    : !result
      ? t('overview.gitLoading')
      : result?.ok
        ? (currentBranch ?? t('overview.gitDetached'))
        : result?.reason === 'not_git_repo'
          ? t('overview.gitNotRepo')
          : result?.reason === 'git_unavailable'
            ? t('overview.gitUnavailable')
            : t('overview.gitError')
  const triggerLoading = loading && !result

  const switchBranch = async (branch: string): Promise<void> => {
    const api = window.teachingSystem
    if (!api || !root || !branch || acting) return
    setActing(branch)
    try {
      const next = await api.switchGitBranch({ workspaceRoot: root, branch })
      setGitBranchesResult(root, next)
      if (next.ok) {
        setOpen(false)
        setQuery('')
      }
    } finally {
      setActing(null)
    }
  }

  const createBranch = async (): Promise<void> => {
    const api = window.teachingSystem
    const branch = query.trim()
    if (!api || !root || !branch || acting) return
    setActing(branch)
    try {
      const next = await api.createGitBranch({ workspaceRoot: root, branch })
      setGitBranchesResult(root, next)
      if (next.ok) {
        setOpen(false)
        setQuery('')
      }
    } finally {
      setActing(null)
    }
  }

  if (!root) return null

  return (
    <div ref={wrapRef} className="overview-picker overview-git-picker">
      <button
        type="button"
        className="overview-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        title={label}
        disabled={acting != null}
      >
        <GitBranch size={15} strokeWidth={1.8} />
        <span className="overview-picker-label">{middleEllipsize(label, 32)}</span>
        {triggerLoading ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-git-menu">
          <div className="overview-picker-search">
            <Search size={14} strokeWidth={1.8} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setOpen(false)
                }
                if (e.key === 'Enter') {
                  if (canCreate) {
                    e.preventDefault()
                    void createBranch()
                  } else {
                    const match = branches.find((b) => b.name === trimmed)
                    if (match) {
                      e.preventDefault()
                      void switchBranch(match.name)
                    }
                  }
                }
              }}
              placeholder={t('overview.gitSearchBranches')}
            />
          </div>

          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{t('overview.gitBranches')}</div>

            {loading && !result ? (
              <div className="overview-picker-loading">
                <Loader2 size={14} className="spin" />
                <span>{t('overview.gitLoading')}</span>
              </div>
            ) : null}

            {result && !result.ok ? (
              <div className="overview-picker-error">
                <AlertCircle size={14} />
                <span>{result.message}</span>
              </div>
            ) : null}

            {filtered.map((b) => {
              const isActing = acting === b.name
              return (
                <button
                  key={b.name}
                  type="button"
                  className={`overview-picker-option${b.current ? ' is-current' : ''}`}
                  onClick={() => void switchBranch(b.name)}
                  disabled={acting != null || b.current}
                  title={b.worktreePath ? t('overview.gitCheckedOutInWorktree') : b.name}
                >
                  <GitBranch size={14} strokeWidth={1.8} className="overview-picker-option-icon" />
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{middleEllipsize(b.name, 42)}</span>
                    {b.current && result?.ok && result.dirtyCount > 0 ? (
                      <span className="overview-picker-option-context">
                        {t('overview.gitDirty', { count: result.dirtyCount })}
                      </span>
                    ) : b.worktreePath ? (
                      <span className="overview-picker-option-context">{t('overview.gitCheckedOutInWorktree')}</span>
                    ) : null}
                  </span>
                  {isActing ? <Loader2 size={14} className="spin" /> : b.current ? <Check size={15} /> : null}
                </button>
              )
            })}

            {!loading && result?.ok && filtered.length === 0 ? (
              <div className="overview-picker-empty">{t('overview.gitNoBranches')}</div>
            ) : null}
          </div>

          {canCreate ? (
            <div className="overview-picker-footer">
              <button
                type="button"
                className="overview-picker-option"
                onClick={() => void createBranch()}
                disabled={acting != null}
                title={t('overview.gitCreateNamed', { branch: trimmed })}
              >
                <Plus size={14} strokeWidth={1.9} className="overview-picker-option-icon" />
                <span className="overview-picker-option-title">
                  {t('overview.gitCreateNamed', { branch: middleEllipsize(trimmed, 34) })}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function OverviewModelPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const openSettings = useAppStore((s) => s.openSettings)
  const [open, setOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const provider = activeModelProvider(settings)
  const models = provider?.models ?? []
  const current = settings.generator.model
  const label = current || i18n.t('common.auto')

  const handleSelect = async (model: string): Promise<void> => {
    if (acting) return
    if (model === current) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { providerId: provider?.id, model } })
      setOpen(false)
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-model-picker">
      <button
        type="button"
        className="overview-dialog-model"
        onClick={() => setOpen((v) => !v)}
        disabled={acting}
        title={label}
      >
        <span>{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-model-menu" role="listbox">
          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{provider?.name ?? t('common.modelProvider')}</div>
            {models.length === 0 ? (
              <div className="overview-picker-empty">{t('overview.modelEmpty')}</div>
            ) : (
              models.map((model) => {
                const isCurrent = model === current
                return (
                  <button
                    key={model}
                    type="button"
                    className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                    onClick={() => void handleSelect(model)}
                    disabled={acting || isCurrent}
                    title={model}
                  >
                    <span className="overview-picker-option-body">
                      <span className="overview-picker-option-title">{model}</span>
                    </span>
                    {isCurrent ? <Check size={15} /> : null}
                  </button>
                )
              })
            )}
          </div>
          <div className="overview-picker-footer">
            <button
              type="button"
              className="overview-picker-option"
              onClick={() => {
                setOpen(false)
                openSettings('model')
              }}
              title={t('overview.modelManage')}
            >
              <SlidersHorizontal size={14} strokeWidth={1.9} className="overview-picker-option-icon" />
              <span className="overview-picker-option-title">{t('overview.modelManage')}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function OverviewReasoningPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const options = reasoningEffortOptionsForSettings(settings)
  const current = selectedReasoningEffort(settings)
  const label = reasoningEffortLabel(current)

  const handleSelect = async (reasoningEffort: ModelReasoningEffort): Promise<void> => {
    if (acting) return
    if (reasoningEffort === current && settings.generator.reasoningEffort === current) {
      setOpen(false)
      return
    }
    setActing(true)
    try {
      await updateSettings({ generator: { reasoningEffort } })
      setOpen(false)
    } finally {
      setActing(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-reasoning-picker">
      <button
        type="button"
        className="overview-dialog-model overview-dialog-reasoning"
        onClick={() => setOpen((v) => !v)}
        disabled={acting}
        title={`${t('reasoning.title')}: ${label}`}
      >
        <BrainCircuit size={14} />
        <span>{label}</span>
        {acting ? <Loader2 size={13} className="spin" /> : <ChevronDown size={13} />}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-reasoning-menu" role="listbox">
          <div className="overview-picker-list">
            <div className="overview-picker-group-label">{t('reasoning.title')}</div>
            {options.map((effort) => {
              const isCurrent = effort === current
              return (
                <button
                  key={effort}
                  type="button"
                  className={`overview-picker-option${isCurrent ? ' is-current' : ''}`}
                  onClick={() => void handleSelect(effort)}
                  disabled={acting || (isCurrent && settings.generator.reasoningEffort === current)}
                  title={reasoningEffortDescription(effort)}
                >
                  <BrainCircuit size={14} strokeWidth={1.8} className="overview-picker-option-icon" />
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{reasoningEffortLabel(effort)}</span>
                    <span className="overview-picker-option-context">{reasoningEffortDescription(effort)}</span>
                  </span>
                  {isCurrent ? <Check size={15} /> : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ================================================================
// Main Content Area
// ================================================================

function MainArea() {
  const { t } = useTranslation()
  const {
    view,
    settingsSection,
    sidebarCollapsed,
    loading,
    generating,
    error,
    appState,
    settings,
    lessonReaderOpen,
    selectedCoursePreviewFile,
    selectedResourcePreviewFile,
    setView,
    setSidebarCollapsed,
    openSettings,
    closeResourceHtmlPreview,
    pickDefaultRoot,
    initialize,
    updateSettings,
    createWorkspace,
    importWorkspace,
    updateMission,
    generateLesson,
    loadLesson,
    openLessonLibrary,
    openPath,
    clearError
  } = useAppStore()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const active = appState.activeWorkspace
  const selectedCourseWorkspaceId = useAppStore((s) => s.selectedCourseWorkspaceId)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const workspacesWithPending = useMemo(
    () => withPendingCourseConversation(appState.workspaces, pendingAgentConversation),
    [appState.workspaces, pendingAgentConversation]
  )
  const activeWithPending = active
    ? workspacesWithPending.find((workspace) => workspace.id === active.id) ?? active
    : null
  const selectedCourseWorkspace = selectedCourseWorkspaceId
    ? workspacesWithPending.find((workspace) => workspace.id === selectedCourseWorkspaceId) ?? activeWithPending
    : activeWithPending
  const courses = selectedCourseWorkspace?.courses ?? []
  const selectedCourseRelativePath = useAppStore((s) => s.selectedCourseRelativePath)
  const selectedCourse = selectedCourseRelativePath
    ? courses.find((course) => sameRelativePath(course.relativePath, selectedCourseRelativePath)) ?? null
    : null
  const visibleCourses = selectedCourse ? [selectedCourse] : courses.filter((course) => course.sessions.length > 0)
  const visibleLessonCount = visibleCourses.reduce((sum, course) => sum + course.sessions.length, 0)
  const selectedLesson = active?.lessons.find((lesson) => lesson.absolutePath === appState.selectedLessonPath) ?? null
  const selectedPreviewFile = selectedCoursePreviewFile ?? (selectedLesson ? lessonToCoursePreviewFile(selectedLesson) : null)
  const readingCourseHtml = Boolean(lessonReaderOpen && selectedPreviewFile)
  const readingResourceHtml = view === 'resources' && Boolean(selectedResourcePreviewFile)
  const readingHtml = readingCourseHtml || readingResourceHtml
  const lessonFrameKey = selectedPreviewFile
    ? appState.previewUrl || `${appState.selectedLessonPath ?? selectedPreviewFile.relativePath}:${appState.previewHtml.length}`
    : 'empty-preview'
  const resourceFrameKey = selectedResourcePreviewFile
    ? `${selectedResourcePreviewFile.id}:${selectedResourcePreviewFile.html.length}`
    : 'empty-resource-preview'
  const renderSidebarToggle = (className = 'icon-button') => (
    <button
      className={className}
      type="button"
      aria-label={sidebarCollapsed ? t('main.expandSidebar') : t('main.collapseSidebar')}
      onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
    >
      <PanelLeft size={17} />
    </button>
  )

  // Show skeleton during initial load
  if (loading && !active) {
    return (
      <main className="main-area">
        <div className="topbar">
          <div className="crumb">
            <span>TeachOS</span>
          </div>
        </div>
        <div style={{ maxWidth: 760, margin: '36px auto', padding: '0 24px' }}>
          <div className="skeleton" style={{ width: '35%', height: 22, marginBottom: 14, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: '100%', height: 120, borderRadius: 20 }} />
        </div>
      </main>
    )
  }

  return (
    <main className="main-area" data-view={view} data-reading-html={readingHtml ? 'true' : undefined}>
      {readingResourceHtml ? (
        <>
          {renderSidebarToggle('icon-button reader-sidebar-toggle')}
          <button
            className="icon-button reader-preview-back"
            type="button"
            aria-label={t('resources.styles.backToStyles')}
            onClick={closeResourceHtmlPreview}
          >
            <ArrowLeft size={17} />
          </button>
        </>
      ) : readingCourseHtml ? (
        renderSidebarToggle('icon-button reader-sidebar-toggle')
      ) : (
        <header className="topbar">
          <div className="crumb">{renderSidebarToggle()}</div>
        </header>
      )}

      {error && (
        <div className="inline-alert" role="alert" data-severity={error.severity}>
          {error.severity === 'error' && <AlertCircle size={16} />}
          {error.severity === 'warning' && <AlertTriangle size={16} />}
          {error.severity === 'info' && <Info size={16} />}
          <div style={{ minWidth: 0 }}>
            <strong>{error.message}</strong>
            {error.detail && <span style={{ display: 'block', marginTop: 2, fontSize: 12, fontWeight: 400, opacity: 0.8 }}>{error.detail}</span>}
          </div>
          <button className="alert-dismiss" type="button" aria-label={t('main.dismissAlert')} onClick={clearError}>
            <X size={14} />
          </button>
        </div>
      )}

      {view === 'overview' && (
        <OverviewChat active={active} />
      )}

      {view === 'agent' && (
        <OverviewChat active={active} />
      )}

      {view === 'settings' && (
        <SettingsView
          section={settingsSection}
          settings={settings}
          activeWorkspace={active}
          onClose={() => setView('overview')}
          onSectionChange={(section) => openSettings(section)}
          onUpdateSettings={updateSettings}
          onPickDefaultRoot={pickDefaultRoot}
          onCreateWorkspace={createWorkspace}
          onImportWorkspace={importWorkspace}
          onOpenPath={openPath}
          onOpenExternal={useAppStore.getState().openExternal}
          onTestNotification={() => useAppStore.getState().showNotification(t('notify.test.title'), t('notify.test.body'))}
          onProbeProvider={useAppStore.getState().probeProvider}
          onListUpstreamModels={useAppStore.getState().listUpstreamModels}
          onListGitWorktrees={useAppStore.getState().listGitWorktrees}
          onRemoveGitWorktree={useAppStore.getState().removeGitWorktree}
          memoryRecords={useAppStore.getState().memoryRecords}
          memoryDiagnostics={useAppStore.getState().memoryDiagnostics}
          onListMemory={useAppStore.getState().listMemory}
          onCreateMemory={useAppStore.getState().createMemory}
          onUpdateMemory={useAppStore.getState().updateMemory}
          onDeleteMemory={useAppStore.getState().deleteMemory}
          onLoadMemoryDiagnostics={useAppStore.getState().loadMemoryDiagnostics}
          onOpenLogFile={async () => {
            const result = await window.teachingSystem?.openLogFile()
            if (!result?.ok) throw new Error(result?.message ?? i18n.t('errors.openLog'))
          }}
          onOpenAppDataDir={async () => {
            const result = await window.teachingSystem?.openAppDataDir()
            if (!result?.ok) throw new Error(result?.message ?? i18n.t('errors.openAppData'))
          }}
        />
      )}

      {view === 'lessons' && (
        <section className="lesson-course-view" aria-label={t('nav.lessons')} data-reading-html={readingCourseHtml ? 'true' : undefined}>
          <div className="lesson-course-stage" data-reading-html={readingCourseHtml ? 'true' : undefined}>
            {readingCourseHtml && selectedPreviewFile ? (
              <section className="lesson-reader-panel" aria-label={t('lessons.previewAria')}>
                <div className="lesson-reader-frame-wrap">
                  <iframe
                    key={lessonFrameKey}
                    className="lesson-reader-frame"
                    title={selectedPreviewFile.title}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    src={appState.previewUrl || undefined}
                    srcDoc={appState.previewUrl ? undefined : appState.previewHtml || undefined}
                  />
                </div>
              </section>
            ) : (
              <section className="lesson-course-library" aria-label={t('lessons.libraryTitle')}>
                <div className="lesson-library-header">
                  <div>
                    <span>{selectedCourse ? t('lessons.selectedCourseFolder') : active?.missionTitle ?? t('overview.noWorkspace')}</span>
                    <h2>{selectedCourse?.name ?? t('lessons.libraryTitle')}</h2>
                  </div>
                  <button className="ghost-button" type="button" onClick={() => active && void openPath(active.lessonsDir)} disabled={!active}>
                    <FolderOpen size={16} />
                    {t('lessons.openDir')}
                  </button>
                </div>

                {visibleLessonCount === 0 ? (
                  <EmptyState
                    icon={BookOpen}
                    title={t('lessons.emptyTitle')}
                    detail={t('lessons.emptyDetail')}
                    action={active ? { label: t('lessons.emptyAction'), onClick: generateLesson } : undefined}
                  />
                ) : (
                  visibleCourses.map((course) => (
                    <section className="lesson-course-group" key={course.id}>
                      <div className="lesson-course-group-header">
                        <div className="lesson-course-group-title">
                          <BookCopy size={16} />
                          <strong>{course.name}</strong>
                        </div>
                        <span className="lesson-session-count">{t('lessons.sessionCount', { count: course.sessions.length })}</span>
                      </div>
                      <div className="lesson-card-grid">
                        {course.sessions.map((session, sessionIndex) => {
                          const lesson = session.lesson
                          const isSelected = lesson.absolutePath === appState.selectedLessonPath
                          return (
                            <button
                              className={`lesson-course-card${isSelected ? ' is-selected' : ''}`}
                              key={lesson.absolutePath}
                              type="button"
                              onClick={() => void loadLesson(lesson)}
                              style={{ animationDelay: `${Math.min(sessionIndex, 12) * 28}ms` }}
                            >
                              <span className="lesson-card-spine">{formatLessonIndex(lesson.id)}</span>
                              <span className="lesson-card-body">
                                <span className="lesson-card-title">{stripLessonIndexPrefix(session.name, lesson.id)}</span>
                                <span className="lesson-card-summary">{lesson.objective || lesson.prompt || lesson.relativePath}</span>
                                <span className="lesson-card-meta">
                                  <span className="lesson-card-duration">
                                    <Clock3 size={12} />
                                    {t('lessons.duration', { count: lesson.durationMinutes })}
                                  </span>
                                  <ArrowUpRight className="lesson-card-open-hint" size={14} aria-hidden="true" />
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  ))
                )}
              </section>
            )}
          </div>
          {!readingCourseHtml && <OverviewLessonComposer active={active} className="lesson-bottom-composer" showModeSwitch={false} />}
        </section>
      )}

      {view === 'resources' && (
        <section className="resource-page" data-reading-html={readingResourceHtml ? 'true' : undefined}>
          {readingResourceHtml && selectedResourcePreviewFile ? (
            <section className="lesson-reader-panel" aria-label={selectedResourcePreviewFile.title}>
              <div className="lesson-reader-frame-wrap">
                <iframe
                  key={resourceFrameKey}
                  className="lesson-reader-frame"
                  title={selectedResourcePreviewFile.title}
                  sandbox="allow-scripts allow-forms"
                  srcDoc={selectedResourcePreviewFile.html}
                />
              </div>
            </section>
          ) : (
            <LessonStyleGallery />
          )}
        </section>
      )}

      {view === 'studio' && (
        <StudySpace />
      )}
    </main>
  )
}

// ================================================================
// Lesson style gallery (resources page)
// ================================================================

/** Perceived luminance check so text stays readable on the accent chip. */
function isLightColor(color: string): boolean {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
}

/** Heading font stack of a theme ('inherit' falls back to the body stack). */
function styleCardFontStack(tokens: LessonStyleTokens): string {
  return tokens.fontHeading === 'inherit' ? tokens.fontBody : tokens.fontHeading
}

/** First family of the heading stack, shown as the specimen label. */
function styleCardFontLabel(tokens: LessonStyleTokens): string {
  const first = styleCardFontStack(tokens).split(',')[0]?.replace(/["']/g, '').trim()
  return first || 'System'
}

function LessonStyleGallery() {
  const { t } = useTranslation()
  const savedStyleId = useAppStore((s) => s.settings.workspace.lessonStyleId)
  const applyLessonStyle = useAppStore((s) => s.applyLessonStyle)
  const openResourceHtmlPreview = useAppStore((s) => s.openResourceHtmlPreview)
  const currentStyleId = normalizeLessonStyleId(savedStyleId)
  const [applyingStyleId, setApplyingStyleId] = useState<LessonStyleId | null>(null)

  const applyStyle = async (styleId: LessonStyleId): Promise<void> => {
    setApplyingStyleId(styleId)
    try {
      await applyLessonStyle(styleId)
    } finally {
      setApplyingStyleId(null)
    }
  }

  return (
    <div className="style-gallery is-card-only">
      <div className="style-gallery-cards">
        {LESSON_STYLES.map((style) => {
          const isCurrent = style.id === currentStyleId
          const isApplying = applyingStyleId === style.id
          const { tokens } = style
          return (
            <article
              className={`style-card${isCurrent ? ' is-selected' : ''}`}
              key={style.id}
            >
              <button
                className="style-card-preview"
                type="button"
                aria-pressed={isCurrent}
                onClick={() => openResourceHtmlPreview({
                  id: `style-${style.id}`,
                  title: t(`resources.styles.items.${style.id}.name`),
                  html: buildLessonStyleSampleHtml(style.id)
                })}
              >
                <span aria-hidden className="style-card-thumb" style={{ background: tokens.pageBg, borderColor: tokens.line }}>
                  <span
                    className="style-card-chip style-card-chip-color"
                    style={{ background: tokens.accent, color: isLightColor(tokens.accent) ? '#20242a' : '#ffffff' }}
                  >
                    <span className="style-card-chip-label">Primary</span>
                    <span className="style-card-chip-hex">
                      {tokens.accent.startsWith('#') ? tokens.accent.toUpperCase() : ''}
                    </span>
                  </span>
                  <span className="style-card-chip style-card-chip-type" style={{ background: tokens.panel, borderColor: tokens.line }}>
                    <span
                      className="style-card-chip-aa"
                      style={{ color: tokens.heading, fontFamily: styleCardFontStack(tokens) }}
                    >
                      Aa
                    </span>
                    <span className="style-card-chip-font" style={{ color: tokens.muted }}>
                      {styleCardFontLabel(tokens)}
                    </span>
                  </span>
                  <span className="style-card-chip style-card-chip-ui" style={{ background: tokens.panel, borderColor: tokens.line }}>
                    <span className="style-card-chip-buttons">
                      <span className="style-card-chip-btn" style={{ background: tokens.accent }} />
                      <span className="style-card-chip-btn is-outline" style={{ borderColor: tokens.muted }} />
                    </span>
                    <span className="style-card-chip-line" style={{ background: tokens.accent, width: '54%' }} />
                    <span className="style-card-chip-line" style={{ background: tokens.muted, width: '88%' }} />
                    <span className="style-card-chip-line" style={{ background: tokens.muted, width: '68%' }} />
                  </span>
                  <span className="style-card-scale" style={{ borderColor: tokens.line }}>
                    {[tokens.ink, tokens.muted, tokens.accent, tokens.soft, tokens.panel, tokens.pageBg].map((swatch, index) => (
                      <span key={index} style={{ background: swatch }} />
                    ))}
                  </span>
                </span>
                <span className="style-card-body">
                  <strong>{t(`resources.styles.items.${style.id}.name`)}</strong>
                  <span>{t(`resources.styles.items.${style.id}.detail`)}</span>
                </span>
              </button>
              <button
                className={`style-card-apply${isCurrent ? ' is-current' : ''}`}
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                disabled={isCurrent || isApplying}
                onClick={() => void applyStyle(style.id)}
              >
                {isApplying ? <Loader2 className="spin" size={13} /> : isCurrent ? <CheckCircle2 size={13} /> : <Check size={13} />}
                {isCurrent ? t('resources.styles.applied') : t('resources.styles.apply')}
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}

// ================================================================
// Study Space
// ================================================================

function StudySpace() {
  const showNotification = useAppStore((s) => s.showNotification)
  const [snapshot, setSnapshot] = useState<StudySnapshot>(() => readStudySnapshot())
  const [roomCycleNow, setRoomCycleNow] = useState(() => Date.now())
  const [taskInput, setTaskInput] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [spaceDraft, setSpaceDraft] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [focusTheaterOpen, setFocusTheaterOpen] = useState(false)
  const presence = useStudyPresence(snapshot)
  const activeRoom = studyRooms.find((room) => room.id === snapshot.roomId) ?? studyRooms[0]
  const activeMode = studyModes.find((mode) => mode.id === snapshot.modeId) ?? studyModes[0]
  const roomCycle = getStudyRoomCycle(activeRoom, roomCycleNow)
  useStudyAmbient(snapshot.roomId, snapshot.ambientEnabled, snapshot.ambientVolume)
  const level = studyLevel(snapshot.xp)
  const activePeers = presence.peers.filter((peer) => peer.spaceCode === snapshot.spaceCode && peer.roomId === snapshot.roomId)
  const spacePeers = presence.peers.filter((peer) => peer.spaceCode === snapshot.spaceCode)
  const allRoomPeers = studyRooms.reduce<Record<StudyRoomId, number>>((acc, room) => {
    acc[room.id] = presence.peers.filter((peer) => peer.spaceCode === snapshot.spaceCode && peer.roomId === room.id).length + (snapshot.roomId === room.id ? 1 : 0)
    return acc
  }, { silent: 0, sprint: 0, deep: 0, exam: 0 })
  const online = activePeers.length + 1
  const spaceOnline = spacePeers.length + 1
  const remoteOnline = activePeers.length
  const timerTotalSeconds = (snapshot.timerMode === 'focus' ? snapshot.focusMinutes : snapshot.breakMinutes) * 60
  const timerProgress = timerTotalSeconds > 0 ? Math.round(((timerTotalSeconds - snapshot.remainingSeconds) / timerTotalSeconds) * 100) : 0
  const followingRoomCycle = snapshot.timerState === 'running'
    && snapshot.timerMode === roomCycle.phase
    && snapshot.focusMinutes === activeRoom.sessionMinutes
    && snapshot.breakMinutes === activeRoom.breakMinutes
  const completedTasks = snapshot.tasks.filter((task) => task.done).length
  const seatCount = activeRoom.seats
  const userSeat = (level.level + snapshot.todaySessions + 2) % seatCount
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
      status: snapshot.timerState,
      timerMode: snapshot.timerMode,
      todayFocusSeconds: snapshot.todayFocusSeconds,
      todaySessions: snapshot.todaySessions,
      streakDays: snapshot.streakDays,
      focusMinutes: snapshot.focusMinutes,
      isSelf: true
    },
    ...activePeers.map((peer) => ({
      ...peer,
      isSelf: false
    }))
  ].sort((left, right) => right.todayFocusSeconds - left.todayFocusSeconds)
  const roomFocusSeconds = roomMembers.reduce((sum, member) => sum + member.todayFocusSeconds, 0)
  const roomSessionCount = roomMembers.reduce((sum, member) => sum + member.todaySessions, 0)
  const focusingCount = roomMembers.filter((member) => member.status === 'running' && member.timerMode === 'focus').length
  const roomEvents = presence.events
    .filter((event) => event.spaceCode === snapshot.spaceCode && event.roomId === snapshot.roomId)
    .slice(0, 8)
  const connectionLabel = presence.status === 'online'
    ? '实时在线'
    : presence.status === 'connecting'
      ? '正在连接'
      : '离线模式'
  const connectionDetail = presence.status === 'online'
    ? `人数来自当前设备和同空间 MQTT 心跳：本房间 ${online} 人，整个空间 ${spaceOnline} 人。`
    : presence.status === 'connecting'
      ? '正在连接公共 relay，连接前不会用模拟人数填充座位。'
      : 'relay 暂不可用，页面只显示本机状态，不再显示虚假的在线人数。'
  const inviteHint = snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE
    ? '公共大厅不用邀请码；新建空间后可只邀请自己的同学进入。'
    : `把空间码 ${snapshot.spaceCode} 发给同学，对方输入后会进入同一个在线 presence 房间。`
  const stageStatusLabel = snapshot.timerState === 'running'
    ? snapshot.timerMode === 'focus'
      ? 'FOCUS ON'
      : 'BREAK'
    : snapshot.timerState === 'paused'
      ? 'PAUSED'
      : 'READY'
  const contractDisplay = snapshot.contractText.trim() || snapshot.tasks.find((task) => !task.done)?.title || activeMode.name
  const roomFeed = [
    `${activeRoom.name} 当前 ${focusingCount} 人正在专注，今日合计 ${formatStudyHours(roomFocusSeconds)}h。`,
    snapshot.timerState === 'running'
      ? `${snapshot.nickname} 正在进行 ${snapshot.focusMinutes} 分钟专注轮次：${contractDisplay}。`
      : `${snapshot.nickname} 已入座，等待开始下一轮。`,
    `房间第 ${roomCycle.round} 轮正在${roomCycle.phase === 'focus' ? '专注' : '休息'}，${formatStudyDuration(roomCycle.remainingSeconds)} 后切换到${roomCycle.nextLabel}。`,
    completedTasks > 0 ? `今日已完成 ${completedTasks} 个学习任务。` : '先写下本轮目标，再开始番茄钟。',
    presence.status === 'online'
      ? `空间 ${snapshot.spaceCode} 已连接实时 presence，远端同学 ${remoteOnline} 人。`
      : '在线 relay 不可用时，只显示本机状态。'
  ]
  const roomRules = [
    snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE ? '公共大厅：任何 StudiumX 用户都可进入' : `私密空间：凭 ${snapshot.spaceCode} 加入`,
    `${activeMode.name}：${activeMode.rule}`,
    activeRoom.id === 'exam' ? '考试模拟间默认静音，不播放环境音' : `${activeRoom.ambient} 可在右侧开关`,
    'presence 只广播匿名状态，不上传学习任务内容'
  ]

  const emitRoomEvent = (kind: StudyRoomEventKind, text: string): void => {
    presence.sendEvent(kind, text)
  }

  useEffect(() => {
    persistStudySnapshot(snapshot)
  }, [snapshot])

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
          void showNotification('学习空间', `完成 ${current.focusMinutes} 分钟专注，进入休息。`)
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

        void showNotification('学习空间', '休息结束，可以开始下一轮专注。')
        return {
          ...current,
          timerMode: 'focus',
          timerState: 'idle',
          remainingSeconds: current.focusMinutes * 60
        }
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [showNotification, snapshot.timerState])

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
    setSnapshot((current) => ({
      ...current,
      roomId: room.id,
      focusMinutes: current.timerState === 'running' ? current.focusMinutes : room.sessionMinutes,
      breakMinutes: current.timerState === 'running' ? current.breakMinutes : room.breakMinutes,
      remainingSeconds: current.timerState === 'running' ? current.remainingSeconds : room.sessionMinutes * 60,
      timerMode: current.timerState === 'running' ? current.timerMode : 'focus'
    }))
  }

  const selectStudyMode = (mode: typeof studyModes[number]): void => {
    setSnapshot((current) => ({
      ...current,
      modeId: mode.id,
      roomId: current.timerState === 'running' ? current.roomId : mode.roomId,
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

  const copyInvite = async (): Promise<void> => {
    const text = `StudiumX 学习空间：${snapshot.spaceCode}\n教室：${activeRoom.name}\n进入学习空间后输入空间码即可加入同一自习室。`
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 2200)
    } catch {
      setCopyState('failed')
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
          <span className="study-eyebrow"><DoorOpen size={14} /> Network study room</span>
          <h1>{activeRoom.name}</h1>
          <p>{activeRoom.tone}</p>
          <div className="study-hero-meta">
            <span className={`study-presence-pill is-${presence.status}`}>
              <span />
              {presence.status === 'online' ? `${online} 人在线` : presence.status === 'connecting' ? '连接教室中' : '离线，仅本机'}
            </span>
            <span>Space {snapshot.spaceCode}</span>
            <span>{activeRoom.light}</span>
            <span>{activeRoom.ambient}</span>
            <span>relay {presence.relay}</span>
          </div>
          <div className="study-space-console">
            <form className="study-space-code-form" onSubmit={joinSpace}>
              <input
                value={spaceDraft}
                onChange={(event) => setSpaceDraft(event.target.value)}
                placeholder={snapshot.spaceCode}
                aria-label="加入空间码"
                maxLength={18}
              />
              <button type="submit">加入</button>
            </form>
            <button type="button" onClick={createSpace}>新建空间</button>
            <button type="button" onClick={() => void copyInvite()}>
              <Copy size={13} />
              {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '邀请'}
            </button>
          </div>
          <div className="study-connection-card" aria-label="在线连接说明">
            <div>
              <strong>{connectionLabel}</strong>
              <span>{connectionDetail}</span>
            </div>
            <small>{inviteHint}</small>
          </div>
        </div>
        <div className="study-header-stats" aria-label="学习统计">
          <span><Zap size={15} /> streak {snapshot.streakDays}</span>
          <span><Trophy size={15} /> Lv.{level.level}</span>
          <span><Target size={15} /> {completedTasks}/{snapshot.tasks.length}</span>
        </div>
      </div>

      <section className="study-lobby" aria-label="房间大厅">
        <div className="study-lobby-card study-lobby-pass">
          <div className="study-lobby-head">
            <span className="study-kicker"><KeyRound size={14} /> Room pass</span>
            <strong>{snapshot.spaceCode}</strong>
          </div>
          <p>{snapshot.spaceCode === STUDY_PUBLIC_SPACE_CODE ? '当前在公共大厅。新建私密空间后，只把空间码发给要一起自习的人。' : inviteHint}</p>
          <div className="study-lobby-actions">
            <button type="button" onClick={createSpace}>
              <Lock size={14} />
              新建私密空间
            </button>
            <button type="button" onClick={() => void copyInvite()}>
              <Copy size={14} />
              {copyState === 'copied' ? '已复制邀请' : '复制邀请'}
            </button>
          </div>
        </div>
        <div className="study-lobby-card">
          <div className="study-lobby-head">
            <span className="study-kicker"><Users size={14} /> Live room</span>
            <strong>{online}/{activeRoom.capacity}</strong>
          </div>
          <div className="study-lobby-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round((online / activeRoom.capacity) * 100))}%` }} />
          </div>
          <p>{presence.status === 'online' ? `远端同学 ${remoteOnline} 人，整个空间 ${spaceOnline} 人在线。` : connectionDetail}</p>
          <form className="study-lobby-join" onSubmit={joinSpace}>
            <input
              value={spaceDraft}
              onChange={(event) => setSpaceDraft(event.target.value)}
              placeholder="输入空间码"
              aria-label="大厅加入空间码"
              maxLength={18}
            />
            <button type="submit">加入</button>
          </form>
        </div>
        <div className="study-lobby-card study-lobby-start">
          <div className="study-lobby-head">
            <span className="study-kicker"><Timer size={14} /> Start ritual</span>
            <strong>{roomCycle.phase === 'focus' ? '同频专注' : '同步休息'}</strong>
          </div>
          <p>房间第 {roomCycle.round} 轮，{formatStudyDuration(roomCycle.remainingSeconds)} 后进入{roomCycle.nextLabel}。</p>
          <div className="study-lobby-actions">
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
      </section>

      <section className="study-room-directory" aria-label="实时房间目录">
        <div className="study-directory-head">
          <div>
            <span className="study-kicker"><DoorOpen size={14} /> Rooms</span>
            <h2>选择一个真实在线房间</h2>
          </div>
          <span>{snapshot.spaceCode} · {spaceOnline} 人在这个空间</span>
        </div>
        <div className="study-directory-grid">
          {studyRooms.map((room) => {
            const roomCycleInfo = getStudyRoomCycle(room, roomCycleNow)
            const roomOnline = allRoomPeers[room.id]
            const roomFocusing = presence.peers.filter((peer) => peer.spaceCode === snapshot.spaceCode && peer.roomId === room.id && peer.status === 'running' && peer.timerMode === 'focus').length
              + (snapshot.roomId === room.id && snapshot.timerState === 'running' && snapshot.timerMode === 'focus' ? 1 : 0)
            const isActive = snapshot.roomId === room.id
            return (
              <article className={`study-directory-card${isActive ? ' is-active' : ''}`} key={room.id}>
                <div className="study-directory-card-head">
                  <strong>{room.name}</strong>
                  <span>{roomOnline}/{room.capacity}</span>
                </div>
                <p>{room.tone}</p>
                <div className="study-directory-meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.round((roomOnline / room.capacity) * 100))}%` }} />
                </div>
                <div className="study-directory-meta">
                  <span>{roomCycleInfo.phase === 'focus' ? '专注' : '休息'} · {formatStudyDuration(roomCycleInfo.remainingSeconds)}</span>
                  <span>{roomFocusing} 人专注中</span>
                </div>
                <button type="button" onClick={() => selectRoom(room)}>
                  {isActive ? '当前房间' : '进入房间'}
                </button>
              </article>
            )
          })}
        </div>
      </section>

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

      <div className="study-layout">
        <section className="study-room-stage" aria-label="在线自习室">
          <div className="study-stage-window">
            <span />
            <span />
            <span />
          </div>
          <div className="study-stage-scene" aria-label="自习室场景">
            <div className="study-stage-board">
              <span>{stageStatusLabel}</span>
              <strong>{contractDisplay}</strong>
              <small>{activeMode.name} · {snapshot.focusMinutes}/{snapshot.breakMinutes}</small>
            </div>
            <div className="study-stage-clock">
              <Clock3 size={18} />
              <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
            </div>
            <div className="study-stage-lamp" aria-hidden="true" />
            <div className="study-stage-desk" aria-hidden="true">
              <span className="study-desk-book" />
              <span className="study-desk-note" />
              <span className="study-desk-cup" />
            </div>
          </div>
          <div className="study-stage-topline">
            <div>
              <span className="study-kicker"><Users size={14} /> Real presence</span>
              <h2>当前教室：{online}/{activeRoom.capacity}</h2>
            </div>
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
          <div className={`study-cycle-card is-${roomCycle.phase}`} aria-label="房间同步轮次">
            <div>
              <span>Room round #{roomCycle.round}</span>
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
          <div className="study-room-metrics" aria-label="房间状态">
            <div>
              <strong>{formatStudyHours(roomFocusSeconds)}h</strong>
              <span>房间今日专注</span>
            </div>
            <div>
              <strong>{focusingCount}</strong>
              <span>正在专注</span>
            </div>
            <div>
              <strong>{roomSessionCount}</strong>
              <span>完成番茄</span>
            </div>
          </div>
          <div className="study-seat-map" aria-label="真实在线座位图">
            {Array.from({ length: seatCount }, (_, index) => {
              const peer = activePeers[index > userSeat ? index - 1 : index]
              const isUser = index === userSeat
              const isOccupied = Boolean(peer) || isUser
              return (
                <span
                  key={index}
                  className={`study-seat${isUser ? ' is-user' : ''}${isOccupied ? ' is-occupied' : ''}${peer?.status === 'running' ? ' is-focusing' : ''}`}
                  title={isUser ? `${snapshot.nickname}（我）· ${studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}` : peer ? `${peer.nickname} · ${studyMemberStatusLabel(peer.status, peer.timerMode)}` : '空座'}
                  aria-label={isUser ? `${snapshot.nickname}（我）· ${studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}` : peer ? `${peer.nickname} · ${studyMemberStatusLabel(peer.status, peer.timerMode)}` : '空座'}
                >
                  {isUser ? '我' : peer ? peer.nickname.slice(0, 1).toUpperCase() : ''}
                </span>
              )
            })}
          </div>
          <div className="study-room-strip">
            {studyRooms.map((room) => {
              const isActive = room.id === snapshot.roomId
              return (
                <button
                  key={room.id}
                  type="button"
                  className={`study-room-tab${isActive ? ' is-active' : ''}`}
                  onClick={() => selectRoom(room)}
                >
                  <strong>{room.name}</strong>
                  <span>{allRoomPeers[room.id]}/{room.capacity}</span>
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

        <section className="study-panel study-mode-panel" aria-label="学习模式和专注契约">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><ShieldCheck size={14} /> Focus contract</span>
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
        </section>

        <section className="study-panel study-timer-panel" aria-label="番茄时钟">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><Timer size={14} /> Pomodoro</span>
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
          <div className="study-online-summary" aria-label="实时在线摘要">
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
              <span>远端同学</span>
            </div>
          </div>
          <div className="study-invite-note">
            <Info size={14} />
            <span>{connectionDetail}</span>
          </div>
          <div className="study-room-feed" aria-label="房间动态">
            {roomFeed.map((item, index) => (
              <div key={index} className="study-feed-row">
                <span>{index + 1}</span>
                <p>{item}</p>
              </div>
            ))}
          </div>
          <div className="study-room-actions" aria-label="房间互动">
            <button type="button" onClick={() => emitRoomEvent('checkin', `${snapshot.nickname} 在 ${activeRoom.name} 签到。`)}>
              签到
            </button>
            <button type="button" onClick={() => emitRoomEvent('cheer', `${snapshot.nickname} 给同桌们加油。`)}>
              加油
            </button>
            <button type="button" onClick={() => emitRoomEvent('cheer', `${snapshot.nickname} 休息提醒：记得喝水和放松眼睛。`)}>
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
          <div className="study-leaderboard" aria-label="在线专注榜">
            <div className="study-leaderboard-head">
              <strong>在线专注榜</strong>
              <span>{roomMembers.length} 人</span>
            </div>
            {roomMembers.slice(0, 5).map((member, index) => (
              <div className={`study-leader-row${member.isSelf ? ' is-me' : ''}`} key={member.clientId}>
                <span>{index + 1}</span>
                <strong>{member.nickname}</strong>
                <em>{formatStudyHours(member.todayFocusSeconds)}h</em>
              </div>
            ))}
          </div>
          <div className="study-classmate-list">
            <div className="study-classmate-row is-me">
              <span>{snapshot.nickname.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{snapshot.nickname}</strong>
                <small>{snapshot.timerMode === 'focus' ? `${snapshot.focusMinutes}m 专注` : '休息中'} · {contractDisplay}</small>
              </div>
              <em>{studyMemberStatusLabel(snapshot.timerState, snapshot.timerMode)}</em>
            </div>
            {activePeers.length === 0 ? (
              <div className="study-empty-online">
                {presence.status === 'online' ? '当前房间还没有其他同学。打开另一个客户端或邀请朋友进入同一房间即可看到真实人数。' : '正在连接在线教室，连接失败时不会显示模拟人数。'}
              </div>
            ) : activePeers.map((peer) => (
              <div className="study-classmate-row" key={peer.clientId}>
                <span>{peer.nickname.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{peer.nickname}</strong>
                  <small>{peer.timerMode === 'focus' ? `${peer.focusMinutes}m 专注` : '休息中'} · streak {peer.streakDays}</small>
                </div>
                <em>{studyMemberStatusLabel(peer.status, peer.timerMode)}</em>
              </div>
            ))}
          </div>
        </section>

        <section className="study-panel study-task-panel" aria-label="学习任务">
          <div className="study-panel-head">
            <div>
              <span className="study-kicker"><CheckCircle2 size={14} /> 今日清单</span>
              <h2>学习任务</h2>
            </div>
            <button className="study-clear-button" type="button" onClick={removeDoneTasks}>清除完成</button>
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

        <section className="study-panel study-growth-panel" aria-label="成长系统">
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
              <span>{snapshot.timerMode === 'focus' ? 'FOCUS SESSION' : 'RECOVERY'}</span>
              <strong>{formatStudyDuration(snapshot.remainingSeconds)}</strong>
              <p>{contractDisplay}</p>
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
                  <span className={member.isSelf ? 'is-me' : ''} key={member.clientId} title={`${member.nickname} · ${studyMemberStatusLabel(member.status, member.timerMode)}`}>
                    {member.nickname.slice(0, 1).toUpperCase()}
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

// ================================================================
// Settings View
// ================================================================

function DialogModeSwitch() {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const overviewDialogMode = useAppStore((s) => s.overviewDialogMode)
  const setOverviewDialogMode = useAppStore((s) => s.setOverviewDialogMode)
  const setView = useAppStore((s) => s.setView)
  const mode: DialogMode = view === 'agent' ? 'chat' : overviewDialogMode
  const handleChange = (next: DialogMode): void => {
    if (view === 'agent') {
      if (next === 'teaching') {
        setOverviewDialogMode('teaching')
        setView('overview')
      }
      return
    }
    setOverviewDialogMode(next)
  }
  const options: Array<{ id: DialogMode; label: string; icon: LucideIcon }> = [
    { id: 'chat', label: t('overview.mode.chat'), icon: MessageSquare },
    { id: 'teaching', label: t('overview.mode.teaching'), icon: BookOpen }
  ]
  return (
    <div className="dialog-mode-switch" role="tablist" aria-label={t('overview.mode.aria')}>
      {options.map((option) => {
        const Icon = option.icon
        const isActive = mode === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`dialog-mode-switch-btn ${isActive ? 'is-active' : ''}`}
            onClick={() => handleChange(option.id)}
          >
            <Icon size={14} />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function OverviewLessonComposer({
  active,
  className = '',
  showModeSwitch = true
}: {
  active: TeachingWorkspaceSummary | null
  className?: string
  showModeSwitch?: boolean
}) {
  const { t } = useTranslation()
  const {
    taskPrompt,
    setTaskPrompt,
    generating,
    agentChatBusy,
    agentChat,
    openTeachingConversationView
  } = useAppStore()
  const busy = generating || agentChatBusy
  const canSend = Boolean(active && taskPrompt.trim().length > 0 && !busy)
  // Every free-form teaching input goes through the conversation agent; it
  // clarifies when needed and calls the generate_lesson tool when ready.
  const submitToTeachingAgent = () => {
    if (!canSend) return
    const prompt = taskPrompt.trim()
    setTaskPrompt('')
    openTeachingConversationView()
    void agentChat(prompt, { mode: 'teaching' })
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submitToTeachingAgent()
  }
  return (
    <section className={`overview-dialog-shell${className ? ` ${className}` : ''}`} aria-label={t('lessons.composerAria')}>
      {showModeSwitch ? <DialogModeSwitch /> : null}
      <form className="overview-dialog-stack" onSubmit={onSubmit}>
        <div className="overview-dialog-card">
          <textarea
            value={taskPrompt}
            aria-label={t('overview.taskAria')}
            placeholder={active ? t('lessons.composerPlaceholder') : t('overview.placeholderEmpty')}
            onChange={(event) => setTaskPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                if (isInputComposing(event)) return
                event.preventDefault()
                submitToTeachingAgent()
              }
            }}
          />
          <div className="overview-dialog-footer">
            <div className="overview-dialog-actions">
              <OverviewModelPicker />
              <OverviewReasoningPicker />
              <button className="send-button overview-dialog-send" type="submit" aria-label={t('lessons.send')} disabled={!canSend}>
                {busy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              </button>
            </div>
          </div>
        </div>
        <div className="overview-dialog-statusbar" aria-label={t('overview.runtimeEnv')}>
          <div className="overview-dialog-status-group overview-dialog-pickers">
            <ProjectFolderPicker />
            <GitBranchPicker workspaceRoot={active?.rootPath ?? ''} />
          </div>
          <div className="overview-dialog-status-group">
            {busy ? <span className="overview-dialog-status-text">{t('lessons.composerTitle')}</span> : null}
          </div>
        </div>
      </form>
    </section>
  )
}

function OverviewChat({ active }: { active: TeachingWorkspaceSummary | null }) {
  const { t } = useTranslation()
  const {
    agentTurns,
    agentChatBusy,
    agentStatus,
    agentInput,
    setAgentInput,
    agentInputHistory,
    rememberAgentInput,
    generating,
    agentChat,
    cancelAgentChat
  } = useAppStore()
  const view = useAppStore((s) => s.view)
  const overviewDialogMode = useAppStore((s) => s.overviewDialogMode)
  const appState = useAppStore((s) => s.appState)
  const isTeachingMode = view !== 'agent' && overviewDialogMode === 'teaching'
  const inputValue = agentInput
  const busy = isTeachingMode ? generating || agentChatBusy : agentChatBusy
  const canSend = Boolean(active && inputValue.trim() && !busy)
  const hasConversation = agentTurns.length > 0
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number | null>(null)
  const [inputHistoryDraft, setInputHistoryDraft] = useState('')
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const viewingBusyPendingConversation = agentChatBusy && activeConversationId === pendingAgentConversation?.summary.id
  const canCancelAgentChat = agentChatBusy && Boolean(pendingAgentConversation)
  const sentInputHistory = useMemo(
    () => mergeAgentInputHistory(agentInputHistory, userTurnInputHistory(agentTurns)),
    [agentInputHistory, agentTurns]
  )
  const submitTeachingPrompt = (value: string): void => {
    const prompt = value.trim()
    if (!prompt) return
    rememberAgentInput(prompt)
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
    setAgentInput('')
    // One brain: the teaching conversation owns clarification AND generation
    // (via its generate_lesson tool). No parallel pipeline hand-off here.
    void agentChat(prompt, { mode: 'teaching' })
  }
  const submitChatPrompt = (value: string): void => {
    const prompt = value.trim()
    if (!prompt) return
    rememberAgentInput(prompt)
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
    void agentChat(prompt, { mode: 'temporary' })
  }
  const submitCurrentMode = (): void => {
    if (!canSend) return
    if (isTeachingMode) submitTeachingPrompt(inputValue)
    else submitChatPrompt(inputValue)
  }
  const setInputFromHistory = (value: string): void => {
    setAgentInput(value)
    window.requestAnimationFrame(() => {
      const node = inputRef.current
      if (!node) return
      node.setSelectionRange(value.length, value.length)
    })
  }
  const navigateSentInputHistory = (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false
    if (isInputComposing(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    if (sentInputHistory.length === 0) return false

    const { selectionStart, selectionEnd, value } = event.currentTarget
    if (selectionStart !== selectionEnd) return false
    if (event.key === 'ArrowUp' && selectionStart !== 0) return false
    if (event.key === 'ArrowDown' && selectionStart !== value.length) return false

    event.preventDefault()
    if (event.key === 'ArrowUp') {
      const nextIndex = inputHistoryIndex === null
        ? sentInputHistory.length - 1
        : Math.max(0, inputHistoryIndex - 1)
      if (inputHistoryIndex === null) setInputHistoryDraft(value)
      setInputHistoryIndex(nextIndex)
      setInputFromHistory(sentInputHistory[nextIndex] ?? '')
      return true
    }

    if (inputHistoryIndex === null) return true
    const nextIndex = inputHistoryIndex + 1
    if (nextIndex >= sentInputHistory.length) {
      setInputHistoryIndex(null)
      setInputFromHistory(inputHistoryDraft)
      setInputHistoryDraft('')
      return true
    }
    setInputHistoryIndex(nextIndex)
    setInputFromHistory(sentInputHistory[nextIndex] ?? '')
    return true
  }

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [agentTurns, agentStatus])
  const activeAssistantTurnId = viewingBusyPendingConversation
    ? [...agentTurns].reverse().find((turn) => turn.role === 'assistant')?.id
    : null

  return (
    <section
      className={`overview-dialog-shell${hasConversation ? ' has-conversation' : ''}`}
      aria-label={t('overview.aria')}
    >
      {hasConversation && (
        <div ref={scrollRef} className="overview-dialog-thread">
          <div className="overview-dialog-thread-inner">
          {agentTurns.map((turn) => {
            const isBusyTurn = activeAssistantTurnId === turn.id
            const hasProcess =
              turn.role === 'assistant' &&
              (Boolean(turn.processEvents?.length) || Boolean(turn.toolCalls?.length))
            const content = turn.content || (turn.role === 'assistant' && isBusyTurn && !hasProcess ? '正在回复…' : '')
            return (
              <div
                key={turn.id}
                className={`overview-dialog-message ${turn.role === 'user' ? 'is-user' : 'is-assistant'}`}
              >
                {turn.role === 'assistant' && <AgentProcessPanel turn={turn} busy={isBusyTurn} compact />}
                {content ? <MarkdownMessage content={content} tone={turn.role} compact /> : null}
              </div>
            )
          })}
          </div>
        </div>
      )}

      <DialogModeSwitch />
      <form
        className="overview-dialog-stack"
        aria-label={t('overview.formAria')}
        onSubmit={(event) => {
          event.preventDefault()
          submitCurrentMode()
        }}
      >
        <div className="overview-dialog-card">
          <textarea
            ref={inputRef}
            value={inputValue}
            aria-label={t('overview.taskAria')}
            placeholder={active
              ? isTeachingMode
                ? '说说你想学什么、当前基础，以及希望先解决什么问题…'
                : '输入对话内容...'
              : t('overview.placeholderEmpty')}
            onChange={(event) => {
              setAgentInput(event.target.value)
              setInputHistoryIndex(null)
              setInputHistoryDraft('')
            }}
            onKeyDown={(event) => {
              if (navigateSentInputHistory(event)) return
              if (event.key === 'Enter' && !event.shiftKey) {
                if (isInputComposing(event)) return
                event.preventDefault()
                submitCurrentMode()
              }
            }}
          />
          <div className="overview-dialog-footer">
            <div className="overview-dialog-actions">
              <OverviewModelPicker />
              <OverviewReasoningPicker />
              <button
                className="send-button overview-dialog-send"
                type={canCancelAgentChat ? 'button' : 'submit'}
                aria-label={canCancelAgentChat ? '中断对话' : '发送消息'}
                title={canCancelAgentChat ? '中断对话' : '发送消息'}
                disabled={canCancelAgentChat ? false : !canSend}
                onClick={canCancelAgentChat ? () => void cancelAgentChat() : undefined}
              >
                {canCancelAgentChat ? <Square size={16} /> : busy ? <Loader2 className="spin" size={18} /> : <SendHorizontal size={18} />}
              </button>
            </div>
          </div>
        </div>
        <div className="overview-dialog-statusbar" aria-label={t('overview.runtimeEnv')}>
          <div className="overview-dialog-status-group overview-dialog-pickers">
            <ProjectFolderPicker mode={isTeachingMode ? 'workspace' : 'temporary'} />
            {isTeachingMode ? <GitBranchPicker workspaceRoot={active?.rootPath ?? ''} /> : null}
          </div>
          <div className="overview-dialog-status-group">
            {isTeachingMode && generating ? <span className="overview-dialog-status-text">{t('lessons.composerTitle')}</span> : null}
            {!isTeachingMode && agentStatus ? <span className="overview-dialog-status-text">{agentStatus}</span> : null}
          </div>
        </div>
      </form>
    </section>
  )
}

function MarkdownMessage({
  content,
  tone,
  compact = false
}: {
  content: string
  tone: AgentChatTurn['role']
  compact?: boolean
}) {
  return (
    <div className={`markdown-message markdown-message--${tone}${compact ? ' is-compact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

const markdownComponents: Components = {
  a: ({ node: _node, href, children, ...props }) => (
    <a
      {...props}
      href={href}
      rel="noreferrer"
      target="_blank"
      onClick={(event) => handleMarkdownLinkClick(event, href)}
    >
      {children}
    </a>
  ),
  code: ({ node: _node, className, children, ...props }) => (
    <code {...props} className={className}>
      {children}
    </code>
  )
}

function handleMarkdownLinkClick(event: ReactMouseEvent<HTMLAnchorElement>, href?: string): void {
  if (!href) return
  event.preventDefault()
  void window.teachingSystem?.openExternal(href)
}

function AgentProcessPanel({
  turn,
  busy,
  compact = false
}: {
  turn: AgentChatTurn
  busy: boolean
  compact?: boolean
}) {
  const events = turn.processEvents ?? []
  const toolCalls = turn.toolCalls ?? []
  const timeline = buildAgentProcessTimeline(turn)
  if (events.length === 0 && toolCalls.length === 0) return null
  return (
    <div className={`agent-process-panel${compact ? ' is-compact' : ''}`}>
      <div className="agent-process-header">
        <BrainCircuit size={compact ? 13 : 14} />
        <strong>思考过程</strong>
        {busy ? <span>进行中</span> : <span>已记录</span>}
      </div>
      <div className="agent-process-list">
        {timeline.map((item, index) => (
          item.kind === 'event' ? (
            <AgentProcessEventRow
              key={item.event.id}
              event={item.event}
              active={busy && index === timeline.length - 1 && item.event.status !== 'done'}
            >
              <AgentProcessToolDetail event={item.event} toolCall={item.toolCall} />
            </AgentProcessEventRow>
          ) : (
            <ToolCallCard key={item.toolCall.id} toolCall={item.toolCall} />
          )
        ))}
      </div>
    </div>
  )
}

function AgentProcessEventRow({
  event,
  active,
  children
}: {
  event: AgentChatProcessEvent
  active: boolean
  children?: ReactNode
}) {
  return (
    <div className={`agent-process-event${event.isError ? ' is-error' : ''}${active ? ' is-active' : ''}`}>
      <span className="agent-process-event-icon">
        <AgentProcessIcon event={event} active={active} />
      </span>
      <div className="agent-process-event-copy">
        <strong>{event.title}</strong>
        {event.detail ? <small>{event.detail}</small> : null}
        {children}
      </div>
    </div>
  )
}

function AgentProcessToolDetail({
  event,
  toolCall
}: {
  event: AgentChatProcessEvent
  toolCall?: NonNullable<AgentChatTurn['toolCalls']>[number]
}) {
  const [open, setOpen] = useState(false)
  if (event.kind !== 'tool_call' && event.kind !== 'tool_result') return null

  const argsPretty = toolCall?.arguments ? prettyJson(toolCall.arguments) : ''
  const hasResult = event.kind === 'tool_result' && (toolCall?.result !== undefined || Boolean(event.detail))
  const resultPretty = toolCall?.result !== undefined ? prettyJson(toolCall.result ?? '') : (event.kind === 'tool_result' ? event.detail ?? '' : '')
  const hasExpandableDetail = Boolean(argsPretty || resultPretty)
  if (!hasExpandableDetail) return null

  return (
    <div className="agent-process-tool-detail">
      <button
        aria-expanded={open}
        className="agent-process-tool-detail-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{hasResult ? '查看工具结果' : '查看工具参数'}</span>
        <ChevronDown className={open ? 'is-open' : ''} size={12} />
      </button>
      {open && (
        <div className="tool-call-body is-inline">
          {argsPretty && (
            <div className="tool-call-section">
              <div>参数</div>
              <pre>{argsPretty}</pre>
            </div>
          )}
          {hasResult && resultPretty && (
            <div className="tool-call-section">
              <div>结果</div>
              <pre>{resultPretty}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentProcessIcon({
  event,
  active
}: {
  event: AgentChatProcessEvent
  active: boolean
}) {
  if (event.isError || event.status === 'error') return <AlertCircle size={13} />
  if (active) return <Loader2 className="spin" size={13} />
  if (event.kind === 'tool_call') return <Search size={13} />
  if (event.kind === 'tool_result') return <CheckCircle2 size={13} />
  if (event.status === 'done') return <CheckCircle2 size={13} />
  if (event.status === 'answering') return <Sparkles size={13} />
  if (event.status === 'tool_running' || event.status === 'tool_done') return <Wrench size={13} />
  return <Clock3 size={13} />
}

function ToolCallCard({ toolCall }: { toolCall: NonNullable<AgentChatTurn['toolCalls']>[number] }) {
  const [open, setOpen] = useState(false)
  const name = toolCall.name || 'tool'
  const argsPretty = prettyJson(toolCall.arguments)
  const hasResult = toolCall.result !== undefined
  return (
    <div className={`tool-call-card${toolCall.isError ? ' is-error' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="tool-call-trigger"
      >
        <Search size={14} />
        <strong>{name}</strong>
        {hasResult && (
          <span className="tool-call-state">
            {toolCall.isError ? '失败' : '完成'}
          </span>
        )}
        <ChevronDown className={open ? 'is-open' : ''} size={13} />
      </button>
      {open && (
        <div className="tool-call-body">
          {argsPretty && (
            <div className="tool-call-section">
              <div>参数</div>
              <pre>{argsPretty}</pre>
            </div>
          )}
          {hasResult && (
            <div className="tool-call-section">
              <div>结果</div>
              <pre>{prettyJson(toolCall.result ?? '')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SettingsView({
  section,
  settings,
  activeWorkspace,
  onClose,
  onSectionChange,
  onUpdateSettings,
  onPickDefaultRoot,
  onCreateWorkspace,
  onImportWorkspace,
  onOpenPath,
  onOpenExternal,
  onTestNotification,
  onProbeProvider,
  onListUpstreamModels,
  onListGitWorktrees,
  onRemoveGitWorktree,
  memoryRecords,
  memoryDiagnostics,
  onListMemory,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory,
  onLoadMemoryDiagnostics,
  onOpenLogFile,
  onOpenAppDataDir
}: {
  section: SettingsSection
  settings: TeachingSettingsV1
  activeWorkspace: TeachingWorkspaceSummary | null
  onClose: () => void
  onSectionChange: (section: SettingsSection) => void
  onUpdateSettings: (patch: TeachingSettingsPatch) => Promise<void>
  onPickDefaultRoot: () => Promise<void>
  onCreateWorkspace: () => Promise<void>
  onImportWorkspace: () => Promise<boolean>
  onOpenPath: (path: string) => Promise<void>
  onOpenExternal: (url: string) => Promise<void>
  onTestNotification: () => Promise<void>
  onProbeProvider: (payload: ProbeProviderPayload) => Promise<ProbeProviderResult>
  onListUpstreamModels: (payload: ProbeProviderPayload) => Promise<ListUpstreamModelsResult>
  onListGitWorktrees: (workspaceRoot: string) => Promise<TeachingGitWorktreesResult>
  onRemoveGitWorktree: (payload: RemoveTeachingGitWorktreePayload) => Promise<void>
  memoryRecords: TeachingMemoryRecord[]
  memoryDiagnostics: TeachingMemoryDiagnostics | null
  onListMemory: (workspaceRoot?: string) => Promise<void>
  onCreateMemory: (payload: CreateTeachingMemoryPayload) => Promise<boolean>
  onUpdateMemory: (memoryId: string, patch: UpdateTeachingMemoryPayload) => Promise<boolean>
  onDeleteMemory: (memoryId: string, workspaceRoot?: string) => Promise<void>
  onLoadMemoryDiagnostics: () => Promise<void>
  onOpenLogFile: () => Promise<void>
  onOpenAppDataDir: () => Promise<void>
}) {
  const { t } = useTranslation()
  const worktreeRootPath = settings.worktree?.rootPath ?? ''
  const providersById = new Map(settings.provider.providers.map((provider) => [provider.id, provider]))
  const visibleModelProviders = modelSettingsProviderIds.map((id) => {
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === id)!
    return providersById.get(id) ?? { ...preset, apiKey: '' }
  })
  const activeProvider = activeModelProvider(settings)
  const activeModelSettingsProvider =
    visibleModelProviders.find((provider) => provider.id === activeProvider.id) ?? visibleModelProviders[0]!
  const isCustomModelProvider = activeModelSettingsProvider.id === 'custom'
  const activeModelValue = activeModelSettingsProvider.models[0] ?? ''
  const activeProviderProbePayload = {
    baseUrl: activeModelSettingsProvider.baseUrl,
    apiKey: activeModelSettingsProvider.apiKey,
    endpointFormat: activeModelSettingsProvider.endpointFormat
  } satisfies ProbeProviderPayload
  const [providerStatus, setProviderStatus] = useState<string>('')
  const [providerBusy, setProviderBusy] = useState(false)
  const [apiKeyVisible, setApiKeyVisible] = useState(() => !settings.privacy.maskApiKeys)
  const [worktreeResult, setWorktreeResult] = useState<TeachingGitWorktreesResult | null>(null)
  const [worktreeBusyPath, setWorktreeBusyPath] = useState<string | null>(null)
  const [worktreeLoading, setWorktreeLoading] = useState(false)
  const [memoryScopeFilter, setMemoryScopeFilter] = useState<'all' | TeachingMemoryScope>('all')
  const [memoryDialog, setMemoryDialog] = useState<null | { mode: 'create' } | { mode: 'edit' | 'view'; memory: TeachingMemoryRecord }>(null)
  const [memoryDraft, setMemoryDraft] = useState<{ content: string; scope: TeachingMemoryScope; tags: string; confidence: number }>({
    content: '',
    scope: 'workspace',
    tags: '',
    confidence: 1
  })

  useEffect(() => {
    if (section !== 'memory') return
    void onListMemory(activeWorkspace?.rootPath)
    void onLoadMemoryDiagnostics()
  }, [section, activeWorkspace?.rootPath, onListMemory, onLoadMemoryDiagnostics])

  useEffect(() => {
    if (section !== 'worktree') return
    if (!activeWorkspace?.rootPath) {
      setWorktreeResult(null)
      return
    }
    void refreshWorktrees()
  }, [section, activeWorkspace?.rootPath, worktreeRootPath])

  useEffect(() => {
    setProviderStatus('')
    setApiKeyVisible(!settings.privacy.maskApiKeys)
  }, [activeModelSettingsProvider.id, settings.privacy.maskApiKeys])

  const probeActiveProvider = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus(t('model.statusConnecting'))
    const result = await onProbeProvider(activeProviderProbePayload)
    setProviderBusy(false)
    setProviderStatus(result.ok ? t('model.statusOk', { latency: result.latencyMs, count: result.modelIds.length }) : result.message)
  }

  const pullActiveProviderModels = async (): Promise<void> => {
    setProviderBusy(true)
    setProviderStatus(t('model.statusPulling'))
    const result = await onListUpstreamModels(activeProviderProbePayload)
    setProviderBusy(false)
    if (!result.ok) {
      setProviderStatus(result.message)
      return
    }
    updateProviderModels(result.modelIds, result.modelIds.length > 0)
    setProviderStatus(t('model.statusSynced', { count: result.modelIds.length }))
  }

  const updateProvider = (patch: Partial<TeachingModelProviderProfile>): void => {
    const currentProvider = settings.provider.providers.find((provider) => provider.id === activeModelSettingsProvider.id)
    const providers = currentProvider
      ? settings.provider.providers.map((provider) =>
          provider.id === activeModelSettingsProvider.id ? { ...provider, ...patch } : provider
        )
      : [...settings.provider.providers, { ...activeModelSettingsProvider, ...patch }]
    void onUpdateSettings({
      provider: {
        providers
      }
    })
  }

  const updateProviderModels = (models: string[], syncGeneratorModel = true): void => {
    const currentProvider = settings.provider.providers.find((provider) => provider.id === activeModelSettingsProvider.id)
    const providers = currentProvider
      ? settings.provider.providers.map((provider) =>
          provider.id === activeModelSettingsProvider.id ? { ...provider, models } : provider
        )
      : [...settings.provider.providers, { ...activeModelSettingsProvider, models }]
    void onUpdateSettings({
      provider: {
        providers
      },
      ...(syncGeneratorModel && settings.generator.providerId === activeModelSettingsProvider.id
        ? { generator: { model: models[0] ?? '' } }
        : {})
    })
  }

  const selectProvider = (providerId: string): void => {
    const provider = settings.provider.providers.find((item) => item.id === providerId) ?? activeProvider
    void onUpdateSettings({
      provider: { activeProviderId: provider.id },
      generator: {
        providerId: provider.id,
        model: provider.models[0] ?? '',
        endpointFormat: provider.endpointFormat
      }
    })
  }

  const selectModelProvider = (providerId: string): void => {
    const provider = visibleModelProviders.find((item) => item.id === providerId) ?? activeModelSettingsProvider
    const hasProvider = settings.provider.providers.some((item) => item.id === provider.id)
    void onUpdateSettings({
      provider: {
        activeProviderId: provider.id,
        providers: hasProvider ? settings.provider.providers : [...settings.provider.providers, provider]
      },
      generator: {
        providerId: provider.id,
        model: provider.models[0] ?? '',
        endpointFormat: provider.endpointFormat
      }
    })
  }

  const resetActiveProviderToPreset = async (): Promise<void> => {
    const preset = TEACHING_MODEL_PROVIDER_PRESETS.find((item) => item.id === activeModelSettingsProvider.id)
    if (!preset) return
    const resetProvider = { ...preset, apiKey: activeModelSettingsProvider.apiKey }
    const providers = settings.provider.providers.some((provider) => provider.id === resetProvider.id)
      ? settings.provider.providers.map((provider) =>
          provider.id === resetProvider.id ? resetProvider : provider
        )
      : [...settings.provider.providers, resetProvider]
    await onUpdateSettings({
      provider: {
        activeProviderId: resetProvider.id,
        providers
      },
      generator: {
        providerId: resetProvider.id,
        model: resetProvider.models[0] ?? '',
        endpointFormat: resetProvider.endpointFormat
      }
    })
    setProviderStatus(t('model.statusReset'))
  }

  const refreshWorktrees = async (): Promise<void> => {
    if (!activeWorkspace?.rootPath) return
    setWorktreeLoading(true)
    try {
      const result = await onListGitWorktrees(activeWorkspace.rootPath)
      setWorktreeResult(result)
    } finally {
      setWorktreeLoading(false)
    }
  }

  const removeWorktree = async (path: string): Promise<void> => {
    if (!activeWorkspace?.rootPath) return
    setWorktreeBusyPath(path)
    try {
      await onRemoveGitWorktree({ workspaceRoot: activeWorkspace.rootPath, worktreePath: path })
      await refreshWorktrees()
    } finally {
      setWorktreeBusyPath(null)
    }
  }

  const filteredMemoryRecords = memoryScopeFilter === 'all'
    ? memoryRecords
    : memoryRecords.filter((record) => record.scope === memoryScopeFilter)

  const beginCreateMemory = (): void => {
    setMemoryDraft({ content: '', scope: 'workspace', tags: '', confidence: 1 })
    setMemoryDialog({ mode: 'create' })
  }

  const beginEditMemory = (memory: TeachingMemoryRecord): void => {
    setMemoryDraft({
      content: memory.content,
      scope: memory.scope,
      tags: memory.tags.join(', '),
      confidence: memory.confidence ?? 1
    })
    setMemoryDialog({ mode: 'edit', memory })
  }

  const saveMemoryDraft = async (): Promise<void> => {
    const payload = {
      content: memoryDraft.content.trim(),
      scope: memoryDraft.scope,
      tags: memoryDraft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      confidence: memoryDraft.confidence,
      workspaceRoot: activeWorkspace?.rootPath
    } satisfies CreateTeachingMemoryPayload
    if (!payload.content) return
    const ok = memoryDialog?.mode === 'edit'
      ? await onUpdateMemory(memoryDialog.memory.id, payload)
      : await onCreateMemory(payload)
    if (ok) setMemoryDialog(null)
  }

  return (
    <div className="settings-floating-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="settings-view" aria-label={t('settings.aria')} role="dialog" aria-modal="true">
        <button className="settings-close-button" type="button" aria-label={t('settings.close')} onClick={onClose}>
          <X size={17} />
        </button>
        <aside className="settings-nav" aria-label={t('settings.navAria')}>
        <div className="settings-nav-heading">{t('settings.navHeading')}</div>
        {settingsNavItems.map((item) => {
          const Icon = item.icon
          return (
            <button
              className={`settings-nav-item ${section === item.id ? 'is-active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => onSectionChange(item.id)}
            >
              <Icon size={17} />
              <span>
                <strong>{t(`settingsSection.${item.id}.label`)}</strong>
                <small>{t(`settingsSection.${item.id}.detail`)}</small>
              </span>
            </button>
          )
        })}
      </aside>

      <div className="settings-content">
        {section === 'general' && (
          <SettingsPanel
            title={t('general.title')}
            subtitle={t('general.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('general.theme.label')} detail={t('general.theme.detail')}>
                <SegmentedControl
                  value={settings.theme}
                  options={[
                    { value: 'system', label: t('general.theme.system'), icon: Monitor },
                    { value: 'light', label: t('general.theme.light'), icon: Sun },
                    { value: 'dark', label: t('general.theme.dark'), icon: Moon }
                  ]}
                  onChange={(theme) => void onUpdateSettings({ theme })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.language.label')} detail={t('general.language.detail')}>
                <SegmentedControl
                  value={settings.locale}
                  options={[
                    { value: 'zh-CN', label: t('general.language.zh') },
                    { value: 'en-US', label: t('general.language.en') }
                  ]}
                  onChange={(locale) => void onUpdateSettings({ locale })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.density.label')} detail={t('general.density.detail')}>
                <SegmentedControl
                  value={settings.density}
                  options={[
                    { value: 'comfortable', label: t('general.density.comfortable') },
                    { value: 'compact', label: t('general.density.compact') }
                  ]}
                  onChange={(density) => void onUpdateSettings({ density })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.fontScale.label')} detail={`${Math.round(settings.uiFontScale * 100)}%`}>
                <input
                  className="settings-range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  type="range"
                  value={settings.uiFontScale}
                  onChange={(event) => void onUpdateSettings({ uiFontScale: Number(event.target.value) })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.closeAction.label')} detail={settings.appBehavior.closeAction === 'tray' ? t('general.closeAction.detailTray') : t('general.closeAction.detailQuit')}>
                <SegmentedControl
                  value={settings.appBehavior.closeAction}
                  options={[
                    { value: 'quit', label: t('general.closeAction.quit') },
                    { value: 'tray', label: t('general.closeAction.tray') }
                  ]}
                  onChange={(closeAction) => void onUpdateSettings({ appBehavior: { closeAction, closeToTray: closeAction === 'tray' } })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.openAtLogin.label')} detail={t('general.openAtLogin.detail')}>
                <ToggleSwitch
                  checked={settings.appBehavior.openAtLogin}
                  onChange={(openAtLogin) => void onUpdateSettings({ appBehavior: { openAtLogin } })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.startMinimized.label')} detail={t('general.startMinimized.detail')}>
                <ToggleSwitch
                  checked={settings.appBehavior.startMinimized}
                  onChange={(startMinimized) => void onUpdateSettings({ appBehavior: { startMinimized } })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.log.label')} detail={t('general.log.detail', { state: settings.log.enabled ? t('general.log.enabled') : t('general.log.disabled'), days: settings.log.retentionDays })}>
                <div className="settings-inline-group">
                  <ToggleSwitch
                    checked={settings.log.enabled}
                    onChange={(enabled) => void onUpdateSettings({ log: { enabled } })}
                  />
                  <NumberInput
                    max={90}
                    min={1}
                    step={1}
                    value={settings.log.retentionDays}
                    onChange={(retentionDays) => void onUpdateSettings({ log: { retentionDays } })}
                  />
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'appearance' && (
          <SettingsPanel
            title={t('appearance.title')}
            subtitle={t('appearance.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('general.theme.label')} detail={t('general.theme.detail')}>
                <SegmentedControl
                  value={settings.theme}
                  options={[
                    { value: 'system', label: t('general.theme.system'), icon: Monitor },
                    { value: 'light', label: t('general.theme.light'), icon: Sun },
                    { value: 'dark', label: t('general.theme.dark'), icon: Moon }
                  ]}
                  onChange={(theme) => void onUpdateSettings({ theme })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.density.label')} detail={settings.density === 'compact' ? t('general.density.compact') : t('general.density.comfortable')}>
                <SegmentedControl
                  value={settings.density}
                  options={[
                    { value: 'comfortable', label: t('general.density.comfortable') },
                    { value: 'compact', label: t('general.density.compact') }
                  ]}
                  onChange={(density) => void onUpdateSettings({ density })}
                />
              </SettingsRow>
              <SettingsRow label={t('general.fontScale.label')} detail={`${Math.round(settings.uiFontScale * 100)}%`}>
                <input
                  className="settings-range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  type="range"
                  value={settings.uiFontScale}
                  onChange={(event) => void onUpdateSettings({ uiFontScale: Number(event.target.value) })}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'model' && (
          <SettingsPanel
            title={t('model.title')}
            subtitle={t('model.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label="Provider">
                  <SettingsSelect
                    value={activeModelSettingsProvider.id}
                    options={visibleModelProviders.map((provider) => ({
                      value: provider.id,
                      label: provider.id === 'custom' ? 'Custom' : provider.name
                    }))}
                    onChange={selectModelProvider}
                  />
                </SettingsRow>
                <SettingsRow label={t('model.apiKey.label')}>
                  <div className="settings-inline-group">
                    <SettingsTextInput
                      type={apiKeyVisible ? 'text' : 'password'}
                      value={activeModelSettingsProvider.apiKey}
                      placeholder={t('model.apiKey.placeholder')}
                      onChange={(apiKey) => updateProvider({ apiKey })}
                    />
                    <button
                      className="icon-button soft"
                      type="button"
                      aria-label={apiKeyVisible ? t('model.apiKey.hide') : t('model.apiKey.show')}
                      title={apiKeyVisible ? t('model.apiKey.hide') : t('model.apiKey.show')}
                      onClick={() => setApiKeyVisible((visible) => !visible)}
                    >
                      {apiKeyVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </SettingsRow>
                <SettingsRow label={t('model.baseUrl')}>
                  <SettingsTextInput
                    value={activeModelSettingsProvider.baseUrl}
                    onChange={(baseUrl) => updateProvider({ baseUrl })}
                  />
                </SettingsRow>
                <SettingsRow label={t('model.models.label')}>
                  {isCustomModelProvider ? (
                    <SettingsTextInput
                      value={activeModelValue}
                      onChange={(model) => updateProviderModels(model ? [model] : [])}
                    />
                  ) : (
                    <SettingsSelect
                      value={
                        activeModelSettingsProvider.models.includes(settings.generator.model)
                          ? settings.generator.model
                          : (activeModelSettingsProvider.models[0] ?? '')
                      }
                      options={activeModelSettingsProvider.models.map((model) => ({ value: model, label: model }))}
                      onChange={(model) => {
                        updateProviderModels([
                          model,
                          ...activeModelSettingsProvider.models.filter((item) => item !== model)
                        ])
                      }}
                    />
                  )}
                </SettingsRow>
                <SettingsRow label={t('reasoning.title')} detail={t('reasoning.settingsDetail')}>
                  <SegmentedControl
                    value={selectedReasoningEffort(settings)}
                    options={reasoningEffortOptionsForSettings(settings).map((effort) => ({
                      value: effort,
                      label: reasoningEffortLabel(effort),
                      icon: BrainCircuit
                    }))}
                    onChange={(reasoningEffort) => void onUpdateSettings({ generator: { reasoningEffort } })}
                  />
                </SettingsRow>
                <SettingsRow label={t('model.actions.label')}>
                  <div className="settings-actions">
                    <button className="ghost-button" type="button" onClick={() => void probeActiveProvider()} disabled={providerBusy}>
                      {providerBusy ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />}
                      {t('model.actions.test')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void pullActiveProviderModels()} disabled={providerBusy || activeModelSettingsProvider.endpointFormat === 'custom_endpoint'}>
                      <RefreshCw size={15} />
                      {t('model.actions.pull')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeModelSettingsProvider.docsUrl)} disabled={isCustomModelProvider || !activeModelSettingsProvider.docsUrl}>
                      <ExternalLink size={15} />
                      {t('model.actions.docs')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void onOpenExternal(activeModelSettingsProvider.apiKeyUrl)} disabled={isCustomModelProvider || !activeModelSettingsProvider.apiKeyUrl}>
                      <KeyRound size={15} />
                      {t('model.actions.key')}
                    </button>
                    <button className="ghost-button" type="button" onClick={() => void resetActiveProviderToPreset()}>
                      <RefreshCw size={15} />
                      {t('model.actions.reset')}
                    </button>
                  </div>
                </SettingsRow>
                {providerStatus ? (
                  <div className="settings-empty-note" role="status" aria-live="polite">
                    {providerStatus}
                  </div>
                ) : null}
              </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'generation' && (
          <SettingsPanel
            title={t('generation.title')}
            subtitle={t('generation.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('generation.provider')} detail={activeProvider.name}>
                <SettingsSelect
                  value={settings.generator.providerId}
                  options={settings.provider.providers.map((provider) => ({
                    value: provider.id,
                    label: provider.name
                  }))}
                  onChange={selectProvider}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.model.label')} detail={settings.generator.model || t('generation.model.none')}>
                <SettingsSelect
                  value={settings.generator.model}
                  options={activeProvider.models.map((model) => ({ value: model, label: model }))}
                  onChange={(model) => void onUpdateSettings({ generator: { model } })}
                />
              </SettingsRow>
              <SettingsRow label={t('reasoning.title')} detail={reasoningEffortDescription(selectedReasoningEffort(settings))}>
                <SegmentedControl
                  value={selectedReasoningEffort(settings)}
                  options={reasoningEffortOptionsForSettings(settings).map((effort) => ({
                    value: effort,
                    label: reasoningEffortLabel(effort),
                    icon: BrainCircuit
                  }))}
                  onChange={(reasoningEffort) => void onUpdateSettings({ generator: { reasoningEffort } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.temperature')} detail={settings.generator.temperature.toFixed(2)}>
                <NumberInput
                  max={2}
                  min={0}
                  step={0.05}
                  value={settings.generator.temperature}
                  onChange={(temperature) => void onUpdateSettings({ generator: { temperature } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.maxTokens')} detail={`${settings.generator.maxOutputTokens}`}>
                <NumberInput
                  max={32768}
                  min={512}
                  step={256}
                  value={settings.generator.maxOutputTokens}
                  onChange={(maxOutputTokens) => void onUpdateSettings({ generator: { maxOutputTokens } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.duration.label')} detail={t('generation.duration.detail', { count: settings.generator.lessonDurationMinutes })}>
                <NumberInput
                  max={60}
                  min={5}
                  step={1}
                  value={settings.generator.lessonDurationMinutes}
                  onChange={(lessonDurationMinutes) => void onUpdateSettings({ generator: { lessonDurationMinutes } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.retrieval.label')} detail={t('generation.retrieval.detail')}>
                <ToggleSwitch
                  checked={settings.generator.includeRetrievalPractice}
                  onChange={(includeRetrievalPractice) => void onUpdateSettings({ generator: { includeRetrievalPractice } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.reference.label')} detail={t('generation.reference.detail')}>
                <ToggleSwitch
                  checked={settings.generator.generateReference}
                  onChange={(generateReference) => void onUpdateSettings({ generator: { generateReference } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.learningRecord.label')} detail={t('generation.learningRecord.detail')}>
                <ToggleSwitch
                  checked={settings.generator.generateLearningRecord}
                  onChange={(generateLearningRecord) => void onUpdateSettings({ generator: { generateLearningRecord } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.structured.label')} detail={t('generation.structured.detail')}>
                <ToggleSwitch
                  checked={settings.generator.structuredOutput}
                  onChange={(structuredOutput) => void onUpdateSettings({ generator: { structuredOutput } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.streaming.label')} detail={t('generation.streaming.detail')}>
                <ToggleSwitch
                  checked={settings.generator.streaming}
                  onChange={(streaming) => void onUpdateSettings({ generator: { streaming } })}
                />
              </SettingsRow>
              <SettingsRow label={t('generation.timeout.label')} detail={t('generation.timeout.detail', { seconds: Math.round(settings.generator.requestTimeoutMs / 1000) })}>
                <NumberInput
                  max={300000}
                  min={5000}
                  step={5000}
                  value={settings.generator.requestTimeoutMs}
                  onChange={(requestTimeoutMs) => void onUpdateSettings({ generator: { requestTimeoutMs } })}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'tools' && (
          <SettingsPanel
            title="工具调用"
            subtitle="允许 Agent 与课程生成调用 web 搜索等工具"
          >
            <SettingsCard>
              <SettingsRow label="启用工具调用" detail="开启后 Agent 与课程生成可调用工具">
                <ToggleSwitch
                  checked={settings.tools.enabled}
                  onChange={(enabled) => void onUpdateSettings({ tools: { enabled } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="工作区文件工具" detail="允许 Agent 列出、读取、搜索、写入当前教学工作区文件">
                <ToggleSwitch
                  checked={settings.tools.workspaceRead}
                  onChange={(workspaceRead) => void onUpdateSettings({ tools: { workspaceRead } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="web_search（多后端）" detail="自动使用 SearXNG、Brave Search 或 DuckDuckGo Lite 检索最新和课程外信息">
                <ToggleSwitch
                  checked={settings.tools.webSearch}
                  onChange={(webSearch) => void onUpdateSettings({ tools: { webSearch } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="web_fetch" detail="抓取指定 URL 正文（带 SSRF 防护）">
                <ToggleSwitch
                  checked={settings.tools.webFetch}
                  onChange={(webFetch) => void onUpdateSettings({ tools: { webFetch } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="最大工具调用轮数" detail={`默认 ${8}，控制单次任务的最大工具往返（教学对话中生成课程也算一轮）`}>
                <NumberInput
                  max={12}
                  min={1}
                  step={1}
                  value={settings.tools.maxIterations}
                  onChange={(maxIterations) => void onUpdateSettings({ tools: { maxIterations } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="端点格式支持" detail={
                settings.generator.endpointFormat === 'chat_completions' || settings.generator.endpointFormat === 'custom_endpoint'
                  ? `当前「${settings.generator.endpointFormat}」支持工具调用`
                  : `当前「${settings.generator.endpointFormat}」不支持工具调用，将降级为纯文本`
              }>
                <span style={{ fontSize: 13, color: '#68778f' }}>
                  {settings.generator.endpointFormat}
                </span>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'search' && (
          <SettingsPanel
            title="搜索配置"
            subtitle="选择 web_search 的后端，并配置 Firecrawl、Parallel、Tavily、Exa、SearXNG、Brave、DDGS 或 xAI。"
          >
            <SettingsCard>
              <SettingsRow label="搜索后端" detail={`当前：${webSearchBackendLabel(settings.webSearch.backend)}`}>
                <SettingsSelect<WebSearchBackend>
                  value={settings.webSearch.backend}
                  options={webSearchBackendOptions}
                  onChange={(backend) => void onUpdateSettings({ webSearch: { backend } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="失败自动回退" detail="Auto 模式下某个后端失败或返回空结果时继续尝试下一个。">
                <ToggleSwitch
                  checked={settings.webSearch.fallbackEnabled}
                  onChange={(fallbackEnabled) => void onUpdateSettings({ webSearch: { fallbackEnabled } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="默认结果数" detail={`${settings.webSearch.maxResults} 条`}>
                <NumberInput
                  max={20}
                  min={1}
                  step={1}
                  value={settings.webSearch.maxResults}
                  onChange={(maxResults) => void onUpdateSettings({ webSearch: { maxResults } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
            </SettingsCard>

            <SettingsCard>
              <SettingsRow label="Firecrawl API Key" detail="用于 Firecrawl 云端搜索。自托管实例可只填 API URL。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.firecrawlApiKey}
                  placeholder="fc-..."
                  onChange={(firecrawlApiKey) => void onUpdateSettings({ webSearch: { firecrawlApiKey } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="Firecrawl API URL" detail="留空使用 https://api.firecrawl.dev；自托管时填写实例地址。">
                <SettingsTextInput
                  value={settings.webSearch.firecrawlApiUrl}
                  placeholder="http://localhost:3002"
                  onChange={(firecrawlApiUrl) => void onUpdateSettings({ webSearch: { firecrawlApiUrl } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="Parallel API Key" detail="agentic 会映射到 pro processor；fast / one-shot 映射到 base。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.parallelApiKey}
                  placeholder="Parallel API Key"
                  onChange={(parallelApiKey) => void onUpdateSettings({ webSearch: { parallelApiKey } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="Parallel 搜索模式" detail={settings.webSearch.parallelSearchMode}>
                <SettingsSelect
                  value={settings.webSearch.parallelSearchMode}
                  options={parallelSearchModeOptions}
                  onChange={(parallelSearchMode) => void onUpdateSettings({ webSearch: { parallelSearchMode } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="Tavily API Key" detail="用于 Tavily Search API。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.tavilyApiKey}
                  placeholder="tvly-..."
                  onChange={(tavilyApiKey) => void onUpdateSettings({ webSearch: { tavilyApiKey } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="Exa API Key" detail="用于 Exa 语义搜索。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.exaApiKey}
                  placeholder="Exa API Key"
                  onChange={(exaApiKey) => void onUpdateSettings({ webSearch: { exaApiKey } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="SearXNG URL" detail="自托管或可信实例地址；需要启用 JSON format。">
                <SettingsTextInput
                  value={settings.webSearch.searxngUrl}
                  placeholder="http://localhost:8888"
                  onChange={(searxngUrl) => void onUpdateSettings({ webSearch: { searxngUrl } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="Brave Search API Key" detail="Brave Search Data API。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.braveApiKey}
                  placeholder="Brave Search API Key"
                  onChange={(braveApiKey) => void onUpdateSettings({ webSearch: { braveApiKey } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="xAI API Key" detail="显式选择 xAI 后通过 Grok server-side web_search 搜索。">
                <SettingsTextInput
                  type={settings.privacy.maskApiKeys ? 'password' : 'text'}
                  value={settings.webSearch.xaiApiKey}
                  placeholder="xai-..."
                  onChange={(xaiApiKey) => void onUpdateSettings({ webSearch: { xaiApiKey } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
              <SettingsRow label="xAI 模型" detail="用于 Responses API 的 Grok 模型。">
                <SettingsTextInput
                  value={settings.webSearch.xaiModel}
                  placeholder="grok-4.3"
                  onChange={(xaiModel) => void onUpdateSettings({ webSearch: { xaiModel } } as TeachingSettingsPatch)}
                />
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'workspace' && (
          <SettingsPanel
            title={t('workspace.title')}
            subtitle={t('workspace.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('workspace.defaultRoot.label')} detail={settings.workspace.defaultRoot || t('workspace.defaultRoot.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onPickDefaultRoot()}>
                    <FolderOpen size={15} />
                    {t('workspace.defaultRoot.choose')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onOpenPath(settings.workspace.defaultRoot)} disabled={!settings.workspace.defaultRoot}>
                    <ArrowUpRight size={15} />
                    {t('workspace.defaultRoot.open')}
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label={t('workspace.confirm.label')} detail={t('workspace.confirm.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.confirmBeforeGenerating}
                  onChange={(confirmBeforeGenerating) => void onUpdateSettings({ workspace: { confirmBeforeGenerating } })}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.autoOpen.label')} detail={t('workspace.autoOpen.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.autoOpenGeneratedLesson}
                  onChange={(autoOpenGeneratedLesson) => void onUpdateSettings({ workspace: { autoOpenGeneratedLesson } })}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.showAllCourseFiles.label')} detail={t('workspace.showAllCourseFiles.detail')}>
                <ToggleSwitch
                  checked={settings.workspace.showAllCourseFiles}
                  onChange={(showAllCourseFiles) => void onUpdateSettings({ workspace: { showAllCourseFiles } })}
                />
              </SettingsRow>
              <SettingsRow label={t('workspace.current.label')} detail={activeWorkspace?.rootPath ?? t('workspace.current.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onCreateWorkspace()}>
                    <Plus size={15} />
                    {t('workspace.current.create')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void onImportWorkspace()}>
                    <Upload size={15} />
                    {t('workspace.current.import')}
                  </button>
                  <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                    <ArrowUpRight size={15} />
                    {t('workspace.current.open')}
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'worktree' && (
          <SettingsPanel
            title={t('worktree.title')}
            subtitle={t('worktree.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('worktree.root.label')} detail={worktreeRootPath || t('worktree.root.none')}>
                <div className="settings-actions">
                  <button className="ghost-button" type="button" onClick={() => void onOpenPath(worktreeRootPath)} disabled={!worktreeRootPath}>
                    <ArrowUpRight size={15} />
                    {t('worktree.root.open')}
                  </button>
                </div>
              </SettingsRow>
              <SettingsRow label={t('worktree.current.label')} detail={activeWorkspace?.git?.repositoryRoot ?? t('worktree.current.none')}>
                <div className="settings-inline-group">
                  <span className="settings-status-badge">
                    {activeWorkspace?.git?.currentBranch ?? t('worktree.current.notGit')}
                  </span>
                  <button className="ghost-button" type="button" onClick={() => void refreshWorktrees()} disabled={!activeWorkspace || worktreeLoading}>
                    {worktreeLoading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
                    {t('worktree.refresh')}
                  </button>
                </div>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard>
              {worktreeResult?.ok === false ? (
                <div className="settings-empty-note">{worktreeResult.message}</div>
              ) : !worktreeResult?.ok || worktreeResult.worktrees.length === 0 ? (
                <div className="settings-empty-note">{t('worktree.empty')}</div>
              ) : (
                worktreeResult.worktrees.map((worktree) => (
                  <div className="settings-list-row" key={worktree.path}>
                    <div className="settings-list-copy">
                      <strong>{worktree.branch ?? t('worktree.detached')}</strong>
                      <span>{worktree.path}</span>
                      <span>
                        {worktree.isPrimary ? t('worktree.primary') : t('worktree.linked')}
                        {worktree.createdAt ? ` · ${new Date(worktree.createdAt).toLocaleString(settings.locale)}` : ''}
                      </span>
                    </div>
                    <div className="settings-row-control">
                      <button
                        className="ghost-button danger"
                        type="button"
                        disabled={worktree.isPrimary || worktreeBusyPath === worktree.path}
                        onClick={() => void removeWorktree(worktree.path)}
                      >
                        {worktreeBusyPath === worktree.path ? <Loader2 className="spin" size={15} /> : <X size={15} />}
                        {t('worktree.remove')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'memory' && (
          <SettingsPanel
            title={t('memory.title')}
            subtitle={t('memory.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('memory.enable.label')} detail={t('memory.enable.detail')}>
                <ToggleSwitch
                  checked={settings.memory.enabled}
                  onChange={(enabled) => void onUpdateSettings({ memory: { enabled } })}
                />
              </SettingsRow>
              <SettingsRow label={t('memory.maxInjected.label')} detail={t('memory.maxInjected.detail', { count: settings.memory.maxInjected })}>
                <NumberInput
                  min={1}
                  max={12}
                  step={1}
                  value={settings.memory.maxInjected}
                  onChange={(maxInjected) => void onUpdateSettings({ memory: { maxInjected } })}
                />
              </SettingsRow>
              <SettingsRow label={t('memory.diagnostics.label')} detail={memoryDiagnostics ? t('memory.diagnostics.detail', { active: memoryDiagnostics.activeCount, deleted: memoryDiagnostics.tombstoneCount }) : t('memory.diagnostics.loading')}>
                <button className="ghost-button" type="button" onClick={() => void onLoadMemoryDiagnostics()}>
                  <RefreshCw size={15} />
                  {t('memory.refresh')}
                </button>
              </SettingsRow>
            </SettingsCard>

            <SettingsCard>
              <div className="settings-toolbar">
                <div className="settings-filter-group">
                  {(['all', 'user', 'workspace', 'project'] as const).map((scope) => (
                    <button
                      key={scope}
                      className={memoryScopeFilter === scope ? 'is-active' : ''}
                      type="button"
                      onClick={() => setMemoryScopeFilter(scope)}
                    >
                      {t(`memory.scope.${scope}`)}
                    </button>
                  ))}
                </div>
                <button className="ghost-button strong" type="button" onClick={beginCreateMemory}>
                  <Plus size={15} />
                  {t('memory.create')}
                </button>
              </div>

              {filteredMemoryRecords.length === 0 ? (
                <div className="settings-empty-note">{t('memory.empty')}</div>
              ) : (
                filteredMemoryRecords.map((memory) => (
                  <div className="settings-list-row" key={memory.id}>
                    <div className="settings-list-copy">
                      <strong>{memory.content}</strong>
                      <span>{[memory.scope, ...(memory.tags ?? [])].join(' · ')}</span>
                      <span>{memory.disabledAt ? t('memory.disabled') : t('memory.confidence', { value: memory.confidence.toFixed(2) })}</span>
                    </div>
                    <div className="settings-row-control">
                      <div className="settings-actions">
                        <button className="ghost-button" type="button" onClick={() => setMemoryDialog({ mode: 'view', memory })}>
                          <Info size={15} />
                          {t('memory.view')}
                        </button>
                        <button className="ghost-button" type="button" onClick={() => beginEditMemory(memory)}>
                          <FileCheck2 size={15} />
                          {t('memory.edit')}
                        </button>
                        <button className="ghost-button" type="button" disabled={Boolean(memory.disabledAt)} onClick={() => void onUpdateMemory(memory.id, { disabled: true, workspaceRoot: activeWorkspace?.rootPath })}>
                          <Minus size={15} />
                          {t('memory.disable')}
                        </button>
                        <button className="ghost-button danger" type="button" onClick={() => void onDeleteMemory(memory.id, activeWorkspace?.rootPath)}>
                          <X size={15} />
                          {t('memory.delete')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </SettingsCard>

            {memoryDialog && (
              <MemoryDialog
                dialog={memoryDialog}
                draft={memoryDraft}
                locale={settings.locale}
                onChange={setMemoryDraft}
                onClose={() => setMemoryDialog(null)}
                onSave={() => void saveMemoryDraft()}
                t={t}
              />
            )}
          </SettingsPanel>
        )}

        {section === 'notifications' && (
          <SettingsPanel
            title={t('notifications.title')}
            subtitle={t('notifications.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('notifications.enabled.label')} detail={settings.notifications.enabled ? t('notifications.enabled.on') : t('notifications.enabled.off')}>
                <ToggleSwitch
                  checked={settings.notifications.enabled}
                  onChange={(enabled) => void onUpdateSettings({ notifications: { enabled } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.lesson.label')} detail={t('notifications.lesson.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.lessonGenerated}
                  onChange={(lessonGenerated) => void onUpdateSettings({ notifications: { lessonGenerated } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.imported.label')} detail={t('notifications.imported.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.workspaceImported}
                  onChange={(workspaceImported) => void onUpdateSettings({ notifications: { workspaceImported } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.errors.label')} detail={t('notifications.errors.detail')}>
                <ToggleSwitch
                  checked={settings.notifications.errors}
                  onChange={(errors) => void onUpdateSettings({ notifications: { errors } })}
                />
              </SettingsRow>
              <SettingsRow label={t('notifications.test.label')} detail={t('notifications.test.detail')}>
                <button className="ghost-button" type="button" onClick={() => void onTestNotification()}>
                  <Bell size={15} />
                  {t('notifications.test.button')}
                </button>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'privacy' && (
          <SettingsPanel
            title={t('privacy.title')}
            subtitle={t('privacy.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('privacy.maskKey.label')} detail={t('privacy.maskKey.detail')}>
                <ToggleSwitch
                  checked={settings.privacy.maskApiKeys}
                  onChange={(maskApiKeys) => void onUpdateSettings({ privacy: { maskApiKeys } })}
                />
              </SettingsRow>
              <SettingsRow label={t('privacy.externalLinks.label')} detail={t('privacy.externalLinks.detail')}>
                <ToggleSwitch
                  checked={settings.privacy.allowExternalLinks}
                  onChange={(allowExternalLinks) => void onUpdateSettings({ privacy: { allowExternalLinks } })}
                />
              </SettingsRow>
              <SettingsRow label={t('privacy.proxy.label')} detail={settings.provider.proxy.enabled ? (settings.provider.proxy.url || t('privacy.proxy.on')) : t('privacy.proxy.off')}>
                <div className="settings-inline-group">
                  <ToggleSwitch
                    checked={settings.provider.proxy.enabled}
                    onChange={(enabled) => void onUpdateSettings({ provider: { proxy: { enabled } } })}
                  />
                  <SettingsTextInput
                    value={settings.provider.proxy.url}
                    placeholder={t('privacy.proxy.placeholder')}
                    onChange={(url) => void onUpdateSettings({ provider: { proxy: { url } } })}
                  />
                </div>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}

        {section === 'about' && (
          <SettingsPanel
            title={t('about.title')}
            subtitle={t('about.subtitle')}
          >
            <SettingsCard>
              <SettingsRow label={t('about.runtime')} detail={runtimeProviderLabel(settings)}>
                <span className="settings-status-badge">{settings.generator.streaming ? t('about.streaming') : t('about.oneShot')}</span>
              </SettingsRow>
              <SettingsRow label={t('about.currentWorkspace.label')} detail={activeWorkspace?.rootPath ?? t('about.currentWorkspace.none')}>
                <button className="ghost-button" type="button" onClick={() => activeWorkspace && void onOpenPath(activeWorkspace.rootPath)} disabled={!activeWorkspace}>
                  <FolderOpen size={15} />
                  {t('about.currentWorkspace.open')}
                </button>
              </SettingsRow>
              <SettingsRow label={t('about.logFile.label')} detail={t('about.logFile.detail', { days: settings.log.retentionDays })}>
                <button className="ghost-button" type="button" onClick={() => void onOpenLogFile()}>
                  <FileText size={15} />
                  {t('about.logFile.open')}
                </button>
              </SettingsRow>
              <SettingsRow label={t('about.appData.label')} detail={t('about.appData.detail')}>
                <button className="ghost-button" type="button" onClick={() => void onOpenAppDataDir()}>
                  <ArrowUpRight size={15} />
                  {t('about.appData.open')}
                </button>
              </SettingsRow>
            </SettingsCard>
          </SettingsPanel>
        )}
      </div>
      </section>
    </div>
  )
}

function SettingsPanel({
  title,
  subtitle,
  children
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="settings-panel">
      <div className="settings-panel-heading">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="settings-panel-body">{children}</div>
    </div>
  )
}

function SettingsCard({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`settings-card ${className}`}>{children}</div>
}

function SettingsRow({
  label,
  detail,
  children
}: {
  label: string
  detail?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-copy">
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      className="toggle-switch"
      data-state={checked ? 'checked' : 'unchecked'}
      role="switch"
      aria-checked={checked}
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function SegmentedControl<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: LucideIcon }>
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented-control">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            className={option.value === value ? 'is-active' : ''}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon size={14} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function SettingsTextInput({
  value,
  placeholder,
  type = 'text',
  onChange
}: {
  value: string
  placeholder?: string
  type?: 'text' | 'password'
  onChange: (value: string) => void
}) {
  return (
    <input
      className="settings-input"
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

function SettingsSelect<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    setHighlightedIndex(Math.max(0, options.findIndex((option) => option.value === value)))
  }, [options, value])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const toggleOpen = (): void => {
    if (!options.length) return
    setOpen((current) => !current)
  }

  const selectOption = (nextValue: T): void => {
    onChange(nextValue)
    setOpen(false)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (!options.length) return

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) {
        const option = options[highlightedIndex] ?? selectedOption
        if (option) selectOption(option.value)
        return
      }
      setOpen(true)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setHighlightedIndex((current) => {
        const baseIndex = current < 0 ? Math.max(0, options.findIndex((option) => option.value === value)) : current
        return (baseIndex + direction + options.length) % options.length
      })
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setOpen(true)
      setHighlightedIndex(Math.max(0, options.length - 1))
    }
  }

  return (
    <div className={`settings-select ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        className="settings-select-trigger"
        type="button"
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
      >
        <span className="settings-select-trigger-copy">
          <span className="settings-select-trigger-value">{selectedOption?.label ?? ''}</span>
        </span>
        <ChevronDown className="settings-select-trigger-icon" size={15} />
      </button>

      {open && (
        <div className="settings-select-menu" id={listId} role="listbox" aria-activedescendant={`${listId}-${highlightedIndex}`}>
          {options.map((option, index) => {
            const selected = option.value === value
            const highlighted = index === highlightedIndex
            return (
              <button
                aria-selected={selected}
                className={`settings-select-option ${selected ? 'is-selected' : ''} ${highlighted ? 'is-highlighted' : ''}`}
                id={`${listId}-${index}`}
                key={option.value}
                role="option"
                type="button"
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option.value)}
              >
                <span>{option.label}</span>
                {selected && <CheckCircle2 size={14} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NumberInput({
  value,
  min,
  max,
  step,
  onChange
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <input
      className="settings-number"
      max={max}
      min={min}
      step={step}
      type="number"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  )
}

function MemoryDialog({
  dialog,
  draft,
  locale,
  onChange,
  onClose,
  onSave,
  t
}: {
  dialog: { mode: 'create' } | { mode: 'edit' | 'view'; memory: TeachingMemoryRecord }
  draft: { content: string; scope: TeachingMemoryScope; tags: string; confidence: number }
  locale: string
  onChange: (draft: { content: string; scope: TeachingMemoryScope; tags: string; confidence: number }) => void
  onClose: () => void
  onSave: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const editable = dialog.mode !== 'view'
  const memory = dialog.mode === 'create' ? null : dialog.memory
  const title = dialog.mode === 'create'
    ? t('memory.dialog.create')
    : dialog.mode === 'edit'
      ? t('memory.dialog.edit')
      : t('memory.dialog.view')

  return (
    <div className="memory-dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="memory-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="memory-dialog-header">
          <div>
            <strong>{title}</strong>
            {memory && (
              <span>
                {memory.scope} · {new Date(memory.updatedAt).toLocaleString(locale)}
              </span>
            )}
          </div>
          <button className="settings-close-button" type="button" onClick={onClose} aria-label={t('memory.dialog.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="memory-dialog-body">
          {editable ? (
            <>
              <textarea
                className="settings-textarea"
                value={draft.content}
                placeholder={t('memory.dialog.contentPlaceholder')}
                onChange={(event) => onChange({ ...draft, content: event.target.value })}
              />
              <div className="settings-inline-group">
                {dialog.mode === 'create' && (
                  <SettingsSelect
                    value={draft.scope}
                    options={[
                      { value: 'workspace', label: t('memory.scope.workspace') },
                      { value: 'project', label: t('memory.scope.project') },
                      { value: 'user', label: t('memory.scope.user') }
                    ]}
                    onChange={(scope) => onChange({ ...draft, scope })}
                  />
                )}
                <SettingsTextInput
                  value={draft.tags}
                  placeholder={t('memory.dialog.tagsPlaceholder')}
                  onChange={(tags) => onChange({ ...draft, tags })}
                />
                <NumberInput
                  min={0}
                  max={1}
                  step={0.1}
                  value={draft.confidence}
                  onChange={(confidence) => onChange({ ...draft, confidence })}
                />
              </div>
            </>
          ) : (
            <div className="memory-dialog-readonly">{memory?.content}</div>
          )}
        </div>
        <div className="memory-dialog-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            {t('memory.dialog.cancel')}
          </button>
          {editable ? (
            <button className="ghost-button strong" type="button" onClick={onSave} disabled={!draft.content.trim()}>
              {t('memory.dialog.save')}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  )
}

// ================================================================
// Empty State Component
// ================================================================

function EmptyState({
  icon: Icon,
  title,
  detail,
  action
}: {
  icon: LucideIcon
  title: string
  detail: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="empty-state">
      <Icon size={20} />
      <div>
        <h3>{title}</h3>
        <p>{detail}</p>
        {action && (
          <button className="empty-state-action" type="button" onClick={action.onClick}>
            <Play size={13} />
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}

// ================================================================
// Helpers
// ================================================================

function runtimeMeterWidth(
  runtime: TeachingRuntimeState,
  active: TeachingWorkspaceSummary | null,
  generating: boolean
): string {
  if (runtime.status === 'error') return '12%'
  if (generating) return '48%'
  if (active?.lessons.length && active.records.length) return '82%'
  if (active?.lessons.length) return '64%'
  if (active) return '28%'
  return '16%'
}

function suggestedCourseName(workspace: TeachingWorkspaceSummary, prompt: string): string {
  const topic = prompt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^我想(先)?学习/, '')
    .replace(/^学习/, '')
    .replace(/^如何/, '')
    .split(/[。.!?？\n]/)[0]
    ?.trim()

  if (topic) return topic.slice(0, 32)
  return workspace.courses[0]?.name ?? workspace.name
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stepLabel(step: LessonStreamStatus['step']): string {
  const labels: Record<LessonStreamStatus['step'], string> = {
    calling: 'calling model',
    streaming: 'streaming output',
    validating: 'validating JSON',
    rendering: 'rendering artifacts',
    done: 'done',
    error: 'error'
  }
  return labels[step]
}

function prettyJson(value: string): string {
  if (!value) return ''
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function streamingPreviewHtml(liveText: string, workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:760px;margin:0 auto;padding:38px 30px}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}pre{white-space:pre-wrap;line-height:1.7;color:#40506a;background:#f4f7fb;border:1px solid #e8edf5;border-radius:16px;padding:18px;min-height:180px}
</style></head><body><main><div class="badge">TeachOS · Streaming</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(i18n.t('preview.streamingHint'))}</p><pre>${escapeHtml(liveText || i18n.t('preview.streamingPlaceholder'))}</pre></main></body></html>`
}

function emptyPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:680px;margin:0 auto;padding:46px 34px}p{color:#68778f;line-height:1.8}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}
</style></head><body><main><div class="badge">TeachOS</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(workspace.missionExcerpt)}</p><p>${escapeHtml(i18n.t('preview.emptyHint'))}</p></main></body></html>`
}

function loadingPreviewHtml(workspace: TeachingWorkspaceSummary): string {
  return `<!doctype html><html lang="${i18n.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{display:grid;place-items:center;min-height:360px;padding:34px}p{color:#68778f}
</style></head><body><main><div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(i18n.t('preview.loadingHint'))}</p></div></main></body></html>`
}

export { App, AppErrorBoundary }
