/**
 * Web study-planning view (plan §8 Phase 5 / §7.1).
 *
 * Reads the plan snapshot via `window.teachingSystem.readStudyPlanning` and
 * lets the user add/edit/complete/reopen/delete tasks and add/delete schedule
 * blocks via `window.teachingSystem.applyStudyPlanning` (command envelope +
 * expectedRevision CAS). The adapter reduces commands client-side and CAS-PUTs
 * the whole snapshot to the server; a 409 / stale-revision conflict triggers a
 * clear re-fetch + notify UX (see `usePlanning`).
 *
 * Scope: tasks + schedule blocks. Timer plans/sessions, recurrence expansion,
 * classification prompts and V1 migration banners are desktop study-room
 * concerns (P5a) and intentionally out of scope here (see report TODOs).
 */

import { PlanningViewHeader } from './PlanningViewHeader'
import { TaskSection } from './TaskSection'
import { ScheduleSection } from './ScheduleSection'
import { usePlanning } from './usePlanning'
import { WEB_WORKSPACE_ROOT } from './planningUi'

export function PlanningView() {
  const { state, conflict, busy, reload, apply, dismissConflict } = usePlanning(WEB_WORKSPACE_ROOT)

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <PlanningViewHeader
        revision={state.status === 'ready' ? state.revision : null}
        updatedAtMs={state.status === 'ready' ? state.snapshot.updatedAtMs : null}
        onReload={() => void reload()}
        reloading={state.status === 'loading'}
      />

      {conflict && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <div>
            <p className="font-medium">学习计划已被另一端更新</p>
            <p className="mt-0.5 text-amber-700">
              已自动拉取最新版本（服务器修订 #{conflict.serverRevision}）。请重新尝试你的操作。
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-amber-400 px-2 py-1 text-xs text-amber-800 hover:bg-amber-100"
            onClick={dismissConflict}
          >
            知道了
          </button>
        </div>
      )}

      {state.status === 'loading' && (
        <p className="mt-6 text-sm text-neutral-500">正在加载学习计划…</p>
      )}

      {state.status === 'error' && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-medium">加载失败</p>
          <p className="mt-0.5">{state.message}</p>
          <button
            type="button"
            className="mt-2 rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-100"
            onClick={() => void reload()}
          >
            重试
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <div className={`mt-5 space-y-5 ${busy ? 'pointer-events-none opacity-70' : ''}`}>
          <TaskSection tasks={state.snapshot.tasks} busy={busy} onApply={apply} />
          <ScheduleSection
            blocks={state.snapshot.scheduleBlocks}
            tasks={state.snapshot.tasks}
            busy={busy}
            onApply={apply}
          />
        </div>
      )}
    </main>
  )
}
