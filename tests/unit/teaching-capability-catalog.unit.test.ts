import { describe, expect, it } from 'vitest'

import {
  createTeachingCapabilityCatalog,
  selectPromptEligibleCapabilities,
  snapshotTeachingCapabilities,
  type CapabilityItem
} from '../../src/main/teaching-capability-catalog'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { SkillSummary, TeachingSettingsV1 } from '../../src/shared/teaching-types'

function skill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: 'skill-demo',
    name: 'Demo skill',
    description: 'demo',
    category: 'learning',
    icon: 'book',
    author: 'test',
    command: '/demo',
    source: 'personal',
    installed: true,
    ...overrides
  }
}

function settings(patch: (base: TeachingSettingsV1) => TeachingSettingsV1 = (base) => base): TeachingSettingsV1 {
  const base = defaultSettings('D:/tmp/teaching-capability-catalog')
  return patch(structuredClone(base))
}

function byId(items: readonly CapabilityItem[], id: string): CapabilityItem {
  const found = items.find((item) => item.id === id || item.id.startsWith(`${id}:`))
  if (!found) throw new Error(`missing capability ${id}`)
  return found
}

describe('TeachingCapabilityCatalog', () => {
  it('marks disabled and unconfigured capabilities as non-prompt-eligible', () => {
    const snapshot = snapshotTeachingCapabilities({
      settings: settings((base) => {
        base.tools.enabled = false
        base.tools.webSearch = false
        base.tools.webFetch = false
        base.provider.providers = base.provider.providers.map((provider) => ({
          ...provider,
          apiKey: ''
        }))
        return base
      }),
      mode: 'teaching',
      hasTeachingWorkspace: false,
      workspaceToolAccessGranted: false,
      hasLessonGenerator: false,
      skills: [skill({ source: 'builtin', installed: false })]
    })

    expect(snapshot.available).toEqual([])
    expect(selectPromptEligibleCapabilities(snapshot)).toEqual([])
    expect(byId(snapshot.items, 'tools').status).toBe('disabled')
    expect(byId(snapshot.items, 'model_provider').status).toBe('unconfigured')
    expect(byId(snapshot.items, 'web_search').status).toBe('disabled')
    expect(byId(snapshot.items, 'skill').status).toBe('disabled')
    for (const item of snapshot.items) {
      expect(item.promptEligible).toBe(false)
    }
  })

  it('exposes only available capabilities for planner/context prompt inputs', () => {
    const snapshot = snapshotTeachingCapabilities({
      settings: settings((base) => {
        base.tools.enabled = true
        base.tools.webSearch = true
        base.tools.webFetch = true
        base.tools.workspaceRead = true
        base.provider.providers = base.provider.providers.map((provider, index) =>
          index === 0
            ? { ...provider, apiKey: 'sk-test-key', baseUrl: provider.baseUrl || 'https://api.example.test/v1' }
            : provider
        )
        return base
      }),
      mode: 'teaching',
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true,
      skills: [
        skill({ id: 'installed-personal', name: 'Installed', source: 'personal', installed: true }),
        skill({ id: 'builtin-missing', name: 'Builtin missing', source: 'builtin', installed: false })
      ]
    })

    expect(snapshot.policyId).toBe('teaching_workspace')
    expect(byId(snapshot.items, 'tools').status).toBe('available')
    expect(byId(snapshot.items, 'model_provider').status).toBe('available')
    expect(byId(snapshot.items, 'web_search').status).toBe('available')
    expect(byId(snapshot.items, 'web_fetch').status).toBe('available')
    expect(byId(snapshot.items, 'workspace_tools').status).toBe('available')
    expect(byId(snapshot.items, 'delegation').status).toBe('available')
    expect(byId(snapshot.items, 'lesson').status).toBe('available')
    expect(byId(snapshot.items, 'skill:installed-personal').status).toBe('available')
    expect(byId(snapshot.items, 'skill:builtin-missing').status).toBe('unconfigured')

    const promptIds = selectPromptEligibleCapabilities(snapshot).map((item) => item.id)
    expect(promptIds).toEqual(expect.arrayContaining([
      'tools',
      expect.stringMatching(/^model_provider:/),
      'web_search',
      'web_fetch',
      'workspace_tools',
      'delegation',
      'lesson',
      'skill:installed-personal'
    ]))
    expect(promptIds).not.toContain('skill:builtin-missing')
    expect(snapshot.available.every((item) => item.status === 'available' && item.promptEligible)).toBe(true)
  })

  it('denies workspace tools when policy or grant fails closed', () => {
    const deniedGrant = snapshotTeachingCapabilities({
      settings: settings((base) => {
        base.tools.enabled = true
        return base
      }),
      mode: 'teaching',
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: false,
      hasLessonGenerator: true,
      skills: []
    })
    expect(byId(deniedGrant.items, 'workspace_tools').status).toBe('denied')
    expect(byId(deniedGrant.items, 'lesson').status).toBe('available')

    const temporary = snapshotTeachingCapabilities({
      settings: settings((base) => {
        base.tools.enabled = true
        return base
      }),
      mode: 'temporary',
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true,
      skills: [skill()]
    })
    expect(temporary.policyId).toBe('temporary_chat')
    // Stage A / ADR-0128 §5.4: temporary shares agent tool surface; only lesson product writers denied.
    expect(byId(temporary.items, 'delegation').status).toBe('available')
    expect(byId(temporary.items, 'lesson').status).toBe('denied')
    expect(byId(temporary.items, 'workspace_tools').status).toBe('available')
  })

  it('degrades skill load failures and catalog exceptions without throwing', () => {
    const skillFailure = snapshotTeachingCapabilities({
      settings: settings((base) => {
        base.tools.enabled = true
        return base
      }),
      skills: undefined,
      skillLoadError: 'skill root unreadable'
    })
    expect(byId(skillFailure.items, 'skills').status).toBe('degraded')
    expect(skillFailure.available.some((item) => item.kind === 'skill')).toBe(false)
    expect(byId(skillFailure.items, 'skills').promptEligible).toBe(false)

    const catalog = createTeachingCapabilityCatalog({
      defaultTtlMs: 0,
      now: () => 1_700_000_000_000
    })
    const brokenSettings = new Proxy({} as TeachingSettingsV1, {
      get() {
        throw new Error('settings boom')
      }
    })
    const degraded = catalog.snapshot({ settings: brokenSettings })
    expect(degraded.available).toEqual([])
    expect(degraded.freshness.stale).toBe(true)
    expect(degraded.items[0]?.status).toBe('degraded')
    expect(degraded.items[0]?.reason).toContain('settings boom')
  })

  it('applies TTL cache and invalidation without becoming a second registry', () => {
    let now = 1_000
    const catalog = createTeachingCapabilityCatalog({
      defaultTtlMs: 5_000,
      now: () => now
    })
    const request = {
      settings: settings((base) => {
        base.tools.enabled = true
        base.provider.providers = base.provider.providers.map((provider, index) =>
          index === 0
            ? { ...provider, apiKey: 'sk-cache', baseUrl: provider.baseUrl || 'https://api.example.test/v1' }
            : provider
        )
        return base
      }),
      mode: 'teaching' as const,
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true,
      skills: [skill()]
    }

    const first = catalog.snapshot(request)
    now = 2_000
    const cached = catalog.snapshot(request)
    expect(cached.generatedAt).toBe(first.generatedAt)
    expect(cached.freshness.stale).toBe(false)

    now = 7_000
    const refreshed = catalog.snapshot(request)
    expect(refreshed.generatedAt).not.toBe(first.generatedAt)

    catalog.invalidate()
    now = 7_100
    const afterInvalidate = catalog.snapshot(request)
    expect(afterInvalidate.generatedAt).not.toBe(refreshed.generatedAt)

    const disabled = catalog.snapshot({
      ...request,
      settings: settings((base) => {
        base.tools.enabled = false
        return base
      })
    })
    expect(disabled.available).toEqual([])
    expect(selectPromptEligibleCapabilities(disabled)).toEqual([])
  })

  it('includes shell tools in workspace_tools details when workspaceShell on', () => {
    const on = snapshotTeachingCapabilities({
      settings: settings((base) => {
        base.tools.enabled = true
        base.tools.workspaceRead = true
        base.tools.workspaceShell = true
        return base
      }),
      mode: 'teaching',
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true,
      skills: []
    })
    const item = byId(on.items, 'workspace_tools')
    expect(item.status).toBe('available')
    expect(item.details?.workspaceShell).toBe(true)
    expect(String(item.details?.shellTools ?? '')).toMatch(/run_workspace_command/)
    expect(item.reason).toMatch(/run_workspace_command\/shell/)

    const off = snapshotTeachingCapabilities({
      settings: settings((base) => {
        base.tools.enabled = true
        base.tools.workspaceRead = true
        base.tools.workspaceShell = false
        return base
      }),
      mode: 'teaching',
      hasTeachingWorkspace: true,
      workspaceToolAccessGranted: true,
      hasLessonGenerator: true,
      skills: []
    })
    const offItem = byId(off.items, 'workspace_tools')
    expect(offItem.status).toBe('available')
    expect(offItem.details?.workspaceShell).toBe(false)
    expect(String(offItem.details?.shellTools ?? '')).toBe('disabled')
    expect(offItem.reason).not.toMatch(/includes run_workspace_command/)
  })

})
