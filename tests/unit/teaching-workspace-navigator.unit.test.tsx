import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/i18n'
import { TeachingWorkspaceNavigator, type TeachingWorkspaceNavigatorProps } from '../../src/renderer/src/app-shell/teaching-workspace-navigator'
import {
  initialTeachingWorkspaceNavigatorState,
  isTeachingWorkspaceNavigatorNodeSelected,
  teachingWorkspaceNavigatorReducer,
  workspaceNodeKey
} from '../../src/renderer/src/app-shell/teaching-workspace-navigator-state'
import type { PendingAgentConversation } from '../../src/renderer/src/agent-conversation-state'
import type { AgentConversationSummary, LessonSummary, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

const lesson: LessonSummary = {
  id: 'lesson-1', title: 'Limits lesson', objective: 'Understand limits', prompt: '', createdAt: '2026-07-14', durationMinutes: 10,
  courseId: 'course-1', courseName: 'Calculus', courseRelativePath: 'courses/calculus', courseAbsolutePath: 'D:/math/courses/calculus',
  sessionId: 'session-1', sessionName: 'Session 1 — Limits', sessionRelativePath: 'courses/calculus/lessons/001-limits',
  sessionAbsolutePath: 'D:/math/courses/calculus/lessons/001-limits', relativePath: 'courses/calculus/lessons/001-limits/lesson.html',
  absolutePath: 'D:/math/courses/calculus/lessons/001-limits/lesson.html'
}

const durableConversation: AgentConversationSummary = {
  id: 'durable-1', workspaceId: 'workspace-1', title: 'Course conversation', createdAt: '2026-07-14', updatedAt: '2026-07-14',
  relativePath: 'courses/calculus/conversation/course.json', absolutePath: 'D:/math/courses/calculus/conversation/course.json', messageCount: 2
}

const workspace: TeachingWorkspaceSummary = {
  id: 'workspace-1', name: 'Math workspace', rootPath: 'D:/math', missionPath: 'D:/math/MISSION.md', resourcesPath: 'D:/math/RESOURCES.md',
  lessonsDir: 'D:/math/courses', recordsDir: 'D:/math/records', referenceDir: 'D:/math/references', reviewsDir: 'D:/math/reviews',
  createdAt: '2026-07-14', updatedAt: '2026-07-14', agentWorkspaceTrust: 'untrusted', missionTitle: 'Learn calculus', missionExcerpt: 'A durable mission',
  courses: [{ id: 'course-1', name: 'Calculus', relativePath: 'courses/calculus', absolutePath: 'D:/math/courses/calculus', lessonCount: 1, sessionCount: 2,
    sessions: [{ id: 'session-1', name: 'Session 1 — Limits', relativePath: lesson.sessionRelativePath, absolutePath: lesson.sessionAbsolutePath, lesson }], conversations: [durableConversation] }],
  fileTree: [{ name: 'courses', kind: 'directory', relativePath: 'courses', absolutePath: 'D:/math/courses', children: [{ name: 'calculus', kind: 'directory', relativePath: 'courses/calculus', absolutePath: 'D:/math/courses/calculus', children: [] }] }],
  conversations: [durableConversation], resources: [], records: [], lessons: [lesson], referenceCount: 0, assetsReady: true, git: null
}

function renderNavigator(overrides: Partial<TeachingWorkspaceNavigatorProps> = {}) {
  const callbacks = {
    onSelectWorkspace: vi.fn(async () => {}), onSetOverviewDialogMode: vi.fn(), onOpenWorkspaceTeachingMode: vi.fn(), onSelectCourseFolder: vi.fn(),
    onLoadLesson: vi.fn(async () => {}), onLoadCourseHtmlFile: vi.fn(async () => {}), onLoadWorkspaceMarkdownFile: vi.fn(async () => {}),
    onLoadAgentConversation: vi.fn(async () => {}), onRestorePendingAgentConversation: vi.fn(), onOpenPath: vi.fn(async () => {}),
    onImportWorkspace: vi.fn(async () => true), onImportWorkspacePath: vi.fn(async () => true),
    onSetWorkspaceItemMeta: vi.fn(async () => {}), onRenameAgentConversation: vi.fn(async () => {}), onRemoveWorkspaceItem: vi.fn(async () => {}), onRemoveWorkspace: vi.fn(async () => {})
  }
  render(<TeachingWorkspaceNavigator workspaces={[workspace]} activeWorkspace={workspace} temporaryConversations={[]} selectedLessonPath={null}
    selectedCourseRelativePath={null} selectedCourseWorkspaceId={null}
    view="overview" activeConversationId={null} pendingAgentConversation={null} agentChatBusy={false} showAllCourseFiles={false} defaultRoot="D:/math" loading={false}
    {...callbacks} {...overrides} />)
  return callbacks
}

describe('TeachingWorkspaceNavigator state', () => {
  it('uses durable tree keys and clears expanded tree paths when courses collapse', () => {
    const key = workspaceNodeKey('workspace-1', 'courses\\calculus')
    const expanded = teachingWorkspaceNavigatorReducer(initialTeachingWorkspaceNavigatorState, { type: 'toggle-path', workspaceId: 'workspace-1', relativePath: 'courses\\calculus' })
    expect(expanded.expandedPaths).toEqual(new Set([key]))
    const collapsed = teachingWorkspaceNavigatorReducer(expanded, { type: 'toggle-courses' })
    expect(collapsed.coursesExpanded).toBe(false)
    expect(collapsed.expandedPaths).toEqual(new Set())
  })

  it('tracks local folder selection independently from expand state', () => {
    const selected = teachingWorkspaceNavigatorReducer(initialTeachingWorkspaceNavigatorState, {
      type: 'select-folder',
      workspaceId: 'workspace-1',
      relativePath: 'courses/calculus'
    })
    expect(selected.selectedFolderKey).toBe(workspaceNodeKey('workspace-1', 'courses/calculus'))
    const cleared = teachingWorkspaceNavigatorReducer(selected, { type: 'clear-folder-selection' })
    expect(cleared.selectedFolderKey).toBeNull()
  })
})

describe('isTeachingWorkspaceNavigatorNodeSelected', () => {
  const base = {
    lessonRelativePath: null as string | null,
    activeConversationId: null as string | null,
    lessonRelativePaths: [lesson.relativePath],
    conversation: null as { id: string } | null,
    courseTree: true,
    workspaceId: workspace.id,
    selectedFolderKey: null as string | null,
    isWorkspaceFolder: false,
    isCourseFolder: false,
    isContentFolder: false
  }

  it('highlights the workspace folder only from selectedFolderKey when no file is selected', () => {
    const node = { name: workspace.name, kind: 'directory' as const, relativePath: '', absolutePath: workspace.rootPath }
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node, isWorkspaceFolder: true, selectedFolderKey: workspaceNodeKey(workspace.id, '')
    })).toBe(true)
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node, isWorkspaceFolder: true, selectedFolderKey: null
    })).toBe(false)
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node, isWorkspaceFolder: true, selectedFolderKey: workspaceNodeKey(workspace.id, ''), lessonRelativePath: lesson.absolutePath
    })).toBe(false)
  })

  it('highlights a course folder only when selectedFolderKey matches', () => {
    const node = { name: 'Calculus', kind: 'directory' as const, relativePath: 'courses/calculus', absolutePath: 'D:/math/courses/calculus' }
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node, isCourseFolder: true, selectedFolderKey: workspaceNodeKey(workspace.id, 'courses/calculus')
    })).toBe(true)
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node, isCourseFolder: true, selectedFolderKey: workspaceNodeKey(workspace.id, 'lessons')
    })).toBe(false)
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node, isCourseFolder: true, selectedFolderKey: workspaceNodeKey('other', 'courses/calculus')
    })).toBe(false)
  })

  it('highlights content folders and active conversations', () => {
    const conversationFolder = { name: 'conversation', kind: 'directory' as const, relativePath: 'courses/calculus/conversation', absolutePath: 'D:/math/courses/calculus/conversation' }
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node: conversationFolder, isContentFolder: true, selectedFolderKey: workspaceNodeKey(workspace.id, 'courses/calculus/conversation')
    })).toBe(true)
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node: conversationFolder, isContentFolder: true, selectedFolderKey: null
    })).toBe(false)

    const conversationNode = { name: 'course.json', kind: 'file' as const, relativePath: durableConversation.relativePath, absolutePath: durableConversation.absolutePath }
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node: conversationNode, conversation: { id: durableConversation.id }, activeConversationId: durableConversation.id
    })).toBe(true)
    expect(isTeachingWorkspaceNavigatorNodeSelected({
      ...base, node: conversationNode, conversation: { id: durableConversation.id }, activeConversationId: 'other'
    })).toBe(false)
  })
})

describe('TeachingWorkspaceNavigator', () => {
  it('expands and highlights a collapsed folder on first click, then clears highlight on collapse', async () => {
    const user = userEvent.setup()
    const callbacks = renderNavigator({
      view: 'overview',
      selectedLessonPath: null,
      selectedCourseRelativePath: null,
      selectedCourseWorkspaceId: null
    })

    expect(screen.getByRole('treeitem', { name: 'Math workspace' })).not.toHaveClass('is-selected')
    expect(screen.queryByRole('treeitem', { name: 'Calculus' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Math workspace' }))
    expect(callbacks.onOpenWorkspaceTeachingMode).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('treeitem', { name: 'Math workspace' })).toHaveClass('is-selected')
    expect(screen.getByRole('treeitem', { name: 'Calculus' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Math workspace' }))
    expect(screen.getByRole('treeitem', { name: 'Math workspace' })).not.toHaveClass('is-selected')
    expect(screen.queryByRole('treeitem', { name: 'Calculus' })).not.toBeInTheDocument()
  })

  it('preserves Course → Session → Lesson navigation and emits App-owned intents', async () => {
    const user = userEvent.setup()
    const callbacks = renderNavigator({
      view: 'overview',
      selectedLessonPath: null,
      selectedCourseRelativePath: null,
      selectedCourseWorkspaceId: null
    })

    await user.click(screen.getByRole('button', { name: 'Math workspace' }))
    await user.click(screen.getByRole('button', { name: 'Calculus' }))
    expect(callbacks.onSelectCourseFolder).toHaveBeenCalledWith('courses/calculus', 'workspace-1')
    expect(screen.getByRole('treeitem', { name: 'Calculus' })).toHaveClass('is-selected')
    expect(screen.getByRole('treeitem', { name: 'Math workspace' })).not.toHaveClass('is-selected')

    await user.click(screen.getByRole('button', { name: 'Calculus' }))
    expect(callbacks.onSelectCourseFolder).toHaveBeenCalledWith(null, 'workspace-1')
    expect(screen.getByRole('treeitem', { name: 'Calculus' })).not.toHaveClass('is-selected')

    // Expand again to open lesson / conversation under the course.
    await user.click(screen.getByRole('button', { name: 'Calculus' }))
    await user.click(screen.getByRole('button', { name: 'lesson' }))
    expect(screen.getByRole('treeitem', { name: 'lesson' })).toHaveClass('is-selected')
    expect(screen.getByRole('treeitem', { name: 'lesson' })).toHaveClass('is-content-folder')
    await user.click(screen.getByRole('button', { name: 'Session 1 — Limits' }))
    expect(callbacks.onLoadLesson).toHaveBeenCalledWith(lesson)
    await user.click(screen.getByRole('button', { name: 'conversation' }))
    expect(screen.getByRole('treeitem', { name: 'conversation' })).toHaveClass('is-selected')
    expect(screen.getByRole('treeitem', { name: 'conversation' })).toHaveClass('is-content-folder')
    await user.click(screen.getByRole('button', { name: 'Course conversation' }))
    expect(callbacks.onLoadAgentConversation).toHaveBeenCalledWith('durable-1', 'workspace-1', 'workspace')
    expect(callbacks.onSetOverviewDialogMode).toHaveBeenCalled()
  })

  it('renames a temporary conversation from its more-actions menu', async () => {
    const user = userEvent.setup()
    const conversation: AgentConversationSummary = {
      id: 'temporary-rename', workspaceId: 'workspace-1', title: 'Original title', createdAt: '2026-07-17', updatedAt: '2026-07-17',
      relativePath: 'conversations/temporary-rename.md', absolutePath: 'D:/app-data/conversations/temporary-rename.md', messageCount: 2,
      branch: { schemaVersion: 1, sessionId: 'temporary-rename', branchId: 'temporary-rename', revision: 3, status: 'active' }
    }
    const callbacks = renderNavigator({ temporaryConversations: [conversation] })
    const row = screen.getByText('Original title').closest('.workspace-conversation-row')!
    await user.click(within(row).getByRole('button', { name: /更多操作|More actions/ }))
    await user.click(await screen.findByRole('menuitem', { name: /重命名|Rename/ }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Renamed title' } })
    await user.click(within(dialog).getByRole('button', { name: '重命名' }))
    expect(callbacks.onRenameAgentConversation).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'temporary-rename', title: 'Renamed title', scope: 'temporary', expectedRevision: 3
    })
  })

  it('only shows the in-progress spinner while the pending conversation is actively running', async () => {
    const pendingConversation: PendingAgentConversation = {
      workspaceId: 'workspace-1',
      sourceConversationId: null,
      sourceConversationRevision: null,
      mode: 'temporary',
      status: '',
      toolsSupported: null,
      summary: {
        id: 'pending-1', workspaceId: 'workspace-1', title: 'Running draft', createdAt: '2026-08-08', updatedAt: '2026-08-08',
        relativePath: 'conversations/pending-1.md', absolutePath: 'D:/app-data/conversations/pending-1.md', messageCount: 2,
        pending: true
      },
      turns: [
        { id: 'u-1', role: 'user', content: 'Hello', createdAt: '2026-08-08T00:00:00.000Z' },
        { id: 'a-1', role: 'assistant', content: '', createdAt: '2026-08-08T00:00:00.000Z' }
      ]
    }

    renderNavigator({ temporaryConversations: [], pendingAgentConversation: pendingConversation, agentChatBusy: true })
    const rowWhileRunning = screen.getByText('Running draft').closest('.workspace-conversation-row')
    expect(rowWhileRunning).toHaveClass('is-pending')
    expect(within(rowWhileRunning!).getByText('进行中')).toBeInTheDocument()
    expect(rowWhileRunning!.querySelector('.spin')).not.toBeNull()

    cleanup()
    renderNavigator({ temporaryConversations: [], pendingAgentConversation: pendingConversation, agentChatBusy: false })
    const rowAfterEnded = screen.getByText('Running draft').closest('.workspace-conversation-row')
    expect(rowAfterEnded).toHaveClass('is-pending')
    expect(within(rowAfterEnded!).queryByText('进行中')).toBeNull()
    expect(rowAfterEnded!.querySelector('.spin')).toBeNull()
  })
})
