/**
 * Header for the web planning view: title + canonical revision/updatedAt + reload.
 * Presentational only.
 */

import { formatTimestamp } from './planningUi'

interface PlanningViewHeaderProps {
  revision: number | null
  updatedAtMs: number | null
  onReload: () => void
  reloading: boolean
}

export function PlanningViewHeader({ revision, updatedAtMs, onReload, reloading }: PlanningViewHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">学习计划</h1>
        <p className="mt-1 text-sm text-neutral-500">
          管理你的学习任务与日程安排。数据通过 StudiumX-Server 同步，支持多端修订冲突检测。
        </p>
      </div>
      <div className="flex items-center gap-3 text-sm text-neutral-500">
        {revision != null && (
          <span>
            修订 #{revision}
            {updatedAtMs != null && ` · 更新于 ${formatTimestamp(updatedAtMs)}`}
          </span>
        )}
        <button
          type="button"
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
          onClick={onReload}
          disabled={reloading}
        >
          {reloading ? '刷新中…' : '刷新'}
        </button>
      </div>
    </header>
  )
}
