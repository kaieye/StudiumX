/**
 * Platform capability profiles (ADR-0126).
 *
 * Stable, path-free, marketing-free names for host I/O contracts. Renderers and
 * doctor may project these fields; they must never invent a stronger name
 * (e.g. calling Windows direct-path "strict" or "CAS").
 */
export type PlatformIoProfileId =
  | 'posix_descriptor_strict'
  | 'windows_direct_path_non_cas'
  | 'unavailable'

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
