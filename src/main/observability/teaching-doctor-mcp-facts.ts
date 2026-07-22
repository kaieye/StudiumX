/**
 * Fail-soft TeachingDoctor MCP facts collector (ADR-0128 Phase E).
 *
 * Emits aggregate-only, secret-free MCP status for doctor evidence.
 * Never includes env secrets, headers, raw command tokens beyond redacted labels.
 *
 * Non-claims:
 * - no auto-repair / auto-connect
 * - no marketplace
 * - no free-form renderer facts
 */

import type {
  TeachingDoctorFacts,
  TeachingDoctorMcpFacts,
  TeachingDoctorMcpServerFacts
} from '../../shared/teaching-types/teaching-doctor'
import type { TeachingDoctorFactsCollector } from './teaching-doctor-facts-assemble'
import type { UserMcpConfigV1, McpRuntimeServerView } from '../../shared/mcp/types'
import { redactMcpCommandLine } from '../mcp/redact'

export const TEACHING_DOCTOR_MCP_CONFIG_PATH_LABEL = 'userData/mcp/config.v1.json'

export type TeachingDoctorMcpFactsSource = {
  /** Load durable MCP config (may throw — fail-soft). */
  loadConfig(): Promise<UserMcpConfigV1 | null>
  /** Current process runtime view (no secrets). */
  listRuntime(): readonly McpRuntimeServerView[]
}

export type CreateTeachingDoctorMcpFactsCollectorOptions = {
  configPathLabel?: string
}

export function createTeachingDoctorMcpFactsCollector(
  source: TeachingDoctorMcpFactsSource,
  options?: CreateTeachingDoctorMcpFactsCollectorOptions
): TeachingDoctorFactsCollector {
  const configPath =
    typeof options?.configPathLabel === 'string' && options.configPathLabel.trim()
      ? options.configPathLabel.trim().slice(0, 256)
      : TEACHING_DOCTOR_MCP_CONFIG_PATH_LABEL

  return {
    id: 'mcp-status',
    async collect(): Promise<Partial<TeachingDoctorFacts>> {
      try {
        const config = await source.loadConfig()
        const runtime = source.listRuntime() ?? []
        return { mcp: mapMcpFacts(config, runtime, configPath) }
      } catch {
        return {
          mcp: {
            implementationPresent: true,
            rootEnabled: false,
            serverCount: 0,
            enabledServerCount: 0,
            connectedServerCount: 0,
            errorServerCount: 0,
            servers: [],
            configPathLabel: configPath
          }
        }
      }
    }
  }
}

export function mapMcpFacts(
  config: UserMcpConfigV1 | null | undefined,
  runtime: readonly McpRuntimeServerView[],
  configPathLabel: string = TEACHING_DOCTOR_MCP_CONFIG_PATH_LABEL
): TeachingDoctorMcpFacts {
  if (!config) {
    return {
      implementationPresent: true,
      rootEnabled: false,
      serverCount: 0,
      enabledServerCount: 0,
      connectedServerCount: 0,
      errorServerCount: 0,
      servers: [],
      configPathLabel
    }
  }

  const runtimeById = new Map(runtime.map((item) => [item.id, item]))
  const servers: TeachingDoctorMcpServerFacts[] = config.servers.slice(0, 32).map((server) => {
    const rt = runtimeById.get(server.id)
    const redacted = redactMcpCommandLine(server.command, server.args)
    const commandLabel = redacted.command
      ? `${redacted.command}${redacted.args.length ? ' …' : ''}`.slice(0, 120)
      : null
    return {
      id: server.id.slice(0, 64),
      enabled: server.enabled === true,
      transport: server.transport,
      state: rt?.state ?? (server.enabled && config.enabled ? 'idle' : 'disabled'),
      toolCount: rt?.toolCount ?? null,
      errorCode: rt?.errorCode ?? null,
      commandLabel
    }
  })

  const enabledServerCount = servers.filter((s) => s.enabled).length
  const connectedServerCount = servers.filter((s) => s.state === 'connected').length
  const errorServerCount = servers.filter((s) => s.state === 'error').length

  return {
    implementationPresent: true,
    rootEnabled: config.enabled === true,
    serverCount: config.servers.length,
    enabledServerCount,
    connectedServerCount,
    errorServerCount,
    servers,
    configPathLabel
  }
}
