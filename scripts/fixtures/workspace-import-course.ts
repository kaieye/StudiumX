import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listSidebarCourseFolders } from '../../src/shared/course-sidebar'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'teachos-workspace-import-course-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'teachos-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => settings
  })

  const state = await service.createWorkspace({ name: 'current-workspace', prompt: '学习当前课程集' })
  const current = state.activeWorkspace
  assert.ok(current)

  await mkdir(join(current.rootPath, 'lessons'), { recursive: true })
  await writeFile(
    join(current.rootPath, 'lessons', '0001-existing.html'),
    '<!doctype html><title>Existing</title>',
    'utf8'
  )

  const sourceRoot = join(tempRoot, 'imported-course')
  await mkdir(join(sourceRoot, 'lessons'), { recursive: true })
  await writeFile(join(sourceRoot, 'MISSION.md'), '# Mission: Imported Course\n\n## Why\n导入课程。', 'utf8')
  await writeFile(join(sourceRoot, 'RESOURCES.md'), '# Resources\n', 'utf8')
  await writeFile(
    join(sourceRoot, 'lessons', '0001-imported.html'),
    '<!doctype html><title>Imported</title>',
    'utf8'
  )

  const imported = await service.importWorkspace(sourceRoot)
  const active = imported.activeWorkspace
  assert.ok(active)
  assert.notEqual(active.id, current.id, 'importing a teaching workspace can switch the active workspace')
  assert.equal(imported.workspaces.length, 2, 'imported teaching workspace should remain registered as a workspace')

  const sidebarFolders = listSidebarCourseFolders(imported.workspaces, false)
  const visibleCourseKeys = new Set(sidebarFolders.map(({ workspace, node }) => `${workspace.id}:${node.relativePath}`))
  assert.equal(
    visibleCourseKeys.has(`${current.id}:lessons`),
    true,
    'left course folder list should keep courses from the previous workspace'
  )
  assert.equal(
    visibleCourseKeys.has(`${active.id}:lessons`),
    true,
    'left course folder list should include courses from the imported active workspace'
  )

  const selected = await service.selectWorkspace(current.id)
  const selectedSidebarFolders = listSidebarCourseFolders(selected.workspaces, false)
  const selectedVisibleCourseKeys = new Set(selectedSidebarFolders.map(({ workspace, node }) => `${workspace.id}:${node.relativePath}`))
  assert.equal(
    selectedVisibleCourseKeys.has(`${active.id}:lessons`),
    true,
    'switching workspaces should not clear course folders from the left course list'
  )

  console.log('workspace course sidebar aggregation ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
