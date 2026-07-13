import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createConnectorHealthCatalog } from '../../src/main/connector-health-catalog'
import { buildConnectorStatuses } from '../../src/main/connector-status'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { TeachingSettingsV1 } from '../../src/shared/teaching-types'

function settings(): TeachingSettingsV1 {
  const value = defaultSettings(join(tmpdir(), 'studiumx-connectors-fixture'))
  value.tools.enabled = true
  value.tools.workspaceRead = true
  value.tools.webSearch = true
  value.tools.webFetch = true
  value.webSearch.backend = 'auto'
  return value
}

const workspace = {
  id: 'workspace-1',
  name: 'Fixture Workspace',
  rootPath: join(tmpdir(), 'studiumx-connectors-fixture')
}

const probeOk = async () => ({ stdout: 'ripgrep 14.1.0\n' })
const probeMissing = async (): Promise<{ stdout: string }> => {
  throw new Error('spawn rg ENOENT')
}

async function main(): Promise<void> {
  const probeCalls: Array<{ command: string; args: string[] }> = []
  const catalog = createConnectorHealthCatalog({
    probeCommand: async (command, args) => {
      probeCalls.push({ command, args })
      return probeOk()
    }
  })
  const catalogStatuses = await catalog.evaluate(settings(), workspace)
  assert.deepEqual(catalogStatuses.map((connector) => connector.id), [
    'workspace_files', 'web_search', 'web_fetch', 'local_search'
  ])
  assert.deepEqual(probeCalls, [{ command: 'rg', args: ['--version'] }])

  const generatedBefore = Date.now()
  const result = await buildConnectorStatuses(settings(), workspace, { probeCommand: probeOk })
  const generatedAfter = Date.now()
  const generatedAt = Date.parse(result.generatedAt)
  assert.ok(Number.isFinite(generatedAt))
  assert.ok(generatedAt >= generatedBefore && generatedAt <= generatedAfter)
  assert.deepEqual(result.connectors.map((connector) => connector.id), [
    'workspace_files', 'web_search', 'web_fetch', 'local_search'
  ])
  const byId = new Map(result.connectors.map((connector) => [connector.id, connector]))
  assert.equal(byId.get('workspace_files')?.state, 'available')
  assert.equal(byId.get('web_search')?.state, 'available')
  assert.match(byId.get('web_search')?.detail ?? '', /Auto/)
  assert.equal(byId.get('web_fetch')?.state, 'available')
  assert.equal(byId.get('local_search')?.state, 'available')

  const value = settings()
  value.tools.enabled = false
  const disabledResult = await buildConnectorStatuses(value, workspace, { probeCommand: probeOk })
  const disabledById = new Map(disabledResult.connectors.map((connector) => [connector.id, connector]))
  assert.equal(disabledById.get('workspace_files')?.state, 'disabled')
  assert.equal(disabledById.get('web_search')?.state, 'disabled')
  assert.equal(disabledById.get('web_fetch')?.state, 'disabled')
  assert.equal(disabledById.get('local_search')?.state, 'available')

  const disabledFetchSettings = settings()
  disabledFetchSettings.tools.webFetch = false
  const disabledFetchResult = await buildConnectorStatuses(disabledFetchSettings, workspace, { probeCommand: probeOk })
  const disabledFetch = disabledFetchResult.connectors.find((connector) => connector.id === 'web_fetch')
  assert.equal(disabledFetch?.state, 'disabled')
  assert.equal(disabledFetch?.repairAction, '在工具设置中启用 web_fetch。')

  const unknownSearchSettings = settings()
  unknownSearchSettings.webSearch.backend = 'unknown-provider'
  const unknownSearchResult = await buildConnectorStatuses(unknownSearchSettings, workspace, { probeCommand: probeOk })
  const unknownSearch = unknownSearchResult.connectors.find((connector) => connector.id === 'web_search')
  assert.equal(unknownSearch?.state, 'failed')
  assert.equal(unknownSearch?.repairAction, '在搜索设置中选择 Auto 或受支持的后端。')

  const missingSearchSettings = settings()
  missingSearchSettings.webSearch.backend = 'brave'
  missingSearchSettings.webSearch.braveApiKey = ''
  const missingSearchResult = await buildConnectorStatuses(missingSearchSettings, workspace, { probeCommand: probeOk })
  const webSearch = missingSearchResult.connectors.find((connector) => connector.id === 'web_search')
  assert.equal(webSearch?.state, 'missing_config')
  assert.match(webSearch?.detail ?? '', /Brave/)

  const missingDependencySettings = settings()
  missingDependencySettings.webSearch.backend = 'ddgs'
  const missingDependencyResult = await buildConnectorStatuses(missingDependencySettings, null, { probeCommand: probeMissing })
  const missingDependencyById = new Map(missingDependencyResult.connectors.map((connector) => [connector.id, connector]))
  assert.equal(missingDependencyById.get('workspace_files')?.state, 'missing_config')
  assert.equal(missingDependencyById.get('web_search')?.state, 'available')
  assert.equal(missingDependencyById.get('local_search')?.state, 'missing_dependency')

  console.log('connector statuses ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
