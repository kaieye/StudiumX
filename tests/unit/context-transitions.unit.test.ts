import { describe, expect, it } from 'vitest'
import { selectCourseFolderContext } from '../../src/renderer/src/app-shell/contextTransitions'

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
