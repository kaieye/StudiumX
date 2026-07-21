import { describe, expect, it } from 'vitest'

import {
  TEACHING_DOCTOR_CONFIG_PATH_LABEL,
  createTeachingDoctorConfigFactsCollector,
  runProductTeachingDoctor,
  type TeachingDoctorConfigFactsSource
} from '../../src/main/observability'

const SECRET_KEY = 'sk-live-super-secret-key-do-not-leak-12345'

function settingsWithProvider(apiKey: string) {
  return {
    version: 1,
    provider: {
      activeProviderId: 'openai',
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          apiKey,
          baseUrl: 'https://api.openai.com/v1',
          endpointFormat: 'chat_completions',
          models: ['gpt-4o-mini'],
          docsUrl: '',
          apiKeyUrl: ''
        }
      ],
      proxy: { enabled: false, url: '' }
    },
    generator: {
      providerId: 'openai',
      model: 'gpt-4o-mini'
    }
  }
}

describe('createTeachingDoctorConfigFactsCollector', () => {
  it('maps successful load with provider credentials to providerConfigured true', async () => {
    const source: TeachingDoctorConfigFactsSource = {
      async load() {
        return settingsWithProvider(SECRET_KEY)
      }
    }
    const collector = createTeachingDoctorConfigFactsCollector(source)
    expect(collector.id).toBe('config-settings')

    const partial = await collector.collect()
    expect(partial.config).toEqual({
      settingsAvailable: true,
      settingsReadable: true,
      settingsParseable: true,
      providerConfigured: true,
      reason: null,
      configPath: TEACHING_DOCTOR_CONFIG_PATH_LABEL
    })

    const blob = JSON.stringify(partial)
    expect(blob).not.toContain(SECRET_KEY)
    expect(blob).not.toMatch(/sk-live/i)
    expect(blob).not.toMatch(/C:\\\\Users|\/home\//i)
  })

  it('marks providerConfigured false when settings load without credentials or models', async () => {
    const source: TeachingDoctorConfigFactsSource = {
      async load() {
        return {
          version: 1,
          provider: {
            activeProviderId: 'openai',
            providers: [
              {
                id: 'openai',
                name: 'OpenAI',
                apiKey: '',
                models: [],
                baseUrl: '',
                endpointFormat: 'chat_completions',
                docsUrl: '',
                apiKeyUrl: ''
              }
            ],
            proxy: { enabled: false, url: '' }
          },
          generator: { providerId: 'openai', model: '' }
        }
      }
    }
    const partial = await createTeachingDoctorConfigFactsCollector(source).collect()
    expect(partial.config?.settingsAvailable).toBe(true)
    expect(partial.config?.settingsParseable).toBe(true)
    expect(partial.config?.providerConfigured).toBe(false)
    expect(partial.config?.reason).toBe('provider_not_configured')
    expect(partial.config?.configKey).toBe('provider.apiKey')
    expect(partial.config?.configPath).toBe(TEACHING_DOCTOR_CONFIG_PATH_LABEL)
  })

  it('treats non-empty models as providerConfigured even without apiKey', async () => {
    const source: TeachingDoctorConfigFactsSource = {
      async load() {
        return {
          provider: {
            activeProviderId: 'local',
            providers: [{ id: 'local', apiKey: '', models: ['local-model'] }]
          }
        }
      }
    }
    const partial = await createTeachingDoctorConfigFactsCollector(source).collect()
    expect(partial.config?.providerConfigured).toBe(true)
    expect(partial.config?.reason).toBeNull()
  })

  it('treats generator.model as providerConfigured', async () => {
    const source: TeachingDoctorConfigFactsSource = {
      async load() {
        return {
          provider: { activeProviderId: 'x', providers: [] },
          generator: { model: 'some-model' }
        }
      }
    }
    const partial = await createTeachingDoctorConfigFactsCollector(source).collect()
    expect(partial.config?.providerConfigured).toBe(true)
  })

  it('fail-soft on load throw: structured unavailable facts, never rethrows', async () => {
    const source: TeachingDoctorConfigFactsSource = {
      async load() {
        throw new Error(`ENOENT C:\\Users\\Alice\\.config\\studiumx-settings.json key=${SECRET_KEY}`)
      }
    }
    const collector = createTeachingDoctorConfigFactsCollector(source)
    const partial = await collector.collect()
    expect(partial.config).toEqual({
      settingsAvailable: false,
      settingsReadable: false,
      settingsParseable: false,
      providerConfigured: false,
      reason: 'settings_load_failed',
      configPath: TEACHING_DOCTOR_CONFIG_PATH_LABEL
    })
    const blob = JSON.stringify(partial)
    expect(blob).not.toContain(SECRET_KEY)
    expect(blob).not.toMatch(/Alice|ENOENT|C:\\\\Users/i)
  })

  it('marks non-object load as unparseable', async () => {
    const source: TeachingDoctorConfigFactsSource = {
      async load() {
        return 'not-json-object'
      }
    }
    const partial = await createTeachingDoctorConfigFactsCollector(source).collect()
    expect(partial.config?.settingsAvailable).toBe(true)
    expect(partial.config?.settingsReadable).toBe(true)
    expect(partial.config?.settingsParseable).toBe(false)
    expect(partial.config?.providerConfigured).toBe(false)
    expect(partial.config?.reason).toBe('settings_unparseable')
  })

  it('honors custom configPathLabel', async () => {
    const source: TeachingDoctorConfigFactsSource = {
      async load() {
        return { provider: { providers: [] } }
      }
    }
    const partial = await createTeachingDoctorConfigFactsCollector(source, {
      configPathLabel: 'userData/custom-settings.json'
    }).collect()
    expect(partial.config?.configPath).toBe('userData/custom-settings.json')
  })

  it('product-run with collector returns export-safe config_availability check', async () => {
    const collector = createTeachingDoctorConfigFactsCollector({
      async load() {
        return settingsWithProvider(SECRET_KEY)
      }
    })
    const report = await runProductTeachingDoctor(
      { includeProcessCrashMarker: false },
      {
        factsCollectors: [collector],
        now: () => '2026-07-21T12:00:00.000Z'
      }
    )
    const configCheck = report.checks.find((c) => c.checkId === 'config_availability')
    expect(configCheck).toBeDefined()
    expect(configCheck?.result).toBe('ok')
    expect(configCheck?.evidence.fields.providerConfigured).toBe(true)
    expect(configCheck?.repair.autoRepairAllowed).toBe(false)
    expect(report.diagnostics.autoRepair).toBe('disabled')

    const blob = JSON.stringify(report)
    expect(blob).not.toContain(SECRET_KEY)
    expect(blob).not.toMatch(/sk-live-super-secret/i)
  })
})
