import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DelegationRuntime } from '../../src/main/ai/delegation-runtime'
import * as agentLoop from '../../src/main/ai/agent-loop'
import type { RunAgentLoopResult } from '../../src/main/ai/agent-loop'
import { createDelegationToolEntries } from '../../src/main/ai/tools/delegation'
import { defaultSettings } from '../../src/main/teaching-settings'
import { AgentRunResourceBoundaryError, AgentRunResourceGovernor } from '../../src/main/ai/agent-run-resource-governance'

const originalFetch = globalThis.fetch
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function sseResponse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function childLoopResult(stopReason: 'resource_limit' | 'suspended' | 'final_answer'): RunAgentLoopResult {
  return {
    messages: [{ role: 'user', content: 'child task' }],
    finalText: stopReason === 'final_answer' ? 'child completed' : '',
    iterations: 1,
    toolsSupported: true,
    stopReason,
    usage: {
      providerCalls: 0,
      toolCalls: 0,
      toolErrors: 0,
      iterations: 1,
      operationAccounting: {
        logicalRequests: 0,
        providerTransportAttempts: 0,
        transportRetries: 0,
        overflowRecoveries: 0,
        compactionOperations: 0,
        compactionSummaryAttempts: 0,
        toolOperationAttempts: 0
      }
    }
  }
}

describe('DelegationRuntime continuous finalization', () => {
  it('does not expose a child loop-iteration quota in delegation schemas', () => {
    const settings = defaultSettings('C:/workspace')
    const provider = settings.provider.providers[0]!
    const definitions = createDelegationToolEntries({ provider }).map((entry) => entry.definition.function)
    const propertiesFor = (name: string): Record<string, unknown> => {
      const definition = definitions.find((entry) => entry.name === name)
      const parameters = definition?.parameters
      return parameters && typeof parameters === 'object'
        ? ((parameters as { properties?: Record<string, unknown> }).properties ?? {})
        : {}
    }

    expect(propertiesFor('delegate_task')).not.toHaveProperty('maxIterations')
    expect(propertiesFor('read_only_task')).not.toHaveProperty('maxIterations')
    const parallelTasks = propertiesFor('parallel_tasks').tasks as { items?: { properties?: Record<string, unknown> } }
    expect(parallelTasks.items?.properties).not.toHaveProperty('maxIterations')
  })

  it('continues after a child tool round and returns the final research summary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-child-finalize-'))
    roots.push(root)
    await writeFile(join(root, 'MISSION.md'), '# Mission\nLearn memory systems.\n', 'utf8')
    const settings = defaultSettings(root)
    settings.generator.endpointFormat = 'chat_completions'
    settings.generator.requestTimeoutMs = 100
    const provider = {
      ...settings.provider.providers[0]!,
      baseUrl: 'https://provider.example/v1',
      endpointFormat: 'chat_completions' as const,
      apiKey: 'sk-fixture'
    }
    const responses = [
      sseResponse([{
        choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-list', type: 'function', function: { name: 'list_workspace', arguments: '{}' } }] } }]
      }]),
      sseResponse([{ choices: [{ delta: { content: '已读取工作区；可确认当前任务是学习记忆系统。其余来源尚未验证。' } }] }])
    ]
    globalThis.fetch = (async () => responses.shift()!) as typeof fetch

    const result = await new DelegationRuntime({ settings, provider, workspaceRoot: root }).runChild({
      label: '检查工作区',
      prompt: '读取工作区并总结任务。',
      profile: 'workspace_audit'
    })

    expect(result.status).toBe('completed')
    expect(result.summary).toContain('其余来源尚未验证')
    expect(result.usage).toMatchObject({ providerCalls: 2, toolCalls: 1 })
    expect(responses).toHaveLength(0)
  })


  it('charges child operations to the parent host ledger and fails the next child at the shared boundary', async () => {
    const settings = defaultSettings('C:/workspace')
    const provider = settings.provider.providers[0]!
    const parentGovernor = new AgentRunResourceGovernor({
      governance: {
        userBudget: {
          limits: [{ meter: 'provider_transport_attempts', limit: 1, scope: 'run', auditId: 'shared-provider-attempts' }]
        }
      }
    })
    const seenGovernorHandles: Array<NonNullable<Parameters<typeof agentLoop.runAgentLoop>[0]['resourceGovernor']>> = []
    const calls: string[] = []
    vi.spyOn(agentLoop, 'runAgentLoop').mockImplementation(async (options) => {
      calls.push(options.runId ?? '')
      const childGovernor = options.resourceGovernor
      if (!childGovernor) throw new Error('child resource governor was not inherited')
      seenGovernorHandles.push(childGovernor)
      try {
        childGovernor.claim('provider_transport_attempts')
      } catch (error) {
        if (!(error instanceof AgentRunResourceBoundaryError)) throw error
        return childLoopResult(childGovernor.boundary?.action === 'suspended' ? 'suspended' : 'resource_limit')
      }
      return childLoopResult('final_answer')
    })

    try {
      const runtime = new DelegationRuntime({ settings, provider, resourceGovernor: parentGovernor })
      const results = await runtime.runChildren({
        tasks: [
          { label: '第一个子任务', prompt: '执行第一个窄任务。' },
          { label: '第二个子任务', prompt: '执行第二个窄任务。' }
        ],
        concurrency: 1
      })

      expect(calls).toHaveLength(2)
      expect(seenGovernorHandles[0]).not.toBe(seenGovernorHandles[1])
      expect(results.results[0]).toMatchObject({ status: 'completed' })
      expect(results.results[1]).toMatchObject({ status: 'failed', stopReason: 'resource_limit' })
      expect(runtime.listRuns()).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'failed', stopReason: 'resource_limit' })
      ]))
      expect(parentGovernor.audit().terminal).toMatchObject({
        layer: 'user_budget',
        meter: 'provider_transport_attempts',
        used: 1,
        limit: 1,
        action: 'resource_limit',
        auditId: 'shared-provider-attempts'
      })
    } finally {
      parentGovernor.dispose()
    }
  })

  it('propagates a parent terminal to queued children without starting them or emitting success', async () => {
    const settings = defaultSettings('C:/workspace')
    const provider = settings.provider.providers[0]!
    const parentGovernor = new AgentRunResourceGovernor({
      governance: {
        userBudget: {
          limits: [{ meter: 'total_tokens', limit: 1, scope: 'run', auditId: 'shared-total-tokens' }]
        }
      }
    })
    const events: Array<{ type: string; child?: { status?: string; stopReason?: string } }> = []
    const runIds: string[] = []
    vi.spyOn(agentLoop, 'runAgentLoop').mockImplementation(async (options) => {
      runIds.push(options.runId ?? '')
      const childGovernor = options.resourceGovernor
      if (!childGovernor) throw new Error('child resource governor was not inherited')
      childGovernor.consume('total_tokens', 1)
      return childLoopResult(childGovernor.boundary?.action === 'suspended' ? 'suspended' : 'resource_limit')
    })

    try {
      const runtime = new DelegationRuntime({ settings, provider, resourceGovernor: parentGovernor })
      const results = await runtime.runChildren({
        tasks: [
          { label: '耗尽资源的子任务', prompt: '消耗共享资源。' },
          { label: '排队中的子任务', prompt: '不应启动。' }
        ],
        concurrency: 1
      }, { emit: (event) => events.push({ type: event.type, child: event.child && { status: event.child.status, stopReason: event.child.stopReason } }) })

      expect(runIds).toHaveLength(1)
      expect(results.results).toHaveLength(2)
      expect(results.results[0]).toMatchObject({ status: 'failed', stopReason: 'resource_limit' })
      expect(results.results[1]).toMatchObject({ status: 'failed', stopReason: 'resource_limit' })
      expect(events.filter((event) => event.type === 'child_run_started')).toHaveLength(1)
      expect(events.some((event) => event.type === 'child_run_completed')).toBe(false)
      expect(events.filter((event) => event.type === 'child_run_failed')).toHaveLength(2)
      expect(runtime.listRuns()).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'failed', stopReason: 'resource_limit' })
      ]))
    } finally {
      parentGovernor.dispose()
    }
  })

  it.each(['resource_limit', 'suspended'] as const)(
    'records child %s as a failed resource terminal rather than a completed task',
    async (stopReason) => {
      const settings = defaultSettings('C:/workspace')
      const provider = settings.provider.providers[0]!
      const events: Array<{ type: string; child?: { stopReason?: string } }> = []
      const transcripts: string[] = []
      const loopResult: RunAgentLoopResult = {
        messages: [{ role: 'user', content: 'child task' }],
        finalText: '',
        iterations: 1,
        toolsSupported: true,
        stopReason,
        usage: {
          providerCalls: 0,
          toolCalls: 0,
          toolErrors: 0,
          iterations: 1,
          operationAccounting: {
            logicalRequests: 1,
            providerTransportAttempts: 0,
            transportRetries: 0,
            overflowRecoveries: 0,
            compactionOperations: 0,
            compactionSummaryAttempts: 0,
            toolOperationAttempts: 0
          }
        }
      }
      vi.spyOn(agentLoop, 'runAgentLoop').mockResolvedValueOnce(loopResult)

      const runtime = new DelegationRuntime({
        settings,
        provider,
        stageTranscript: async (_childRunId, transcript) => {
          transcripts.push(transcript)
          return {
            kind: 'child_transcript',
            relativePath: '.agent-sessions/child-transcripts/test.json',
            sha256: 'a'.repeat(64),
            bytes: transcript.length
          }
        }
      })
      const result = await runtime.runChild(
        { label: '受治理的子任务', prompt: '执行一个窄任务。' },
        { emit: (event) => events.push(event) }
      )

      expect(result).toMatchObject({
        status: 'failed',
        stopReason,
        error: stopReason
      })
      expect(runtime.listRuns()[0]).toMatchObject({ status: 'failed', stopReason })
      expect(events.some((event) => event.type === 'child_run_completed')).toBe(false)
      expect(events.find((event) => event.type === 'child_run_failed')).toMatchObject({
        child: { status: 'failed', stopReason }
      })
      expect(transcripts).toHaveLength(1)
      expect(transcripts[0]).toContain(`"stopReason": "${stopReason}"`)
    }
  )

})
