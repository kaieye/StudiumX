import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')
const main = await readFile('src/main/index.ts', 'utf8')
const preload = await readFile('src/preload/index.ts', 'utf8')
const providerConnection = await readFile('src/main/provider-connection.ts', 'utf8')

assert.match(app, /const activeProviderProbePayload = \{[\s\S]*baseUrl: activeModelSettingsProvider\.baseUrl[\s\S]*apiKey: activeModelSettingsProvider\.apiKey[\s\S]*endpointFormat: activeModelSettingsProvider\.endpointFormat[\s\S]*\} satisfies ProbeProviderPayload/)
assert.match(app, /const result = await onProbeProvider\(activeProviderProbePayload\)/)
assert.match(app, /const result = await onListUpstreamModels\(activeProviderProbePayload\)/)
assert.match(app, /role="status" aria-live="polite"/)
assert.match(app, /const \[apiKeyVisible, setApiKeyVisible\]/)
assert.match(app, /type=\{apiKeyVisible \? 'text' : 'password'\}/)
assert.match(app, /apiKeyVisible \? <EyeOff size=\{15\} \/> : <Eye size=\{15\} \/>/)

assert.match(app, /onClick=\{\(\) => void onOpenExternal\(activeModelSettingsProvider\.docsUrl\)\}/)
assert.match(app, /disabled=\{isCustomModelProvider \|\| !activeModelSettingsProvider\.docsUrl\}/)
assert.match(app, /onClick=\{\(\) => void onOpenExternal\(activeModelSettingsProvider\.apiKeyUrl\)\}/)
assert.match(app, /disabled=\{isCustomModelProvider \|\| !activeModelSettingsProvider\.apiKeyUrl\}/)

assert.match(app, /const resetProvider = \{ \.\.\.preset, apiKey: activeModelSettingsProvider\.apiKey \}/)
assert.match(app, /await onUpdateSettings\(\{[\s\S]*provider: \{[\s\S]*activeProviderId: resetProvider\.id[\s\S]*providers[\s\S]*\}[\s\S]*generator: \{[\s\S]*providerId: resetProvider\.id[\s\S]*model: resetProvider\.models\[0\] \?\? ''[\s\S]*endpointFormat: resetProvider\.endpointFormat[\s\S]*\}/)
assert.match(app, /setProviderStatus\(t\('model\.statusReset'\)\)/)
assert.doesNotMatch(app, /updateProvider\(\{ \.\.\.preset, apiKey: activeModelSettingsProvider\.apiKey \}\)/)

assert.match(preload, /listUpstreamModels: \(payload\) => ipcRenderer\.invoke\('teach:list-upstream-models', payload\)/)
assert.match(main, /ipcMain\.handle\('teach:list-upstream-models', async \(_, payload: unknown\) => \{[\s\S]*const request = parseListUpstreamModelsPayload\(payload, settings\.provider\.providers\)[\s\S]*return fetchUpstreamModels\(request, resolveProxyUrl\(settings\)\)/)
assert.match(main, /function parseListUpstreamModelsPayload\([\s\S]*const providerIdPayload = payload && typeof payload === 'object'[\s\S]*typeof payload === 'string'[\s\S]*providerIdPayload\?\.providerId[\s\S]*return parseProbeProviderPayload\(payload\)/)
assert.match(main, /ipcMain\.handle\('teach:open-external'[\s\S]*privacy\.allowExternalLinks[\s\S]*shell\.openExternal\(url\)/)
assert.match(providerConnection, /export async function fetchUpstreamModels\(\s*provider: ProbeProviderPayload/)

console.log('provider action wiring ok')
