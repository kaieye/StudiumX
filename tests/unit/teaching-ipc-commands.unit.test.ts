import { describe, expect, it } from 'vitest'

import {
  parseAgentChatStreamPayload,
  parseSubmitConversationTurnIntent,
  parseCancelConversationTurnIntent,
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

describe('agent chat image IPC payloads', () => {
  const imageAttachment = {
    id: 'image-1',
    name: 'diagram.png',
    mimeType: 'image/png',
    dataBase64: 'iVBORw0KGgo=',
    sizeBytes: 8
  }

  it('accepts only an exact current-turn attachment at the main-process boundary', () => {
    const parsed = parseAgentChatStreamPayload({
      userInput: 'Please analyze the image.',
      messages: [{ role: 'user', content: 'Earlier text-only context' }],
      imageAttachments: [imageAttachment]
    })

    expect(parsed.imageAttachments).toEqual([imageAttachment])
    expect(parsed.messages[0]).toEqual({
      role: 'user', content: 'Earlier text-only context'
    })
  })

  it('rejects renderer-only fields and image data smuggled into transcript history', () => {
    const rendererAttachment = { ...imageAttachment, previewUrl: 'blob:https://renderer.invalid/preview' }
    expect(() => parseAgentChatStreamPayload({
      userInput: 'Please analyze the image.',
      imageAttachments: [rendererAttachment]
    })).toThrow('不允许的字段')

    expect(() => parseAgentChatStreamPayload({
      userInput: 'Please analyze the image.',
      messages: [{ role: 'user', content: 'Earlier image', imageAttachments: [imageAttachment] }]
    })).toThrow('transcript messages must not include image attachments')
  })

  it('rejects local paths and invalid binary data before an agent turn is reserved', () => {
    expect(() => parseAgentChatStreamPayload({
      userInput: 'Please analyze the image.',
      messages: [],
      imageAttachments: [{ ...imageAttachment, name: 'file:///Users/learner/private.png' }]
    })).toThrow('本地路径')
    expect(() => parseAgentChatStreamPayload({
      userInput: 'Please analyze the image.',
      messages: [],
      imageAttachments: [{ ...imageAttachment, mimeType: 'image/jpeg' }]
    })).toThrow('内容与声明的类型不匹配')
  })
})


describe('parseSubmitConversationTurnIntent', () => {
  const canonicalIntent = {
    target: {
      kind: 'canonical' as const,
      workspaceId: 'workspace-1',
      scope: 'workspace' as const,
      conversationId: 'conversation-1'
    },
    clientRequestId: 'request-1',
    text: 'Explain momentum.',
    mode: 'teaching' as const,
    delivery: 'steer' as const,
    expectedBranchRevision: 4,
    expectedActiveTurnId: 'turn-1',
    skillIds: [' Physics-Basics ', 'physics-basics']
  }

  it('accepts only the narrow turn intent and reuses skill-id normalization', () => {
    expect(parseSubmitConversationTurnIntent(canonicalIntent)).toEqual({
      target: {
        kind: 'canonical',
        workspaceId: 'workspace-1',
        scope: 'workspace',
        conversationId: 'conversation-1'
      },
      clientRequestId: 'request-1',
      text: 'Explain momentum.',
      mode: 'teaching',
      delivery: 'steer',
      expectedBranchRevision: 4,
      expectedActiveTurnId: 'turn-1',
      skillIds: ['physics-basics']
    })

    expect(parseSubmitConversationTurnIntent({
      target: {
        kind: 'pending',
        workspaceId: 'workspace-1',
        scope: 'temporary',
        pendingConversationId: 'pending-1'
      },
      clientRequestId: 'pending-request-1',
      text: 'Start a temporary chat.',
      mode: 'temporary',
      delivery: 'follow_up'
    })).toEqual({
      target: {
        kind: 'pending',
        workspaceId: 'workspace-1',
        scope: 'temporary',
        pendingConversationId: 'pending-1'
      },
      clientRequestId: 'pending-request-1',
      text: 'Start a temporary chat.',
      mode: 'temporary',
      delivery: 'follow_up'
    })
  })

  it('rejects unknown fields rather than accepting transcript or tool payloads', () => {
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, extra: true }))
      .toThrow('unsupported field')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, transcript: [] }))
      .toThrow('unsupported field')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, messages: [] }))
      .toThrow('unsupported field')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, context: 'untrusted context' }))
      .toThrow('unsupported field')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, toolCalls: [] }))
      .toThrow('unsupported field')
  })

  it('rejects invalid enums, identity shapes, active ids, and revisions', () => {
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, mode: 'other' }))
      .toThrow('mode')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, delivery: 'later' }))
      .toThrow('delivery')
    expect(() => parseSubmitConversationTurnIntent({
      ...canonicalIntent,
      target: { ...canonicalIntent.target, scope: 'temporary' }
    })).toThrow('must match target "scope"')
    expect(() => parseSubmitConversationTurnIntent({
      ...canonicalIntent,
      target: { ...canonicalIntent.target, conversationId: '../escape' }
    })).toThrow('canonical conversation id')
    expect(() => parseSubmitConversationTurnIntent({
      ...canonicalIntent,
      target: { ...canonicalIntent.target, pendingConversationId: 'pending-2' }
    })).toThrow('unsupported field')
    expect(() => parseSubmitConversationTurnIntent({
      ...canonicalIntent,
      target: {
        kind: 'pending', workspaceId: 'workspace-1', scope: 'workspace',
        pendingConversationId: '../pending', conversationId: 'conversation-1'
      }
    })).toThrow('unsupported field')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, clientRequestId: '../request' }))
      .toThrow('clientRequestId')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, expectedActiveTurnId: '../turn' }))
      .toThrow('expectedActiveTurnId')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, expectedBranchRevision: -1 }))
      .toThrow('expectedBranchRevision')
    expect(() => parseSubmitConversationTurnIntent({ ...canonicalIntent, expectedBranchRevision: 1.5 }))
      .toThrow('expectedBranchRevision')
    expect(() => parseSubmitConversationTurnIntent({
      ...canonicalIntent, delivery: 'steer', expectedActiveTurnId: undefined
    })).toThrow('requires "expectedActiveTurnId"')
  })
})


describe('parseCancelConversationTurnIntent', () => {
  const canonicalIntent = {
    target: {
      kind: 'canonical' as const,
      workspaceId: 'workspace-1',
      scope: 'workspace' as const,
      conversationId: 'conversation-1'
    },
    clientRequestId: 'cancel-request-1',
    expectedActiveTurnId: 'turn-1'
  }

  it('accepts only exact lane identity and opaque active-turn concurrency ids', () => {
    expect(parseCancelConversationTurnIntent(canonicalIntent)).toEqual(canonicalIntent)
    expect(parseCancelConversationTurnIntent({
      target: {
        kind: 'pending',
        workspaceId: 'workspace-1',
        scope: 'temporary',
        pendingConversationId: 'pending-1'
      },
      clientRequestId: 'cancel-request-2',
      expectedActiveTurnId: 'turn-2'
    })).toEqual({
      target: {
        kind: 'pending',
        workspaceId: 'workspace-1',
        scope: 'temporary',
        pendingConversationId: 'pending-1'
      },
      clientRequestId: 'cancel-request-2',
      expectedActiveTurnId: 'turn-2'
    })
  })

  it('rejects broad transcript, context, tool, provider, and secret-shaped data', () => {
    for (const extra of [
      { extra: true },
      { transcript: [] },
      { messages: [] },
      { context: 'untrusted context' },
      { toolCalls: [] },
      { provider: 'untrusted-provider' },
      { secret: 'not-allowed' }
    ]) {
      expect(() => parseCancelConversationTurnIntent({ ...canonicalIntent, ...extra }))
        .toThrow('unsupported field')
    }
    expect(() => parseCancelConversationTurnIntent({
      ...canonicalIntent,
      target: { ...canonicalIntent.target, pendingConversationId: 'pending-1' }
    })).toThrow('unsupported field')
  })

  it('rejects malformed exact identity and concurrency ids', () => {
    expect(() => parseCancelConversationTurnIntent({
      ...canonicalIntent,
      target: { ...canonicalIntent.target, conversationId: '../escape' }
    })).toThrow('canonical conversation id')
    expect(() => parseCancelConversationTurnIntent({ ...canonicalIntent, clientRequestId: '../request' }))
      .toThrow('clientRequestId')
    expect(() => parseCancelConversationTurnIntent({ ...canonicalIntent, expectedActiveTurnId: '../turn' }))
      .toThrow('expectedActiveTurnId')
  })
})
