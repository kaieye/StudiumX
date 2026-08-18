import { mkdtemp, writeFile, mkdir, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { plan } from '../../src/main/skill-orchestration-planner'
import {
  advanceConversationOrchestrationState,
  evaluateSkillOrchestrationStageGates,
  priorStateFromConversationOrchestrationState
} from '../../src/main/skill-orchestration-host'
import {
  createSkillOrchestrationStateStore,
  normalizeConversationOrchestrationState
} from '../../src/main/skill-orchestration-state-store'
import type {
  ConversationOrchestrationState,
  SkillOrchestrationPriorState,
  SkillOrchestrationReadiness
} from '../../src/shared/teaching-types/skill-orchestration'

const NOW = '2026-07-26T12:00:00.000Z'

function readyAll(ids: string[]): SkillOrchestrationReadiness[] {
  return ids.map((skillId) => ({ skillId, installed: true, trustedBuiltin: true, ready: true }))
}

function priorState(overrides: Partial<SkillOrchestrationPriorState> = {}): SkillOrchestrationPriorState {
  return {
    planId: 'sop1_deadbeef',
    planRevision: 1,
    stageCursor: null,
    completedStageKinds: [],
    artifactFacts: [],
    ...overrides
  }
}

describe('skill orchestration continuity (ADR-0014)', () => {
  it('regression: artifact tokens keep declared casing so accepts/produces match', () => {
    const result = plan({
      selectedSkillIds: ['course-content-authoring'],
      mode: 'artifact_workflow',
      readiness: readyAll(['course-content-authoring', 'course-outline-design']),
      availableArtifacts: ['CourseOutline']
    })

    expect(result.decisions.find((d) => d.skillId === 'course-content-authoring')?.status).toBe('active_now')
    expect(result.authorityEcho?.availableArtifacts).toEqual(['CourseOutline'])
    const authoring = result.stages.find((s) => s.kind === 'artifact_authoring')
    expect(authoring?.produces).toContain('CourseContent')
  })

  it('activates enhancers once the base artifact stage completed in prior turns', () => {
    const result = plan({
      selectedSkillIds: ['static-spa-interactions'],
      mode: 'artifact_workflow',
      readiness: readyAll(['static-spa-interactions', 'static-spa-conversion']),
      priorState: priorState({ completedStageKinds: ['artifact_authoring'], artifactFacts: ['StaticSpa'] })
    })

    expect(result.decisions.find((d) => d.skillId === 'static-spa-interactions')?.status).toBe('active_now')
    expect(result.currentStageId).toBeTruthy()
    expect(result.stages.every((s) => s.status !== undefined)).toBe(true)
  })

  it('keeps single-turn plans byte-stable: no stage status without prior state', () => {
    const result = plan({
      selectedSkillIds: ['static-spa-interactions'],
      mode: 'artifact_workflow',
      readiness: readyAll(['static-spa-interactions', 'static-spa-conversion'])
    })

    expect(result.currentStageId).toBeUndefined()
    expect(result.stages.every((s) => s.status === undefined)).toBe(true)
  })

  it('activates packagers when artifacts exist and authoring completed', () => {
    const result = plan({
      selectedSkillIds: ['course-ebook-publishing'],
      mode: 'artifact_workflow',
      readiness: readyAll(['course-ebook-publishing', 'course-content-authoring', 'course-outline-design']),
      availableArtifacts: ['CourseContent', 'StaticSpa'],
      priorState: priorState({ completedStageKinds: ['artifact_authoring'] })
    })

    expect(result.decisions.find((d) => d.skillId === 'course-ebook-publishing')?.status).toBe('active_now')
  })

  it('is deterministic with prior state and keys planId on it', () => {
    const input = {
      selectedSkillIds: ['course-content-authoring'],
      mode: 'artifact_workflow' as const,
      readiness: readyAll(['course-content-authoring', 'course-outline-design']),
      priorState: priorState({ artifactFacts: ['CourseOutline'] })
    }

    expect(plan(input)).toEqual(plan(input))
    expect(plan(input).planId).not.toBe(plan({ ...input, priorState: undefined }).planId)
  })

  it('ignores malformed prior state (fail-soft to single-turn planning)', () => {
    const result = plan({
      selectedSkillIds: [],
      mode: 'teaching_turn',
      priorState: {
        planId: 'evil../..',
        planRevision: -1,
        stageCursor: 'x' as never,
        completedStageKinds: ['nope' as never],
        artifactFacts: ['../etc']
      }
    })

    expect(result.currentStageId).toBeUndefined()
  })

  it('evaluates artifact-derivable gates deterministically and never invents verifier results', () => {
    const planned = plan({
      selectedSkillIds: ['course-content-authoring', 'web-content-audit'],
      mode: 'artifact_workflow',
      readiness: readyAll(['course-content-authoring', 'course-outline-design', 'web-content-audit']),
      availableArtifacts: ['CourseOutline', 'CourseContent']
    })
    const gates = evaluateSkillOrchestrationStageGates({
      plan: planned,
      artifactFacts: ['CourseOutline', 'CourseContent']
    })

    expect(gates.find((g) => g.gateId === 'artifact-lead-writer')?.passed).toBe(true)
    const verify = gates.find((g) => g.gateId === 'verify-reports')
    expect(verify?.passed).toBe(false)
    expect(verify?.checkedFact).toBe('not_derivable_from_artifact_facts_v1')
  })

  it('advances state monotonically and bumps revision when the plan changes', () => {
    const first = plan({
      selectedSkillIds: ['course-content-authoring'],
      mode: 'artifact_workflow',
      readiness: readyAll(['course-content-authoring', 'course-outline-design']),
      availableArtifacts: ['CourseOutline', 'CourseContent']
    })
    const firstGates = evaluateSkillOrchestrationStageGates({ plan: first, artifactFacts: ['CourseOutline', 'CourseContent'] })
    const firstState = advanceConversationOrchestrationState({
      conversationId: 'conv-1',
      prior: null,
      plan: first,
      gateResults: firstGates,
      artifactFacts: ['CourseOutline', 'CourseContent'],
      updatedAt: NOW
    })

    expect(firstState.planRevision).toBe(1)
    expect(firstState.stages.find((s) => s.kind === 'artifact_authoring')?.status).toBe('completed')

    const prior = priorStateFromConversationOrchestrationState(firstState)
    expect(prior?.completedStageKinds).toEqual(['artifact_authoring'])

    const second = plan({
      selectedSkillIds: ['course-content-authoring', 'web-content-audit'],
      mode: 'artifact_workflow',
      readiness: readyAll(['course-content-authoring', 'course-outline-design', 'web-content-audit']),
      availableArtifacts: ['CourseOutline', 'CourseContent'],
      priorState: prior
    })
    const secondState = advanceConversationOrchestrationState({
      conversationId: 'conv-1',
      prior: firstState,
      plan: second,
      gateResults: evaluateSkillOrchestrationStageGates({ plan: second, artifactFacts: ['CourseOutline', 'CourseContent'] }),
      artifactFacts: ['CourseOutline', 'CourseContent'],
      updatedAt: NOW
    })

    expect(secondState.planRevision).toBe(2)
  })
})

describe('skill orchestration state store (ADR-0014)', () => {
  function state(): ConversationOrchestrationState {
    return {
      schemaVersion: 1,
      conversationId: 'conv-1',
      planId: 'sop1_0badf00d',
      planRevision: 1,
      mode: 'artifact_workflow',
      stageCursor: 'stage_enhance',
      stages: [{ stageId: 'stage_enhance', kind: 'enhance', status: 'active', gateResults: [] }],
      artifactFacts: ['CourseOutline'],
      updatedAt: NOW
    }
  }

  it('round-trips a valid state and rejects corrupt or traversal ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sx-orch-state-'))
    const store = createSkillOrchestrationStateStore({ workspaceRoot: root })

    expect(await store.save('conv-1', state())).toBe(true)
    expect(await store.load('conv-1')).toEqual(state())

    await mkdir(join(root, '.agent-sessions', 'skill-orchestration'), { recursive: true })
    await writeFile(join(root, '.agent-sessions', 'skill-orchestration', 'conv-2.json'), '{"schemaVersion":1,"planId":"evil"}', 'utf8')
    expect(await store.load('conv-2')).toBeNull()
    expect(await store.load('../conv-1')).toBeNull()
    expect(await store.save('bad/../id', state())).toBe(false)
  })

  it('refuses a symlinked local state parent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sx-orch-state-link-'))
    const outside = await mkdtemp(join(tmpdir(), 'sx-orch-state-outside-'))
    try {
      await symlink(outside, join(root, '.agent-sessions'))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) return
      throw error
    }
    const store = createSkillOrchestrationStateStore({ workspaceRoot: root })

    expect(await store.save('conv-1', state())).toBe(false)
    expect(await store.load('conv-1')).toBeNull()
    expect(await readdir(outside)).toEqual([])
  })

  it('normalize rejects malformed shapes entirely (no partial trust)', () => {
    expect(normalizeConversationOrchestrationState(null)).toBeNull()
    expect(normalizeConversationOrchestrationState({ schemaVersion: 2 })).toBeNull()
    expect(normalizeConversationOrchestrationState({ ...state(), planId: 'nope' })).toBeNull()
    expect(normalizeConversationOrchestrationState({ ...state(), artifactFacts: ['../etc'] })).toBeNull()
    expect(normalizeConversationOrchestrationState(state())).toEqual(state())
  })
})
