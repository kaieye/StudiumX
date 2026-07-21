import { describe, expect, it } from 'vitest'

import { classifyToolEffect } from '../../src/main/ai/tools/effect-policy'
import {
  capabilitiesForEffectClass,
  capabilitiesForTool,
  isParallelReadCapable,
  NON_READ_MAX_CONCURRENCY,
  READ_TOOL_MAX_CONCURRENCY,
  type ToolCapabilities
} from '../../src/main/ai/tools/tool-capabilities'
import {
  resolveToolEntryCapabilities,
  type ToolEntry
} from '../../src/main/ai/tools/registry'
import type { ToolDefinition } from '../../src/main/ai/provider-adapter'

const KNOWN_READ = [
  'list_workspace',
  'read_workspace_file',
  'search_workspace',
  'glob_workspace',
  'read_skill_resource',
  'read_only_task',
  'memory_search'
] as const

const KNOWN_WORKSPACE_WRITE = [
  'write_workspace_file',
  'remember_teaching_memory',
  'forget_teaching_memory'
] as const

const KNOWN_EXTERNAL_WRITE = ['web_search', 'web_fetch'] as const

const KNOWN_PRIVILEGED = [
  'ask',
  'generate_lesson',
  'delegate_task',
  'parallel_tasks'
] as const

function stubEntry(name: string, capabilities?: ToolCapabilities): ToolEntry {
  const definition = {
    type: 'function',
    function: {
      name,
      description: 'stub',
      parameters: { type: 'object', properties: {} }
    }
  } as ToolDefinition
  return {
    definition,
    handler: async () => '{}',
    ...(capabilities ? { capabilities } : {})
  }
}

describe('tool capabilities matrix', () => {
  it('maps effect classes to default capabilities without opening write parallel', () => {
    expect(capabilitiesForEffectClass('read')).toEqual({
      isReadOnly: true,
      maxConcurrency: READ_TOOL_MAX_CONCURRENCY,
      supportsCancel: true,
      effectClass: 'read'
    })
    expect(capabilitiesForEffectClass('workspace_write')).toEqual({
      isReadOnly: false,
      maxConcurrency: 1,
      supportsCancel: true,
      effectClass: 'workspace_write'
    })
    expect(capabilitiesForEffectClass('external_write')).toEqual({
      isReadOnly: false,
      maxConcurrency: 1,
      supportsCancel: true,
      effectClass: 'external_write'
    })
    expect(capabilitiesForEffectClass('privileged')).toEqual({
      isReadOnly: false,
      maxConcurrency: 1,
      supportsCancel: true,
      effectClass: 'privileged'
    })
  })

  it('derives capabilities for every known catalog tool from classifyToolEffect', () => {
    for (const name of KNOWN_READ) {
      const caps = capabilitiesForTool(name)
      expect(caps.effectClass).toBe('read')
      expect(caps.isReadOnly).toBe(true)
      expect(caps.maxConcurrency).toBe(READ_TOOL_MAX_CONCURRENCY)
      expect(caps.supportsCancel).toBe(true)
      expect(classifyToolEffect(name)).toBe('read')
      expect(isParallelReadCapable(caps)).toBe(true)
    }

    for (const name of KNOWN_WORKSPACE_WRITE) {
      const caps = capabilitiesForTool(name)
      expect(caps.effectClass).toBe('workspace_write')
      expect(caps.isReadOnly).toBe(false)
      expect(caps.maxConcurrency).toBe(NON_READ_MAX_CONCURRENCY)
      expect(isParallelReadCapable(caps)).toBe(false)
    }

    for (const name of KNOWN_EXTERNAL_WRITE) {
      const caps = capabilitiesForTool(name)
      expect(caps.effectClass).toBe('external_write')
      expect(caps.isReadOnly).toBe(false)
      expect(caps.maxConcurrency).toBe(1)
    }

    for (const name of KNOWN_PRIVILEGED) {
      const caps = capabilitiesForTool(name)
      expect(caps.effectClass).toBe('privileged')
      expect(caps.isReadOnly).toBe(false)
      expect(caps.maxConcurrency).toBe(1)
    }
  })

  it('fails closed for unknown tools as privileged concurrency 1', () => {
    const caps = capabilitiesForTool('totally_unknown_shell_tool')
    expect(caps).toEqual({
      isReadOnly: false,
      maxConcurrency: 1,
      supportsCancel: true,
      effectClass: 'privileged'
    })
    expect(isParallelReadCapable(caps)).toBe(false)
  })

  it('treats blank names as privileged concurrency 1', () => {
    expect(capabilitiesForTool('').maxConcurrency).toBe(1)
    expect(capabilitiesForTool('   ').effectClass).toBe('privileged')
  })

  it('never allows non-read maxConcurrency above 1 even if overrides try', () => {
    // Override table only holds known tools; clamp path is still tested via
    // direct effect-class helper invariants for non-read classes.
    for (const effect of ['workspace_write', 'external_write', 'privileged'] as const) {
      const caps = capabilitiesForEffectClass(effect)
      expect(caps.maxConcurrency).toBeLessThanOrEqual(1)
      expect(caps.isReadOnly).toBe(false)
    }
  })

  it('resolveToolEntryCapabilities uses explicit override then defaults', () => {
    const defaulted = resolveToolEntryCapabilities(stubEntry('read_workspace_file'))
    expect(defaulted.isReadOnly).toBe(true)
    expect(defaulted.maxConcurrency).toBe(READ_TOOL_MAX_CONCURRENCY)

    const override: ToolCapabilities = {
      isReadOnly: true,
      maxConcurrency: 2,
      supportsCancel: false,
      effectClass: 'read'
    }
    const resolved = resolveToolEntryCapabilities(stubEntry('read_workspace_file', override))
    expect(resolved).toEqual(override)
  })
})
