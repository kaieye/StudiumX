import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  assertRealPathInsideRoot,
  isLexicallyInsideRoot,
  isPathInsideConfiguredRoot,
  isPathInsideRoot,
  isRealPathInsideRoot
} from '../../src/main/path-access'

const root = resolve('tmp', 'workspace')

assert.equal(isPathInsideRoot(root, root), true)
assert.equal(isPathInsideRoot(root, join(root, 'course', 'file.md')), true)
assert.equal(isPathInsideRoot(root, resolve(root, '..', 'other', 'file.md')), false)
assert.equal(isPathInsideRoot(join(root, 'app'), join(root, 'application', 'file.md')), false)
assert.equal(isLexicallyInsideRoot(root, join(root, 'course', 'file.md')), true)

assert.equal(isPathInsideConfiguredRoot(root, join(root, 'course', 'file.md')), true)
assert.equal(isPathInsideConfiguredRoot('', join(root, 'course', 'file.md')), false)
assert.equal(isPathInsideConfiguredRoot('   ', join(root, 'course', 'file.md')), false)

const tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-path-access-'))
try {
  const workspace = join(tempRoot, 'workspace')
  const outside = join(tempRoot, 'outside')
  await mkdir(workspace)
  await mkdir(outside)
  const insideFile = join(workspace, 'inside.md')
  const outsideDirectory = join(outside, 'escaped')
  const outsideFile = join(outsideDirectory, 'secret.md')
  await mkdir(outsideDirectory)
  await writeFile(insideFile, 'inside')
  await writeFile(outsideFile, 'secret')

  const linkToOutside = join(workspace, 'linked-outside')
  await symlink(outsideDirectory, linkToOutside, process.platform === 'win32' ? 'junction' : 'dir')
  const escapedThroughLink = join(linkToOutside, 'secret.md')

  assert.equal((await lstat(linkToOutside)).isSymbolicLink(), true)
  const [realWorkspace, realEscaped, realOutside] = await Promise.all([
    realpath(workspace),
    realpath(escapedThroughLink),
    realpath(outsideFile)
  ])
  assert.equal(realEscaped, realOutside)
  assert.equal(isPathInsideRoot(realWorkspace, realEscaped), false)

  assert.equal(await isRealPathInsideRoot(workspace, insideFile), true)
  assert.equal(await isRealPathInsideRoot(workspace, escapedThroughLink), false)
  await assert.rejects(
    () => assertRealPathInsideRoot(workspace, escapedThroughLink),
    /Path escapes the configured root/
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('path access checks ok')
