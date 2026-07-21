/**
 * Fail-soft TeachingDoctor config facts collector (B-11 residual / ADR-0099).
 *
 * Loads settings via an injected adapter (typically TeachingSettingsService.load)
 * and maps them into TeachingDoctorConfigFacts only. Never embeds absolute home
 * paths, raw apiKey values, or other secrets into facts/evidence.
 *
 * Non-claims:
 * - no auto-repair
 * - no auto-upload / remote telemetry / OTEL
 * - no free-form renderer facts (IPC payload remains ADR-0084 closed)
 * - no session/outcome/source/catalog FS collectors
 */

import type { TeachingDoctorConfigFacts, TeachingDoctorFacts } from '../../shared/teaching-types/teaching-doctor'
import type { TeachingDoctorFactsCollector } from './teaching-doctor-facts-assemble'

/** Logical locator only — never an absolute userData path. */
export const TEACHING_DOCTOR_CONFIG_PATH_LABEL = 'userData/studiumx-settings.json'

export type TeachingDoctorConfigFactsSource = {
  /**
   * Load settings; may throw — collector catches — fail-soft partial.
   * Prefer TeachingSettingsService.load() / TeachingSettingsV1, but accept unknown.
   */
  load(): Promise<unknown>
}

export type CreateTeachingDoctorConfigFactsCollectorOptions = {
  /** Logical / redacted locator (default: userData/studiumx-settings.json). */
  configPathLabel?: string
}

/**
 * Factory for a main-side config facts collector used by product TeachingDoctor.
 * Composition root / gateway injects this into runProductTeachingDoctor deps.
 */
export function createTeachingDoctorConfigFactsCollector(
  source: TeachingDoctorConfigFactsSource,
  options?: CreateTeachingDoctorConfigFactsCollectorOptions
): TeachingDoctorFactsCollector {
  const configPath = normalizeConfigPathLabel(options?.configPathLabel)

  return {
    id: 'config-settings',
    async collect(): Promise<Partial<TeachingDoctorFacts>> {
      try {
        const loaded = await source.load()
        return { config: probeConfigFacts(loaded, configPath) }
      } catch {
        // Structured fail so doctor shows fail/warning instead of skipped.
        return {
          config: unavailableConfigFacts(configPath, 'settings_load_failed')
        }
      }
    }
  }
}

function normalizeConfigPathLabel(label: string | undefined): string {
  if (typeof label === 'string') {
    const trimmed = label.trim()
    if (trimmed.length > 0) return trimmed.slice(0, 256)
  }
  return TEACHING_DOCTOR_CONFIG_PATH_LABEL
}

function unavailableConfigFacts(
  configPath: string,
  reason: string
): TeachingDoctorConfigFacts {
  return {
    settingsAvailable: false,
    settingsReadable: false,
    settingsParseable: false,
    providerConfigured: false,
    reason,
    configPath
  }
}

/**
 * Probe loaded settings without retaining secrets.
 * Object load → available/readable/parseable; providerConfigured is a boolean
 * presence check only (apiKey length / models / generator.model).
 */
function probeConfigFacts(loaded: unknown, configPath: string): TeachingDoctorConfigFacts {
  if (loaded == null) {
    return unavailableConfigFacts(configPath, 'settings_missing')
  }

  if (typeof loaded !== 'object' || Array.isArray(loaded)) {
    return {
      settingsAvailable: true,
      settingsReadable: true,
      settingsParseable: false,
      providerConfigured: false,
      reason: 'settings_unparseable',
      configPath
    }
  }

  const settings = loaded as Record<string, unknown>
  const providerConfigured = isProviderConfigured(settings)

  return {
    settingsAvailable: true,
    settingsReadable: true,
    settingsParseable: true,
    providerConfigured,
    reason: providerConfigured ? null : 'provider_not_configured',
    configPath,
    ...(providerConfigured ? {} : { configKey: 'provider.apiKey' })
  }
}

/**
 * True when active/any provider has non-empty apiKey OR models, OR generator.model
 * is set. Never returns or stores raw key material.
 */
function isProviderConfigured(settings: Record<string, unknown>): boolean {
  const providerSection = asRecord(settings.provider)
  if (providerSection) {
    const providers = Array.isArray(providerSection.providers)
      ? providerSection.providers
      : []

    const activeId =
      typeof providerSection.activeProviderId === 'string'
        ? providerSection.activeProviderId.trim()
        : ''

    const active =
      (activeId
        ? providers.find((item) => asRecord(item)?.id === activeId)
        : undefined) ??
      providers[0]

    if (providerHasCredentialsOrModels(active)) {
      return true
    }

    for (const item of providers) {
      if (providerHasCredentialsOrModels(item)) return true
    }
  }

  const generator = asRecord(settings.generator)
  if (generator && typeof generator.model === 'string' && generator.model.trim().length > 0) {
    return true
  }

  return false
}

function providerHasCredentialsOrModels(provider: unknown): boolean {
  const record = asRecord(provider)
  if (!record) return false

  if (typeof record.apiKey === 'string' && record.apiKey.trim().length > 0) {
    return true
  }

  if (Array.isArray(record.models)) {
    for (const model of record.models) {
      if (typeof model === 'string' && model.trim().length > 0) return true
    }
  }

  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

