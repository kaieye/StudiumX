import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingMemoryStore } from '../../src/main/teaching-memory'

const tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-teaching-memory-recall-'))
const workspaceAlpha = join(tempRoot, 'workspace-alpha')
const workspaceBeta = join(tempRoot, 'workspace-beta')
const settings = defaultSettings(join(tempRoot, 'workspaces'))
settings.memory.enabled = true
settings.memory.maxInjected = 1

const ids = [
  'user-unrelated',
  'ranked-top',
  'ranked-low',
  'project-same',
  'workspace-other',
  'disabled-memory',
  'deleted-memory'
]
let idIndex = 0
let timestamp = Date.parse('2026-07-14T00:00:00.000Z')
const store = new TeachingMemoryStore({
  rootDir: join(tempRoot, 'memory'),
  settingsProvider: async () => settings,
  idGenerator: () => ids[idIndex++] ?? `extra-${idIndex}`,
  nowIso: () => new Date(timestamp += 1_000).toISOString()
})

try {
  await store.create({
    content: 'Use examples before abstract explanations.',
    scope: 'user',
    tags: ['preference'],
    confidence: 1
  })
  await store.create({
    content: 'alpha beta retrieval workflow',
    scope: 'workspace',
    workspaceRoot: workspaceAlpha,
    tags: ['ranking'],
    confidence: 0.9
  })
  await store.create({
    content: 'alpha note',
    scope: 'workspace',
    workspaceRoot: workspaceAlpha,
    confidence: 0.7
  })
  await store.create({
    content: 'alpha project note',
    scope: 'project',
    workspaceRoot: workspaceAlpha,
    confidence: 0.5
  })
  await store.create({
    content: 'alpha beta belongs to another Teaching workspace',
    scope: 'workspace',
    workspaceRoot: workspaceBeta,
    confidence: 1
  })
  const disabled = await store.create({
    content: 'alpha beta disabled',
    scope: 'workspace',
    workspaceRoot: workspaceAlpha,
    confidence: 1
  })
  const deleted = await store.create({
    content: 'alpha beta deleted',
    scope: 'workspace',
    workspaceRoot: workspaceAlpha,
    confidence: 1
  })
  await store.update(disabled.id, { disabled: true }, { workspaceRoot: workspaceAlpha })
  await store.delete(deleted.id, { workspaceRoot: workspaceAlpha })

  const defaultLimited = await store.retrieve({
    query: 'alpha beta',
    workspaceRoot: workspaceAlpha
  })
  assert.deepEqual(
    defaultLimited.map((record) => record.id),
    ['user-unrelated'],
    'the settings recall limit should apply after user-memory precedence'
  )

  const selected = await store.retrieve({
    query: 'alpha beta',
    workspaceRoot: workspaceAlpha,
    limit: 4
  })
  assert.deepEqual(
    selected.map((record) => record.id),
    ['user-unrelated', 'ranked-top', 'ranked-low', 'project-same'],
    'user memory should precede scored in-scope records, which should rank before the limit is applied'
  )
  const diagnosticsAfterSelection = await store.diagnostics()
  assert.deepEqual(
    diagnosticsAfterSelection.lastInjectedIds,
    ['user-unrelated', 'ranked-top', 'ranked-low', 'project-same'],
    'diagnostics should report the exact selected Memory IDs'
  )

  const betaSelection = await store.retrieve({
    query: 'alpha beta',
    workspaceRoot: workspaceBeta,
    limit: 4
  })
  assert.deepEqual(
    betaSelection.map((record) => record.id),
    ['user-unrelated', 'workspace-other'],
    'workspace-scoped records must not cross the durable workspace scope seam'
  )

  const withoutWorkspace = await store.retrieve({ query: 'alpha beta', limit: 4 })
  assert.deepEqual(
    withoutWorkspace.map((record) => record.id),
    ['user-unrelated'],
    'only user-scoped Memory is eligible without a Teaching workspace root'
  )

  settings.memory.enabled = false
  const disabledBySettings = await store.retrieve({
    query: 'alpha beta',
    workspaceRoot: workspaceAlpha,
    limit: 4
  })
  assert.deepEqual(disabledBySettings, [], 'disabled Memory settings must prevent every injection')
  const diagnosticsWhenDisabled = await store.diagnostics()
  assert.equal(diagnosticsWhenDisabled.enabled, false)
  assert.deepEqual(diagnosticsWhenDisabled.lastInjectedIds, [], 'disabled recall must clear stale injection telemetry')

  console.log('teaching memory recall ok')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
