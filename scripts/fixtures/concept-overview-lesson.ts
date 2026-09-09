import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { SkillLibraryService } from '../../src/main/skill-library'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-concept-overview-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.provider.providers = settings.provider.providers.map((provider) => ({ ...provider, apiKey: '' }))

  const skillLibraryService = new SkillLibraryService({
    builtInRoots: [join(process.cwd(), 'resources', 'builtin-skills')],
    personalRoot: join(tempRoot, '.studiumx', 'skills')
  })
  await skillLibraryService.installSkill('teach')

  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'studiumx-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings,
    skillLibraryService
  })

  const state = await service.createWorkspace({ name: 'learn', prompt: '学习目标、可信资源、课程讲义和复习记录沉淀为本地文件。' })
  const workspace = state.activeWorkspace
  assert.ok(workspace)
  assert.equal(await stat(join(workspace.rootPath, 'lessons')).then((info) => info.isDirectory()).catch(() => false), true)
  assert.equal(await stat(join(workspace.rootPath, 'conversation')).then((info) => info.isDirectory()).catch(() => false), true)
  assert.equal(await stat(join(workspace.rootPath, 'courses')).then(() => true).catch(() => false), false)

  const result = await service.generateLesson({
    workspaceId: workspace.id,
    actionId: randomUUID(),
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
    assert.match(result.lesson.relativePath, /^lessons\/[^/]+\.html$/)
    const html = await readFile(result.lesson.absolutePath, 'utf8')
    assert.match(html, /<!doctype html>/i)
  }

  const customCourse = await service.generateLesson({
    workspaceId: workspace.id,
    actionId: randomUUID(),
    prompt: '继续学习 Spring Boot 配置',
    courseName: 'Spring Boot Track',
    messages: []
  })

  assert.equal(customCourse.kind, 'lesson')
  if (customCourse.kind === 'lesson') {
    assert.equal(customCourse.lesson.courseRelativePath, 'courses/spring-boot-track')
    assert.equal(customCourse.lesson.sessionRelativePath, 'courses/spring-boot-track/lesson')
    assert.match(customCourse.lesson.relativePath, /^courses\/spring-boot-track\/lesson\/0002-.+\.html$/)
    assert.equal(
      await stat(join(workspace.rootPath, 'courses', 'spring-boot-track', 'conversation')).then((info) => info.isDirectory()).catch(() => false),
      true,
      'custom Course generation should prepare the sibling conversation directory'
    )
  }

  console.log('concept overview lesson generation ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
