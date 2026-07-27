import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { previewSkillOrchestration } from '../../src/main/skill-orchestration-preview'
import { createSkillOrchestrationStateStore } from '../../src/main/skill-orchestration-state-store'
import { createSkillOrchestrationDiagnosticsStore } from '../../src/main/skill-orchestration-diagnostics-store'
import { buildSkillOrchestrationPlanDiagnosticsFact } from '../../src/main/skill-orchestration-host'
import { listSkillOrchestrationPresets } from '../../src/shared/skill-orchestration-presets'
import { listBuiltinSkillOrchestrationPolicies } from '../../src/main/builtin-skill-orchestration-policy'
import type { SkillOrchestrationPreviewDeps } from '../../src/main/skill-orchestration-preview'

const CATALOG = [
  { id: 'teach', installed: true, source: 'builtin' as const },
  { id: 'learning-assessor', installed: true, source: 'builtin' as const },
  { id: 'course-outline-design', installed: true, source: 'builtin' as const },
  { id: 'course-content-authoring', installed: true, source: 'builtin' as const },
  { id: 'course-ebook-publishing', installed: true, source: 'builtin' as const }
]

function deps(overrides: Partial<SkillOrchestrationPreviewDeps> = {}): SkillOrchestrationPreviewDeps {
  return {
    listSkillCatalog: async () => CATALOG,
    ...overrides
  }
}

describe('skill orchestration preview (ADR-0163)', () => {
  it('returns a plan in which every selected capability has a status and reason', async () => {
    const result = await previewSkillOrchestration(
      {
        selectedSkillIds: ['learning-assessor', 'course-ebook-publishing'],
        isTeachingConversation: true,
        userInput: '教我 SQL 窗口函数'
      },
      deps()
    )

    expect(result.ok).toBe(true)
    const decided = new Set(result.plan?.decisions.map((decision) => decision.skillId))
    // No silent ignore: each selection lands in exactly one explained bucket.
    expect(decided.has('learning-assessor')).toBe(true)
    expect(decided.has('course-ebook-publishing')).toBe(true)
    for (const decision of result.plan?.decisions ?? []) {
      expect(decision.reason.length).toBeGreaterThan(0)
    }
  })

  it('is deterministic: same selection and facts produce the same planId', async () => {
    const request = {
      selectedSkillIds: ['learning-assessor'],
      isTeachingConversation: true,
      userInput: '复习一下'
    }
    const first = await previewSkillOrchestration(request, deps())
    const second = await previewSkillOrchestration(request, deps())
    expect(first.plan?.planId).toBe(second.plan?.planId)
  })

  it('expands a host-owned preset and reports auto-added dependencies separately', async () => {
    const result = await previewSkillOrchestration(
      { selectedSkillIds: [], presetId: 'check_mastery', isTeachingConversation: true },
      deps()
    )
    expect(result.ok).toBe(true)
    expect(result.plan?.decisions.some((d) => d.skillId === 'learning-assessor')).toBe(true)
    // The user picked nothing explicitly, so preset-expanded ids are the user's
    // selection, not auto-added deps; auto-added never silently includes them.
    expect(result.autoAddedSkillIds).not.toContain('learning-assessor')
  })

  it('never writes the continuity state file (preview must not advance the cursor)', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'studiumx-preview-'))
    const store = createSkillOrchestrationStateStore({ workspaceRoot })

    await previewSkillOrchestration(
      {
        selectedSkillIds: ['course-outline-design', 'course-content-authoring'],
        conversationId: 'conv-1',
        isTeachingConversation: true
      },
      deps({
        workspaceRoot,
        loadOrchestrationState: (conversationId) => store.load(conversationId)
      })
    )

    // The whole `.agent-sessions` tree must not exist — preview is read-only.
    const entries = await readdir(workspaceRoot).catch(() => [])
    expect(entries).not.toContain('.agent-sessions')
  })

  it('fails soft to "no preview" instead of throwing', async () => {
    const result = await previewSkillOrchestration(
      { selectedSkillIds: ['learning-assessor'] },
      deps({
        listSkillCatalog: async () => {
          throw new Error('catalog exploded')
        },
        loadAuthorityFacts: async () => {
          throw new Error('bridge exploded')
        },
        workspaceRoot: '/nonexistent'
      })
    )
    // Catalog/bridge failures are individually caught, so planning still succeeds.
    expect(result.ok).toBe(true)
    expect(result.plan).not.toBeNull()
  })

  it('caps the selection at the same ceiling as the IPC payload parser', async () => {
    const many = Array.from({ length: 20 }, (_, index) => `skill-${index}`)
    const result = await previewSkillOrchestration(
      { selectedSkillIds: many, isTeachingConversation: true },
      deps({ listSkillCatalog: async () => [] })
    )
    expect(result.ok).toBe(true)
    const nonKernel = (result.plan?.decisions ?? []).filter((d) => d.skillId !== 'teach')
    expect(nonKernel.length).toBeLessThanOrEqual(8)
  })
})

describe('skill orchestration presets (ADR-0163 §2.3)', () => {
  it('only references registered builtin skills and never the reserved kernel id', () => {
    const registered = new Set(listBuiltinSkillOrchestrationPolicies().map((entry) => entry.skillId))
    for (const preset of listSkillOrchestrationPresets()) {
      for (const skillId of preset.skillIds) {
        expect(registered.has(skillId as never)).toBe(true)
        expect(skillId).not.toBe('teach')
      }
    }
  })

  it('has unique ids and non-empty labels', () => {
    const presets = listSkillOrchestrationPresets()
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(presets.length)
    for (const preset of presets) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(0)
    }
  })
})

describe('local plan diagnostics (ADR-0163 §2.6)', () => {
  it('records only allow-listed identifiers, enums and counts', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'studiumx-diagnostics-'))
    const store = createSkillOrchestrationDiagnosticsStore({ workspaceRoot })

    const preview = await previewSkillOrchestration(
      {
        selectedSkillIds: ['learning-assessor'],
        isTeachingConversation: true,
        userInput: 'SECRET-OBJECTIVE-TEXT-should-never-be-persisted'
      },
      deps()
    )
    expect(preview.plan).not.toBeNull()

    const fact = buildSkillOrchestrationPlanDiagnosticsFact({ plan: preview.plan! })
    expect(await store.record(fact, { recordedAt: '2026-07-27T00:00:00.000Z' })).toBe(true)

    const entries = await store.list()
    expect(entries).toHaveLength(1)
    const serialized = JSON.stringify(entries)
    expect(serialized).not.toContain('SECRET-OBJECTIVE-TEXT')
    expect(entries[0]?.planId).toBe(preview.plan?.planId)
    expect(entries[0]?.decisionCounts).toHaveProperty('active_now')
  })

  it('degrades to an empty list when the local file is absent', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'studiumx-diagnostics-empty-'))
    const store = createSkillOrchestrationDiagnosticsStore({ workspaceRoot })
    expect(await store.list()).toEqual([])
  })
})
