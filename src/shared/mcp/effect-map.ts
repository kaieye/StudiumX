/**
 * MCP tool effect mapping (ADR-0128 §6).
 * Pure — default privileged; optional per-raw-name overrides.
 */

import type { McpEffectClass } from './types'

const EFFECT_CLASSES = new Set<McpEffectClass>([
  'read',
  'workspace_write',
  'external_write',
  'privileged'
])

export function isMcpEffectClass(value: unknown): value is McpEffectClass {
  return typeof value === 'string' && EFFECT_CLASSES.has(value as McpEffectClass)
}

/**
 * Resolve effect for one MCP tool.
 * Unknown / missing override → privileged (fail-closed default).
 */
export function resolveMcpToolEffect(
  rawToolName: string,
  overrides?: Readonly<Record<string, McpEffectClass>> | null
): McpEffectClass {
  if (!overrides) return 'privileged'
  const key = typeof rawToolName === 'string' ? rawToolName.trim() : ''
  if (!key) return 'privileged'
  const override = overrides[key]
  return isMcpEffectClass(override) ? override : 'privileged'
}

/**
 * Validate toolEffectOverrides map. Invalid values → fail (caller rejects enable).
 */
export function validateToolEffectOverrides(
  value: unknown
):
  | { ok: true; value: Readonly<Record<string, McpEffectClass>> }
  | { ok: false; reason: string } {
  if (value == null) return { ok: true, value: {} }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'toolEffectOverrides must be an object' }
  }
  const out: Record<string, McpEffectClass> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key.trim()) {
      return { ok: false, reason: 'toolEffectOverrides keys must be non-empty strings' }
    }
    if (!isMcpEffectClass(raw)) {
      return {
        ok: false,
        reason: `toolEffectOverrides.${key} must be read|workspace_write|external_write|privileged`
      }
    }
    out[key.trim()] = raw
  }
  return { ok: true, value: out }
}

/**
 * Permission kind aligned with effect for MCP bridge tools.
 *
 * Non-read MCP tools must use `workspace_write` so they enter the interactive
 * permission path in registry (non-workspace_write kinds auto-allow today).
 * MCP handlers still never write the workspace (ADR-0128 §6).
 */
export function permissionKindForMcpEffect(
  effect: McpEffectClass
): 'workspace_read' | 'workspace_write' | 'external_network' {
  switch (effect) {
    case 'read':
      return 'workspace_read'
    case 'external_write':
    case 'workspace_write':
    case 'privileged':
    default:
      return 'workspace_write'
  }
}