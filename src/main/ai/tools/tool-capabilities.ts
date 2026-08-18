/**
 * Tool capability metadata derived from the effect lattice.
 *
 * Capabilities are declarative discovery metadata for concurrency, cancel, and
 * read-only stance. They do not authorize execution: effect-policy and the
 * interactive permission gate remain the pre-execution authority.
 *
 * Write / external_write / privileged tools always declare maxConcurrency = 1.
 * This module never opens write parallelism (ADR-0004 / ADOPTION B-07).
 */

import { classifyToolEffect } from './effect-policy'
import type { ToolEffectClass } from './tool-outcome'

/** Default max concurrency for pure-read tools (aligned with parallel-read default). */
export const READ_TOOL_MAX_CONCURRENCY = 4

/** Hard cap for any non-read tool — write parallelism is never declared open. */
export const NON_READ_MAX_CONCURRENCY = 1

export type ToolCapabilities = Readonly<{
  isReadOnly: boolean
  maxConcurrency: number
  supportsCancel: boolean
  effectClass: ToolEffectClass
}>

/**
 * Optional per-tool overrides on top of effect-class defaults.
 * Keep this table small; unknown tools stay fail-closed via classifyToolEffect.
 */
const TOOL_CAPABILITY_OVERRIDES: Readonly<Record<string, Partial<Omit<ToolCapabilities, 'effectClass'>>>> = {
  // Interactive ask remains cancelable via run signal but is never parallel.
  ask: { supportsCancel: true, maxConcurrency: 1 }
}

/**
 * Default capability shape for an effect class.
 * Unknown / privileged tools fail closed: not read-only, concurrency 1.
 */
export function capabilitiesForEffectClass(effectClass: ToolEffectClass): ToolCapabilities {
  switch (effectClass) {
    case 'read':
      return {
        isReadOnly: true,
        maxConcurrency: READ_TOOL_MAX_CONCURRENCY,
        supportsCancel: true,
        effectClass: 'read'
      }
    case 'workspace_write':
      return {
        isReadOnly: false,
        maxConcurrency: NON_READ_MAX_CONCURRENCY,
        supportsCancel: true,
        effectClass: 'workspace_write'
      }
    case 'external_write':
      return {
        isReadOnly: false,
        maxConcurrency: NON_READ_MAX_CONCURRENCY,
        supportsCancel: true,
        effectClass: 'external_write'
      }
    case 'privileged':
    default:
      return {
        isReadOnly: false,
        maxConcurrency: NON_READ_MAX_CONCURRENCY,
        supportsCancel: true,
        effectClass: 'privileged'
      }
  }
}

/**
 * Resolve capability metadata for a registered or unknown tool name.
 * Derives from classifyToolEffect + optional known-table overrides.
 * Unknown names are privileged with concurrency 1 (fail closed).
 */
export function capabilitiesForTool(toolName: string): ToolCapabilities {
  const name = toolName.trim()
  const effectClass = classifyToolEffect(name)
  const base = capabilitiesForEffectClass(effectClass)
  if (!name) return base

  const override = TOOL_CAPABILITY_OVERRIDES[name]
  if (!override) return base

  const merged: ToolCapabilities = {
    ...base,
    ...override,
    effectClass
  }

  // Hard invariant: non-read tools never advertise concurrency > 1.
  if (effectClass !== 'read' && merged.maxConcurrency > NON_READ_MAX_CONCURRENCY) {
    return { ...merged, maxConcurrency: NON_READ_MAX_CONCURRENCY }
  }
  // Read tools must stay read-only in metadata.
  if (effectClass === 'read') {
    return { ...merged, isReadOnly: true, effectClass: 'read' }
  }
  return merged
}

/** True when the capability set is pure-read and eligible for bounded parallel dispatch. */
export function isParallelReadCapable(capabilities: ToolCapabilities): boolean {
  return (
    capabilities.effectClass === 'read' &&
    capabilities.isReadOnly &&
    capabilities.maxConcurrency > 1
  )
}
