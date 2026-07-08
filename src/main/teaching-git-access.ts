import { resolve } from 'node:path'
import type { TeachingWorkspaceSummary } from '../shared/teaching-types'

export type RegisteredGitWorkspaceRootResult =
  | { ok: true; rootPath: string }
  | { ok: false; reason: 'no_workspace' | 'error'; message: string }

export function resolveRegisteredGitWorkspaceRoot(
  workspaces: Array<Pick<TeachingWorkspaceSummary, 'rootPath'>>,
  rawWorkspaceRoot: string
): RegisteredGitWorkspaceRootResult {
  const requested = rawWorkspaceRoot.trim()
  if (!requested) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }

  const workspace = workspaces.find((item) => sameResolvedPath(item.rootPath, requested))
  if (!workspace) {
    return {
      ok: false,
      reason: 'error',
      message: 'Git operations are limited to registered teaching workspaces.'
    }
  }

  return { ok: true, rootPath: workspace.rootPath }
}

function sameResolvedPath(left: string, right: string): boolean {
  const leftResolved = resolve(left)
  const rightResolved = resolve(right)
  return process.platform === 'win32' ? leftResolved.toLowerCase() === rightResolved.toLowerCase() : leftResolved === rightResolved
}
