import { describe, expect, it } from 'vitest'
import {
  PLATFORM_CAPABILITY_CONSUMERS,
  isMemoryAuthorityWriteAvailable,
  isMemoryChatHotPathAvailable,
  memoryIoProfile,
  resolvePlatformCapabilities,
  resolvePlatformCapability
} from '../../src/main/platform/platform-capability-registry'

describe('platform capability registry (ADR-0126)', () => {
  it('resolves Windows memory and workspace to windows_direct_path_non_cas', () => {
    const snapshot = resolvePlatformCapabilities({
      platform: 'win32',
      windowsDirectPathAvailable: true,
      posixDescriptorAvailable: false
    })
    expect(snapshot.platform).toBe('win32')

    const memory = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryCatalog, {
      platform: 'win32',
      windowsDirectPathAvailable: true
    })
    expect(memory).toMatchObject({
      profile: 'windows_direct_path_non_cas',
      available: true,
      code: 'ok',
      class: 'durable_authority_write'
    })
    expect(memory.messageKey).toContain('windowsMemory')

    const chat = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryChatHotPath, {
      platform: 'win32',
      windowsDirectPathAvailable: true
    })
    expect(chat).toMatchObject({
      profile: 'windows_direct_path_non_cas',
      available: true,
      code: 'ok',
      class: 'chat_hot_path_read'
    })

    const workspace = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.workspaceWrite, {
      platform: 'win32',
      windowsDirectPathAvailable: true
    })
    expect(workspace.profile).toBe('windows_direct_path_non_cas')

    const outcome = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.learningOutcomeCommitter, {
      platform: 'win32'
    })
    expect(outcome).toMatchObject({
      profile: 'unavailable',
      available: false,
      code: 'unsupported_platform'
    })

    // Honest naming: never market Windows as strict/CAS-equivalent.
    // `windows_direct_path_non_cas` is the frozen weaker name (contains non_cas).
    for (const consumer of snapshot.consumers) {
      expect(consumer.profile).not.toMatch(/strict/i)
      if (/cas/i.test(consumer.profile)) {
        expect(consumer.profile).toBe('windows_direct_path_non_cas')
      }
    }
  })

  it('resolves POSIX memory to posix_descriptor_strict when native is available', () => {
    const memory = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryCatalog, {
      platform: 'darwin',
      posixDescriptorAvailable: true
    })
    expect(memory).toMatchObject({
      profile: 'posix_descriptor_strict',
      available: true,
      code: 'ok'
    })
    expect(memoryIoProfile({ platform: 'linux', posixDescriptorAvailable: true })).toBe(
      'posix_descriptor_strict'
    )
  })

  it('degrades chat hot-path when no profile is available without failing closed', () => {
    const chat = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryChatHotPath, {
      platform: 'freebsd' as NodeJS.Platform,
      posixDescriptorAvailable: false,
      windowsDirectPathAvailable: false
    })
    expect(chat.class).toBe('chat_hot_path_read')
    expect(chat.available).toBe(true)
    expect(chat.code).toBe('degraded_empty')
    expect(chat.profile).toBe('unavailable')
  })

  it('fails closed durable authority write when no profile is available', () => {
    const write = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryAuthorityWrite, {
      platform: 'freebsd' as NodeJS.Platform,
      posixDescriptorAvailable: false,
      windowsDirectPathAvailable: false
    })
    expect(write.available).toBe(false)
    expect(write.profile).toBe('unavailable')
    expect(['write_unavailable', 'unsupported_platform', 'native_unavailable']).toContain(write.code)
  })

  it('exposes convenience predicates consistent with resolve', () => {
    expect(
      isMemoryChatHotPathAvailable({
        platform: 'win32',
        windowsDirectPathAvailable: true
      })
    ).toBe(true)
    expect(
      isMemoryAuthorityWriteAvailable({
        platform: 'win32',
        windowsDirectPathAvailable: true
      })
    ).toBe(true)
    expect(
      isMemoryAuthorityWriteAvailable({
        platform: 'aix' as NodeJS.Platform,
        posixDescriptorAvailable: false,
        windowsDirectPathAvailable: false
      })
    ).toBe(false)
  })

  it('never invents danger-full-access or shell product labels', () => {
    const snapshot = resolvePlatformCapabilities({ platform: 'win32', windowsDirectPathAvailable: true })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(/danger-full-access|yolo|always-approve|mcp marketplace/i)
  })
})
