/**
 * Platform capability profiles (ADR-0131 default; ADR-0126 historical inventory).
 *
 * Default product I/O model is **pathname_default** (trusted-root pathname
 * temp → write → optional fsync → rename). Dual-profile matrix
 * (posix_descriptor_strict vs windows_direct_path_non_cas) is **not** the
 * default product story. Historical profile ids remain only as transitional
 * aliases until Phase B/C delete dual backends.
 *
 * Renderers and doctor may project these fields; they must never invent a
 * stronger name (e.g. calling pathname write "strict" or "CAS").
 */
export type PlatformIoProfileId =
  | 'pathname_default'
  | 'unavailable'
  /** @deprecated ADR-0126 historical dual-profile; not default (ADR-0131). */
  | 'posix_descriptor_strict'
  /** @deprecated ADR-0126 historical dual-profile; not default (ADR-0131). */
  | 'windows_direct_path_non_cas'

/**
 * How a consumer must react when its profile is unavailable or weaker.
 * - chat_hot_path_read: degrade empty; never kill the turn
 * - durable_authority_*: fail-closed on writes; honest read failures
 * - workspace_tool_write / projection_rebuild: existing product policy
 */
export type ConsumerCapabilityClass =
  | 'chat_hot_path_read'
  | 'durable_authority_write'
  | 'durable_authority_read'
  | 'workspace_tool_write'
  | 'projection_rebuild'

/** Stable codes only — never path / errno / addon path / raw OS messages. */
export type ConsumerPlatformCapabilityCode =
  | 'ok'
  | 'degraded_empty'
  | 'write_unavailable'
  | 'containment_unavailable'
  | 'unsupported_platform'
  | 'native_unavailable'

export type ConsumerPlatformCapability = {
  /** Stable consumer id, e.g. `teaching_memory_catalog`. */
  consumer: string
  class: ConsumerCapabilityClass
  profile: PlatformIoProfileId
  available: boolean
  code?: ConsumerPlatformCapabilityCode
  /** i18n key for doctor / settings copy; never a free-form path. */
  messageKey?: string
}

export type PlatformCapabilitySnapshot = {
  platform: NodeJS.Platform | string
  consumers: readonly ConsumerPlatformCapability[]
}

/** Supported product hosts for pathname-default durable I/O (ADR-0131). */
export function isPathnameDefaultHost(platform: NodeJS.Platform | string): boolean {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux'
}
