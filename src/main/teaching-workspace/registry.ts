import { dirname, resolve } from 'node:path'
import { isPathInsideRoot } from '../path-access'

export type RegistryWorkspace = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  pinned?: boolean
  archived?: boolean
}

export type WorkspaceRegistry = {
  activeWorkspaceId: string | null
  workspaces: RegistryWorkspace[]
}

export const EMPTY_REGISTRY: WorkspaceRegistry = {
  activeWorkspaceId: null,
  workspaces: []
}

export type RegistryWorkspaceMetaPatch = {
  pinned?: boolean | null
  archived?: boolean | null
}

export function upsertRegistryWorkspace(
  registry: WorkspaceRegistry,
  entry: RegistryWorkspace,
  activeWorkspaceId: string
): WorkspaceRegistry {
  const others = registry.workspaces.filter((workspace) => workspace.id !== entry.id)
  return { activeWorkspaceId, workspaces: orderRegistryWorkspaces([entry, ...others]) }
}

export function touchRegistryWorkspace(
  registry: WorkspaceRegistry,
  workspaceId: string,
  updatedAt: string
): WorkspaceRegistry {
  return {
    activeWorkspaceId: workspaceId,
    workspaces: orderRegistryWorkspaces(registry.workspaces.map((workspace) =>
      workspace.id === workspaceId ? { ...workspace, updatedAt } : workspace
    ))
  }
}

export function orderRegistryWorkspaces(workspaces: RegistryWorkspace[]): RegistryWorkspace[] {
  return workspaces
    .map((workspace, index) => ({ workspace, index }))
    .sort((left, right) => {
      const leftPinned = left.workspace.pinned ? 1 : 0
      const rightPinned = right.workspace.pinned ? 1 : 0
      if (leftPinned !== rightPinned) return rightPinned - leftPinned
      return left.index - right.index
    })
    .map(({ workspace }) => workspace)
}

export function visibleRegistryWorkspaces(workspaces: RegistryWorkspace[]): RegistryWorkspace[] {
  return workspaces.filter((workspace) => !workspace.archived)
}

export function applyRegistryWorkspaceMeta(
  workspace: RegistryWorkspace,
  patch: RegistryWorkspaceMetaPatch
): RegistryWorkspace {
  const next = { ...workspace }
  if (patch.pinned === null) delete next.pinned
  else if (patch.pinned !== undefined) next.pinned = patch.pinned
  if (patch.archived === null) delete next.archived
  else if (patch.archived !== undefined) next.archived = patch.archived
  return next
}

export function sameRegistryWorkspaceOrder(left: RegistryWorkspace[], right: RegistryWorkspace[]): boolean {
  if (left.length !== right.length) return false
  return left.every((workspace, index) => workspace.id === right[index]?.id)
}

export function findWorkspace(registry: WorkspaceRegistry, workspaceId: string): RegistryWorkspace {
  const workspace = registry.workspaces.find((entry) => entry.id === workspaceId)
  if (!workspace) throw new Error('Workspace not found.')
  return workspace
}

export function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase()
}

export function assertSafeWorkspaceRootForRemoval(rootPath: string, managedRoots: string[]): void {
  const root = resolve(rootPath)
  if (samePath(root, dirname(root))) {
    throw new Error('Cannot remove a filesystem root as a workspace.')
  }
  const removableRoots = [...new Set(managedRoots.map((item) => item.trim()).filter(Boolean).map((item) => resolve(item)))]
  const isManagedWorkspace = removableRoots.some((managedRoot) =>
    !samePath(root, managedRoot) && isPathInsideRoot(managedRoot, root)
  )
  if (!isManagedWorkspace) {
    throw new Error(
      'Only workspaces inside the configured TeachOS workspace root can be removed from disk. Remove this imported workspace from the list instead.'
    )
  }
}

export function isRegistryWorkspace(value: unknown): value is RegistryWorkspace {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.rootPath === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  )
}
