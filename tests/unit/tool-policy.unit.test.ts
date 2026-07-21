import { describe, expect, it } from 'vitest'

import * as toolPolicy from '../../src/main/ai/tools/tool-policy'
import {
  associatePermissionDecision,
  DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT,
  evaluateRegistryToolPolicyGate,
  evaluateToolPolicy,
  isStricterDecision,
  journalPermissionDecisionFromGateAndResolution,
  loadToolPolicyDocument,
  mapWritePolicyDecision,
  mergeToolPolicyDocuments,
  strictestDecision,
  type ToolPolicyDocument,
  type ToolPolicyDecision
} from '../../src/main/ai/tools/tool-policy'
import { withPermissionDecision } from '../../src/main/ai/tools/write-rewind-journal'
import { normalizeRelativePath } from '../../src/main/ai/tools/write-policy'

function doc(
  rules: ToolPolicyDocument['rules'],
  defaultDecision?: ToolPolicyDecision
): ToolPolicyDocument {
  return {
    version: 1,
    ...(defaultDecision !== undefined ? { defaultDecision } : {}),
    rules
  }
}

describe('tool-policy declarative evaluation', () => {
  it('allows / prompts / forbids by exact tool name', () => {
    const document = doc([
      { tools: ['read_workspace_file'], decision: 'allow' },
      { tools: ['write_workspace_file'], decision: 'prompt' },
      { tools: ['delegate_task'], decision: 'forbidden' }
    ])

    expect(
      evaluateToolPolicy({
        toolName: 'read_workspace_file',
        effectClass: 'read',
        document
      })
    ).toMatchObject({ decision: 'allow', matchedRuleIndex: 0 })

    expect(
      evaluateToolPolicy({
        toolName: 'write_workspace_file',
        effectClass: 'workspace_write',
        document
      })
    ).toMatchObject({ decision: 'prompt', matchedRuleIndex: 1 })

    expect(
      evaluateToolPolicy({
        toolName: 'delegate_task',
        effectClass: 'privileged',
        document
      })
    ).toMatchObject({ decision: 'forbidden', matchedRuleIndex: 2 })
  })

  it('matches effect-class rules and picks the strictest of overlapping matches', () => {
    const document = doc([
      { effects: ['read'], decision: 'allow' },
      { effects: ['workspace_write'], decision: 'prompt' },
      { tools: ['write_workspace_file'], decision: 'forbidden' }
    ])

    expect(
      evaluateToolPolicy({
        toolName: 'list_workspace',
        effectClass: 'read',
        document
      }).decision
    ).toBe('allow')

    // tool name forbidden + effect prompt → strictest = forbidden
    const write = evaluateToolPolicy({
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      document
    })
    expect(write.decision).toBe('forbidden')
    expect(write.matchedRuleIndex).toBe(2)
  })

  it('matches path prefixes using write-policy normalizeRelativePath', () => {
    expect(normalizeRelativePath('notes\\lesson.md')).toBe('notes/lesson.md')

    const document = doc([
      { pathPrefixes: ['notes'], decision: 'allow' },
      { pathPrefixes: ['secrets/'], decision: 'forbidden' },
      { tools: ['write_workspace_file'], decision: 'prompt' }
    ])

    expect(
      evaluateToolPolicy({
        toolName: 'write_workspace_file',
        effectClass: 'workspace_write',
        path: 'notes/lesson.md',
        document
      })
    ).toMatchObject({ decision: 'prompt' }) // tool prompt is as strict as path allow? prompt > allow → prompt wins over allow; tool also matches

    // path under secrets is forbidden (strictest)
    expect(
      evaluateToolPolicy({
        toolName: 'write_workspace_file',
        effectClass: 'workspace_write',
        path: 'secrets/token.txt',
        document
      }).decision
    ).toBe('forbidden')

    // absolute / escaping path does not match pathPrefixes; falls through to tool rule
    expect(
      evaluateToolPolicy({
        toolName: 'write_workspace_file',
        effectClass: 'workspace_write',
        path: '../escape.md',
        document
      }).decision
    ).toBe('prompt')

    // path-only allow for notes when no stricter rule
    const pathOnly = doc([{ pathPrefixes: ['notes'], decision: 'allow' }], 'prompt')
    expect(
      evaluateToolPolicy({
        toolName: 'write_workspace_file',
        effectClass: 'workspace_write',
        path: 'notes/a.md',
        document: pathOnly
      }).decision
    ).toBe('allow')
  })

  it('fail-closes privileged when default is unspecified; honors explicit defaultDecision', () => {
    const noDefault = doc([{ tools: ['read_workspace_file'], decision: 'allow' }])
    expect(
      evaluateToolPolicy({
        toolName: 'unknown_tool_xyz',
        effectClass: 'privileged',
        document: noDefault
      })
    ).toMatchObject({
      decision: 'forbidden',
      reason: 'default_fail_closed_privileged'
    })

    expect(
      evaluateToolPolicy({
        toolName: 'list_workspace',
        effectClass: 'read',
        document: noDefault
      })
    ).toMatchObject({
      decision: 'prompt',
      reason: 'default_prompt'
    })

    const withDefault = doc([], 'allow')
    expect(
      evaluateToolPolicy({
        toolName: 'delegate_task',
        effectClass: 'privileged',
        document: withDefault
      }).decision
    ).toBe('allow')
  })

  it('maps write-policy decisions and supports ordinal strictest helpers', () => {
    expect(mapWritePolicyDecision('allow')).toBe('allow')
    expect(mapWritePolicyDecision('ask')).toBe('prompt')
    expect(mapWritePolicyDecision('deny')).toBe('forbidden')
    expect(isStricterDecision('forbidden', 'prompt')).toBe(true)
    expect(isStricterDecision('allow', 'prompt')).toBe(false)
    expect(strictestDecision(['allow', 'prompt', 'forbidden'])).toBe('forbidden')
  })

  it('forbids empty tool name and never matches empty-dimension rules', () => {
    const document = doc([
      { decision: 'allow' },
      { tools: [], effects: [], pathPrefixes: [], decision: 'allow' }
    ] as ToolPolicyDocument['rules'])

    expect(
      evaluateToolPolicy({
        toolName: '  ',
        effectClass: 'read',
        document
      })
    ).toMatchObject({ decision: 'forbidden', reason: 'missing_tool_name' })

    expect(
      evaluateToolPolicy({
        toolName: 'list_workspace',
        effectClass: 'read',
        document
      }).decision
    ).toBe('prompt')
  })

  it('exposes no argv / prefix_rule / YOLO product labels', () => {
    const exported = Object.keys(toolPolicy)
    expect(exported).not.toContain('prefix_rule')
    expect(exported).not.toContain('prefixRule')
    expect(exported).not.toContain('alwaysApprove')
    expect(exported).not.toContain('always_approve')
    expect(exported).not.toContain('DangerFullAccess')
    expect(exported).not.toContain('yolo')
    expect(exported).not.toContain('YOLO')
    expect(exported).not.toContain('full_access')
    expect(exported).not.toContain('argv')
    expect(exported).toContain('evaluateToolPolicy')
    expect(exported).toContain('mapWritePolicyDecision')
    expect(exported).toContain('evaluateRegistryToolPolicyGate')
    expect(exported).toContain('loadToolPolicyDocument')
    expect(exported).toContain('associatePermissionDecision')
    expect(exported).toContain('mergeToolPolicyDocuments')

    // Source surface: rule type shape is tools/effects/pathPrefixes only
    const source = JSON.stringify(toolPolicy)
    expect(source.toLowerCase()).not.toMatch(/always.?approve/)
    expect(source.toLowerCase()).not.toMatch(/danger.?full.?access/)
  })
})

describe('registry tool-policy gate (forbidden vs full_access)', () => {
  it('denies when policy forbids, short-circuiting full_access auto-allow semantics', () => {
    const document = doc([{ tools: ['write_workspace_file'], decision: 'forbidden' }])
    const gate = evaluateRegistryToolPolicyGate({
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      path: 'notes/a.md',
      document
    })
    expect(gate).toMatchObject({
      action: 'deny',
      policyDecision: 'forbidden'
    })
  })

  it('forces interactive when policy prompts (does not auto-allow)', () => {
    const document = doc([{ effects: ['workspace_write'], decision: 'prompt' }])
    const gate = evaluateRegistryToolPolicyGate({
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      document
    })
    expect(gate.action).toBe('force_interactive')
    expect(gate.policyDecision).toBe('prompt')
  })

  it('defers to approvalMode when policy allows (no YOLO invent)', () => {
    const document = doc([{ tools: ['write_workspace_file'], decision: 'allow' }])
    const gate = evaluateRegistryToolPolicyGate({
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      document
    })
    expect(gate.action).toBe('defer_to_approval_mode')
    expect(gate.policyDecision).toBe('allow')
  })

  it('uses DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT (defaultDecision allow) when document omitted', () => {
    expect(DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT.defaultDecision).toBe('allow')
    const gate = evaluateRegistryToolPolicyGate({
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write'
    })
    // Empty rules + default allow → defer (existing approvalMode stays in charge)
    expect(gate.action).toBe('defer_to_approval_mode')
  })
})

describe('loadToolPolicyDocument pure parse', () => {
  it('parses valid documents and rejects invalid / YOLO / argv shapes', () => {
    expect(
      loadToolPolicyDocument({
        version: 1,
        defaultDecision: 'prompt',
        rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
      })
    ).toEqual({
      version: 1,
      defaultDecision: 'prompt',
      rules: [{ tools: ['write_workspace_file'], decision: 'forbidden' }]
    })

    expect(loadToolPolicyDocument(null)).toBeNull()
    expect(loadToolPolicyDocument({ version: 2, rules: [] })).toBeNull()
    expect(
      loadToolPolicyDocument({
        version: 1,
        rules: [{ tools: ['x'], decision: 'forbidden', argv: ['rm'] }]
      })
    ).toBeNull()
    expect(
      loadToolPolicyDocument({
        version: 1,
        rules: [{ tools: ['x'], decision: 'allow', yolo: true }]
      })
    ).toBeNull()
    expect(
      loadToolPolicyDocument({
        version: 1,
        rules: [{ tools: ['x'], decision: 'maybe' }]
      })
    ).toBeNull()
  })
})

describe('journal permissionDecision association', () => {
  it('associatePermissionDecision and withPermissionDecision attach audit field only for known decisions', () => {
    const base = {
      version: 1 as const,
      runId: 'r1',
      relativePath: 'notes/a.md',
      capturedAt: '2026-07-21T00:00:00.000Z',
      existed: false,
      preImageUtf8: null as string | null,
      writtenContentSha256: 'abc',
      bytes: 3
    }

    expect(associatePermissionDecision(base, 'forbidden').permissionDecision).toBe('forbidden')
    expect(associatePermissionDecision(base, 'deny').permissionDecision).toBe('deny')
    expect(associatePermissionDecision(base, undefined).permissionDecision).toBeUndefined()
    expect(associatePermissionDecision(base, 'nope' as never).permissionDecision).toBeUndefined()

    expect(withPermissionDecision(base, 'prompt').permissionDecision).toBe('prompt')
    expect(withPermissionDecision(base, undefined).permissionDecision).toBeUndefined()
  })
})

describe('journalPermissionDecisionFromGateAndResolution', () => {
  it('maps gate + resolution to journal audit vocab with fail-soft omit', () => {
    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'deny',
        interactiveDecision: 'deny'
      })
    ).toBe('forbidden')

    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'force_interactive',
        interactiveDecision: 'allow_once'
      })
    ).toBe('prompt')
    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'force_interactive',
        interactiveDecision: 'allow_for_run'
      })
    ).toBe('prompt')
    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'force_interactive',
        interactiveDecision: 'allow_for_directory'
      })
    ).toBe('prompt')

    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'defer_to_approval_mode',
        interactiveDecision: 'allow_for_run'
      })
    ).toBe('allow')
    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'allow',
        interactiveDecision: 'allow_once'
      })
    ).toBe('allow')

    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'force_interactive',
        interactiveDecision: 'deny'
      })
    ).toBe('deny')
    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'defer_to_approval_mode',
        interactiveDecision: 'deny'
      })
    ).toBe('deny')

    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'unknown',
        interactiveDecision: 'allow_once'
      })
    ).toBeUndefined()
    expect(
      journalPermissionDecisionFromGateAndResolution({
        policyAction: 'defer_to_approval_mode',
        interactiveDecision: 'maybe' as never
      })
    ).toBeUndefined()
  })
})

describe('mergeToolPolicyDocuments (most-restrictive-wins)', () => {
  it('concatenates rules and evaluates strictest: forbidden wins for tool A', () => {
    const base = doc(
      [{ tools: ['tool_a'], decision: 'forbidden' }],
      'allow'
    )
    const overlay = doc([{ tools: ['tool_a'], decision: 'prompt' }])

    const merged = mergeToolPolicyDocuments([base, overlay])
    expect(merged.version).toBe(1)
    expect(merged.rules).toHaveLength(2)
    expect(merged.rules[0]).toEqual({ tools: ['tool_a'], decision: 'forbidden' })
    expect(merged.rules[1]).toEqual({ tools: ['tool_a'], decision: 'prompt' })

    const result = evaluateToolPolicy({
      toolName: 'tool_a',
      effectClass: 'workspace_write',
      document: merged
    })
    expect(result.decision).toBe('forbidden')
    // First matching rule is also the strictest; index 0 wins as bestDecision
    expect(result.matchedRuleIndex).toBe(0)
  })

  it('merges defaultDecision with strictest among defined defaults', () => {
    expect(mergeToolPolicyDocuments([doc([], 'allow'), doc([], 'prompt')]).defaultDecision).toBe(
      'prompt'
    )
    expect(
      mergeToolPolicyDocuments([doc([], 'allow'), doc([], 'forbidden')]).defaultDecision
    ).toBe('forbidden')
    expect(
      mergeToolPolicyDocuments([doc([], 'prompt'), doc([], 'allow'), doc([], 'forbidden')])
        .defaultDecision
    ).toBe('forbidden')

    // Only one side defines defaultDecision → that value is kept
    const oneSide = mergeToolPolicyDocuments([doc([{ tools: ['x'], decision: 'allow' }]), doc([], 'prompt')])
    expect(oneSide.defaultDecision).toBe('prompt')

    // None define defaultDecision → omit field (preserve evaluate fallback semantics)
    const none = mergeToolPolicyDocuments([
      doc([{ tools: ['x'], decision: 'allow' }]),
      doc([{ tools: ['y'], decision: 'prompt' }])
    ])
    expect(none).not.toHaveProperty('defaultDecision')
    expect(
      evaluateToolPolicy({
        toolName: 'unknown_tool',
        effectClass: 'privileged',
        document: none
      })
    ).toMatchObject({ decision: 'forbidden', reason: 'default_fail_closed_privileged' })
    expect(
      evaluateToolPolicy({
        toolName: 'unknown_tool',
        effectClass: 'read',
        document: none
      })
    ).toMatchObject({ decision: 'prompt', reason: 'default_prompt' })
  })

  it('preserves rules concatenation order; evaluation still uses strictest', () => {
    const first = doc([
      { tools: ['write_workspace_file'], decision: 'allow' },
      { pathPrefixes: ['notes'], decision: 'prompt' }
    ])
    const second = doc([
      { tools: ['write_workspace_file'], decision: 'forbidden' },
      { effects: ['read'], decision: 'allow' }
    ])
    const merged = mergeToolPolicyDocuments([first, second])
    expect(merged.rules.map((r) => r.decision)).toEqual([
      'allow',
      'prompt',
      'forbidden',
      'allow'
    ])
    // Index positions: 0 allow tool, 1 prompt path, 2 forbidden tool, 3 allow effect
    const write = evaluateToolPolicy({
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      path: 'notes/a.md',
      document: merged
    })
    expect(write.decision).toBe('forbidden')
    expect(write.matchedRuleIndex).toBe(2)

    const read = evaluateToolPolicy({
      toolName: 'list_workspace',
      effectClass: 'read',
      document: merged
    })
    expect(read.decision).toBe('allow')
    expect(read.matchedRuleIndex).toBe(3)
  })

  it('empty array returns DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT equivalent (fail-soft)', () => {
    const merged = mergeToolPolicyDocuments([])
    expect(merged.version).toBe(1)
    expect(merged.defaultDecision).toBe(DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT.defaultDecision)
    expect(merged.rules).toEqual([])
    expect(merged.rules).not.toBe(DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT.rules)

    const gate = evaluateRegistryToolPolicyGate({
      toolName: 'write_workspace_file',
      effectClass: 'workspace_write',
      document: merged
    })
    expect(gate.action).toBe('defer_to_approval_mode')
  })

  it('throws fail-closed on invalid version or null entries', () => {
    expect(() =>
      mergeToolPolicyDocuments([
        doc([]),
        { version: 2 as 1, rules: [] } as ToolPolicyDocument
      ])
    ).toThrow(/version/)

    expect(() =>
      mergeToolPolicyDocuments([doc([]), null as unknown as ToolPolicyDocument])
    ).toThrow(/null or undefined/)

    expect(() =>
      mergeToolPolicyDocuments([undefined as unknown as ToolPolicyDocument])
    ).toThrow(/null or undefined/)
  })

  it('merged document has no argv / YOLO fields and evaluation equals expected strictest', () => {
    const a = doc([{ tools: ['delegate_task'], decision: 'prompt' }], 'allow')
    const b = doc(
      [
        { tools: ['delegate_task'], decision: 'allow' },
        { effects: ['privileged'], decision: 'forbidden' }
      ],
      'prompt'
    )
    const merged = mergeToolPolicyDocuments([a, b])

    const serialized = JSON.stringify(merged)
    expect(serialized.toLowerCase()).not.toMatch(/yolo/)
    expect(serialized.toLowerCase()).not.toMatch(/always.?approve/)
    expect(serialized.toLowerCase()).not.toMatch(/argv/)
    expect(serialized.toLowerCase()).not.toMatch(/prefix_rule/)
    expect(serialized).not.toMatch(/DangerFullAccess/)

    expect(merged.defaultDecision).toBe('prompt')
    expect(
      evaluateToolPolicy({
        toolName: 'delegate_task',
        effectClass: 'privileged',
        document: merged
      }).decision
    ).toBe('forbidden')

    // rule-level YOLO/argv must throw if present on input objects
    expect(() =>
      mergeToolPolicyDocuments([
        {
          version: 1,
          rules: [
            {
              tools: ['x'],
              decision: 'allow',
              yolo: true
            } as unknown as ToolPolicyDocument['rules'][number]
          ]
        }
      ])
    ).toThrow(/forbidden rule fields/)
  })
})
