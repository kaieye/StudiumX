/**
 * Fail-soft TeachingDoctor source-gap facts collector (B-11 residual / ADR-0007).
 *
 * Thin workspace-summary projection: maps active-workspace resource counts +
 * assetsReady into `TeachingDoctorSourceGapFacts` only. Never embeds absolute
 * paths, secrets, free-form renderer facts, or GroundingPack deep scans.
 *
 * Non-claims:
 * - not a full ResourceGrounder / GroundingPack / mission-descriptor ground
 * - no auto-repair / invent sources / persist resources
 * - no auto-upload / remote telemetry / OTEL
 * - no free-form renderer facts (IPC payload remains ADR-0007 closed)
 * - no peel of teaching-workspace.ts / resource-grounder
 */

import type {
  TeachingDoctorFacts,
  TeachingDoctorSourceGapFacts
} from '../../shared/teaching-types/teaching-doctor'
import type { TeachingDoctorFactsCollector } from './teaching-doctor-facts-assemble'

/** Max exclusion codes retained in facts (stable short codes only). */
export const TEACHING_DOCTOR_SOURCE_GAP_CODE_HARD_CAP = 12

export type TeachingDoctorSourceGapWorkspaceSummary = {
  resourcesCount: number
  referenceCount: number
  assetsReady: boolean
}

export type TeachingDoctorSourceGapFactsSource = {
  /**
   * null/undefined = no active workspace → empty partial (check skipped).
   * May throw → collector catches → fail-soft `{}`.
   */
  loadSummary(): Promise<TeachingDoctorSourceGapWorkspaceSummary | null | undefined>
}

/**
 * Factory for a main-side source-gap facts collector used by product TeachingDoctor.
 * Composition root / gateway injects this into runProductTeachingDoctor deps.
 *
 * Decision (ADR-0007): no active workspace / null summary → empty `{}` partial so
 * pure `checkSourceGap` stays `skipped` (facts not supplied). Throw → `{}`.
 */
export function createTeachingDoctorSourceGapFactsCollector(
  source: TeachingDoctorSourceGapFactsSource
): TeachingDoctorFactsCollector {
  return {
    id: 'source-gap',
    async collect(): Promise<Partial<TeachingDoctorFacts>> {
      try {
        const summary = await source.loadSummary()
        if (summary == null) {
          // Prefer empty partial so source_gap stays skipped when no workspace.
          return {}
        }
        return { sourceGap: mapWorkspaceSummaryToSourceGapFacts(summary) }
      } catch {
        // Fail-soft: skip facts (doctor shows skipped), never rethrow secrets/paths.
        return {}
      }
    }
  }
}

/**
 * Map an active-workspace resource summary into export-safe sourceGap facts.
 * Counts are numbers only; exclusion codes are stable short codes (hard-cap 12).
 * Never includes absolute paths or secrets.
 */
export function mapWorkspaceSummaryToSourceGapFacts(
  summary: TeachingDoctorSourceGapWorkspaceSummary
): TeachingDoctorSourceGapFacts {
  const resourcesCount = nonNegativeCount(summary.resourcesCount)
  const referenceCount = nonNegativeCount(summary.referenceCount)
  const assetsReady = summary.assetsReady === true
  const availableSourceCount = resourcesCount + referenceCount

  if (!assetsReady && resourcesCount === 0 && referenceCount === 0) {
    return {
      status: 'not_configured',
      availableSourceCount,
      exclusionCodes: clampCodes(['assets_not_ready']),
      gapCount: 1
    }
  }

  if (!assetsReady) {
    return {
      status: 'degraded',
      availableSourceCount,
      exclusionCodes: clampCodes(['assets_not_ready']),
      gapCount: 1
    }
  }

  if (resourcesCount === 0 && referenceCount === 0) {
    return {
      status: 'unavailable',
      availableSourceCount,
      exclusionCodes: clampCodes(['resource_absent']),
      gapCount: 1
    }
  }

  if (resourcesCount === 0) {
    // Reference-only: assets ready but no resource summaries → degraded gap.
    return {
      status: 'degraded',
      availableSourceCount,
      exclusionCodes: clampCodes(['resource_gap']),
      gapCount: 1
    }
  }

  return {
    status: 'ready',
    availableSourceCount,
    exclusionCodes: [],
    gapCount: 0
  }
}

function nonNegativeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/**
 * Keep stable short snake_case-ish codes only; drop path-like / secret-shaped noise.
 * Hard-cap TEACHING_DOCTOR_SOURCE_GAP_CODE_HARD_CAP; de-duplicate preserving order.
 */
function clampCodes(codes: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of codes) {
    if (typeof raw !== 'string') continue
    const code = sanitizeExclusionCode(raw)
    if (code == null) continue
    if (seen.has(code)) continue
    seen.add(code)
    out.push(code)
    if (out.length >= TEACHING_DOCTOR_SOURCE_GAP_CODE_HARD_CAP) break
  }
  return out
}

function sanitizeExclusionCode(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  // Reject path / home / drive / URL shapes — codes must stay short labels.
  if (/[\\/]/.test(trimmed)) return null
  if (/^[A-Za-z]:/.test(trimmed)) return null
  if (trimmed.includes('://')) return null
  if (trimmed.startsWith('~')) return null
  // Allow stable short codes: letters, digits, underscore, hyphen only.
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(trimmed)) return null
  return trimmed
}
