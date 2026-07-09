import assert from 'node:assert/strict'

import {
  activateWorkspaceContext,
  clearRemovedWorkspaceContext,
  openAgentConversationContext,
  openLessonReaderContext,
  openResourceReaderContext,
  openWorkspaceTeaching,
  restorePendingConversationContext,
  selectCourseFolderContext
} from '../../src/renderer/src/app-shell/contextTransitions'

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  rootPath: 'D:/workspace',
  missionTitle: 'Mission',
  missionExcerpt: '',
  lessons: [
    {
      id: 'lesson-1',
      title: 'Retrieval Basics',
      objective: '',
      prompt: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      durationMinutes: 15,
      relativePath: 'courses/rag/001.html',
      absolutePath: 'D:/workspace/courses/rag/001.html',
      courseName: 'RAG',
      courseRelativePath: 'courses/rag',
      sessionName: 'Retrieval Basics'
    }
  ],
  courses: [
    {
      name: 'RAG',
      relativePath: 'courses/rag',
      sessions: [],
      sessionCount: 1,
      conversations: []
    },
    {
      name: 'Empty',
      relativePath: 'courses/empty',
      sessions: [],
      sessionCount: 0,
      conversations: []
    }
  ],
  conversations: [],
  fileTree: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const appState = {
  workspaces: [workspace],
  activeWorkspace: workspace,
  temporaryConversations: [],
  previewHtml: '',
  previewUrl: '',
  selectedLessonPath: null,
  runtime: {
    status: 'idle',
    currentStep: '',
    queuedTasks: 0,
    providerLabel: ''
  }
}

const workspaceTeaching = openWorkspaceTeaching()
assert.equal(workspaceTeaching.view, 'overview')
assert.equal(workspaceTeaching.overviewDialogMode, 'teaching')
assert.equal(workspaceTeaching.lessonReaderOpen, false)
assert.equal(workspaceTeaching.selectedCourseRelativePath, null)
assert.equal(workspaceTeaching.activeConversationId, null)
assert.equal(workspaceTeaching.pendingAgentConversation, null)

const activatedWorkspace = activateWorkspaceContext({
  appState,
  taskPrompt: 'next lesson',
  loading: false
})
assert.equal(activatedWorkspace.appState, appState)
assert.equal(activatedWorkspace.loading, false)
assert.equal(activatedWorkspace.lessonReaderOpen, false)
assert.equal(activatedWorkspace.selectedCoursePreviewFile, null)
assert.equal(activatedWorkspace.selectedResourcePreviewFile, null)
assert.equal(activatedWorkspace.selectedCourseRelativePath, null)
assert.equal(activatedWorkspace.selectedCourseWorkspaceId, null)
assert.equal(activatedWorkspace.taskPrompt, 'next lesson')
assert.deepEqual(activatedWorkspace.agentTurns, [])
assert.equal(activatedWorkspace.activeConversationId, null)
assert.equal(activatedWorkspace.agentStatus, '')
assert.equal(activatedWorkspace.agentInput, '')
assert.equal(activatedWorkspace.agentToolsSupported, null)
assert.equal(activatedWorkspace.agentChatBusy, false)
assert.equal(activatedWorkspace.pendingAgentConversation, null)

const courseWithContent = selectCourseFolderContext({
  selectedCourseRelativePath: 'courses/rag',
  targetWorkspace: workspace
})
assert.equal(courseWithContent.view, 'lessons')
assert.equal(courseWithContent.overviewDialogMode, 'teaching')
assert.equal(courseWithContent.selectedCourseWorkspaceId, workspace.id)
assert.equal(courseWithContent.pendingAgentConversation, undefined)

const emptyCourse = selectCourseFolderContext({
  selectedCourseRelativePath: 'courses/empty',
  targetWorkspace: workspace
})
assert.equal(emptyCourse.view, 'overview')
assert.equal(emptyCourse.overviewDialogMode, 'teaching')
assert.equal(emptyCourse.activeConversationId, null)
assert.equal(emptyCourse.pendingAgentConversation, null)

const pendingTeaching = restorePendingConversationContext({
  mode: 'teaching',
  workspaceId: workspace.id,
  summary: {
    id: 'pending-1',
    workspaceId: workspace.id,
    title: 'Pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    relativePath: 'courses/rag/conversation/pending-1.md',
    absolutePath: 'D:/workspace/courses/rag/conversation/pending-1.md',
    messageCount: 1
  },
  turns: [{ id: 'u1', role: 'user', content: 'Continue', createdAt: '2026-01-01T00:00:00.000Z' }],
  status: 'thinking',
  toolsSupported: true
}, 'chat')
assert.equal(pendingTeaching.view, 'overview')
assert.equal(pendingTeaching.overviewDialogMode, 'teaching')
assert.equal(pendingTeaching.selectedCourseRelativePath, 'courses/rag')
assert.equal(pendingTeaching.selectedCourseWorkspaceId, workspace.id)

const loadedCourseConversation = openAgentConversationContext({
  workspaceId: workspace.id,
  currentOverviewDialogMode: 'chat',
  currentTaskPrompt: 'old prompt',
  conversation: {
    id: 'chat-1',
    workspaceId: workspace.id,
    title: 'RAG',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    relativePath: 'courses/rag/conversation/chat-1.md',
    absolutePath: 'D:/workspace/courses/rag/conversation/chat-1.md',
    messageCount: 1,
    turns: [{ id: 'u1', role: 'user', content: 'Design RAG', createdAt: '2026-01-01T00:00:00.000Z' }]
  }
})
assert.equal(loadedCourseConversation.view, 'overview')
assert.equal(loadedCourseConversation.overviewDialogMode, 'teaching')
assert.equal(loadedCourseConversation.taskPrompt, 'Design RAG')

const lessonReader = openLessonReaderContext({
  appState,
  workspace,
  previewFile: {
    title: 'Retrieval Basics',
    relativePath: 'courses/rag/001.html',
    absolutePath: 'D:/workspace/courses/rag/001.html'
  },
  previewHtml: '<html>loading</html>',
  courseRelativePath: 'courses/rag'
})
assert.equal(lessonReader.view, 'lessons')
assert.equal(lessonReader.overviewDialogMode, 'teaching')
assert.equal(lessonReader.lessonReaderOpen, true)
assert.equal(lessonReader.selectedResourcePreviewFile, null)
assert.equal(lessonReader.appState.selectedLessonPath, 'D:/workspace/courses/rag/001.html')

const resourceReader = openResourceReaderContext({ id: 'r1', title: 'Reference', html: '<p>ref</p>' })
assert.equal(resourceReader.view, 'resources')
assert.equal(resourceReader.lessonReaderOpen, false)
assert.equal(resourceReader.selectedCoursePreviewFile, null)

const removedWorkspace = clearRemovedWorkspaceContext({
  nextState: { ...appState, activeWorkspace: null, workspaces: [] },
  previousView: 'lessons',
  nextPrompt: 'next',
  defaultPrompt: ''
})
assert.equal(removedWorkspace.view, 'overview')
assert.equal(removedWorkspace.selectedCourseWorkspaceId, null)
assert.equal(removedWorkspace.activeConversationId, null)

console.log('app shell context transitions ok')
