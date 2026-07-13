import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import type { TeachingWorkspaceSummary, WorkspaceFileNode } from '../../src/shared/teaching-types'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-catalog-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'studiumx-workspaces.json'),
    defaultRoot,
    settingsProvider: async () => defaultSettings(defaultRoot)
  })

  const created = await service.createWorkspace({ name: 'Catalog Verification', prompt: '验证教学工作区目录' })
  const workspace = created.activeWorkspace
  assert.ok(workspace, 'workspace should be created')

  assertCatalogDirectoryPaths(workspace)
  const indexPath = join(workspace.rootPath, '.teachos', 'index.json')
  const initialIndex = await readFile(indexPath, 'utf8')
  const initialStat = await stat(indexPath)

  const stableState = await service.getState({ activeWorkspaceId: workspace.id })
  assertCatalogDirectoryPaths(requireActiveWorkspace(stableState.activeWorkspace))
  assert.equal(await readFile(indexPath, 'utf8'), initialIndex, 'an unchanged getState must not rewrite the Lesson index')
  assert.equal((await stat(indexPath)).mtimeMs, initialStat.mtimeMs, 'an unchanged getState must preserve index mtime')

  const lessonRelativePath = 'courses/quantum-mechanics/lesson/0001-wave-functions.html'
  const lessonPath = join(workspace.rootPath, ...lessonRelativePath.split('/'))
  await mkdir(join(workspace.rootPath, 'courses', 'quantum-mechanics', 'lesson'), { recursive: true })
  await writeFile(lessonPath, '<!doctype html><title>Wave Functions</title>', 'utf8')

  const recoveredState = await service.getState({ activeWorkspaceId: workspace.id })
  const recoveredWorkspace = requireActiveWorkspace(recoveredState.activeWorkspace)
  assertCatalogDirectoryPaths(recoveredWorkspace)
  const recoveredLesson = recoveredWorkspace.lessons.find((lesson) => lesson.relativePath === lessonRelativePath)
  assert.ok(recoveredLesson, 'a Lesson added outside the app should be recovered into the catalog')
  assert.equal(recoveredLesson.courseRelativePath, 'courses/quantum-mechanics')
  assert.equal(recoveredLesson.courseName, 'Quantum Mechanics')
  assert.equal(recoveredLesson.sessionRelativePath, 'courses/quantum-mechanics/lesson')
  assert.equal(recoveredLesson.sessionName, 'Wave Functions')
  assert.equal(
    recoveredWorkspace.courses.find((course) => course.relativePath === 'courses/quantum-mechanics')?.sessions[0]?.lesson.relativePath,
    lessonRelativePath,
    'recovered Lessons should remain placed in their Course and Session'
  )
  assert.equal(findFileNode(recoveredWorkspace.fileTree, lessonRelativePath)?.pinned, false)

  const recoveredIndex = await readFile(indexPath, 'utf8')
  assert.match(recoveredIndex, /0001-wave-functions\.html/, 'the recovered Lesson should be durable exactly once')
  const recoveredStat = await stat(indexPath)

  await service.getState({ activeWorkspaceId: workspace.id })
  assert.equal(await readFile(indexPath, 'utf8'), recoveredIndex, 'a second getState must not rewrite an already recovered Lesson')
  assert.equal((await stat(indexPath)).mtimeMs, recoveredStat.mtimeMs, 'a reconciled Lesson index must stay stable on repeated reads')

  const pinnedState = await service.setWorkspaceItemMeta({
    workspaceId: workspace.id,
    relativePath: lessonRelativePath,
    pinned: true
  })
  const pinnedWorkspace = requireActiveWorkspace(pinnedState.activeWorkspace)
  assert.equal(pinnedWorkspace.lessons.find((lesson) => lesson.relativePath === lessonRelativePath)?.pinned, true)
  assert.equal(findFileNode(pinnedWorkspace.fileTree, lessonRelativePath)?.pinned, true)

  const archivedState = await service.removeWorkspaceItem({
    workspaceId: workspace.id,
    relativePath: lessonRelativePath,
    kind: 'file',
    mode: 'list'
  })
  const archivedWorkspace = requireActiveWorkspace(archivedState.activeWorkspace)
  assert.equal(archivedWorkspace.lessons.some((lesson) => lesson.relativePath === lessonRelativePath), false)
  assert.equal(findFileNode(archivedWorkspace.fileTree, lessonRelativePath), null)
  assert.equal(await stat(lessonPath).then((info) => info.isFile()), true, 'list archive must retain the Lesson file')

  const restoredState = await service.setWorkspaceItemMeta({
    workspaceId: workspace.id,
    relativePath: lessonRelativePath,
    archived: null
  })
  const restoredWorkspace = requireActiveWorkspace(restoredState.activeWorkspace)
  assert.equal(restoredWorkspace.lessons.find((lesson) => lesson.relativePath === lessonRelativePath)?.pinned, true)
  assert.equal(findFileNode(restoredWorkspace.fileTree, lessonRelativePath)?.pinned, true)

  await rm(lessonPath)
  const removedState = await service.getState({ activeWorkspaceId: workspace.id })
  const removedWorkspace = requireActiveWorkspace(removedState.activeWorkspace)
  assert.equal(removedWorkspace.lessons.some((lesson) => lesson.relativePath === lessonRelativePath), false)
  const removedIndex = JSON.parse(await readFile(indexPath, 'utf8')) as { lessons?: Array<{ relativePath?: string }> }
  assert.equal(
    removedIndex.lessons?.some((lesson) => lesson.relativePath === lessonRelativePath),
    false,
    'a deleted external Lesson should be removed from the durable index'
  )

  console.log('workspace catalog reconciliation boundaries ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}

function assertCatalogDirectoryPaths(workspace: TeachingWorkspaceSummary): void {
  assert.equal(workspace.recordsDir, join(workspace.rootPath, 'learning-records'))
  assert.equal(workspace.referenceDir, join(workspace.rootPath, 'reference'))
  assert.equal(workspace.reviewsDir, join(workspace.rootPath, 'reviews'))
}

function requireActiveWorkspace(workspace: TeachingWorkspaceSummary | null): TeachingWorkspaceSummary {
  assert.ok(workspace, 'an active workspace is required')
  return workspace
}

function findFileNode(nodes: WorkspaceFileNode[], relativePath: string): WorkspaceFileNode | null {
  for (const node of nodes) {
    if (node.relativePath === relativePath) return node
    const child = node.children ? findFileNode(node.children, relativePath) : null
    if (child) return child
  }
  return null
}