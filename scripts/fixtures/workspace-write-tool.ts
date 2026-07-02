import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listSidebarCourseFolders } from '../../src/shared/course-sidebar'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-workspace-write-tool-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.tools.enabled = true
  settings.tools.workspaceRead = true
  settings.tools.webSearch = false
  settings.tools.webFetch = false

  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'teachos-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings
  })

  const state = await service.createWorkspace({ name: 'learn', prompt: '学习 RAG 面试概念' })
  const workspace = state.activeWorkspace
  assert.ok(workspace)

  const readOnlyRegistry = buildDefaultRegistry(settings, { workspaceRoot: workspace.rootPath })
  assert.equal(
    readOnlyRegistry.definitions().some((tool) => tool.function.name === 'write_workspace_file'),
    false,
    'lesson research registries should stay read-only unless write access is explicitly requested'
  )

  const writeRegistry = buildDefaultRegistry(settings, {
    workspaceRoot: workspace.rootPath,
    workspaceWrite: true
  })
  const handlers = writeRegistry.handlerMap(buildToolContext(settings, { workspaceRoot: workspace.rootPath }))
  assert.equal(typeof handlers.write_workspace_file, 'function', 'teaching chat should expose write_workspace_file')

  const lessonRelativePath = 'lessons/0001-rag-concepts-for-interview.html'
  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>RAG 面试概念速通</title></head>',
    '<body><h1>RAG 核心概念</h1><p>Retrieval-Augmented Generation</p></body>',
    '</html>'
  ].join('\n')
  const writeResult = JSON.parse(await handlers.write_workspace_file({
    path: lessonRelativePath,
    content: html
  }))
  assert.equal(writeResult.path, lessonRelativePath)
  assert.equal(writeResult.created, true)
  assert.equal(await stat(join(workspace.rootPath, lessonRelativePath)).then((info) => info.isFile()).catch(() => false), true)
  assert.match(await readFile(join(workspace.rootPath, lessonRelativePath), 'utf8'), /RAG 核心概念/)

  const duplicateResult = JSON.parse(await handlers.write_workspace_file({
    path: lessonRelativePath,
    content: '<!doctype html><title>overwrite</title>'
  }))
  assert.match(duplicateResult.error, /文件已存在/, 'write_workspace_file should not overwrite by default')

  const saved = await service.saveAgentConversation({
    workspaceId: workspace.id,
    mode: 'teaching',
    selectedCourseRelativePath: 'lessons',
    turns: [
      { id: 'u1', role: 'user', content: '先给我制作html', createdAt: '2026-07-02T07:45:55.000Z' },
      { id: 'a1', role: 'assistant', content: `已保存到 ${lessonRelativePath}`, createdAt: '2026-07-02T07:46:10.000Z' }
    ]
  })
  assert.equal(
    saved.state.activeWorkspace?.lessons.some((lesson) => lesson.relativePath === lessonRelativePath),
    true,
    'saved teaching state should index HTML written by write_workspace_file'
  )

  const courseNode = listSidebarCourseFolders(saved.state.workspaces, false)
    .find(({ workspace: itemWorkspace, node }) =>
      itemWorkspace.id === saved.state.activeWorkspace?.id && node.relativePath === 'lessons'
    )
    ?.node
  const lessonFolder = courseNode?.children?.find((node) => node.relativePath === 'lessons')
  assert.equal(
    lessonFolder?.children?.some((node) => node.relativePath === lessonRelativePath),
    true,
    'left lesson folder should show HTML written by write_workspace_file'
  )

  console.log('workspace write tool lesson placement ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
