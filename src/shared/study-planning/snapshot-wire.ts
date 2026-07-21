/**
 * ADR-0117 path constants + snapshot wire validation (pure; no fs).
 */

import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION,
  type StudyPlanningSnapshotV1
} from './study-planning-store'

/** Workspace-relative directory (POSIX-style separators in docs; join with path on host). */
export const STUDY_PLANNING_DIR_SEGMENTS = ['.studiumx', 'study-planning'] as const
export const STUDY_PLANNING_SNAPSHOT_FILE = 'snapshot.json'
export const STUDY_PLANNING_BACKUP_DIR = 'backups'
export const STUDY_PLANNING_MIGRATION_REPORT_FILE = 'migration-report-latest.json'

export function studyPlanningSnapshotRelativePath(sep = '/'): string {
  return [...STUDY_PLANNING_DIR_SEGMENTS, STUDY_PLANNING_SNAPSHOT_FILE].join(sep)
}

export function studyPlanningRootRelativePath(sep = '/'): string {
  return STUDY_PLANNING_DIR_SEGMENTS.join(sep)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Fail-closed structural validator for durable publish (not full entity deep-validate).
 */
export function isStudyPlanningSnapshotV1(value: unknown): value is StudyPlanningSnapshotV1 {
  if (!isObject(value)) return false
  if (value.schema !== STUDY_PLANNING_SCHEMA) return false
  if (value.schemaVersion !== STUDY_PLANNING_SCHEMA_VERSION) return false
  if (typeof value.revision !== 'number' || !Number.isFinite(value.revision) || value.revision < 1) {
    return false
  }
  if (typeof value.updatedAtMs !== 'number' || !Number.isFinite(value.updatedAtMs)) return false
  if (!Array.isArray(value.tasks)) return false
  if (!Array.isArray(value.scheduleBlocks)) return false
  if (!Array.isArray(value.timerPlans)) return false
  if (!Array.isArray(value.timerSessions)) return false
  if (!isObject(value.preferences)) return false
  if (!isObject(value.localAnalyticsHints)) return false
  return true
}

export function parseStudyPlanningSnapshotJson(
  content: string
): { ok: true; snapshot: StudyPlanningSnapshotV1 } | { ok: false; code: string; message: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    return { ok: false, code: 'json_parse', message: 'snapshot is not valid JSON' }
  }
  if (!isStudyPlanningSnapshotV1(parsed)) {
    return { ok: false, code: 'schema_invalid', message: 'snapshot failed StudyPlanningSnapshotV1 validation' }
  }
  return { ok: true, snapshot: parsed }
}

export function serializeStudyPlanningSnapshot(snapshot: StudyPlanningSnapshotV1): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`
}
