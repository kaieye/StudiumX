/**
 * Workspace / project-local config denylist (S-04 / ADR-0071).
 *
 * Untrusted workspace overlays must not redirect provider endpoints.
 * Aligns with Codex PROJECT_LOCAL_CONFIG_DENYLIST *intent*, not a Rust port.
 *
 * Layer policy:
 * - workspace: denied paths ignored + diagnostic (non-fatal resolve)
 * - default / managed / user: may still set these fields (product / org / machine)
 * - session_override: trusted in-process override; not denylisted (documented)
 *
 * Managed (ADR-0086) is a trusted org layer for denylist purposes — workspace
 * denylist does not apply to managed. Secrets are still stripped separately.
 *
 * Secret paths remain gated by isTeachingConfigSecretPath; this list does not
 * weaken secret stripping.
 */

export const WORKSPACE_CONFIG_DENYLIST_PATHS = [
  'provider.providers.*.baseUrl'
] as const

export type WorkspaceConfigDenylistPath = (typeof WORKSPACE_CONFIG_DENYLIST_PATHS)[number]

/** Layers subject to the workspace/project denylist. */
export const WORKSPACE_CONFIG_DENYLIST_LAYERS = ['workspace'] as const

export type WorkspaceConfigDenylistLayer = (typeof WORKSPACE_CONFIG_DENYLIST_LAYERS)[number]

/**
 * True when `path` matches a workspace denylist pattern (e.g.
 * `provider.providers.0.baseUrl`).
 */
export function isWorkspaceConfigDenylistPath(path: string): boolean {
  return /^provider\.providers\.\d+\.baseUrl$/.test(path)
}

/** True when the config layer is subject to the workspace denylist. */
export function isWorkspaceConfigDenylistLayer(
  source: string
): source is WorkspaceConfigDenylistLayer {
  return (WORKSPACE_CONFIG_DENYLIST_LAYERS as readonly string[]).includes(source)
}

/**
 * True when a field path on a given layer must be ignored by the resolver.
 * Does not cover secret stripping (see isTeachingConfigSecretPath).
 */
export function isDeniedForConfigLayer(source: string, path: string): boolean {
  return isWorkspaceConfigDenylistLayer(source) && isWorkspaceConfigDenylistPath(path)
}
