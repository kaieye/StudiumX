import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'

import { isPathInsideConfiguredRoot, isPathInsideRoot } from '../../src/main/path-access'

const root = resolve('tmp', 'workspace')

assert.equal(isPathInsideRoot(root, root), true)
assert.equal(isPathInsideRoot(root, join(root, 'course', 'file.md')), true)
assert.equal(isPathInsideRoot(root, resolve(root, '..', 'other', 'file.md')), false)
assert.equal(isPathInsideRoot(join(root, 'app'), join(root, 'application', 'file.md')), false)

assert.equal(isPathInsideConfiguredRoot(root, join(root, 'course', 'file.md')), true)
assert.equal(isPathInsideConfiguredRoot('', join(root, 'course', 'file.md')), false)
assert.equal(isPathInsideConfiguredRoot('   ', join(root, 'course', 'file.md')), false)

console.log('path access checks ok')
