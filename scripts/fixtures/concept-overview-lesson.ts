import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-concept-overview-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.provider.providers = settings.provider.providers.map((provider) => ({ ...provider, apiKey: '' }))

  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'teachos-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings
  })

  const state = await service.createWorkspace({ name: 'learn', prompt: '学习目标、可信资源、课程讲义和复习记录沉淀为本地文件。' })
  const workspace = state.activeWorkspace
  assert.ok(workspace)
  assert.equal(await stat(join(workspace.rootPath, 'courses')).then(() => true).catch(() => false), false)

  const result = await service.generateLesson({
    workspaceId: workspace.id,
    prompt: '我只需要了解一下概念就行了',
    messages: [
      { role: 'user', content: '我想学习springboot' },
      {
        role: 'assistant',
        content: '请回答背景、目标和约束，以便生成第一节课。'
      }
    ]
  })

  assert.equal(result.kind, 'lesson')
  if (result.kind === 'lesson') {
    assert.match(result.lesson.prompt, /springboot|Spring Boot/i)
    assert.match(result.lesson.prompt, /概念/)
    assert.match(result.lesson.relativePath, /^lessons\//)
    const html = await readFile(result.lesson.absolutePath, 'utf8')
    assert.match(html, /<!doctype html>/i)
  }

  console.log('concept overview lesson generation ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
