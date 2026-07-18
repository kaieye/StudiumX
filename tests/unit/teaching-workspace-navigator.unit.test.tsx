import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../../src/renderer/src/i18n'
import { TeachingWorkspaceNavigator, type TeachingWorkspaceNavigatorProps } from '../../src/renderer/src/app-shell/teaching-workspace-navigator'
import {
  initialTeachingWorkspaceNavigatorState,
  teachingWorkspaceNavigatorReducer,
  workspaceNodeKey
} from '../../src/renderer/src/app-shell/teaching-workspace-navigator-state'
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
    onImportWorkspace: vi.fn(async () => true), onImportWorkspacePath: vi.fn(async () => true), onOpenImportLocation: vi.fn(async () => {}),
    onSetWorkspaceItemMeta: vi.fn(async () => {}), onSetWorkspaceTrust: vi.fn(async () => true), onRenameAgentConversation: vi.fn(async () => {}), onRemoveWorkspaceItem: vi.fn(async () => {}), onRemoveWorkspace: vi.fn(async () => {})
  }
  render(<TeachingWorkspaceNavigator workspaces={[workspace]} activeWorkspace={workspace} temporaryConversations={[]} selectedLessonPath={null}
    view="overview" activeConversationId={null} pendingAgentConversation={null} showAllCourseFiles={false} defaultRoot="D:/math" loading={false}
    workspaceWritePermission="ask_each_time" pendingWorkspaceTrustIds={new Set()} {...callbacks} {...overrides} />)
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
})

describe('TeachingWorkspaceNavigator', () => {
  it('preserves Course → Session → Lesson navigation and emits App-owned intents', async () => {
    const user = userEvent.setup()
    const callbacks = renderNavigator({ view: 'lessons', selectedLessonPath: lesson.absolutePath })

    await user.click(screen.getByRole('button', { name: 'Math workspace' }))
    expect(callbacks.onOpenWorkspaceTeachingMode).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Calculus' }))
    expect(callbacks.onSelectCourseFolder).toHaveBeenCalledWith('courses/calculus', 'workspace-1')
    await user.click(screen.getByRole('button', { name: 'lesson' }))
    await user.click(screen.getByRole('button', { name: 'Session 1 — Limits' }))
    expect(callbacks.onLoadLesson).toHaveBeenCalledWith(lesson)
    expect(screen.getByRole('treeitem', { name: 'Session 1 — Limits' })).toHaveClass('is-selected')
    await user.click(screen.getByRole('button', { name: 'conversation' }))
    await user.click(screen.getByRole('button', { name: 'Course conversation' }))
    expect(callbacks.onLoadAgentConversation).toHaveBeenCalledWith('durable-1', 'workspace-1', 'workspace')
    expect(callbacks.onSetOverviewDialogMode).toHaveBeenCalled()
  })

  it('keeps trust and Settings Workspace write policy visibly and accessibly distinct', async () => {
    const user = userEvent.setup()
    const callbacks = renderNavigator()

    expect(screen.getByLabelText(/Agent workspace file tools are untrusted|Agent 未获工作区文件工具访问权限/)).toBeVisible()
    expect(screen.getByLabelText(/Workspace write permission: Writes: Ask every time|工作区写入权限：写入：每次询问/)).toBeVisible()
    expect(screen.getByText(/Trust gates Agent workspace file tools|信任控制 Agent 能否使用工作区文件工具/)).toBeVisible()
    expect(screen.getByText(/revoking does not interrupt an Agent turn already running|撤销不会中断已经运行中的轮次/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: /Trust Math workspace|信任 Math workspace/ }))
    expect(callbacks.onSetWorkspaceTrust).toHaveBeenCalledWith('workspace-1', 'trusted')
    expect(callbacks.onSetWorkspaceTrust).toHaveBeenLastCalledWith(expect.any(String), expect.any(String))
    expect(await screen.findByRole('status')).toHaveTextContent(/Agent file access updated|Agent 文件访问权限已为后续 Agent 轮次更新/)
  })

  it('offers an accessible Revoke action for trusted workspaces and disables trust changes while loading', async () => {
    const user = userEvent.setup()
    const trustedWorkspace = { ...workspace, agentWorkspaceTrust: 'trusted' as const }
    const callbacks = renderNavigator({ workspaces: [trustedWorkspace], activeWorkspace: trustedWorkspace })

    const revoke = screen.getByRole('button', { name: /Revoke Agent file access for Math workspace|撤销 Agent 对 Math workspace 后续轮次的文件访问权限/ })
    expect(revoke).toHaveAttribute('title', expect.stringMatching(/Revoke Agent file access|撤销 Agent 后续轮次的文件访问权限/))
    await user.click(revoke)
    expect(callbacks.onSetWorkspaceTrust).toHaveBeenCalledWith('workspace-1', 'untrusted')

    renderNavigator({ loading: true })
    expect(screen.getByRole('button', { name: /Trust Math workspace|信任 Math workspace/ })).toBeDisabled()
  })

  it('shows localized per-workspace updating feedback without disabling another workspace trust control', () => {
    const otherWorkspace = { ...workspace, id: 'workspace-2', name: 'Physics workspace', rootPath: 'D:/physics', agentWorkspaceTrust: 'untrusted' as const }
    renderNavigator({
      workspaces: [workspace, otherWorkspace],
      activeWorkspace: workspace,
      pendingWorkspaceTrustIds: new Set(['workspace-1'])
    })

    const updating = screen.getByRole('button', { name: /Updating Agent file access for Math workspace|正在更新 Math workspace 的 Agent 文件访问权限/ })
    expect(updating).toBeDisabled()
    expect(updating).toHaveAttribute('aria-busy', 'true')
    expect(updating).toHaveTextContent(/Updating|正在更新/)
    expect(screen.getByRole('button', { name: /Trust Physics workspace|信任 Physics workspace/ })).toBeEnabled()
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
    await user.click(screen.getByRole('menuitem', { name: /^(重命名|Rename)$/ }))

    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'Renamed title')
    await user.click(within(dialog).getByRole('button', { name: /^(重命名|Rename)$/ }))

    expect(callbacks.onRenameAgentConversation).toHaveBeenCalledWith({
      workspaceId: 'workspace-1', conversationId: 'temporary-rename', title: 'Renamed title', scope: 'temporary', expectedRevision: 3
    })
  })

  it('keeps pending temporary conversations restorable and preserves menu/dialog keyboard behavior', async () => {
    const user = userEvent.setup()
    const pending: AgentConversationSummary = {
      id: 'pending-1', workspaceId: 'workspace-1', title: 'Pending temporary conversation', createdAt: '2026-07-14', updatedAt: '2026-07-14',
      relativePath: 'conversations/pending.json', absolutePath: 'D:/math/conversations/pending.json', messageCount: 1
    }
    const callbacks = renderNavigator({ temporaryConversations: [pending], pendingAgentConversation: { workspaceId: 'workspace-1', sourceConversationId: null, summary: { ...pending, pending: true }, mode: 'temporary', turns: [], status: 'working', toolsSupported: null } })

    await user.click(screen.getByRole('button', { name: /Pending temporary conversation/ }))
    expect(callbacks.onRestorePendingAgentConversation).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Math workspace' }))
    const trigger = document.querySelector('.row-context-menu-trigger') as HTMLButtonElement
    await user.click(trigger)
    const menu = screen.getByRole('menu')
    const removeButton = menu.querySelector('.is-danger') as HTMLButtonElement
    await user.click(removeButton)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the import dialog and delegates typed paths without taking filesystem authority', async () => {
    const user = userEvent.setup()
    const callbacks = renderNavigator()
    await user.click(screen.getByRole('button', { name: /添加项目|Add project/ }))
    const dialog = screen.getByRole('dialog')
    const input = within(dialog).getByRole('textbox')
    await user.clear(input)
    await user.type(input, 'D:/imported')
    await user.keyboard('{Enter}')
    expect(callbacks.onImportWorkspacePath).toHaveBeenCalledWith('D:/imported')
  })
})
