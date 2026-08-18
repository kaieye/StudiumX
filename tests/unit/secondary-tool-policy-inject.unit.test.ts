/**
 * Secondary product inject for workspace tool-policy into buildToolContext
 * (ADR-0005 multi-path): delegation-runtime + lesson-plan-production.
 * Pure-path composition tests — no Electron, no agent loop.
 *
 * Product load path uses loadAndMergeToolPolicyDocumentsFromWorkspace (default
 * dual paths). These tests mirror grant/omit composition; multi-path merge
 * semantics are covered by tool-policy-fs + catalog helper tests.
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

/**
 * Mirrors delegation-runtime executeChild inject decision:
 *   const workspaceRoot = this.options.workspaceRoot
 *   const workspaceToolPolicy = workspaceRoot
 *     ? await loadAndMergeToolPolicyDocumentsFromWorkspace({ workspaceRoot })
 *     : null
 *   buildToolContext(settings, { workspaceRoot, ..., ...toolPolicyDocumentOption(...) })
 */
function composeDelegationToolContextOptions(input: {
  workspaceRoot?: string
  workspaceToolPolicy: ToolPolicyDocument | null
}): {
  workspaceRoot?: string
} & ReturnType<typeof toolPolicyDocumentOption> {
  const { workspaceRoot, workspaceToolPolicy } = input
  // Product path only loads when root is non-empty; null policy omits field.
  const shouldLoad = Boolean(workspaceRoot)
  const policy = shouldLoad ? workspaceToolPolicy : null
  return {
    workspaceRoot,
    ...toolPolicyDocumentOption(policy)
  }
}

/**
 * Mirrors lesson-plan-production inject decision:
 * grant false → no FS load, empty options for tools;
 * grant true → workspaceRoot + optional toolPolicyDocument (multi-path merge).
 */
function composeLessonPlanToolContextOptions(input: {
  workspaceToolAccessGranted?: boolean
  rootPath: string
  workspaceToolPolicy: ToolPolicyDocument | null
}): {
  workspaceRoot?: string
} & ReturnType<typeof toolPolicyDocumentOption> {
  const workspaceToolOptions =
    input.workspaceToolAccessGranted === true
      ? { workspaceRoot: input.rootPath }
      : {}

  let toolContextOptions: {
    workspaceRoot?: string
  } & ReturnType<typeof toolPolicyDocumentOption> = { ...workspaceToolOptions }

  if (input.workspaceToolAccessGranted === true && input.rootPath) {
    // Policy result is supplied by the test (simulates await multi-path load).
    toolContextOptions = {
      ...toolContextOptions,
      ...toolPolicyDocumentOption(input.workspaceToolPolicy)
    }
  }
  return toolContextOptions
}

describe('delegation-runtime tool-policy inject decision (ADR-0005)', () => {
  it('omits toolPolicyDocument when workspaceRoot is absent (no FS load path)', () => {
    const options = composeDelegationToolContextOptions({
      workspaceRoot: undefined,
      workspaceToolPolicy: forbiddenWriteDoc
    })
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/x'), {
      ...options,
      signal: undefined,
      runId: 'child-1'
    })
    expect(ctx.toolPolicyDocument).toBeUndefined()
    expect(ctx.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT).toEqual(
      DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
    )
  })

  it('omits toolPolicyDocument when load returns null (missing/invalid file)', () => {
    const options = composeDelegationToolContextOptions({
      workspaceRoot: '/tmp/studiumx-delegation-fixture',
      workspaceToolPolicy: null
    })
    expect(options.workspaceRoot).toBe('/tmp/studiumx-delegation-fixture')
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-delegation-fixture'), options)
    expect(ctx.toolPolicyDocument).toBeUndefined()
  })

  it('passes loaded document onto ToolContext for child run', () => {
    const options = composeDelegationToolContextOptions({
      workspaceRoot: '/tmp/studiumx-delegation-fixture',
      workspaceToolPolicy: forbiddenWriteDoc
    })
    expect(options).toEqual({
      workspaceRoot: '/tmp/studiumx-delegation-fixture',
      toolPolicyDocument: forbiddenWriteDoc
    })

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-delegation-fixture'), options)
    expect(ctx.toolPolicyDocument).toEqual(forbiddenWriteDoc)
  })
})

describe('lesson-plan-production tool-policy inject decision (ADR-0005)', () => {
  it('grant false: no workspaceRoot and no toolPolicyDocument (no FS load)', () => {
    const options = composeLessonPlanToolContextOptions({
      workspaceToolAccessGranted: false,
      rootPath: '/tmp/studiumx-lesson-fixture',
      workspaceToolPolicy: forbiddenWriteDoc
    })
    expect(options).toEqual({})
    expect('workspaceRoot' in options).toBe(false)
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/x'), options)
    expect(ctx.workspaceRoot).toBeUndefined()
    expect(ctx.toolPolicyDocument).toBeUndefined()
  })

  it('grant absent (untrusted): same as false — no inject, no grant of tools', () => {
    const options = composeLessonPlanToolContextOptions({
      workspaceToolAccessGranted: undefined,
      rootPath: '/tmp/studiumx-lesson-fixture',
      workspaceToolPolicy: forbiddenWriteDoc
    })
    expect(options).toEqual({})
  })

  it('grant true + null policy: workspaceRoot present, toolPolicyDocument omitted', () => {
    const options = composeLessonPlanToolContextOptions({
      workspaceToolAccessGranted: true,
      rootPath: '/tmp/studiumx-lesson-fixture',
      workspaceToolPolicy: null
    })
    expect(options.workspaceRoot).toBe('/tmp/studiumx-lesson-fixture')
    expect('toolPolicyDocument' in options).toBe(false)

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-lesson-fixture'), options)
    expect(ctx.workspaceRoot).toBe('/tmp/studiumx-lesson-fixture')
    expect(ctx.toolPolicyDocument).toBeUndefined()
    expect(ctx.toolPolicyDocument ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT).toEqual(
      DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
    )
  })

  it('grant true + loaded document: injects toolPolicyDocument without changing grant semantics', () => {
    const options = composeLessonPlanToolContextOptions({
      workspaceToolAccessGranted: true,
      rootPath: '/tmp/studiumx-lesson-fixture',
      workspaceToolPolicy: forbiddenWriteDoc
    })
    expect(options).toEqual({
      workspaceRoot: '/tmp/studiumx-lesson-fixture',
      toolPolicyDocument: forbiddenWriteDoc
    })

    const ctx = buildToolContext(defaultSettings('/tmp/studiumx-lesson-fixture'), options)
    expect(ctx.toolPolicyDocument).toEqual(forbiddenWriteDoc)
  })
})
