import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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

  const removableCoursePath = 'courses/indexed-course'
  const removableLessonPath = join(current.rootPath, removableCoursePath, '0001-indexed.html')
  await mkdir(join(current.rootPath, removableCoursePath), { recursive: true })
  await writeFile(removableLessonPath, '<!doctype html><title>Indexed</title>', 'utf8')
  const indexedState = await service.selectWorkspace(current.id)
  const indexedSidebarFolders = listSidebarCourseFolders(indexedState.workspaces, false)
  assert.equal(
    indexedSidebarFolders.some(({ workspace, node }) =>
      workspace.id === current.id && node.relativePath === removableCoursePath
    ),
    true,
    'left course folder list should include a course discovered from disk'
  )

  const removedFromList = await service.removeWorkspaceItem({
    workspaceId: current.id,
    relativePath: removableCoursePath,
    kind: 'directory',
    mode: 'list'
  })
  const afterListRemovalFolders = listSidebarCourseFolders(removedFromList.workspaces, false)
  assert.equal(
    afterListRemovalFolders.some(({ workspace, node }) =>
      workspace.id === current.id && node.relativePath === removableCoursePath
    ),
    false,
    'removing a course from the list should hide it from the left course folder list'
  )
  assert.equal(
    await stat(removableLessonPath).then(() => true).catch(() => false),
    true,
    'removing a course from the list should keep its files on disk'
  )

  const diskCoursePath = 'courses/disk-course'
  const diskLessonPath = join(current.rootPath, diskCoursePath, '0001-disk.html')
  await mkdir(join(current.rootPath, diskCoursePath), { recursive: true })
  await writeFile(diskLessonPath, '<!doctype html><title>Disk</title>', 'utf8')
  await service.selectWorkspace(current.id)
  const removedFromDisk = await service.removeWorkspaceItem({
    workspaceId: current.id,
    relativePath: diskCoursePath,
    kind: 'directory',
    mode: 'disk'
  })
  const afterDiskRemovalFolders = listSidebarCourseFolders(removedFromDisk.workspaces, false)
  assert.equal(
    afterDiskRemovalFolders.some(({ workspace, node }) =>
      workspace.id === current.id && node.relativePath === diskCoursePath
    ),
    false,
    'removing a course from disk should hide it from the left course folder list'
  )
  assert.equal(
    await stat(diskLessonPath).then(() => true).catch(() => false),
    false,
    'removing a course from disk should delete its files'
  )

  console.log('workspace course sidebar aggregation ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
