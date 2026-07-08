import { resolve } from 'node:path'
import type { TeachingWorkspaceSummary } from '../shared/teaching-types'

export type RegisteredWorkspaceRootResult =
  | { ok: true; rootPath: string }
  | { ok: false; reason: 'no_workspace' | 'error'; message: string }

export type OptionalRegisteredWorkspaceRootResult =
  | { ok: true; rootPath?: string }
  | { ok: false; reason: 'error'; message: string }

export function resolveRegisteredWorkspaceRoot(
  workspaces: Array<Pick<TeachingWorkspaceSummary, 'rootPath'>>,
  rawWorkspaceRoot: string
): RegisteredWorkspaceRootResult {
  const requested = rawWorkspaceRoot.trim()
  if (!requested) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }

  const workspace = workspaces.find((item) => sameResolvedPath(item.rootPath, requested))
  if (!workspace) {
    return {
      ok: false,
      reason: 'error',
      message: 'This capability is limited to registered teaching workspaces.'
    }
  }

  return { ok: true, rootPath: workspace.rootPath }
}

export function resolveOptionalRegisteredWorkspaceRoot(
  workspaces: Array<Pick<TeachingWorkspaceSummary, 'rootPath'>>,
  rawWorkspaceRoot: string | undefined
): OptionalRegisteredWorkspaceRootResult {
  const requested = rawWorkspaceRoot?.trim()
  if (!requested) return { ok: true }
  const result = resolveRegisteredWorkspaceRoot(workspaces, requested)
  if (!result.ok) {
    return {
      ok: false,
      reason: 'error',
      message: result.message
    }
  }
  return { ok: true, rootPath: result.rootPath }
}

function sameResolvedPath(left: string, right: string): boolean {
  const leftResolved = resolve(left)
  const rightResolved = resolve(right)
  return process.platform === 'win32' ? leftResolved.toLowerCase() === rightResolved.toLowerCase() : leftResolved === rightResolved
}
