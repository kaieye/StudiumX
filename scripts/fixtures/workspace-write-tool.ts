import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  // Lesson pages must be rejected: they go through the generate_lesson
  // pipeline so numbering, template rendering, and index registration stay
  // consistent (and weaker providers never stream a huge HTML tool call).
  const lessonRejection = JSON.parse(await handlers.write_workspace_file({
    path: 'lessons/0001-rag-concepts-for-interview.html',
    content: '<!doctype html><title>RAG</title>'
  }))
  assert.match(lessonRejection.error, /generate_lesson/, 'lessons/*.html writes should redirect to generate_lesson')
  assert.equal(
    await stat(join(workspace.rootPath, 'lessons', '0001-rag-concepts-for-interview.html')).then(() => true).catch(() => false),
    false,
    'rejected lesson write must not create a file'
  )

  // Reference material stays agent-writable.
  const referenceRelativePath = 'reference/rag-glossary.html'
  const html = [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>RAG 术语表</title></head>',
    '<body><h1>RAG 核心概念</h1><p>Retrieval-Augmented Generation</p></body>',
    '</html>'
  ].join('\n')
  const writeResult = JSON.parse(await handlers.write_workspace_file({
    path: referenceRelativePath,
    content: html
  }))
  assert.equal(writeResult.path, referenceRelativePath)
  assert.equal(writeResult.created, true)
  assert.equal(await stat(join(workspace.rootPath, referenceRelativePath)).then((info) => info.isFile()).catch(() => false), true)
  assert.match(await readFile(join(workspace.rootPath, referenceRelativePath), 'utf8'), /RAG 核心概念/)

  const duplicateResult = JSON.parse(await handlers.write_workspace_file({
    path: referenceRelativePath,
    content: '<!doctype html><title>overwrite</title>'
  }))
  assert.match(duplicateResult.error, /文件已存在/, 'write_workspace_file should not overwrite by default')

  const outsideTarget = join(tempRoot, 'outside-created-through-dangling-symlink.md')
  const danglingLinkRelativePath = 'reference/dangling-link.md'
  await mkdir(join(workspace.rootPath, 'reference'), { recursive: true })
  await symlink(outsideTarget, join(workspace.rootPath, danglingLinkRelativePath))

  const danglingSymlinkResult = JSON.parse(await handlers.write_workspace_file({
    path: danglingLinkRelativePath,
    content: 'must not be written outside the workspace',
    overwrite: true
  }))
  assert.match(danglingSymlinkResult.error, /符号链接/, 'dangling symlink write targets should be rejected')
  assert.equal(
    await stat(outsideTarget).then(() => true).catch(() => false),
    false,
    'rejected dangling symlink write must not create the external target'
  )

  console.log('workspace write tool boundaries ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
