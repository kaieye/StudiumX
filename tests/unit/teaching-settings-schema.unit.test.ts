import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEACHING_AGENT_RUN_BUDGET,
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
      version: 1,
      workspace: { defaultRoot: fallbackRoot },
      worktree: { rootPath: 'C:\\StudiumX\\workspace\\.worktrees' },
      tools: { runBudget: DEFAULT_TEACHING_AGENT_RUN_BUDGET }
    })
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
        workspaceWritePermission: 'write-everywhere',
        webSearch: false,
        webFetch: true,
        maxIterations: 0,
        runBudget: {
          maxDurationMs: '6000',
          maxProviderCalls: 1.5,
          maxToolCalls: 12,
          maxTotalTokens: 2_000_001,
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
      pet: { appearance: 'robot', displayName: '  Legacy pet name that is much too long  ' },
      privacy: { maskApiKeys: false },
      appBehavior: { closeAction: 'tray', closeToTray: 'yes' },
      log: { retentionDays: 0 }
    }, fallbackRoot)

    const custom = normalized.provider.providers.find((provider) => provider.id === 'custom')!
    expect(normalized).toMatchObject({
      version: 1,
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
        enabled: false,
        workspaceRead: false,
        workspaceWritePermission: 'ask_each_time',
        webSearch: false,
        webFetch: true,
        maxIterations: 1,
        runBudget: {
          maxDurationMs: 120_000,
          maxProviderCalls: 16,
          maxToolCalls: 12,
          maxTotalTokens: 200_000,
          warningThreshold: 0.8
        }
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
        displayName: 'Legacy pet name that is '
      },
      privacy: { maskApiKeys: false, allowExternalLinks: true },
      appBehavior: { closeAction: 'tray', closeToTray: false },
      log: { retentionDays: 1 }
    })
    expect(normalized.generator).not.toHaveProperty('generateLearningRecord')

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
      tools: { runBudget: { maxToolCalls: 33 } },
      pet: { appearance: 'lulu' },
      worktree: {}
    }

    expect(normalizeSettings(malformed, '')).toEqual(normalizeRendererSettings(malformed))
  })

  it('deep-merges a partial update before normalization without losing a stored budget', () => {
    const current = createTeachingSettingsDefaults(fallbackRoot)
    const merged = mergeTeachingSettings(current, {
      tools: { runBudget: { maxToolCalls: 44 } },
      workspace: { showAllCourseFiles: true }
    })

    expect(merged.tools.runBudget).toEqual({
      ...DEFAULT_TEACHING_AGENT_RUN_BUDGET,
      maxToolCalls: 44
    })
    expect(merged.workspace).toMatchObject({
      defaultRoot: fallbackRoot,
      showAllCourseFiles: true
    })
  })
})
