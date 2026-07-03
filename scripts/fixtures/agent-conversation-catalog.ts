import assert from 'node:assert/strict'

import {
  agentConversationDirectoryRelativePath,
  agentConversationDirectoryRelativePathsForCourse,
  agentConversationJsonRelativePathForMarkdown,
  courseRelativePathForAgentConversation,
  describeAgentConversationPath,
  isCourseAgentConversationPath,
  isRootAgentConversationMarkdownRelativePath,
  isTemporaryAgentConversationPath,
  pendingAgentConversationRelativePath,
  primaryAgentConversationDirectoryRelativePathForCourse
} from '../../src/shared/agent-conversation-catalog'

assert.deepEqual(describeAgentConversationPath('conversation/chat-1.md'), {
  normalizedRelativePath: 'conversation/chat-1.md',
  directoryRelativePath: 'conversation',
  id: 'chat-1',
  format: 'markdown',
  scope: 'course',
  courseRelativePath: 'lessons'
})

assert.deepEqual(describeAgentConversationPath('courses/rag/conversations/chat-2.json'), {
  normalizedRelativePath: 'courses/rag/conversations/chat-2.json',
  directoryRelativePath: 'courses/rag/conversations',
  id: 'chat-2',
  format: 'json',
  scope: 'course',
  courseRelativePath: 'courses/rag'
})

assert.equal(isTemporaryAgentConversationPath('conversations/chat-3.md'), true)
assert.equal(isRootAgentConversationMarkdownRelativePath('conversations/chat-3.md'), true)
assert.equal(isCourseAgentConversationPath('lessons/conversation/chat-4.md'), true)
assert.equal(courseRelativePathForAgentConversation('courses/rag/conversation/chat-5.md'), 'courses/rag')
assert.equal(courseRelativePathForAgentConversation('conversations/chat-6.md'), null)

assert.equal(
  agentConversationDirectoryRelativePath({ mode: 'teaching', selectedCourseRelativePath: 'courses/rag' }),
  'courses/rag/conversation'
)
assert.equal(
  agentConversationDirectoryRelativePath({ mode: 'teaching', selectedLessonPath: 'courses/rag/lesson/001.html' }),
  'courses/rag/conversation'
)
assert.equal(agentConversationDirectoryRelativePath({ mode: 'teaching', selectedCourseRelativePath: 'lessons' }), 'conversation')
assert.equal(agentConversationDirectoryRelativePath({ mode: 'temporary' }), 'conversations')

assert.equal(
  pendingAgentConversationRelativePath({ id: 'chat-7', mode: 'teaching', selectedCourseRelativePath: 'courses/rag' }),
  'courses/rag/conversation/chat-7.md'
)
assert.equal(
  pendingAgentConversationRelativePath({ id: 'chat-8', mode: 'temporary', selectedCourseRelativePath: 'courses/rag' }),
  'conversations/chat-8.md'
)
assert.equal(agentConversationJsonRelativePathForMarkdown('conversation/chat-9.md'), 'conversation/chat-9.json')

assert.equal(primaryAgentConversationDirectoryRelativePathForCourse('lessons'), 'conversation')
assert.deepEqual(agentConversationDirectoryRelativePathsForCourse('lessons'), [
  'conversation',
  'lessons/conversation',
  'lessons/conversations'
])
assert.deepEqual(agentConversationDirectoryRelativePathsForCourse('courses/rag'), [
  'courses/rag/conversation',
  'courses/rag/conversations'
])

console.log('agent conversation catalog rules ok')
