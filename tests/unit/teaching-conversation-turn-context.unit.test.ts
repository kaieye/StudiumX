import { describe, expect, it } from 'vitest'

import { deriveConversationTurnContext } from '../../src/main/teaching-conversation-turn-context'

const workspace = {
  rootPath: '/workspace/fixture',
  workspaceToolAccessGranted: true
}

describe('conversation turn workspace trust context', () => {
  it('retains workspace-scoped teaching semantics and memory while failing closed for an untrusted workspace root', () => {
    const context = deriveConversationTurnContext({
      mode: 'teaching',
      workspace: { ...workspace, workspaceToolAccessGranted: false },
      toolsEnabled: true,
      hasLessonGenerator: true
    })

    expect(context.mode).toBe('teaching')
    expect(context.memoryWorkspaceRoot).toBe('/workspace/fixture')
    expect(context.workspaceRoot).toBeUndefined()
    expect(context.capabilityPolicy.id).toBe('teaching_workspace')
    expect(context.workspaceToolsEnabled).toBe(false)
    expect(context.lessonToolEnabled).toBe(true)
  })

  it('exposes the workspace root only to trusted teaching workspace file tools', () => {
    const context = deriveConversationTurnContext({
      mode: 'teaching',
      workspace,
      toolsEnabled: true,
      hasLessonGenerator: true
    })

    expect(context.workspaceRoot).toBe('/workspace/fixture')
    expect(context.memoryWorkspaceRoot).toBe('/workspace/fixture')
    expect(context.workspaceToolsEnabled).toBe(true)
    expect(context.lessonToolEnabled).toBe(true)
  })

  it('strips a trusted workspace root and lesson tool from temporary mode without changing memory scope', () => {
    const context = deriveConversationTurnContext({
      mode: 'temporary',
      workspace,
      toolsEnabled: true,
      hasLessonGenerator: true
    })

    expect(context.workspaceRoot).toBeUndefined()
    expect(context.memoryWorkspaceRoot).toBe('/workspace/fixture')
    expect(context.workspaceToolsEnabled).toBe(false)
    expect(context.lessonToolEnabled).toBe(false)
  })
})
