import { realpath } from 'node:fs/promises'
import type { TeachingWorkspaceSummary } from '../shared/teaching-types'

export type RegisteredWorkspaceRootResult =
  | { ok: true; rootPath: string }
  | { ok: false; reason: 'no_workspace' | 'error'; message: string }

export type OptionalRegisteredWorkspaceRootResult =
  | { ok: true; rootPath?: string }
  | { ok: false; reason: 'error'; message: string }

export async function resolveRegisteredWorkspaceRoot(
  workspaces: Array<Pick<TeachingWorkspaceSummary, 'rootPath'>>,
  rawWorkspaceRoot: string
): Promise<RegisteredWorkspaceRootResult> {
  const requested = rawWorkspaceRoot.trim()
  if (!requested) {
    return { ok: false, reason: 'no_workspace', message: 'No working directory selected.' }
  }

  const requestedCanonicalPath = await canonicalRealPath(requested)
  if (!requestedCanonicalPath) return unregisteredWorkspaceResult()

  const canonicalWorkspaces = await Promise.all(workspaces.map(async (workspace) => ({
    workspace,
    canonicalRootPath: await canonicalRealPath(workspace.rootPath)
  })))
  const workspace = canonicalWorkspaces.find(({ canonicalRootPath }) => canonicalRootPath === requestedCanonicalPath)?.workspace
  if (!workspace) return unregisteredWorkspaceResult()

  return { ok: true, rootPath: workspace.rootPath }
}

export async function resolveOptionalRegisteredWorkspaceRoot(
  workspaces: Array<Pick<TeachingWorkspaceSummary, 'rootPath'>>,
  rawWorkspaceRoot: string | undefined
): Promise<OptionalRegisteredWorkspaceRootResult> {
  const requested = rawWorkspaceRoot?.trim()
  if (!requested) return { ok: true }
  const result = await resolveRegisteredWorkspaceRoot(workspaces, requested)
  if (!result.ok) {
    return {
      ok: false,
      reason: 'error',
      message: result.message
    }
  }
  return { ok: true, rootPath: result.rootPath }
}

function unregisteredWorkspaceResult(): RegisteredWorkspaceRootResult {
  return {
    ok: false,
    reason: 'error',
    message: 'This capability is limited to registered teaching workspaces.'
  }
}

async function canonicalRealPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path)
  } catch {
    // Root-scoped IPC access is fail-closed when a path cannot be canonicalized.
    return undefined
  }
}
