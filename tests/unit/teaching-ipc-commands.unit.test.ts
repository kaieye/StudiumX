import { describe, expect, it } from 'vitest'

import {
  parseAgentChatStreamPayload,
  parsePreviewSkillOrchestrationPayload,
  parseSetWorkspaceTrustPayload
} from '../../src/main/teaching-ipc-commands'

describe('parseSetWorkspaceTrustPayload', () => {
  it('accepts only a workspace id and the binary trust state', () => {
    expect(parseSetWorkspaceTrustPayload({ workspaceId: 'workspace-1', trust: 'trusted' }))
      .toEqual({ workspaceId: 'workspace-1', trust: 'trusted' })
    expect(parseSetWorkspaceTrustPayload({ workspaceId: 'workspace-1', trust: 'untrusted' }))
      .toEqual({ workspaceId: 'workspace-1', trust: 'untrusted' })
  })

  it('rejects extra capability data such as a root path', () => {
    expect(() => parseSetWorkspaceTrustPayload({
      workspaceId: 'workspace-1', trust: 'trusted', rootPath: 'D:/not-renderer-authoritative'
    })).toThrow('IPC workspace trust payload must contain only "workspaceId" and "trust".')
  })

  it('rejects malformed trust values before a gateway action can run', () => {
    expect(() => parseSetWorkspaceTrustPayload({ workspaceId: 'workspace-1', trust: 'pending' }))
      .toThrow('IPC payload field "trust" must be one of: trusted, untrusted.')
  })
})

describe('skill orchestration IPC payloads', () => {
  it('normalizes and stably dedupes capability ids identically for preview and execution', () => {
    const selected = [' Learning-Assessor ', 'learning-assessor', 'teaching-resource-generator']

    const execution = parseAgentChatStreamPayload({
      userInput: 'Assess my understanding',
      messages: [],
      skillIds: selected
    })
    const preview = parsePreviewSkillOrchestrationPayload({
      selectedSkillIds: selected,
      isTeachingConversation: true
    })

    expect(execution.skillIds).toEqual(['learning-assessor', 'teaching-resource-generator'])
    expect(preview.selectedSkillIds).toEqual(execution.skillIds)
  })

  it('rejects over-limit or malformed capability selections instead of silently truncating them', () => {
    const nineIds = Array.from({ length: 9 }, (_, index) => `skill-${index + 1}`)

    expect(() => parseAgentChatStreamPayload({ userInput: 'Hello', messages: [], skillIds: nineIds }))
      .toThrow('at most 8 ids')
    expect(() => parsePreviewSkillOrchestrationPayload({ selectedSkillIds: nineIds }))
      .toThrow('at most 8 ids')
    expect(() => parseAgentChatStreamPayload({ userInput: 'Hello', messages: [], skillIds: [' '] }))
      .toThrow('invalid skill id')
    expect(() => parsePreviewSkillOrchestrationPayload({ selectedSkillIds: [' '] }))
      .toThrow('invalid skill id')
    expect(() => parseAgentChatStreamPayload({ userInput: 'Hello', messages: [], skillIds: ['../escape'] }))
      .toThrow('invalid skill id')
    expect(() => parsePreviewSkillOrchestrationPayload({ selectedSkillIds: ['../escape'] }))
      .toThrow('invalid skill id')
  })

  it('preserves a valid branch revision and rejects invalid revisions before dispatch', () => {
    expect(parseAgentChatStreamPayload({
      userInput: 'Hello',
      messages: [],
      expectedBranchRevision: 3
    }).expectedBranchRevision).toBe(3)

    expect(() => parseAgentChatStreamPayload({
      userInput: 'Hello', messages: [], expectedBranchRevision: -1
    })).toThrow('expectedBranchRevision')
    expect(() => parseAgentChatStreamPayload({
      userInput: 'Hello', messages: [], expectedBranchRevision: 1.5
    })).toThrow('expectedBranchRevision')
  })

  it('rejects unexpected fields while preserving legacy fallback for unknown agent modes', () => {
    expect(() => parseAgentChatStreamPayload({
      userInput: 'Hello', messages: [], untrustedExtra: true
    })).toThrow('unsupported field')
    expect(() => parsePreviewSkillOrchestrationPayload({
      selectedSkillIds: [], untrustedExtra: true
    })).toThrow('unsupported field')
    expect(parseAgentChatStreamPayload({
      userInput: 'Hello', messages: [], mode: 'unsupported'
    }).mode).toBeUndefined()
    expect(() => parsePreviewSkillOrchestrationPayload({
      selectedSkillIds: [], isTeachingConversation: 'true'
    })).toThrow('isTeachingConversation')
  })

  it('accepts only registered presets', () => {
    expect(parsePreviewSkillOrchestrationPayload({
      selectedSkillIds: [], presetId: 'check_mastery'
    }).presetId).toBe('check_mastery')
    expect(() => parsePreviewSkillOrchestrationPayload({
      selectedSkillIds: [], presetId: 'not-a-preset'
    })).toThrow('known preset')
  })
})
