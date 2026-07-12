import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  defaultSettings,
  TeachingSettingsService,
  type SettingsSecretStorage
} from '../../src/main/teaching-settings'

const root = await mkdtemp(join(tmpdir(), 'studiumx-settings-secret-'))
const userDataPath = join(root, 'user-data')
const defaultRoot = join(root, 'workspace')
const settingsPath = join(userDataPath, 'studiumx-settings.json')
const storage: SettingsSecretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
  decryptString: (value) => {
    const decoded = value.toString('utf8')
    if (!decoded.startsWith('sealed:')) throw new Error('invalid sealed value')
    return decoded.slice('sealed:'.length)
  }
}

try {
  const settings = defaultSettings(defaultRoot)
  settings.provider.providers[0]!.apiKey = 'provider-secret-value'
  settings.provider.proxy.url = 'https://proxy.example.test?token=proxy-secret-value'
  settings.webSearch.braveApiKey = 'brave-secret-value'
  settings.webSearch.tavilyApiKey = 'tavily-secret-value'

  const service = new TeachingSettingsService({ userDataPath, defaultRoot, secretStorage: storage })
  const saved = await service.save(settings)
  assert.equal(saved.provider.providers[0]!.apiKey, 'provider-secret-value')

  const disk = await readFile(settingsPath, 'utf8')
  assert.doesNotMatch(disk, /provider-secret-value|proxy-secret-value|brave-secret-value|tavily-secret-value/)
  assert.match(disk, /safeStorage:v1:/)

  const reloaded = await new TeachingSettingsService({ userDataPath, defaultRoot, secretStorage: storage }).load()
  assert.equal(reloaded.provider.providers[0]!.apiKey, 'provider-secret-value')
  assert.equal(reloaded.provider.proxy.url, 'https://proxy.example.test?token=proxy-secret-value')
  assert.equal(reloaded.webSearch.braveApiKey, 'brave-secret-value')
  assert.equal(reloaded.webSearch.tavilyApiKey, 'tavily-secret-value')

  const legacyPlaintext = defaultSettings(defaultRoot)
  legacyPlaintext.provider.providers[0]!.apiKey = 'legacy-provider-secret'
  await writeFile(settingsPath, `${JSON.stringify(legacyPlaintext, null, 2)}\n`)
  const migrated = await new TeachingSettingsService({ userDataPath, defaultRoot, secretStorage: storage }).load()
  assert.equal(migrated.provider.providers[0]!.apiKey, 'legacy-provider-secret')
  const migratedDisk = await readFile(settingsPath, 'utf8')
  assert.doesNotMatch(migratedDisk, /legacy-provider-secret/)
  assert.match(migratedDisk, /safeStorage:v1:/)

  const unavailableStorage: SettingsSecretStorage = {
    ...storage,
    isEncryptionAvailable: () => false
  }
  const unavailableService = new TeachingSettingsService({
    userDataPath,
    defaultRoot,
    secretStorage: unavailableStorage
  })
  const unavailableSettings = await unavailableService.load()
  assert.equal(unavailableSettings.provider.providers[0]!.apiKey, '')
  await unavailableService.patch({ theme: 'dark' })
  const preservedDisk = await readFile(settingsPath, 'utf8')
  assert.match(preservedDisk, /safeStorage:v1:/)

  console.log('settings safeStorage migration ok')
} finally {
  await rm(root, { recursive: true, force: true })
}
