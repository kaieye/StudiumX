import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentRunStore, DEFAULT_AGENT_RUN_BUDGET } from '../../src/main/ai/agent-run-store'
import { ToolRegistry, buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'
import { getWorkspaceWriteToolAvailability } from '../../src/main/ai/tools/workspace'

const root = await mkdtemp(join(tmpdir(), 'studiumx-operation-idempotency-'))

try {
  const settings = defaultSettings(root)
  settings.tools.approvalMode = 'full_access'
  settings.tools.workspaceRead = true
  const store = new AgentRunStore(root)
  await store.create({ runId: 'run-a', streamId: 'run-a', budget: DEFAULT_AGENT_RUN_BUDGET })
  await store.create({ runId: 'run-b', streamId: 'run-b', budget: DEFAULT_AGENT_RUN_BUDGET })
  await mkdir(join(root, 'notes'), { recursive: true })

  let executions = 0
  const registry = new ToolRegistry()
  registry.register({
    definition: {
      type: 'function',
      function: {
        name: 'journal_write',
        description: 'test write',
        parameters: { type: 'object', properties: {} }
      }
    },
    permission: {
      kind: 'workspace_write',
      describe: () => ({ operation: '写入测试文件', targetPath: 'notes/idempotent.md', creates: true })
    },
    handler: async () => {
      executions += 1
      await writeFile(join(root, 'notes', 'idempotent.md'), `execution=${executions}\n`)
      return JSON.stringify({ ok: true, path: '../outside-result.md', execution: executions })
    }
  })

  const handlersA = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    runId: 'run-a',
    operationJournal: store.operations
  }))
  const call = { toolCallId: 'same-call', toolName: 'journal_write', runId: 'run-a' }
  const first = JSON.parse(await handlersA.journal_write({}, call))
  assert.equal(first.operation.disposition, 'first_execution')
  assert.equal(first.operation.artifactPointer, 'notes/idempotent.md', 'unsafe result path must not replace the validated target')
  const second = JSON.parse(await handlersA.journal_write({}, call))
  assert.equal(second.operation.disposition, 'idempotent_reuse')
  assert.equal(executions, 1)
  assert.equal(await readFile(join(root, 'notes', 'idempotent.md'), 'utf8'), 'execution=1\n')

  // A fresh process must make the same decision from the v1 journal record, not from memory.
  const restartedStore = new AgentRunStore(root)
  const restartedHandlers = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    runId: 'run-a',
    operationJournal: restartedStore.operations
  }))
  const afterRestart = JSON.parse(await restartedHandlers.journal_write({}, call))
  assert.equal(afterRestart.operation.disposition, 'idempotent_reuse')
  assert.equal(executions, 1, 'a recovered completed write must never execute twice')

  const handlersB = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    runId: 'run-b',
    operationJournal: store.operations
  }))
  const third = JSON.parse(await handlersB.journal_write({}, {
    toolCallId: 'same-call',
    toolName: 'journal_write',
    runId: 'run-b'
  }))
  assert.equal(third.operation.disposition, 'first_execution')
  assert.equal(executions, 2, 'a new run must receive a distinct operation id')

  const unknown = await store.operations.startOperation({
    runId: 'run-a',
    toolCallId: 'started-before-exit',
    toolName: 'journal_write',
    normalizedTarget: 'notes/unknown.md'
  })
  assert.equal(unknown.action, 'execute')
  const reviewed = await handlersA.journal_write({}, {
    toolCallId: 'started-before-exit',
    toolName: 'journal_write',
    runId: 'run-a'
  })
  assert.equal(JSON.parse(reviewed).operation.disposition, 'manual_review')
  assert.equal(executions, 2)

  const large = await store.operations.startOperation({
    runId: 'run-a',
    toolCallId: 'large-result',
    toolName: 'journal_write',
    normalizedTarget: 'notes/large.md'
  })
  assert.equal(large.action, 'execute')
  if (large.action === 'execute') await store.operations.completeOperation(large.record, 'x'.repeat(17 * 1024))
  assert.equal((await store.operations.startOperation({
    runId: 'run-a',
    toolCallId: 'large-result',
    toolName: 'journal_write',
    normalizedTarget: 'notes/large.md'
  })).action, 'review')

  const failed = await store.operations.startOperation({
    runId: 'run-a',
    toolCallId: 'failed-after-side-effect',
    toolName: 'journal_write',
    normalizedTarget: 'notes/failed.md'
  })
  assert.equal(failed.action, 'execute')
  if (failed.action === 'execute') await store.operations.failOperation(failed.record, new Error('result delivery failed'))
  assert.equal((await store.operations.startOperation({
    runId: 'run-a',
    toolCallId: 'failed-after-side-effect',
    toolName: 'journal_write',
    normalizedTarget: 'notes/failed.md'
  })).action, 'review')

  // This is intentionally the production registry's actual write_workspace_file
  // entry, rather than the synthetic journal_write entry above. The first call
  // is S2 (overwrite:true + absent target); a replay would select S3 because
  // the target is then an existing single-link regular file. A changed inode
  // would therefore expose a second filesystem publisher invocation.
  const workspaceRunId = 'workspace-write-run'
  const workspaceToolCallId = 'workspace-write-replay'
  await store.create({
    runId: workspaceRunId,
    streamId: workspaceRunId,
    budget: DEFAULT_AGENT_RUN_BUDGET
  })
  const workspaceWriteRegistry = buildDefaultRegistry(settings, {
    workspaceRoot: root,
    workspaceWrite: true
  })
  const workspaceWriteHandlers = workspaceWriteRegistry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    runId: workspaceRunId,
    operationJournal: store.operations
  }))
  const workspaceWriteCall = {
    toolCallId: workspaceToolCallId,
    toolName: 'write_workspace_file',
    runId: workspaceRunId
  }
  const workspaceWriteArgs = {
    path: 'notes/replayed-durable-write.md',
    content: '完整 UTF-8 replay 内容 🧪\n',
    overwrite: true
  }
  const workspaceWriteAvailability = getWorkspaceWriteToolAvailability()
  assert.equal(
    workspaceWriteRegistry.names().includes('write_workspace_file'),
    workspaceWriteAvailability.available,
    'workspace write registration must match the durable containment capability'
  )
  const workspaceWriteTarget = join(root, workspaceWriteArgs.path)

  if (!workspaceWriteAvailability.available) {
    assert.equal(workspaceWriteAvailability.code, 'containment_unavailable')
    assert.equal(workspaceWriteAvailability.message, '当前平台无法安全发布工作区文件。')
    assert.equal(typeof workspaceWriteHandlers.write_workspace_file, 'undefined')
    await assert.rejects(stat(workspaceWriteTarget), { code: 'ENOENT' })
    console.log('[agent operation idempotency] durable workspace publication unavailable; no write operation was offered')
  } else {
    const firstWorkspaceWrite = JSON.parse(await workspaceWriteHandlers.write_workspace_file(
      workspaceWriteArgs,
      workspaceWriteCall
    ))
    assert.equal(firstWorkspaceWrite.operation.disposition, 'first_execution')

    assert.deepEqual(
      {
        path: firstWorkspaceWrite.path,
        created: firstWorkspaceWrite.created,
        overwritten: firstWorkspaceWrite.overwritten
      },
      { path: workspaceWriteArgs.path, created: true, overwritten: false }
    )
    const publishedBeforeReplay = await stat(workspaceWriteTarget)
    assert.equal(await readFile(workspaceWriteTarget, 'utf8'), workspaceWriteArgs.content)

    // Reconstruct the journal and registry to make this a true persisted replay,
    // not an in-memory short-circuit. Registry reuse must happen before the real
    // write handler/publisher; otherwise this overwrite:true call would run S3
    // and atomically replace the target with a distinct inode.
    const restartedWorkspaceStore = new AgentRunStore(root)
    const restartedWorkspaceRegistry = buildDefaultRegistry(settings, {
      workspaceRoot: root,
      workspaceWrite: true
    })
    const replayedWorkspaceWrite = JSON.parse(await restartedWorkspaceRegistry.handlerMap(buildToolContext(settings, {
      workspaceRoot: root,
      runId: workspaceRunId,
      operationJournal: restartedWorkspaceStore.operations
    })).write_workspace_file(workspaceWriteArgs, workspaceWriteCall))
    assert.equal(replayedWorkspaceWrite.operation.disposition, 'idempotent_reuse')
    assert.deepEqual(
      {
        path: replayedWorkspaceWrite.path,
        created: replayedWorkspaceWrite.created,
        overwritten: replayedWorkspaceWrite.overwritten
      },
      { path: workspaceWriteArgs.path, created: true, overwritten: false }
    )
    const publishedAfterReplay = await stat(workspaceWriteTarget)
    assert.equal(publishedAfterReplay.ino, publishedBeforeReplay.ino, 'completed replay must not invoke the S3 filesystem publisher')
    assert.equal(await readFile(workspaceWriteTarget, 'utf8'), workspaceWriteArgs.content)
  }

  console.log('agent operation idempotency boundaries ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
