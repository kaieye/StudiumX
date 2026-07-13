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
  createdAt: '2026-07-14', updatedAt: '2026-07-14', missionTitle: 'Learn calculus', missionExcerpt: 'A durable mission',
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
    onSetWorkspaceItemMeta: vi.fn(async () => {}), onRemoveWorkspaceItem: vi.fn(async () => {}), onRemoveWorkspace: vi.fn(async () => {})
  }
  render(<TeachingWorkspaceNavigator workspaces={[workspace]} activeWorkspace={workspace} temporaryConversations={[]} selectedLessonPath={null}
    view="overview" activeConversationId={null} pendingAgentConversation={null} showAllCourseFiles={false} defaultRoot="D:/math" loading={false} {...callbacks} {...overrides} />)
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
    expect(callbacks.onLoadAgentConversation).toHaveBeenCalledWith('durable-1', 'workspace-1')
    expect(callbacks.onSetOverviewDialogMode).toHaveBeenCalled()
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