import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  resolveOptionalRegisteredWorkspaceRoot,
  resolveRegisteredWorkspaceRoot
} from '../../src/main/teaching-workspace-access'

const registeredWorkspaceError = {
  ok: false,
  reason: 'error',
  message: 'This capability is limited to registered teaching workspaces.'
} as const

describe('registered workspace access resolver', () => {
  let sandboxRoot: string

  beforeEach(async () => {
    sandboxRoot = await mkdtemp(join(tmpdir(), 'studiumx-workspace-access-'))
  })

  afterEach(async () => {
    await rm(sandboxRoot, { recursive: true, force: true })
  })

  it('accepts the registered root and canonical aliases while returning the registered root', async () => {
    const registeredRoot = join(sandboxRoot, 'registered-workspace')
    await mkdir(registeredRoot)
    const rootAlias = join(registeredRoot, '..', 'registered-workspace')
    const workspaces = [{ rootPath: registeredRoot }]

    await expect(resolveRegisteredWorkspaceRoot(workspaces, registeredRoot)).resolves.toEqual({ ok: true, rootPath: registeredRoot })
    await expect(resolveRegisteredWorkspaceRoot(workspaces, rootAlias)).resolves.toEqual({ ok: true, rootPath: registeredRoot })
    await expect(resolveOptionalRegisteredWorkspaceRoot(workspaces, rootAlias)).resolves.toEqual({ ok: true, rootPath: registeredRoot })
  })

  it('denies access when either requested or registered roots cannot be canonicalized', async () => {
    const registeredRoot = join(sandboxRoot, 'registered-workspace')
    await mkdir(registeredRoot)
    const missingRoot = join(sandboxRoot, 'missing-workspace')

    await expect(resolveRegisteredWorkspaceRoot([{ rootPath: registeredRoot }], missingRoot)).resolves.toEqual(registeredWorkspaceError)
    await expect(resolveRegisteredWorkspaceRoot([{ rootPath: missingRoot }], missingRoot)).resolves.toEqual(registeredWorkspaceError)
  })

  it('denies a different case-distinct root when the filesystem supports it', async (context) => {
    const registeredRoot = join(sandboxRoot, 'Workspace')
    await mkdir(registeredRoot)
    const caseDistinctRoot = join(sandboxRoot, 'workspace')
    try {
      await mkdir(caseDistinctRoot)
    } catch {
      context.skip('The filesystem does not support case-distinct sibling roots.')
      return
    }

    const [registeredCanonicalRoot, caseDistinctCanonicalRoot] = await Promise.all([
      realpath(registeredRoot),
      realpath(caseDistinctRoot)
    ])
    if (registeredCanonicalRoot === caseDistinctCanonicalRoot) {
      context.skip('The filesystem canonicalizes these roots as the same directory.')
      return
    }

    await expect(resolveRegisteredWorkspaceRoot(
      [{ rootPath: registeredRoot }],
      caseDistinctRoot
    )).resolves.toEqual(registeredWorkspaceError)
  })
})
