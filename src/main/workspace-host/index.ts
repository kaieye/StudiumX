/**
 * Public barrel for the thin WorkspaceHost port (ADR-0078 / ADOPTION S-02).
 *
 * Dependency direction (frozen path `src/main/workspace-host/*`):
 *   tools / agent  →  workspace-host  →  path-access | teaching-workspace-paths | teaching-workspace-access
 *
 * Do not import agent-loop, teaching-turn-coordinator, learning-session-ledger,
 * teaching-ipc-gateway, renderer, or electron from this package.
 * Optional local gate: `pnpm run check:workspace-host-imports` (not Blocking CI).
 */
export type {
  BoundedContainedRegularFileRead,
  RegisteredWorkspaceRootResult,
  WorkspaceHostPort,
  WorkspaceRelativePath,
  WorkspaceRootPath
} from './types'

export { createNodeWorkspaceHost } from './node-workspace-host'

export {
  isLexicallyInsideRoot,
  isPathInsideConfiguredRoot,
  isPathInsideRoot,
  normalizeWorkspaceRelativePath,
  toWorkspaceRelativePath,
  workspaceRelativePath
} from './path'
