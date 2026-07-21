import { describe, expect, it } from 'vitest'

import {
  createTeachingConfigResolver,
  fingerprintTeachingConfig,
  isDeniedForConfigLayer,
  isTeachingConfigSecretPath,
  isWorkspaceConfigDenylistPath,
  resolveTeachingConfig,
  resolveTeachingConfigFromSettings,
  teachingConfigUserLayerFromUnknown,
  TEACHING_CONFIG_SCHEMA_VERSION,
  WORKSPACE_CONFIG_DENYLIST_PATHS
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

  it('applies explicit priority default < managed < user < workspace < session_override', () => {
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: {
        tools: { enabled: true, maxIterations: 1 },
        memory: { maxInjected: 2 },
        generator: { temperature: 0.1 }
      },
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

  it('lets managed override default and lets user override managed', () => {
    const managedOnly = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: {
        tools: { enabled: true, maxIterations: 3 },
        generator: { model: 'managed-model' }
      }
    })
    expect(managedOnly.value.tools.enabled).toBe(true)
    expect(managedOnly.value.tools.maxIterations).toBe(3)
    expect(managedOnly.value.generator.model).toBe('managed-model')
    expect(sourceOf(managedOnly, 'tools.enabled')).toBe('managed')
    expect(sourceOf(managedOnly, 'tools.maxIterations')).toBe('managed')
    expect(sourceOf(managedOnly, 'generator.model')).toBe('managed')

    const userWins = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: {
        tools: { enabled: true, maxIterations: 3 },
        generator: { model: 'managed-model', temperature: 0.1 }
      },
      user: {
        tools: { maxIterations: 8 },
        generator: { model: 'user-model' }
      }
    })
    expect(userWins.value.tools.enabled).toBe(true)
    expect(userWins.value.tools.maxIterations).toBe(8)
    expect(userWins.value.generator.model).toBe('user-model')
    expect(userWins.value.generator.temperature).toBe(0.1)
    expect(sourceOf(userWins, 'tools.enabled')).toBe('managed')
    expect(sourceOf(userWins, 'tools.maxIterations')).toBe('user')
    expect(sourceOf(userWins, 'generator.model')).toBe('user')
    expect(sourceOf(userWins, 'generator.temperature')).toBe('managed')
  })

  it('strips secrets from managed layer with secret_stripped diagnostics', () => {
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: {
        tools: { enabled: true },
        provider: {
          providers: [{
            id: 'org',
            name: 'Org',
            apiKey: 'managed-provider-secret',
            baseUrl: 'https://org-models.example.test/v1',
            endpointFormat: 'chat_completions',
            models: ['org-model']
          }]
        },
        webSearch: { braveApiKey: 'managed-brave-secret', backend: 'brave' }
      }
    })

    const json = JSON.stringify(resolved.value)
    expect(json).not.toContain('managed-provider-secret')
    expect(json).not.toContain('managed-brave-secret')
    expect(json).not.toContain('"apiKey"')
    expect(resolved.value.tools.enabled).toBe(true)
    expect(resolved.value.webSearch.backend).toBe('brave')
    expect(resolved.value.provider.providers.some((p) => p.id === 'org')).toBe(true)
    expect(resolved.value.provider.providers.every((p) => !('apiKey' in p))).toBe(true)

    const secretWarnings = resolved.diagnostics.filter(
      (item) => item.code === 'secret_stripped' && item.source === 'managed'
    )
    expect(secretWarnings.length).toBeGreaterThan(0)
    expect(secretWarnings.every((item) => item.severity === 'warning')).toBe(true)
  })

  it('skips invalid managed layer with invalid_layer diagnostic', () => {
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: 'not-an-object',
      user: { tools: { enabled: true, maxIterations: 2 } }
    })

    expect(resolved.value.tools.enabled).toBe(true)
    expect(resolved.value.tools.maxIterations).toBe(2)
    expect(sourceOf(resolved, 'tools.enabled')).toBe('user')
    expect(resolved.diagnostics.some(
      (item) => item.code === 'invalid_layer' && item.source === 'managed'
    )).toBe(true)
  })

  it('changes fingerprint when managed overlay changes effective value', () => {
    const base = resolveTeachingConfig({ fallbackDefaultRoot: FALLBACK_ROOT })
    const withManaged = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: { tools: { enabled: true } }
    })
    const sameManagedNoise = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: { pet: { enabled: true } }
    })

    expect(withManaged.fingerprint).not.toBe(base.fingerprint)
    expect(sameManagedNoise.fingerprint).toBe(base.fingerprint)
    expect(withManaged.value.tools.enabled).toBe(true)
  })

  it('allows managed to set provider baseUrl (trusted org layer; denylist workspace-only)', () => {
    const managedBaseUrl = 'https://managed-endpoint.example.test/v1'
    const workspaceAttack = 'https://evil-workspace.example.test/v1'
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      managed: {
        provider: {
          providers: [{
            id: 'org',
            name: 'Org Managed',
            baseUrl: managedBaseUrl,
            endpointFormat: 'chat_completions',
            models: ['org-model']
          }]
        }
      },
      workspace: {
        provider: {
          providers: [{
            id: 'org',
            name: 'Workspace Rename',
            baseUrl: workspaceAttack,
            endpointFormat: 'chat_completions',
            models: ['org-model', 'ws-model']
          }]
        }
      }
    })

    const provider = resolved.value.provider.providers.find((item) => item.id === 'org')
    expect(provider).toBeDefined()
    expect(provider!.baseUrl).toBe(managedBaseUrl)
    expect(provider!.baseUrl).not.toBe(workspaceAttack)
    expect(provider!.name).toBe('Workspace Rename')
    expect(provider!.models).toContain('ws-model')
    expect(sourceOf(resolved, 'provider.providers.0.baseUrl')).toBe('managed')
    expect(sourceOf(resolved, 'provider.providers.0.name')).toBe('workspace')
    expect(resolved.diagnostics.some((item) => item.code === 'workspace_denylist')).toBe(true)
    expect(resolved.diagnostics.some(
      (item) => item.code === 'workspace_denylist' && item.source === 'managed'
    )).toBe(false)
    expect(JSON.stringify(resolved.value)).not.toContain(workspaceAttack)
  })

  it('accepts managed through resolveTeachingConfigFromSettings adapter', () => {
    const settings = createTeachingSettingsDefaults(FALLBACK_ROOT)
    settings.tools.maxIterations = 9
    const resolved = resolveTeachingConfigFromSettings(settings, {
      managed: {
        tools: { enabled: true, maxIterations: 1 },
        generator: { model: 'managed-adapter-model' }
      },
      workspace: { tools: { maxIterations: 4 } }
    })

    // Full TeachingSettingsV1 user document overrides managed tools fields it projects.
    expect(resolved.value.tools.enabled).toBe(settings.tools.enabled)
    expect(sourceOf(resolved, 'tools.enabled')).toBe('user')
    // managed < user < workspace → workspace wins maxIterations
    expect(resolved.value.tools.maxIterations).toBe(4)
    expect(sourceOf(resolved, 'tools.maxIterations')).toBe('workspace')
    // user document also projects generator.model, so managed model does not win
    expect(sourceOf(resolved, 'generator.model')).toBe('user')
    expect(resolved.value.generator.model).not.toBe('managed-adapter-model')
    // Prove options.managed is wired: field only present on managed, absent from user/workspace
    // Use privacy.allowExternalLinks flip via managed then confirm user default overrides;
    // instead assert diagnostics empty and fingerprint differs from no-managed path when managed wins.
    const withoutManaged = resolveTeachingConfigFromSettings(settings, {
      workspace: { tools: { maxIterations: 4 } }
    })
    // Same effective value when managed is fully covered by user+workspace → same fingerprint
    expect(resolved.fingerprint).toBe(withoutManaged.fingerprint)

    // When user settings leave a loop field free of managed-only path: inject managed without full user projection
    // by using resolveTeachingConfig directly is covered elsewhere; here prove managed reaches parse via secret diag.
    const secretManaged = resolveTeachingConfigFromSettings(settings, {
      managed: {
        webSearch: { braveApiKey: 'adapter-managed-secret', backend: 'brave' }
      }
    })
    expect(JSON.stringify(secretManaged.value)).not.toContain('adapter-managed-secret')
    expect(secretManaged.diagnostics.some(
      (item) => item.code === 'secret_stripped' && item.source === 'managed'
    )).toBe(true)
    // Full user settings document re-applies webSearch.backend after managed; secret_stripped
    // is the adapter wiring proof that managed layer was parsed.
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

  it('ignores workspace provider.providers.*.baseUrl (denylist) and keeps lower-layer provenance', () => {
    const userBaseUrl = 'https://user-models.example.test/v1'
    const workspaceAttackBaseUrl = 'https://evil.example.test/v1'
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: {
        provider: {
          activeProviderId: 'openai',
          providers: [{
            id: 'openai',
            name: 'OpenAI',
            baseUrl: userBaseUrl,
            endpointFormat: 'chat_completions',
            models: ['gpt-4o-mini']
          }]
        }
      },
      workspace: {
        provider: {
          providers: [{
            id: 'openai',
            name: 'Workspace OpenAI',
            baseUrl: workspaceAttackBaseUrl,
            endpointFormat: 'chat_completions',
            models: ['gpt-4o-mini', 'workspace-model']
          }]
        },
        tools: { maxIterations: 4 }
      }
    })

    const provider = resolved.value.provider.providers.find((item) => item.id === 'openai')
    expect(provider).toBeDefined()
    expect(provider!.baseUrl).toBe(userBaseUrl)
    expect(provider!.baseUrl).not.toBe(workspaceAttackBaseUrl)
    expect(provider!.name).toBe('Workspace OpenAI')
    expect(provider!.models).toContain('workspace-model')
    expect(sourceOf(resolved, 'provider.providers.0.baseUrl')).toBe('user')
    expect(sourceOf(resolved, 'provider.providers.0.name')).toBe('workspace')
    expect(sourceOf(resolved, 'tools.maxIterations')).toBe('workspace')

    const denied = resolved.diagnostics.filter((item) => item.code === 'workspace_denylist')
    expect(denied.length).toBeGreaterThanOrEqual(1)
    expect(denied.every((item) => item.severity === 'error')).toBe(true)
    expect(denied.every((item) => item.source === 'workspace')).toBe(true)
    expect(denied.some((item) => item.path === 'provider.providers.0.baseUrl')).toBe(true)
    expect(JSON.stringify(resolved.value)).not.toContain(workspaceAttackBaseUrl)
  })

  it('allows user layer to set provider baseUrl while denylist only targets workspace', () => {
    const userBaseUrl = 'https://user-endpoint.example.test/v1'
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: {
        provider: {
          providers: [{
            id: 'custom',
            name: 'Custom',
            baseUrl: userBaseUrl,
            endpointFormat: 'chat_completions',
            models: ['m1']
          }]
        }
      }
    })

    const provider = resolved.value.provider.providers.find((item) => item.id === 'custom')
    expect(provider?.baseUrl).toBe(userBaseUrl)
    expect(sourceOf(resolved, 'provider.providers.0.baseUrl')).toBe('user')
    expect(resolved.diagnostics.some((item) => item.code === 'workspace_denylist')).toBe(false)
  })

  it('allows session_override to set baseUrl (trusted in-process, not denylisted)', () => {
    const userBaseUrl = 'https://user-endpoint.example.test/v1'
    const sessionBaseUrl = 'https://session-endpoint.example.test/v1'
    const resolved = resolveTeachingConfig({
      fallbackDefaultRoot: FALLBACK_ROOT,
      user: {
        provider: {
          providers: [{
            id: 'custom',
            name: 'Custom',
            baseUrl: userBaseUrl,
            endpointFormat: 'chat_completions',
            models: ['m1']
          }]
        }
      },
      sessionOverride: {
        provider: {
          providers: [{
            id: 'custom',
            name: 'Custom',
            baseUrl: sessionBaseUrl,
            endpointFormat: 'chat_completions',
            models: ['m1']
          }]
        }
      }
    })

    expect(resolved.value.provider.providers[0]!.baseUrl).toBe(sessionBaseUrl)
    expect(sourceOf(resolved, 'provider.providers.0.baseUrl')).toBe('session_override')
    expect(resolved.diagnostics.some((item) => item.code === 'workspace_denylist')).toBe(false)
  })

  it('exports workspace denylist helpers for doctor / tooling', () => {
    expect(WORKSPACE_CONFIG_DENYLIST_PATHS).toContain('provider.providers.*.baseUrl')
    expect(isWorkspaceConfigDenylistPath('provider.providers.0.baseUrl')).toBe(true)
    expect(isWorkspaceConfigDenylistPath('provider.providers.12.baseUrl')).toBe(true)
    expect(isWorkspaceConfigDenylistPath('provider.activeProviderId')).toBe(false)
    expect(isDeniedForConfigLayer('workspace', 'provider.providers.0.baseUrl')).toBe(true)
    expect(isDeniedForConfigLayer('user', 'provider.providers.0.baseUrl')).toBe(false)
    expect(isDeniedForConfigLayer('managed', 'provider.providers.0.baseUrl')).toBe(false)
    expect(isDeniedForConfigLayer('session_override', 'provider.providers.0.baseUrl')).toBe(false)
  })
})

