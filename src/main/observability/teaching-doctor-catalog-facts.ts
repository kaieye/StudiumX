/**
 * Fail-soft TeachingDoctor catalog-drift facts collector (B-11 residual / ADR-0007).
 *
 * Thin adapter: calls injected `loadPlan()` (typically active workspace +
 * `planLessonIndexReconciliation`) and maps the plan into
 * `TeachingDoctorCatalogDriftFacts` only. Never embeds absolute home paths,
 * secrets, or free-form renderer facts.
 *
 * Non-claims:
 * - no auto-repair / persist of reconciliation plan
 * - no auto-upload / remote telemetry / OTEL
 * - no free-form renderer facts (IPC payload remains ADR-0007 closed)
 * - no session/outcome crash-window FS deep scan (still residual)
 * - no peel of teaching-workspace.ts
 */

import type {
  TeachingDoctorCatalogDriftFacts,
  TeachingDoctorFacts
} from '../../shared/teaching-types/teaching-doctor'
import type { TeachingDoctorFactsCollector } from './teaching-doctor-facts-assemble'

/** Max relative path samples retained in facts (counts may still reflect full sanitized length). */
export const TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP = 32

/** Max characters kept per relative path label. */
const MAX_RELATIVE_PATH_LENGTH = 256

export type TeachingDoctorCatalogDriftPlan = {
  requiresPersist: boolean
  recoveredRelativePaths: readonly string[]
  removedRelativePaths: readonly string[]
}

export type TeachingDoctorCatalogFactsSource = {
  /**
   * Return plan for active workspace; null/undefined = no active workspace.
   * May throw — collector catches — fail-soft skip (empty partial).
   */
  loadPlan(): Promise<TeachingDoctorCatalogDriftPlan | null | undefined>
}

/**
 * Factory for a main-side catalog-drift facts collector used by product TeachingDoctor.
 * Composition root / gateway injects this into runProductTeachingDoctor deps.
 *
 * Decision (ADR-0007): no active workspace / null plan → empty `{}` partial so
 * pure `checkCatalogDrift` stays `skipped` (facts not supplied). Throw → `{}`.
 */
export function createTeachingDoctorCatalogDriftFactsCollector(
  source: TeachingDoctorCatalogFactsSource
): TeachingDoctorFactsCollector {
  return {
    id: 'catalog-drift',
    async collect(): Promise<Partial<TeachingDoctorFacts>> {
      try {
        const plan = await source.loadPlan()
        if (plan == null) {
          // Prefer empty partial so catalog_drift stays skipped when no workspace.
          return {}
        }
        return { catalogDrift: mapPlanToCatalogDriftFacts(plan) }
      } catch {
        // Fail-soft: skip facts (doctor shows skipped), never rethrow secrets/paths.
        return {}
      }
    }
  }
}

/**
 * Map a reconciliation plan into export-safe catalogDrift facts.
 * Relative-only paths; absolute / home-root looking entries are dropped.
 */
export function mapPlanToCatalogDriftFacts(
  plan: TeachingDoctorCatalogDriftPlan
): TeachingDoctorCatalogDriftFacts {
  const recoveredRelativePaths = sanitizeRelativePathList(plan.recoveredRelativePaths)
  const removedRelativePaths = sanitizeRelativePathList(plan.removedRelativePaths)

  return {
    requiresPersist: plan.requiresPersist === true,
    recoveredCount: recoveredRelativePaths.length,
    removedCount: removedRelativePaths.length,
    recoveredRelativePaths: recoveredRelativePaths.slice(0, TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP),
    removedRelativePaths: removedRelativePaths.slice(0, TEACHING_DOCTOR_CATALOG_PATH_HARD_CAP)
  }
}

function sanitizeRelativePathList(paths: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(paths)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of paths) {
    const safe = toSafeRelativePath(raw)
    if (safe == null) continue
    if (seen.has(safe)) continue
    seen.add(safe)
    out.push(safe)
  }
  return out
}

/**
 * Accept workspace-relative path labels only.
 * Returns null when the value looks absolute, empty, or home-rooted.
 */
function toSafeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null

  // Normalize separators for inspection / storage.
  const normalized = trimmed.replace(/\\/g, '/')

  if (looksLikeAbsoluteOrHomePath(normalized) || looksLikeAbsoluteOrHomePath(trimmed)) {
    return null
  }

  // Reject parent-escape / drive-ish noise that would still leak location.
  if (normalized.includes('://')) return null
  if (normalized.startsWith('~/') || normalized === '~') return null

  // Drop leading ./ and collapse duplicate slashes lightly.
  let relative = normalized.replace(/^\.\/+/, '').replace(/\/{2,}/g, '/')
  if (relative.length === 0) return null
  if (looksLikeAbsoluteOrHomePath(relative)) return null

  if (relative.length > MAX_RELATIVE_PATH_LENGTH) {
    relative = `${relative.slice(0, MAX_RELATIVE_PATH_LENGTH - 1)}…`
  }
  return relative
}

function looksLikeAbsoluteOrHomePath(value: string): boolean {
  if (!value) return false
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  if (value.startsWith('\\\\') || value.startsWith('//')) return true
  if (
    value.startsWith('/Users/') ||
    value.startsWith('/home/') ||
    value.startsWith('/private/var/') ||
    value.startsWith('/var/folders/')
  ) {
    return true
  }
  // POSIX absolute with common user-root segments.
  if (value.startsWith('/') && /\/(Users|home|Documents|Desktop|Downloads)\//i.test(value)) {
    return true
  }
  // Bare POSIX absolute (still not workspace-relative).
  if (value.startsWith('/') && !value.startsWith('./')) {
    return true
  }
  return false
}
