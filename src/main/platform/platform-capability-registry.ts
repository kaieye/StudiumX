/**
 * Platform capability registry (ADR-0126).
 *
 * Pure resolution of per-consumer I/O profiles. Call sites must not scatter
 * `process.platform` branches; they consult this registry (or factory helpers
 * that wrap it). Windows memory uses an explicit weaker non-CAS profile — never
 * described as descriptor-equivalent.
 */
import { getContainedDurableDirectoryCapability } from '../persistence/contained-durable-directory'
import { getWindowsDirectPathWorkspaceWriteCapability } from '../ai/tools/windows-direct-path-workspace-write'
import type {
  ConsumerCapabilityClass,
  ConsumerPlatformCapability,
  ConsumerPlatformCapabilityCode,
  PlatformCapabilitySnapshot,
  PlatformIoProfileId
} from '../../shared/platform-capability'

export type {
  ConsumerCapabilityClass,
  ConsumerPlatformCapability,
  ConsumerPlatformCapabilityCode,
  PlatformCapabilitySnapshot,
  PlatformIoProfileId
} from '../../shared/platform-capability'

export type ResolvePlatformCapabilitiesInput = {
  platform?: NodeJS.Platform
  /** Injected for unit tests; defaults to live native probe. */
  posixDescriptorAvailable?: boolean
  posixDescriptorReason?: 'unsupported_platform' | 'native_unavailable'
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
  const posix = resolvePosixDescriptor(input)
  const windowsDirect =
    input.windowsDirectPathAvailable ??
    getWindowsDirectPathWorkspaceWriteCapability({ platform }).available

  const consumers: ConsumerPlatformCapability[] = [
    resolveWorkspaceWriteCapability(platform, posix, windowsDirect),
    resolveMemoryCapability(MEMORY_CHAT_CONSUMER, 'chat_hot_path_read', platform, posix, windowsDirect),
    resolveMemoryCapability(MEMORY_AUTHORITY_READ_CONSUMER, 'durable_authority_read', platform, posix, windowsDirect),
    resolveMemoryCapability(MEMORY_AUTHORITY_WRITE_CONSUMER, 'durable_authority_write', platform, posix, windowsDirect),
    // Aggregate alias used by doctor / settings badges.
    resolveMemoryCapability(MEMORY_CONSUMER, 'durable_authority_write', platform, posix, windowsDirect),
    resolveOutcomeCommitterCapability(platform, posix),
    resolveSessionAuditCapability(platform, posix)
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

export function memoryIoProfile(input: ResolvePlatformCapabilitiesInput = {}): PlatformIoProfileId {
  return resolvePlatformCapability(MEMORY_CONSUMER, input).profile
}

type PosixProbe = {
  available: boolean
  reason?: 'unsupported_platform' | 'native_unavailable'
}

function resolvePosixDescriptor(input: ResolvePlatformCapabilitiesInput): PosixProbe {
  if (typeof input.posixDescriptorAvailable === 'boolean') {
    return {
      available: input.posixDescriptorAvailable,
      reason: input.posixDescriptorAvailable
        ? undefined
        : (input.posixDescriptorReason ?? 'unsupported_platform')
    }
  }
  const capability = getContainedDurableDirectoryCapability({
    platform: input.platform ?? process.platform
  })
  if (capability.available) return { available: true }
  return { available: false, reason: capability.reason }
}

function resolveWorkspaceWriteCapability(
  platform: NodeJS.Platform,
  posix: PosixProbe,
  windowsDirect: boolean
): ConsumerPlatformCapability {
  if (platform === 'win32' && windowsDirect) {
    return cap(WORKSPACE_WRITE_CONSUMER, 'workspace_tool_write', 'windows_direct_path_non_cas', true, 'ok', 'platformCapability.windowsDirectPathNonCas')
  }
  if (posix.available) {
    return cap(WORKSPACE_WRITE_CONSUMER, 'workspace_tool_write', 'posix_descriptor_strict', true, 'ok', 'platformCapability.posixDescriptorStrict')
  }
  return cap(
    WORKSPACE_WRITE_CONSUMER,
    'workspace_tool_write',
    'unavailable',
    false,
    posix.reason === 'native_unavailable' ? 'native_unavailable' : 'unsupported_platform',
    'platformCapability.writeUnavailable'
  )
}

function resolveMemoryCapability(
  consumer: string,
  capabilityClass: ConsumerCapabilityClass,
  platform: NodeJS.Platform,
  posix: PosixProbe,
  windowsDirect: boolean
): ConsumerPlatformCapability {
  if (platform === 'win32' && windowsDirect) {
    // Windows memory is honest non-CAS direct-path (Phase 2). Chat and authority
    // share the same profile; class only changes fail policy at the call site.
    return cap(
      consumer,
      capabilityClass,
      'windows_direct_path_non_cas',
      true,
      'ok',
      'platformCapability.windowsMemoryLimitedPersistence'
    )
  }
  if (posix.available) {
    return cap(consumer, capabilityClass, 'posix_descriptor_strict', true, 'ok', 'platformCapability.posixDescriptorStrict')
  }

  if (capabilityClass === 'chat_hot_path_read') {
    // Must degrade empty — never throw descriptor unavailability into a turn.
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
    posix.reason === 'native_unavailable' ? 'native_unavailable' : 'write_unavailable',
    'platformCapability.writeUnavailable'
  )
}

function resolveOutcomeCommitterCapability(
  platform: NodeJS.Platform,
  posix: PosixProbe
): ConsumerPlatformCapability {
  // ADR-0035: Windows does not claim P6 strict settlement profile.
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
  if (posix.available) {
    return cap(
      OUTCOME_COMMITTER_CONSUMER,
      'durable_authority_write',
      'posix_descriptor_strict',
      true,
      'ok',
      'platformCapability.posixDescriptorStrict'
    )
  }
  return cap(
    OUTCOME_COMMITTER_CONSUMER,
    'durable_authority_write',
    'unavailable',
    false,
    posix.reason === 'native_unavailable' ? 'native_unavailable' : 'unsupported_platform',
    'platformCapability.writeUnavailable'
  )
}

function resolveSessionAuditCapability(
  platform: NodeJS.Platform,
  posix: PosixProbe
): ConsumerPlatformCapability {
  // Session audit keeps its existing ADR-0019/0035 boundaries; registry only
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
  if (posix.available) {
    return cap(
      SESSION_AUDIT_CONSUMER,
      'durable_authority_write',
      'posix_descriptor_strict',
      true,
      'ok',
      'platformCapability.posixDescriptorStrict'
    )
  }
  return cap(
    SESSION_AUDIT_CONSUMER,
    'durable_authority_write',
    'unavailable',
    false,
    posix.reason === 'native_unavailable' ? 'native_unavailable' : 'unsupported_platform',
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
