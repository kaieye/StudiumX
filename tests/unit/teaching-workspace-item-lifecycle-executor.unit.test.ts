import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { TeachingWorkspaceItemLifecycleExecutor } from '../../src/main/teaching-workspace/item-lifecycle-executor'
import type { WorkspaceIndex } from '../../src/main/teaching-workspace/lifecycle'
import type { RegistryWorkspace } from '../../src/main/teaching-workspace/registry'
import type { LessonSummary } from '../../src/shared/teaching-types'
import type { WorkspacePathMeta } from '../../src/main/teaching-workspace-paths'

const createdRoots: string[] = []
const timestamp = '2026-07-14T00:00:00.000Z'

function workspace(rootPath: string): RegistryWorkspace {
  return {
    id: 'workspace-1',
    name: 'Executor Workspace',
    rootPath,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function lesson(rootPath: string, relativePath: string): LessonSummary {
  const courseRelativePath = relativePath.includes('/') ? relativePath.split('/').slice(0, -1).join('/') : 'lessons'
  return {
    id: 'lesson-1',
    title: 'Executor lesson',
    objective: 'Verify lifecycle persistence.',
    prompt: 'Build a lesson lifecycle test.',
    createdAt: timestamp,
    durationMinutes: 15,
    courseId: 'course-1',
    courseName: 'Course',
    courseRelativePath,
    courseAbsolutePath: join(rootPath, courseRelativePath),
    sessionId: 'session-1',
    sessionName: 'Session',
    sessionRelativePath: courseRelativePath,
    sessionAbsolutePath: join(rootPath, courseRelativePath),
    relativePath,
    absolutePath: join(rootPath, relativePath)
  }
}

function indexFor(rootPath: string, lessons: LessonSummary[], pathMeta: Record<string, WorkspacePathMeta> = {}): WorkspaceIndex {
  return {
    id: 'workspace-1',
    name: 'Executor Workspace',
    rootPath,
    createdAt: timestamp,
    updatedAt: timestamp,
    lessons,
    pathMeta
  }
}

async function expectMissing(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow()
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-item-lifecycle-executor-'))
  createdRoots.push(root)
  return root
}

function createExecutor(input: {
  appDataRoot: string
  workspaceIndex: WorkspaceIndex
  temporaryIndex?: { pathMeta?: Record<string, WorkspacePathMeta> }
  hasTemporaryConversation?: (id: string) => Promise<boolean>
  events?: string[]
}) {
  let durableIndex = input.workspaceIndex
  let temporaryIndex = input.temporaryIndex ?? {}
  const events = input.events ?? []
  const executor = new TeachingWorkspaceItemLifecycleExecutor({
    appDataRoot: input.appDataRoot,
    loadWorkspaceIndex: async () => durableIndex,
    saveWorkspaceIndex: async (_rootPath, index) => {
      events.push('save-durable')
      durableIndex = index
      await mkdir(join(index.rootPath, '.teachos'), { recursive: true })
      await writeFile(join(index.rootPath, '.teachos', 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    },
    loadTemporaryConversationIndex: async () => temporaryIndex,
    saveTemporaryConversationIndex: async (index) => {
      events.push('save-temporary')
      temporaryIndex = index
      await mkdir(join(input.appDataRoot, 'conversations'), { recursive: true })
      await writeFile(join(input.appDataRoot, 'conversations', '.index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    },
    hasTemporaryConversation: input.hasTemporaryConversation ?? (async () => false),
    rebuildState: async () => {
      events.push('rebuild')
      return { durableIndex, temporaryIndex }
    }
  })

  return { executor, events }
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('TeachingWorkspaceItemLifecycleExecutor', () => {
  it('rejects empty and escaping targets before any persistence or state rebuild', async () => {
    const root = await createRoot()
    const events: string[] = []
    const { executor } = createExecutor({
      appDataRoot: join(root, 'app-data'),
      workspaceIndex: indexFor(root, []),
      events
    })

    await expect(executor.execute({
      workspace: workspace(root),
      target: { relativePath: '', kind: 'file' },
      intent: { type: 'set-meta', change: { pinned: true } }
    })).rejects.toThrow('relativePath is required.')
    await expect(executor.execute({
      workspace: workspace(root),
      target: { relativePath: '../outside.md', kind: 'file' },
      intent: { type: 'remove', mode: 'disk' }
    })).rejects.toThrow('Path is outside the workspace.')
    expect(events).toEqual([])
  })

  it('removes a Lesson with all generated sidecars before persisting the pruned durable index', async () => {
    const root = await createRoot()
    const relativePath = 'lessons/0001-executor.html'
    const lessonEntry = lesson(root, relativePath)
    const lessonBase = join(root, 'lessons', '0001-executor')
    await mkdir(join(root, 'lessons'), { recursive: true })
    await Promise.all([
      writeFile(`${lessonBase}.html`, '<!doctype html>', 'utf8'),
      writeFile(`${lessonBase}-reference.html`, '<!doctype html>', 'utf8'),
      writeFile(`${lessonBase}.md`, '# Lesson', 'utf8'),
      writeFile(`${lessonBase}-flashcards.json`, '[]', 'utf8')
    ])
    const events: string[] = []
    const { executor } = createExecutor({
      appDataRoot: join(root, 'app-data'),
      workspaceIndex: indexFor(root, [lessonEntry], { [relativePath]: { pinned: true } }),
      events
    })

    const state = await executor.execute({
      workspace: workspace(root),
      target: { relativePath, kind: 'file' },
      intent: { type: 'remove', mode: 'disk' }
    })

    await Promise.all([
      expectMissing(`${lessonBase}.html`),
      expectMissing(`${lessonBase}-reference.html`),
      expectMissing(`${lessonBase}.md`),
      expectMissing(`${lessonBase}-flashcards.json`)
    ])
    expect(state.durableIndex.lessons).toEqual([])
    expect(state.durableIndex.pathMeta).toEqual({})
    expect(events).toEqual(['save-durable', 'rebuild'])
  })

  it('removes a Course directory and every indexed descendant from the durable workspace', async () => {
    const root = await createRoot()
    const relativePath = 'courses/algorithms'
    const lessonRelativePath = 'courses/algorithms/sessions/s1/0001-search.html'
    const lessonEntry = lesson(root, lessonRelativePath)
    await mkdir(join(root, 'courses', 'algorithms', 'sessions', 's1'), { recursive: true })
    await writeFile(join(root, lessonRelativePath), '<!doctype html>', 'utf8')
    await writeFile(join(root, 'courses', 'algorithms', 'notes.md'), '# Notes', 'utf8')
    const { executor } = createExecutor({
      appDataRoot: join(root, 'app-data'),
      workspaceIndex: indexFor(root, [lessonEntry], {
        [relativePath]: { pinned: true },
        [lessonRelativePath]: { archived: true },
        'courses/other': { pinned: true }
      })
    })

    const state = await executor.execute({
      workspace: workspace(root),
      target: { relativePath, kind: 'directory' },
      intent: { type: 'remove', mode: 'disk' }
    })

    await expectMissing(join(root, relativePath))
    expect(state.durableIndex.lessons).toEqual([])
    expect(state.durableIndex.pathMeta).toEqual({ 'courses/other': { pinned: true } })
  })

  it('persists archived scaffold metadata without deleting the scaffold file', async () => {
    const root = await createRoot()
    const relativePath = 'MISSION.md'
    const missionPath = join(root, relativePath)
    await writeFile(missionPath, '# Mission', 'utf8')
    const { executor } = createExecutor({
      appDataRoot: join(root, 'app-data'),
      workspaceIndex: indexFor(root, [], { [relativePath]: { pinned: true } })
    })

    const state = await executor.execute({
      workspace: workspace(root),
      target: { relativePath, kind: 'file' },
      intent: { type: 'remove', mode: 'list' }
    })

    await expect(readFile(missionPath, 'utf8')).resolves.toBe('# Mission')
    expect(state.durableIndex.pathMeta).toEqual({ [relativePath]: { pinned: true, archived: true } })
  })

  it('removes a temporary Agent conversation through its distinct app-data representation', async () => {
    const root = await createRoot()
    const appDataRoot = join(root, 'app-data')
    const conversationId = 'chat-temporary-executor'
    const relativePath = `conversations/${conversationId}.md`
    const markdownPath = join(appDataRoot, relativePath)
    const jsonPath = join(appDataRoot, 'conversations', `${conversationId}.json`)
    await mkdir(join(appDataRoot, 'conversations'), { recursive: true })
    await Promise.all([
      writeFile(markdownPath, '# Temporary conversation', 'utf8'),
      writeFile(jsonPath, '{"id":"chat-temporary-executor"}', 'utf8')
    ])
    const events: string[] = []
    const { executor } = createExecutor({
      appDataRoot,
      workspaceIndex: indexFor(root, [], { [relativePath]: { pinned: true } }),
      temporaryIndex: { pathMeta: { [relativePath]: { pinned: true } } },
      hasTemporaryConversation: async (id) => id === conversationId,
      events
    })

    const state = await executor.execute({
      workspace: workspace(root),
      target: { relativePath, kind: 'conversation' },
      intent: { type: 'remove', mode: 'disk' }
    })

    await Promise.all([expectMissing(markdownPath), expectMissing(jsonPath)])
    expect(state.temporaryIndex.pathMeta).toEqual({})
    expect(state.durableIndex.pathMeta).toEqual({ [relativePath]: { pinned: true } })
    expect(events).toEqual(['save-temporary', 'rebuild'])
  })
})