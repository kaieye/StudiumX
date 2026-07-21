import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  createNodeWorkspaceHost,
  isPathInsideRoot,
  normalizeWorkspaceRelativePath,
  toWorkspaceRelativePath
} from '../../src/main/workspace-host'

const repoRoot = process.cwd()

describe('createNodeWorkspaceHost', () => {
  it('exists and returns a WorkspaceHostPort-shaped object', () => {
    const host = createNodeWorkspaceHost()
    expect(host).toBeDefined()
    expect(typeof host.toRelative).toBe('function')
    expect(typeof host.normalizeRelative).toBe('function')
    expect(typeof host.isInsideRoot).toBe('function')
    expect(typeof host.assertRealPathInsideRoot).toBe('function')
    expect(typeof host.readContainedRegularFile).toBe('function')
    expect(typeof host.readContainedRegularFileBounded).toBe('function')
    expect(typeof host.ensureContainedDirectory).toBe('function')
    expect(typeof host.resolveRegisteredRoot).toBe('function')
  })

  it('toRelative / normalizeRelative round-trip on temp-style paths', () => {
    const host = createNodeWorkspaceHost()
    // Use resolve so absolute roots are platform-correct for relative().
    const root = resolve('/tmp/studiumx-workspace-host-unit')
    const absolute = join(root, 'courses', 'math', 'lesson.md')
    const rel = host.toRelative(root, absolute)
    expect(rel.replace(/\\/g, '/')).toMatch(/courses\/math\/lesson\.md$/)
    expect(host.normalizeRelative(rel)).toBe(normalizeWorkspaceRelativePath(rel))
    expect(host.normalizeRelative('\\courses\\math\\lesson.md')).toBe('courses/math/lesson.md')
    expect(host.normalizeRelative('./courses/math/lesson.md')).toBe('courses/math/lesson.md')
    expect(host.normalizeRelative('/courses/math/lesson.md')).toBe('courses/math/lesson.md')
  })

  it('isInsideRoot matches path-access semantics (true/false)', () => {
    const host = createNodeWorkspaceHost()
    const root = resolve('/tmp/studiumx-workspace-host-unit')
    const inside = join(root, 'lessons', 'a.md')
    const outside = resolve(root, '..', 'escape', 'secret.md')

    expect(host.isInsideRoot(root, inside)).toBe(true)
    expect(host.isInsideRoot(root, root)).toBe(true)
    expect(host.isInsideRoot(root, outside)).toBe(false)
    // Same semantics as path-access isPathInsideRoot
    expect(host.isInsideRoot(root, inside)).toBe(isPathInsideRoot(root, inside))
    expect(host.isInsideRoot(root, outside)).toBe(isPathInsideRoot(root, outside))
  })

  it('toRelative matches teaching-workspace-paths helper', () => {
    const host = createNodeWorkspaceHost()
    const root = resolve('/tmp/studiumx-workspace-host-unit')
    const absolute = join(root, 'reference', 'note.md')
    expect(host.toRelative(root, absolute)).toBe(toWorkspaceRelativePath(root, absolute))
  })
})

describe('check-workspace-host-imports script', () => {
  it('passes on the current workspace-host tree', () => {
    const script = join(repoRoot, 'scripts', 'check-workspace-host-imports.mjs')
    const result = spawnSync(process.execPath, [script], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toMatch(/ok/i)
  })

  it('self-test detects a synthetic forbidden import', () => {
    const script = join(repoRoot, 'scripts', 'check-workspace-host-imports.mjs')
    const result = spawnSync(process.execPath, [script, '--self-test'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(result.stdout).toMatch(/self-test ok/i)
  })
})
