import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookCopy,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GraduationCap,
  History,
  Info,
  LibraryBig,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Play,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  X,
  Wrench
} from 'lucide-react'
import { WorkspaceWebRemoteControlTrigger } from './views/web-remote-control/WebRemoteControlDialog'
import type { TeachingPresentationSnapshot } from '../../shared/teaching-types/teaching-presentation'
import type { ErrorInfo, FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Component, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import i18n from './i18n'
import { MarkdownEditor } from './markdown-editor'
import { MarkdownPreview } from './markdown-preview'
import { OfficeWorkbench } from './views/workbench/OfficeWorkbench'
import {
  defaultSidebarWidth,
  DesktopAppFrame,
  resolveSidebarResizePolicy,
  resolveWindowChromePolicy,
  SidebarResizeHandle
} from './app-frame/window-chrome'
import {
  lessonToCoursePreviewFile,
  mergeAgentInputHistory,
  sameRelativePath,
  titleFromFileName,
  toUserError,
  useAppStore,
  userTurnInputHistory,
  type DialogMode
} from './app-shell/appStore'
import { TeachingWorkspaceNavigator } from './app-shell/teaching-workspace-navigator'
import { LessonStyleGallery } from './views/resources/LessonStyleGallery'
import { PetLibrary } from './views/resources/PetLibrary'
import { SkillLibrary } from './views/resources/SkillLibrary'
import { AppPet } from './views/pet/AppPet'
import { PetSprite } from './views/pet/PetSprite'
import { useSkillCatalog } from './skills/skillCatalog'
import { useSkillSlashInput } from './skills/SkillSlashMenu'
import { mergeComposerSkillIds, useSkillCapabilityPicker } from './skills/SkillCapabilityPicker'
import { useTeachingComposerCommands } from './teaching/TeachingComposerCommandMenu'
import { isForbiddenTechnicalComposerToken, parseTeachingCommandInput, resolveTeachingCommandSubmission } from '../../shared/teaching-command'
import { SettingsView } from './views/settings/SettingsView'
import { AuthGate } from './sync/AuthGate'
import { useSyncState } from './sync/sync-store'
import {
  activeModelProvider,
  applySettingsSideEffects,
  DARK_THEME_MEDIA_QUERY,
  reasoningEffortDescription,
  reasoningEffortLabel,
  reasoningEffortOptionsForSettings,
  selectedReasoningEffort
} from './workflows/settings'
import {
  LESSON_STYLES,
  normalizeLessonStyleId,
  type LessonStyleId
} from '../../shared/lesson-styles'
import {
  projectVisibleAgentConversationWorkspaces
} from './agent-conversation-projection'
import {
  selectPendingAsk,
  selectPendingToolPermission,
} from './agent-conversation-state'
import { buildAgentConversationPresentation } from './agent-conversation-presentation'
import { AgentConversationReader } from './views/agent-conversation/AgentConversationReader'
import { buildTeachingTurnPresentationFromSnapshot, type TeachingTurnAction } from './teaching-turn-presentation'
import { ConversationInterruptionDock } from './views/agent-conversation/ConversationInterruptionDock'
import { AgentMessageActions, AgentMessageEditor } from './views/agent-conversation/AgentSessionTreePanel'
import {
  parsePreviewExternalHref,
  parsePreviewLessonInteractionMessage,
  parsePreviewMarkdownHref,
  PREVIEW_EXTERNAL_LINK_MESSAGE,
  PREVIEW_MARKDOWN_LINK_MESSAGE
} from '../../shared/preview-markdown-bridge'
import type { PreviewLessonInteractionIntent } from '../../shared/teaching-types/lesson-interaction'
import {
  createLearningOutcomeCommitClient,
  isPreviewCommitScopeCurrent,
  recordPreviewLessonInteractionAndMaybeCommit,
  type LearningOutcomeCommitUiStatus
} from './teaching/learning-outcome-commit-client'
import { LearningOutcomeCommitStatusBanner } from './teaching/learning-outcome-commit-status-banner'
import { sanitizeAgentTurnContent } from '../../shared/agent-conversation-turns'
import { formatAskRemainingLabel } from '../../shared/ask-deadline'
import {
  type AgentChatTurn,
  type AgentToolPermissionRequest,
  type AskAnswer,
  type AskQuestion,
  type TeachingGitBranchRow,
  type ModelReasoningEffort,
  type TeachingWorkspaceChangedFile,
  type TeachingWorkspaceChangeSummary,
  type TeachingWorkspaceSummary,
  type WorkspaceMarkdownDocument,
  type WorkspaceView,
  type AgentApprovalMode
} from '../../shared/teaching-types'

// ================================================================
// Constants
// ================================================================

const navItems = [
  { id: 'overview', icon: Bot },
  { id: 'resources', icon: LibraryBig },
  { id: 'workbench', icon: Wrench }
] satisfies Array<{ id: WorkspaceView; icon: LucideIcon }>

function isInputComposing(event: ReactKeyboardEvent<HTMLElement>): boolean {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number }
  return Boolean(nativeEvent.isComposing || nativeEvent.keyCode === 229)
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
    console.error('[StudiumX] uncaught render error:', error, info.componentStack)
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
// Main App Component
// ================================================================

function App() {
  const chrome = resolveWindowChromePolicy(window.teachingSystem?.platform ?? 'win32')
  const { settings, sidebarCollapsed, setSidebarCollapsed } = useAppStore()
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth)
  const sidebarResizePolicy = resolveSidebarResizePolicy(sidebarCollapsed)
  // Suppress the floating pet until the user is past the auth gate so it
  // never overlays the login/splash screen.
  const syncState = useSyncState()
  const appAccessible = Boolean(syncState.accessToken)

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
      <DesktopAppFrame
        chrome={chrome}
        density={settings.density}
        floatingContent={appAccessible ? <AppPet /> : null}
        onSidebarToggle={() => setSidebarCollapsed(!useAppStore.getState().sidebarCollapsed)}
        sidebarCollapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
      >
        <AuthGate>
          <Sidebar />
          <SidebarResizeHandle policy={sidebarResizePolicy} onResize={setSidebarWidth} width={sidebarWidth} />
          <MainArea />
        </AuthGate>
      </DesktopAppFrame>
    </AppErrorBoundary>
  )
}

function SidebarToggleIcon({
  className,
  collapsed,
  size = 17
}: {
  className?: string
  collapsed: boolean
  size?: number
}) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose
  return <Icon className={className} size={size} strokeWidth={1.9} aria-hidden="true" />
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
    openWorkspaceTeachingMode,
    openSettings
  } = useAppStore()

  const active = appState.activeWorkspace
  const selectedLessonPath = appState.selectedLessonPath
  const selectedCourseRelativePath = useAppStore((s) => s.selectedCourseRelativePath)
  const selectedCourseWorkspaceId = useAppStore((s) => s.selectedCourseWorkspaceId)
  const lessonReaderOpen = useAppStore((s) => s.lessonReaderOpen)
  const selectedMarkdownDocument = useAppStore((s) => s.selectedMarkdownDocument)
  const loading = useAppStore((s) => s.loading)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const selectWorkspace = useAppStore((s) => s.selectWorkspace)
  const setOverviewDialogMode = useAppStore((s) => s.setOverviewDialogMode)
  const selectCourseFolder = useAppStore((s) => s.selectCourseFolder)
  const loadLesson = useAppStore((s) => s.loadLesson)
  const loadCourseHtmlFile = useAppStore((s) => s.loadCourseHtmlFile)
  const loadWorkspaceMarkdownFile = useAppStore((s) => s.loadWorkspaceMarkdownFile)
  const loadAgentConversation = useAppStore((s) => s.loadAgentConversation)
  const restorePendingAgentConversation = useAppStore((s) => s.restorePendingAgentConversation)
  const openPath = useAppStore((s) => s.openPath)
  const importWorkspace = useAppStore((s) => s.importWorkspace)
  const importWorkspacePath = useAppStore((s) => s.importWorkspacePath)
  const setWorkspaceItemMeta = useAppStore((s) => s.setWorkspaceItemMeta)
  const renameAgentConversation = useAppStore((s) => s.renameAgentConversation)
  const removeWorkspaceItem = useAppStore((s) => s.removeWorkspaceItem)
  const removeWorkspace = useAppStore((s) => s.removeWorkspace)

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
                  openWorkspaceTeachingMode()
                  return
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
        <TeachingWorkspaceNavigator
          workspaces={appState.workspaces}
          activeWorkspace={active}
          temporaryConversations={appState.temporaryConversations}
          selectedLessonPath={view === 'lessons' && (lessonReaderOpen || selectedMarkdownDocument) ? selectedLessonPath : null}
          selectedCourseRelativePath={selectedCourseRelativePath}
          selectedCourseWorkspaceId={selectedCourseWorkspaceId}
          view={view}
          activeConversationId={activeConversationId}
          pendingAgentConversation={pendingAgentConversation}
          showAllCourseFiles={settings.workspace.showAllCourseFiles}
          defaultRoot={settings.workspace.defaultRoot}
          loading={loading}
          onSelectWorkspace={selectWorkspace}
          onSetOverviewDialogMode={setOverviewDialogMode}
          onOpenWorkspaceTeachingMode={openWorkspaceTeachingMode}
          onSelectCourseFolder={selectCourseFolder}
          onLoadLesson={loadLesson}
          onLoadCourseHtmlFile={loadCourseHtmlFile}
          onLoadWorkspaceMarkdownFile={loadWorkspaceMarkdownFile}
          onLoadAgentConversation={loadAgentConversation}
          onRestorePendingAgentConversation={restorePendingAgentConversation}
          onOpenPath={openPath}
          onImportWorkspace={importWorkspace}
          onImportWorkspacePath={importWorkspacePath}
          onSetWorkspaceItemMeta={setWorkspaceItemMeta}
          onRenameAgentConversation={renameAgentConversation}
          onRemoveWorkspaceItem={removeWorkspaceItem}
          onRemoveWorkspace={removeWorkspace}
        />
      </div>

      <div className="sidebar-footer">
        <WorkspaceWebRemoteControlTrigger
          compact
          workspacePath={active?.rootPath}
          workspaceId={active?.id}
          initialTaskId={activeConversationId ?? undefined}
        />
        <button className="icon-button" type="button" aria-label={t('sidebar.settings')} onClick={() => openSettings('model')} title={t('sidebar.settings')}>
          <Settings size={16} />
        </button>
      </div>
    </aside>
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
        {acting ? <Loader2 size={13} className="spin" /> : null}
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
        {triggerLoading ? <Loader2 size={13} className="spin" /> : null}
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
                  <span className="overview-picker-option-body">
                    <span className="overview-picker-option-title">{reasoningEffortLabel(effort)}</span>
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

function MarkdownDocumentPanel({
  document,
  draft,
  saving,
  workspaceId,
  onDraftChange,
  onSave,
  onOpenExternal,
  onOpenWorkspaceMarkdown,
  onPreviewLessonInteraction
}: {
  document: WorkspaceMarkdownDocument
  draft: string
  saving: boolean
  workspaceId: string | null
  onDraftChange: (content: string) => void
  onSave: () => void
  onOpenExternal: (href: string) => void
  onOpenWorkspaceMarkdown: (relativePath: string) => void
  onPreviewLessonInteraction: (intent: PreviewLessonInteractionIntent) => void
}) {
  const { t } = useTranslation()
  const dirty = draft !== document.content

  return (
    <section className="markdown-document-panel" aria-label={document.title}>
      <div className="markdown-document-body">
        <div className="markdown-document-editor">
          <button
            className="icon-button markdown-document-save"
            type="button"
            aria-label={dirty ? t('markdown.save') : t('markdown.saved')}
            title={dirty ? t('markdown.save') : t('markdown.saved')}
            disabled={saving || !dirty}
            onClick={onSave}
          >
            {saving ? <Loader2 size={16} className="spin" /> : dirty ? <Save size={16} /> : <Check size={16} />}
          </button>
          <MarkdownEditor value={draft} onChange={onDraftChange} onSave={onSave} />
        </div>
        <div className="markdown-document-preview">
          <MarkdownPreview
            source={draft}
            workspaceId={workspaceId}
            documentRelativePath={document.relativePath}
            emptyTitle={t('markdown.emptyTitle')}
            emptyHint={t('markdown.emptyHint')}
            onOpenExternal={onOpenExternal}
            onOpenWorkspaceMarkdown={onOpenWorkspaceMarkdown}
            lessonInteraction={{ onIntent: onPreviewLessonInteraction }}
          />
        </div>
      </div>
    </section>
  )
}

// ================================================================
// Main Content Area
// ================================================================

export function previewLessonInteractionForCurrentIframe(
  event: Pick<MessageEvent, 'data' | 'source'>,
  lessonFrame: HTMLIFrameElement | null
): PreviewLessonInteractionIntent | null {
  const intent = parsePreviewLessonInteractionMessage(event.data)
  return intent && event.source === lessonFrame?.contentWindow ? intent : null
}

function MainArea() {
  const { t } = useTranslation()
  const lessonFrameRef = useRef<HTMLIFrameElement | null>(null)
  const learningOutcomeMountedRef = useRef(true)
  const [learningOutcomeCommitStatus, setLearningOutcomeCommitStatus] = useState<LearningOutcomeCommitUiStatus>({ kind: 'idle' })
  const [learningOutcomeRetryPending, setLearningOutcomeRetryPending] = useState(false)
  const learningOutcomeCommitClientRef = useRef(createLearningOutcomeCommitClient({
    commitLearningOutcome: (request) => {
      const api = window.teachingSystem
      if (!api) return Promise.reject(new Error('Teaching system API unavailable'))
      // Production sole-writer path: formal IPC via preload TeachingSystemApi.
      return api.commitLearningOutcome(request)
    },
    onStatusChange: (status) => {
      // Never setState after MainArea unmount (dispose also suppresses notify).
      if (!learningOutcomeMountedRef.current) return
      setLearningOutcomeCommitStatus(status)
      if (status.kind !== 'committing') setLearningOutcomeRetryPending(false)
    }
  }))
  const chrome = resolveWindowChromePolicy(window.teachingSystem?.platform ?? 'win32')
  const isWindows = chrome.adapter === 'windows'
  const showInlineSidebarToggle = chrome.sidebarTogglePlacement === 'inline-topbar'
  const {
    view,
    settingsSection,
    sidebarCollapsed,
    loading,
    error,
    appState,
    settings,
    lessonReaderOpen,
    selectedCoursePreviewFile,
    selectedResourcePreviewFile,
    selectedMarkdownDocument,
    markdownDraft,
    markdownSaving,
    setView,
    setSidebarCollapsed,
    openSettings,
    closeResourceHtmlPreview,
    pickDefaultRoot,
    initialize,
    updateSettings,
    createWorkspace,
    importWorkspace,
    applyLessonStyle,
    generateLesson,
    loadLesson,
    loadWorkspaceMarkdownFile,
    setMarkdownDraft,
    saveMarkdownDocument,
    openResourceHtmlPreview,
    openPath,
    openExternal,
    clearError,
    showNotification
  } = useAppStore()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const active = appState.activeWorkspace
  const selectedCourseWorkspaceId = useAppStore((s) => s.selectedCourseWorkspaceId)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const visibleConversationWorkspaces = useMemo(
    () => projectVisibleAgentConversationWorkspaces({
      workspaces: appState.workspaces,
      activeWorkspace: active,
      selectedCourseWorkspaceId,
      pendingAgentConversation
    }),
    [active, appState.workspaces, pendingAgentConversation, selectedCourseWorkspaceId]
  )
  const selectedCourseWorkspace = visibleConversationWorkspaces.selectedCourseWorkspace
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
  const readingMarkdown = view === 'lessons' && Boolean(selectedMarkdownDocument)
  const readingResourceHtml = view === 'resources' && Boolean(selectedResourcePreviewFile)
  const readingHtml = readingCourseHtml || readingResourceHtml
  const lessonFrameKey = selectedPreviewFile
    ? appState.previewUrl || `${appState.selectedLessonPath ?? selectedPreviewFile.relativePath}:${appState.previewHtml.length}`
    : 'empty-preview'
  const resourceFrameKey = selectedResourcePreviewFile
    ? `${selectedResourcePreviewFile.id}:${selectedResourcePreviewFile.html.length}`
    : 'empty-resource-preview'
  const [resourcePageSection, setResourcePageSection] = useState<'home' | 'styles' | 'skills' | 'pets'>('home')
  const [changeDiff, setChangeDiff] = useState<{ relativePath: string; diff: string; truncated: boolean } | null>(null)
  const [changeDiffLoadingPath, setChangeDiffLoadingPath] = useState<string | null>(null)
  const [changeDiffError, setChangeDiffError] = useState<string | null>(null)
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null)
  const changeHistory = (appState.changeHistory ?? (appState.recentChangeSummary ? [appState.recentChangeSummary] : []))
    .filter((summary) => summary.workspaceId === active?.id)
  const recentChangeSummary = changeHistory.find((summary) => summary.id === selectedChangeId) ?? changeHistory[0] ?? null
  const openRecentChangeDiff = async (relativePath: string, changeId: string): Promise<void> => {
    if (!active) return
    const api = window.teachingSystem
    if (!api) return
    setChangeDiffLoadingPath(`${changeId}:${relativePath}`)
    setChangeDiffError(null)
    try {
      const result = await api.readWorkspaceChangeDiff({ workspaceId: active.id, relativePath, changeId })
      if (result.ok) {
        setChangeDiff({ relativePath: result.relativePath, diff: result.diff, truncated: result.truncated })
      } else {
        setChangeDiffError(result.message)
      }
    } catch (error) {
      setChangeDiffError(toUserError(error).message)
    } finally {
      setChangeDiffLoadingPath(null)
    }
  }
  const previewCommitWorkspaceId = selectedCourseWorkspaceId ?? active?.id ?? null
  const previewCommitScopeKey = readingCourseHtml && selectedPreviewFile
    ? `${previewCommitWorkspaceId ?? 'none'}:${selectedPreviewFile.relativePath}:${lessonFrameKey}`
    : readingMarkdown && selectedMarkdownDocument
      ? `${previewCommitWorkspaceId ?? 'none'}:md:${selectedMarkdownDocument.relativePath}`
      : null

  const previewCommitScopeKeyRef = useRef(previewCommitScopeKey)
  const previewCommitWorkspaceIdRef = useRef(previewCommitWorkspaceId)
  previewCommitScopeKeyRef.current = previewCommitScopeKey
  previewCommitWorkspaceIdRef.current = previewCommitWorkspaceId

  useEffect(() => {
    learningOutcomeCommitClientRef.current.setLessonScope(previewCommitScopeKey)
  }, [previewCommitScopeKey])

  useEffect(() => {
    learningOutcomeMountedRef.current = true
    const client = learningOutcomeCommitClientRef.current
    return () => {
      learningOutcomeMountedRef.current = false
      client.dispose()
    }
  }, [])

  const retryLearningOutcomeCommit = useCallback((): void => {
    const client = learningOutcomeCommitClientRef.current
    const status = client.getStatus()
    if (status.kind !== 'retryable' || !status.canRetry) return
    if (!learningOutcomeMountedRef.current) return
    setLearningOutcomeRetryPending(true)
    void client.retry().catch(() => undefined).finally(() => {
      if (learningOutcomeMountedRef.current) setLearningOutcomeRetryPending(false)
    })
  }, [])

  const recordPreviewLessonInteraction = useCallback((intent: PreviewLessonInteractionIntent): void => {
    const api = window.teachingSystem
    if (!api) return
    // Capture scope at record start; isCurrent reads live refs so a late resolve
    // after workspace/lesson switch never commits or paints the new lesson banner.
    const workspaceId = previewCommitWorkspaceIdRef.current
    const scopeAtStart = previewCommitScopeKeyRef.current
    const client = learningOutcomeCommitClientRef.current
    void recordPreviewLessonInteractionAndMaybeCommit({
      api,
      intent,
      workspaceId,
      client,
      isCurrent: () => isPreviewCommitScopeCurrent({
        scopeAtStart,
        workspaceIdAtStart: workspaceId,
        currentScopeKey: previewCommitScopeKeyRef.current,
        currentWorkspaceId: previewCommitWorkspaceIdRef.current
      })
    }).catch(() => undefined)
  }, [])

  const renderSidebarToggle = (className = 'icon-button') => (
    <button
      className={className}
      type="button"
      aria-label={sidebarCollapsed ? t('main.expandSidebar') : t('main.collapseSidebar')}
      onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
    >
      <SidebarToggleIcon collapsed={sidebarCollapsed} />
    </button>
  )

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent): void => {
      const lessonInteraction = previewLessonInteractionForCurrentIframe(event, lessonFrameRef.current)
      if (lessonInteraction) {
        recordPreviewLessonInteraction(lessonInteraction)
        return
      }

      const data = event.data as { type?: unknown; href?: unknown }
      if (!data || typeof data.type !== 'string' || typeof data.href !== 'string') return
      if (data.type === PREVIEW_EXTERNAL_LINK_MESSAGE) {
        const href = parsePreviewExternalHref(data.href)
        if (href) void openExternal(href)
        return
      }
      if (data.type === PREVIEW_MARKDOWN_LINK_MESSAGE) {
        const target = parsePreviewMarkdownHref(data.href)
        if (!target) return
        const workspace = appState.workspaces.find((item) => item.id === target.workspaceId)
        if (!workspace) return
        void loadWorkspaceMarkdownFile(
          {
            title: titleFromFileName(target.relativePath),
            relativePath: target.relativePath,
            absolutePath: target.relativePath
          },
          workspace.id
        )
      }
    }

    window.addEventListener('message', handlePreviewMessage)
    return () => window.removeEventListener('message', handlePreviewMessage)
  }, [appState.workspaces, loadWorkspaceMarkdownFile, openExternal, recordPreviewLessonInteraction])

  // Show skeleton during initial load
  if (loading && !active) {
    return (
      <main className="main-area">
        <div className="topbar">
          <div className="crumb">
            <span>StudiumX</span>
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
    <main
      className="main-area"
      data-view={view}
      data-resource-section={view === 'resources' && !readingResourceHtml ? resourcePageSection : undefined}
      data-reading-html={readingHtml ? 'true' : undefined}
      data-reading-markdown={readingMarkdown ? 'true' : undefined}
    >
      {readingResourceHtml ? (
        <>
          {showInlineSidebarToggle && renderSidebarToggle('icon-button reader-sidebar-toggle')}
          <button
            className={`icon-button reader-preview-back${isWindows ? ' reader-preview-back--alone' : ''}`}
            type="button"
            aria-label={t('resources.styles.backToStyles')}
            onClick={closeResourceHtmlPreview}
          >
            <ArrowLeft size={17} />
          </button>
        </>
      ) : readingCourseHtml || readingMarkdown ? (
        showInlineSidebarToggle ? renderSidebarToggle('icon-button reader-sidebar-toggle') : null
      ) : (
        <header className="topbar">
          <div className="crumb">{showInlineSidebarToggle && renderSidebarToggle()}</div>
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

      {(view === 'overview' || view === 'agent') && (
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
        <section
          className="lesson-course-view"
          aria-label={t('nav.lessons')}
          data-reading-html={readingCourseHtml ? 'true' : undefined}
          data-reading-markdown={readingMarkdown ? 'true' : undefined}
        >
          <div
            className="lesson-course-stage"
            data-reading-html={readingCourseHtml ? 'true' : undefined}
            data-reading-markdown={readingMarkdown ? 'true' : undefined}
          >
            {(readingCourseHtml && selectedPreviewFile) || (readingMarkdown && selectedMarkdownDocument) ? (
              <section
                className={readingCourseHtml && selectedPreviewFile ? 'lesson-reader-panel' : 'lesson-reader-panel lesson-reader-panel--markdown'}
                aria-label={t('lessons.previewAria')}
                data-reading-surface={readingCourseHtml && selectedPreviewFile ? 'html' : 'markdown'}
              >
                <LearningOutcomeCommitStatusBanner
                  status={learningOutcomeCommitStatus}
                  onRetry={retryLearningOutcomeCommit}
                  retryPending={learningOutcomeRetryPending}
                />
                {readingCourseHtml && selectedPreviewFile ? (
                  <div className="lesson-reader-frame-wrap">
                    <iframe
                      ref={lessonFrameRef}
                      key={lessonFrameKey}
                      className="lesson-reader-frame"
                      title={selectedPreviewFile.title}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      src={appState.previewUrl || undefined}
                      srcDoc={appState.previewUrl ? undefined : appState.previewHtml || undefined}
                    />
                  </div>
                ) : selectedMarkdownDocument ? (
                  <MarkdownDocumentPanel
                    document={selectedMarkdownDocument}
                    draft={markdownDraft}
                    saving={markdownSaving}
                    workspaceId={selectedCourseWorkspaceId}
                    onDraftChange={setMarkdownDraft}
                    onSave={() => void saveMarkdownDocument()}
                    onOpenExternal={(href) => void openExternal(href)}
                    onPreviewLessonInteraction={recordPreviewLessonInteraction}
                    onOpenWorkspaceMarkdown={(relativePath) => {
                      if (!selectedCourseWorkspaceId) return
                      void loadWorkspaceMarkdownFile(
                        {
                          title: titleFromFileName(relativePath),
                          relativePath,
                          absolutePath: relativePath
                        },
                        selectedCourseWorkspaceId
                      )
                    }}
                  />
                ) : null}
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
                {recentChangeSummary && (
                  <RecentLearningChangesPanel
                    summary={recentChangeSummary}
                    history={changeHistory}
                    loadingPath={changeDiffLoadingPath}
                    onSelect={setSelectedChangeId}
                    onOpenDiff={(relativePath) => void openRecentChangeDiff(relativePath, recentChangeSummary.id)}
                  />
                )}
                {changeDiffError && (
                  <div className="learning-change-error" role="status">
                    <AlertTriangle size={14} />
                    <span>{changeDiffError}</span>
                    <button type="button" onClick={() => setChangeDiffError(null)} aria-label={t('main.dismissAlert')}>
                      <X size={13} />
                    </button>
                  </div>
                )}

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
            resourcePageSection === 'styles' ? (
              <ResourceStyleLibrary
                currentStyleId={settings.workspace.lessonStyleId}
                onApplyLessonStyle={applyLessonStyle}
                onOpenPreview={openResourceHtmlPreview}
                onBack={() => setResourcePageSection('home')}
              />
            ) : resourcePageSection === 'skills' ? (
              <SkillLibrary onBack={() => setResourcePageSection('home')} />
            ) : resourcePageSection === 'pets' ? (
              <PetLibrary onBack={() => setResourcePageSection('home')} />
            ) : (
              <ResourceHome
                onOpenStyles={() => setResourcePageSection('styles')}
                onOpenSkills={() => setResourcePageSection('skills')}
                onOpenPets={() => setResourcePageSection('pets')}
              />
            )
          )}
        </section>
      )}

      {view === 'workbench' && (
        <OfficeWorkbench showNotification={showNotification} />
      )}

      {changeDiff && (
        <LearningChangeDiffDialog
          diff={changeDiff}
          onClose={() => setChangeDiff(null)}
        />
      )}
    </main>
  )
}

function RecentLearningChangesPanel({
  summary,
  history,
  loadingPath,
  onSelect,
  onOpenDiff
}: {
  summary: TeachingWorkspaceChangeSummary
  history: TeachingWorkspaceChangeSummary[]
  loadingPath: string | null
  onSelect: (changeId: string) => void
  onOpenDiff: (relativePath: string) => void
}) {
  const { t, i18n } = useTranslation()
  const visibleFiles = summary.changedFiles.slice(0, 6)
  const hiddenCount = Math.max(0, summary.changedFiles.length - visibleFiles.length)
  const timestamp = formatChangeTimestamp(summary.timestamp, i18n.language)
  return (
    <section className="learning-change-panel" aria-label={t('lessons.changes.title')}>
      <div className="learning-change-panel-head">
        <span className="learning-change-panel-icon" aria-hidden="true">
          <History size={17} />
        </span>
        <div>
          <span>{t('lessons.changes.eyebrow', { time: timestamp })}</span>
          <h3>{t('lessons.changes.title')}</h3>
        </div>
        <span className="learning-change-trigger">
          {t(`lessons.changes.trigger.${summary.trigger.kind}`)}
        </span>
      </div>
      <p className="learning-change-summary">{summary.summary}</p>
      {history.length > 1 && (
        <div className="learning-change-history" aria-label={t('lessons.changes.title')}>
          {history.slice(0, 5).map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === summary.id ? 'is-active' : undefined}
              title={entry.summary}
              onClick={() => onSelect(entry.id)}
            >
              <History size={12} />
              {formatChangeTimestamp(entry.timestamp, i18n.language)}
            </button>
          ))}
        </div>
      )}
      <div className="learning-change-stats" aria-label={t('lessons.changes.statsAria')}>
        <span>{t('lessons.changes.fileCount', { count: summary.changedFiles.length })}</span>
        <span>+{summary.additions}</span>
        <span>-{summary.deletions}</span>
        <span>{summary.git.available ? t('lessons.changes.gitTracked') : t('lessons.changes.gitUnavailable')}</span>
      </div>
      <div className="learning-change-file-list">
        {visibleFiles.map((file) => (
          <LearningChangeFileRow
            key={file.relativePath}
            file={file}
            loading={loadingPath === `${summary.id}:${file.relativePath}`}
            onOpenDiff={onOpenDiff}
          />
        ))}
        {hiddenCount > 0 && (
          <div className="learning-change-more">
            {t('lessons.changes.moreFiles', { count: hiddenCount })}
          </div>
        )}
      </div>
    </section>
  )
}

function LearningChangeFileRow({
  file,
  loading,
  onOpenDiff
}: {
  file: TeachingWorkspaceChangedFile
  loading: boolean
  onOpenDiff: (relativePath: string) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="learning-change-file-row">
      <span className="learning-change-file-main">
        <FileText size={14} />
        <span className="learning-change-file-path">{file.relativePath}</span>
      </span>
      <span className="learning-change-file-kind">{t(`lessons.changes.kind.${file.fileKind}`)}</span>
      <span className="learning-change-file-status" data-status={file.status}>
        {t(`lessons.changes.status.${file.status}`)}
      </span>
      <span className="learning-change-file-stat">{formatFileDiffStat(file, t)}</span>
      <button
        className="ghost-button learning-change-diff-button"
        type="button"
        disabled={!file.diffAvailable || loading}
        onClick={() => onOpenDiff(file.relativePath)}
      >
        {loading ? <Loader2 size={13} className="spin" /> : <FileText size={13} />}
        {loading ? t('lessons.changes.loadingDiff') : t('lessons.changes.diff')}
      </button>
    </div>
  )
}

function LearningChangeDiffDialog({
  diff,
  onClose
}: {
  diff: { relativePath: string; diff: string; truncated: boolean }
  onClose: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return createPortal(
    <div
      className="change-diff-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="change-diff-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="change-diff-dialog-header">
          <div>
            <span>{t('lessons.changes.diffTitle')}</span>
            <h2 id={titleId}>{diff.relativePath}</h2>
          </div>
          <button type="button" className="settings-close-button" onClick={onClose} aria-label={t('lessons.changes.closeDiff')}>
            <X size={16} />
          </button>
        </div>
        {diff.truncated && (
          <div className="change-diff-truncated">
            <Info size={14} />
            {t('lessons.changes.diffTruncated')}
          </div>
        )}
        <pre className="change-diff-source">{diff.diff}</pre>
      </section>
    </div>,
    document.body
  )
}

function formatFileDiffStat(file: TeachingWorkspaceChangedFile, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (typeof file.additions !== 'number' && typeof file.deletions !== 'number') {
    return t('lessons.changes.noStats')
  }
  return `+${file.additions ?? 0} -${file.deletions ?? 0}`
}

function formatChangeTimestamp(value: string, locale: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function ResourceHome({
  onOpenStyles,
  onOpenSkills,
  onOpenPets
}: {
  onOpenStyles: () => void
  onOpenSkills: () => void
  onOpenPets: () => void
}) {
  const { t } = useTranslation()
  const savedStyleId = useAppStore((s) => s.settings.workspace.lessonStyleId)
  const petAppearance = useAppStore((s) => s.settings.pet.appearance)
  const currentStyleId = normalizeLessonStyleId(savedStyleId)
  const currentStyleName = t(`resources.styles.items.${currentStyleId}.name`)
  const { catalog: skillCatalog } = useSkillCatalog()
  const installedSkillCount = skillCatalog.skills.filter((skill) => skill.installed).length
  const [query, setQuery] = useState('')

  const entries = useMemo(
    () => [
      {
        id: 'styles',
        title: t('resources.styles.title'),
        detail: t('resources.home.stylesDetail', {
          count: LESSON_STYLES.length,
          style: currentStyleName
        }),
        meta: t('resources.home.stylesMeta'),
        icon: 'styles' as const,
        onOpen: onOpenStyles
      },
      {
        id: 'skills',
        title: t('skills.title'),
        detail: t('resources.home.skillsDetail', {
          count: skillCatalog.skills.length,
          installed: installedSkillCount
        }),
        meta: t('resources.home.skillsMeta'),
        icon: 'skills' as const,
        onOpen: onOpenSkills
      },
      {
        id: 'pets',
        title: t('resources.pets.title'),
        detail: t('resources.home.petsDetail'),
        meta: t('resources.home.petsMeta'),
        icon: 'pets' as const,
        onOpen: onOpenPets
      }
    ],
    [currentStyleName, installedSkillCount, onOpenPets, onOpenSkills, onOpenStyles, skillCatalog.skills.length, t]
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleEntries = normalizedQuery
    ? entries.filter((entry) =>
        `${entry.title} ${entry.detail} ${entry.meta}`.toLocaleLowerCase().includes(normalizedQuery)
      )
    : entries

  return (
    <div className="resource-home">
      <div className="resource-home-head">
        <h1>{t('resources.title')}</h1>
        <p>{t('resources.home.subtitle')}</p>
      </div>
      <label className="resource-home-search">
        <Search size={15} />
        <input
          type="search"
          value={query}
          placeholder={t('resources.home.searchPlaceholder')}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <section className="resource-directory-section">
        <div className="resource-section-label">
          <h2>{t('resources.home.featured')}</h2>
          <span className="resource-section-line" aria-hidden="true" />
          <span className="resource-icon-button" aria-hidden="true">
            <SlidersHorizontal size={15} />
          </span>
        </div>
        {visibleEntries.length > 0 ? (
          <div className="resource-entry-grid">
            {visibleEntries.map((entry) => (
              <button
                key={entry.id}
                className="resource-entry-card"
                type="button"
                onClick={entry.onOpen}
              >
                <span className={`resource-entry-icon resource-entry-icon--${entry.icon}`}>
                  {entry.icon === 'styles' ? (
                    <Palette size={22} />
                  ) : entry.icon === 'skills' ? (
                    <GraduationCap size={22} />
                  ) : (
                    <PetSprite appearance={petAppearance} className="resource-home-pet-sprite" label="" size={34} state="idle" />
                  )}
                </span>
                <span className="resource-entry-body">
                  <strong>{entry.title}</strong>
                  <span>{entry.detail}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="resource-home-empty">{t('resources.home.noResults')}</div>
        )}
      </section>
    </div>
  )
}

function ResourceStyleLibrary({
  currentStyleId,
  onApplyLessonStyle,
  onOpenPreview,
  onBack
}: {
  currentStyleId: unknown
  onApplyLessonStyle: (styleId: LessonStyleId) => Promise<void>
  onOpenPreview: Parameters<typeof LessonStyleGallery>[0]['onOpenPreview']
  onBack: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="resource-style-page">
      <button className="resource-back-button" type="button" onClick={onBack}>
        <ArrowLeft size={15} />
        {t('resources.home.back')}
      </button>
      <div className="resource-style-head">
        <h1>{t('resources.styles.title')}</h1>
        <p>{t('resources.styles.detail')}</p>
      </div>
      <LessonStyleGallery
        currentStyleId={currentStyleId}
        onApplyLessonStyle={onApplyLessonStyle}
        onOpenPreview={onOpenPreview}
      />
    </div>
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
    <div
      className="dialog-mode-switch"
      data-active-mode={mode}
      role="tablist"
      aria-label={t('overview.mode.aria')}
    >
      <span className="dialog-mode-switch-indicator" aria-hidden="true" />
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

export function AgentFileAccessPicker() {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [open, setOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  usePickerOutsideClose(open, wrapRef, setOpen)

  const approvalMode = settings.tools.approvalMode
  const disabled = updating
  const status = t(`overview.fileAccess.mode.${approvalMode}`)
  const triggerLabel = Array.from(status).slice(0, 4).join('')
  const StatusIcon = approvalMode === 'full_access' ? ShieldCheck : ShieldAlert

  const selectMode = async (nextMode: AgentApprovalMode): Promise<void> => {
    if (disabled) return
    setUpdating(true)
    try {
      if (nextMode !== approvalMode) {
        await updateSettings({ tools: { approvalMode: nextMode } })
        // updateSettings reports failures through the global error surface.
        if (useAppStore.getState().settings.tools.approvalMode !== nextMode) return
      }
      setOpen(false)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div ref={wrapRef} className="overview-picker overview-file-access-picker">
      <button
        type="button"
        className={`overview-file-access-trigger is-${approvalMode}`}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('overview.fileAccess.triggerAria', { status })}
        title={t('overview.fileAccess.triggerTitle', { status })}
      >
        <StatusIcon size={15} />
        <span className="overview-file-access-trigger-label">{triggerLabel}</span>
        {updating ? <Loader2 size={13} className="spin" /> : null}
      </button>

      {open ? (
        <div className="overview-picker-menu overview-file-access-menu" role="menu" aria-label={t('overview.fileAccess.title')}>
          {(['request_approval', 'based_on_approval', 'full_access'] as const).map((mode) => {
            const selected = approvalMode === mode
            return (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`overview-file-access-option${selected ? ' is-selected' : ''}`}
                onClick={() => void selectMode(mode)}
                disabled={updating}
              >
                <span className="overview-file-access-option-copy">
                  <strong>{t(`overview.fileAccess.mode.${mode}`)}</strong>
                  <small>{t(`overview.fileAccess.modeDetail.${mode}`)}</small>
                </span>
                {selected ? <Check size={16} /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
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
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const skillSlash = useSkillSlashInput({
    value: taskPrompt,
    onChange: setTaskPrompt,
    inputRef,
    mode: 'teaching_turn'
  })
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const skillCapabilities = useSkillCapabilityPicker({
    isTeachingMode: true,
    userInput: taskPrompt,
    ...(activeConversationId ? { conversationId: activeConversationId } : {}),
    ...(active?.id ? { workspaceId: active.id } : {})
  })
  const busy = generating || agentChatBusy
  const canSend = Boolean(active && taskPrompt.trim().length > 0 && !busy)
  // Every free-form teaching input goes through the conversation agent; it
  // clarifies when needed and calls the generate_lesson tool when ready.
  const submitToTeachingAgent = () => {
    if (!canSend) return
    const prompt = taskPrompt.trim()
    const skillIds = mergeComposerSkillIds(skillCapabilities.selectedSkillIds, skillSlash.skillIdsFor(prompt))
    setTaskPrompt('')
    openTeachingConversationView()
    void agentChat(prompt, { mode: 'teaching', skillIds })
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
          {skillSlash.menu}
          {skillCapabilities.panel}
          {skillCapabilities.chips}
          <textarea
            ref={inputRef}
            value={taskPrompt}
            aria-label={t('overview.taskAria')}
            placeholder={active ? t('lessons.composerPlaceholder') : t('overview.placeholderEmpty')}
            onChange={(event) => setTaskPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (!isInputComposing(event) && skillSlash.handleKeyDown(event)) return
              if (event.key === 'Enter' && !event.shiftKey) {
                if (isInputComposing(event)) return
                event.preventDefault()
                submitToTeachingAgent()
              }
            }}
          />
          <div className="overview-dialog-footer">
            <AgentFileAccessPicker />
            <div className="overview-dialog-actions">
              {/* ADR-0165: teaching-intent & capability trigger withdrawn from the
                  composer toolbar pending a suitable display surface. */}
              {/* {skillCapabilities.toggle} */}
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
    agentBusyAckMessage,
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
  const isTeachingMode = view !== 'agent' && overviewDialogMode === 'teaching'
  const inputValue = agentInput
  const busy = isTeachingMode ? generating || agentChatBusy : agentChatBusy
  const hasConversation = agentTurns.length > 0
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const skillSlash = useSkillSlashInput({
    value: inputValue,
    onChange: setAgentInput,
    inputRef,
    mode: isTeachingMode ? 'teaching_turn' : 'instant_help'
  })
  const [teachingComposerNotice, setTeachingComposerNotice] = useState<string | null>(null)
  const [openTeachingSourcesKey, setOpenTeachingSourcesKey] = useState(0)
  const [pendingTeachingActionKind, setPendingTeachingActionKind] = useState<'continue' | 'retry' | null>(null)
  const [teachingSnapshot, setTeachingSnapshot] = useState<TeachingPresentationSnapshot | null>(null)
  const [teachingActionBusy, setTeachingActionBusy] = useState(false)
  const teachingComposer = useTeachingComposerCommands({
    enabled: isTeachingMode,
    value: inputValue,
    onChange: setAgentInput,
    inputRef,
    context: {
      presentationActionKind: pendingTeachingActionKind,
      hasSources: false,
      diagnosticMode: false
    }
  })
  useEffect(() => {
    if (!isTeachingMode) { setTeachingSnapshot(null); return }
    let cancelled = false
    void window.teachingSystem?.getTeachingPresentation().then((snapshot) => {
      if (!cancelled) setTeachingSnapshot(snapshot)
    }).catch(() => { if (!cancelled) setTeachingSnapshot(null) })
    return () => { cancelled = true }
  }, [isTeachingMode, agentTurns.length])
  const teachingPresentation = teachingSnapshot
    ? buildTeachingTurnPresentationFromSnapshot(teachingSnapshot)
    : undefined
  useEffect(() => {
    setPendingTeachingActionKind(teachingSnapshot?.nextStep?.action === 'contrast_and_retry' ? 'retry' : null)
  }, [teachingSnapshot])
  const runTeachingAction = async (action: TeachingTurnAction): Promise<void> => {
    if (!teachingSnapshot || teachingActionBusy || agentChatBusy) return
    const canonicalAction =
      action.kind === 'retry' && teachingSnapshot.nextStep?.action === 'contrast_and_retry'
        ? 'contrast_and_retry'
        : action.kind === 'review_due' && teachingSnapshot.nextStep?.action === 'review_due'
          ? 'review_due'
          : null
    if (!canonicalAction) return
    setTeachingActionBusy(true)
    try {
      const result = await window.teachingSystem?.actOnTeachingPresentation({
        operationId: teachingSnapshot.operationId,
        expectedRevision: teachingSnapshot.revision,
        action: canonicalAction
      })
      if (!result) return
      setTeachingSnapshot(result.snapshot)
      if (result.status !== 'accepted') return
      // Renderer supplies no learner-controlled instruction. The host has just
      // authorized this exact canonical action; a fixed intent begins the next
      // teaching turn. Evidence, evaluation, and settlement remain host-owned.
      await agentChat(
        canonicalAction === 'contrast_and_retry'
          ? '请根据已结算的学习结果进行对照讲解，并给出一次新的重试练习。'
          : '请根据已结算的学习记录，先开展一项到期复习练习；在获得新的学习者作答证据前，不要结算学习结果。',
        { mode: 'teaching' }
      )
    } finally {
      setTeachingActionBusy(false)
    }
  }
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number | null>(null)
  const [inputHistoryDraft, setInputHistoryDraft] = useState('')
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const activeConversationRevision = useAppStore((s) => s.activeConversationRevision)
  const activeWorkspaceForSkills = useAppStore((s) => s.appState.activeWorkspace)
  // ADR-0163: explicit capability multi-select + read-only plan preview.
  // Slash entry stays authoritative for backward compatibility; both merge.
  const skillCapabilities = useSkillCapabilityPicker({
    isTeachingMode,
    userInput: inputValue,
    ...(activeConversationId ? { conversationId: activeConversationId } : {}),
    ...(activeWorkspaceForSkills?.id ? { workspaceId: activeWorkspaceForSkills.id } : {})
  })
  const activeSessionTree = useAppStore((s) => s.activeSessionTree)
  const openAgentConversationBranch = useAppStore((s) => s.openAgentConversationBranch)
  const forkAgentConversationBranch = useAppStore((s) => s.forkAgentConversationBranch)
  const clearAgentChat = useAppStore((s) => s.clearAgentChat)
  const pendingAgentConversation = useAppStore((s) => s.pendingAgentConversation)
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null)
  const [messageActionBusy, setMessageActionBusy] = useState(false)
  const viewingBusyPendingConversation = agentChatBusy && activeConversationId === pendingAgentConversation?.summary.id
  const activeBranchStatus = activeSessionTree?.branches.find((branch) => branch.conversationId === activeConversationId)?.status
  const activeBranchReadOnly = activeBranchStatus === 'archived' || activeBranchStatus === 'deleted'
  const navigableConversationBranches = useMemo(
    () => activeSessionTree?.branches.filter((branch) => branch.status !== 'deleted') ?? [],
    [activeSessionTree]
  )
  const activeBranchIndex = navigableConversationBranches.findIndex((branch) => branch.conversationId === activeConversationId)
  const branchNavigation = activeBranchIndex >= 0 && navigableConversationBranches.length > 1
    ? {
        current: activeBranchIndex + 1,
        total: navigableConversationBranches.length,
        onPrevious: () => {
          const previous = navigableConversationBranches[activeBranchIndex - 1]
          if (previous) void openAgentConversationBranch(previous.conversationId)
        },
        onNext: () => {
          const next = navigableConversationBranches[activeBranchIndex + 1]
          if (next) void openAgentConversationBranch(next.conversationId)
        }
      }
    : undefined
  const canForkTurns = Boolean(activeConversationId && activeSessionTree && activeBranchStatus === 'active' && !agentChatBusy)
  const pendingAskStreamId = pendingAgentConversation?.summary.id ?? null
  const pendingAsk = pendingAskStreamId
    ? selectPendingAsk(agentTurns, pendingAskStreamId)
    : null
  const pendingPermission = pendingAskStreamId
    ? selectPendingToolPermission(agentTurns, pendingAskStreamId)
    : null
  const hasPendingInterruption = Boolean(pendingAsk || pendingPermission)
  const activeAssistantTurnId = viewingBusyPendingConversation
    ? [...agentTurns].reverse().find((turn) => turn.role === 'assistant')?.id
    : null
  const conversationPresentation = useMemo(() => buildAgentConversationPresentation({
    turns: agentTurns,
    activeTurnId: activeAssistantTurnId,
    interruption: pendingAsk
      ? {
          kind: 'ask',
          streamId: pendingAsk.streamId,
          toolCallId: pendingAsk.toolCallId,
          questions: pendingAsk.questions,
          deadlineAt: pendingAsk.deadlineAt
        }
      : pendingPermission
        ? {
            kind: 'tool_permission',
            streamId: pendingPermission.streamId,
            toolCallId: pendingPermission.toolCallId,
            request: pendingPermission.request
          }
        : null
  }), [agentTurns, activeAssistantTurnId, pendingAsk, pendingPermission])
  const activeTurnPresentation = activeAssistantTurnId
    ? conversationPresentation.turns.find((turn) => turn.turnId === activeAssistantTurnId)
    : undefined
  const canCancelAgentChat = agentChatBusy && Boolean(pendingAgentConversation) && (
    activeTurnPresentation?.active === true || hasPendingInterruption
  )
  const blockedAsk = conversationPresentation.blocked?.kind === 'ask'
    ? conversationPresentation.blocked
    : null
  const blockedPermission = conversationPresentation.blocked?.kind === 'tool_permission'
    ? conversationPresentation.blocked
    : null
  // B-12: agentChatBusy defaults to queue (not hard-block). Still block on generation pipeline / interruption / readonly.
  const canSend = Boolean(
    active &&
    inputValue.trim() &&
    !(isTeachingMode && generating) &&
    !hasPendingInterruption &&
    !activeBranchReadOnly
  )
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
    void agentChat(prompt, { mode: 'teaching', skillIds: mergeComposerSkillIds(skillCapabilities.selectedSkillIds, skillSlash.skillIdsFor(prompt)) })
  }
  const submitChatPrompt = (value: string): void => {
    const prompt = value.trim()
    if (!prompt) return
    rememberAgentInput(prompt)
    setInputHistoryIndex(null)
    setInputHistoryDraft('')
    void agentChat(prompt, { mode: 'temporary', skillIds: mergeComposerSkillIds(skillCapabilities.selectedSkillIds, skillSlash.skillIdsFor(prompt)) })
  }
  const submitCurrentMode = (): void => {
    if (isTeachingMode) {
      const trimmed = inputValue.trim()
      const looksLikeBareSlash = trimmed.startsWith('/') && !/\s/.test(trimmed)
      if (looksLikeBareSlash) {
        const teachingKind = parseTeachingCommandInput(trimmed)
        if (teachingKind) {
          const resolved = resolveTeachingCommandSubmission(trimmed, {
            isTeachingMode: true,
            presentationActionKind: pendingTeachingActionKind,
            hasSources: false,
            diagnosticMode: false
          })
          if (resolved.ok) {
            setTeachingComposerNotice(null)
            setAgentInput('')
            setInputHistoryIndex(null)
            setInputHistoryDraft('')
            if (resolved.kind === 'continue') {
              // Only accepted when presentation already exposes this action — never invents a planner step.
              setTeachingComposerNotice('已请求继续下一步（遵循当前学习流程）')
            } else if (resolved.kind === 'retry') {
              // Reuse the same host-validated action path as the visible learner card.
              void runTeachingAction({ kind: 'retry', label: '对照后再试一次' })
            } else if (resolved.kind === 'show_source') {
              setOpenTeachingSourcesKey((key) => key + 1)
              setTeachingComposerNotice('已展开可信来源摘要')
            } else if (resolved.kind === 'end_session') {
              clearAgentChat()
              setPendingTeachingActionKind(null)
              setTeachingComposerNotice('已结束本轮教学会话输入')
            }
            return
          }
          const reason = resolved.reason
          setTeachingComposerNotice(
            reason === 'requires_presentation_action' || reason === 'presentation_mismatch'
              ? '当前学习流程尚未允许该动作（不会绕过规划器）'
              : reason === 'no_sources'
                ? '当前没有可展开的可信来源'
                : '该命令当前不可用'
          )
          return
        }
        // Technical/agent control stays out of the teaching composer path.
        if (isForbiddenTechnicalComposerToken(trimmed)) {
          setTeachingComposerNotice('技术命令不可用。教学命令：/continue /retry /source /end')
          return
        }
        // Other bare slash tokens (e.g. skill commands) fall through to teaching submit.
      }
    }
    if (!canSend) return
    if (isTeachingMode) submitTeachingPrompt(inputValue)
    else submitChatPrompt(inputValue)
  }
  const answerAsk = (answers: AskAnswer[]): void => {
    const command = blockedAsk?.command
    if (!command) return
    void window.teachingSystem?.answerAgentChatTool(
      command.streamId,
      command.toolCallId,
      answers
    )
  }
  const answerPermission = (decision: 'allow_once' | 'allow_for_run' | 'allow_for_directory' | 'deny'): void => {
    const command = blockedPermission?.command
    if (!command) return
    void window.teachingSystem?.answerAgentChatTool(
      command.streamId,
      command.toolCallId,
      [
        { questionId: 'permission', selected: [decision] },
        ...(decision === 'allow_for_directory' && blockedPermission.request.directoryScopePath
          ? [{ questionId: 'scope', selected: [blockedPermission.request.directoryScopePath] }]
          : [])
      ]
    )
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

  const canEditTurns = Boolean(!agentChatBusy && !messageActionBusy && !activeBranchReadOnly)

  const forkFromTurn = async (turnId: string): Promise<void> => {
    if (!activeConversationId || activeConversationRevision === null || messageActionBusy || agentChatBusy) return
    setMessageActionBusy(true)
    try {
      const forked = await forkAgentConversationBranch(activeConversationId, turnId, activeConversationRevision)
      if (forked) setEditingTurnId(null)
    } finally {
      setMessageActionBusy(false)
    }
  }

  const copyTurnContent = async (content: string): Promise<void> => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = content
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
      } finally {
        document.body.removeChild(textarea)
      }
    }
  }

  const resendEditedTurn = async (turn: AgentChatTurn, nextContent: string): Promise<void> => {
    if (messageActionBusy || agentChatBusy || activeBranchReadOnly) return
    const turnIndex = agentTurns.findIndex((item) => item.id === turn.id)
    if (turnIndex < 0 || turn.role !== 'user') return
    const content = nextContent.trim()
    if (!content) return

    setMessageActionBusy(true)
    try {
      const previousTurn = turnIndex > 0 ? agentTurns[turnIndex - 1] : null
      if (previousTurn && activeConversationId && activeConversationRevision !== null) {
        const forked = await forkAgentConversationBranch(activeConversationId, previousTurn.id, activeConversationRevision)
        if (!forked) return
      } else {
        clearAgentChat()
      }
      setEditingTurnId(null)
      const mode = isTeachingMode ? 'teaching' as const : 'temporary' as const
      void agentChat(content, { mode })
    } finally {
      setMessageActionBusy(false)
    }
  }

  useEffect(() => {
    setEditingTurnId(null)
  }, [activeConversationId])

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [agentTurns, agentStatus, pendingAsk, pendingPermission])
  return (
    <section
      className={`overview-dialog-shell${hasConversation ? ' has-conversation' : ''}`}
      aria-label={t('overview.aria')}
    >
      {hasConversation && (
        <div ref={scrollRef} className="overview-dialog-thread">
          <div className="overview-dialog-thread-inner">
          {agentTurns.map((turn) => {
            const turnPresentation = conversationPresentation.turns.find((item) => item.turnId === turn.id)
            const isBusyTurn = activeAssistantTurnId === turn.id
            // Assistant text emitted before a tool call is an internal planning
            // preamble. The same work is already represented by the single
            // “规划中” card; rendering it here creates duplicated, split prose.
            // Durable assistant turns keep toolCalls alongside the final reply after a run
            // is collapsed. Hide only empty/internal content; never suppress the answer
            // just because tools were used.
            const visibleContent = turn.role === 'assistant'
              ? sanitizeAgentTurnContent(turn.content)
              : turn.content
            const content = visibleContent || (turn.role === 'assistant' && isBusyTurn && !turnPresentation?.items.length ? '正在准备回复…' : '')
            const sourceReferences = turn.role === 'assistant' ? (turnPresentation?.sources ?? []) : []
            const isEditing = editingTurnId === turn.id
            return (
              <div
                key={turn.id}
                className={`overview-dialog-message ${turn.role === 'user' ? 'is-user' : 'is-assistant'}${isEditing ? ' is-editing' : ''}`}
              >
                {isEditing ? (
                  <AgentMessageEditor
                    initialValue={turn.content}
                    busy={messageActionBusy || agentChatBusy}
                    onCancel={() => setEditingTurnId(null)}
                    onSubmit={(value) => { void resendEditedTurn(turn, value) }}
                  />
                ) : (
                  <>
                    {turn.role === 'assistant' ? <AgentConversationReader presentation={turnPresentation} teachingPresentation={turn.id === [...agentTurns].reverse().find((item) => item.role === 'assistant')?.id ? teachingPresentation : undefined} onTeachingAction={(action) => { void runTeachingAction(action) }} compact /> : null}
                    {content ? <MarkdownMessage content={content} tone={turn.role} compact /> : null}
                    {sourceReferences.length > 0 ? (
                      <AgentSourceReferences sources={sourceReferences} />
                    ) : null}
                    <AgentMessageActions
                      turn={turn}
                      canFork={canForkTurns}
                      canEdit={canEditTurns}
                      disabled={messageActionBusy || agentChatBusy}
                      onFork={(turnId) => { void forkFromTurn(turnId) }}
                      onEdit={(editableTurn) => setEditingTurnId(editableTurn.id)}
                      onCopy={copyTurnContent}
                      branchNavigation={branchNavigation}
                    />
                  </>
                )}
              </div>
            )
          })}
          </div>
        </div>
      )}

      <ConversationInterruptionDock
        active={hasPendingInterruption}
        interruption={blockedAsk ? (
          <AskCard
            questions={blockedAsk.questions}
            deadlineAt={blockedAsk.deadlineAt}
            onSubmit={answerAsk}
            onDismiss={() => answerAsk([])}
            onCancel={() => void cancelAgentChat()}
          />
        ) : blockedPermission ? (
          <ToolPermissionCard
            request={blockedPermission.request}
            onAllowOnce={() => answerPermission('allow_once')}
            onAllowRun={() => answerPermission('allow_for_run')}
            onAllowDirectory={() => answerPermission('allow_for_directory')}
            onDeny={() => answerPermission('deny')}
          />
        ) : null}
      >
        <DialogModeSwitch />
        <form
          className="overview-dialog-stack"
          data-teaching-sources-key={openTeachingSourcesKey}
          aria-label={t('overview.formAria')}
          onSubmit={(event) => {
            event.preventDefault()
            submitCurrentMode()
          }}
        >
        <div className="overview-dialog-card">
          {teachingComposer.menu}
          {skillSlash.menu}
          {skillCapabilities.panel}
          {skillCapabilities.chips}
          <textarea
            ref={inputRef}
            value={inputValue}
            aria-label={t('overview.taskAria')}
            placeholder={hasPendingInterruption
              ? pendingPermission
                ? '请先处理上方写入审批...'
                : '请先回答上方追问...'
              : activeBranchReadOnly
                ? '该分支为只读状态；请先恢复或 Fork 后继续...'
              : active
              ? isTeachingMode
                ? '说说你想学什么、当前基础，以及希望先解决什么问题…'
                : '输入对话内容...'
              : t('overview.placeholderEmpty')}
            disabled={hasPendingInterruption || activeBranchReadOnly}
            onChange={(event) => {
              setAgentInput(event.target.value)
              setInputHistoryIndex(null)
              setInputHistoryDraft('')
            }}
            onKeyDown={(event) => {
              if (!isInputComposing(event) && teachingComposer.handleKeyDown(event)) return
              if (!isInputComposing(event) && skillSlash.handleKeyDown(event)) return
              if (navigateSentInputHistory(event)) return
              if (event.key === 'Enter' && !event.shiftKey) {
                if (isInputComposing(event)) return
                event.preventDefault()
                submitCurrentMode()
              }
            }}
          />
          <div className="overview-dialog-footer">
            <AgentFileAccessPicker />
            <div className="overview-dialog-actions">
              {/* ADR-0165: teaching-intent & capability trigger withdrawn from the
                  composer toolbar pending a suitable display surface. */}
              {/* {skillCapabilities.toggle} */}
              <OverviewModelPicker />
              <OverviewReasoningPicker />
              <button
                className="send-button overview-dialog-send"
                type={canCancelAgentChat && !inputValue.trim() ? 'button' : 'submit'}
                aria-label={canCancelAgentChat && !inputValue.trim() ? '中断对话' : '发送消息'}
                title={canCancelAgentChat && !inputValue.trim()
                  ? '中断对话'
                  : canCancelAgentChat
                    ? (agentBusyAckMessage ?? '当前回合进行中，发送将加入队列')
                    : '发送消息'}
                disabled={canCancelAgentChat && !inputValue.trim() ? false : !canSend}
                onClick={canCancelAgentChat && !inputValue.trim() ? () => void cancelAgentChat() : undefined}
              >
                {canCancelAgentChat && !inputValue.trim()
                  ? <Square size={16} />
                  : busy
                    ? <Loader2 className="spin" size={18} />
                    : <SendHorizontal size={18} />}
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
            {agentBusyAckMessage ? (
              <span className="overview-dialog-status-text overview-dialog-busy-ack" role="status" aria-live="polite">
                {agentBusyAckMessage}
              </span>
            ) : null}
            {isTeachingMode && teachingComposerNotice ? (
              <span className="overview-dialog-status-text" role="status" aria-live="polite">{teachingComposerNotice}</span>
            ) : null}
          </div>
        </div>
        </form>
      </ConversationInterruptionDock>
    </section>
  )
}

function AgentSourceReferences({
  sources
}: {
  sources: Array<{ id: string; title: string; url: string; snippet?: string; provider?: string }>
}) {
  const openExternal = useAppStore((state) => state.openExternal)
  return (
    <section className="agent-source-references" aria-label="参考链接">
      <header className="agent-source-references__head">
        <strong>参考链接</strong>
        <span>{sources.length}</span>
      </header>
      <ol className="agent-source-references__list">
        {sources.map((source, index) => (
          <li key={source.id}>
            <a
              href={source.url}
              rel="noreferrer"
              target="_blank"
              title={source.snippet || source.url}
              onClick={(event) => {
                event.preventDefault()
                void openExternal(source.url)
              }}
            >
              <span className="agent-source-references__index">{index + 1}</span>
              <span className="agent-source-references__title">{source.title}</span>
              {source.provider ? <small>{source.provider}</small> : null}
            </a>
          </li>
        ))}
      </ol>
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
  const openExternal = useAppStore((state) => state.openExternal)
  const markdownComponents = useMemo<Components>(() => ({
    a: ({ node: _node, href, children, ...props }) => (
      <a
        {...props}
        href={href}
        rel="noreferrer"
        target="_blank"
        onClick={(event) => {
          if (!href) return
          event.preventDefault()
          void openExternal(href)
        }}
      >
        {children}
      </a>
    ),
    code: ({ node: _node, className, children, ...props }) => (
      <code {...props} className={className}>
        {children}
      </code>
    )
  }), [openExternal])

  return (
    <div className={`markdown-message markdown-message--${tone}${compact ? ' is-compact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function ToolPermissionCard({
  request,
  onAllowOnce,
  onAllowRun,
  onAllowDirectory,
  onDeny
}: {
  request: AgentToolPermissionRequest
  onAllowOnce: () => void
  onAllowRun: () => void
  onAllowDirectory: () => void
  onDeny: () => void
}) {
  const target = request.targetPath || request.toolName
  return (
    <div className="ask-card" role="dialog" aria-label="写入审批">
      <div className="ask-card__head">
        <AlertTriangle size={15} />
        <strong>写入审批</strong>
      </div>

      <div className="ask-card__question">
        <div className="ask-card__question-header">{request.operation}</div>
        <p>{target}</p>
      </div>

      {request.reason ? (
        <div className="tool-permission-card__reason">
          <strong>原因</strong>
          <p>{request.reason}</p>
        </div>
      ) : null}

      <div className="ask-card__footer tool-permission-card__actions">
        <button type="button" className="ask-card__ghost" onClick={onDeny}>
          <X size={12} />
          拒绝
        </button>
        {request.directoryScopePath ? (
          <button type="button" className="ask-card__ghost" onClick={onAllowDirectory}>
            <Check size={12} />
            允许目录 {request.directoryScopePath}
          </button>
        ) : null}
        <button type="button" className="ask-card__ghost" onClick={onAllowRun}>
          <Check size={12} />
          本轮同类写入
        </button>
        <button type="button" className="ask-card__primary" onClick={onAllowOnce}>
          <Check size={12} />
          允许本次写入
        </button>
      </div>
    </div>
  )
}

function AskCard({
  questions,
  deadlineAt,
  onSubmit,
  onDismiss,
  onCancel
}: {
  questions: AskQuestion[]
  deadlineAt?: string | null
  onSubmit: (answers: AskAnswer[]) => void
  onDismiss: () => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({})
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!deadlineAt || !Number.isFinite(Date.parse(deadlineAt))) return
    setNowMs(Date.now())
    const handle = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(handle)
  }, [deadlineAt])

  const remainingMs =
    deadlineAt && Number.isFinite(Date.parse(deadlineAt))
      ? Date.parse(deadlineAt) - nowMs
      : null
  const remainingLabel = formatAskRemainingLabel(remainingMs)

  const total = questions.length
  const question = questions[Math.min(active, total - 1)]
  if (!question) return null

  const currentSelected = selected[question.id] ?? []
  const currentCustom = custom[question.id] ?? ''
  const customActive = customOpen[question.id] === true || currentCustom.trim().length > 0
  const canSubmit = currentCustom.trim().length > 0 || currentSelected.length > 0

  const toggle = (label: string): void => {
    setCustom((prev) => ({ ...prev, [question.id]: '' }))
    setSelected((prev) => {
      const current = prev[question.id] ?? []
      if (question.multiSelect) {
        const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
        return { ...prev, [question.id]: next }
      }
      return { ...prev, [question.id]: [label] }
    })
  }

  const collectAnswers = (): AskAnswer[] =>
    questions.map((item) => {
      const typed = (custom[item.id] ?? '').trim()
      if (typed) return { questionId: item.id, selected: [typed] }
      return { questionId: item.id, selected: selected[item.id] ?? [] }
    })

  const advanceOrSubmit = (): void => {
    const answers = collectAnswers()
    if (active < total - 1) {
      setActive(active + 1)
    } else {
      onSubmit(answers)
    }
  }

  const handleOptionClick = (label: string): void => {
    toggle(label)
    if (!question.multiSelect) {
      window.setTimeout(() => {
        const answers: AskAnswer[] = questions.map((item) => {
          if (item.id === question.id) return { questionId: item.id, selected: [label] }
          const typed = (custom[item.id] ?? '').trim()
          if (typed) return { questionId: item.id, selected: [typed] }
          return { questionId: item.id, selected: selected[item.id] ?? [] }
        })
        if (active < total - 1) {
          setActive((current) => current + 1)
        } else {
          onSubmit(answers)
        }
      }, 120)
    }
  }

  return (
    <div className="ask-card" role="dialog" aria-label={t('ask.title')}>
      <div className="ask-card__head">
        <MessageSquare size={15} />
        <strong>{t('ask.title')}</strong>
        {remainingLabel ? (
          <span className="ask-card__deadline" title={deadlineAt ?? undefined}>
            <Clock3 size={12} />
            {t('ask.remaining', { time: remainingLabel })}
          </span>
        ) : null}
        {total > 1 && (
          <span className="ask-card__progress">
            {t('ask.questionProgress', { current: active + 1, total })}
          </span>
        )}
      </div>

      {total > 1 && active > 0 && (
        <div className="ask-card__crumbs">
          {questions.slice(0, active).map((item) => {
            const typed = (custom[item.id] ?? '').trim()
            const picked = typed || (selected[item.id] ?? []).join('、')
            return (
              <button
                key={item.id}
                type="button"
                className="ask-card__crumb"
                onClick={() => setActive(questions.indexOf(item))}
                title={item.prompt}
              >
                <span className="ask-card__crumb-label">{item.header ?? compactPrompt(item.prompt)}</span>
                <span className="ask-card__crumb-value">{picked || '-'}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="ask-card__question">
        {question.header && <div className="ask-card__question-header">{question.header}</div>}
        <p>{question.prompt}</p>
      </div>

      <div className="ask-options">
        {question.options.map((option) => {
          const isSelected = currentSelected.includes(option.label) && !customActive
          return (
            <button
              key={option.label}
              type="button"
              className={`ask-option${isSelected ? ' is-selected' : ''}`}
              onClick={() => handleOptionClick(option.label)}
            >
              <span className="ask-option__label">{option.label}</span>
              {option.description && <span className="ask-option__desc">{option.description}</span>}
            </button>
          )
        })}
      </div>

      <div className="ask-card__custom">
        {customActive ? (
          <textarea
            className="ask-card__custom-input"
            placeholder={t('ask.customPlaceholder')}
            value={currentCustom}
            autoFocus
            onChange={(event) => {
              const value = event.target.value
              setCustom((prev) => ({ ...prev, [question.id]: value }))
              if (value.trim()) {
                setSelected((prev) => ({ ...prev, [question.id]: [] }))
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && canSubmit) {
                event.preventDefault()
                advanceOrSubmit()
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="ask-card__custom-toggle"
            onClick={() => setCustomOpen((prev) => ({ ...prev, [question.id]: true }))}
          >
            <PenLine size={13} />
            {t('ask.customAnswer')}
          </button>
        )}
      </div>

      <div className="ask-card__footer">
        <button type="button" className="ask-card__ghost" onClick={onDismiss}>
          {t('ask.justChat')}
        </button>
        {onCancel ? (
          <button type="button" className="ask-card__ghost ask-card__ghost--mute" onClick={onCancel}>
            <Square size={12} />
            {t('ask.cancel')}
          </button>
        ) : null}
        {question.multiSelect || customActive ? (
          <button
            type="button"
            className="ask-card__primary"
            disabled={!canSubmit}
            onClick={advanceOrSubmit}
          >
            {active < total - 1 ? t('ask.next') : t('ask.submit')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function compactPrompt(prompt: string): string {
  const trimmed = prompt.replace(/\s+/g, ' ').trim()
  return trimmed.length > 18 ? `${trimmed.slice(0, 17)}...` : trimmed
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


export { App, AppErrorBoundary }
