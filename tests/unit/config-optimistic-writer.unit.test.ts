import { describe, expect, it } from 'vitest'

import {
  compareAndProjectConfigWrite,
  projectConfigWriteRequest,
  writeConfigOptimistic
} from '../../src/main/config-optimistic-writer'
import {
  fingerprintTeachingConfig,
  resolveTeachingConfig
} from '../../src/main/teaching-config-resolver'
import type { ConfigOptimisticStore } from '../../src/shared/teaching-types/config-optimistic-write'

const FALLBACK_ROOT = 'C:/StudiumX/workspace'

function baseResolved(user?: unknown) {
  return resolveTeachingConfig({
    fallbackDefaultRoot: FALLBACK_ROOT,
    user
  })
}

describe('config optimistic concurrency (CAS)', () => {
  it('happy path: matching fingerprint applies overlay and returns a new fingerprint', () => {
    const current = baseResolved({
      tools: { enabled: false, workspaceRead: false },
      generator: { temperature: 0.2 }
    })

    const result = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: {
        tools: { enabled: true, workspaceRead: true },
        generator: { temperature: 0.6 }
      },
      layer: 'user',
      baseScope: {
        fallbackDefaultRoot: FALLBACK_ROOT,
        user: {
          tools: { enabled: false, workspaceRead: false },
          generator: { temperature: 0.2 }
        }
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tools.enabled).toBe(true)
    expect(result.value.tools.workspaceRead).toBe(true)
    expect(result.value.generator.temperature).toBe(0.6)
    expect(result.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(result.fingerprint).not.toBe(current.fingerprint)
    expect(fingerprintTeachingConfig(result.value)).toBe(result.fingerprint)
    expect(result.resolved.fingerprint).toBe(result.fingerprint)
  })

  it('mismatch: expectedFingerprint !== current → conflict, no apply', () => {
    const current = baseResolved({ tools: { enabled: true } })
    const stale = 'sha256:' + '0'.repeat(64)

    const result = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: stale,
      nextOverlay: { tools: { enabled: false } },
      layer: 'user',
      baseScope: {
        fallbackDefaultRoot: FALLBACK_ROOT,
        user: { tools: { enabled: true } }
      }
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('fingerprint_mismatch')
    if (result.code === 'fingerprint_mismatch') {
      expect(result.currentFingerprint).toBe(current.fingerprint)
      expect(result.message).toContain('指纹')
    }
  })

  it('rejects secret path patches before apply', () => {
    const current = baseResolved()

    const cases: unknown[] = [
      { webSearch: { braveApiKey: 'secret-brave' } },
      { provider: { proxy: { url: 'https://proxy.example/?token=1' } } },
      {
        provider: {
          providers: [
            {
              id: 'custom',
              name: 'Custom',
              apiKey: 'provider-secret',
              baseUrl: 'https://models.example/v1',
              endpointFormat: 'chat_completions',
              models: ['m']
            }
          ]
        }
      },
      { webSearch: { tavilyApiKey: 'tavily-secret', backend: 'tavily' } }
    ]

    for (const nextOverlay of cases) {
      const result = compareAndProjectConfigWrite({
        currentResolved: current,
        expectedFingerprint: current.fingerprint,
        nextOverlay,
        layer: 'user'
      })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.code).toBe('secret_path_rejected')
      expect(result.message).toMatch(/密钥|secret/i)
    }
  })

  it('fingerprint changes after a successful write projection', () => {
    const current = baseResolved({
      memory: { enabled: true, maxInjected: 2 }
    })
    const first = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: { memory: { maxInjected: 5 } },
      layer: 'user',
      baseScope: {
        fallbackDefaultRoot: FALLBACK_ROOT,
        user: { memory: { enabled: true, maxInjected: 2 } }
      }
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = compareAndProjectConfigWrite({
      currentResolved: first.resolved,
      expectedFingerprint: first.fingerprint,
      nextOverlay: { memory: { maxInjected: 8 } },
      layer: 'user',
      baseScope: {
        fallbackDefaultRoot: FALLBACK_ROOT,
        user: first.nextOverlay
      }
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(second.value.memory.maxInjected).toBe(8)

    // Stale write after fingerprint advanced must conflict.
    const stale = compareAndProjectConfigWrite({
      currentResolved: second.resolved,
      expectedFingerprint: first.fingerprint,
      nextOverlay: { memory: { maxInjected: 1 } },
      layer: 'user'
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.code).toBe('fingerprint_mismatch')
  })

  it('rejects invalid input and empty fingerprint', () => {
    const current = baseResolved()

    const emptyFp = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: '   ',
      nextOverlay: { tools: { enabled: true } }
    })
    expect(emptyFp.ok).toBe(false)
    if (!emptyFp.ok) expect(emptyFp.code).toBe('invalid_fingerprint')

    const nullNext = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: null
    })
    expect(nullNext.ok).toBe(false)
    if (!nullNext.ok) expect(nullNext.code).toBe('invalid_input')

    const arrayNext = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: [1, 2, 3]
    })
    expect(arrayNext.ok).toBe(false)
    if (!arrayNext.ok) expect(arrayNext.code).toBe('invalid_input')
  })

  it('applies workspace layer overlays without clobbering user layer', () => {
    const current = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: { tools: { enabled: true, workspaceRead: false } },
      workspace: { tools: { workspaceRead: true } }
    })

    const result = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: { tools: { workspaceRead: true }, memory: { maxInjected: 4 } },
      layer: 'workspace',
      baseScope: {
        fallbackDefaultRoot: FALLBACK_ROOT,
        user: { tools: { enabled: true, workspaceRead: false } },
        workspace: { tools: { workspaceRead: true } }
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tools.enabled).toBe(true)
    expect(result.value.tools.workspaceRead).toBe(true)
    expect(result.value.memory.maxInjected).toBe(4)
    expect(result.layer).toBe('workspace')
  })

  it('projectConfigWriteRequest mirrors the pure CAS core', () => {
    const current = baseResolved({ privacy: { maskApiKeys: true } })
    const result = projectConfigWriteRequest(
      {
        expectedFingerprint: current.fingerprint,
        next: { privacy: { allowExternalLinks: false } },
        layer: 'user'
      },
      current,
      {
        fallbackDefaultRoot: FALLBACK_ROOT,
        user: { privacy: { maskApiKeys: true } }
      }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.privacy.allowExternalLinks).toBe(false)
  })

  it('writeConfigOptimistic adapter: CAS then atomic write; mismatch skips write', async () => {
    let written: unknown = null
    const userDoc = { tools: { enabled: false, workspaceRead: false } }
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: userDoc
    })

    const store: ConfigOptimisticStore = {
      async read() {
        return {
          fingerprint: resolved.fingerprint,
          user: userDoc,
          fallbackDefaultRoot: FALLBACK_ROOT
        }
      },
      async writeAtomic(input) {
        written = input
      }
    }

    const conflict = await writeConfigOptimistic(store, {
      expectedFingerprint: 'sha256:' + 'a'.repeat(64),
      next: { tools: { enabled: true } }
    })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) expect(conflict.code).toBe('fingerprint_mismatch')
    expect(written).toBeNull()

    const ok = await writeConfigOptimistic(store, {
      expectedFingerprint: resolved.fingerprint,
      next: { tools: { enabled: true, workspaceRead: true } },
      layer: 'user'
    })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.fingerprint).not.toBe(resolved.fingerprint)
    expect(written).toMatchObject({
      layer: 'user',
      fingerprint: ok.fingerprint
    })
  })

  it('never projects secrets into success value fingerprint surface', () => {
    const current = baseResolved()
    // Non-secret path only — secrets are rejected earlier; ensure value is secret-free.
    const result = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: {
        tools: { enabled: true },
        webSearch: { backend: 'brave', maxResults: 5 }
      },
      layer: 'user',
      baseScope: { fallbackDefaultRoot: FALLBACK_ROOT }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const json = JSON.stringify(result.value)
    expect(json).not.toContain('apiKey')
    expect(json).not.toContain('braveApiKey')
    expect(json).not.toMatch(/"url"\s*:/)
  })

  it('preserves managed layer through CAS re-resolve on user write', () => {
    const managedDoc = {
      tools: { enabled: true, workspaceRead: true },
      memory: { maxInjected: 9 }
    }
    const userDoc = { tools: { workspaceRead: false } }
    const current = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: managedDoc,
      user: userDoc
    })

    // User still wins on workspaceRead; managed contributes memory. The legacy
    // tools.enabled field is compatibility-only and is normalized to true, so
    // it must not retain managed-layer provenance.
    expect(current.value.tools.enabled).toBe(true)
    expect(current.value.tools.workspaceRead).toBe(false)
    expect(current.value.memory.maxInjected).toBe(9)
    expect(current.sources.some((s) => s.source === 'managed' && s.path === 'tools.enabled')).toBe(
      false
    )
    expect(
      current.sources.some((s) => s.source === 'managed' && s.path === 'memory.maxInjected')
    ).toBe(true)

    const result = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: { tools: { workspaceRead: true } },
      layer: 'user',
      baseScope: {
        fallbackDefaultRoot: FALLBACK_ROOT,
        managed: managedDoc,
        user: userDoc
      }
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // User write updated workspaceRead; managed fields that user did not touch survive.
    expect(result.value.tools.workspaceRead).toBe(true)
    expect(result.value.tools.enabled).toBe(true)
    expect(result.value.memory.maxInjected).toBe(9)
    expect(
      result.resolved.sources.some((s) => s.source === 'managed' && s.path === 'tools.enabled')
    ).toBe(false)
    expect(
      result.resolved.sources.some((s) => s.source === 'managed' && s.path === 'memory.maxInjected')
    ).toBe(true)

    // Without managed preserve (regression baseline): dropping managed would lose memory.maxInjected=9.
    const dropped = compareAndProjectConfigWrite({
      currentResolved: current,
      expectedFingerprint: current.fingerprint,
      nextOverlay: { tools: { workspaceRead: true } },
      layer: 'user',
      baseScope: {
        fallbackDefaultRoot: FALLBACK_ROOT,
        // intentionally omit managed
        user: userDoc
      }
    })
    expect(dropped.ok).toBe(true)
    if (!dropped.ok) return
    // Default memory.maxInjected (4) differs from managed's 9 when managed is dropped.
    expect(dropped.value.memory.maxInjected).not.toBe(9)
    expect(
      dropped.resolved.sources.some((s) => s.source === 'managed' && s.path === 'memory.maxInjected')
    ).toBe(false)
  })

  it('writeConfigOptimistic preserves store-snapshot managed on re-resolve', async () => {
    let written: unknown = null
    const managedDoc = {
      tools: { enabled: true },
      memory: { maxInjected: 7 }
    }
    const userDoc = { tools: { workspaceRead: false } }
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: managedDoc,
      user: userDoc
    })

    const store: ConfigOptimisticStore = {
      async read() {
        return {
          fingerprint: resolved.fingerprint,
          user: userDoc,
          managed: managedDoc,
          fallbackDefaultRoot: FALLBACK_ROOT
        }
      },
      async writeAtomic(input) {
        written = input
      }
    }

    const ok = await writeConfigOptimistic(store, {
      expectedFingerprint: resolved.fingerprint,
      next: { tools: { workspaceRead: true } },
      layer: 'user'
    })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.value).toBeDefined()
    const value = ok.value as {
      tools: { enabled: boolean; workspaceRead: boolean }
      memory: { maxInjected: number }
    }
    expect(value.tools.workspaceRead).toBe(true)
    expect(value.tools.enabled).toBe(true)
    expect(value.memory.maxInjected).toBe(7)
    expect(written).toMatchObject({
      layer: 'user',
      fingerprint: ok.fingerprint
    })
  })
})
