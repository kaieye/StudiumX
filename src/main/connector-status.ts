import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { ConnectorStatusesResult, TeachingSettingsV1 } from '../shared/teaching-types'
import {
  createConnectorHealthCatalog,
  type ConnectorCommandProbe,
  type ConnectorStatusWorkspace
} from './connector-health-catalog'

const execFile = promisify(execFileCallback)

export type { ConnectorStatusWorkspace } from './connector-health-catalog'

export type ConnectorStatusOptions = {
  probeCommand?: ConnectorCommandProbe
}

export async function buildConnectorStatuses(
  settings: TeachingSettingsV1,
  workspace: ConnectorStatusWorkspace,
  options: ConnectorStatusOptions = {}
): Promise<ConnectorStatusesResult> {
  const catalog = createConnectorHealthCatalog({
    probeCommand: options.probeCommand ?? systemRipgrepProbe
  })
  const connectors = await catalog.evaluate(settings, workspace)
  return {
    generatedAt: new Date().toISOString(),
    connectors
  }
}

const systemRipgrepProbe: ConnectorCommandProbe = async (command, args) => {
  const { stdout } = await execFile(command, args, { timeout: 2_000 })
  return { stdout: String(stdout) }
}