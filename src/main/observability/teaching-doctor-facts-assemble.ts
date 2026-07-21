/**
 * Pure multi-collector TeachingDoctor facts assembler (B-11 residual / ADR-0093).
 *
 * Merges optional base facts with ordered collector partials into a single
 * TeachingDoctorFacts object. Collectors own I/O; this module stays pure regarding
 * doctor checks (never calls runTeachingDoctor) and fail-soft on collector errors.
 *
 * Non-claims:
 * - no auto-repair
 * - no auto-upload / remote telemetry / OTEL
 * - no shell / MCP marketplace
 * - no free-form renderer facts (IPC payload remains ADR-0084 closed)
 */

import type { TeachingDoctorFacts } from '../../shared/teaching-types/teaching-doctor'

export type TeachingDoctorFactsCollector = {
  /** Stable id for diagnostics only (not required in facts). */
  id: string
  /** Collect one partial facts object; may throw — assembler catches — skip that collector. */
  collect(): Promise<Partial<TeachingDoctorFacts>> | Partial<TeachingDoctorFacts>
}

export type AssembleTeachingDoctorFactsInput = {
  /** Base facts (e.g. caller-supplied tests). */
  base?: TeachingDoctorFacts | null
  collectors?: readonly TeachingDoctorFactsCollector[]
  /**
   * When merging collector partials, later collectors overwrite same top-level keys
   * (except processCrashMarker which product-run may still force from store).
   */
}

/**
 * Build a trivial pure collector that always returns the given partial.
 * Useful for tests and future composition-root wiring without I/O.
 */
export function staticTeachingDoctorFactsCollector(
  id: string,
  partial: Partial<TeachingDoctorFacts>
): TeachingDoctorFactsCollector {
  return {
    id,
    collect() {
      return partial
    }
  }
}

/**
 * Assemble TeachingDoctorFacts from optional base + ordered collectors.
 *
 * Rules:
 * - Start from a shallow copy of `base ?? {}`
 * - Run collectors in order; on success shallow-merge top-level keys that are non-null/undefined
 * - Collector throw / reject → skip that collector (fail-soft); never rethrow secrets/paths
 * - Top-level key replace only (no deep-merge of nested objects)
 * - Does not invoke runTeachingDoctor
 */
export async function assembleTeachingDoctorFacts(
  input: AssembleTeachingDoctorFactsInput
): Promise<TeachingDoctorFacts> {
  const facts: TeachingDoctorFacts = { ...(input.base ?? {}) }
  const collectors = input.collectors ?? []

  for (const collector of collectors) {
    try {
      const partial = await Promise.resolve(collector.collect())
      if (partial == null || typeof partial !== 'object') {
        continue
      }
      mergeTopLevelPartial(facts, partial)
    } catch {
      // Fail-soft: skip this collector; never surface secrets/paths.
    }
  }

  return facts
}

function mergeTopLevelPartial(
  target: TeachingDoctorFacts,
  partial: Partial<TeachingDoctorFacts>
): void {
  const keys = Object.keys(partial) as Array<keyof TeachingDoctorFacts>
  for (const key of keys) {
    const value = partial[key]
    if (value === undefined || value === null) {
      continue
    }
    // Top-level key replace is enough and testable (no nested deep-merge).
    ;(target as Record<string, unknown>)[key as string] = value
  }
}
