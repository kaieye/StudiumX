import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import { buildDefaultRegistry, buildToolContext } from '../../src/main/ai/tools/registry'
import { getWorkspaceWriteToolAvailability } from '../../src/main/ai/tools/workspace'

const execFileAsync = promisify(execFile)
const mkfifoUnavailable = (spawnSync('mkfifo', [], { stdio: 'ignore' }).error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
const unsupportedOptionalFilesystemCodes = new Set(['EACCES', 'EPERM', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP'])

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-write-tool-'))
  const defaultRoot = join(tempRoot, 'workspaces')
  const settings = defaultSettings(defaultRoot)
  settings.tools.enabled = true
  settings.tools.workspaceRead = true
  settings.tools.approvalMode = 'full_access'
  settings.tools.webSearch = false
  settings.tools.webFetch = false

  const service = new TeachingWorkspaceService({
    registryPath: join(tempRoot, 'user-data', 'studiumx-workspaces.json'),
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
  const availability = getWorkspaceWriteToolAvailability()
  const handlers = writeRegistry.handlerMap(buildToolContext(settings, { workspaceRoot: workspace.rootPath }))
  assert.equal(
    writeRegistry.definitions().some((tool) => tool.function.name === 'write_workspace_file'),
    availability.available,
    'workspace write registration must match the active workspace-write capability profile'
  )

  if (!availability.available) {
    assert.equal(availability.code, 'containment_unavailable')
    assert.equal(availability.message, '当前平台无法安全发布工作区文件。')
    assert.equal(typeof handlers.write_workspace_file, 'undefined', 'unavailable hosts must not expose a write handler')
    assert.equal(
      await stat(join(workspace.rootPath, 'reference', 'rag-glossary.html')).then(() => true).catch(() => false),
      false,
      'withheld write tools must not create a target file'
    )
    console.log('[workspace write tool] durable workspace publication unavailable; registry withheld the write tool')
  } else {
    assert.equal(typeof handlers.write_workspace_file, 'function', 'supported hosts should expose write_workspace_file')

  // Lesson pages must be rejected: they go through the generate_lesson
  // pipeline so numbering, template rendering, and index registration stay
  // consistent (and weaker providers never stream a huge HTML tool call).
  const lessonRejection = JSON.parse(await handlers.write_workspace_file({
    path: 'lessons/0001-rag-concepts-for-interview.html',
    content: '<!doctype html><title>RAG</title>'
  }))
  assert.equal(lessonRejection.code, 'path_rejected')
  assert.match(lessonRejection.error, /generate_lesson/, 'lessons/*.html writes should redirect to generate_lesson')
  assert.equal(
    await stat(join(workspace.rootPath, 'lessons', '0001-rag-concepts-for-interview.html')).then(() => true).catch(() => false),
    false,
    'rejected lesson write must not create a file'
  )

  // Default creates must invoke the real S2 path. The subsequent duplicate
  // verifies that neither the default behavior nor any legacy pathname write
  // fallback can replace the original bytes.
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
  assert.deepEqual(
    { path: writeResult.path, created: writeResult.created, overwritten: writeResult.overwritten },
    { path: referenceRelativePath, created: true, overwritten: false },
    'default absent write must be an S2 create'
  )
  assert.equal(await stat(join(workspace.rootPath, referenceRelativePath)).then((info) => info.isFile()).catch(() => false), true)
  assert.equal(await readFile(join(workspace.rootPath, referenceRelativePath), 'utf8'), html)

  const duplicateContent = '<!doctype html><title>must not overwrite</title>'
  const duplicateResult = JSON.parse(await handlers.write_workspace_file({
    path: referenceRelativePath,
    content: duplicateContent
  }))
  assert.equal(duplicateResult.code, 'target_exists', 'default duplicate must retain create-only behavior')
  assert.equal(await readFile(join(workspace.rootPath, referenceRelativePath), 'utf8'), html, 'S2 target_exists must retain original bytes')

  const overwriteAbsentRelativePath = 'reference/overwrite-absent.html'
  const overwriteAbsentContent = '<!doctype html><title>S2 even with overwrite true</title>'
  const overwriteAbsentResult = JSON.parse(await handlers.write_workspace_file({
    path: overwriteAbsentRelativePath,
    content: overwriteAbsentContent,
    overwrite: true
  }))
  assert.deepEqual(
    { path: overwriteAbsentResult.path, created: overwriteAbsentResult.created, overwritten: overwriteAbsentResult.overwritten },
    { path: overwriteAbsentRelativePath, created: true, overwritten: false },
    'overwrite:true on an absent target must still use S2 create-only publication'
  )
  assert.equal(await readFile(join(workspace.rootPath, overwriteAbsentRelativePath), 'utf8'), overwriteAbsentContent)

  const overwriteExistingRelativePath = 'reference/overwrite-existing.html'
  const originalExistingContent = '<!doctype html><title>old regular target</title>'
  const replacementExistingContent = '<!doctype html><title>new S3 replacement</title><p>完整 UTF-8 🧪</p>'
  await writeFile(join(workspace.rootPath, overwriteExistingRelativePath), originalExistingContent, 'utf8')
  const overwriteExistingResult = JSON.parse(await handlers.write_workspace_file({
    path: overwriteExistingRelativePath,
    content: replacementExistingContent,
    overwrite: true
  }))
  assert.deepEqual(
    { path: overwriteExistingResult.path, created: overwriteExistingResult.created, overwritten: overwriteExistingResult.overwritten },
    { path: overwriteExistingRelativePath, created: false, overwritten: true },
    'overwrite:true on an existing regular nlink=1 target must use S3'
  )
  assert.equal(await readFile(join(workspace.rootPath, overwriteExistingRelativePath), 'utf8'), replacementExistingContent)

  const outsideTarget = join(tempRoot, 'outside-created-through-dangling-symlink.md')
  const danglingLinkRelativePath = 'reference/dangling-link.md'
  await mkdir(join(workspace.rootPath, 'reference'), { recursive: true })
  let symlinkCreated = false
  try {
    await symlink(outsideTarget, join(workspace.rootPath, danglingLinkRelativePath))
    symlinkCreated = true
  } catch (error) {
    const code = (error as { code?: string }).code
    if (!unsupportedOptionalFilesystemCodes.has(code ?? '')) throw error
    console.log(`[workspace write tool] symlink rejection explicitly skipped: ${code ?? 'unavailable'}`)
  }

  if (symlinkCreated) {
    const danglingSymlinkResult = JSON.parse(await handlers.write_workspace_file({
      path: danglingLinkRelativePath,
      content: 'must not be written outside the workspace',
      overwrite: true
    }))
    assert.equal(danglingSymlinkResult.code, 'path_rejected', 'dangling symlink write targets should be rejected')
    assert.equal(
      await stat(outsideTarget).then(() => true).catch(() => false),
      false,
      'rejected dangling symlink write must not create the external target'
    )
  }

  const hardlinkSource = join(workspace.rootPath, 'reference', 'hardlink-source.html')
  const hardlinkRelativePath = 'reference/hardlink-target.html'
  const hardlinkContent = '<!doctype html><title>hardlink source</title>'
  try {
    await writeFile(hardlinkSource, hardlinkContent, 'utf8')
    await link(hardlinkSource, join(workspace.rootPath, hardlinkRelativePath))
    const hardlinkResult = JSON.parse(await handlers.write_workspace_file({
      path: hardlinkRelativePath,
      content: '<!doctype html><title>must reject hardlink</title>',
      overwrite: true
    }))
    assert.equal(hardlinkResult.code, 'path_rejected', 'S3 must reject a regular target with nlink > 1')
    assert.equal(await readFile(hardlinkSource, 'utf8'), hardlinkContent, 'hardlink source bytes must remain intact')
  } catch (error) {
    const code = (error as { code?: string }).code
    if (!unsupportedOptionalFilesystemCodes.has(code ?? '')) throw error
    console.log(`[workspace write tool] hardlink rejection explicitly skipped: ${code ?? 'unavailable'}`)
  }

  const fifoRelativePath = 'reference/fifo-target.html'
  if (process.platform === 'win32' || mkfifoUnavailable) {
    console.log('[workspace write tool] FIFO rejection explicitly skipped: mkfifo is unavailable on this platform')
  } else {
    try {
      await execFileAsync('mkfifo', [join(workspace.rootPath, fifoRelativePath)])
      const fifoResult = JSON.parse(await handlers.write_workspace_file({
        path: fifoRelativePath,
        content: '<!doctype html><title>must reject fifo</title>',
        overwrite: true
      }))
      assert.equal(fifoResult.code, 'path_rejected', 'S3 must reject FIFO/other targets')
    } catch (error) {
      const code = (error as { code?: string }).code
      if (!unsupportedOptionalFilesystemCodes.has(code ?? '')) throw error
      console.log(`[workspace write tool] FIFO rejection explicitly skipped: ${code ?? 'unavailable'}`)
    }
  }

  }

  console.log('workspace write tool boundaries ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
