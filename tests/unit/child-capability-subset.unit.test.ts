import { describe, expect, it } from 'vitest'

import {
  assertChildCapabilitiesSubset,
  assertChildCapabilitiesSubsetOrThrow,
  ChildCapabilityAmplificationError,
  CHILD_CAPABILITY_AMPLIFICATION,
  intersectChildToolsWithParent
} from '../../src/main/ai/child-capability-subset'
import {
  resolveChildToolAllowList,
  toolNamesForProfile
} from '../../src/main/ai/delegation-runtime'

const WORKSPACE_READ = [
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace'
] as const

const WEB = ['web_search', 'web_fetch'] as const

describe('assertChildCapabilitiesSubset', () => {
  it('accepts a strict subset of parent-allowed tools', () => {
    const result = assertChildCapabilitiesSubset({
      parentAllowedToolNames: [...WORKSPACE_READ, ...WEB, 'ask'],
      childAllowedToolNames: [...WORKSPACE_READ],
      parentProfile: 'teaching_workspace',
      childProfile: 'workspace_audit'
    })
    expect(result).toEqual({ ok: true })
  })

  it('accepts equal parent and child allow-lists', () => {
    const tools = [...WORKSPACE_READ, ...WEB]
    expect(
      assertChildCapabilitiesSubset({
        parentAllowedToolNames: tools,
        childAllowedToolNames: tools
      })
    ).toEqual({ ok: true })
  })

  it('rejects amplification when the child wants write_workspace_file under a read-only parent', () => {
    const result = assertChildCapabilitiesSubset({
      parentAllowedToolNames: [...WORKSPACE_READ, ...WEB],
      childAllowedToolNames: [...WORKSPACE_READ, 'write_workspace_file'],
      childProfile: 'read_only'
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected denial')
    expect(result.code).toBe(CHILD_CAPABILITY_AMPLIFICATION)
    expect(result.amplified).toEqual(['write_workspace_file'])
    expect(result.reason).toContain('write_workspace_file')
    expect(result.reason).toContain('childProfile=read_only')
  })

  it('rejects multiple amplified tools and reports them sorted uniquely', () => {
    const result = assertChildCapabilitiesSubset({
      parentAllowedToolNames: ['list_workspace'],
      childAllowedToolNames: [
        'write_workspace_file',
        'generate_lesson',
        'write_workspace_file',
        'delegate_task'
      ]
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected denial')
    expect(result.amplified).toEqual([
      'delegate_task',
      'generate_lesson',
      'write_workspace_file'
    ])
  })

  it('fail-closes empty parent: any non-empty child is amplification', () => {
    const result = assertChildCapabilitiesSubset({
      parentAllowedToolNames: [],
      childAllowedToolNames: ['list_workspace']
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected denial')
    expect(result.amplified).toEqual(['list_workspace'])
  })

  it('allows empty child under empty parent', () => {
    expect(
      assertChildCapabilitiesSubset({
        parentAllowedToolNames: [],
        childAllowedToolNames: []
      })
    ).toEqual({ ok: true })
  })

  it('throws ChildCapabilityAmplificationError with stable code on fail', () => {
    expect(() =>
      assertChildCapabilitiesSubsetOrThrow({
        parentAllowedToolNames: ['list_workspace'],
        childAllowedToolNames: ['write_workspace_file']
      })
    ).toThrow(ChildCapabilityAmplificationError)

    try {
      assertChildCapabilitiesSubsetOrThrow({
        parentAllowedToolNames: ['list_workspace'],
        childAllowedToolNames: ['write_workspace_file']
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ChildCapabilityAmplificationError)
      const err = error as ChildCapabilityAmplificationError
      expect(err.code).toBe(CHILD_CAPABILITY_AMPLIFICATION)
      expect(err.amplified).toEqual(['write_workspace_file'])
    }
  })
})

describe('intersectChildToolsWithParent', () => {
  it('returns only tools present in both parent and child proposal', () => {
    expect(
      intersectChildToolsWithParent({
        parentAllowedToolNames: ['list_workspace', 'web_search', 'ask'],
        childProposedToolNames: [...WORKSPACE_READ, ...WEB]
      })
    ).toEqual(['list_workspace', 'web_search'])
  })

  it('returns empty when parent is empty (fail-closed)', () => {
    expect(
      intersectChildToolsWithParent({
        parentAllowedToolNames: [],
        childProposedToolNames: [...WORKSPACE_READ, ...WEB]
      })
    ).toEqual([])
  })

  it('preserves child proposal order and drops duplicates', () => {
    expect(
      intersectChildToolsWithParent({
        parentAllowedToolNames: ['web_fetch', 'list_workspace', 'web_search'],
        childProposedToolNames: ['web_search', 'list_workspace', 'web_search', 'glob_workspace']
      })
    ).toEqual(['web_search', 'list_workspace'])
  })
})

describe('profile mapping under intersection (delegation-runtime)', () => {
  it('maps workspace_audit to workspace-read tools only (no web)', () => {
    expect(toolNamesForProfile('workspace_audit')).toEqual([...WORKSPACE_READ])
  })

  it('maps read_only and research to workspace-read + web', () => {
    expect(toolNamesForProfile('read_only')).toEqual([...WORKSPACE_READ, ...WEB])
    expect(toolNamesForProfile('research')).toEqual([...WORKSPACE_READ, ...WEB])
  })

  it('keeps profile tools when parent grant is a superset', () => {
    const parent = [...WORKSPACE_READ, ...WEB, 'ask', 'read_skill_resource']
    expect(
      resolveChildToolAllowList({
        profile: 'research',
        parentAllowedToolNames: parent
      })
    ).toEqual([...WORKSPACE_READ, ...WEB])
    expect(
      resolveChildToolAllowList({
        profile: 'workspace_audit',
        parentAllowedToolNames: parent
      })
    ).toEqual([...WORKSPACE_READ])
  })

  it('narrows research web tools away when parent lacks web grant', () => {
    expect(
      resolveChildToolAllowList({
        profile: 'research',
        parentAllowedToolNames: [...WORKSPACE_READ]
      })
    ).toEqual([...WORKSPACE_READ])
  })

  it('fail-closes to empty child tools when parent allow-list is empty', () => {
    expect(
      resolveChildToolAllowList({
        profile: 'research',
        parentAllowedToolNames: []
      })
    ).toEqual([])
  })

  it('leaves profile proposal unchanged when parent list is omitted', () => {
    expect(resolveChildToolAllowList({ profile: 'workspace_audit' })).toEqual([
      ...WORKSPACE_READ
    ])
    expect(resolveChildToolAllowList({ profile: 'read_only' })).toEqual([
      ...WORKSPACE_READ,
      ...WEB
    ])
  })

  it('never expands workspace_audit / read_only beyond toolNamesForProfile', () => {
    const parentWithWrite = [
      ...WORKSPACE_READ,
      ...WEB,
      'write_workspace_file',
      'generate_lesson',
      'delegate_task'
    ]
    for (const profile of ['read_only', 'research', 'workspace_audit'] as const) {
      const resolved = resolveChildToolAllowList({
        profile,
        parentAllowedToolNames: parentWithWrite
      })
      const proposed = toolNamesForProfile(profile)
      expect(resolved).toEqual(proposed)
      expect(resolved).not.toContain('write_workspace_file')
      expect(resolved).not.toContain('generate_lesson')
      expect(resolved).not.toContain('delegate_task')
    }
  })
})
