import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  AgentRunStore,
  DEFAULT_AGENT_RUN_BUDGET,
  agentOperationId
} from '../../src/main/ai/agent-run-store'
import { ChildRunSupervisor } from '../../src/main/ai/child-run-supervisor'
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
  const operation = await store.operations.startOperation({
    runId: 'run-permission',
    toolCallId: 'call-write-1',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/recovery.md',
    artifactPointer: 'notes/recovery.md'
  })
  assert.equal(operation.action, 'execute')
  await mkdir(join(root, 'notes'), { recursive: true })
  await writeFile(join(root, 'notes', 'recovery.md'), 'side effect exists\n')

  const childStore = store.createChildRunStore('run-permission')
  const queuedChild = childStore.create({
    id: 'child-queued',
    label: 'Queued child',
    profile: 'read_only',
    prompt: 'This prompt must never enter the durable child lifecycle journal.',
    parentStreamId: 'run-permission'
  })
  const runningChild = childStore.create({
    id: 'child-running',
    label: 'Running child',
    profile: 'research',
    prompt: 'Summarize the current workspace.',
    parentStreamId: 'run-permission'
  })
  childStore.transition(runningChild.id, 'running')
  const completedChild = childStore.create({
    id: 'child-completed',
    label: 'Completed child',
    profile: 'workspace_audit',
    prompt: 'Inspect the workspace.',
    parentStreamId: 'run-permission'
  })
  childStore.transition(completedChild.id, 'running')
  childStore.transition(completedChild.id, 'completed', {
    summary: 'Already complete.',
    completedAt: '2026-07-12T00:00:00.000Z',
    usage: { toolCalls: 1 }
  })
  await childStore.flush()
  const durableChildDirectory = join(root, '.agent-sessions', 'child-runs', 'run-permission')
  assert.doesNotMatch(await readFile(join(durableChildDirectory, `${queuedChild.id}.json`), 'utf8'), /This prompt must never enter/)

  // The public reconciliation seam is also safe to invoke before startup recovery: a live parent
  // still owns its children, so it must not settle their queued/running state prematurely.
  assert.deepEqual(await store.reconcileOrphanedChildRuns(), [])
  const liveChildren = await store.listChildRuns('run-permission')
  assert.equal(liveChildren.find((child) => child.childRunId === queuedChild.id)?.status, 'queued')
  assert.equal(liveChildren.find((child) => child.childRunId === runningChild.id)?.status, 'running')

  const preAbortedRoot = join(root, 'pre-aborted-parent')
  const preAbortedStore = new AgentRunStore(preAbortedRoot, now)
  await preAbortedStore.create({
    runId: 'run-pre-aborted',
    streamId: 'run-pre-aborted',
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  const parentController = new AbortController()
  parentController.abort()
  let preAbortedExecutorRan = false
  const preAbortedSupervisor = new ChildRunSupervisor({
    parentStreamId: 'run-pre-aborted',
    signal: parentController.signal,
    store: preAbortedStore.createChildRunStore('run-pre-aborted'),
    execute: async () => {
      preAbortedExecutorRan = true
      return {
        status: 'completed',
        summary: 'A pre-aborted child must never execute.',
        usage: { toolCalls: 0 }
      }
    }
  })
  const preAbortedResult = await preAbortedSupervisor.run({
    label: 'Pre-aborted child',
    prompt: 'Do not execute this child.',
    context: '',
    profile: 'read_only',
    maxIterations: 1,
    timeoutMs: 1_000
  })
  assert.equal(preAbortedExecutorRan, false)
  assert.equal(preAbortedResult.status, 'canceled')
  const preAbortedJournal = JSON.parse(await readFile(join(
    preAbortedRoot,
    '.agent-sessions',
    'child-runs',
    'run-pre-aborted',
    `${preAbortedResult.childRunId}.json`
  ), 'utf8'))
  assert.equal(preAbortedJournal.childRunId, preAbortedResult.childRunId)
  assert.equal(preAbortedJournal.status, 'canceled')

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
  const recoveredChildren = await restarted.listChildRuns('run-permission')
  assert.equal(recoveredChildren.find((child) => child.childRunId === queuedChild.id)?.status, 'recoverable')
  assert.match(recoveredChildren.find((child) => child.childRunId === queuedChild.id)?.recoveryReason ?? '', /尚未执行/)
  const canceledChild = recoveredChildren.find((child) => child.childRunId === runningChild.id)
  assert.equal(canceledChild?.status, 'canceled')
  assert.equal(canceledChild?.completedAt, canceledChild?.recoveredAt)
  assert.match(canceledChild?.recoveryReason ?? '', /无法安全继续/)
  assert.equal(recoveredChildren.find((child) => child.childRunId === completedChild.id)?.status, 'completed')

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
  if (process.platform !== 'win32') {
    assert.equal((await stat(operationPath)).mode & 0o777, 0o600)
    assert.equal((await stat(join(root, '.agent-sessions', 'runs', 'run-permission.json'))).mode & 0o777, 0o600)
    assert.equal((await stat(join(durableChildDirectory, `${queuedChild.id}.json`))).mode & 0o777, 0o600)
  }

  await restarted.create({
    runId: 'run-child-terminal',
    streamId: 'run-child-terminal',
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  await restarted.update('run-child-terminal', { status: 'completed', completedAt: now() })
  const terminalChildStore = restarted.createChildRunStore('run-child-terminal')
  terminalChildStore.create({
    id: 'child-after-parent',
    label: 'Parent-terminal child',
    profile: 'read_only',
    prompt: 'Never run after the parent finishes.'
  })
  await terminalChildStore.flush()

  const missingParentChildStore = restarted.createChildRunStore('missing-parent')
  missingParentChildStore.create({
    id: 'child-missing-parent',
    label: 'Missing-parent child',
    profile: 'read_only',
    prompt: 'A missing parent must not leave an active child behind.'
  })
  await missingParentChildStore.flush()

  const recoveryRestart = new AgentRunStore(root, now)
  assert.deepEqual(await recoveryRestart.reconcileInterrupted(), [])
  assert.equal((await recoveryRestart.listChildRuns('run-child-terminal'))[0]?.status, 'canceled')
  assert.equal((await recoveryRestart.listChildRuns('missing-parent'))[0]?.status, 'recoverable')
  const childFiles = [
    join(durableChildDirectory, `${queuedChild.id}.json`),
    join(durableChildDirectory, `${runningChild.id}.json`),
    join(durableChildDirectory, `${completedChild.id}.json`),
    join(root, '.agent-sessions', 'child-runs', 'run-child-terminal', 'child-after-parent.json'),
    join(root, '.agent-sessions', 'child-runs', 'missing-parent', 'child-missing-parent.json')
  ]
  const childJournalBeforeSecondRecovery = await Promise.all(childFiles.map((path) => readFile(path, 'utf8')))
  assert.deepEqual(await recoveryRestart.reconcileInterrupted(), [])
  assert.deepEqual(await Promise.all(childFiles.map((path) => readFile(path, 'utf8'))), childJournalBeforeSecondRecovery)

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

  const failed = await secondRestart.operations.startOperation({
    runId: 'run-ask',
    toolCallId: 'call-secret',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/secret.md'
  })
  assert.equal(failed.action, 'execute')
  if (failed.action === 'execute') {
    await secondRestart.operations.failOperation(failed.record, new Error('Authorization: Bearer super-secret-token'))
  }
  const sessionText = (await Promise.all((await readdir(join(root, '.agent-sessions', 'operations', 'run-ask')))
    .filter((name) => name.endsWith('.json'))
    .map((name) => readFile(join(root, '.agent-sessions', 'operations', 'run-ask', name), 'utf8')))).join('\n')
  assert.doesNotMatch(sessionText, /super-secret-token|Bearer super-secret/i)

  const runsDirectory = join(root, '.agent-sessions', 'runs')
  const legacyRunId = 'legacy-v1-run'
  const legacyOperationId = agentOperationId(legacyRunId, 'legacy-write-call')
  await mkdir(join(root, '.agent-sessions', 'operations', legacyRunId), { recursive: true })
  // Hand-authored v1 files simulate state written before this module split. The lifecycle and
  // journal must preserve the disk schema while still recovering an ambiguous write safely.
  await writeFile(join(runsDirectory, `${legacyRunId}.json`), JSON.stringify({
    version: 1,
    runId: legacyRunId,
    streamId: legacyRunId,
    status: 'running',
    lastDurableSequence: 3,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:01.000Z',
    operationJournalPointer: `.agent-sessions/operations/${legacyRunId}`,
    budget: DEFAULT_AGENT_RUN_BUDGET,
    usage: { providerCalls: 1, toolCalls: 1, toolErrors: 0, iterations: 1, childRuns: 0, durationMs: 12 }
  }))
  await writeFile(join(root, '.agent-sessions', 'operations', legacyRunId, `${legacyOperationId}.json`), JSON.stringify({
    version: 1,
    operationId: legacyOperationId,
    runId: legacyRunId,
    toolCallId: 'legacy-write-call',
    toolName: 'write_workspace_file',
    normalizedTarget: 'notes/legacy.md',
    artifactPointer: 'notes/legacy.md',
    state: 'started',
    disposition: 'first_execution',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:01.000Z'
  }))
  const legacyRecovery = await new AgentRunStore(root, now).reconcileInterrupted()
  assert.equal(legacyRecovery.some((item) => item.runId === legacyRunId && item.operationReviewCount === 1), true)
  assert.equal((await new AgentRunStore(root, now).readCheckpoint(legacyRunId)).status, 'interrupted')
  const legacyOperation = JSON.parse(await readFile(join(root, '.agent-sessions', 'operations', legacyRunId, `${legacyOperationId}.json`), 'utf8'))
  assert.equal(legacyOperation.state, 'needs_review')
  assert.equal(legacyOperation.disposition, 'manual_review')

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

  assert.equal(defaultSettings(root).tools.approvalMode, 'request_approval')
  assert.equal(normalizeSettings({ tools: { workspaceWritePermission: 'read_only' } }, root).tools.approvalMode, 'request_approval')
  assert.equal(normalizeSettings({ tools: { workspaceWritePermission: 'allow_for_conversation' } }, root).tools.approvalMode, 'full_access')

  await assert.rejects(
    secondRestart.operations.startOperation({
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
    const symlinkArtifact = await secondRestart.operations.startOperation({
      runId: 'run-artifact-symlink',
      toolCallId: 'call-artifact-symlink',
      toolName: 'write_workspace_file',
      normalizedTarget: 'linked/outside.md',
      artifactPointer: 'linked/outside.md'
    })
    assert.equal(symlinkArtifact.action, 'execute')
    await writeFile(join(artifactOutside, 'outside.md'), 'outside workspace\n')
    const linked = await tryCreateSymlink(artifactOutside, join(root, 'linked'))
    if (linked) {
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
    }
  } finally {
    await rm(artifactOutside, { recursive: true, force: true })
  }

  const symlinkRoot = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-store-symlink-'))
  const symlinkOutside = await mkdtemp(join(tmpdir(), 'studiumx-agent-run-store-outside-'))
  try {
    if (await tryCreateSymlink(symlinkOutside, join(symlinkRoot, '.agent-sessions'))) {
      await assert.rejects(
        new AgentRunStore(symlinkRoot).create({
          runId: 'escaped-run',
          streamId: 'escaped-run',
          budget: DEFAULT_AGENT_RUN_BUDGET
        }),
        /escapes storage root through a symlink/
      )
    }
  } finally {
    await rm(symlinkRoot, { recursive: true, force: true })
    await rm(symlinkOutside, { recursive: true, force: true })
  }

  console.log('agent run recovery and migration boundaries ok')
} finally {
  await rm(root, { recursive: true, force: true })
}

async function tryCreateSymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path)
    return true
  } catch (error) {
    if (process.platform === 'win32' && (error as { code?: unknown }).code === 'EPERM') {
      console.log('skipping symlink containment assertion: Windows symlink privilege is unavailable')
      return false
    }
    throw error
  }
}
