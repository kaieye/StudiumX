import assert from 'node:assert/strict'

const { deriveWorkspaceRemovalUiPatch, pathRemovedByTarget } = await import('../src/shared/workspace-removal-state.ts')

const conversation = (id, relativePath) => ({ id, relativePath })
const stateWithConversations = (conversations, temporaryConversations = []) => ({
  activeWorkspace: {
    conversations
  },
  temporaryConversations
})

assert.deepEqual(
  deriveWorkspaceRemovalUiPatch(
    { relativePath: 'conversations/current.md', kind: 'conversation' },
    { activeConversationId: 'current' },
    stateWithConversations([conversation('other', 'conversations/other.md')])
  ),
  {
    clearActiveConversation: true,
    clearSelectedCoursePreview: false,
    clearSelectedCourseFolder: false
  }
)

assert.equal(
  deriveWorkspaceRemovalUiPatch(
    { relativePath: 'conversations/other.md', kind: 'conversation' },
    { activeConversationId: 'current' },
    stateWithConversations([
      conversation('current', 'conversations/current.md')
    ])
  ).clearActiveConversation,
  false
)

assert.equal(
  deriveWorkspaceRemovalUiPatch(
    { relativePath: 'lessons', kind: 'directory' },
    { activeConversationId: 'temporary' },
    stateWithConversations([], [
      conversation('temporary', 'conversations/temporary.md')
    ])
  ).clearActiveConversation,
  false,
  'removing a course folder should not clear the active temporary conversation'
)

assert.equal(
  deriveWorkspaceRemovalUiPatch(
    { relativePath: 'courses/rag/sessions/s1', kind: 'directory' },
    {
      activeConversationId: null,
      selectedCoursePreviewFile: {
        relativePath: 'courses/rag/sessions/s1/0001-rag.html'
      }
    },
    stateWithConversations([])
  ).clearSelectedCoursePreview,
  true
)

assert.equal(
  deriveWorkspaceRemovalUiPatch(
    { relativePath: 'courses/agents/sessions/s1', kind: 'directory' },
    {
      activeConversationId: null,
      selectedCoursePreviewFile: {
        relativePath: 'courses/rag/sessions/s1/0001-rag.html'
      }
    },
    stateWithConversations([])
  ).clearSelectedCoursePreview,
  false
)

assert.equal(
  deriveWorkspaceRemovalUiPatch(
    { relativePath: 'courses/rag', kind: 'directory' },
    {
      activeConversationId: null,
      selectedCourseRelativePath: 'courses/rag'
    },
    stateWithConversations([])
  ).clearSelectedCourseFolder,
  true
)

assert.equal(
  pathRemovedByTarget(
    { relativePath: 'courses\\rag\\sessions\\s1', kind: 'directory' },
    'courses/rag/sessions/s1/0001-rag.html'
  ),
  true
)

console.log('workspace removal state ok')
