import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listSidebarCourseFolders, listSidebarWorkspaceFolders } from '../../src/shared/course-sidebar'
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
  await mkdir(join(workspace.rootPath, 'conversations'), { recursive: true })

  const saved = await service.saveAgentConversation({
    workspaceId: workspace.id,
    mode: 'teaching',
    selectedCourseRelativePath,
    turns: [
      { id: 'u1', role: 'user', content: '我想学习 RAG 检索', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'a1', role: 'assistant', content: '先确认你的目标。', createdAt: '2026-07-01T00:00:01.000Z' }
    ]
  })

  assert.equal(saved.conversation.relativePath.startsWith('conversation/'), true)
  assert.equal(await stat(join(workspace.rootPath, 'lessons')).then((info) => info.isDirectory()).catch(() => false), true)
  assert.equal(await stat(join(workspace.rootPath, 'conversation')).then((info) => info.isDirectory()).catch(() => false), true)
  assert.equal(await stat(join(workspace.rootPath, 'lessons', 'conversation')).then(() => true).catch(() => false), false)
  assert.equal(saved.state.activeWorkspace?.conversations.some((item) => item.id === saved.conversation.id), true)
  assert.equal(saved.state.temporaryConversations.some((item) => item.id === saved.conversation.id), false)
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

  const selectedCourseNode = listSidebarCourseFolders(saved.state.workspaces, false)
    .find(({ workspace, node }) => workspace.id === saved.state.activeWorkspace?.id && node.relativePath === selectedCourseRelativePath)
    ?.node
  assert.ok(selectedCourseNode)
  assert.deepEqual(
    selectedCourseNode.children?.map((node) => node.name).sort(),
    ['conversation', 'lessons'],
    'course folders should expose lessons and conversation directories'
  )
  const conversationFolder = selectedCourseNode.children?.find((node) => node.relativePath === 'conversation')
  assert.ok(conversationFolder)
  assert.equal(conversationFolder.children?.some((node) => node.relativePath === saved.conversation.relativePath), true)
  const selectedCourseNodeWithAllFiles = listSidebarCourseFolders(saved.state.workspaces, true)
    .find(({ workspace, node }) => workspace.id === saved.state.activeWorkspace?.id && node.relativePath === selectedCourseRelativePath)
    ?.node
  assert.ok(selectedCourseNodeWithAllFiles)
  assert.deepEqual(
    selectedCourseNodeWithAllFiles.children?.map((node) => node.name).sort(),
    ['conversation', 'lessons'],
    'course folders should keep the lessons/conversation display shape when all course files are shown'
  )
  const selectedWorkspaceNode = listSidebarWorkspaceFolders(saved.state.workspaces, false)
    .find(({ workspace }) => workspace.id === saved.state.activeWorkspace?.id)
    ?.node
  assert.ok(selectedWorkspaceNode)
  assert.deepEqual(
    selectedWorkspaceNode.children?.map((node) => node.name).sort(),
    ['conversation', 'lessons'],
    'imported workspace folders should display lessons and conversation directly under the tutorial root'
  )

  const loaded = await service.readAgentConversation({
    workspaceId: workspace.id,
    conversationId: saved.conversation.id
  })
  assert.equal(loaded.relativePath, saved.conversation.relativePath)

  const customCourseRelativePath = 'courses/rag-project'
  const customCourseConversation = await service.saveAgentConversation({
    workspaceId: workspace.id,
    mode: 'teaching',
    selectedCourseRelativePath: customCourseRelativePath,
    turns: [
      { id: 'cu1', role: 'user', content: '继续 RAG 项目课', createdAt: '2026-07-01T00:00:01.500Z' },
      { id: 'ca1', role: 'assistant', content: '我们放到自定义课程下。', createdAt: '2026-07-01T00:00:01.600Z' }
    ]
  })
  assert.equal(customCourseConversation.conversation.relativePath.startsWith(`${customCourseRelativePath}/conversation/`), true)
  assert.equal(
    customCourseConversation.state.activeWorkspace?.courses.some((course) =>
      course.relativePath === customCourseRelativePath &&
      course.conversations.some((conversation) => conversation.id === customCourseConversation.conversation.id)
    ),
    true,
    'selected custom courses should keep teaching conversations inside their conversation folder'
  )

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
