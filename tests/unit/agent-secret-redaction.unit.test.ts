import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  appendAgentConversationSessionAuditLog,
  archiveAgentConversationArtifacts
} from '../../src/main/agent-conversation-session-audit'
import { AgentParentTurnStaging } from '../../src/main/ai/agent-parent-turn-staging'
import { AgentRunPersistence } from '../../src/main/ai/agent-run-persistence'
import { redactAgentSecretText } from '../../src/shared/agent-secret-redaction'
import type {
  AgentChildRunMetadata,
  AgentConversationRecord
} from '../../src/shared/teaching-types'

const createdRoots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-secret-redaction-'))
  createdRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('agent secret redaction', () => {
  it('redacts provider credentials and durable-agent secret formats without changing ordinary text', () => {
    const githubToken = `ghp_${'a'.repeat(36)}`
    const genericToken = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const genericBase64Token = 'Q2FuZGlkYXRlQjY0L1NlY3JldCtXaXRoRW50cm9weT0='
    const githubFineGrainedToken = `github_pat_${'b'.repeat(30)}_${'c'.repeat(20)}`
    const input = [
      'Keep this ordinary explanation and file path notes/token-guide.md.',
      `Mixed prose unknown credential ${genericToken} must not persist.`,
      `Mixed prose Base64 credential ${genericBase64Token} must not persist.`,
      'Authorization: Bearer bearer-secret-value',
      'Bearer standalone-bearer-secret-value',
      'OPENAI_API_KEY=sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      'hf_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      'password=hunter2',
      '"passphrase": "correct horse battery staple"',
      'client_secret=client-secret-value',
      'refresh-token: refresh-secret-value',
      'session_token=session-secret-value',
      'access token = access-secret-value',
      'PRIVATE-TOKEN: private-secret-value',
      'https://example.test/callback?client_secret=url-secret&next=lesson',
      githubToken,
      genericToken,
      genericBase64Token,
      githubFineGrainedToken,
      '-----BEGIN PRIVATE KEY-----',
      'sensitive-private-key-material',
      '-----END PRIVATE KEY-----'
    ].join('\n')

    const redacted = redactAgentSecretText(input)

    expect(redacted).toContain('Keep this ordinary explanation and file path notes/token-guide.md.')
    expect(redacted).toContain('next=lesson')
    expect(redacted).toContain('[redacted]')
    for (const secret of [
      'bearer-secret-value',
      'standalone-bearer-secret-value',
      'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      'hf_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      'hunter2',
      'correct horse battery staple',
      'client-secret-value',
      'refresh-secret-value',
      'session-secret-value',
      'access-secret-value',
      'private-secret-value',
      'url-secret',
      githubToken,
      githubFineGrainedToken,
      genericToken,
      genericBase64Token,
      'sensitive-private-key-material'
    ]) {
      expect(redacted).not.toContain(secret)
    }
    expect(redactAgentSecretText(redacted)).toBe(redacted)
  })

  it('redacts durable conversation artifacts and audit metadata', async () => {
    const root = await createRoot()
    const genericToken = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const largeToolSecret = 'archived-tool-secret'
    const childTranscriptSecret = 'child-transcript-secret'
    const childRun = {
      childRunId: 'child-1',
      label: 'Research helper',
      profile: 'research',
      status: 'completed',
      summary: `mixed child summary ${genericToken}`,
      error: `mixed child error ${genericToken}`,
      citations: [{ sourceId: 'citation-1', url: 'https://example.test/cite?token=citation-url-secret', title: 'password=citation-title-secret' }],
      transcript: `Child transcript ${genericToken} session_token=${childTranscriptSecret}`,
      startedAt: '2026-07-14T10:00:00.000Z',
      completedAt: '2026-07-14T10:00:01.000Z'
    } satisfies AgentChildRunMetadata & { transcript: string }
    const record: AgentConversationRecord = {
      id: 'conversation-1',
      workspaceId: 'workspace-1',
      title: 'Secret redaction test',
      createdAt: '2026-07-14T10:00:00.000Z',
      updatedAt: '2026-07-14T10:00:02.000Z',
      relativePath: 'conversation/conversation-1.md',
      absolutePath: join(root, 'conversation', 'conversation-1.md'),
      messageCount: 1,
      turns: [{
        id: 'turn-1',
        role: 'assistant',
        content: `Authoritative turn unknown credential ${genericToken} password=authoritative-turn-secret`,
        createdAt: '2026-07-14T10:00:00.000Z',
        toolCalls: [
          {
            id: 'tool-small',
            name: 'lookup',
            arguments: `{"unknown":"${genericToken}","password":"tool-argument-secret","query":"safe"}`,
            result: `mixed tool result ${genericToken} password=inline-result-secret safe-result`
          },
          {
            id: 'tool-large',
            name: 'fetch',
            arguments: 'https://example.test/data?access_token=large-argument-secret',
            result: `mixed large result ${genericToken} client_secret=${largeToolSecret}\n${'x'.repeat(2400)}`
          }
        ],
        processEvents: [{
          id: 'event-1',
          kind: 'status',
          title: `mixed process title ${genericToken} password=process-title-secret`,
          detail: `mixed process detail ${genericToken} refresh_token=process-detail-secret`,
          createdAt: '2026-07-14T10:00:00.500Z'
        }],
        metadata: {
          version: 1,
          sources: [{
            sourceId: 'source-1',
            url: 'https://example.test/source?session_token=source-url-secret&view=full',
            title: 'password=source-title-secret',
            snippet: 'private_token=source-snippet-secret'
          }],
          childRuns: [childRun]
        }
      }]
    }

    const archived = await archiveAgentConversationArtifacts({
      rootPath: root,
      record,
      now: '2026-07-14T10:00:03.000Z'
    })
    const turn = archived.turns[0]
    const smallTool = turn.toolCalls?.[0]
    const largeTool = turn.toolCalls?.[1]
    const source = turn.metadata?.sources?.[0]
    const persistedChild = turn.metadata?.childRuns?.[0] as (AgentChildRunMetadata & { transcript?: string }) | undefined

    expect(turn.content).not.toContain('authoritative-turn-secret')
    expect(smallTool?.arguments).not.toContain('tool-argument-secret')
    expect(smallTool?.result).not.toContain('inline-result-secret')
    expect(largeTool?.arguments).not.toContain('large-argument-secret')
    expect(largeTool?.result).toContain('[tool result archived]')
    expect(turn.processEvents?.[0].title).not.toContain('process-title-secret')
    expect(turn.processEvents?.[0].detail).not.toContain('process-detail-secret')
    expect(source?.url).not.toContain('source-url-secret')
    expect(source?.url).toContain('view=full')
    expect(source?.title).not.toContain('source-title-secret')
    expect(source?.snippet).not.toContain('source-snippet-secret')
    expect(persistedChild?.summary).not.toContain('child-summary-secret')
    expect(persistedChild?.error).not.toContain('child-error-secret')
    expect(persistedChild?.citations?.[0].url).not.toContain('citation-url-secret')
    expect(persistedChild?.citations?.[0].title).not.toContain('citation-title-secret')
    expect(persistedChild?.transcript).toBeUndefined()

    const toolArtifact = turn.metadata?.toolResults?.find((item) => item.toolCallId === 'tool-large')?.archive
    const childArtifact = persistedChild?.archive
    expect(toolArtifact).toBeDefined()
    expect(childArtifact).toBeDefined()
    const persistedToolResult = await readFile(join(root, toolArtifact!.relativePath), 'utf8')
    const persistedChildTranscript = await readFile(join(root, childArtifact!.relativePath), 'utf8')
    expect(persistedToolResult).not.toContain(largeToolSecret)
    expect(toolArtifact?.preview).not.toContain(largeToolSecret)
    expect(persistedChildTranscript).not.toContain(childTranscriptSecret)

    const auditRelativePath = await appendAgentConversationSessionAuditLog({ rootPath: root, record: archived })
    const audit = await readFile(join(root, auditRelativePath), 'utf8')
    for (const secret of [
      'authoritative-turn-secret',
      'tool-argument-secret',
      'inline-result-secret',
      largeToolSecret,
      'process-title-secret',
      'process-detail-secret',
      'source-url-secret',
      'source-title-secret',
      'source-snippet-secret',
      'child-summary-secret',
      'child-error-secret',
      'citation-url-secret',
      'citation-title-secret',
      childTranscriptSecret,
      genericToken
    ]) {
      expect(audit).not.toContain(secret)
    }
    expect(audit).toContain('[redacted]')
  })

  it('redacts run-scoped transcript, child-run, operation, and parent-turn staging text before disk writes', async () => {
    const root = await createRoot()
    const genericToken = 'C7aQ9vL2xM8kR4pT7nW3yH6dF1sJ5bG0zX9uK2e'
    const persistence = new AgentRunPersistence(root, () => '2026-07-14T11:00:00.000Z')
    const transcriptSecret = 'run-transcript-secret'
    const transcript = `Delegated result ${genericToken} password=${transcriptSecret}\nordinary transcript text`
    const archive = await persistence.stageChildTranscript('run-1', 'child-1', transcript)
    const persistedTranscript = await readFile(join(root, archive.relativePath), 'utf8')

    expect(persistedTranscript).not.toContain(transcriptSecret)
    expect(persistedTranscript).toContain('ordinary transcript text')
    expect(archive.sha256).toBe(createHash('sha256').update(persistedTranscript).digest('hex'))
    expect(archive.bytes).toBe(Buffer.byteLength(persistedTranscript, 'utf8'))

    await persistence.writeChildRun({
      version: 1,
      runId: 'run-1',
      childRunId: 'child-1',
      label: 'Research child',
      profile: 'research',
      status: 'failed',
      createdAt: '2026-07-14T11:00:00.000Z',
      updatedAt: '2026-07-14T11:00:00.000Z',
      summary: 'session_token=run-child-summary-secret',
      error: 'client_secret=run-child-error-secret'
    }, false)
    await persistence.writeOperation({
      version: 1,
      operationId: 'operation-1',
      runId: 'run-1',
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      state: 'completed',
      resultHash: 'a'.repeat(64),
      result: 'private_token=operation-result-secret ordinary result',
      disposition: 'first_execution',
      createdAt: '2026-07-14T11:00:00.000Z',
      updatedAt: '2026-07-14T11:00:00.000Z',
      completedAt: '2026-07-14T11:00:00.000Z',
      error: 'password=operation-error-secret'
    }, false)

    const staging = new AgentParentTurnStaging(persistence)
    const githubToken = `ghs_${'d'.repeat(36)}`
    await staging.createPersisted({
      runId: 'run-parent',
      streamId: 'stream-parent',
      userInput: `Please continue with ${githubToken}`
    })
    await staging.recordEvent('run-parent', {
      sequence: 1,
      streamId: 'stream-parent',
      kind: 'status',
      createdAt: '2026-07-14T11:00:01.000Z',
      payload: {
        streamId: 'stream-parent',
        status: 'thinking',
        message: `mixed event ${genericToken} refresh_token=parent-event-secret ordinary evidence`
      }
    })
    await staging.confirmFinal('run-parent', `mixed final ${genericToken} password=parent-final-secret ordinary final`)

    const childJson = await readFile(join(root, '.agent-sessions', 'child-runs', 'run-1', 'child-1.json'), 'utf8')
    const operationJson = await readFile(join(root, '.agent-sessions', 'operations', 'run-1', 'operation-1.json'), 'utf8')
    const parentStageJson = await readFile(join(root, '.agent-sessions', 'parent-turns', 'run-parent.json'), 'utf8')
    for (const [persisted, secrets] of [
      [childJson, ['run-child-summary-secret', 'run-child-error-secret']],
      [operationJson, ['operation-result-secret', 'operation-error-secret']],
      [parentStageJson, [githubToken, genericToken, 'parent-event-secret', 'parent-final-secret']]
    ] as const) {
      expect(persisted).toContain('[redacted]')
      for (const secret of secrets) expect(persisted).not.toContain(secret)
    }
    expect(operationJson).toContain('ordinary result')
    expect(parentStageJson).toContain('ordinary evidence')
    expect(parentStageJson).toContain('ordinary final')
    // The stage stores a digest of the redacted text, never SHA-256(raw
    // candidate). Otherwise a durable stage would be an offline secret oracle.
    expect(parentStageJson).not.toContain(createHash('sha256').update(genericToken, 'utf8').digest('hex'))
  })
})
