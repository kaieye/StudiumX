import { describe, expect, it } from 'vitest'
import {
  openAgentConversationContext,
  openLessonReaderContext,
  openPrimaryView,
  openWorkspaceMarkdownContext,
  openWorkspaceTeaching,
  selectCourseFolderContext
} from '../../src/renderer/src/app-shell/contextTransitions'
import type { AgentConversationRecord, TeachingAppState, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'

const workspace = {
  id: 'workspace-1',
  name: 'Math workspace',
  rootPath: 'D:/math',
  courses: [],
  lessons: []
} as unknown as TeachingWorkspaceSummary

const appState = {
  activeWorkspace: workspace,
  workspaces: [workspace],
  selectedLessonPath: 'D:/math/courses/calculus/lesson.html',
  previewHtml: '<html></html>',
  previewUrl: 'file://preview'
} as unknown as TeachingAppState

describe('selectCourseFolderContext', () => {
  it('preserves a streaming conversation when navigating to an empty course', () => {
    const patch = selectCourseFolderContext({
      selectedCourseRelativePath: 'courses/new-course',
      targetWorkspace: {
        id: 'workspace-1',
        name: '学习工作区',
        rootPath: 'C:/workspace',
        courses: [],
        lessons: []
      } as never,
      pendingAgentConversation: {
        summary: {
          id: 'pending-run-1',
          relativePath: 'conversation/pending-run-1.md'
        },
        workspaceId: 'workspace-1',
        mode: 'teaching',
        turns: [],
        status: '正在生成…',
        toolsSupported: null
      } as never
    })

    expect(patch.agentTurns).toBeUndefined()
    expect(patch.pendingAgentConversation).toBeUndefined()
    expect(patch.activeConversationId).toBeUndefined()
    expect(patch.view).toBe('overview')
  })
})

describe('sidebar selection exclusivity', () => {
  it('clears activeConversationId when opening an html lesson file', () => {
    const patch = openLessonReaderContext({
      appState,
      workspace,
      previewFile: {
        title: 'Limits',
        relativePath: 'courses/calculus/lesson.html',
        absolutePath: 'D:/math/courses/calculus/lesson.html'
      },
      previewHtml: '<html>limits</html>',
      courseRelativePath: 'courses/calculus'
    })
    expect(patch.activeConversationId).toBeNull()
    expect(patch.appState.selectedLessonPath).toBe('D:/math/courses/calculus/lesson.html')
  })

  it('clears activeConversationId when opening a markdown file', () => {
    const patch = openWorkspaceMarkdownContext({
      appState,
      workspace,
      file: {
        title: 'Mission',
        relativePath: 'MISSION.md',
        absolutePath: 'D:/math/MISSION.md'
      },
      courseRelativePath: null
    })
    expect(patch.activeConversationId).toBeNull()
    expect(patch.appState.selectedLessonPath).toBe('D:/math/MISSION.md')
  })

  it('clears selectedLessonPath when opening a conversation', () => {
    const conversation = {
      id: 'durable-1',
      relativePath: 'courses/calculus/conversation/course.json',
      turns: []
    } as unknown as AgentConversationRecord
    const patch = openAgentConversationContext({
      conversation,
      workspaceId: workspace.id,
      appState,
      currentOverviewDialogMode: 'teaching',
      currentTaskPrompt: 'hello'
    })
    expect(patch.activeConversationId).toBe('durable-1')
    expect(patch.appState?.selectedLessonPath).toBeNull()
  })
})

describe('primary destinations clear sidebar selection chrome', () => {
  it('clears conversation and file selection when opening a primary view', () => {
    const patch = openPrimaryView('resources', appState)
    expect(patch.view).toBe('resources')
    expect(patch.activeConversationId).toBeNull()
    expect(patch.selectedCourseRelativePath).toBeNull()
    expect(patch.selectedCourseWorkspaceId).toBeNull()
    expect(patch.selectedResourcePreviewFile).toBeNull()
    expect(patch.selectedCoursePreviewFile).toBeNull()
    expect(patch.selectedMarkdownDocument).toBeNull()
    expect(patch.appState?.selectedLessonPath).toBeNull()
  })

  it('clears conversation and course selection when opening workspace teaching', () => {
    const patch = openWorkspaceTeaching(appState)
    expect(patch.view).toBe('overview')
    expect(patch.overviewDialogMode).toBe('teaching')
    expect(patch.activeConversationId).toBeNull()
    expect(patch.selectedCourseRelativePath).toBeNull()
    expect(patch.selectedCourseWorkspaceId).toBeNull()
    expect(patch.appState?.selectedLessonPath).toBeNull()
  })

  it('clears selection when opening workbench primary view', () => {
    const patch = openPrimaryView('workbench', appState)
    expect(patch.view).toBe('workbench')
    expect(patch.activeConversationId).toBeNull()
    expect(patch.appState?.selectedLessonPath).toBeNull()
  })

  it('does not clear conversation when opening agent view', () => {
    const patch = openPrimaryView('agent', appState)
    expect(patch).toEqual({ view: 'agent' })
  })
})
