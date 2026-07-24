import { mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { readValidatedWithBackup, replaceWithBackup } from './persistence/durable-file'
import {
  createTeachingSettingsDefaults,
  mergeTeachingSettings,
  normalizeTeachingSettings
} from '../shared/teaching-settings-schema'
import type { TeachingSettingsPatch, TeachingSettingsV1 } from '../shared/teaching-types'

const SETTINGS_FILE_NAME = 'studiumx-settings.json'
const SAFE_STORAGE_PREFIX = 'safeStorage:v1:'

export type SettingsSecretStorage = {
  isEncryptionAvailable: () => boolean
  encryptString: (value: string) => Buffer
  decryptString: (value: Buffer) => string
}

export class TeachingSettingsService {
  private readonly settingsPath: string
  private readonly fallbackDefaultRoot: string
  private readonly secretStorage?: SettingsSecretStorage
  private protectedSecretTemplate: Record<string, unknown> | null = null
  private cache: TeachingSettingsV1 | null = null

  constructor(options: {
    userDataPath: string
    defaultRoot: string
    secretStorage?: SettingsSecretStorage
  }) {
    this.settingsPath = join(options.userDataPath, SETTINGS_FILE_NAME)
    this.fallbackDefaultRoot = options.defaultRoot
    this.secretStorage = options.secretStorage
  }

  async load(): Promise<TeachingSettingsV1> {
    if (this.cache) return this.cache

    const recovered = await readValidatedWithBackup({
      path: this.settingsPath,
      validate: isSettingsDocument
    })
    if (recovered.value) {
      const parsed = recovered.value
      if (!encryptionAvailable(this.secretStorage) && hasProtectedSettingsSecrets(parsed)) {
        this.protectedSecretTemplate = parsed
      }
      const decoded = decodeSettingsSecrets(parsed, this.secretStorage)
      this.cache = await this.ensureSettings(normalizeSettings(decoded, this.fallbackDefaultRoot))
      // A healthy canonical document is read-only at load time: do not create
      // a backup, rewrite formatting, or re-encrypt secrets merely by opening
      // settings. Persist only an actual schema/secret-storage migration.
      // Backup recovery is deliberately non-destructive in every case.
      if (recovered.source === 'canonical' && needsSettingsCanonicalization(parsed, decoded, this.cache, this.secretStorage)) {
        await this.persist(this.cache)
      }
      return this.cache
    }

    if (recovered.canonicalStatus === 'missing') {
      this.cache = await this.ensureSettings(defaultSettings(this.fallbackDefaultRoot))
      return this.cache
    }

    this.cache = await this.replaceInvalidSettings('invalid JSON or unsupported top-level value')
    return this.cache
  }

  async save(settings: TeachingSettingsV1): Promise<TeachingSettingsV1> {
    const normalized = await this.ensureSettings(normalizeSettings(settings, this.fallbackDefaultRoot))
    this.cache = normalized
    await this.persist(normalized)
    return normalized
  }

  async patch(patch: TeachingSettingsPatch): Promise<TeachingSettingsV1> {
    const current = await this.load()
    return this.save(mergeSettings(current, patch))
  }

  async defaultWorkspaceRoot(): Promise<string> {
    return (await this.load()).workspace.defaultRoot
  }

  private async ensureSettings(settings: TeachingSettingsV1): Promise<TeachingSettingsV1> {
    await mkdir(settings.workspace.defaultRoot, { recursive: true })
    return settings
  }

  private async persist(settings: TeachingSettingsV1): Promise<void> {
    let stored = encodeSettingsSecrets(settings, this.secretStorage)
    if (!encryptionAvailable(this.secretStorage) && this.protectedSecretTemplate) {
      stored = preserveProtectedSettingsSecrets(stored, this.protectedSecretTemplate)
    }
    this.protectedSecretTemplate = hasProtectedSettingsSecrets(stored) ? stored : null
    await replaceWithBackup({
      path: this.settingsPath,
      content: `${JSON.stringify(stored, null, 2)}\n`,
      validate: isSettingsDocument,
      mode: 0o600
    })
  }

  private async replaceInvalidSettings(reason: string): Promise<TeachingSettingsV1> {
    const backupPath = `${this.settingsPath}.invalid-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    try {
      const exists = await stat(this.settingsPath).then((info) => info.isFile()).catch(() => false)
      if (exists) await rename(this.settingsPath, backupPath)
      console.warn(`[StudiumX] Invalid settings were replaced with defaults: ${reason}. Backup: ${backupPath}`)
    } catch {
      console.warn(`[StudiumX] Invalid settings were replaced with defaults: ${reason}. Backup could not be written.`)
    }
    return this.save(defaultSettings(this.fallbackDefaultRoot))
  }

}

/** Compatibility export retained for existing main-process callers. */
export function defaultSettings(defaultRoot: string): TeachingSettingsV1 {
  return createTeachingSettingsDefaults(defaultRoot)
}

/** Compatibility export retained for existing main-process callers. */
export function mergeSettings(current: TeachingSettingsV1, patch: TeachingSettingsPatch): TeachingSettingsV1 {
  return mergeTeachingSettings(current, patch)
}

/** Compatibility export retained for existing main-process callers. */
export function normalizeSettings(input: unknown, fallbackDefaultRoot: string): TeachingSettingsV1 {
  return normalizeTeachingSettings(input, fallbackDefaultRoot)
}

function preserveProtectedSettingsSecrets(
  settings: TeachingSettingsV1,
  template: Record<string, unknown>
): TeachingSettingsV1 {
  const copy = JSON.parse(JSON.stringify(settings)) as Record<string, any>
  const templateProviders = Array.isArray((template as any).provider?.providers)
    ? (template as any).provider.providers
    : []
  const protectedById = new Map(
    templateProviders
      .filter((provider: any) => typeof provider?.id === 'string' && isProtectedSecret(provider?.apiKey))
      .map((provider: any) => [provider.id, provider.apiKey])
  )
  for (const provider of copy.provider?.providers ?? []) {
    if (!provider.apiKey && protectedById.has(provider.id)) provider.apiKey = protectedById.get(provider.id)
  }
  const templateProxyUrl = (template as any).provider?.proxy?.url
  if (!copy.provider?.proxy?.url && isProtectedSecret(templateProxyUrl)) {
    copy.provider.proxy.url = templateProxyUrl
  }
  for (const key of secretWebSearchKeys()) {
    const templateValue = (template as any).webSearch?.[key]
    if (!copy.webSearch?.[key] && isProtectedSecret(templateValue)) copy.webSearch[key] = templateValue
  }
  const templatePassHash = (template as any).webRemoteControl?.passHash
  if (
    copy.webRemoteControl &&
    !copy.webRemoteControl.passHash &&
    isProtectedSecret(templatePassHash)
  ) {
    copy.webRemoteControl.passHash = templatePassHash
  }
  return copy as TeachingSettingsV1
}

function encodeSettingsSecrets(
  settings: TeachingSettingsV1,
  storage?: SettingsSecretStorage
): TeachingSettingsV1 {
  if (!encryptionAvailable(storage)) return settings
  return transformSettingsSecrets(settings, (value) => {
    if (!value || value.startsWith(SAFE_STORAGE_PREFIX)) return value
    return `${SAFE_STORAGE_PREFIX}${storage!.encryptString(value).toString('base64')}`
  })
}

function decodeSettingsSecrets(input: Record<string, unknown>, storage?: SettingsSecretStorage): Record<string, unknown> {
  return transformSettingsSecrets(input, (value) => {
    if (!value.startsWith(SAFE_STORAGE_PREFIX)) return value
    if (!encryptionAvailable(storage)) return ''
    try {
      return storage!.decryptString(Buffer.from(value.slice(SAFE_STORAGE_PREFIX.length), 'base64'))
    } catch {
      console.warn('[StudiumX] A protected settings secret could not be decrypted and was cleared.')
      return ''
    }
  })
}

function transformSettingsSecrets<T extends Record<string, unknown>>(
  input: T,
  transform: (value: string) => string
): T {
  const copy = JSON.parse(JSON.stringify(input)) as Record<string, any>
  const providers = Array.isArray(copy.provider?.providers) ? copy.provider.providers : []
  for (const provider of providers) {
    if (provider && typeof provider === 'object' && typeof provider.apiKey === 'string') {
      provider.apiKey = transform(provider.apiKey)
    }
  }
  if (typeof copy.provider?.proxy?.url === 'string') {
    copy.provider.proxy.url = transform(copy.provider.proxy.url)
  }
  const webSearch = copy.webSearch
  if (webSearch && typeof webSearch === 'object') {
    for (const key of secretWebSearchKeys()) {
      if (typeof webSearch[key] === 'string') webSearch[key] = transform(webSearch[key])
    }
  }
  if (copy.webRemoteControl && typeof copy.webRemoteControl === 'object') {
    if (typeof copy.webRemoteControl.passHash === 'string') {
      copy.webRemoteControl.passHash = transform(copy.webRemoteControl.passHash)
    }
  }
  return copy as T
}

function hasProtectedSettingsSecrets(input: Record<string, unknown>): boolean {
  let found = false
  transformSettingsSecrets(input, (value) => {
    if (isProtectedSecret(value)) found = true
    return value
  })
  return found
}

function needsSettingsCanonicalization(
  stored: Record<string, unknown>,
  decoded: Record<string, unknown>,
  normalized: TeachingSettingsV1,
  storage?: SettingsSecretStorage
): boolean {
  // Normalization changing an otherwise readable object is the explicit
  // schema migration path retained from the historical load behavior.
  if (!isDeepStrictEqual(decoded, normalized)) return true
  if (!encryptionAvailable(storage)) return false

  // Valid safeStorage values remain untouched. Plaintext values and values
  // that can no longer be decrypted are the only secret-storage migrations.
  let migrationRequired = false
  transformSettingsSecrets(stored, (value) => {
    if (!value) return value
    if (!isProtectedSecret(value)) {
      migrationRequired = true
      return value
    }
    try {
      storage.decryptString(Buffer.from(value.slice(SAFE_STORAGE_PREFIX.length), 'base64'))
    } catch {
      migrationRequired = true
    }
    return value
  })
  return migrationRequired
}

function isProtectedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(SAFE_STORAGE_PREFIX)
}

function secretWebSearchKeys(): string[] {
  return [
    'braveApiKey',
    'firecrawlApiKey',
    'tavilyApiKey',
    'exaApiKey',
    'parallelApiKey',
    'xaiApiKey'
  ]
}

function encryptionAvailable(storage?: SettingsSecretStorage): storage is SettingsSecretStorage {
  if (!storage) return false
  try {
    return storage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function isSettingsDocument(input: unknown): input is Record<string, unknown> {
  // The settings reader intentionally remains tolerant: every object is
  // normalized by the shared schema, while arrays and primitives are unsafe
  // backup candidates.
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}


