import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile('src/renderer/src/App.tsx', 'utf8')
const modelProviderSection = await readFile('src/renderer/src/views/settings/sections/ModelProviderSettingsSection.tsx', 'utf8')
const configuration = await readFile('src/renderer/src/workflows/teaching-workspace-configuration.ts', 'utf8')
const main = await readFile('src/main/index.ts', 'utf8')
const commands = await readFile('src/main/teaching-ipc-commands.ts', 'utf8')
const workspaceIpcCommands = await readFile('src/main/teaching-workspace-ipc-commands.ts', 'utf8')
const preload = await readFile('src/preload/index.ts', 'utf8')
const providerConnection = await readFile('src/main/provider-connection.ts', 'utf8')
const externalLinks = await readFile('src/main/external-links.ts', 'utf8')
const externalDestination = await readFile('src/shared/external-destination.ts', 'utf8')

assert.match(app, /onProbeProvider=\{useAppStore\.getState\(\)\.probeProvider\}/)
assert.match(app, /onListUpstreamModels=\{useAppStore\.getState\(\)\.listUpstreamModels\}/)
assert.match(
  configuration,
  /function toProbePayload\(provider: TeachingModelProviderProfile\): ProbeProviderPayload \{[\s\S]*baseUrl: provider\.baseUrl[\s\S]*apiKey: provider\.apiKey[\s\S]*endpointFormat: provider\.endpointFormat/,
  'provider probe payload should carry the active provider credentials'
)
assert.match(
  modelProviderSection,
  /configuration\.probeModelProvider\(activeModelSettingsProvider\.id\)/,
  'provider section should probe the active provider through the configuration workflow'
)
assert.match(
  modelProviderSection,
  /configuration\.refreshModelProviderModels\(activeModelSettingsProvider\.id\)/,
  'provider section should refresh upstream models through the configuration workflow'
)
assert.match(modelProviderSection, /role="status" aria-live="polite"/)
assert.match(modelProviderSection, /const \[apiKeyVisible, setApiKeyVisible\]/)
assert.match(modelProviderSection, /type=\{apiKeyVisible \? 'text' : 'password'\}/)
assert.match(modelProviderSection, /apiKeyVisible \? <EyeOff size=\{15\} \/> : <Eye size=\{15\} \/>/)

assert.match(modelProviderSection, /onClick=\{\(\) => void onOpenExternal\(activeModelSettingsProvider\.docsUrl\)\}/)
assert.match(modelProviderSection, /disabled=\{isCustomModelProvider \|\| !activeModelSettingsProvider\.docsUrl\}/)
assert.match(modelProviderSection, /onClick=\{\(\) => void onOpenExternal\(activeModelSettingsProvider\.apiKeyUrl\)\}/)
assert.match(modelProviderSection, /disabled=\{isCustomModelProvider \|\| !activeModelSettingsProvider\.apiKeyUrl\}/)

assert.match(
  configuration,
  /const resetProvider = \{ \.\.\.preset, apiKey: provider\?\.apiKey \?\? '' \}/,
  'provider reset should restore the preset while preserving the active api key'
)
assert.match(
  configuration,
  /await adapter\.updateSettings\(\{[\s\S]*provider: \{[\s\S]*activeProviderId: providerId[\s\S]*providers[\s\S]*\}[\s\S]*generator: \{[\s\S]*providerId,[\s\S]*model: resetProvider\.models\[0\] \?\? ''[\s\S]*endpointFormat: resetProvider\.endpointFormat[\s\S]*\}/,
  'provider reset should republish provider and generator settings'
)
assert.match(modelProviderSection, /case 'reset':\s*return t\('model\.statusReset'\)/)
assert.doesNotMatch(modelProviderSection, /updateProvider\(\{ \.\.\.preset, apiKey: activeModelSettingsProvider\.apiKey \}\)/)

assert.match(preload, /listUpstreamModels: \(payload\) => ipcRenderer\.invoke\(teachingInvokeChannels\.listUpstreamModels, payload\)/)
assert.match(
  workspaceIpcCommands,
  /channel: teachingInvokeChannels\.listUpstreamModels[\s\S]*parseListUpstreamModelsPayload\(payload, loadedSettings\.provider\.providers\)[\s\S]*fetchUpstreamModels\(payload\.request, payload\.proxyUrl\)/,
  'workspace IPC group should parse and fetch upstream models with the active provider credentials'
)
assert.match(commands, /export function parseListUpstreamModelsPayload\([\s\S]*const providerIdPayload = payload && typeof payload === 'object'[\s\S]*typeof payload === 'string'[\s\S]*providerIdPayload\?\.providerId[\s\S]*return parseProbeProviderPayload\(payload\)/)
assert.match(main, /import \{ openExternalHttpUrl \} from '\.\/external-links'/)
assert.match(
  workspaceIpcCommands,
  /channel: teachingInvokeChannels\.openExternal[\s\S]*openExternalHttpUrl\(rawUrl, await settings\.load\(\), \(url\) => shell\.openExternal\(url\)\)/,
  'workspace IPC group should open external URLs through the privacy-gated helper'
)
assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{[\s\S]*openWindowExternalUrl\(url, settingsService, logger\)[\s\S]*action: 'deny'/)
assert.match(externalLinks, /resolveExternalDestinationLaunchIntent\(rawUrl, settings\.privacy\)/, 'external link opener should delegate policy to the shared destination module')
assert.match(externalDestination, /if \(!policy\.allowExternalLinks\)/, 'external destination policy should respect the privacy allowExternalLinks setting')
assert.match(externalDestination, /new URL\(rawUrl\)[\s\S]*externalDestinationProtocols\.has\(parsed\.protocol\)/, 'external destination policy should validate the URL protocol before opening')
assert.match(providerConnection, /export async function fetchUpstreamModels\(\s*provider: ProbeProviderPayload/)

console.log('provider action wiring ok')
