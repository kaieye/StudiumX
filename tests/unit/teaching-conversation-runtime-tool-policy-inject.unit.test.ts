/**
 * Product inject decision for workspace tool-policy into buildToolContext
 * (ADR-0005 / ADOPTION B-08 residual). Focused pure-path tests — no Electron.
 * Multi-path load still funnels through toolPolicyDocumentOption; null omit semantics unchanged.
 */

import { describe, expect, it } from 'vitest'

import { toolPolicyDocumentOption } from '../../src/main/ai/tools/tool-policy-fs'
import {
  DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT,
  type ToolPolicyDocument
} from '../../src/main/ai/tools/tool-policy'
import { buildToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'

const forbiddenWriteDoc: ToolPolicyDocument = {
  version: 1,
  defaultDecision: 'prompt',
  rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
}

describe('teaching-conversation-runtime tool-policy inject decision', () => {
  it('omits toolPolicyDocument when workspace load returns null (missing file)', () => {
    // Mirrors runTeachingConversationTurnActive:
    //   const workspaceToolPolicy = root ? await loadAndMerge(...) : null
    //   buildToolContext(settings, { ..., ...toolPolicyDocumentOption(workspaceToolPolicy) })
    const workspaceToolPolicy = null as ToolPolicyDocument | null
    const option = toolPolicyDocumentOption(workspaceToolPolicy)
    expect(option).toEqual({})
    expect('toolPolicyDocument' in option).toBe(false)

    const settings = defaultSettings('/tmp/studiumx-inject-fixture')
    const ctx = buildToolContext(settings, {
      workspaceRoot: '/tmp/studiumx-inject-fixture',
      ...option
    })
    expect(ctx.toolPolicyDocument).toBeUndefined()
    expect(ctx.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT).toEqual(
      DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
    )
  })

  it('omits load and field when workspaceRoot is absent/empty', () => {
    // Product path: no FS load when conversation.workspaceRoot is undefined/empty.
    const workspaceRoot: string | undefined = undefined
    const workspaceToolPolicy =
      workspaceRoot
        ? (forbiddenWriteDoc as ToolPolicyDocument | null)
        : null
    expect(workspaceToolPolicy).toBeNull()

    const ctx = buildToolContext(defaultSettings('/tmp/x'), {
      workspaceRoot,
      ...toolPolicyDocumentOption(workspaceToolPolicy)
    })
    expect(ctx.toolPolicyDocument).toBeUndefined()
  })

  it('passes loaded forbidden-rule document onto ToolContext', () => {
    const workspaceToolPolicy: ToolPolicyDocument | null = forbiddenWriteDoc
    const option = toolPolicyDocumentOption(workspaceToolPolicy)
    expect(option).toEqual({ toolPolicyDocument: forbiddenWriteDoc })

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-inject-fixture'), {
      workspaceRoot: '/tmp/studiumx-inject-fixture',
      ...option
    })
    expect(ctx.toolPolicyDocument).toEqual(forbiddenWriteDoc)
    expect(ctx.toolPolicyDocument).not.toEqual(DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT)
  })
})
