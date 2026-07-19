import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentRunStore, DEFAULT_AGENT_RUN_BUDGET } from '../../src/main/ai/agent-run-store'
import {
  attachAgentParentTurnCommit,
  hasAgentParentTurnCommit,
  normalizeAgentConversationTurns
} from '../../src/main/teaching-agent-conversations'
import { parentTurnStageSafeTextDigest } from '../../src/main/ai/agent-parent-turn-staging'
import { persistedAgentParentTurnProof, sanitizePersistedAgentConversationRecord } from '../../src/shared/agent-persisted-history'
import type { AgentChatTurn } from '../../src/shared/teaching-types'

const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-parent-turn-staging-'))
let tick = 0
const now = (): string => `2026-07-14T00:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}.000Z`
const stagePath = (runId: string): string => join(root, '.agent-sessions', 'parent-turns', `${runId}.json`)
const operationDirectory = (runId: string): string => join(root, '.agent-sessions', 'operations', runId)
const checkpointPath = (runId: string): string => join(root, '.agent-sessions', 'runs', `${runId}.json`)

try {
  const store = new AgentRunStore(root, now)

  // A crash before the provider is invoked must retain only bounded, redacted input evidence.
  const inputSecret = 'sk-provider-before-crash-1234567890'
  const inputPassword = 'password=hunter2-parent-turn'
  const inputQuotedPassword = 'password="correct horse battery staple"'
  const inputJsonPassphrase = '"passphrase": "json phrase must be redacted"'
  await store.create({
    runId: 'run-provider-before',
    streamId: 'run-provider-before',
    workspaceId: 'workspace-1',
    conversationId: 'conversation-existing',
    parentTurn: {
      userInput: `请总结这段材料。 api_key=${inputSecret} ${inputPassword} ${inputQuotedPassword} ${inputJsonPassphrase}`
    },
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  const providerBeforeStage = await store.readParentTurnStage('run-provider-before')
  assert.equal(providerBeforeStage.status, 'running')
  assert.equal(providerBeforeStage.boundary, 'input_received')
  assert.match(providerBeforeStage.userInput.preview, /请总结这段材料/)
  assert.equal(providerBeforeStage.userInput.preview.includes(inputSecret), false)
  assert.equal(providerBeforeStage.userInput.preview.includes('hunter2-parent-turn'), false)
  assert.equal(providerBeforeStage.userInput.preview.includes('correct horse battery staple'), false)
  assert.equal(providerBeforeStage.userInput.preview.includes('json phrase must be redacted'), false)
  assert.equal(providerBeforeStage.userInput.preview.includes('[redacted]'), true)
  await assertPrivateFile(stagePath('run-provider-before'))
  await assertFileExcludes(stagePath('run-provider-before'), [inputSecret, 'hunter2-parent-turn', 'correct horse battery staple', 'json phrase must be redacted'])

  const providerBeforeRecovery = await new AgentRunStore(root, now).reconcileInterrupted(() => false)
  const providerBeforeSummary = requireRun(providerBeforeRecovery, 'run-provider-before')
  assert.equal(providerBeforeSummary.previousStatus, 'running')
  assert.equal(providerBeforeSummary.userInputPreview, providerBeforeStage.userInput.preview)
  assert.equal(providerBeforeSummary.userInputSha256, parentTurnStageSafeTextDigest(`请总结这段材料。 api_key=${inputSecret} ${inputPassword} ${inputQuotedPassword} ${inputJsonPassphrase}`))
  assert.equal(providerBeforeSummary.confirmedAssistantPreview, undefined)

  // Stream deltas are deliberately unrecoverable: count bytes/chunks, but never persist or confirm them.
  const streamSecret = 'draft-stream-secret-should-never-land'
  const toolArgumentSecret = 'tool-argument-secret-should-never-land'
  const toolResultSecret = 'tool-result-secret-should-never-land'
  const permissionSecret = 'permission-reason-secret-should-never-land'
  await store.create({
    runId: 'run-stream-tools',
    streamId: 'run-stream-tools',
    workspaceId: 'workspace-1',
    parentTurn: { userInput: '请读取工作区并给出结论。' },
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  await store.recordParentTurnEvent('run-stream-tools', {
    sequence: 1,
    streamId: 'run-stream-tools',
    kind: 'chunk',
    createdAt: now(),
    payload: { streamId: 'run-stream-tools', delta: `草稿 ${streamSecret}` }
  })
  assert.equal((await store.readCheckpoint('run-stream-tools')).lastDurableSequence, 1)
  await store.recordParentTurnEvent('run-stream-tools', {
    sequence: 2,
    streamId: 'run-stream-tools',
    kind: 'tool',
    createdAt: now(),
    payload: {
      streamId: 'run-stream-tools',
      toolCall: { id: 'tool-call-1', name: 'read_workspace_file', arguments: JSON.stringify({ token: toolArgumentSecret }) }
    }
  })
  await store.recordParentTurnEvent('run-stream-tools', {
    sequence: 3,
    streamId: 'run-stream-tools',
    kind: 'tool',
    createdAt: now(),
    payload: {
      streamId: 'run-stream-tools',
      toolCall: { id: 'tool-call-1', name: 'read_workspace_file', arguments: '{}' },
      result: `文件内容 ${toolResultSecret}`
    }
  })
  await store.recordParentTurnEvent('run-stream-tools', {
    sequence: 4,
    streamId: 'run-stream-tools',
    kind: 'tool',
    createdAt: now(),
    payload: {
      streamId: 'run-stream-tools',
      toolCall: { id: 'permission-call-1', name: 'write_workspace_file', arguments: '{}' },
      permissionRequest: {
        id: 'permission-1',
        kind: 'workspace_write',
        toolName: 'write_workspace_file',
        operation: '写入笔记',
        targetPath: 'notes/recovered.md',
        reason: permissionSecret
      }
    }
  })
  const monotonicStage = await store.readParentTurnStage('run-stream-tools')
  assert.equal(monotonicStage.lastDurableSequence, 4)
  assert.equal((await store.readCheckpoint('run-stream-tools')).lastDurableSequence, 4)
  const duplicateDeltaSecret = 'duplicate-or-stale-delta-must-not-land'
  await store.recordParentTurnEvent('run-stream-tools', {
    sequence: 4,
    streamId: 'run-stream-tools',
    kind: 'chunk',
    createdAt: now(),
    payload: { streamId: 'run-stream-tools', delta: duplicateDeltaSecret }
  })
  await store.recordParentTurnEvent('run-stream-tools', {
    sequence: 2,
    streamId: 'run-stream-tools',
    kind: 'chunk',
    createdAt: now(),
    payload: { streamId: 'run-stream-tools', delta: duplicateDeltaSecret }
  })
  assert.deepEqual(await store.readParentTurnStage('run-stream-tools'), monotonicStage)
  assert.equal((await store.readCheckpoint('run-stream-tools')).lastDurableSequence, 4, 'duplicate/out-of-order events must not move the checkpoint backward')
  await store.update('run-stream-tools', {
    status: 'waiting_for_permission',
    pendingPermissionId: 'permission-1'
  })
  assert.equal((await store.readCheckpoint('run-stream-tools')).lastDurableSequence, 4)
  const startedOperation = await store.operations.startOperation({
    runId: 'run-stream-tools',
    toolCallId: 'side-effect-started',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/recovered.md',
    artifactPointer: 'notes/recovered.md'
  })
  assert.equal(startedOperation.action, 'execute')

  const streamedStage = await store.readParentTurnStage('run-stream-tools')
  assert.equal(streamedStage.unrecoverableAssistantDeltaCount, 1)
  assert.equal(streamedStage.unrecoverableAssistantDeltaBytes, Buffer.byteLength(`草稿 ${streamSecret}`, 'utf8'))
  assert.equal(streamedStage.confirmedAssistant, undefined)
  assert.equal(streamedStage.boundary, 'permission_boundary')
  assert.deepEqual(streamedStage.evidence.map((item) => item.kind), ['tool_call', 'tool_result', 'permission_wait'])
  assert.deepEqual(streamedStage.evidence.map((item) => item.toolName), [
    'read_workspace_file',
    'read_workspace_file',
    'write_workspace_file'
  ])
  await assertFileExcludes(stagePath('run-stream-tools'), [
    streamSecret,
    toolArgumentSecret,
    toolResultSecret,
    permissionSecret,
    duplicateDeltaSecret
  ])

  const streamRecoveryStore = new AgentRunStore(root, now)
  const streamRecovery = await streamRecoveryStore.reconcileInterrupted(() => false)
  const streamSummary = requireRun(streamRecovery, 'run-stream-tools')
  assert.equal(streamSummary.previousStatus, 'waiting_for_permission')
  assert.equal(streamSummary.confirmedAssistantPreview, undefined)
  assert.equal(streamSummary.unrecoverableAssistantDeltaBytes, streamedStage.unrecoverableAssistantDeltaBytes)
  assert.deepEqual(streamSummary.evidence?.map((item) => item.kind), ['tool_call', 'tool_result', 'permission_wait'])
  assert.equal(streamSummary.operationReviewCount, 1)

  const operationFile = join(operationDirectory('run-stream-tools'), `${startedOperation.record.operationId}.json`)
  const operationAfterRecovery = JSON.parse(await readFile(operationFile, 'utf8'))
  assert.equal(operationAfterRecovery.state, 'needs_review')
  assert.equal(operationAfterRecovery.disposition, 'manual_review')
  const operationBytesAfterRecovery = await readFile(operationFile, 'utf8')
  assert.deepEqual(await streamRecoveryStore.reconcileInterrupted(() => false), [])
  assert.equal(await readFile(operationFile, 'utf8'), operationBytesAfterRecovery, 'repeated reconciliation must not rewrite review evidence')
  const operationDecisionAfterRestart = await new AgentRunStore(root, now).operations.startOperation({
    runId: 'run-stream-tools',
    toolCallId: 'side-effect-started',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/recovered.md',
    artifactPointer: 'notes/recovered.md'
  })
  assert.equal(operationDecisionAfterRestart.action, 'review', 'an interrupted side effect must never be executed again automatically')
  assert.equal(operationDecisionAfterRestart.record.state, 'needs_review')

  // Recovery must still reconcile operations if both lifecycle records were already interrupted.
  await store.create({
    runId: 'run-operation-window',
    streamId: 'run-operation-window',
    workspaceId: 'workspace-1',
    parentTurn: { userInput: '模拟恢复过程中的二次崩溃。' },
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  const windowOperation = await store.operations.startOperation({
    runId: 'run-operation-window',
    toolCallId: 'window-side-effect',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/window.md',
    artifactPointer: 'notes/window.md'
  })
  const interruptedAt = now()
  const windowStage = JSON.parse(await readFile(stagePath('run-operation-window'), 'utf8'))
  await writeFile(stagePath('run-operation-window'), JSON.stringify({
    ...windowStage,
    status: 'interrupted',
    previousStatus: 'running',
    interruptedAt,
    updatedAt: interruptedAt,
    recoveryReason: 'simulated recovery crash window'
  }))
  const windowCheckpoint = JSON.parse(await readFile(checkpointPath('run-operation-window'), 'utf8'))
  await writeFile(checkpointPath('run-operation-window'), JSON.stringify({
    ...windowCheckpoint,
    status: 'interrupted',
    previousStatus: 'running',
    interruptedAt,
    updatedAt: interruptedAt,
    interruptionReason: 'simulated recovery crash window'
  }))
  const windowRecoveryStore = new AgentRunStore(root, now)
  await windowRecoveryStore.reconcileInterrupted(() => false)
  const windowOperationFile = join(operationDirectory('run-operation-window'), `${windowOperation.record.operationId}.json`)
  assert.equal(JSON.parse(await readFile(windowOperationFile, 'utf8')).state, 'needs_review')
  assert.equal(requireRun(await windowRecoveryStore.listInterrupted(), 'run-operation-window').operationReviewCount, 1)

  // A confirmed final answer can be shown as a redacted preview while conversation save is pending.
  const finalSecret = 'sk-confirmed-final-secret-1234567890'
  const finalQuotedPassphrase = 'passphrase="final phrase with spaces"'
  await store.create({
    runId: 'run-awaiting-save',
    streamId: 'run-awaiting-save',
    workspaceId: 'workspace-1',
    parentTurn: { userInput: '生成最终说明。' },
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  await store.confirmParentTurnFinal('run-awaiting-save', `最终说明完成。 Authorization: Bearer ${finalSecret} ${finalQuotedPassphrase}`)
  await store.prepareParentTurnSave('run-awaiting-save', 'conversation-awaiting', 'a'.repeat(64))
  const awaitingRecovery = await new AgentRunStore(root, now).reconcileInterrupted(() => false)
  const awaitingSummary = requireRun(awaitingRecovery, 'run-awaiting-save')
  assert.equal(awaitingSummary.previousStatus, 'awaiting_conversation_save')
  assert.match(awaitingSummary.confirmedAssistantPreview ?? '', /最终说明完成/)
  assert.equal(awaitingSummary.confirmedAssistantPreview?.includes(finalSecret), false)
  assert.equal(awaitingSummary.confirmedAssistantPreview?.includes('final phrase with spaces'), false)
  assert.equal(awaitingSummary.confirmedAssistantPreview?.includes('[redacted]'), true)
  await assertFileExcludes(stagePath('run-awaiting-save'), [finalSecret, 'final phrase with spaces'])

  // The durable marker is a non-secret proof of the canonical sanitized prefix.
  const committedTurns: AgentChatTurn[] = [
    { id: 'user-marker', role: 'user', content: '请保存这个回答。', createdAt: '2026-07-14T01:00:00.000Z' },
    { id: 'assistant-marker', role: 'assistant', content: '这是最终回答。', createdAt: '2026-07-14T01:00:01.000Z' }
  ]
  const markedTurns = sanitizePersistedAgentConversationRecord({
    id: 'conversation-marker', workspaceId: 'workspace-1', title: 'Marker',
    createdAt: '2026-07-14T01:00:00.000Z', updatedAt: '2026-07-14T01:00:01.000Z',
    relativePath: 'conversations/conversation-marker.md', absolutePath: '/unused', messageCount: 2,
    turns: attachAgentParentTurnCommit(committedTurns, 'run-marker')
  }).turns
  const markerProof = markedTurns[1]?.metadata?.parentTurnProof?.digest
  assert.ok(markerProof)
  const normalizedMarkedTurns = normalizeAgentConversationTurns(markedTurns)
  assert.equal(persistedAgentParentTurnProof(normalizedMarkedTurns).digest, markerProof)
  assert.equal(hasAgentParentTurnCommit(normalizedMarkedTurns, 'run-marker', markerProof), true)
  const tamperedMarkedTurns = normalizedMarkedTurns.map((turn) =>
    turn.role === 'assistant' ? { ...turn, content: '被修改的回答。' } : turn
  )
  assert.equal(hasAgentParentTurnCommit(tamperedMarkedTurns, 'run-marker', markerProof), false)
  const appendedTurns: AgentChatTurn[] = [
    ...normalizedMarkedTurns,
    { id: 'user-later', role: 'user', content: '后续问题。', createdAt: '2026-07-14T01:01:00.000Z' },
    { id: 'assistant-later', role: 'assistant', content: '后续回答。', createdAt: '2026-07-14T01:01:01.000Z' }
  ]
  assert.equal(hasAgentParentTurnCommit(appendedTurns, 'run-marker', markerProof), true)

  // If the conversation commit is already durable, startup settles staging and reports nothing.
  await store.create({
    runId: 'run-conversation-saved',
    streamId: 'run-conversation-saved',
    workspaceId: 'workspace-1',
    parentTurn: { userInput: '保存后不要重复恢复。' },
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  await store.confirmParentTurnFinal('run-conversation-saved', '这是已经保存的最终回复。')
  await store.prepareParentTurnSave('run-conversation-saved', 'conversation-saved', 'b'.repeat(64))
  let savedCallbackCount = 0
  const savedRecoveryStore = new AgentRunStore(root, now)
  const savedRecovery = await savedRecoveryStore.reconcileInterrupted(async (stage) => {
    if (stage.runId !== 'run-conversation-saved') return false
    savedCallbackCount += 1
    assert.equal(stage.targetConversationId, 'conversation-saved')
    assert.equal(stage.expectedParentTurnProof, 'b'.repeat(64))
    return true
  })
  assert.equal(savedRecovery.some((item) => item.runId === 'run-conversation-saved'), false)
  assert.equal(savedCallbackCount, 1)
  assert.equal((await savedRecoveryStore.readParentTurnStage('run-conversation-saved')).status, 'settled')
  assert.equal((await savedRecoveryStore.readCheckpoint('run-conversation-saved')).status, 'completed')
  assert.deepEqual(await savedRecoveryStore.reconcileInterrupted(() => {
    throw new Error('settled staging must not query conversation storage again')
  }), [])

  // Canceled turns are terminal and must not be offered for recovery.
  const cancelSecret = 'cancel-reason-secret-should-not-land'
  await store.create({
    runId: 'run-canceled',
    streamId: 'run-canceled',
    workspaceId: 'workspace-1',
    parentTurn: { userInput: '取消这个请求。' },
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  await store.markParentTurnTerminal('run-canceled', 'canceled', `用户取消 token=${cancelSecret}`)
  await store.update('run-canceled', { status: 'canceled', completedAt: now(), stopReason: 'canceled' })
  const canceledRecovery = await new AgentRunStore(root, now).reconcileInterrupted(() => false)
  assert.equal(canceledRecovery.some((item) => item.runId === 'run-canceled'), false)
  assert.equal((await store.readParentTurnStage('run-canceled')).status, 'canceled')
  await assertFileExcludes(stagePath('run-canceled'), [cancelSecret])

  // Corrupt, unsupported, and oversized staging records are quarantined independently.
  await store.create({
    runId: 'run-valid-among-invalid',
    streamId: 'run-valid-among-invalid',
    workspaceId: 'workspace-1',
    parentTurn: { userInput: '有效记录不能被坏记录阻塞。' },
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  const parentTurnsDirectory = join(root, '.agent-sessions', 'parent-turns')
  await writeFile(join(parentTurnsDirectory, 'corrupt-stage.json'), '{not-json')
  await writeFile(join(parentTurnsDirectory, 'unknown-stage.json'), JSON.stringify({ schemaVersion: 99 }))
  await writeFile(join(parentTurnsDirectory, 'oversized-stage.json'), JSON.stringify({ padding: 'x'.repeat(100 * 1024) }))
  const invalidRecovery = await new AgentRunStore(root, now).reconcileInterrupted(() => false)
  assert.equal(invalidRecovery.some((item) => item.runId === 'run-valid-among-invalid'), true)
  const quarantinedNames = await readdir(parentTurnsDirectory)
  for (const name of ['corrupt-stage.json', 'unknown-stage.json', 'oversized-stage.json']) {
    assert.equal(quarantinedNames.includes(name), false)
    assert.equal(quarantinedNames.some((candidate) => candidate.startsWith(`${name}.corrupt-`)), true, `${name} should be quarantined`)
  }

  await assert.rejects(
    () => store.create({
      runId: '../escape-parent-turn',
      streamId: 'escape-parent-turn',
      parentTurn: { userInput: 'unsafe' },
      budget: DEFAULT_AGENT_RUN_BUDGET
    }),
    /runId/
  )
  await assertSymlinkContainment(now)

  console.log('agent parent turn staging persistence ok')
} finally {
  await rm(root, { recursive: true, force: true })
}

function requireRun<T extends { runId: string }>(runs: T[], runId: string): T {
  const run = runs.find((item) => item.runId === runId)
  assert.ok(run, `expected recovery summary for ${runId}`)
  return run
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function assertFileExcludes(path: string, secrets: string[]): Promise<void> {
  const persisted = await readFile(path, 'utf8')
  for (const secret of secrets) assert.equal(persisted.includes(secret), false, `${secret} must not be persisted in ${path}`)
}

async function assertPrivateFile(path: string): Promise<void> {
  if (process.platform === 'win32') return
  assert.equal((await stat(path)).mode & 0o777, 0o600, `${path} must use mode 0600`)
}

async function assertSymlinkContainment(clock: () => string): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), 'studiumx-agent-parent-turn-symlink-'))
  const storageRoot = join(sandbox, 'workspace')
  const outside = join(sandbox, 'outside')
  try {
    await mkdir(storageRoot)
    await mkdir(outside)
    const sessions = join(storageRoot, '.agent-sessions')
    const linked = await tryCreateDirectorySymlink(outside, sessions)
    if (!linked) return
    assert.equal((await lstat(sessions)).isSymbolicLink(), true)
    await assert.rejects(
      () => new AgentRunStore(storageRoot, clock).create({
        runId: 'run-symlink-escape',
        streamId: 'run-symlink-escape',
        parentTurn: { userInput: 'must remain contained' },
        budget: DEFAULT_AGENT_RUN_BUDGET
      }),
      /symlink|escapes storage root/i
    )
    assert.deepEqual(await readdir(outside), [])
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

async function tryCreateDirectorySymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir')
    return true
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') return false
    throw error
  }
}
