import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeachingTurnOrchestrator } from '../../src/main/ai/teaching-turn-orchestrator'
import { createSaveTeachingTurnReviewLastBundleFinalizeHook } from '../../src/main/teaching-turn-review-last-bundle-finalize-hook'
import { loadTeachingTurnReviewLastBundleFromRoot } from '../../src/main/teaching-turn-review-last-bundle-fs'
import type { TeachingTurnReviewBundle } from '../../src/shared/teaching-turn-review'

const orchLastBundleRoots: string[] = []

afterEach(async () => {
  while (orchLastBundleRoots.length > 0) {
    const root = orchLastBundleRoots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe('TeachingTurnOrchestrator', () => {
  it('sequences build, loop, and finalize for visible and synthetic turns', async () => {
    const calls: string[] = []
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async (_command, mode) => {
        calls.push(`build:${mode}`)
        return { mode }
      }),
      runAgentLoop: vi.fn(async (context, mode) => {
        calls.push(`loop:${mode}`)
        return { context }
      }),
      finalizeTeachingTurn: vi.fn(async ({ mode }) => {
        calls.push(`finalize:${mode}`)
        return mode
      })
    })
    await expect(orchestrator.runVisibleTurn({ id: 1 })).resolves.toBe('visible')
    await expect(orchestrator.runSyntheticTurn({ id: 2 })).resolves.toBe('synthetic')
    expect(calls).toEqual([
      'build:visible',
      'loop:visible',
      'finalize:visible',
      'build:synthetic',
      'loop:synthetic',
      'finalize:synthetic'
    ])
  })

  it('does not invoke review hook when omitted (zero behavior change)', async () => {
    const finalizeTeachingTurn = vi.fn(async ({ mode }) => `final:${mode}`)
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async () => ({})),
      runAgentLoop: vi.fn(async () => ({})),
      finalizeTeachingTurn
    })
    await expect(orchestrator.runVisibleTurn({ id: 1 })).resolves.toBe('final:visible')
    expect(finalizeTeachingTurn).toHaveBeenCalledTimes(1)
  })

  it('invokes review hook after finalize with requireHumanApproval candidates in visible mode', async () => {
    const onTeachingTurnReview = vi.fn(async () => undefined)
    const finalizeTeachingTurn = vi.fn(async () => ({ settled: true as const }))
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async () => ({})),
      runAgentLoop: vi.fn(async () => ({})),
      finalizeTeachingTurn,
      buildTeachingTurnReviewInput: vi.fn(async () => ({
        mode: 'visible' as const,
        userText: '请记住我的偏好：喜欢用例子讲课',
        assistantText: '好的。',
        toolNames: []
      })),
      onTeachingTurnReview
    })

    await expect(orchestrator.runVisibleTurn({ id: 9 })).resolves.toEqual({ settled: true })
    expect(finalizeTeachingTurn).toHaveBeenCalledTimes(1)
    expect(onTeachingTurnReview).toHaveBeenCalledTimes(1)

    const payload = onTeachingTurnReview.mock.calls[0][0] as {
      mode: string
      bundle: TeachingTurnReviewBundle
    }
    expect(payload.mode).toBe('visible')
    expect(payload.bundle.candidates.length).toBeGreaterThan(0)
    for (const candidate of payload.bundle.candidates) {
      expect(candidate.requiresHumanApproval).toBe(true)
    }
  })

  it('synthetic mode yields empty candidates even when builder input has signals', async () => {
    const onTeachingTurnReview = vi.fn(async () => undefined)
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async () => ({})),
      runAgentLoop: vi.fn(async () => ({})),
      finalizeTeachingTurn: vi.fn(async () => 'ok'),
      buildTeachingTurnReviewInput: vi.fn(async () => ({
        // If mode were trusted from builder alone, this would emit candidates — orchestrator forces mode.
        mode: 'visible' as const,
        userText: '请记住我的偏好：喜欢用例子讲课',
        assistantText: '工具调用失败 path_rejected',
        toolNames: ['read_error_tool']
      })),
      onTeachingTurnReview
    })

    await expect(orchestrator.runSyntheticTurn({ id: 3 })).resolves.toBe('ok')
    expect(onTeachingTurnReview).toHaveBeenCalledTimes(1)
    const payload = onTeachingTurnReview.mock.calls[0][0] as {
      mode: string
      bundle: TeachingTurnReviewBundle
    }
    expect(payload.mode).toBe('synthetic')
    expect(payload.bundle.candidates).toEqual([])
  })

  it('preserves finalize result when review hook throws (fail-soft)', async () => {
    const finalizeTeachingTurn = vi.fn(async () => ({ settled: 'done' as const }))
    const onTeachingTurnReview = vi.fn(async () => {
      throw new Error('hook boom')
    })
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async () => ({})),
      runAgentLoop: vi.fn(async () => ({})),
      finalizeTeachingTurn,
      buildTeachingTurnReviewInput: vi.fn(async () => ({ mode: 'visible' as const })),
      onTeachingTurnReview
    })

    await expect(orchestrator.runVisibleTurn({ id: 4 })).resolves.toEqual({ settled: 'done' })
    expect(finalizeTeachingTurn).toHaveBeenCalledTimes(1)
    expect(onTeachingTurnReview).toHaveBeenCalledTimes(1)
  })

  it('preserves finalize result when assertReviewNotAutoApplied fails on bad builder payloads', async () => {
    // buildTeachingTurnReviewBundle freezes candidates with requiresHumanApproval:true,
    // so inject a post-build path by stubbing via a hook-side throw after assert would pass
    // is already covered. Here we force builder to throw via a rejecting mapper.
    const finalizeTeachingTurn = vi.fn(async () => 'settled-value')
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async () => ({})),
      runAgentLoop: vi.fn(async () => ({})),
      finalizeTeachingTurn,
      buildTeachingTurnReviewInput: vi.fn(async () => {
        throw new Error('builder failed')
      }),
      onTeachingTurnReview: vi.fn(async () => undefined)
    })

    await expect(orchestrator.runVisibleTurn({ id: 5 })).resolves.toBe('settled-value')
    expect(finalizeTeachingTurn).toHaveBeenCalledTimes(1)
  })

  it('wires createSaveTeachingTurnReviewLastBundleFinalizeHook as onTeachingTurnReview (enabled, temp root)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-orch-last-bundle-'))
    orchLastBundleRoots.push(root)
    const onTeachingTurnReview = createSaveTeachingTurnReviewLastBundleFinalizeHook({
      rootPath: root,
      enabled: true
    })
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async () => ({})),
      runAgentLoop: vi.fn(async () => ({})),
      finalizeTeachingTurn: vi.fn(async () => ({ settled: true as const })),
      buildTeachingTurnReviewInput: vi.fn(async () => ({
        mode: 'visible' as const,
        userText: '请记住我的偏好：喜欢用例子讲课',
        assistantText: '好的。',
        toolNames: []
      })),
      onTeachingTurnReview
    })

    await expect(orchestrator.runVisibleTurn({ id: 42 })).resolves.toEqual({ settled: true })

    const loaded = await loadTeachingTurnReviewLastBundleFromRoot({ rootPath: root })
    expect(loaded).not.toBeNull()
    expect(loaded?.source).toBe('finalize_hook')
    expect(loaded?.bundle.candidates.every((c) => c.requiresHumanApproval === true)).toBe(true)
    expect(loaded?.decision).toBeUndefined()
  })
})