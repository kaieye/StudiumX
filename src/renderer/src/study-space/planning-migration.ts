/**
 * V1 → V2 migration commit helper (ADR-0011).
 *
 * Flow: read V1 slice → pure dry-run → (caller confirms) → import_migration_commit
 * via StudyPlanningStore durable IPC. Never writes without userConfirmed.
 *
 * localStorage erase is intentionally NOT automatic (backup ≥30 days or user confirm).
 */

import {
  migrateStudyV1ToPlanning,
  type MigrateStudyV1Options,
  type MigrateStudyV1Result,
  type MigrationReportEntry,
  type StudySnapshotV1Slice,
  type StudyPlanningCommandEnvelope,
  type StudyPlanningCommandType
} from '../../../shared/study-planning'
import {
  applyStudyPlanningCommand,
  readStudyPlanningSnapshot,
  type PlanningClientApplyResult,
  type StudyPlanningApi
} from './planning-client'

export type V1MigrationDryRunResult = {
  ok: true
  dryRun: MigrateStudyV1Result
  /** True when V1 has nothing meaningful to migrate. */
  empty: boolean
  /** Human-oriented summary counts for confirm UI. */
  summary: {
    taskCount: number
    scheduleBlockCount: number
    timerPlanCount: number
    suggestedWindowCount: number
    reportCodes: string[]
  }
}

export type V1MigrationDryRunErr = {
  ok: false
  code: 'no_v1_source' | 'empty_migration'
  message: string
  dryRun?: MigrateStudyV1Result
}

export type CommitV1MigrationInput = {
  api: StudyPlanningApi | null | undefined
  workspaceRoot: string | null | undefined
  /** Raw V1 snapshot fields (tasks/timerPlans/simulation*). */
  v1Snapshot: StudySnapshotV1Slice | unknown
  /** Must be true after user confirms dry-run report. */
  userConfirmed: true
  weekAnchorMidnightMs?: number
  expectedRevision?: number
  actionId?: string
  nowMs?: () => number
  /**
   * Optional unreliable active timer sessions to import as needs_reconcile.
   * Prefer omit until timer durable cutover (Slice D).
   */
  timerSessions?: unknown[]
  preferences?: Record<string, unknown>
  /** Optional category catalog seed from V1 localStorage. */
  categories?: unknown[]
  source?: string
}

export type CommitV1MigrationResult =
  | (Extract<PlanningClientApplyResult, { ok: true }> & {
      dryRun: MigrateStudyV1Result
    })
  | (Extract<PlanningClientApplyResult, { ok: false }> & {
      dryRun?: MigrateStudyV1Result
    })
  | {
      ok: false
      revision: 0
      error: { code: string; message: string }
      dryRun?: MigrateStudyV1Result
    }

/**
 * Pure dry-run only. Does not touch IPC or localStorage.
 */
export function dryRunV1Migration(
  v1Snapshot: StudySnapshotV1Slice | unknown,
  options: MigrateStudyV1Options = {}
): V1MigrationDryRunResult | V1MigrationDryRunErr {
  if (v1Snapshot == null) {
    return {
      ok: false,
      code: 'no_v1_source',
      message: 'No V1 snapshot provided for migration dry-run'
    }
  }
  const dryRun = migrateStudyV1ToPlanning(v1Snapshot, options)
  const empty =
    dryRun.tasks.length === 0 &&
    dryRun.scheduleBlocks.length === 0 &&
    dryRun.timerPlans.length === 0
  if (empty) {
    return {
      ok: false,
      code: 'empty_migration',
      message: 'V1 snapshot produced no migratable tasks, blocks, or timer plans',
      dryRun
    }
  }
  return {
    ok: true,
    dryRun,
    empty: false,
    summary: {
      taskCount: dryRun.tasks.length,
      scheduleBlockCount: dryRun.scheduleBlocks.length,
      timerPlanCount: dryRun.timerPlans.length,
      suggestedWindowCount: dryRun.suggestedWindows.length,
      reportCodes: [...new Set(dryRun.report.map((e: MigrationReportEntry) => e.code))]
    }
  }
}

/**
 * Build import_migration_commit envelope from dry-run result.
 * suggestedWindows stay report-only inside payload (store stores as hints, not blocks).
 */
export function buildImportMigrationCommitCommand(
  dryRun: MigrateStudyV1Result,
  actionId: string,
  options?: {
    clientIssuedAtMs?: number
    timerSessions?: unknown[]
    preferences?: Record<string, unknown>
    categories?: unknown[]
    source?: string
  }
): StudyPlanningCommandEnvelope {
  const payload: Record<string, unknown> = {
    userConfirmed: true,
    tasks: dryRun.tasks,
    scheduleBlocks: dryRun.scheduleBlocks,
    timerPlans: dryRun.timerPlans,
    migrationReport: dryRun.report,
    suggestedWindows: dryRun.suggestedWindows,
    source: options?.source ?? 'v1_local_storage'
  }
  if (options?.timerSessions && options.timerSessions.length > 0) {
    payload.timerSessions = options.timerSessions
  }
  if (options?.preferences) {
    payload.preferences = options.preferences
  }
  if (options?.categories && options.categories.length > 0) {
    payload.categories = options.categories
  }
  return {
    actionId,
    type: 'import_migration_commit' as StudyPlanningCommandType,
    payload,
    ...(options?.clientIssuedAtMs !== undefined
      ? { clientIssuedAtMs: options.clientIssuedAtMs }
      : {})
  }
}

/**
 * Dry-run then commit through durable IPC. Caller must set userConfirmed:true after showing report.
 * Fail-closed on missing workspace/API. revision_conflict → re-read + retry once with new actionId.
 */
export async function commitV1Migration(
  input: CommitV1MigrationInput
): Promise<CommitV1MigrationResult> {
  if (input.userConfirmed !== true) {
    return {
      ok: false,
      revision: 0,
      error: {
        code: 'invalid_command',
        message: 'commitV1Migration requires userConfirmed:true'
      }
    }
  }

  const dry = dryRunV1Migration(input.v1Snapshot, {
    ...(input.weekAnchorMidnightMs !== undefined
      ? { weekAnchorMidnightMs: input.weekAnchorMidnightMs }
      : {})
  })
  if (!dry.ok) {
    return {
      ok: false,
      revision: 0,
      error: { code: dry.code, message: dry.message },
      ...(dry.dryRun ? { dryRun: dry.dryRun } : {})
    }
  }

  const nowMs = input.nowMs ?? (() => Date.now())
  const makeActionId = (suffix: string): string =>
    input.actionId && suffix === '0'
      ? input.actionId
      : `import_migration_commit:${nowMs()}:${suffix}`

  let expectedRevision = input.expectedRevision
  if (expectedRevision === undefined) {
    const read = await readStudyPlanningSnapshot(input.api, input.workspaceRoot)
    if (!read.ok) {
      return {
        ok: false,
        revision: 0,
        error: { code: read.code, message: read.message },
        dryRun: dry.dryRun
      }
    }
    expectedRevision = read.snapshot.revision
  }

  const cmdOptions = {
    clientIssuedAtMs: nowMs(),
    ...(input.timerSessions ? { timerSessions: input.timerSessions } : {}),
    ...(input.preferences ? { preferences: input.preferences } : {}),
    ...(input.categories && input.categories.length > 0
      ? { categories: input.categories }
      : {}),
    ...(input.source ? { source: input.source } : {})
  }

  const first = await applyStudyPlanningCommand(
    input.api,
    input.workspaceRoot,
    expectedRevision,
    buildImportMigrationCommitCommand(dry.dryRun, makeActionId('0'), cmdOptions)
  )
  if (first.ok) {
    return { ...first, dryRun: dry.dryRun }
  }
  if (first.error.code !== 'revision_conflict') {
    return { ...first, dryRun: dry.dryRun }
  }

  const refreshed = await readStudyPlanningSnapshot(input.api, input.workspaceRoot)
  if (!refreshed.ok) {
    return {
      ok: false,
      revision: first.revision,
      error: { code: refreshed.code, message: refreshed.message },
      dryRun: dry.dryRun
    }
  }
  const retry = await applyStudyPlanningCommand(
    input.api,
    input.workspaceRoot,
    refreshed.snapshot.revision,
    buildImportMigrationCommitCommand(dry.dryRun, makeActionId('retry'), {
      ...cmdOptions,
      clientIssuedAtMs: nowMs()
    })
  )
  if (retry.ok) return { ...retry, dryRun: dry.dryRun }
  return { ...retry, dryRun: dry.dryRun }
}

/**
 * Format a short confirm message for window.confirm / sheet (UI may replace later).
 */
export function formatMigrationConfirmMessage(dry: V1MigrationDryRunResult): string {
  const s = dry.summary
  return [
    '将 V1 学习任务迁移到工作区权威 store？',
    `任务 ${s.taskCount} · 日程块 ${s.scheduleBlockCount} · 计时方案 ${s.timerPlanCount}`,
    s.suggestedWindowCount > 0
      ? `（${s.suggestedWindowCount} 个模拟时段仅作建议，不记为历史日程）`
      : '',
    '确认后写入 .studiumx/study-planning/snapshot.json。',
    'localStorage 源数据不会自动删除（保留 ≥30 天或你手动清除）。'
  ]
    .filter(Boolean)
    .join('\n')
}
