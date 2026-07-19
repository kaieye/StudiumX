import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import {
  listAgentConversations,
  listPersistedAgentConversationRecords,
  readAgentConversationRecord,
  writeAgentConversationRecord
} from '../../src/main/teaching-agent-conversations'
import {
  agentConversationJsonRelativePathForMarkdown,
  agentConversationSessionArtifactDirectoryRelativePathForMarkdown,
  agentConversationSessionAuditRelativePathForMarkdown
} from '../../src/shared/agent-conversation-catalog'
import { planTemporaryConversationDiskRemoval } from '../../src/main/teaching-workspace/item-lifecycle'
import { TeachingWorkspaceItemLifecycleExecutor } from '../../src/main/teaching-workspace/item-lifecycle-executor'
import type { WorkspaceIndex } from '../../src/main/teaching-workspace/lifecycle'
import type { RegistryWorkspace } from '../../src/main/teaching-workspace/registry'
import type { AgentConversationRecord, LessonSummary } from '../../src/shared/teaching-types'
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
      await mkdir(join(index.rootPath, '.studiumx'), { recursive: true })
      await writeFile(join(index.rootPath, '.studiumx', 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
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

  it('removes every durable Agent conversation artifact from disk', async () => {
    const root = await createRoot()
    const conversationId = 'chat-durable-executor'
    const relativePath = `conversation/${conversationId}.md`
    const conversationDirectory = join(root, 'conversation')
    const markdownPath = join(root, relativePath)
    const jsonPath = join(conversationDirectory, `${conversationId}.json`)
    const auditPath = join(conversationDirectory, '.agent-sessions', `${conversationId}.jsonl`)
    const artifactDirectory = join(conversationDirectory, '.agent-sessions', conversationId)
    const childTranscriptPath = join(artifactDirectory, 'child-transcripts', 'child-1.jsonl')
    await mkdir(join(artifactDirectory, 'child-transcripts'), { recursive: true })
    await Promise.all([
      writeFile(markdownPath, '# Durable conversation', 'utf8'),
      writeFile(jsonPath, '{"id":"chat-durable-executor"}', 'utf8'),
      writeFile(auditPath, '{}\n', 'utf8'),
      writeFile(childTranscriptPath, '{}\n', 'utf8')
    ])
    const events: string[] = []
    const { executor } = createExecutor({
      appDataRoot: join(root, 'app-data'),
      workspaceIndex: indexFor(root, [], { [relativePath]: { pinned: true } }),
      events
    })

    const state = await executor.execute({
      workspace: workspace(root),
      target: { relativePath, kind: 'conversation' },
      intent: { type: 'remove', mode: 'disk' }
    })

    await Promise.all([
      expectMissing(markdownPath),
      expectMissing(jsonPath),
      expectMissing(auditPath),
      expectMissing(artifactDirectory)
    ])
    expect(state.durableIndex.pathMeta).toEqual({})
    expect(events).toEqual(['save-durable', 'rebuild'])
  })

  it('removes a partitioned temporary conversation and its sidecars so catalog scanners no longer find it', async () => {
    const root = await createRoot()
    const appDataRoot = join(root, 'app-data')
    const conversationId = 'chat-temporary-partitioned-executor'
    const relativePath = `conversations/2026/07/${conversationId}.md`
    const record: AgentConversationRecord = {
      id: conversationId,
      workspaceId: 'workspace-1',
      title: 'Partitioned temporary conversation',
      createdAt: timestamp,
      updatedAt: timestamp,
      relativePath,
      absolutePath: join(appDataRoot, relativePath),
      messageCount: 1,
      turns: [{ id: 'turn-1', role: 'user', content: 'Temporary', createdAt: timestamp }]
    }
    await writeAgentConversationRecord({ id: 'workspace-1', name: 'Temporary', rootPath: appDataRoot }, record)

    const jsonPath = join(appDataRoot, agentConversationJsonRelativePathForMarkdown(relativePath))
    const markdownPath = join(appDataRoot, relativePath)
    const auditPath = join(appDataRoot, agentConversationSessionAuditRelativePathForMarkdown(relativePath))
    const artifactDirectory = join(appDataRoot, agentConversationSessionArtifactDirectoryRelativePathForMarkdown(relativePath))
    const artifactPath = join(artifactDirectory, 'tool-results', 'result.json')
    await mkdir(join(artifactDirectory, 'tool-results'), { recursive: true })
    await writeFile(artifactPath, '{"result":"temporary"}\n', 'utf8')

    await expect(listPersistedAgentConversationRecords(appDataRoot)).resolves.toHaveLength(1)
    await expect(listAgentConversations(appDataRoot, {}, {
      includeRoot: true,
      includeRootConversation: false,
      includeLegacyRootConversations: true,
      includeLessons: false,
      includeCourses: false
    })).resolves.toMatchObject([{ id: conversationId, relativePath }])

    const events: string[] = []
    const { executor } = createExecutor({
      appDataRoot,
      workspaceIndex: indexFor(root, [], { [relativePath]: { pinned: true } }),
      temporaryIndex: { pathMeta: { [relativePath]: { pinned: true } } },
      hasTemporaryConversation: async (id) => readAgentConversationRecord(appDataRoot, id).then(() => true).catch(() => false),
      events
    })

    const state = await executor.execute({
      workspace: workspace(root),
      target: { relativePath, kind: 'conversation' },
      intent: { type: 'remove', mode: 'disk' }
    })

    await Promise.all([
      expectMissing(jsonPath),
      expectMissing(markdownPath),
      expectMissing(auditPath),
      expectMissing(artifactDirectory),
      expectMissing(artifactPath)
    ])
    await expect(readAgentConversationRecord(appDataRoot, conversationId)).rejects.toThrow('Conversation not found.')
    await expect(listPersistedAgentConversationRecords(appDataRoot)).resolves.toEqual([])
    await expect(listAgentConversations(appDataRoot, {}, {
      includeRoot: true,
      includeRootConversation: false,
      includeLegacyRootConversations: true,
      includeLessons: false,
      includeCourses: false
    })).resolves.toEqual([])
    expect(state.temporaryIndex.pathMeta).toEqual({})
    expect(events).toEqual(['save-temporary', 'rebuild'])
  })

  it('rejects traversal paths before they can be used as a temporary deletion base', async () => {
    const root = await createRoot()
    expect(() => planTemporaryConversationDiskRemoval(
      join(root, 'app-data'),
      'conversations/2026/07/../../chat-traversal.md'
    )).toThrow('Conversation path is outside a conversations directory.')
  })

  it('removes a temporary Agent conversation through its distinct app-data representation', async () => {
    const root = await createRoot()
    const appDataRoot = join(root, 'app-data')
    const conversationId = 'chat-temporary-executor'
    const relativePath = `conversations/${conversationId}.md`
    const markdownPath = join(appDataRoot, relativePath)
    const jsonPath = join(appDataRoot, 'conversations', `${conversationId}.json`)
    const auditPath = join(appDataRoot, 'conversations', '.agent-sessions', `${conversationId}.jsonl`)
    const artifactDirectory = join(appDataRoot, 'conversations', '.agent-sessions', conversationId)
    const childTranscriptPath = join(artifactDirectory, 'child-transcripts', 'child-1.jsonl')
    await mkdir(join(artifactDirectory, 'child-transcripts'), { recursive: true })
    await Promise.all([
      writeFile(markdownPath, '# Temporary conversation', 'utf8'),
      writeFile(jsonPath, '{"id":"chat-temporary-executor"}', 'utf8'),
      writeFile(auditPath, '{}\n', 'utf8'),
      writeFile(childTranscriptPath, '{}\n', 'utf8')
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

    await Promise.all([
      expectMissing(markdownPath),
      expectMissing(jsonPath),
      expectMissing(auditPath),
      expectMissing(artifactDirectory)
    ])
    expect(state.temporaryIndex.pathMeta).toEqual({})
    expect(state.durableIndex.pathMeta).toEqual({ [relativePath]: { pinned: true } })
    expect(events).toEqual(['save-temporary', 'rebuild'])
  })
})