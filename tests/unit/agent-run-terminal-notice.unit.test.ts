import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AgentRunStore } from '../../src/main/ai/agent-run-store'

const roots: string[] = []

async function storageRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-terminal-notice-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('AgentRunStore terminal restart notices', () => {
  it('projects only completed failed resource/retry terminals as safe, newest-first read-only notices', async () => {
    const root = await storageRoot()
    let now = '2026-08-05T10:00:00.000Z'
    const store = new AgentRunStore(root, () => now)

    await store.create({ runId: 'run-retry', streamId: 'stream-retry', workspaceId: 'workspace-1', conversationId: 'conversation-1', parentTurn: { userInput: 'Explain momentum.' } })
    now = '2026-08-05T10:01:00.000Z'
    await store.update('run-retry', {
      status: 'failed',
      completedAt: now,
      stopReason: 'retry_exhausted',
      usage: { providerCalls: 3, toolCalls: 0, toolErrors: 0, iterations: 0, childRuns: 0, durationMs: 50 }
    })

    await store.create({ runId: 'run-resource', streamId: 'stream-resource', workspaceId: 'workspace-1', conversationId: 'conversation-2', parentTurn: { userInput: 'Continue the derivation.' } })
    now = '2026-08-05T10:02:00.000Z'
    await store.update('run-resource', {
      status: 'failed',
      completedAt: now,
      stopReason: 'resource_limit',
      usage: {
        providerCalls: 2,
        toolCalls: 1,
        toolErrors: 0,
        iterations: 0,
        childRuns: 0,
        durationMs: 120,
        resourceGovernance: {
          configured: [{ layer: 'user_budget', meter: 'total_tokens', limit: 1000, scope: 'run' }],
          terminal: { layer: 'user_budget', meter: 'total_tokens', used: 1000, limit: 1000, scope: 'run', action: 'resource_limit' }
        }
      }
    })

    await store.create({ runId: 'run-suspended', streamId: 'stream-suspended' })
    now = '2026-08-05T10:03:00.000Z'
    await store.update('run-suspended', {
      status: 'failed',
      completedAt: now,
      stopReason: 'suspended',
      usage: { providerCalls: 1, toolCalls: 0, toolErrors: 0, iterations: 0, childRuns: 0, durationMs: 20 }
    })

    await store.create({ runId: 'run-no-progress', streamId: 'stream-no-progress' })
    now = '2026-08-05T10:04:00.000Z'
    await store.update('run-no-progress', {
      status: 'failed', completedAt: now, stopReason: 'no_progress',
      usage: { providerCalls: 4, toolCalls: 4, toolErrors: 0, iterations: 4, childRuns: 0, durationMs: 200 }
    })

    await store.create({ runId: 'run-context-unrecoverable', streamId: 'stream-context-unrecoverable' })
    now = '2026-08-05T10:05:00.000Z'
    await store.update('run-context-unrecoverable', {
      status: 'failed', completedAt: now, stopReason: 'context_unrecoverable',
      usage: { providerCalls: 1, toolCalls: 0, toolErrors: 0, iterations: 0, childRuns: 0, durationMs: 80 }
    })

    await store.create({ runId: 'run-ordinary-failure', streamId: 'stream-ordinary-failure' })
    now = '2026-08-05T10:06:00.000Z'
    await store.update('run-ordinary-failure', {
      status: 'failed', completedAt: now, stopReason: 'error',
      usage: { providerCalls: 0, toolCalls: 0, toolErrors: 0, iterations: 0, childRuns: 0, durationMs: 0 }
    })

    await store.create({ runId: 'run-incomplete-terminal', streamId: 'stream-incomplete-terminal' })
    now = '2026-08-05T10:07:00.000Z'
    await store.update('run-incomplete-terminal', {
      status: 'failed', stopReason: 'resource_limit',
      usage: { providerCalls: 0, toolCalls: 0, toolErrors: 0, iterations: 0, childRuns: 0, durationMs: 0 }
    })

    const notices = await store.listTerminalNotices()

    expect(notices.map((notice) => notice.runId)).toEqual([
      'run-context-unrecoverable', 'run-no-progress', 'run-suspended', 'run-resource', 'run-retry'
    ])
    expect(notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ runId: 'run-retry', status: 'failed', stopReason: 'retry_exhausted', completedAt: '2026-08-05T10:01:00.000Z' }),
      expect.objectContaining({ runId: 'run-no-progress', status: 'failed', stopReason: 'no_progress' }),
      expect.objectContaining({ runId: 'run-context-unrecoverable', status: 'failed', stopReason: 'context_unrecoverable' }),
      expect.objectContaining({
        runId: 'run-resource',
        status: 'failed',
        stopReason: 'resource_limit',
        workspaceId: 'workspace-1',
        conversationId: 'conversation-2',
        usage: expect.objectContaining({
          resourceGovernance: expect.objectContaining({
            terminal: { layer: 'user_budget', meter: 'total_tokens', used: 1000, limit: 1000, scope: 'run', action: 'resource_limit' }
          })
        })
      })
    ]))
    expect(notices.find((notice) => notice.runId === 'run-resource')?.userInputPreview).toContain('Continue the derivation')
    expect(notices.some((notice) => notice.runId === 'run-ordinary-failure')).toBe(false)
    expect(notices.some((notice) => notice.runId === 'run-incomplete-terminal')).toBe(false)
  })
})
