import { describe, expect, it } from 'vitest'

import { resolveTeachingCapabilityPolicy } from '../../src/main/ai/agent-capability-policy'

describe('teaching capability policy', () => {
  it('keeps a temporary chat explicitly isolated from workspace, lesson, and delegation tools', () => {
    const policy = resolveTeachingCapabilityPolicy({
      mode: 'temporary',
      toolsEnabled: true,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true
    })

    expect(policy.id).toBe('temporary_chat')
    expect(policy.allowedToolNames).toEqual(['web_search', 'web_fetch', 'ask', 'read_skill_resource'])
    expect(policy.deniedToolNames).toEqual(expect.arrayContaining([
      'list_workspace',
      'read_workspace_file',
      'write_workspace_file',
      'memory_search',
      'remember_teaching_memory',
      'forget_teaching_memory',
      'generate_lesson',
      'delegate_task',
      'read_only_task',
      'parallel_tasks'
    ]))
    expect(policy.workspaceToolsEnabled).toBe(false)
    expect(policy.delegationEnabled).toBe(false)
    expect(policy.lessonToolEnabled).toBe(false)
    expect(policy.allowsTool('future_workspace_tool')).toBe(false)
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

    const missingGrant = resolveTeachingCapabilityPolicy({
      mode: 'teaching',
      toolsEnabled: true,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: undefined,
      hasLessonGenerator: true
    })
    expect(missingGrant.workspaceToolsEnabled).toBe(false)
    expect(missingGrant.lessonToolEnabled).toBe(true)
  })

  it('closes every capability when the master tool setting is disabled', () => {
    const policy = resolveTeachingCapabilityPolicy({
      mode: 'teaching',
      toolsEnabled: false,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true
    })

    expect(policy.id).toBe('teaching_workspace')
    expect(policy.allowedToolNames).toEqual([])
    expect(policy.deniedToolNames).toEqual(expect.arrayContaining([
      'web_search',
      'write_workspace_file',
      'delegate_task',
      'generate_lesson'
    ]))
    expect(policy.workspaceToolsEnabled).toBe(false)
    expect(policy.lessonToolEnabled).toBe(false)
    expect(policy.delegationEnabled).toBe(false)
  })
})
