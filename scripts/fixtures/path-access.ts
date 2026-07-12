import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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
  const outsideFile = join(outside, 'secret.md')
  await writeFile(insideFile, 'inside')
  await writeFile(outsideFile, 'secret')

  const symlinkToOutside = join(workspace, 'linked-secret.md')
  await symlink(outsideFile, symlinkToOutside)

  assert.equal(await isRealPathInsideRoot(workspace, insideFile), true)
  assert.equal(await isRealPathInsideRoot(workspace, symlinkToOutside), false)
  await assert.rejects(
    () => assertRealPathInsideRoot(workspace, symlinkToOutside),
    /Path escapes the configured root/
  )
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('path access checks ok')
