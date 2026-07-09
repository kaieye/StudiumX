import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { listSidebarCourseFolders, listSidebarWorkspaceFolders } from '../../src/shared/course-sidebar'
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
  const sidebarWorkspaceFolders = listSidebarWorkspaceFolders(imported.workspaces, false)
  assert.deepEqual(
    sidebarWorkspaceFolders.map(({ workspace, node }) => ({ id: workspace.id, name: node.name, rootPath: node.absolutePath })),
    imported.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, rootPath: workspace.rootPath })),
    'left course directory should list the same workspace folders as the dialog folder picker'
  )
  assert.equal(
    sidebarWorkspaceFolders.some(({ workspace, node }) =>
      workspace.id === active.id && node.name === active.name && node.absolutePath === active.rootPath
    ),
    true,
    'left course directory should include the imported workspace folder immediately after import'
  )
  const importedWorkspaceNode = sidebarWorkspaceFolders.find(({ workspace }) => workspace.id === active.id)?.node
  assert.ok(importedWorkspaceNode)
  assert.deepEqual(
    importedWorkspaceNode.children?.map((node) => node.name).slice(0, 6),
    ['lessons', 'conversation', 'MISSION.md', 'GLOSSARY.md', 'RESOURCES.md', 'NOTES.md'],
    'imported tutorial folder should expose lessons and conversation before sibling markdown files'
  )
  assert.deepEqual(
    importedWorkspaceNode.children
      ?.filter((node) => node.kind === 'file' && node.name.endsWith('.md'))
      .map((node) => node.relativePath)
      .sort(),
    ['GLOSSARY.md', 'MISSION.md', 'NOTES.md', 'RESOURCES.md'],
    'workspace root teaching markdown files should be selectable from the course sidebar'
  )
  assert.equal(
    await stat(join(sourceRoot, 'conversation')).then((info) => info.isDirectory()).catch(() => false),
    true,
    'importing a tutorial folder should create the root conversation directory'
  )
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
  const selectedSidebarWorkspaceFolders = listSidebarWorkspaceFolders(selected.workspaces, false)
  assert.deepEqual(
    selectedSidebarWorkspaceFolders.map(({ workspace, node }) => ({ id: workspace.id, name: node.name, rootPath: node.absolutePath })),
    selected.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, rootPath: workspace.rootPath })),
    'left course directory workspace folders should stay aligned with the dialog folder picker after switching workspaces'
  )
  const selectedVisibleCourseKeys = new Set(selectedSidebarFolders.map(({ workspace, node }) => `${workspace.id}:${node.relativePath}`))
  assert.equal(
    selectedVisibleCourseKeys.has(`${active.id}:lessons`),
    true,
    'switching workspaces should not clear course folders from the left course list'
  )

  const pinnedWorkspaceState = await service.setWorkspaceItemMeta({
    workspaceId: current.id,
    relativePath: '',
    pinned: true
  })
  const pinnedSidebarWorkspaceFolders = listSidebarWorkspaceFolders(pinnedWorkspaceState.workspaces, false)
  assert.equal(
    pinnedWorkspaceState.workspaces[0]?.id,
    current.id,
    'pinning a top-level workspace folder should move it to the top of the shared workspace list'
  )
  assert.equal(
    pinnedSidebarWorkspaceFolders[0]?.node.pinned,
    true,
    'pinning a top-level workspace folder should expose its pinned state in the left course directory'
  )

  const pathMetaLesson = 'lessons/0001-existing.html'
  await service.setWorkspaceItemMeta({
    workspaceId: current.id,
    relativePath: pathMetaLesson,
    pinned: true
  })
  let workspaceIndex = JSON.parse(await readFile(join(current.rootPath, '.teachos', 'index.json'), 'utf8'))
  assert.deepEqual(
    workspaceIndex.pathMeta[pathMetaLesson],
    { pinned: true },
    'workspace item metadata should record a pinned path'
  )
  await service.setWorkspaceItemMeta({
    workspaceId: current.id,
    relativePath: pathMetaLesson,
    archived: true
  })
  workspaceIndex = JSON.parse(await readFile(join(current.rootPath, '.teachos', 'index.json'), 'utf8'))
  assert.deepEqual(
    workspaceIndex.pathMeta[pathMetaLesson],
    { pinned: true, archived: true },
    'workspace item metadata should merge archived without dropping pinned'
  )
  await service.setWorkspaceItemMeta({
    workspaceId: current.id,
    relativePath: pathMetaLesson,
    pinned: null,
    archived: null
  })
  workspaceIndex = JSON.parse(await readFile(join(current.rootPath, '.teachos', 'index.json'), 'utf8'))
  assert.equal(
    workspaceIndex.pathMeta?.[pathMetaLesson],
    undefined,
    'workspace item metadata should remove empty pathMeta entries after clearing flags'
  )

  const archiveRoot = join(tempRoot, 'workspace-archive')
  await mkdir(archiveRoot, { recursive: true })
  await writeFile(join(archiveRoot, 'MISSION.md'), '# Mission: Archive Workspace\n', 'utf8')
  await writeFile(join(archiveRoot, 'RESOURCES.md'), '# Resources\n', 'utf8')
  const archiveImportState = await service.importWorkspace(archiveRoot)
  const archiveWorkspace = archiveImportState.activeWorkspace
  assert.ok(archiveWorkspace)
  const archivedWorkspaceState = await service.setWorkspaceItemMeta({
    workspaceId: archiveWorkspace.id,
    relativePath: '',
    archived: true
  })
  assert.equal(
    archivedWorkspaceState.workspaces.some((workspace) => workspace.id === archiveWorkspace.id),
    false,
    'archiving a top-level workspace folder should hide it from the shared workspace list'
  )
  assert.equal(
    listSidebarWorkspaceFolders(archivedWorkspaceState.workspaces, false).some(({ workspace }) => workspace.id === archiveWorkspace.id),
    false,
    'archiving a top-level workspace folder should hide it from the left course directory'
  )
  assert.equal(
    await stat(archiveRoot).then(() => true).catch(() => false),
    true,
    'archiving a top-level workspace folder should keep its files on disk'
  )
  const restoredArchivedWorkspace = await service.importWorkspace(archiveRoot)
  assert.equal(
    restoredArchivedWorkspace.workspaces.some((workspace) => workspace.id === archiveWorkspace.id),
    true,
    're-importing an archived workspace should make the top-level folder visible again'
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
  const diskCourseDir = join(current.rootPath, diskCoursePath)
  const diskLessonPath = join(current.rootPath, diskCoursePath, '0001-disk.html')
  await mkdir(diskCourseDir, { recursive: true })
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
  assert.equal(
    await stat(diskCourseDir).then(() => true).catch(() => false),
    false,
    'removing a course from disk should delete the course folder itself'
  )

  const defaultLessonsDir = join(current.rootPath, 'lessons')
  await service.selectWorkspace(current.id)
  await service.removeWorkspaceItem({
    workspaceId: current.id,
    relativePath: 'lessons',
    kind: 'directory',
    mode: 'disk'
  })
  assert.equal(
    await stat(defaultLessonsDir).then(() => true).catch(() => false),
    false,
    'removing the default lessons folder from disk should delete the folder itself'
  )

  const listRemovalRoot = join(tempRoot, 'workspace-remove-from-list')
  await mkdir(listRemovalRoot, { recursive: true })
  await writeFile(join(listRemovalRoot, 'MISSION.md'), '# Mission: Remove From List\n', 'utf8')
  await writeFile(join(listRemovalRoot, 'RESOURCES.md'), '# Resources\n', 'utf8')
  const listRemovalState = await service.importWorkspace(listRemovalRoot)
  const listRemovalWorkspace = listRemovalState.activeWorkspace
  assert.ok(listRemovalWorkspace)
  const afterWorkspaceListRemoval = await service.removeWorkspace({
    workspaceId: listRemovalWorkspace.id,
    mode: 'list'
  })
  assert.equal(
    afterWorkspaceListRemoval.workspaces.some((workspace) => workspace.id === listRemovalWorkspace.id),
    false,
    'removing a workspace from the list should hide its folder from the left course directory'
  )
  assert.equal(
    await stat(listRemovalRoot).then(() => true).catch(() => false),
    true,
    'removing a workspace from the list should keep its files on disk'
  )
  assert.deepEqual(
    listSidebarWorkspaceFolders(afterWorkspaceListRemoval.workspaces, false).map(({ workspace, node }) => ({ id: workspace.id, name: node.name, rootPath: node.absolutePath })),
    afterWorkspaceListRemoval.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, rootPath: workspace.rootPath })),
    'left course directory workspace folders should stay aligned after removing a workspace from the list'
  )

  const managedDiskRemovalState = await service.createWorkspace({
    name: 'managed-workspace-remove-from-disk',
    prompt: '学习托管工作区删除'
  })
  const managedDiskRemovalWorkspace = managedDiskRemovalState.activeWorkspace
  assert.ok(managedDiskRemovalWorkspace)
  const managedDiskRemovalRoot = managedDiskRemovalWorkspace.rootPath
  const afterManagedWorkspaceDiskRemoval = await service.removeWorkspace({
    workspaceId: managedDiskRemovalWorkspace.id,
    mode: 'disk'
  })
  assert.equal(
    afterManagedWorkspaceDiskRemoval.workspaces.some((workspace) => workspace.id === managedDiskRemovalWorkspace.id),
    false,
    'removing a managed workspace from disk should hide its folder from the left course directory'
  )
  assert.equal(
    await stat(managedDiskRemovalRoot).then(() => true).catch(() => false),
    false,
    'removing a managed workspace from disk should delete the workspace folder itself'
  )

  const importedDiskRemovalRoot = join(tempRoot, 'imported-workspace-remove-from-disk')
  await mkdir(importedDiskRemovalRoot, { recursive: true })
  await writeFile(join(importedDiskRemovalRoot, 'MISSION.md'), '# Mission: Imported Remove From Disk\n', 'utf8')
  await writeFile(join(importedDiskRemovalRoot, 'RESOURCES.md'), '# Resources\n', 'utf8')
  const importedDiskRemovalState = await service.importWorkspace(importedDiskRemovalRoot)
  const importedDiskRemovalWorkspace = importedDiskRemovalState.activeWorkspace
  assert.ok(importedDiskRemovalWorkspace)
  await assert.rejects(
    () => service.removeWorkspace({
      workspaceId: importedDiskRemovalWorkspace.id,
      mode: 'disk'
    }),
    /Only workspaces inside the configured TeachOS workspace root/,
    'removing an imported workspace from disk should be denied'
  )
  assert.equal(
    await stat(importedDiskRemovalRoot).then(() => true).catch(() => false),
    true,
    'denying disk removal for an imported workspace should keep its files'
  )
  const afterImportedWorkspaceListRemoval = await service.removeWorkspace({
    workspaceId: importedDiskRemovalWorkspace.id,
    mode: 'list'
  })
  assert.equal(
    afterImportedWorkspaceListRemoval.workspaces.some((workspace) => workspace.id === importedDiskRemovalWorkspace.id),
    false,
    'removing an imported workspace from the list should still hide it from the left course directory'
  )

  console.log('workspace course sidebar aggregation ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
