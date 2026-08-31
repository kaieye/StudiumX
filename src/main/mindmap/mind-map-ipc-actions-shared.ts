/**
 * Shared workspace/resolution helpers for the mind-map IPC action groups.
 *
 * Both `mind-map-ipc-actions.ts` (repository + generation) and
 * `mind-map-ipc-interchange.ts` (import/export) resolve a registered
 * workspace root and obtain the durable repository store through the same
 * host-owned composition rules (ADR-0016). Keeping them in one factory
 * closure preserves the home-root memo per composition and avoids duplicating
 * the registration / CAS resolution policy across two modules.
 */
import { app } from 'electron'
import { join, resolve } from 'node:path'
import { createMindMapStore, type MindMapStore } from './mind-map-store'
import type { GatewayContext } from '../teaching-ipc-gateway-context'
import { resolveRegisteredWorkspaceRoot } from '../teaching-workspace-access'
import { HOME_MIND_MAP_WORKSPACE_ID, type MindMapUpdateResult } from '../../shared/teaching-types/mindmap'
import type { MindMapDocumentV2 } from '../../shared/mindmap/domain/types'

export function createMindMapWorkspaceResolvers(context: GatewayContext): {
  resolveHomeMindMapRoot: () => Promise<string>
  getMindMapStore: (rootPath: string) => MindMapStore
  resolveMindMapWorkspaceRoot: (workspaceId: string) => Promise<string>
} {
  const { workspaceService: service, settingsService: settings } = context

  /**
   * Root of the global home mind-map location (`<defaultRoot>/MindMaps`),
   * separate from every teaching workspace's `mindmaps/` folder. Maps created
   * directly on the home page live here.
   */
  let homeMindMapRoot: string | null = null
  const resolveHomeMindMapRoot = async (): Promise<string> => {
    if (homeMindMapRoot) return homeMindMapRoot
    const loaded = await settings.load()
    const defaultRoot = loaded.workspace.defaultRoot || app.getPath('documents')
    homeMindMapRoot = join(defaultRoot, 'MindMaps')
    return homeMindMapRoot
  }

  /**
   * Mind-map store for a resolved root. The home location writes maps directly
   * into its root (`MindMaps/`); every workspace store uses the default
   * `mindmaps/` subfolder. Test factories are honored for workspace roots.
   */
  const getMindMapStore = (rootPath: string): MindMapStore => {
    const factory = context.mindMapStoreFactory ?? createMindMapStore
    if (homeMindMapRoot && resolve(rootPath) === resolve(homeMindMapRoot)) {
      return createMindMapStore(rootPath, '')
    }
    return factory(rootPath)
  }

  /**
   * Resolve the workspace root for mind-map IPC. Prefers the explicitly provided
   * registered `workspaceId`; otherwise falls back to the active workspace root.
   */
  const resolveMindMapWorkspaceRoot = async (workspaceId: string): Promise<string> => {
    // The reserved home sentinel addresses the global MindMaps location
    // (`~/Documents/StudiumX Workspaces/MindMaps`), independent of any teaching
    // workspace. It reuses the same per-document IPC lanes unchanged.
    if (workspaceId === HOME_MIND_MAP_WORKSPACE_ID) {
      return resolveHomeMindMapRoot()
    }
    const state = await service.getState()
    if (workspaceId) {
      // Mind-map IPC envelopes carry the registered workspace identifier. Keep
      // the path lookup as a compatibility fallback for older callers, but do
      // not require renderers to expose a workspace root as an identifier.
      const workspace = state.workspaces.find((candidate) => candidate.id === workspaceId)
      if (workspace) return workspace.rootPath

      const access = await resolveRegisteredWorkspaceRoot(state.workspaces, workspaceId)
      if (access.ok) return access.rootPath
      throw new Error(`Mind map workspace unavailable: ${access.message}`)
    }
    const activeRoot = state.activeWorkspace?.rootPath
    if (!activeRoot) throw new Error('Mind map requires an active teaching workspace.')
    return activeRoot
  }

  return { resolveHomeMindMapRoot, getMindMapStore, resolveMindMapWorkspaceRoot }
}

/** Unwrap a CAS update result, surfacing a revision conflict as a structured error. */
export function unwrapMindMapUpdate(result: MindMapUpdateResult, channel: string): MindMapDocumentV2 {
  if (result.ok) return result.document
  throw new Error(
    `Mind map save conflict on ${channel}: expected revision ${result.expectedRevision}, current revision ${result.currentRevision}`
  )
}
