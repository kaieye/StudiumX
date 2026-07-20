import { describe, expect, it, vi } from 'vitest'
import { TeachingTurnOrchestrator } from '../../src/main/ai/teaching-turn-orchestrator'

describe('TeachingTurnOrchestrator', () => {
  it('sequences build, loop, and finalize for visible and synthetic turns', async () => {
    const calls: string[] = []
    const orchestrator = new TeachingTurnOrchestrator({
      buildTeachingTurnContext: vi.fn(async (_command, mode) => { calls.push(`build:${mode}`); return { mode } }),
      runAgentLoop: vi.fn(async (context, mode) => { calls.push(`loop:${mode}`); return { context } }),
      finalizeTeachingTurn: vi.fn(async ({ mode }) => { calls.push(`finalize:${mode}`); return mode })
    })
    await expect(orchestrator.runVisibleTurn({ id: 1 })).resolves.toBe('visible')
    await expect(orchestrator.runSyntheticTurn({ id: 2 })).resolves.toBe('synthetic')
    expect(calls).toEqual(['build:visible', 'loop:visible', 'finalize:visible', 'build:synthetic', 'loop:synthetic', 'finalize:synthetic'])
  })
})
