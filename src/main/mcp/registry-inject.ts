/**
 * Registry inject helpers for buildDefaultRegistry / agent run wiring (ADR-0128 §7.1).
 */

import type { ToolRegistry } from '../ai/tools/registry'
import {
  attachMcpTools,
  clearMcpRuntimeState,
  setRuntimeMcpEffectMap
} from './tool-bridge'
import type { McpSessionManager, McpToolsSnapshot } from './session-manager'

export type AttachMcpToRegistryResult = Readonly<{
  attached: number
  skipped: string[]
  snapshot: McpToolsSnapshot
}>

/**
 * Build MCP snapshot (if manager present + root enabled) and attach tools.
 * When manager is null / disabled, clears runtime map and returns empty.
 */
export async function injectMcpToolsIntoRegistry(input: {
  registry: ToolRegistry
  sessionManager: McpSessionManager | null | undefined
  signal?: AbortSignal
}): Promise<AttachMcpToRegistryResult> {
  if (!input.sessionManager) {
    clearMcpRuntimeState()
    return {
      attached: 0,
      skipped: [],
      snapshot: {
        tools: [],
        effectByRegisteredName: new Map(),
        serverHealth: [],
        warnings: []
      }
    }
  }

  const snapshot = await input.sessionManager.buildSnapshot(input.signal)
  if (snapshot.tools.length === 0) {
    setRuntimeMcpEffectMap(snapshot.effectByRegisteredName)
    return { attached: 0, skipped: [], snapshot }
  }

  const result = attachMcpTools(input.registry, snapshot, input.sessionManager)
  return { ...result, snapshot }
}

export { clearMcpRuntimeState, setRuntimeMcpEffectMap }
