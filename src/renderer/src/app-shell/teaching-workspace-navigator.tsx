import {
  Archive, ChevronDown, ChevronRight, FileText,
  Folder, FolderOpen, GitFork, Loader2, MessageSquare, MoreHorizontal, Pencil, Pin, PinOff,
  Plus, Trash2, X
} from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { CoursePreviewFile } from './contextTransitions'
import type { PendingAgentConversation } from '../agent-conversation-state'
import { isPendingConversationSummary } from '../agent-conversation-state'
import type {
  AgentConversationLookupScope, AgentConversationSummary, LessonSummary, TeachingWorkspaceSummary,
  WorkspaceFileNode, WorkspaceItemKind, WorkspaceView
} from '../../../shared/teaching-types'
import {
  initialTeachingWorkspaceNavigatorState, isSidebarContentFolderPath, isSidebarCourseFolderPath,
  isTeachingWorkspaceNavigatorNodeSelected, sameRelativePath,
  teachingWorkspaceNavigatorReducer, workspaceNodeKey,
  projectTeachingWorkspaceNavigator
} from './teaching-workspace-navigator-state'

export type TeachingWorkspaceNavigatorProps = {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  temporaryConversations: AgentConversationSummary[]
  selectedLessonPath: string | null
  selectedCourseRelativePath: string | null
  selectedCourseWorkspaceId: string | null
  view: WorkspaceView
  activeConversationId: string | null
  pendingAgentConversation: PendingAgentConversation | null
  showAllCourseFiles: boolean
  defaultRoot: string
  loading: boolean
  agentChatBusy: boolean
  onSelectWorkspace: (workspaceId: string) => Promise<void>
  onSetOverviewDialogMode: (mode: 'teaching') => void
  onOpenWorkspaceTeachingMode: () => void
  onSelectCourseFolder: (relativePath: string | null, workspaceId?: string | null) => void
  onLoadLesson: (lesson: LessonSummary) => Promise<void>
  onLoadCourseHtmlFile: (file: CoursePreviewFile) => Promise<void>
  onLoadWorkspaceMarkdownFile: (file: CoursePreviewFile, workspaceId: string) => Promise<void>
  onLoadAgentConversation: (conversationId: string, workspaceId: string | null | undefined, scope: AgentConversationLookupScope) => Promise<void>
  onRestorePendingAgentConversation: () => void
  onOpenPath: (path: string) => Promise<void>
  onImportWorkspace: () => Promise<boolean>
  onImportWorkspacePath: (path: string) => Promise<boolean>
  onSetWorkspaceItemMeta: (payload: { workspaceId: string | null | undefined; relativePath: string; pinned?: boolean; archived?: boolean }) => Promise<void>
  onRenameAgentConversation: (payload: { workspaceId: string | null | undefined; conversationId: string; title: string; scope: AgentConversationLookupScope; expectedRevision?: number }) => Promise<void>
  onRemoveWorkspaceItem: (payload: { workspaceId: string | null | undefined; relativePath: string; kind: WorkspaceItemKind; mode: 'list' | 'disk' }) => Promise<void>
  onRemoveWorkspace: (payload: { workspaceId: string; mode: 'list' | 'disk' }) => Promise<void>
}

/** Owns transient disclosure/dialog UI only; App keeps durable store and filesystem authority. */
export function TeachingWorkspaceNavigator({
  workspaces, activeWorkspace, temporaryConversations, selectedLessonPath,
  selectedCourseRelativePath: _selectedCourseRelativePath, selectedCourseWorkspaceId: _selectedCourseWorkspaceId, view,
  activeConversationId, pendingAgentConversation, showAllCourseFiles, defaultRoot,
  loading, agentChatBusy, onSelectWorkspace, onSetOverviewDialogMode, onOpenWorkspaceTeachingMode,
  onSelectCourseFolder, onLoadLesson, onLoadCourseHtmlFile, onLoadWorkspaceMarkdownFile,
  onLoadAgentConversation, onRestorePendingAgentConversation, onOpenPath,
  onImportWorkspace, onImportWorkspacePath,
  onSetWorkspaceItemMeta, onRenameAgentConversation, onRemoveWorkspaceItem, onRemoveWorkspace
}: TeachingWorkspaceNavigatorProps) {
  const { t } = useTranslation()
  const [state, dispatch] = useReducer(teachingWorkspaceNavigatorReducer, initialTeachingWorkspaceNavigatorState)
  const { workspaceFolders, temporaryConversations: visibleTemporaryConversations } = useMemo(
    () => projectTeachingWorkspaceNavigator({ workspaces, activeWorkspace, temporaryConversations, pendingAgentConversation, showAllCourseFiles }),
    [activeWorkspace, pendingAgentConversation, showAllCourseFiles, temporaryConversations, workspaces]
  )
  // Non-overview shell destinations clear local folder chrome (overview still hosts course tree selection).
  useEffect(() => {
    if (view === 'resources' || view === 'workbench' || view === 'review' || view === 'settings') {
      dispatch({ type: 'clear-folder-selection' })
    }
  }, [view])
  // File/conversation selection also owns exclusive chrome over folder highlight.
  useEffect(() => {
    if (selectedLessonPath || activeConversationId) {
      dispatch({ type: 'clear-folder-selection' })
    }
  }, [selectedLessonPath, activeConversationId])
  const ensureWorkspaceSelected = async (workspaceId: string): Promise<void> => {
    if (workspaceId !== activeWorkspace?.id) await onSelectWorkspace(workspaceId)
  }
  return <>
    <div className="sidebar-section sidebar-section--courses">
      <div className="section-heading section-heading--folder">
        <button className="section-folder-button" type="button" aria-expanded={state.coursesExpanded}
          aria-label={state.coursesExpanded ? t('sidebar.collapseCourses') : t('sidebar.expandCourses')}
          title={state.coursesExpanded ? t('sidebar.collapseCourses') : t('sidebar.expandCourses')}
          onClick={() => dispatch({ type: 'toggle-courses' })}>
          <span className="collapsible-label">{t('sidebar.courses')}</span>
          <span className="section-folder-chevron" aria-hidden="true">{state.coursesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
        <button className="section-add-button" type="button" aria-label={t('sidebar.addCourseProject')}
          title={t('sidebar.addCourseProject')} onClick={(event) => { event.stopPropagation(); dispatch({ type: 'open-import-dialog' }) }}>
          <Plus size={14} />
        </button>
      </div>
      <div className={`sidebar-disclosure${state.coursesExpanded ? ' is-open' : ''}`} aria-hidden={!state.coursesExpanded} inert={!state.coursesExpanded ? true : undefined}>
        <div className="sidebar-disclosure-inner">
          {workspaceFolders.length > 0 ? <div className="workspace-file-tree workspace-file-tree--courses" role="tree">
            {workspaceFolders.map(({ workspace, node }) => <WorkspaceFileNodeRow
              key={workspaceNodeKey(workspace.id, node.relativePath)} node={node} workspace={workspace} level={0} treeRoot="courses"
              expandedPaths={state.expandedPaths} selectedLessonPath={selectedLessonPath}
              selectedFolderKey={state.selectedFolderKey}
              activeConversationId={activeConversationId} loading={loading} agentChatBusy={agentChatBusy}
              onToggle={(workspaceId, relativePath) => dispatch({ type: 'toggle-path', workspaceId, relativePath })}
              onSelectFolder={(workspaceId, relativePath) => dispatch({ type: 'select-folder', workspaceId, relativePath })}
              onClearFolderSelection={() => dispatch({ type: 'clear-folder-selection' })}
              onEnsureWorkspaceSelected={() => ensureWorkspaceSelected(workspace.id)}
              onSetOverviewDialogMode={onSetOverviewDialogMode} onOpenWorkspaceTeachingMode={onOpenWorkspaceTeachingMode}
              onOpenPath={onOpenPath} onOpenHtmlFile={onLoadCourseHtmlFile}
              onOpenMarkdownFile={(file) => onLoadWorkspaceMarkdownFile(file, workspace.id)}
              onOpenCourse={onSelectCourseFolder} onOpenLesson={onLoadLesson}
              onOpenConversation={(conversationId) => onLoadAgentConversation(conversationId, workspace.id, 'workspace')}
              onRestorePendingConversation={onRestorePendingAgentConversation}
              onSetWorkspaceItemMeta={onSetWorkspaceItemMeta} onRenameAgentConversation={onRenameAgentConversation} onRemoveWorkspaceItem={onRemoveWorkspaceItem} onRemoveWorkspace={onRemoveWorkspace}
            />)}
          </div> : <div className="workspace-conversation-empty">{t('sidebar.emptyCourses')}</div>}
        </div>
      </div>
    </div>

    <div className="sidebar-section sidebar-section--conversations" aria-label={t('sidebar.conversations')}>
      <div className="section-heading section-heading--folder sidebar-conversation-heading">
        <button className="section-folder-button" type="button" aria-expanded={state.conversationsExpanded}
          aria-label={state.conversationsExpanded ? t('sidebar.collapseConversations') : t('sidebar.expandConversations')}
          title={state.conversationsExpanded ? t('sidebar.collapseConversations') : t('sidebar.expandConversations')}
          onClick={() => dispatch({ type: 'toggle-conversations' })}>
          <span className="collapsible-label">{t('sidebar.conversations')}</span>
          <span className="section-folder-chevron" aria-hidden="true">{state.conversationsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
        </button>
      </div>
      <div className={`sidebar-disclosure${state.conversationsExpanded ? ' is-open' : ''}`} aria-hidden={!state.conversationsExpanded} inert={!state.conversationsExpanded ? true : undefined}>
        <div className="sidebar-disclosure-inner"><div className="workspace-conversation-list is-flat">
          {visibleTemporaryConversations.length === 0 ? <div className="workspace-conversation-empty">{t('sidebar.emptyConversations')}</div> : visibleTemporaryConversations.map((conversation) => <ConversationListRow
            key={conversation.id} conversation={conversation} isActiveConversation={conversation.id === activeConversationId}
            agentChatBusy={agentChatBusy}
            onOpen={() => conversation.pending ? onRestorePendingAgentConversation() : void onLoadAgentConversation(conversation.id, conversation.workspaceId, 'temporary')}
            onSetWorkspaceItemMeta={onSetWorkspaceItemMeta} onRenameAgentConversation={onRenameAgentConversation} onRemoveWorkspaceItem={onRemoveWorkspaceItem}
          />)}
        </div></div>
      </div>
    </div>

    {state.importDialogOpen ? <ImportWorkspaceDialog defaultPath={defaultRoot || activeWorkspace?.rootPath || ''} loading={loading}
      onClose={() => dispatch({ type: 'close-import-dialog' })} onImportWorkspace={onImportWorkspace}
      onImportWorkspacePath={onImportWorkspacePath} /> : null}
  </>
}

function ImportWorkspaceDialog({ defaultPath, loading, onClose, onImportWorkspace, onImportWorkspacePath }: {
  defaultPath: string
  loading: boolean
  onClose: () => void
  onImportWorkspace: () => Promise<boolean>
  onImportWorkspacePath: (path: string) => Promise<boolean>
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const [path, setPath] = useState(defaultPath)
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])
  const importPath = async (): Promise<void> => { if (await onImportWorkspacePath(path)) onClose() }
  return createPortal(
    <div className="remove-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="remove-dialog remove-dialog-confirmation import-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="remove-dialog-header">
          <h2 id={titleId}>{t('workspaceImport.title')}</h2>
        </div>
        <label className="import-dialog-field">
          <input
            autoFocus
            type="text"
            value={path}
            aria-label={t('workspaceImport.pathLabel')}
            placeholder={t('workspaceImport.pathPlaceholder')}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void importPath() } }}
          />
        </label>
        <div className="remove-dialog-footer">
          <button type="button" className="ghost-button import-dialog-choose-button" onClick={() => void onImportWorkspace().then((imported) => { if (imported) onClose() })} disabled={loading}>
            <FolderOpen size={15} />{t('workspaceImport.choose')}
          </button>
          <div className="import-dialog-footer-actions">
            <button className="remove-dialog-cancel-button" type="button" onClick={onClose}>{t('common.cancel')}</button>
            <button className="remove-dialog-confirm-button import-dialog-confirm-button" type="button" onClick={() => void importPath()} disabled={loading || !path.trim()}>
              {t('workspaceImport.import')}
            </button>
          </div>
        </div>
      </section>
    </div>, document.body
  )
}

type RowContextMenuPoint = { left: number; top: number }
const ROW_CONTEXT_MENU_EDGE_GAP = 8
const ROW_CONTEXT_MENU_MIN_WIDTH = 164
const ROW_CONTEXT_MENU_ESTIMATED_HEIGHT = 154

function clampRowContextMenuPoint(left: number, top: number, width: number, height: number): RowContextMenuPoint {
  return {
    left: Math.min(Math.max(ROW_CONTEXT_MENU_EDGE_GAP, left), Math.max(ROW_CONTEXT_MENU_EDGE_GAP, window.innerWidth - width - ROW_CONTEXT_MENU_EDGE_GAP)),
    top: Math.min(Math.max(ROW_CONTEXT_MENU_EDGE_GAP, top), Math.max(ROW_CONTEXT_MENU_EDGE_GAP, window.innerHeight - height - ROW_CONTEXT_MENU_EDGE_GAP))
  }
}
function sameRowContextMenuPoint(left: RowContextMenuPoint, right: RowContextMenuPoint): boolean {
  return Math.abs(left.left - right.left) < 0.5 && Math.abs(left.top - right.top) < 0.5
}

function RowContextMenu({ pinned, onRename, onTogglePin, onArchive, onRemove, showPin = true, showArchive = true }: {
  pinned: boolean
  onRename?: () => void
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
    setMenuPoint(clampRowContextMenuPoint(rect.right - ROW_CONTEXT_MENU_MIN_WIDTH, rect.bottom + 6, ROW_CONTEXT_MENU_MIN_WIDTH, ROW_CONTEXT_MENU_ESTIMATED_HEIGHT))
    setOpen(true)
  }
  useLayoutEffect(() => {
    if (!open || !menuPoint) return
    const rect = menuRef.current?.getBoundingClientRect()
    if (!rect) return
    const nextPoint = clampRowContextMenuPoint(menuPoint.left, menuPoint.top, rect.width, rect.height)
    setMenuPoint((current) => !current || !sameRowContextMenuPoint(current, nextPoint) ? nextPoint : current)
  }, [menuPoint, open])
  useEffect(() => {
    if (!open) return
    const closeMenu = (): void => setOpen(false)
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && (wrapRef.current?.contains(target) || menuRef.current?.contains(target))) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') closeMenu() }
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
  const run = (action: () => void): void => { close(); action() }
  return <div ref={wrapRef} className={`row-context-menu${open ? ' is-open' : ''}`}>
    <button type="button" className="row-context-menu-trigger" aria-expanded={open} aria-haspopup="menu" aria-label={t('sidebar.rowActions')} title={t('sidebar.rowActions')}
      onClick={(event) => { event.stopPropagation(); open ? close() : openMenu(event.currentTarget) }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close() } }}><MoreHorizontal size={14} /></button>
    {open && menuPoint ? createPortal(<div ref={menuRef} className="row-context-menu-dropdown" role="menu" style={{ left: menuPoint.left, top: menuPoint.top, minWidth: ROW_CONTEXT_MENU_MIN_WIDTH }}
      onMouseDown={(event) => { event.preventDefault(); event.stopPropagation() }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
      {onRename ? <button type="button" role="menuitem" className="row-context-menu-item" onClick={() => run(onRename)}><Pencil size={13} /><span>{t('sidebar.rename')}</span></button> : null}
      {onRename && (showPin || showArchive) ? <div className="row-context-menu-separator" role="separator" /> : null}
      {showPin ? <button type="button" role="menuitem" className="row-context-menu-item" onClick={() => run(onTogglePin)}>{pinned ? <PinOff size={13} /> : <Pin size={13} />}<span>{pinned ? t('sidebar.unpin') : t('sidebar.pin')}</span></button> : null}
      {showArchive ? <button type="button" role="menuitem" className="row-context-menu-item" onClick={() => run(onArchive)}><Archive size={13} /><span>{t('sidebar.archive')}</span></button> : null}
      {showPin || showArchive ? <div className="row-context-menu-separator" role="separator" /> : null}
      <button type="button" role="menuitem" className="row-context-menu-item is-danger" onClick={() => run(onRemove)}><Trash2 size={13} /><span>{t('sidebar.remove')}</span></button>
    </div>, document.body) : null}
  </div>
}

function RenameConversationDialog({ conversationName, onClose, onRename }: {
  conversationName: string
  onClose: () => void
  onRename: (title: string) => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const [title, setTitle] = useState(conversationName)
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])
  const submit = (): void => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    onRename(nextTitle)
  }
  return createPortal(<div className="remove-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="remove-dialog rename-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="remove-dialog-header"><span className="remove-dialog-icon rename-dialog-icon" aria-hidden="true"><Pencil size={18} /></span><div><span>{t('sidebar.renameDialog.eyebrow')}</span><h2 id={titleId}>{t('sidebar.renameDialog.title', { name: conversationName })}</h2></div><button type="button" className="settings-close-button" onClick={onClose} aria-label={t('sidebar.renameDialog.close')}><X size={16} /></button></div>
      <label className="import-dialog-field rename-dialog-field"><span>{t('sidebar.renameDialog.label')}</span><input autoFocus type="text" value={title} maxLength={160} onFocus={(event) => event.currentTarget.select()} placeholder={t('sidebar.renameDialog.placeholder')} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit() } }} /></label>
      <div className="remove-dialog-footer"><button className="ghost-button" type="button" onClick={onClose}>{t('common.cancel')}</button><button className="primary-button" type="button" disabled={!title.trim()} onClick={submit}>{t('sidebar.renameDialog.confirm')}</button></div>
    </section>
  </div>, document.body)
}

function RemoveWorkspaceItemDialog({ itemName, onClose, onConfirm }: {
  itemName: string
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [onClose])
  return createPortal(<div className="remove-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="remove-dialog remove-dialog-confirmation" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <div className="remove-dialog-header">
        <h2 id={titleId}>{t('sidebar.removeDialog.title', { name: itemName })}</h2>
      </div>
      <p id={descriptionId} className="remove-dialog-detail">{t('sidebar.removeDialog.detail')}</p>
      <div className="remove-dialog-footer">
        <button className="remove-dialog-cancel-button" type="button" onClick={onClose}>{t('common.cancel')}</button>
        <button className="remove-dialog-confirm-button" type="button" onClick={onConfirm}>{t('sidebar.removeDialog.confirm')}</button>
      </div>
    </section>
  </div>, document.body)
}

function ConversationListRow({ conversation, isActiveConversation, agentChatBusy, onOpen, onSetWorkspaceItemMeta, onRenameAgentConversation, onRemoveWorkspaceItem }: {
  conversation: AgentConversationSummary & { pending?: boolean }
  isActiveConversation: boolean
  agentChatBusy: boolean
  onOpen: () => void
  onSetWorkspaceItemMeta: TeachingWorkspaceNavigatorProps['onSetWorkspaceItemMeta']
  onRenameAgentConversation: TeachingWorkspaceNavigatorProps['onRenameAgentConversation']
  onRemoveWorkspaceItem: TeachingWorkspaceNavigatorProps['onRemoveWorkspaceItem']
}) {
  const { t } = useTranslation()
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const updateMeta = (pinned?: boolean, archived?: boolean): void => {
    void onSetWorkspaceItemMeta({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, ...(pinned === undefined ? {} : { pinned }), ...(archived === undefined ? {} : { archived }) })
  }
  const remove = (): void => {
    setRemoveDialogOpen(false)
    void onRemoveWorkspaceItem({ workspaceId: conversation.workspaceId, relativePath: conversation.relativePath, kind: 'conversation', mode: 'list' })
  }
  const inProgress = Boolean(conversation.pending && agentChatBusy)
  const isForkedBranch = Boolean(conversation.branch?.parentBranchId)
  const rename = (title: string): void => {
    setRenameDialogOpen(false)
    void onRenameAgentConversation({ workspaceId: conversation.workspaceId, conversationId: conversation.id, title, scope: 'temporary', ...(conversation.branch ? { expectedRevision: conversation.branch.revision } : {}) })
  }
  return <div className={`workspace-conversation-row ${isActiveConversation ? 'is-selected' : ''}${conversation.pending ? ' is-pending' : ''}${isForkedBranch ? ' is-fork' : ''}`} title={conversation.absolutePath}>
    <button type="button" className="workspace-conversation-main" onClick={onOpen}>
      {inProgress ? <Loader2 className="spin" size={13} /> : isForkedBranch ? <GitFork size={13} /> : conversation.pinned ? <Pin size={11} className="row-pin-indicator" /> : <MessageSquare size={13} />}
      <span className="workspace-conversation-body">
        <span className="workspace-conversation-title">{conversation.title}</span>
        {inProgress
          ? <span className="workspace-conversation-meta">{t('sidebar.pendingConversation')}</span>
          : null}
      </span>
    </button>
    {!conversation.pending ? <RowContextMenu pinned={!!conversation.pinned} onRename={() => setRenameDialogOpen(true)} onTogglePin={() => updateMeta(!conversation.pinned)} onArchive={() => updateMeta(undefined, true)} onRemove={() => setRemoveDialogOpen(true)} /> : null}
    {renameDialogOpen ? <RenameConversationDialog conversationName={conversation.title} onClose={() => setRenameDialogOpen(false)} onRename={rename} /> : null}
    {removeDialogOpen ? <RemoveWorkspaceItemDialog itemName={conversation.title} onClose={() => setRemoveDialogOpen(false)} onConfirm={remove} /> : null}
  </div>
}

function WorkspaceFileNodeRow({
  node, workspace, level, treeRoot, expandedPaths, selectedLessonPath,
  selectedFolderKey, activeConversationId, loading, agentChatBusy,
  onToggle, onSelectFolder, onClearFolderSelection,
  onEnsureWorkspaceSelected, onSetOverviewDialogMode, onOpenWorkspaceTeachingMode,
  onOpenPath, onOpenHtmlFile, onOpenMarkdownFile, onOpenCourse, onOpenLesson, onOpenConversation,
  onRestorePendingConversation, onSetWorkspaceItemMeta, onRenameAgentConversation, onRemoveWorkspaceItem, onRemoveWorkspace
}: {
  node: WorkspaceFileNode
  workspace: TeachingWorkspaceSummary
  level: number
  treeRoot?: 'courses'
  expandedPaths: Set<string>
  selectedLessonPath: string | null
  selectedFolderKey: string | null
  activeConversationId: string | null
  loading: boolean
  agentChatBusy: boolean
  onToggle: (workspaceId: string, relativePath: string) => void
  onSelectFolder: (workspaceId: string, relativePath: string) => void
  onClearFolderSelection: () => void
  onEnsureWorkspaceSelected: () => Promise<void>
  onSetOverviewDialogMode: (mode: 'teaching') => void
  onOpenWorkspaceTeachingMode: () => void
  onOpenPath: (path: string) => Promise<void>
  onOpenHtmlFile?: (file: CoursePreviewFile) => Promise<void>
  onOpenMarkdownFile?: (file: CoursePreviewFile) => Promise<void>
  onOpenCourse?: (relativePath: string | null, workspaceId: string) => void
  onOpenLesson: (lesson: LessonSummary) => Promise<void>
  onOpenConversation: (conversationId: string) => Promise<void>
  onRestorePendingConversation: () => void
  onSetWorkspaceItemMeta: TeachingWorkspaceNavigatorProps['onSetWorkspaceItemMeta']
  onRenameAgentConversation: TeachingWorkspaceNavigatorProps['onRenameAgentConversation']
  onRemoveWorkspaceItem: TeachingWorkspaceNavigatorProps['onRemoveWorkspaceItem']
  onRemoveWorkspace: TeachingWorkspaceNavigatorProps['onRemoveWorkspace']
}) {
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const isDirectory = node.kind === 'directory'
  const isExpanded = expandedPaths.has(workspaceNodeKey(workspace.id, node.relativePath))
  const lesson = workspace.lessons.find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const conversation = workspace.conversations.find((item) => sameRelativePath(item.relativePath, node.relativePath))
  const isPendingConversation = isPendingConversationSummary(conversation)
  const inProgress = Boolean(isPendingConversation && agentChatBusy)
  const isWorkspaceFolder = treeRoot === 'courses' && level === 0 && isDirectory && normalizePath(node.relativePath) === ''
  const isCourseFolder = treeRoot === 'courses' && isDirectory && !isWorkspaceFolder && isSidebarCourseFolderPath(node.relativePath)
  const isContentFolder = treeRoot === 'courses' && isDirectory && !isWorkspaceFolder && !isCourseFolder && isSidebarContentFolderPath(node.relativePath)
  const isHtmlFile = !isDirectory && node.name.toLowerCase().endsWith('.html')
  const isMarkdownFile = !isDirectory && node.name.toLowerCase().endsWith('.md')
  const isSelected = isTeachingWorkspaceNavigatorNodeSelected({
    node,
    lessonRelativePath: selectedLessonPath,
    activeConversationId,
    lessonRelativePaths: workspace.lessons.map((item) => item.relativePath),
    conversation: conversation ? { id: conversation.id } : null,
    courseTree: treeRoot === 'courses',
    workspaceId: workspace.id,
    selectedFolderKey,
    isWorkspaceFolder,
    isCourseFolder,
    isContentFolder
  })
  const itemKind: WorkspaceItemKind = conversation ? 'conversation' : isDirectory ? 'directory' : 'file'
  const itemLabel = conversation?.title ?? lesson?.title ?? node.name
  const isForkedConversation = Boolean(conversation?.branch?.parentBranchId)
  const Icon = isDirectory ? (isExpanded ? FolderOpen : Folder) : conversation ? (isForkedConversation ? GitFork : MessageSquare) : FileText

  const handleOpen = async (): Promise<void> => {
    if (treeRoot === 'courses') onSetOverviewDialogMode('teaching')
    if (isDirectory) {
      if (isWorkspaceFolder) {
        await onEnsureWorkspaceSelected()
        if (isExpanded) {
          // Collapse always clears folder highlight.
          onClearFolderSelection()
          onToggle(workspace.id, node.relativePath)
          return
        }
        // Collapsed: highlight and expand in one click.
        onSelectFolder(workspace.id, node.relativePath)
        onOpenWorkspaceTeachingMode()
        onToggle(workspace.id, node.relativePath)
        return
      }
      if (isCourseFolder) {
        await onEnsureWorkspaceSelected()
        if (isExpanded) {
          onClearFolderSelection()
          onOpenCourse?.(null, workspace.id)
          onToggle(workspace.id, node.relativePath)
          return
        }
        onSelectFolder(workspace.id, node.relativePath)
        onOpenCourse?.(node.relativePath, workspace.id)
        onToggle(workspace.id, node.relativePath)
        return
      }
      if (isContentFolder) {
        await onEnsureWorkspaceSelected()
        if (isExpanded) {
          onClearFolderSelection()
          onToggle(workspace.id, node.relativePath)
          return
        }
        onSelectFolder(workspace.id, node.relativePath)
        onToggle(workspace.id, node.relativePath)
        return
      }
      onToggle(workspace.id, node.relativePath)
      return
    }
    await onEnsureWorkspaceSelected()
    onClearFolderSelection()
    if (lesson) { await onOpenLesson(lesson); return }
    if (conversation) {
      if (isPendingConversation) onRestorePendingConversation()
      else await onOpenConversation(conversation.id)
      return
    }
    if (treeRoot === 'courses' && onOpenHtmlFile && isHtmlFile) {
      await onOpenHtmlFile({ title: titleFromFileName(node.name), relativePath: node.relativePath, absolutePath: node.absolutePath })
      return
    }
    if (treeRoot === 'courses' && onOpenMarkdownFile && isMarkdownFile) {
      await onOpenMarkdownFile({ title: titleFromFileName(node.name), relativePath: node.relativePath, absolutePath: node.absolutePath })
      return
    }
    await onOpenPath(node.absolutePath)
  }
  const setMeta = (pinned?: boolean, archived?: boolean): void => {
    if (isWorkspaceFolder) {
      void onSetWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: '', ...(pinned === undefined ? {} : { pinned }), ...(archived === undefined ? {} : { archived }) })
      return
    }
    void (async () => {
      await onEnsureWorkspaceSelected()
      await onSetWorkspaceItemMeta({ workspaceId: workspace.id, relativePath: node.relativePath, ...(pinned === undefined ? {} : { pinned }), ...(archived === undefined ? {} : { archived }) })
    })()
  }
  const rename = (title: string): void => {
    if (!conversation) return
    setRenameDialogOpen(false)
    void (async () => {
      await onEnsureWorkspaceSelected()
      await onRenameAgentConversation({ workspaceId: workspace.id, conversationId: conversation.id, title, scope: 'workspace', ...(conversation.branch ? { expectedRevision: conversation.branch.revision } : {}) })
    })()
  }
  const remove = (): void => {
    setRemoveDialogOpen(false)
    if (isWorkspaceFolder) { void onRemoveWorkspace({ workspaceId: workspace.id, mode: 'list' }); return }
    void (async () => {
      await onEnsureWorkspaceSelected()
      await onRemoveWorkspaceItem({ workspaceId: workspace.id, relativePath: node.relativePath, kind: itemKind, mode: 'list' })
    })()
  }

  return <div className="workspace-node">
    <div className={`workspace-node-row ${isSelected ? 'is-selected' : ''} ${isDirectory ? 'is-directory' : ''} ${isHtmlFile ? 'is-html-file' : ''} ${isMarkdownFile ? 'is-markdown-file' : ''} ${conversation ? 'is-conversation' : ''} ${isPendingConversation ? 'is-pending' : ''} ${isWorkspaceFolder ? 'is-workspace-folder' : ''} ${isCourseFolder ? 'is-course-folder' : ''} ${isContentFolder ? 'is-content-folder' : ''}`}
      style={{ paddingLeft: 4 + level * 12 }} role="treeitem" aria-expanded={isDirectory ? isExpanded : undefined}>
      <button className="workspace-node-button" type="button" title={node.absolutePath} aria-expanded={isDirectory ? isExpanded : undefined} onClick={() => void handleOpen()}>
        {inProgress ? <Loader2 className="spin" size={13} /> : <Icon size={13} />}
        {node.pinned ? <Pin size={10} className="row-pin-indicator" /> : null}
        <span className="collapsible-label">{conversation?.title ?? lesson?.sessionName ?? node.name}</span>
        {isDirectory ? <span className="workspace-node-chevron" aria-hidden="true">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span> : null}
      </button>
      {!isPendingConversation ? <RowContextMenu pinned={!!node.pinned} {...(conversation ? { onRename: () => setRenameDialogOpen(true) } : {})} onTogglePin={() => setMeta(!node.pinned)} onArchive={() => setMeta(undefined, true)} onRemove={() => setRemoveDialogOpen(true)} /> : null}
      {renameDialogOpen && conversation ? <RenameConversationDialog conversationName={conversation.title} onClose={() => setRenameDialogOpen(false)} onRename={rename} /> : null}
      {removeDialogOpen ? <RemoveWorkspaceItemDialog itemName={itemLabel} onClose={() => setRemoveDialogOpen(false)} onConfirm={remove} /> : null}
    </div>
    {isDirectory && node.children?.length ? <div className={`workspace-node-children${isExpanded ? ' is-open' : ''}${isWorkspaceFolder || isCourseFolder ? ' is-course-children' : ''}`} aria-hidden={!isExpanded} inert={!isExpanded ? true : undefined}>
      <div className="workspace-node-children-inner">{node.children.map((child) => <WorkspaceFileNodeRow
        key={workspaceNodeKey(workspace.id, child.relativePath)} node={child} workspace={workspace} level={level + 1} treeRoot={treeRoot}
        expandedPaths={expandedPaths} selectedLessonPath={selectedLessonPath}
        selectedFolderKey={selectedFolderKey}
        activeConversationId={activeConversationId} loading={loading} agentChatBusy={agentChatBusy}
        onToggle={onToggle} onSelectFolder={onSelectFolder} onClearFolderSelection={onClearFolderSelection}
        onEnsureWorkspaceSelected={onEnsureWorkspaceSelected} onSetOverviewDialogMode={onSetOverviewDialogMode}
        onOpenWorkspaceTeachingMode={onOpenWorkspaceTeachingMode} onOpenPath={onOpenPath} onOpenHtmlFile={onOpenHtmlFile}
        onOpenMarkdownFile={onOpenMarkdownFile} onOpenCourse={onOpenCourse} onOpenLesson={onOpenLesson}
        onOpenConversation={onOpenConversation} onRestorePendingConversation={onRestorePendingConversation}
        onSetWorkspaceItemMeta={onSetWorkspaceItemMeta} onRenameAgentConversation={onRenameAgentConversation} onRemoveWorkspaceItem={onRemoveWorkspaceItem} onRemoveWorkspace={onRemoveWorkspace}
      />)}</div>
    </div> : null}
  </div>
}

function normalizePath(value: string): string { return value.replace(/\\/g, '/') }
function titleFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').replace(/^\d{4}-/, '').replace(/-reference$/i, '')
  const title = stem.split(/[-_]+/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ')
  return title || fileName
}
