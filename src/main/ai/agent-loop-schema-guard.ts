/**
 * B-05 / ADR-0005 tools/schema session guard wrapper for agent-loop.
 *
 * Thin pure-ish peel of `applyToolsSchemaGuard`: assert fingerprint stability
 * and emit status events on fail-closed expansion or audited narrowing.
 * No I/O; no retry / budget / settlement authority.
 *
 * @see ADR-0004, ADR-0005
 */

import type { ToolDefinition } from './provider-adapter'
import type { AgentLoopStatus } from '../../shared/teaching-types'
import {
  assertToolsSchemaStable,
  type ToolsSchemaGuardDecision,
  type ToolsSchemaGuardState
} from './tools/tools-schema-fingerprint'

/** Status-only emit surface used by the schema guard (subset of AgentLoopEvent). */
export type ToolsSchemaGuardEmit = (event: {
  type: 'status'
  status: AgentLoopStatus
  message?: string
}) => void

/**
 * B-05 / ADR-0005: fail closed on silent tools/schema expansion; audit narrows.
 * One-line guard so concurrent loop work can keep a single call site.
 */
export function applyToolsSchemaGuard(
  state: ToolsSchemaGuardState,
  tools: readonly ToolDefinition[],
  emit: ToolsSchemaGuardEmit
): ToolsSchemaGuardDecision {
  const decision = assertToolsSchemaStable(state, tools)
  if (!decision.ok) {
    emit({
      type: 'status',
      status: 'error',
      message: `[${decision.auditCode}] ${decision.reason}`
    })
    return decision
  }
  if (decision.changed && decision.change === 'narrowed') {
    emit({
      type: 'status',
      status: 'thinking',
      message: `[${decision.auditCode}] Tools/schema narrowed mid-run (fingerprint=${decision.fingerprint.slice(0, 12)}).`
    })
  }
  return decision
}
