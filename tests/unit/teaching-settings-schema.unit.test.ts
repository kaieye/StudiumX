import { describe, expect, it } from 'vitest'
import {
  createTeachingSettingsDefaults,
  mergeTeachingSettings,
  normalizeTeachingSettings
} from '../../src/shared/teaching-settings-schema'
import { normalizeSettings } from '../../src/main/teaching-settings'
import { emptySettings, normalizeRendererSettings } from '../../src/renderer/src/workflows/settings'

describe('teaching settings schema', () => {
  const fallbackRoot = 'C:\\StudiumX\\workspace'

  it('creates the same complete default document for main and renderer callers', () => {
    expect(createTeachingSettingsDefaults('')).toEqual(emptySettings)
    expect(createTeachingSettingsDefaults(fallbackRoot)).toMatchObject({
      version: 2,
      workspace: { defaultRoot: fallbackRoot },
      worktree: { rootPath: 'C:\\StudiumX\\workspace\\.worktrees' },
      tools: { enabled: true, workspaceShell: true },
      appBehavior: { closeAction: 'tray', closeToTray: true }
    })
  })

  it('keeps user resource budgets opt-in and normalizes their explicit per-run limits', () => {
    expect(createTeachingSettingsDefaults(fallbackRoot).resourceBudget).toEqual({
      enabled: false,
      providerTransportAttempts: 20,
      toolOperationAttempts: 40,
      durationMinutes: 30,
      totalTokens: 200_000
    })

    expect(normalizeTeachingSettings({
      resourceBudget: {
        enabled: true,
        providerTransportAttempts: 0,
        toolOperationAttempts: 10_000.6,
        durationMinutes: 2_000,
        totalTokens: 999
      }
    }, fallbackRoot).resourceBudget).toEqual({
      enabled: true,
      providerTransportAttempts: 1,
      toolOperationAttempts: 10_000,
      durationMinutes: 1_440,
      totalTokens: 1_000
    })

    const merged = mergeTeachingSettings(createTeachingSettingsDefaults(fallbackRoot), {
      resourceBudget: { enabled: true, durationMinutes: 12 }
    })
    expect(merged.resourceBudget).toEqual({
      enabled: true,
      providerTransportAttempts: 20,
      toolOperationAttempts: 40,
      durationMinutes: 12,
      totalTokens: 200_000
    })
  })

  it('keeps application-level tool availability enabled, including legacy false values', () => {
    expect(normalizeTeachingSettings({}, fallbackRoot).tools.enabled).toBe(true)
    expect(normalizeTeachingSettings({ tools: { enabled: 'invalid' } }, fallbackRoot).tools.enabled).toBe(true)
    expect(normalizeTeachingSettings({ tools: { enabled: false } }, fallbackRoot).tools.enabled).toBe(true)
  })

  it('migrates legacy (pre-v2) records to close-to-tray regardless of stored closeAction', () => {
    const migrated = normalizeTeachingSettings(
      { version: 1, appBehavior: { closeAction: 'quit', closeToTray: false } },
      fallbackRoot
    )
    expect(migrated.version).toBe(2)
    expect(migrated.appBehavior.closeAction).toBe('tray')
    expect(migrated.appBehavior.closeToTray).toBe(true)
  })

  it('preserves an explicit quit choice on already-v2 records', () => {
    const preserved = normalizeTeachingSettings(
      { version: 2, appBehavior: { closeAction: 'quit', closeToTray: false } },
      fallbackRoot
    )
    expect(preserved.version).toBe(2)
    expect(preserved.appBehavior.closeAction).toBe('quit')
    expect(preserved.appBehavior.closeToTray).toBe(false)
  })

  it('defaults, clamps, and rounds persisted pet sizes explicitly', () => {
    expect(normalizeTeachingSettings({}, fallbackRoot).pet.size).toBe(112)
    expect(normalizeTeachingSettings({ pet: { size: 12 } }, fallbackRoot).pet.size).toBe(80)
    expect(normalizeTeachingSettings({ pet: { size: 111.6 } }, fallbackRoot).pet.size).toBe(112)
  })

  it('makes an empty, built-in, or legacy pet name follow the selected pet appearance', () => {
    expect(normalizeTeachingSettings({}, fallbackRoot).pet.displayName).toBe('噜噜')
    expect(normalizeTeachingSettings({ pet: { displayName: '小搭档' } }, fallbackRoot).pet.displayName).toBe('噜噜')
    expect(
      normalizeTeachingSettings({ pet: { displayName: 'Boba', appearance: 'usagi' } }, fallbackRoot).pet.displayName
    ).toBe('Usagi')
    expect(normalizeTeachingSettings({ pet: { displayName: 'Pikachu' } }, fallbackRoot).pet.displayName).toBe('Pikachu')
  })




  it('rewrites leftover TeachOS product default folders to StudiumX', () => {
    expect(normalizeTeachingSettings({
      workspace: { defaultRoot: 'C:\\Users\\alice\\Documents\\TeachOS Workspaces' },
      worktree: { rootPath: 'C:\\Users\\alice\\Documents\\TeachOS Workspaces\\.worktrees' }
    }, fallbackRoot)).toMatchObject({
      workspace: { defaultRoot: 'C:\\Users\\alice\\Documents\\StudiumX Workspaces' },
      worktree: { rootPath: 'C:\\Users\\alice\\Documents\\StudiumX Workspaces\\.worktrees' }
    })

    expect(normalizeTeachingSettings({
      workspace: { defaultRoot: 'D:\\archive\\TeachOS Workspaces notes' }
    }, fallbackRoot).workspace.defaultRoot).toBe('D:\\archive\\TeachOS Workspaces notes')
  })

  it('migrates the legacy write-only permission setting into a safe unified approval mode', () => {
    expect(normalizeTeachingSettings({
      tools: { workspaceWritePermission: 'allow_for_conversation' }
    }, fallbackRoot).tools.approvalMode).toBe('full_access')
    expect(normalizeTeachingSettings({
      tools: { workspaceWritePermission: 'ask_each_time' }
    }, fallbackRoot).tools.approvalMode).toBe('request_approval')
    expect(normalizeTeachingSettings({
      tools: { workspaceWritePermission: 'read_only' }
    }, fallbackRoot).tools.approvalMode).toBe('request_approval')
  })

  it('defaults and normalizes persisted pet notification preferences', () => {
    expect(normalizeTeachingSettings({}, fallbackRoot).pet.notificationPreferences).toEqual({
      actionableOnly: false,
      showRunning: true,
      showReview: true,
      showWaving: true,
      sources: { agent: true, lessonGeneration: true, lessonReview: true, onboarding: true },
      quietUntil: null
    })

    expect(normalizeTeachingSettings({
      pet: {
        notificationPreferences: {
          actionableOnly: true,
          showRunning: false,
          showReview: 'false',
          showWaving: false,
          sources: { agent: false, lessonGeneration: 'false', lessonReview: false, onboarding: false },
          quietUntil: 12_345.6
        }
      }
    }, fallbackRoot).pet.notificationPreferences).toEqual({
      actionableOnly: true,
      showRunning: false,
      showReview: true,
      showWaving: false,
      sources: { agent: false, lessonGeneration: true, lessonReview: false, onboarding: false },
      quietUntil: 12_346
    })

    expect(normalizeTeachingSettings({
      pet: { notificationPreferences: { quietUntil: 'tomorrow' } }
    }, fallbackRoot).pet.notificationPreferences.quietUntil).toBeNull()
  })

  it('normalizes malformed persisted data, missing objects, and legacy values', () => {
    const normalized = normalizeTeachingSettings({
      version: 0,
      locale: 'fr-FR',
      theme: 'neon',
      uiFontScale: '99',
      density: 'roomy',
      provider: {
        activeProviderId: 'missing provider',
        providers: [
          null,
          {
            id: ' custom ',
            name: '  Custom Provider  ',
            apiKey: 42,
            baseUrl: ' https://models.example.test/v1 ',
            endpointFormat: 'not-an-endpoint',
            models: [' model-a ', 'model-a', 2],
            docsUrl: 'https://should-not-survive.test',
            apiKeyUrl: 'https://should-not-survive.test/key'
          }
        ],
        proxy: 'not-an-object'
      },
      generator: {
        providerId: 'custom',
        model: ' model-a ',
        endpointFormat: 'responses',
        temperature: -5,
        maxOutputTokens: 999_999,
        lessonDurationMinutes: 'not-a-number',
        includeRetrievalPractice: false,
        generateReference: 'false',
        structuredOutput: false,
        streaming: true,
        reasoningEffort: 'impossible',
        requestTimeoutMs: 1
      },
      workspace: {
        defaultRoot: '  ',
        confirmBeforeGenerating: 'true',
        lessonStyleId: 'not-a-style'
      },
      worktree: null,
      memory: { enabled: false, maxInjected: 999 },
      tools: {
        enabled: 'true',
        workspaceRead: false,
        approvalMode: 'write-everywhere',
        webSearch: false,
        webFetch: true,
        // Retired persisted fields must be tolerated and removed on normalization.
        maxIterations: 0,
        runBudget: {
          maxDurationMs: '6000',
          maxProviderCalls: 1.5,
          maxToolCalls: 12,
          maxTotalTokens: 5_000_001,
          warningThreshold: 0.96
        }
      },
      webSearch: {
        backend: 'not-a-backend',
        fallbackEnabled: false,
        maxResults: 99,
        parallelSearchMode: 'turbo',
        xaiModel: '  '
      },
      notifications: null,
      pet: { appearance: 'robot', displayName: '  Legacy pet name that is much too long  ', size: 999 },
      privacy: { maskApiKeys: false },
      appBehavior: { closeAction: 'tray', closeToTray: 'yes' },
      log: { retentionDays: 0 }
    }, fallbackRoot)

    const custom = normalized.provider.providers.find((provider) => provider.id === 'custom')!
    expect(normalized).toMatchObject({
      version: 2,
      locale: 'zh-CN',
      theme: 'system',
      uiFontScale: 1.2,
      density: 'comfortable',
      generator: {
        providerId: 'custom',
        model: 'model-a',
        endpointFormat: 'responses',
        temperature: 0,
        maxOutputTokens: 32768,
        lessonDurationMinutes: 15,
        includeRetrievalPractice: false,
        generateReference: true,
        structuredOutput: false,
        streaming: true,
        reasoningEffort: 'auto',
        requestTimeoutMs: 5_000
      },
      workspace: {
        defaultRoot: fallbackRoot,
        confirmBeforeGenerating: false
      },
      worktree: { rootPath: 'C:\\StudiumX\\workspace\\.worktrees' },
      memory: { enabled: false, maxInjected: 12 },
      tools: {
        enabled: true,
        workspaceRead: false,
        approvalMode: 'request_approval',
        webSearch: false,
        webFetch: true
      },
      webSearch: {
        backend: 'auto',
        fallbackEnabled: false,
        maxResults: 20,
        parallelSearchMode: 'agentic',
        xaiModel: 'grok-4.3'
      },
      pet: {
        appearance: 'boba',
        displayName: 'Legacy pet name that is ',
        size: 224
      },
      privacy: { maskApiKeys: false, allowExternalLinks: true },
      appBehavior: { closeAction: 'tray', closeToTray: true },
      log: { retentionDays: 1 }
    })
    expect(normalized.generator).not.toHaveProperty('generateLearningRecord')
    expect(normalized.tools).not.toHaveProperty('maxIterations')
    expect(normalized.tools).not.toHaveProperty('runBudget')

    expect(custom).toMatchObject({
      name: 'Custom Provider',
      apiKey: '',
      baseUrl: 'https://models.example.test/v1',
      endpointFormat: 'chat_completions',
      models: ['model-a'],
      docsUrl: '',
      apiKeyUrl: ''
    })
  })

  it('keeps main and renderer wrappers equivalent for incomplete settings documents', () => {
    const malformed = {
      provider: { providers: [{ id: 'custom', models: ['model-z'], docsUrl: 'https://ignore.test' }] },
      tools: {
        maxIterations: 33,
        runBudget: { maxToolCalls: 33 }
      },
      pet: { appearance: 'lulu' },
      worktree: {}
    }

    expect(normalizeSettings(malformed, '')).toEqual(normalizeRendererSettings(malformed))
  })

  it('uses 噜噜 as the initial pet appearance and display name', () => {
    const defaults = createTeachingSettingsDefaults(fallbackRoot)

    expect(defaults.pet).toMatchObject({
      appearance: 'lulu-capybara',
      displayName: '噜噜'
    })
  })

  it('re-seeds preset providers whose models match a superseded catalog preset', () => {
    const reSeeded = normalizeTeachingSettings({
      provider: {
        activeProviderId: 'glm',
        providers: [{ id: 'glm', models: ['glm-4.5', 'glm-4.5-air', 'glm-4-flash'] }]
      },
      generator: { providerId: 'glm', model: 'glm-4.5' }
    }, fallbackRoot)

    const glm = reSeeded.provider.providers.find((provider) => provider.id === 'glm')!
    expect(glm.models).toEqual(['glm-5.2', 'glm-5.1'])
    expect(reSeeded.generator.model).toBe('glm-5.2')
  })

  it('keeps preset models that mix superseded and current catalog ids untouched', () => {
    const normalized = normalizeTeachingSettings({
      provider: {
        providers: [{ id: 'glm', models: ['glm-4.5', 'glm-5.1'] }]
      }
    }, fallbackRoot)

    const glm = normalized.provider.providers.find((provider) => provider.id === 'glm')!
    expect(glm.models).toEqual(['glm-4.5', 'glm-5.1'])
  })

  it('keeps non-catalog upstream models on preset providers and custom provider models', () => {
    const normalized = normalizeTeachingSettings({
      provider: {
        providers: [
          { id: 'deepseek', models: ['deepseek-v4-flash', 'deepseek-reasoner'] },
          { id: 'custom', models: ['my-custom-model'] }
        ]
      }
    }, fallbackRoot)

    const deepseek = normalized.provider.providers.find((provider) => provider.id === 'deepseek')!
    const custom = normalized.provider.providers.find((provider) => provider.id === 'custom')!
    expect(deepseek.models).toEqual(['deepseek-v4-flash', 'deepseek-reasoner'])
    expect(custom.models).toEqual(['my-custom-model'])
  })

  it('preserves a free-form generator model that is not in the provider list', () => {
    const normalized = normalizeTeachingSettings({
      provider: {
        providers: [{ id: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] }]
      },
      generator: { providerId: 'deepseek', model: 'custom-deepseek-v7' }
    }, fallbackRoot)

    expect(normalized.generator.model).toBe('custom-deepseek-v7')
  })

  it('deep-merges supported tool settings without restoring retired run limits', () => {
    const current = createTeachingSettingsDefaults(fallbackRoot)
    const merged = mergeTeachingSettings(current, {
      tools: { workspaceRead: false },
      workspace: { showAllCourseFiles: true }
    })

    expect(merged.tools.workspaceRead).toBe(false)
    expect(merged.tools).not.toHaveProperty('maxIterations')
    expect(merged.tools).not.toHaveProperty('runBudget')
    expect(merged.workspace).toMatchObject({
      defaultRoot: fallbackRoot,
      showAllCourseFiles: true
    })

    const petMerged = mergeTeachingSettings(current, {
      pet: {
        notificationPreferences: {
          showRunning: false,
          sources: { agent: false }
        }
      }
    })
    expect(petMerged.pet.notificationPreferences).toEqual({
      ...current.pet.notificationPreferences,
      showRunning: false,
      sources: { ...current.pet.notificationPreferences.sources, agent: false }
    })
  })
})
