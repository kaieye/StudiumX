/**
 * Platform capability registry for durable file operations (ADR-0012).
 *
 * Shrinks the legacy dual-profile matrix to simple host booleans +
 * pathname_default. Call sites consult this registry instead of scattering
 * process.platform branches. Doctor must not imply descriptor-strict is the
 * full-platform default.
 *
 * Dual backends are deleted; this registry no longer encodes native vs
 * windows_direct_path as the product story.
 */
import type {
  ConsumerCapabilityClass,
  ConsumerPlatformCapability,
  ConsumerPlatformCapabilityCode,
  PlatformCapabilitySnapshot,
  PlatformIoProfileId
} from '../../shared/platform-capability'
import { isPathnameDefaultHost } from '../../shared/platform-capability'

export type {
  ConsumerCapabilityClass,
  ConsumerPlatformCapability,
  ConsumerPlatformCapabilityCode,
  PlatformCapabilitySnapshot,
  PlatformIoProfileId
} from '../../shared/platform-capability'

export type ResolvePlatformCapabilitiesInput = {
  platform?: NodeJS.Platform
  /**
   * Optional override for unit tests. When omitted, supported hosts
   * (win32/darwin/linux) are available under pathname_default.
   * Injected dual-profile probes (posixDescriptor / windowsDirectPath) are
   * ignored — they are no longer part of the product matrix.
   */
  pathnameAvailable?: boolean
  /** @deprecated Ignored; dual-profile probes removed (ADR-0012). */
  posixDescriptorAvailable?: boolean
  /** @deprecated Ignored; dual-profile probes removed (ADR-0012). */
  posixDescriptorReason?: 'unsupported_platform' | 'native_unavailable'
  /** @deprecated Ignored; dual-profile probes removed (ADR-0012). */
  windowsDirectPathAvailable?: boolean
}

const MEMORY_CONSUMER = 'teaching_memory_catalog'
const WORKSPACE_WRITE_CONSUMER = 'write_workspace_file'
const MEMORY_CHAT_CONSUMER = 'teaching_memory_chat_hot_path'
const MEMORY_AUTHORITY_READ_CONSUMER = 'teaching_memory_authority_read'
const MEMORY_AUTHORITY_WRITE_CONSUMER = 'teaching_memory_authority_write'
const OUTCOME_COMMITTER_CONSUMER = 'learning_outcome_committer'
const SESSION_AUDIT_CONSUMER = 'session_audit_jsonl'

export const PLATFORM_CAPABILITY_CONSUMERS = {
  memoryCatalog: MEMORY_CONSUMER,
  memoryChatHotPath: MEMORY_CHAT_CONSUMER,
  memoryAuthorityRead: MEMORY_AUTHORITY_READ_CONSUMER,
  memoryAuthorityWrite: MEMORY_AUTHORITY_WRITE_CONSUMER,
  workspaceWrite: WORKSPACE_WRITE_CONSUMER,
  learningOutcomeCommitter: OUTCOME_COMMITTER_CONSUMER,
  sessionAudit: SESSION_AUDIT_CONSUMER
} as const

/**
 * Resolves every first-wave consumer capability for the host (or injected) platform.
 * Partial migration: unlisted consumers remain on their prior contracts.
 */
export function resolvePlatformCapabilities(
  input: ResolvePlatformCapabilitiesInput = {}
): PlatformCapabilitySnapshot {
  const platform = input.platform ?? process.platform
  const pathnameOk =
    typeof input.pathnameAvailable === 'boolean'
      ? input.pathnameAvailable
      : isPathnameDefaultHost(platform)

  const consumers: ConsumerPlatformCapability[] = [
    resolveWorkspaceWriteCapability(pathnameOk),
    resolveMemoryCapability(MEMORY_CHAT_CONSUMER, 'chat_hot_path_read', pathnameOk),
    resolveMemoryCapability(MEMORY_AUTHORITY_READ_CONSUMER, 'durable_authority_read', pathnameOk),
    resolveMemoryCapability(MEMORY_AUTHORITY_WRITE_CONSUMER, 'durable_authority_write', pathnameOk),
    // Aggregate alias used by doctor / settings badges.
    resolveMemoryCapability(MEMORY_CONSUMER, 'durable_authority_write', pathnameOk),
    resolveOutcomeCommitterCapability(platform, pathnameOk),
    resolveSessionAuditCapability(platform, pathnameOk)
  ]

  return { platform, consumers }
}

export function resolvePlatformCapability(
  consumer: string,
  input: ResolvePlatformCapabilitiesInput = {}
): ConsumerPlatformCapability {
  const snapshot = resolvePlatformCapabilities(input)
  const found = snapshot.consumers.find((entry) => entry.consumer === consumer)
  if (found) return found
  return {
    consumer,
    class: 'durable_authority_write',
    profile: 'unavailable',
    available: false,
    code: 'unsupported_platform',
    messageKey: 'platformCapability.unavailable'
  }
}

/** Convenience: memory chat hot-path must never throw into a turn. */
export function isMemoryChatHotPathAvailable(input: ResolvePlatformCapabilitiesInput = {}): boolean {
  return resolvePlatformCapability(MEMORY_CHAT_CONSUMER, input).available
}

/** Convenience: memory durable write (create/update/delete). */
export function isMemoryAuthorityWriteAvailable(input: ResolvePlatformCapabilitiesInput = {}): boolean {
  return resolvePlatformCapability(MEMORY_AUTHORITY_WRITE_CONSUMER, input).available
}

/** Convenience: memory durable read (settings list / diagnostics / recall). */
export function isMemoryAuthorityReadAvailable(input: ResolvePlatformCapabilitiesInput = {}): boolean {
  return resolvePlatformCapability(MEMORY_AUTHORITY_READ_CONSUMER, input).available
}

/**
 * Catalog / diagnostics I/O profile. Product path is pathname_default
 * (ADR-0012). Never returns posix_descriptor_strict as the default.
 */
export function memoryIoProfile(input: ResolvePlatformCapabilitiesInput = {}): PlatformIoProfileId {
  const capability = resolvePlatformCapability(MEMORY_CONSUMER, input)
  if (capability.profile === 'unavailable' || !capability.available) return 'unavailable'
  return 'pathname_default'
}

function resolveWorkspaceWriteCapability(pathnameOk: boolean): ConsumerPlatformCapability {
  if (pathnameOk) {
    return cap(
      WORKSPACE_WRITE_CONSUMER,
      'workspace_tool_write',
      'pathname_default',
      true,
      'ok',
      'platformCapability.pathnameDefault'
    )
  }
  return cap(
    WORKSPACE_WRITE_CONSUMER,
    'workspace_tool_write',
    'unavailable',
    false,
    'unsupported_platform',
    'platformCapability.writeUnavailable'
  )
}

function resolveMemoryCapability(
  consumer: string,
  capabilityClass: ConsumerCapabilityClass,
  pathnameOk: boolean
): ConsumerPlatformCapability {
  if (pathnameOk) {
    return cap(
      consumer,
      capabilityClass,
      'pathname_default',
      true,
      'ok',
      'platformCapability.pathnameDefault'
    )
  }

  if (capabilityClass === 'chat_hot_path_read') {
    // Must degrade empty — never throw I/O unavailability into a turn.
    return cap(
      consumer,
      capabilityClass,
      'unavailable',
      true,
      'degraded_empty',
      'platformCapability.memoryChatDegradedEmpty'
    )
  }

  return cap(
    consumer,
    capabilityClass,
    'unavailable',
    false,
    'write_unavailable',
    'platformCapability.writeUnavailable'
  )
}

function resolveOutcomeCommitterCapability(
  platform: NodeJS.Platform,
  pathnameOk: boolean
): ConsumerPlatformCapability {
  // ADR-0012: Windows does not claim P6 strict settlement profile.
  if (platform === 'win32') {
    return cap(
      OUTCOME_COMMITTER_CONSUMER,
      'durable_authority_write',
      'unavailable',
      false,
      'unsupported_platform',
      'platformCapability.outcomeWindowsNotStrict'
    )
  }
  if (pathnameOk) {
    return cap(
      OUTCOME_COMMITTER_CONSUMER,
      'durable_authority_write',
      'pathname_default',
      true,
      'ok',
      'platformCapability.pathnameDefault'
    )
  }
  return cap(
    OUTCOME_COMMITTER_CONSUMER,
    'durable_authority_write',
    'unavailable',
    false,
    'unsupported_platform',
    'platformCapability.writeUnavailable'
  )
}

function resolveSessionAuditCapability(
  platform: NodeJS.Platform,
  pathnameOk: boolean
): ConsumerPlatformCapability {
  // Session audit keeps existing ADR-0007 boundaries; registry only
  // projects readiness for doctor. Do not auto-migrate audit writers.
  if (platform === 'win32') {
    return cap(
      SESSION_AUDIT_CONSUMER,
      'durable_authority_write',
      'unavailable',
      false,
      'unsupported_platform',
      'platformCapability.sessionAuditWindowsLimited'
    )
  }
  if (pathnameOk) {
    return cap(
      SESSION_AUDIT_CONSUMER,
      'durable_authority_write',
      'pathname_default',
      true,
      'ok',
      'platformCapability.pathnameDefault'
    )
  }
  return cap(
    SESSION_AUDIT_CONSUMER,
    'durable_authority_write',
    'unavailable',
    false,
    'unsupported_platform',
    'platformCapability.writeUnavailable'
  )
}

function cap(
  consumer: string,
  capabilityClass: ConsumerCapabilityClass,
  profile: PlatformIoProfileId,
  available: boolean,
  code: ConsumerPlatformCapabilityCode,
  messageKey: string
): ConsumerPlatformCapability {
  return { consumer, class: capabilityClass, profile, available, code, messageKey }
}

