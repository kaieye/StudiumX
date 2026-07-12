import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AgentRunStore, DEFAULT_AGENT_RUN_BUDGET } from '../../src/main/ai/agent-run-store'
import { ToolRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { defaultSettings } from '../../src/main/teaching-settings'

const root = await mkdtemp(join(tmpdir(), 'studiumx-operation-idempotency-'))

try {
  const settings = defaultSettings(root)
  settings.tools.workspaceWritePermission = 'allow_for_conversation'
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
    operationJournal: store
  }))
  const call = { toolCallId: 'same-call', toolName: 'journal_write', runId: 'run-a' }
  const first = JSON.parse(await handlersA.journal_write({}, call))
  assert.equal(first.operation.disposition, 'first_execution')
  assert.equal(first.operation.artifactPointer, 'notes/idempotent.md', 'unsafe result path must not replace the validated target')
  const second = JSON.parse(await handlersA.journal_write({}, call))
  assert.equal(second.operation.disposition, 'idempotent_reuse')
  assert.equal(executions, 1)
  assert.equal(await readFile(join(root, 'notes', 'idempotent.md'), 'utf8'), 'execution=1\n')

  const handlersB = registry.handlerMap(buildToolContext(settings, {
    workspaceRoot: root,
    runId: 'run-b',
    operationJournal: store
  }))
  const third = JSON.parse(await handlersB.journal_write({}, {
    toolCallId: 'same-call',
    toolName: 'journal_write',
    runId: 'run-b'
  }))
  assert.equal(third.operation.disposition, 'first_execution')
  assert.equal(executions, 2, 'a new run must receive a distinct operation id')

  const unknown = await store.startOperation({
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

  const large = await store.startOperation({
    runId: 'run-a',
    toolCallId: 'large-result',
    toolName: 'journal_write',
    normalizedTarget: 'notes/large.md'
  })
  assert.equal(large.action, 'execute')
  if (large.action === 'execute') await store.completeOperation(large.record, 'x'.repeat(17 * 1024))
  assert.equal((await store.startOperation({
    runId: 'run-a',
    toolCallId: 'large-result',
    toolName: 'journal_write',
    normalizedTarget: 'notes/large.md'
  })).action, 'review')

  const failed = await store.startOperation({
    runId: 'run-a',
    toolCallId: 'failed-after-side-effect',
    toolName: 'journal_write',
    normalizedTarget: 'notes/failed.md'
  })
  assert.equal(failed.action, 'execute')
  if (failed.action === 'execute') await store.failOperation(failed.record, new Error('result delivery failed'))
  assert.equal((await store.startOperation({
    runId: 'run-a',
    toolCallId: 'failed-after-side-effect',
    toolName: 'journal_write',
    normalizedTarget: 'notes/failed.md'
  })).action, 'review')

  console.log('agent operation idempotency boundaries ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
