import assert from 'node:assert/strict'

import {
  projectVisibleAgentConversationWorkspaces,
  projectVisibleSidebarConversations
} from '../../src/renderer/src/agent-conversation-projection'

const existingConversation = {
  id: 'existing-1',
  workspaceId: 'workspace-1',
  title: 'Existing',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  relativePath: 'conversations/existing-1.md',
  absolutePath: 'D:/workspace/conversations/existing-1.md',
  messageCount: 2
}

const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  rootPath: 'D:/workspace',
  missionPath: 'D:/workspace/MISSION.md',
  resourcesPath: 'D:/workspace/resources',
  lessonsDir: 'D:/workspace/lessons',
  recordsDir: 'D:/workspace/records',
  referenceDir: 'D:/workspace/reference',
  reviewsDir: 'D:/workspace/reviews',
  missionTitle: 'Mission',
  missionExcerpt: '',
  courses: [
    {
      id: 'course-1',
      name: 'RAG',
      relativePath: 'courses/rag',
      absolutePath: 'D:/workspace/courses/rag',
      lessonCount: 0,
      sessionCount: 0,
      sessions: [],
      conversations: []
    }
  ],
  conversations: [existingConversation],
  fileTree: [],
  resources: [],
  records: [],
  lessons: [],
  referenceCount: 0,
  assetsReady: true,
  git: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

const otherWorkspace = {
  ...workspace,
  id: 'workspace-2',
  name: 'Other Workspace',
  conversations: []
}

const coursePending = {
  workspaceId: workspace.id,
  sourceConversationId: null,
  mode: 'teaching',
  summary: {
    id: 'pending-course',
    workspaceId: workspace.id,
    title: 'Course pending',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    relativePath: 'courses/rag/conversation/pending-course.md',
    absolutePath: 'D:/workspace/courses/rag/conversation/pending-course.md',
    messageCount: 2,
    pending: true
  },
  turns: [],
  status: '思考中...',
  toolsSupported: null
} as const

const projectedCourse = projectVisibleAgentConversationWorkspaces({
  workspaces: [workspace, otherWorkspace],
  activeWorkspace: workspace,
  selectedCourseWorkspaceId: workspace.id,
  pendingAgentConversation: coursePending
})

assert.notEqual(projectedCourse.workspaces[0], workspace)
assert.equal(projectedCourse.activeWorkspace?.conversations[0]?.id, coursePending.summary.id)
assert.equal(projectedCourse.selectedCourseWorkspace?.courses[0]?.conversations[0]?.id, coursePending.summary.id)
assert.equal(projectedCourse.selectedCourseWorkspace?.courses[0]?.sessionCount, 1)
assert.equal(projectedCourse.workspaces[1], otherWorkspace)
assert.deepEqual(
  projectVisibleSidebarConversations({
    workspace,
    conversations: workspace.conversations,
    pendingAgentConversation: coursePending
  }),
  workspace.conversations,
  'course pending conversations should stay out of the flat sidebar conversation section'
)

const temporaryPending = {
  ...coursePending,
  summary: {
    ...coursePending.summary,
    id: 'pending-temporary',
    title: 'Temporary pending',
    relativePath: 'conversations/pending-temporary.md',
    absolutePath: 'D:/workspace/conversations/pending-temporary.md'
  }
} as const

const projectedTemporary = projectVisibleAgentConversationWorkspaces({
  workspaces: [workspace],
  activeWorkspace: workspace,
  selectedCourseWorkspaceId: workspace.id,
  pendingAgentConversation: temporaryPending
})
assert.equal(projectedTemporary.workspaces[0], workspace)
assert.equal(projectedTemporary.selectedCourseWorkspace, workspace)

const sidebarConversations = projectVisibleSidebarConversations({
  workspace,
  conversations: workspace.conversations,
  pendingAgentConversation: temporaryPending
})
assert.equal(sidebarConversations[0]?.id, temporaryPending.summary.id)
assert.equal(sidebarConversations[1]?.id, existingConversation.id)

const replacementPending = {
  ...temporaryPending,
  summary: {
    ...temporaryPending.summary,
    id: 'pending-replacement',
    relativePath: existingConversation.relativePath
  }
} as const
const replacedSidebarConversations = projectVisibleSidebarConversations({
  workspace,
  conversations: workspace.conversations,
  pendingAgentConversation: replacementPending
})
assert.equal(replacedSidebarConversations.length, 1)
assert.equal(replacedSidebarConversations[0]?.id, replacementPending.summary.id)

console.log('agent conversation projection ok')
