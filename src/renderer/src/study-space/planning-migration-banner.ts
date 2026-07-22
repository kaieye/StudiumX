/**
 * Pure model for V1 → canonical migration banner / confirm sheet (ADR-0117 cutover B UX).
 * Host owns confirm → commit; this module only formats copy + summary.
 */

export type MigrationBannerSummary = {
  taskCount: number
  scheduleBlockCount: number
  timerPlanCount: number
  suggestedWindowCount: number
}

export type MigrationBannerCopy = {
  title: string
  description: string
  metaLine: string
  confirmLabel: string
  dismissLabel: string
  laterLabel: string
  busyLabel: string
  eyebrow: string
}

export type MigrationBannerModel = {
  kind: 'prompt'
  summary: MigrationBannerSummary
  copy: MigrationBannerCopy
  canConfirm: boolean
}

export type BuildMigrationBannerModelInput = {
  summary: MigrationBannerSummary
  /**
   * When true (post-confirm commit in flight), primary action stays visible but copy shows busy.
   */
  busy?: boolean
}

function nonNegativeInt(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  return Math.max(0, Math.floor(n))
}

/**
 * Normalize dry-run / hydrate-derived counts for banner UI.
 */
export function normalizeMigrationBannerSummary(
  input: Partial<MigrationBannerSummary> | null | undefined
): MigrationBannerSummary {
  return {
    taskCount: nonNegativeInt(input?.taskCount),
    scheduleBlockCount: nonNegativeInt(input?.scheduleBlockCount),
    timerPlanCount: nonNegativeInt(input?.timerPlanCount),
    suggestedWindowCount: nonNegativeInt(input?.suggestedWindowCount)
  }
}

/**
 * Build banner/confirm model. canConfirm when at least one migratable row exists.
 */
export function buildMigrationBannerModel(
  input: BuildMigrationBannerModelInput
): MigrationBannerModel {
  const summary = normalizeMigrationBannerSummary(input.summary)
  const total =
    summary.taskCount + summary.scheduleBlockCount + summary.timerPlanCount
  const canConfirm = total > 0
  const metaParts = [
    `任务 ${summary.taskCount}`,
    `日程块 ${summary.scheduleBlockCount}`,
    `计时方案 ${summary.timerPlanCount}`
  ]
  if (summary.suggestedWindowCount > 0) {
    metaParts.push(`模拟时段建议 ${summary.suggestedWindowCount}`)
  }
  return {
    kind: 'prompt',
    summary,
    canConfirm,
    copy: {
      eyebrow: '工作区迁移',
      title: canConfirm ? '将本地任务迁移到工作区权威文件？' : '暂无可迁移的本地规划',
      description: canConfirm
        ? '检测到工作区 canonical 规划为空，本机仍有可重建的 V1 任务缓存。确认后写入 .studiumx/study-planning/snapshot.json；localStorage 不会自动删除。'
        : '没有可写入的任务、日程块或计时方案。',
      metaLine: metaParts.join(' · '),
      confirmLabel: input.busy ? '正在迁移…' : '确认迁移',
      dismissLabel: '关闭',
      laterLabel: '稍后',
      busyLabel: '正在写入工作区…'
    }
  }
}

/**
 * Map hydrate kept_v1 + host V1 counts into a banner signal.
 * Only when migrationSuggested and host has at least one task.
 */
export function shouldOfferMigrationBanner(input: {
  migrationSuggested: boolean
  hostTaskCount: number
  reason?: string
}): boolean {
  if (!input.migrationSuggested) return false
  if (input.hostTaskCount <= 0) return false
  // Race skip must not pop migration UI.
  if (input.reason === 'unknown') return false
  return true
}
