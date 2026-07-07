import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')
const settingsView = await readFile('src/renderer/src/views/settings/SettingsView.tsx', 'utf8')
const modelProviderSection = await readFile('src/renderer/src/views/settings/sections/ModelProviderSettingsSection.tsx', 'utf8')
const main = await readFile('src/main/index.ts', 'utf8')
const commands = await readFile('src/main/teaching-ipc-commands.ts', 'utf8')
const preload = await readFile('src/preload/index.ts', 'utf8')
const providerConnection = await readFile('src/main/provider-connection.ts', 'utf8')
const externalLinks = await readFile('src/main/external-links.ts', 'utf8')

assert.match(app, /onProbeProvider=\{useAppStore\.getState\(\)\.probeProvider\}/)
assert.match(app, /onListUpstreamModels=\{useAppStore\.getState\(\)\.listUpstreamModels\}/)
assert.match(modelProviderSection, /const activeProviderProbePayload = \{[\s\S]*baseUrl: activeModelSettingsProvider\.baseUrl[\s\S]*apiKey: activeModelSettingsProvider\.apiKey[\s\S]*endpointFormat: activeModelSettingsProvider\.endpointFormat[\s\S]*\} satisfies ProbeProviderPayload/)
assert.match(modelProviderSection, /const result = await onProbeProvider\(activeProviderProbePayload\)/)
assert.match(modelProviderSection, /const result = await onListUpstreamModels\(activeProviderProbePayload\)/)
assert.match(modelProviderSection, /role="status" aria-live="polite"/)
assert.match(modelProviderSection, /const \[apiKeyVisible, setApiKeyVisible\]/)
assert.match(modelProviderSection, /type=\{apiKeyVisible \? 'text' : 'password'\}/)
assert.match(modelProviderSection, /apiKeyVisible \? <EyeOff size=\{15\} \/> : <Eye size=\{15\} \/>/)

assert.match(modelProviderSection, /onClick=\{\(\) => void onOpenExternal\(activeModelSettingsProvider\.docsUrl\)\}/)
assert.match(modelProviderSection, /disabled=\{isCustomModelProvider \|\| !activeModelSettingsProvider\.docsUrl\}/)
assert.match(modelProviderSection, /onClick=\{\(\) => void onOpenExternal\(activeModelSettingsProvider\.apiKeyUrl\)\}/)
assert.match(modelProviderSection, /disabled=\{isCustomModelProvider \|\| !activeModelSettingsProvider\.apiKeyUrl\}/)

assert.match(modelProviderSection, /const resetProvider = \{ \.\.\.preset, apiKey: activeModelSettingsProvider\.apiKey \}/)
assert.match(modelProviderSection, /await onUpdateSettings\(\{[\s\S]*provider: \{[\s\S]*activeProviderId: resetProvider\.id[\s\S]*providers[\s\S]*\}[\s\S]*generator: \{[\s\S]*providerId: resetProvider\.id[\s\S]*model: resetProvider\.models\[0\] \?\? ''[\s\S]*endpointFormat: resetProvider\.endpointFormat[\s\S]*\}/)
assert.match(modelProviderSection, /setProviderStatus\(t\('model\.statusReset'\)\)/)
assert.doesNotMatch(modelProviderSection, /updateProvider\(\{ \.\.\.preset, apiKey: activeModelSettingsProvider\.apiKey \}\)/)

assert.match(preload, /listUpstreamModels: \(payload\) => ipcRenderer\.invoke\('teach:list-upstream-models', payload\)/)
assert.match(main, /ipcMain\.handle\('teach:list-upstream-models', async \(_, payload: unknown\) => \{[\s\S]*const request = parseListUpstreamModelsPayload\(payload, settings\.provider\.providers\)[\s\S]*return fetchUpstreamModels\(request, resolveProxyUrl\(settings\)\)/)
assert.match(commands, /export function parseListUpstreamModelsPayload\([\s\S]*const providerIdPayload = payload && typeof payload === 'object'[\s\S]*typeof payload === 'string'[\s\S]*providerIdPayload\?\.providerId[\s\S]*return parseProbeProviderPayload\(payload\)/)
assert.match(main, /import \{ openExternalHttpUrl \} from '\.\/external-links'/)
assert.match(main, /ipcMain\.handle\('teach:open-external'[\s\S]*return openExternalHttpUrl\(rawUrl, settings, \(url\) => shell\.openExternal\(url\)\)/)
assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*openWindowExternalUrl\(url, settingsService\)[\s\S]*action: 'deny'/)
assert.match(externalLinks, /privacy\.allowExternalLinks/)
assert.match(externalLinks, /requireHttpUrl\(rawUrl\)/)
assert.match(providerConnection, /export async function fetchUpstreamModels\(\s*provider: ProbeProviderPayload/)

console.log('provider action wiring ok')
