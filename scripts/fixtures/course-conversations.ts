import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-course-conversations-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'teachos-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings
  })

  const state = await service.createWorkspace({ name: 'teach-rag', prompt: '学习 RAG' })
  const workspace = state.activeWorkspace
  assert.ok(workspace)

  const selectedCourseRelativePath = 'lessons'
  await mkdir(join(workspace.rootPath, selectedCourseRelativePath), { recursive: true })

  const saved = await service.saveAgentConversation({
    workspaceId: workspace.id,
    mode: 'teaching',
    selectedCourseRelativePath,
    turns: [
      { id: 'u1', role: 'user', content: '我想学习 RAG 检索', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '先确认你的目标。', createdAt: '2026-07-01T00:00:01.000Z' }
    ]
  })

  assert.equal(saved.conversation.relativePath.startsWith('lessons/conversations/'), true)
  assert.equal(saved.state.activeWorkspace?.conversations.some((item) => item.id === saved.conversation.id), true)
  assert.equal(
    saved.state.activeWorkspace?.courses.some((course) =>
      course.relativePath === selectedCourseRelativePath &&
      course.conversations.some((conversation) => conversation.id === saved.conversation.id)
    ),
    true,
    'workspace course should list saved teaching conversations as sessions'
  )
  assert.equal(
    saved.state.activeWorkspace?.courses.some((course) => course.relativePath === selectedCourseRelativePath),
    true,
    'workspace course should be visible in the course list after saving a teaching conversation'
  )

  const selectedCourseNode = saved.state.activeWorkspace?.fileTree.find((node) => node.relativePath === selectedCourseRelativePath)
  assert.ok(selectedCourseNode)
  const conversationFolder = selectedCourseNode.children?.find((node) => node.relativePath === 'lessons/conversations')
  assert.ok(conversationFolder)
  assert.equal(conversationFolder.children?.some((node) => node.relativePath === saved.conversation.relativePath), true)

  const loaded = await service.readAgentConversation({
    workspaceId: workspace.id,
    conversationId: saved.conversation.id
  })
  assert.equal(loaded.relativePath, saved.conversation.relativePath)

  const temporary = await service.saveAgentConversation({
    workspaceId: workspace.id,
    mode: 'temporary',
    turns: [
      { id: 'tu1', role: 'user', content: '这只是临时聊天', createdAt: '2026-07-01T00:00:02.000Z' },
      { id: 'ta1', role: 'assistant', content: '不会进入课程文件夹。', createdAt: '2026-07-01T00:00:03.000Z' }
    ]
  })
  assert.equal(temporary.conversation.relativePath.startsWith('conversations/'), true)
  assert.equal(temporary.conversation.absolutePath.startsWith(join(tempRoot, 'user-data', 'conversations')), true)
  assert.equal(temporary.state.temporaryConversations.some((item) => item.id === temporary.conversation.id), true)
  assert.equal(temporary.conversation.relativePath.startsWith(`${selectedCourseRelativePath}/`), false)

  console.log('course and temporary conversation placement ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
