/**
 * Pure path helpers re-exported for the workspace-host port surface.
 * Prefer these over ad-hoc string joins in tools that depend on the port.
 */
export {
  toWorkspaceRelativePath,
  normalizeWorkspaceRelativePath,
  workspaceRelativePath
} from '../teaching-workspace-paths'

export {
  isLexicallyInsideRoot,
  isPathInsideRoot,
  isPathInsideConfiguredRoot
} from '../path-access'
