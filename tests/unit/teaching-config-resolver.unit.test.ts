import { describe, expect, it } from 'vitest'

import {
  createTeachingConfigResolver,
  fingerprintTeachingConfig,
  isTeachingConfigSecretPath,
  resolveTeachingConfig,
  resolveTeachingConfigFromSettings,
  teachingConfigUserLayerFromUnknown,
  TEACHING_CONFIG_SCHEMA_VERSION
} from '../../src/main/teaching-config-resolver'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'
import { DEFAULT_LESSON_STYLE_ID } from '../../src/shared/lesson-styles'

const FALLBACK_ROOT = 'C:/StudiumX/workspace'

function sourceOf(resolved: ReturnType<typeof resolveTeachingConfig>, path: string) {
  return resolved.sources.find((entry) => entry.path === path)?.source
}

describe('TeachingConfigResolver', () => {
  it('resolves defaults with explainable default sources and a stable fingerprint', () => {
    const resolved = resolveTeachingConfig({ fallbackDefaultRoot: FALLBACK_ROOT })
    const again = createTeachingConfigResolver().resolve({ fallbackDefaultRoot: FALLBACK_ROOT })

    expect(resolved.value.schemaVersion).toBe(TEACHING_CONFIG_SCHEMA_VERSION)
    expect(resolved.value.workspace.defaultRoot).toBe(FALLBACK_ROOT)
    expect(resolved.value.workspace.lessonStyleId).toBe(DEFAULT_LESSON_STYLE_ID)
    expect(resolved.value.tools.enabled).toBe(false)
    expect(resolved.diagnostics).toEqual([])
    expect(sourceOf(resolved, 'tools.enabled')).toBe('default')
    expect(sourceOf(resolved, 'generator.model')).toBe('default')
    expect(resolved.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(again.fingerprint).toBe(resolved.fingerprint)
    expect(fingerprintTeachingConfig(resolved.value)).toBe(resolved.fingerprint)
  })

  it('applies explicit priority default < user < workspace < session_override', () => {
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: {
        tools: { enabled: true, maxIterations: 2 },
        memory: { maxInjected: 3 },
        generator: { temperature: 0.2 }
      },
      workspace: {
        tools: { maxIterations: 4 },
        memory: { maxInjected: 5 },
        generator: { temperature: 0.5 }
      },
      sessionOverride: {
        tools: { maxIterations: 6 },
        generator: { temperature: 0.7 }
      }
    })

    expect(resolved.value.tools.enabled).toBe(true)
    expect(resolved.value.tools.maxIterations).toBe(6)
    expect(resolved.value.memory.maxInjected).toBe(5)
    expect(resolved.value.generator.temperature).toBe(0.7)
    expect(sourceOf(resolved, 'tools.enabled')).toBe('user')
    expect(sourceOf(resolved, 'tools.maxIterations')).toBe('session_override')
    expect(sourceOf(resolved, 'memory.maxInjected')).toBe('workspace')
    expect(sourceOf(resolved, 'generator.temperature')).toBe('session_override')
    expect(sourceOf(resolved, 'workspace.defaultRoot')).toBe('default')
  })

  it('never projects secrets into the ordinary snapshot', () => {
    const settings = createTeachingSettingsDefaults(FALLBACK_ROOT)
    settings.provider.providers[0]!.apiKey = 'provider-secret-value'
    settings.provider.proxy.url = 'https://proxy.example.test?token=proxy-secret'
    settings.provider.proxy.enabled = true
    settings.webSearch.braveApiKey = 'brave-secret'
    settings.webSearch.tavilyApiKey = 'tavily-secret'
    settings.webSearch.exaApiKey = 'exa-secret'
    settings.webSearch.firecrawlApiKey = 'firecrawl-secret'
    settings.webSearch.parallelApiKey = 'parallel-secret'
    settings.webSearch.xaiApiKey = 'xai-secret'
    settings.tools.enabled = true

    const resolved = resolveTeachingConfigFromSettings(settings, {
      sessionOverride: {
        provider: {
          providers: [{
            id: 'custom',
            name: 'Custom',
            apiKey: 'session-provider-secret',
            baseUrl: 'https://models.example.test/v1',
            endpointFormat: 'chat_completions',
            models: ['model-a']
          }]
        },
        webSearch: { braveApiKey: 'session-brave-secret', backend: 'brave' }
      }
    })

    const json = JSON.stringify(resolved.value)
    expect(json).not.toContain('provider-secret-value')
    expect(json).not.toContain('proxy-secret')
    expect(json).not.toContain('brave-secret')
    expect(json).not.toContain('tavily-secret')
    expect(json).not.toContain('session-provider-secret')
    expect(json).not.toContain('session-brave-secret')
    expect(json).not.toContain('"apiKey"')
    expect(json).not.toContain('braveApiKey')
    expect(json).not.toContain('tavilyApiKey')
    expect(resolved.value.provider.proxy).toEqual({ enabled: true })
    expect('url' in resolved.value.provider.proxy).toBe(false)
    expect(resolved.value.provider.providers.every((provider) => !('apiKey' in provider))).toBe(true)
    expect(resolved.value.webSearch.backend).toBe('brave')
    expect(resolved.value.tools.enabled).toBe(true)

    expect(isTeachingConfigSecretPath('provider.providers.0.apiKey')).toBe(true)
    expect(isTeachingConfigSecretPath('provider.proxy.url')).toBe(true)
    expect(isTeachingConfigSecretPath('webSearch.braveApiKey')).toBe(true)
    expect(isTeachingConfigSecretPath('tools.enabled')).toBe(false)

    const secretWarnings = resolved.diagnostics.filter((item) => item.code === 'secret_stripped')
    expect(secretWarnings.length).toBeGreaterThan(0)
    expect(secretWarnings.every((item) => item.severity === 'warning')).toBe(true)
  })

  it('returns diagnostics and skips invalid layers/fields without half-apply', () => {
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: {
        tools: { enabled: true, maxIterations: 3 }
      },
      workspace: 'not-an-object',
      sessionOverride: {
        tools: { enabled: 'yes', maxIterations: 99, runBudget: 'bad' },
        memory: { maxInjected: 0 },
        generator: { temperature: 9 }
      }
    })

    // Valid user layer applied; invalid workspace layer skipped entirely.
    expect(resolved.value.tools.enabled).toBe(true)
    expect(resolved.value.tools.maxIterations).toBe(3)
    expect(sourceOf(resolved, 'tools.enabled')).toBe('user')
    expect(sourceOf(resolved, 'tools.maxIterations')).toBe('user')

    // Invalid session fields skipped — no half-applied values.
    expect(resolved.value.tools.enabled).toBe(true)
    expect(resolved.value.tools.maxIterations).toBe(3)
    expect(resolved.value.memory.maxInjected).not.toBe(0)
    expect(resolved.value.generator.temperature).toBeLessThanOrEqual(2)

    expect(resolved.diagnostics.some((item) => item.code === 'invalid_layer' && item.source === 'workspace')).toBe(true)
    expect(resolved.diagnostics.some((item) => item.code === 'invalid_field' && item.path === 'tools.enabled')).toBe(true)
    expect(resolved.diagnostics.some((item) => item.code === 'invalid_field' && item.path === 'tools.maxIterations')).toBe(true)
    expect(resolved.diagnostics.some((item) => item.code === 'invalid_field' && item.path === 'tools.runBudget')).toBe(true)
    expect(resolved.diagnostics.some((item) => item.code === 'invalid_field' && item.path === 'memory.maxInjected')).toBe(true)
    expect(resolved.diagnostics.some((item) => item.code === 'invalid_field' && item.path === 'generator.temperature')).toBe(true)
  })

  it('changes fingerprint when effective teaching-loop value changes', () => {
    const base = resolveTeachingConfig({ fallbackDefaultRoot: FALLBACK_ROOT })
    const changed = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      sessionOverride: { tools: { enabled: true } }
    })
    const same = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: { pet: { enabled: false }, notifications: { enabled: false } }
    })

    expect(changed.fingerprint).not.toBe(base.fingerprint)
    expect(same.fingerprint).toBe(base.fingerprint)
    expect(changed.value.tools.enabled).toBe(true)
    expect(same.value.tools.enabled).toBe(false)
  })

  it('adapts existing TeachingSettingsService documents through resolveTeachingConfigFromSettings', () => {
    const settings = createTeachingSettingsDefaults(FALLBACK_ROOT)
    settings.generator.model = 'special-model'
    settings.memory.enabled = false
    settings.memory.maxInjected = 2
    settings.workspace.lessonStyleId = DEFAULT_LESSON_STYLE_ID
    settings.provider.providers[0]!.apiKey = 'must-not-leak'

    const resolved = resolveTeachingConfigFromSettings(settings, {
      workspace: { generator: { model: 'workspace-model' } },
      sessionOverride: { generator: { model: 'session-model' } }
    })

    expect(resolved.value.generator.model).toBe('session-model')
    expect(resolved.value.memory.enabled).toBe(false)
    expect(resolved.value.memory.maxInjected).toBe(2)
    expect(sourceOf(resolved, 'generator.model')).toBe('session_override')
    expect(sourceOf(resolved, 'memory.enabled')).toBe('user')
    expect(JSON.stringify(resolved.value)).not.toContain('must-not-leak')
  })

  it('can project unknown user documents through the shared schema adapter', () => {
    const user = teachingConfigUserLayerFromUnknown({
      tools: { enabled: true },
      generator: { temperature: 0.1 },
      provider: { providers: [{ id: 'openai', apiKey: 'legacy-secret' }] }
    }, FALLBACK_ROOT)

    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user
    })

    expect(resolved.value.tools.enabled).toBe(true)
    expect(resolved.value.generator.temperature).toBe(0.1)
    expect(JSON.stringify(resolved.value)).not.toContain('legacy-secret')
    expect(JSON.stringify(resolved.value)).not.toContain('"apiKey"')
  })

  it('projects only teaching-loop fields (no pet/notifications/appBehavior/log/theme)', () => {
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: createTeachingSettingsDefaults(FALLBACK_ROOT)
    })

    const keys = Object.keys(resolved.value).sort()
    expect(keys).toEqual(['generator', 'memory', 'privacy', 'provider', 'schemaVersion', 'tools', 'webSearch', 'workspace'])
    expect(resolved.value).not.toHaveProperty('pet')
    expect(resolved.value).not.toHaveProperty('notifications')
    expect(resolved.value).not.toHaveProperty('appBehavior')
    expect(resolved.value).not.toHaveProperty('log')
    expect(resolved.value).not.toHaveProperty('theme')
  })
})

