import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { saveAgentConversationArchive } from '../../src/main/agent-conversation-archive'
import { AgentRunStore } from '../../src/main/ai/agent-run-store'
import { agentParentTurnDigest, attachAgentParentTurnCommit, hasAgentParentTurnCommit, readRawAgentConversationRecord } from '../../src/main/teaching-agent-conversations'
import {
  OMITTED_SENSITIVE_USER_INPUT,
  SAFE_PERSISTED_CONVERSATION_TITLE,
  createPersistedUserHistorySanitizer,
  persistedAgentParentTurnProof,
  sanitizePersistedAgentConversationRecord,
  sanitizePersistedConversationTitle,
  sanitizePersistedUserHistory
} from '../../src/shared/agent-persisted-history'
import type { AgentConversationRecord } from '../../src/shared/teaching-types'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'studiumx-persisted-history-'))
  roots.push(value)
  return value
}

async function readTree(path: string): Promise<string> {
  const entries = await readdir(path, { withFileTypes: true })
  const values = await Promise.all(entries.map(async (entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? readTree(child) : readFile(child, 'utf8')
  }))
  return values.join('\n')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('persisted user-history sanitizer', () => {
  it('preserves mixed useful context, omits secret-only values, and safely derives titles', () => {
    const apiKey = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'
    const genericSecret = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const mixed = sanitizePersistedUserHistory(`Explain OAuth scopes; credential ${genericSecret} is failing`)
    expect(mixed.text).not.toContain(genericSecret)
    expect(mixed).toMatchObject({ kind: 'redacted', redacted: true })
    expect(mixed.text).toContain('Explain OAuth scopes')
    expect(mixed.text).not.toContain(apiKey)

    for (const secret of [
      apiKey,
      genericSecret,
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturevalue',
      'hf_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      '-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----'
    ]) {
      const result = sanitizePersistedUserHistory(secret)
      expect(result.kind).toBe('omitted')
      expect(result.text).toBe(OMITTED_SENSITIVE_USER_INPUT)
      expect(result.text).not.toContain(secret)
    }

    expect(sanitizePersistedConversationTitle(`OPENAI_API_KEY=${apiKey}`)).toBe(SAFE_PERSISTED_CONVERSATION_TITLE)
    expect(sanitizePersistedConversationTitle(`OAuth review ${apiKey}`)).toContain('OAuth review')
  })

  it('fails closed without placing input or sanitizer diagnostics in its result', () => {
    const secret = 'do-not-persist-this-secret'
    const sanitizer = createPersistedUserHistorySanitizer(() => {
      throw new Error(`redactor failed for ${secret}`)
    })
    const result = sanitizer(secret)
    expect(result).toEqual({ kind: 'omitted', text: OMITTED_SENSITIVE_USER_INPUT, reason: 'sanitizer_failed' })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('keeps the legacy digest export and attach argument source-compatible without restoring an oracle', () => {
    const firstSecret = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const secondSecret = 'M4bY8rP1wK6nD3tV9xH2qL7sF5aJ0cG8zU1eR6m'
    const firstTurns = [
      { id: 'user-1', role: 'user' as const, content: `First candidate ${firstSecret}`, createdAt: '2026-07-18T01:00:00.000Z' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'Safe answer.', createdAt: '2026-07-18T01:01:00.000Z' }
    ]
    const secondTurns = [
      { ...firstTurns[0], content: `Second candidate ${secondSecret}` },
      firstTurns[1]
    ]
    const legacyDigest = agentParentTurnDigest(firstTurns)

    // The retained API intentionally has no input-dependent result, so it
    // cannot act as a candidate-secret equality oracle.
    expect(legacyDigest).toBe(agentParentTurnDigest(secondTurns))
    expect(legacyDigest).not.toContain(firstSecret)
    expect(legacyDigest).not.toContain(secondSecret)

    const committed = attachAgentParentTurnCommit([
      firstTurns[0],
      { ...firstTurns[1], metadata: { version: 1, parentTurnDigest: firstSecret } }
    ], 'run-legacy-api', legacyDigest)
    expect(committed[1]!.metadata).toMatchObject({ runId: 'run-legacy-api' })
    expect(committed[1]!.metadata?.parentTurnDigest).toBeUndefined()
    expect(committed[1]!.metadata?.parentTurnProof).toBeUndefined()
    expect(JSON.stringify(committed[1]!.metadata)).not.toContain(firstSecret)
    expect(hasAgentParentTurnCommit(committed, 'run-legacy-api', legacyDigest)).toBe(false)

    const persisted = sanitizePersistedAgentConversationRecord({ ...recordFor('safe'), turns: committed })
    const proof = persisted.turns[1]!.metadata!.parentTurnProof!.digest
    expect(JSON.stringify(persisted)).not.toContain('parentTurnDigest')
    expect(hasAgentParentTurnCommit(persisted.turns, 'run-legacy-api', legacyDigest)).toBe(false)
    expect(hasAgentParentTurnCommit(persisted.turns, 'run-legacy-api', proof)).toBe(true)
  })

  it('uses a canonical sanitized parent-turn proof and rejects tampering or legacy raw-digest fallback', () => {
    const genericSecret = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const rawTurns = attachAgentParentTurnCommit([
      { id: 'user-1', role: 'user', content: `OAuth help with credential ${genericSecret}`, createdAt: '2026-07-18T01:00:00.000Z' },
      {
        id: 'assistant-1', role: 'assistant', content: `Use delegated authorization; never echo ${genericSecret}.`, createdAt: '2026-07-18T01:01:00.000Z',
        metadata: { version: 1, provenance: { kind: 'original', sourceConversationId: 'source-a' } }
      }
    ], 'run-1')
    const persisted = sanitizePersistedAgentConversationRecord({ ...recordFor('safe'), turns: rawTurns })
    const proof = persisted.turns[1]!.metadata!.parentTurnProof!.digest

    expect(proof).toBe(persistedAgentParentTurnProof(persisted.turns).digest)
    expect(hasAgentParentTurnCommit(persisted.turns, 'run-1', proof)).toBe(true)
    expect(JSON.stringify(persisted)).not.toContain(genericSecret)
    expect(JSON.stringify(persisted)).not.toContain('parentTurnDigest')
    expect(hasAgentParentTurnCommit([
      persisted.turns[0]!, { ...persisted.turns[1]!, content: 'tampered' }
    ], 'run-1', proof)).toBe(false)
    expect(hasAgentParentTurnCommit([
      persisted.turns[1]!, persisted.turns[0]!
    ], 'run-1', proof)).toBe(false)
    expect(hasAgentParentTurnCommit([
      persisted.turns[0]!, {
        ...persisted.turns[1]!,
        metadata: { ...persisted.turns[1]!.metadata!, provenance: { kind: 'original', sourceConversationId: 'source-b' } }
      }
    ], 'run-1', proof)).toBe(false)

    const legacyRawDigest = createHash('sha256').update(genericSecret, 'utf8').digest('hex')
    const legacyOnly = [{
      ...persisted.turns[1]!,
      metadata: { version: 1 as const, runId: 'run-legacy', parentTurnDigest: legacyRawDigest }
    }]
    expect(hasAgentParentTurnCommit(legacyOnly, 'run-legacy', legacyRawDigest)).toBe(false)
  })

  it.each([
    ['large tool-result archival', (record: AgentConversationRecord) => {
      record.turns[1] = {
        ...record.turns[1]!,
        toolCalls: [{ id: 'tool-large', name: 'lookup', arguments: '{\"query\":\"OAuth\"}', result: 'tool result\n'.repeat(260) }]
      }
    }],
    ['child-transcript reference promotion', (record: AgentConversationRecord) => {
      record.turns[1] = {
        ...record.turns[1]!,
        metadata: {
          version: 1,
          childRuns: [{
            childRunId: 'child-promoted', label: 'Research child', profile: 'research', status: 'completed',
            summary: 'Completed.'
          } as any & { transcript: string }]
        }
      }
      ;((record.turns[1]!.metadata!.childRuns![0] as any).transcript = 'child transcript\n'.repeat(32))
    }]
  ])('rebinds recovery proof after %s and verifies the unhydrated canonical record', async (_label, promote) => {
    const rootPath = await root()
    const runId = `run-${_label.replace(/[^a-z]+/gi, '-').toLowerCase()}`
    const record = recordFor('Please save this answer.')
    record.id = `conversation-${runId}`
    record.relativePath = `conversations/${record.id}.md`
    record.absolutePath = join(rootPath, record.relativePath)
    promote(record)

    const store = new AgentRunStore(rootPath, () => '2026-07-18T01:05:00.000Z')
    await store.create({
      runId,
      streamId: runId,
      workspaceId: 'workspace-1',
      parentTurn: { userInput: record.turns[0]!.content }
    })
    await store.confirmParentTurnFinal(runId, record.turns[1]!.content)
    record.turns = attachAgentParentTurnCommit(record.turns, runId)

    let stagedProof = ''
    let archivedCanonicalRecord: AgentConversationRecord | undefined
    await expect(saveAgentConversationArchive({
      workspace: { id: 'workspace-1', name: 'Workspace', rootPath },
      record,
      beforeCanonicalSave: async (canonicalRecord) => {
        archivedCanonicalRecord = canonicalRecord
        stagedProof = persistedAgentParentTurnProof(canonicalRecord.turns).digest
        await store.prepareParentTurnSave(runId, canonicalRecord.id, stagedProof)
      }
    })).resolves.toBeUndefined()
    expect(archivedCanonicalRecord).toBeDefined()
    expect(stagedProof).toBe(archivedCanonicalRecord!.turns[1]!.metadata!.parentTurnProof!.digest)

    const canonical = await readRawAgentConversationRecord(rootPath, archivedCanonicalRecord!.id)
    expect(hasAgentParentTurnCommit(canonical.turns, runId, stagedProof)).toBe(true)
    if (_label === 'large tool-result archival') {
      expect(canonical.turns[1]!.toolCalls?.[0]?.result).toMatch(/^\[tool result archived\]/)
      expect(canonical.turns[1]!.metadata?.toolResults?.[0]?.archive?.kind).toBe('tool_result')
    } else {
      const child = canonical.turns[1]!.metadata?.childRuns?.[0] as any
      expect(child?.archive?.kind).toBe('child_transcript')
      expect(child?.archive?.relativePath).not.toMatch(/^\.agent-sessions\//)
      expect(child?.transcript).toBeUndefined()
    }

    const recovered = await new AgentRunStore(rootPath, () => '2026-07-18T01:06:00.000Z').reconcileInterrupted(async (stage) => {
      const stored = await readRawAgentConversationRecord(rootPath, stage.targetConversationId!)
      return Boolean(stage.expectedParentTurnProof && hasAgentParentTurnCommit(stored.turns, stage.runId, stage.expectedParentTurnProof))
    })
    expect(recovered.some((item) => item.runId === runId)).toBe(false)
    expect((await store.readParentTurnStage(runId)).status).toBe('settled')

    expect(hasAgentParentTurnCommit(canonical.turns.map((turn) => turn.role === 'assistant'
      ? { ...turn, content: 'tampered assistant' }
      : turn), runId, stagedProof)).toBe(false)
    expect(hasAgentParentTurnCommit([...canonical.turns].reverse(), runId, stagedProof)).toBe(false)
    expect(hasAgentParentTurnCommit(canonical.turns.map((turn) => turn.role === 'assistant'
      ? { ...turn, metadata: { ...turn.metadata!, runUsage: { providerCalls: 99, toolCalls: 0, toolErrors: 0, iterations: 0, childRuns: 0 } } }
      : turn), runId, stagedProof)).toBe(false)
  })

  it('does not serialize a raw-digest candidate-secret equality oracle', () => {
    const first = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const second = 'M4bY8rP1wK6nD3tV9xH2qL7sF5aJ0cG8zU1eR6m'
    const make = (secret: string) => sanitizePersistedAgentConversationRecord({
      ...recordFor('safe'),
      turns: attachAgentParentTurnCommit([
        { id: 'user-1', role: 'user', content: `Mixed prose secret ${secret} must not persist.`, createdAt: '2026-07-18T01:00:00.000Z' },
        { id: 'assistant-1', role: 'assistant', content: 'Safe answer.', createdAt: '2026-07-18T01:01:00.000Z' }
      ], 'run-oracle')
    })
    const firstPersisted = make(first)
    const secondPersisted = make(second)
    const durable = JSON.stringify(firstPersisted)

    expect(durable).toBe(JSON.stringify(secondPersisted))
    expect(durable).not.toContain(first)
    expect(durable).not.toContain(createHash('sha256').update(first, 'utf8').digest('hex'))
    expect(durable).not.toContain(createHash('sha256').update(second, 'utf8').digest('hex'))
  })

  it('preserves ordinary multi-turn content, order, identities, and message count', () => {
    const record = recordFor('What is OAuth?')
    record.turns = [
      record.turns[0]!,
      { id: 'turn-2', role: 'assistant', content: 'OAuth delegates access.', createdAt: '2026-07-18T01:01:00.000Z' },
      { id: 'turn-3', role: 'user', content: 'What about scopes?', createdAt: '2026-07-18T01:02:00.000Z' },
      { id: 'turn-4', role: 'assistant', content: 'Scopes limit delegated permissions.', createdAt: '2026-07-18T01:03:00.000Z' }
    ]
    record.messageCount = 4
    const persisted = sanitizePersistedAgentConversationRecord(record)
    expect(persisted.turns).toEqual(record.turns)
    expect(persisted.messageCount).toBe(4)
  })

  it('keeps turn identity and message-count invariants for omitted user content', () => {
    const record = recordFor('xoxb-123456789012-123456789012-abcdefghijklmno')
    const sanitized = sanitizePersistedAgentConversationRecord(record)
    expect(sanitized).not.toBe(record)
    expect(sanitized.messageCount).toBe(record.messageCount)
    expect(sanitized.turns[0]).toMatchObject({ id: record.turns[0]!.id, role: 'user', createdAt: record.turns[0]!.createdAt })
    expect(sanitized.turns[0]!.content).toBe(OMITTED_SENSITIVE_USER_INPUT)
  })

  it('keeps new archive JSON, Markdown, audit, ledger, and artifact sinks free of fixture secrets', async () => {
    const rootPath = await root()
    const secrets = {
      api: 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      bearer: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturevalue',
      provider: 'hf_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      privateKey: 'private-key-material',
      generic: 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    }
    const record = recordFor(`Please explain OAuth; unknown credential ${secrets.generic}`)
    record.title = `OAuth notes OPENAI_API_KEY=${secrets.api}`
    record.turns[1]!.content = `Authorization: Bearer ${secrets.bearer}; assistant echo ${secrets.generic}`
    record.turns.push(
      { id: 'turn-3', role: 'user', content: secrets.provider, createdAt: '2026-07-18T01:02:00.000Z' },
      {
        id: 'turn-4',
        role: 'assistant',
        content: `-----BEGIN PRIVATE KEY-----\n${secrets.privateKey}\n-----END PRIVATE KEY-----`,
        createdAt: '2026-07-18T01:03:00.000Z',
        toolCalls: [{
          id: 'tool-1',
          name: 'lookup',
          arguments: `{"token":"${secrets.generic}"}`,
          result: `unknown credential ${secrets.generic}\n${'x'.repeat(2400)}`
        }]
      }
    )
    record.messageCount = 4

    await saveAgentConversationArchive({
      workspace: { id: 'workspace-1', name: 'Workspace', rootPath },
      record
    })

    const persisted = await readTree(rootPath)
    for (const secret of Object.values(secrets)) expect(persisted).not.toContain(secret)
    expect(persisted).toContain('Please explain OAuth')
    expect(persisted).toContain(OMITTED_SENSITIVE_USER_INPUT)
    expect(persisted).toContain('OAuth notes')
  })

  it('preserves complete durable resource audit facts and drops malformed resource records without coercion', async () => {
    const rootPath = await root()
    await mkdir(join(rootPath, 'conversation'), { recursive: true })
    const id = 'chat-20260805-resource-governance'
    await writeFile(join(rootPath, 'conversation', `${id}.json`), `${JSON.stringify({
      id,
      title: 'Resource governance parser',
      createdAt: '2026-08-05T00:00:00.000Z',
      updatedAt: '2026-08-05T00:00:02.000Z',
      relativePath: `conversation/${id}.md`,
      messageCount: 4,
      turns: [
        { id: 'u1', role: 'user', content: 'Continue safely', createdAt: '2026-08-05T00:00:00.000Z' },
        {
          id: 'a1', role: 'assistant', content: 'Paused safely', createdAt: '2026-08-05T00:00:01.000Z',
          metadata: {
            version: 1,
            childRuns: [{
              childRunId: 'child-resource-limit',
              label: 'Budgeted research',
              profile: 'research',
              status: 'failed',
              stopReason: 'resource_limit',
              error: 'resource_limit'
            }],
            runUsage: {
              providerCalls: 3, toolCalls: 2, toolErrors: 1, iterations: 3, childRuns: 0, durationMs: 1_200,
              operationAccounting: {
                logicalRequests: 3,
                providerTransportAttempts: 4,
                transportRetries: 1,
                overflowRecoveries: 1,
                compactionOperations: 2,
                compactionSummaryAttempts: 2,
                toolOperationAttempts: 2
              },
              resourceGovernance: {
                configured: [
                  { layer: 'user_budget', meter: 'total_tokens', limit: 8_000, scope: 'task', auditId: 'lesson-budget' },
                  { layer: 'emergency_fuse', meter: 'duration_ms', limit: 86_400_000, scope: 'run', auditId: 'host-emergency-duration' }
                ],
                terminal: {
                  layer: 'user_budget', meter: 'total_tokens', used: 8_000, limit: 8_000, scope: 'task',
                  auditId: 'lesson-budget', action: 'resource_limit'
                }
              }
            }
          }
        },
        { id: 'u2', role: 'user', content: 'Record malformed audit facts safely', createdAt: '2026-08-05T00:00:02.000Z' },
        {
          id: 'a2', role: 'assistant', content: 'Invalid audit input', createdAt: '2026-08-05T00:00:03.000Z',
          metadata: {
            version: 1,
            childRuns: [{
              childRunId: 'child-malformed-terminal',
              label: 'Malformed terminal',
              profile: 'research',
              status: 'failed',
              stopReason: 'done'
            }],
            runUsage: {
              providerCalls: 1,
              toolCalls: 0,
              operationAccounting: {
                logicalRequests: '1',
                providerTransportAttempts: 1,
                transportRetries: 0,
                overflowRecoveries: 0,
                compactionOperations: 0,
                compactionSummaryAttempts: 0,
                toolOperationAttempts: 0
              },
              resourceGovernance: {
                configured: [{ layer: 'user_budget', meter: 'total_tokens', limit: '8000', scope: 'task' }],
                terminal: {
                  layer: 'user_budget', meter: 'total_tokens', used: -1, limit: 8_000, scope: 'task', action: 'resource_limit'
                }
              }
            }
          }
        }
      ]
    }, null, 2)}\n`)

    const persisted = await readRawAgentConversationRecord(rootPath, id)
    const validChild = persisted.turns[1]!.metadata!.childRuns![0]
    expect(validChild).toMatchObject({
      childRunId: 'child-resource-limit',
      status: 'failed',
      stopReason: 'resource_limit',
      error: 'resource_limit'
    })
    const validUsage = persisted.turns[1]!.metadata!.runUsage!
    expect(validUsage.operationAccounting).toEqual({
      logicalRequests: 3,
      providerTransportAttempts: 4,
      transportRetries: 1,
      overflowRecoveries: 1,
      compactionOperations: 2,
      compactionSummaryAttempts: 2,
      toolOperationAttempts: 2
    })
    expect(validUsage.resourceGovernance).toEqual({
      configured: [
        { layer: 'user_budget', meter: 'total_tokens', limit: 8_000, scope: 'task', auditId: 'lesson-budget' },
        { layer: 'emergency_fuse', meter: 'duration_ms', limit: 86_400_000, scope: 'run', auditId: 'host-emergency-duration' }
      ],
      terminal: {
        layer: 'user_budget', meter: 'total_tokens', used: 8_000, limit: 8_000, scope: 'task',
        auditId: 'lesson-budget', action: 'resource_limit'
      }
    })

    const malformedChild = persisted.turns[3]!.metadata!.childRuns![0]
    expect(malformedChild).toMatchObject({ childRunId: 'child-malformed-terminal', status: 'failed' })
    expect(malformedChild.stopReason).toBeUndefined()
    const malformedUsage = persisted.turns[3]!.metadata!.runUsage!
    expect(malformedUsage).toMatchObject({ providerCalls: 1, toolCalls: 0 })
    expect(malformedUsage.operationAccounting).toBeUndefined()
    expect(malformedUsage.resourceGovernance).toBeUndefined()
  })
})

function recordFor(userContent: string): AgentConversationRecord {
  return {
    id: 'conversation-1',
    workspaceId: 'workspace-1',
    title: 'Conversation',
    createdAt: '2026-07-18T01:00:00.000Z',
    updatedAt: '2026-07-18T01:01:00.000Z',
    relativePath: 'conversation/conversation-1.md',
    absolutePath: '/unused/conversation/conversation-1.md',
    messageCount: 2,
    turns: [
      { id: 'turn-1', role: 'user', content: userContent, createdAt: '2026-07-18T01:00:00.000Z' },
      { id: 'turn-2', role: 'assistant', content: 'OAuth uses delegated authorization.', createdAt: '2026-07-18T01:01:00.000Z' }
    ]
  }
}
