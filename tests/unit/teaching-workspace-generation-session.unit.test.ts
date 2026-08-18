import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const ledgerControl = vi.hoisted(() => ({ failOpen: false }))

vi.mock('../../src/main/learning-session-ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/learning-session-ledger')>()
  return {
    ...actual,
    createLearningSessionLedger: (options: Parameters<typeof actual.createLearningSessionLedger>[0]) => {
      const ledger = actual.createLearningSessionLedger(options)
      return {
        ...ledger,
        open: async (...args: Parameters<typeof ledger.open>) => {
          if (ledgerControl.failOpen) throw new Error('controlled canonical session open failure')
          return ledger.open(...args)
        }
      }
    }
  }
})

const { defaultSettings } = await import('../../src/main/teaching-settings')
const { TeachingWorkspaceService } = await import('../../src/main/teaching-workspace')
const { createVitestRuntimeScope } = await import('../helpers/test-runtime/vitest')

const runtimeScope = createVitestRuntimeScope()

describe('TeachingWorkspaceService generation Session gate', () => {
  it('fails generated-success projection closed when opening the canonical writable Session fails', async () => {
    const runtime = await runtimeScope.create('generation-session-open-failure')
    const managedRoot = join(runtime.paths.workspace, 'managed')
    const service = new TeachingWorkspaceService({
      registryPath: join(runtime.paths.appData, 'teaching-workspaces.json'),
      defaultRoot: managedRoot,
      settingsProvider: async () => defaultSettings(managedRoot)
    })
    const workspace = (await service.createWorkspace({ name: 'Session gate', prompt: 'Teach durable evidence.' })).activeWorkspace!

    ledgerControl.failOpen = true
    try {
      await expect(service.generateLesson({
        workspaceId: workspace.id,
        actionId: randomUUID(),
        prompt: 'Explain why a Session identity must be canonical.',
        messages: []
      // ADR-0012: Windows direct-path IO landed, so the controlled ledger
      // failure surfaces on every platform (no descriptor-unavailable fork).
      })).rejects.toThrow('controlled canonical session open failure')
    } finally {
      ledgerControl.failOpen = false
    }

    const index = JSON.parse(await readFile(join(workspace.rootPath, '.studiumx', 'index.json'), 'utf8')) as { lessons: unknown[] }
    expect(index.lessons).toEqual([])
    await expect(readFile(join(workspace.rootPath, 'lessons', '0001-explain-why-a-session-identity-must-be-canonical.html'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(workspace.rootPath, 'lessons', '0001-explain-why-a-session-identity-must-be-canonical-assessment.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(join(workspace.rootPath, 'lessons'))).resolves.toEqual([])
    const events = await readFile(join(workspace.rootPath, '.studiumx', 'sessions.jsonl'), 'utf8')
    expect(events).not.toContain('lesson_generated')
  })
})
