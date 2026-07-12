import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AgentRunStore,
  DEFAULT_AGENT_RUN_BUDGET,
  agentOperationId
} from '../../src/main/ai/agent-run-store'
import { defaultSettings, normalizeSettings } from '../../src/main/teaching-settings'

const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-recovery-'))
let tick = 0
const now = (): string => `2026-07-12T00:00:${String(tick++).padStart(2, '0')}.000Z`

try {
  const store = new AgentRunStore(root, now)
  await store.create({
    runId: 'run-permission',
    streamId: 'run-permission',
    workspaceId: 'workspace-1',
    conversationId: 'conversation-1',
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  await store.update('run-permission', {
    status: 'waiting_for_permission',
    pendingPermissionId: 'permission-1',
    lastDurableSequence: 7
  })
  const operation = await store.startOperation({
    runId: 'run-permission',
    toolCallId: 'call-write-1',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/recovery.md',
    artifactPointer: 'notes/recovery.md'
  })
  assert.equal(operation.action, 'execute')
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'recovery.md'), 'side effect exists\n')

  await assert.rejects(
    store.create({
      runId: 'run-permission',
      streamId: 'run-permission',
      budget: DEFAULT_AGENT_RUN_BUDGET
    }),
    /already exists/
  )

  const restarted = new AgentRunStore(root, now)
  const reconciled = await restarted.reconcileInterrupted()
  assert.equal(reconciled.length, 1)
  assert.equal(reconciled[0]?.previousStatus, 'waiting_for_permission')
  assert.equal(reconciled[0]?.lastDurableSequence, 7)
  assert.equal(reconciled[0]?.operationReviewCount, 1)
  const checkpoint = await restarted.readCheckpoint('run-permission')
  assert.equal(checkpoint.status, 'interrupted')
  assert.equal(checkpoint.pendingPermissionId, undefined)
  assert.match(checkpoint.interruptionReason ?? '', /旧审批和追问已失效/)

  const operationPath = join(
    root,
    '.agent-sessions',
    'operations',
    'run-permission',
    `${agentOperationId('run-permission', 'call-write-1')}.json`
  )
  const persistedOperation = JSON.parse(await readFile(operationPath, 'utf8'))
  assert.equal(persistedOperation.state, 'needs_review')
  assert.equal(persistedOperation.disposition, 'manual_review')
  assert.equal(persistedOperation.artifactExists, true)
  assert.equal((await stat(operationPath)).mode & 0o777, 0o600)
  assert.equal((await stat(join(root, '.agent-sessions', 'runs', 'run-permission.json'))).mode & 0o777, 0o600)

  await restarted.create({
    runId: 'run-ask',
    streamId: 'run-ask',
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  await restarted.update('run-ask', {
    status: 'waiting_for_elicitation',
    pendingElicitationId: 'ask-1'
  })
  const secondRestart = new AgentRunStore(root, now)
  const askRecovery = await secondRestart.reconcileInterrupted()
  assert.equal(askRecovery.some((item) => item.runId === 'run-ask' && item.previousStatus === 'waiting_for_elicitation'), true)
  assert.equal((await secondRestart.readCheckpoint('run-ask')).pendingElicitationId, undefined)

  const failed = await secondRestart.startOperation({
    runId: 'run-ask',
    toolCallId: 'call-secret',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/secret.md'
  })
  assert.equal(failed.action, 'execute')
  if (failed.action === 'execute') {
    await secondRestart.failOperation(failed.record, new Error('Authorization: Bearer super-secret-token'))
  }
  const sessionText = (await Promise.all((await readdir(join(root, '.agent-sessions', 'operations', 'run-ask')))
    .filter((name) => name.endsWith('.json'))
    .map((name) => readFile(join(root, '.agent-sessions', 'operations', 'run-ask', name), 'utf8')))).join('\n')
  assert.doesNotMatch(sessionText, /super-secret-token|Bearer super-secret/i)

  const runsDirectory = join(root, '.agent-sessions', 'runs')
  await writeFile(join(runsDirectory, 'corrupt.json'), '{not-json')
  await writeFile(join(runsDirectory, 'unknown.json'), JSON.stringify({ version: 99, extra: 'prompt text must not load' }))
  const invalidBudget = JSON.parse(await readFile(join(runsDirectory, 'run-ask.json'), 'utf8'))
  invalidBudget.runId = 'invalid-budget'
  invalidBudget.streamId = 'invalid-budget'
  invalidBudget.operationJournalPointer = '.agent-sessions/operations/invalid-budget'
  invalidBudget.budget.maxProviderCalls = 'many'
  await writeFile(join(runsDirectory, 'invalid-budget.json'), JSON.stringify(invalidBudget))
  await secondRestart.listInterrupted()
  const quarantined = await readdir(runsDirectory)
  assert.equal(quarantined.some((name) => name.startsWith('corrupt.json.corrupt-')), true)
  assert.equal(quarantined.some((name) => name.startsWith('unknown.json.corrupt-')), true)
  assert.equal(quarantined.some((name) => name.startsWith('invalid-budget.json.corrupt-')), true)

  assert.equal(defaultSettings(root).tools.workspaceWritePermission, 'ask_each_time')
  assert.equal(normalizeSettings({ tools: { workspaceWritePermission: 'read_only' } }, root).tools.workspaceWritePermission, 'read_only')
  assert.equal(normalizeSettings({ tools: { workspaceWritePermission: 'allow_for_conversation' } }, root).tools.workspaceWritePermission, 'allow_for_conversation')

  await assert.rejects(
    secondRestart.startOperation({
      runId: 'run-ask',
      toolCallId: 'unsafe-pointer',
      toolName: 'write_workspace_file',
      normalizedTarget: '../outside.md'
    }),
    /Unsafe persisted pointer/
  )

  const artifactOutside = await mkdtemp(join(tmpdir(), 'studiumx-agent-artifact-outside-'))
  try {
    await secondRestart.create({
      runId: 'run-artifact-symlink',
      streamId: 'run-artifact-symlink',
      budget: DEFAULT_AGENT_RUN_BUDGET
    })
    const symlinkArtifact = await secondRestart.startOperation({
      runId: 'run-artifact-symlink',
      toolCallId: 'call-artifact-symlink',
      toolName: 'write_workspace_file',
      normalizedTarget: 'linked/outside.md',
      artifactPointer: 'linked/outside.md'
    })
    assert.equal(symlinkArtifact.action, 'execute')
    await writeFile(join(artifactOutside, 'outside.md'), 'outside workspace\n')
    await symlink(artifactOutside, join(root, 'linked'))
    const artifactRecovery = await new AgentRunStore(root, now).reconcileInterrupted()
    assert.equal(artifactRecovery.some((item) => item.runId === 'run-artifact-symlink'), true)
    if (symlinkArtifact.action === 'execute') {
      const recoveredOperation = JSON.parse(await readFile(join(
        root,
        '.agent-sessions',
        'operations',
        'run-artifact-symlink',
        `${symlinkArtifact.record.operationId}.json`
      ), 'utf8'))
      assert.equal(recoveredOperation.state, 'needs_review')
      assert.equal(recoveredOperation.artifactExists, undefined, 'symlink escapes must not be probed outside the workspace')
    }
  } finally {
    await rm(artifactOutside, { recursive: true, force: true })
  }

  const symlinkRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-store-symlink-'))
  const symlinkOutside = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-store-outside-'))
  try {
    await symlink(symlinkOutside, join(symlinkRoot, '.agent-sessions'))
    await assert.rejects(
      new AgentRunStore(symlinkRoot).create({
        runId: 'escaped-run',
        streamId: 'escaped-run',
        budget: DEFAULT_AGENT_RUN_BUDGET
      }),
      /escapes storage root through a symlink/
    )
  } finally {
    await rm(symlinkRoot, { recursive: true, force: true })
    await rm(symlinkOutside, { recursive: true, force: true })
  }

  console.log('agent run recovery and migration boundaries ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
