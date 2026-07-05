import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listSidebarWorkspaceFolders } from '../../src/shared/course-sidebar'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-workspace-markdown-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'teachos-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => defaultSettings(defaultRoot)
  })

  const created = await service.createWorkspace({ name: 'markdown-course', prompt: '学习 markdown 文档' })
  const workspace = created.activeWorkspace
  assert.ok(workspace)

  assert.equal(
    await stat(join(workspace.rootPath, 'MISSION.md')).then((info) => info.isFile()).catch(() => false),
    true,
    'new workspaces should have a root MISSION.md'
  )
  assert.equal(
    await stat(join(workspace.rootPath, 'GLOSSARY.md')).then((info) => info.isFile()).catch(() => false),
    true,
    'new workspaces should have a root GLOSSARY.md'
  )
  assert.equal(
    await stat(join(workspace.rootPath, 'RESOURCES.md')).then((info) => info.isFile()).catch(() => false),
    true,
    'new workspaces should have a root RESOURCES.md'
  )

  const sidebarRoot = listSidebarWorkspaceFolders(created.workspaces, false).find(({ workspace: item }) => item.id === workspace.id)?.node
  assert.ok(sidebarRoot)
  assert.deepEqual(
    sidebarRoot.children
      ?.filter((node) => node.kind === 'file' && node.name.endsWith('.md'))
      .map((node) => node.relativePath)
      .sort(),
    ['GLOSSARY.md', 'MISSION.md', 'RESOURCES.md'],
    'course sidebar should expose mission, glossary, and resources markdown files'
  )

  const mission = await service.readWorkspaceMarkdown({
    workspaceId: workspace.id,
    documentPath: 'MISSION.md'
  })
  assert.equal(mission.relativePath, 'MISSION.md')
  assert.match(mission.content, /^# Mission:/m)

  const saved = await service.saveWorkspaceMarkdown({
    workspaceId: workspace.id,
    documentPath: 'GLOSSARY.md',
    content: '# Glossary\n\n- Term：Definition\n'
  })
  assert.equal(saved.document.content, '# Glossary\n\n- Term：Definition\n')
  assert.equal(await readFile(join(workspace.rootPath, 'GLOSSARY.md'), 'utf8'), saved.document.content)
  assert.equal(saved.state.selectedLessonPath, join(workspace.rootPath, 'GLOSSARY.md'))

  const previewFile = await service.resolvePreviewFile(workspace.id, 'RESOURCES.md')
  assert.equal(previewFile?.mimeType, 'text/markdown; charset=utf-8')

  await assert.rejects(
    service.readWorkspaceMarkdown({ workspaceId: workspace.id, documentPath: '../outside.md' }),
    /outside the allowed workspace documents/,
    'markdown reads should reject paths outside the workspace'
  )
  await assert.rejects(
    service.saveWorkspaceMarkdown({ workspaceId: workspace.id, documentPath: 'assets/lesson.css', content: 'bad' }),
    /outside the allowed workspace documents/,
    'markdown writes should reject non-markdown files'
  )

  console.log('workspace markdown documents ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
