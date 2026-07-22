import { describe, expect, it } from 'vitest'

import { resolveTeachingCapabilityPolicy } from '../../src/main/ai/agent-capability-policy'

describe('teaching capability policy', () => {
  it('shares temporary chat agent surface with teaching except generate_lesson (ADR-0128 §5.4)', () => {
    const policy = resolveTeachingCapabilityPolicy({
      mode: 'temporary',
      toolsEnabled: true,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true
    })

    expect(policy.id).toBe('temporary_chat')
    expect(policy.allowedToolNames).toEqual(expect.arrayContaining([
      'web_search',
      'web_fetch',
      'ask',
      'read_skill_resource',
      'delegate_task',
      'read_only_task',
      'parallel_tasks',
      'list_workspace',
      'read_workspace_file',
      'write_workspace_file'
    ]))
    expect(policy.allowedToolNames).not.toContain('generate_lesson')
    expect(policy.workspaceToolsEnabled).toBe(true)
    expect(policy.delegationEnabled).toBe(true)
    expect(policy.lessonToolEnabled).toBe(false)
    expect(policy.allowsTool('generate_lesson')).toBe(false)
    expect(policy.allowsTool('mcp__demo__echo')).toBe(true)
    expect(policy.allowsTool('future_workspace_tool')).toBe(false)
  })

  it('keeps temporary chat without workspace tools when grant is withheld', () => {
    const policy = resolveTeachingCapabilityPolicy({
      mode: 'temporary',
      toolsEnabled: true,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: false,
      hasLessonGenerator: true
    })

    expect(policy.workspaceToolsEnabled).toBe(false)
    expect(policy.lessonToolEnabled).toBe(false)
    expect(policy.allowsTool('write_workspace_file')).toBe(false)
    expect(policy.allowsTool('mcp__demo__echo')).toBe(true)
  })

  it('keeps existing teaching-without-workspace delegation while withholding workspace and lesson tools', () => {
    const policy = resolveTeachingCapabilityPolicy({
      mode: 'teaching',
      toolsEnabled: true,
      hasTeachingWorkspace: false,
      workspaceToolAccessGranted: false,
      hasLessonGenerator: true
    })

    expect(policy.id).toBe('teaching_readonly')
    expect(policy.allowedToolNames).toEqual(expect.arrayContaining([
      'web_search',
      'ask',
      'read_skill_resource',
      'delegate_task',
      'read_only_task',
      'parallel_tasks'
    ]))
    expect(policy.workspaceToolsEnabled).toBe(false)
    expect(policy.delegationEnabled).toBe(true)
    expect(policy.lessonToolEnabled).toBe(false)
    expect(policy.allowsTool('write_workspace_file')).toBe(false)
    expect(policy.allowsTool('mcp__other__tool')).toBe(true)
  })

  it('enables the established trusted workspace toolset and makes lesson generation conditional', () => {
    const withGenerator = resolveTeachingCapabilityPolicy({
      mode: 'teaching',
      toolsEnabled: true,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true
    })
    const withoutGenerator = resolveTeachingCapabilityPolicy({
      mode: 'teaching',
      toolsEnabled: true,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: false
    })

    expect(withGenerator.id).toBe('teaching_workspace')
    expect(withGenerator.allowedToolNames).toEqual(expect.arrayContaining([
      'list_workspace',
      'read_workspace_file',
      'search_workspace',
      'glob_workspace',
      'memory_search',
      'write_workspace_file',
      'remember_teaching_memory',
      'forget_teaching_memory',
      'delegate_task',
      'generate_lesson'
    ]))
    expect(withGenerator.workspaceToolsEnabled).toBe(true)
    expect(withGenerator.delegationEnabled).toBe(true)
    expect(withGenerator.lessonToolEnabled).toBe(true)
    expect(withoutGenerator.lessonToolEnabled).toBe(false)
    expect(withoutGenerator.allowsTool('generate_lesson')).toBe(false)
    expect(withGenerator.allowsTool('mcp__srv__x')).toBe(true)
  })

  it('keeps lesson generation for an untrusted teaching workspace while withholding every workspace file tool', () => {
    const policy = resolveTeachingCapabilityPolicy({
      mode: 'teaching',
      toolsEnabled: true,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: false,
      hasLessonGenerator: true
    })

    expect(policy.id).toBe('teaching_workspace')
    expect(policy.workspaceToolsEnabled).toBe(false)
    expect(policy.lessonToolEnabled).toBe(true)
    expect(policy.allowedToolNames).toEqual(expect.arrayContaining([
      'generate_lesson',
      'delegate_task',
      'web_search'
    ]))
    for (const workspaceToolName of [
      'list_workspace',
      'read_workspace_file',
      'search_workspace',
      'glob_workspace',
      'write_workspace_file'
    ]) {
      expect(policy.allowsTool(workspaceToolName)).toBe(false)
    }
  })

  it('denies all tools and MCP when tools are disabled', () => {
    const policy = resolveTeachingCapabilityPolicy({
      mode: 'teaching',
      toolsEnabled: false,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true
    })
    expect(policy.allowedToolNames).toEqual([])
    expect(policy.allowsTool('web_search')).toBe(false)
    expect(policy.allowsTool('mcp__demo__echo')).toBe(false)
  })
})