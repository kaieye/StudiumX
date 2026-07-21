/**
 * Tools/schema session fingerprint guard (B-05 / ADR-0060).
 *
 * Within a single agent run, the offered tool surface is fingerprinted.
 * Silent expansion (new tools or parameter-schema growth/change) fails closed.
 * Legitimate narrowing is allowed only with an explicit audit code.
 *
 * Not a capability system rewrite, MCP/shell surface, or settlement authority.
 */

import { createHash } from 'node:crypto'

import type { ToolDefinition } from '../provider-adapter'

/** Audit codes emitted on schema transitions (status/diagnostic messages). */
export const TOOLS_SCHEMA_AUDIT = {
  narrowed: 'tools_schema_narrowed',
  expanded: 'tools_schema_expanded',
  incompatible: 'tools_schema_incompatible'
} as const

export type ToolsSchemaGuardDecision =
  | { ok: true; fingerprint: string; changed: false }
  | { ok: true; fingerprint: string; changed: true; change: 'narrowed'; auditCode: string }
  | {
      ok: false
      fingerprint: string
      change: 'expanded' | 'incompatible'
      reason: string
      auditCode: string
    }

/** Mutable per-run guard state. Baseline is fixed after the first successful establish. */
export type ToolsSchemaGuardState = {
  fingerprint: string | null
  /** name → canonical parameter-schema fingerprint at baseline */
  baselineByName: Map<string, string> | null
}

export function createToolsSchemaGuardState(): ToolsSchemaGuardState {
  return { fingerprint: null, baselineByName: null }
}

/**
 * Deterministic sha256 hex over sorted tool names + canonical parameter JSON.
 * Description text is intentionally excluded so copy edits do not bust the surface id.
 */
export function fingerprintToolDefinitions(tools: readonly ToolDefinition[]): string {
  const payload = buildCanonicalSurface(tools)
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Compare a previous fingerprint (and optional previous tools) to the next offered set.
 *
 * - `prev === null`: first turn — establish fingerprint, `changed: false`.
 * - Same fingerprint: unchanged.
 * - When `prevTools` is provided and fingerprints differ: classify narrow / expand / incompatible.
 * - When fingerprints differ and `prevTools` is absent: fail closed as `incompatible`.
 */
export function evaluateToolsSchemaTransition(
  prev: string | null,
  nextTools: readonly ToolDefinition[],
  prevTools: readonly ToolDefinition[] | null = null
): ToolsSchemaGuardDecision {
  const fingerprint = fingerprintToolDefinitions(nextTools)

  if (prev === null) {
    return { ok: true, fingerprint, changed: false }
  }

  if (fingerprint === prev) {
    return { ok: true, fingerprint, changed: false }
  }

  if (!prevTools) {
    return {
      ok: false,
      fingerprint,
      change: 'incompatible',
      reason: 'Tools/schema fingerprint changed mid-run without a comparable baseline surface.',
      auditCode: TOOLS_SCHEMA_AUDIT.incompatible
    }
  }

  return classifySurfaceTransition(prevTools, nextTools, fingerprint)
}

/**
 * One-line hook for agent-loop (and recovery): remember baseline on first call;
 * subsequent calls compare against that fixed baseline (not the last offered set),
 * so a temporary narrow does not re-authorize later expansion.
 */
export function assertToolsSchemaStable(
  state: ToolsSchemaGuardState,
  tools: readonly ToolDefinition[]
): ToolsSchemaGuardDecision {
  const fingerprint = fingerprintToolDefinitions(tools)

  if (state.fingerprint === null || state.baselineByName === null) {
    state.fingerprint = fingerprint
    state.baselineByName = buildBaselineByName(tools)
    return { ok: true, fingerprint, changed: false }
  }

  if (fingerprint === state.fingerprint) {
    return { ok: true, fingerprint, changed: false }
  }

  const decision = classifyAgainstBaseline(state.baselineByName, tools, fingerprint)
  // Baseline (name→params) stays fixed for the run.
  // Refresh stored fingerprint on allowed transitions so identical re-offers short-circuit.
  if (decision.ok) {
    state.fingerprint = fingerprint
  }
  return decision
}

// ---- internals ----

type CanonicalToolEntry = {
  name: string
  parameters: string
}

function buildCanonicalSurface(tools: readonly ToolDefinition[]): string {
  const entries = toCanonicalEntries(tools)
  return JSON.stringify(entries)
}

function toCanonicalEntries(tools: readonly ToolDefinition[]): CanonicalToolEntry[] {
  const byName = new Map<string, CanonicalToolEntry>()
  for (const tool of tools) {
    const name = tool.function?.name ?? ''
    const parameters = stableSerialize(tool.function?.parameters ?? {})
    // Last definition wins on duplicate names (deterministic after sort).
    byName.set(name, { name, parameters })
  }
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function buildBaselineByName(tools: readonly ToolDefinition[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of toCanonicalEntries(tools)) {
    map.set(entry.name, entry.parameters)
  }
  return map
}

function classifySurfaceTransition(
  prevTools: readonly ToolDefinition[],
  nextTools: readonly ToolDefinition[],
  fingerprint: string
): ToolsSchemaGuardDecision {
  return classifyAgainstBaseline(buildBaselineByName(prevTools), nextTools, fingerprint)
}

function classifyAgainstBaseline(
  baselineByName: ReadonlyMap<string, string>,
  nextTools: readonly ToolDefinition[],
  fingerprint: string
): ToolsSchemaGuardDecision {
  const nextEntries = toCanonicalEntries(nextTools)
  const nextByName = new Map(nextEntries.map((e) => [e.name, e.parameters]))

  // Schema change or unknown tool → fail closed.
  for (const [name, nextParams] of nextByName) {
    const baselineParams = baselineByName.get(name)
    if (baselineParams === undefined) {
      return {
        ok: false,
        fingerprint,
        change: 'expanded',
        reason: `Tools/schema expanded mid-run: added tool "${name}".`,
        auditCode: TOOLS_SCHEMA_AUDIT.expanded
      }
    }
    if (baselineParams !== nextParams) {
      return {
        ok: false,
        fingerprint,
        change: 'incompatible',
        reason: `Tools/schema incompatible mid-run: parameter schema changed for "${name}".`,
        auditCode: TOOLS_SCHEMA_AUDIT.incompatible
      }
    }
  }

  // Every next tool is a schema-equal member of the first-turn baseline.
  let removed = 0
  for (const name of baselineByName.keys()) {
    if (!nextByName.has(name)) removed += 1
  }

  if (removed > 0 || nextByName.size < baselineByName.size) {
    return {
      ok: true,
      fingerprint,
      changed: true,
      change: 'narrowed',
      auditCode: TOOLS_SCHEMA_AUDIT.narrowed
    }
  }

  // Same names + schemas as the original baseline (e.g. restore after a temporary narrow).
  // Treat as unchanged relative to the run grant; caller may refresh stored fingerprint.
  return { ok: true, fingerprint, changed: false }
}

/**
 * Stable JSON with sorted object keys so fingerprints ignore insertion order.
 */
function stableSerialize(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      out[key] = sortKeys(record[key])
    }
    return out
  }
  return value
}
