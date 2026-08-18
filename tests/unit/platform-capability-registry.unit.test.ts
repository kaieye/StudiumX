import { describe, expect, it } from 'vitest'
import {
  PLATFORM_CAPABILITY_CONSUMERS,
  isMemoryAuthorityWriteAvailable,
  isMemoryChatHotPathAvailable,
  memoryIoProfile,
  resolvePlatformCapabilities,
  resolvePlatformCapability
} from '../../src/main/platform/platform-capability-registry'

describe('platform capability registry (ADR-0012 pathname_default)', () => {
  it('resolves Windows memory and workspace to pathname_default (non-CAS)', () => {
    const snapshot = resolvePlatformCapabilities({
      platform: 'win32',
      pathnameAvailable: true
    })
    expect(snapshot.platform).toBe('win32')

    const memory = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryCatalog, {
      platform: 'win32',
      pathnameAvailable: true
    })
    expect(memory).toMatchObject({
      profile: 'pathname_default',
      available: true,
      code: 'ok',
      class: 'durable_authority_write'
    })
    expect(memory.messageKey).toMatch(/pathname/i)

    const chat = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryChatHotPath, {
      platform: 'win32',
      pathnameAvailable: true
    })
    expect(chat).toMatchObject({
      profile: 'pathname_default',
      available: true,
      code: 'ok',
      class: 'chat_hot_path_read'
    })

    const workspace = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.workspaceWrite, {
      platform: 'win32',
      pathnameAvailable: true
    })
    expect(workspace.profile).toBe('pathname_default')

    // ADR-0012: Windows does not claim P6 strict settlement profile.
    const outcome = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.learningOutcomeCommitter, {
      platform: 'win32'
    })
    expect(outcome).toMatchObject({
      profile: 'unavailable',
      available: false,
      code: 'unsupported_platform'
    })

    // Honest naming: never market pathname write as strict/CAS-equivalent.
    for (const consumer of snapshot.consumers) {
      expect(consumer.profile).not.toMatch(/strict/i)
      expect(consumer.profile).not.toMatch(/^cas$/i)
      if (consumer.available && consumer.profile !== 'unavailable') {
        expect(consumer.profile).toBe('pathname_default')
      }
    }
  })

  it('resolves POSIX memory to pathname_default (descriptor-strict is not default)', () => {
    const memory = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryCatalog, {
      platform: 'darwin',
      pathnameAvailable: true
    })
    expect(memory).toMatchObject({
      profile: 'pathname_default',
      available: true,
      code: 'ok'
    })
    expect(memory.profile).not.toBe('posix_descriptor_strict')
    const routed = memoryIoProfile({ platform: 'linux', pathnameAvailable: true })
    expect(routed).toBe('pathname_default')
  })

  it('degrades chat hot-path when no host is available without failing closed', () => {
    const chat = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryChatHotPath, {
      platform: 'freebsd' as NodeJS.Platform,
      pathnameAvailable: false
    })
    expect(chat.class).toBe('chat_hot_path_read')
    expect(chat.available).toBe(true)
    expect(chat.code).toBe('degraded_empty')
    expect(chat.profile).toBe('unavailable')
  })

  it('fails closed durable authority write when no host is available', () => {
    const write = resolvePlatformCapability(PLATFORM_CAPABILITY_CONSUMERS.memoryAuthorityWrite, {
      platform: 'freebsd' as NodeJS.Platform,
      pathnameAvailable: false
    })
    expect(write.available).toBe(false)
    expect(write.profile).toBe('unavailable')
    expect(['write_unavailable', 'unsupported_platform', 'native_unavailable']).toContain(write.code)
  })

  it('exposes convenience predicates consistent with resolve', () => {
    expect(
      isMemoryChatHotPathAvailable({
        platform: 'win32',
        pathnameAvailable: true
      })
    ).toBe(true)
    expect(
      isMemoryAuthorityWriteAvailable({
        platform: 'win32',
        pathnameAvailable: true
      })
    ).toBe(true)
    expect(
      isMemoryAuthorityWriteAvailable({
        platform: 'aix' as NodeJS.Platform,
        pathnameAvailable: false
      })
    ).toBe(false)
  })

  it('never invents danger-full-access or shell product labels', () => {
    const snapshot = resolvePlatformCapabilities({ platform: 'win32', pathnameAvailable: true })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toMatch(/danger-full-access|yolo|always-approve|mcp marketplace/i)
    expect(serialized).not.toMatch(/posix_descriptor_strict/)
  })
})
