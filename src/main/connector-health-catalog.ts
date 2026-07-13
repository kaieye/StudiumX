import type { ConnectorStatus, TeachingSettingsV1 } from '../shared/teaching-types'
import { buildToolContext, type ToolContext } from './ai/tools/registry'
import { availableProviders, resolveConfiguredProvider } from './ai/tools/web-search/providers'

export type ConnectorStatusWorkspace = {
  id: string
  name: string
  rootPath: string
} | null

export type ConnectorCommandProbe = (command: string, args: string[]) => Promise<{ stdout: string }>

export type ConnectorHealthCatalogAdapters = {
  probeCommand: ConnectorCommandProbe
}

type ConnectorHealthCheckInput = {
  settings: TeachingSettingsV1
  workspace: ConnectorStatusWorkspace
  context: ToolContext
}

type ConnectorHealthCheck = {
  evaluate: (input: ConnectorHealthCheckInput, adapters: ConnectorHealthCatalogAdapters) => Promise<ConnectorStatus>
}

/**
 * Ordered catalog for the capabilities exposed by the connector-health surface.
 * Provider availability deliberately comes from the web-search provider catalog;
 * this module only translates those facts into the established status contract.
 */
export class ConnectorHealthCatalog {
  constructor(
    private readonly adapters: ConnectorHealthCatalogAdapters,
    private readonly checks: readonly ConnectorHealthCheck[] = orderedHealthChecks
  ) {}

  async evaluate(settings: TeachingSettingsV1, workspace: ConnectorStatusWorkspace): Promise<ConnectorStatus[]> {
    const input: ConnectorHealthCheckInput = {
      settings,
      workspace,
      context: buildToolContext(settings, { workspaceRoot: workspace?.rootPath })
    }
    const statuses: ConnectorStatus[] = []
    for (const check of this.checks) {
      statuses.push(await check.evaluate(input, this.adapters))
    }
    return statuses
  }
}

export function createConnectorHealthCatalog(adapters: ConnectorHealthCatalogAdapters): ConnectorHealthCatalog {
  return new ConnectorHealthCatalog(adapters)
}

const orderedHealthChecks: readonly ConnectorHealthCheck[] = [
  { evaluate: workspaceConnectorStatus },
  { evaluate: webSearchConnectorStatus },
  { evaluate: webFetchConnectorStatus },
  { evaluate: ripgrepConnectorStatus }
]

async function workspaceConnectorStatus(input: ConnectorHealthCheckInput): Promise<ConnectorStatus> {
  const { settings, workspace } = input
  if (!settings.tools.enabled) {
    return disabledStatus('workspace_files', 'Workspace files', 'workspace', '工具调用已关闭。', '在工具设置中启用工具调用。')
  }
  if (!settings.tools.workspaceRead) {
    return disabledStatus('workspace_files', 'Workspace files', 'workspace', '工作区文件工具已关闭。', '在工具设置中启用工作区文件工具。')
  }
  if (!workspace) {
    return {
      id: 'workspace_files',
      name: 'Workspace files',
      category: 'workspace',
      state: 'missing_config',
      detail: '尚未选择教学工作区。',
      repairAction: '创建或导入一个教学工作区。'
    }
  }
  return {
    id: 'workspace_files',
    name: 'Workspace files',
    category: 'workspace',
    state: 'available',
    detail: `${workspace.name} · ${workspace.rootPath}`
  }
}

async function webSearchConnectorStatus(input: ConnectorHealthCheckInput): Promise<ConnectorStatus> {
  const { settings, context } = input
  if (!settings.tools.enabled) {
    return disabledStatus('web_search', 'Web search', 'web', '工具调用已关闭。', '在工具设置中启用工具调用。')
  }
  if (!settings.tools.webSearch) {
    return disabledStatus('web_search', 'Web search', 'web', 'web_search 工具已关闭。', '在工具设置中启用 web_search。')
  }

  const configured = resolveConfiguredProvider(context)
  if (configured.requestedBackend) {
    if (!configured.normalizedName) {
      return {
        id: 'web_search',
        name: 'Web search',
        category: 'web',
        state: 'failed',
        detail: `未知搜索后端：${configured.requestedBackend}`,
        repairAction: '在搜索设置中选择 Auto 或受支持的后端。'
      }
    }
    const provider = configured.provider
    if (!provider) {
      return {
        id: 'web_search',
        name: 'Web search',
        category: 'web',
        state: 'failed',
        detail: `搜索后端未注册：${configured.normalizedName}`,
        repairAction: '切换到 Auto 或另一个后端。'
      }
    }
    if (!provider.isAvailable(context)) {
      return {
        id: 'web_search',
        name: 'Web search',
        category: 'web',
        state: 'missing_config',
        detail: `${provider.label} 未配置。${provider.unavailableReason(context)}`,
        repairAction: '补全该后端的 API Key 或 URL，或切换到 Auto。'
      }
    }
    return {
      id: 'web_search',
      name: 'Web search',
      category: 'web',
      state: 'available',
      detail: `${provider.label} 已可用。`
    }
  }

  const providers = availableProviders(context)
  return {
    id: 'web_search',
    name: 'Web search',
    category: 'web',
    state: 'available',
    detail: `Auto 模式将尝试：${providers.map((provider) => provider.label).join('、')}。`
  }
}

async function webFetchConnectorStatus(input: ConnectorHealthCheckInput): Promise<ConnectorStatus> {
  if (!input.settings.tools.enabled) {
    return disabledStatus('web_fetch', 'Web fetch', 'web', '工具调用已关闭。', '在工具设置中启用工具调用。')
  }
  if (!input.settings.tools.webFetch) {
    return disabledStatus('web_fetch', 'Web fetch', 'web', 'web_fetch 工具已关闭。', '在工具设置中启用 web_fetch。')
  }
  return {
    id: 'web_fetch',
    name: 'Web fetch',
    category: 'web',
    state: 'available',
    detail: '可抓取公网 http/https URL，并启用重定向与私网地址防护。'
  }
}

async function ripgrepConnectorStatus(
  _input: ConnectorHealthCheckInput,
  adapters: ConnectorHealthCatalogAdapters
): Promise<ConnectorStatus> {
  try {
    const { stdout } = await adapters.probeCommand('rg', ['--version'])
    const version = stdout.split(/\r?\n/)[0]?.trim() || 'rg'
    return {
      id: 'local_search',
      name: 'Local text search',
      category: 'local',
      state: 'available',
      detail: `${version} 可用。`
    }
  } catch (error) {
    return {
      id: 'local_search',
      name: 'Local text search',
      category: 'local',
      state: 'missing_dependency',
      detail: error instanceof Error ? error.message : 'rg 不可用。',
      repairAction: '安装 ripgrep，或继续使用内置目录读取能力。'
    }
  }
}

function disabledStatus(
  id: string,
  name: string,
  category: ConnectorStatus['category'],
  detail: string,
  repairAction: string
): ConnectorStatus {
  return { id, name, category, state: 'disabled', detail, repairAction }
}