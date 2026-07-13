/**
 * Compatibility seam for callers that still use the original procedural API.
 * The implementation now lives in the Teaching Workspace Change Audit module.
 */
export {
  captureWorkspaceChangeSnapshot,
  readWorkspaceChangeDiff,
  summarizeWorkspaceChanges
} from './teaching-workspace-change-audit'
export type { TeachingWorkspaceChangeSnapshot } from './teaching-workspace-change-audit'
