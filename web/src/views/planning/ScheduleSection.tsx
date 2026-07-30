/**
 * Schedule block list + add/delete for the web planning view.
 *
 * Mutations via `onApply` (-> usePlanning -> adapter -> server CAS). Reducer
 * semantics (study-planning-store.ts):
 *  - upsert_schedule_block: { block: ScheduleBlock, hostTimeZone? } (validates
 *    interval/kind/timeZone; stamps host zone only when the block has none).
 *  - delete_schedule_block: { blockId } (refuses locked blocks).
 */

import { useMemo, useState } from 'react'
import type {
  PlanningTask,
  ScheduleBlock,
  ScheduleBlockKind,
  StudyPlanningCommandEnvelope
} from '@shared/study-planning'
import type { ApplyOutcome } from './usePlanning'
import {
  BLOCK_KIND_LABEL,
  BLOCK_STATUS_LABEL,
  datetimeLocalToMs,
  formatBlockRange,
  makeCommand,
  newId,
  userTimeZone
} from './planningUi'

interface ScheduleSectionProps {
  blocks: ScheduleBlock[]
  tasks: PlanningTask[]
  busy: boolean
  onApply: (command: StudyPlanningCommandEnvelope) => Promise<ApplyOutcome>
}

interface AddBlockFields {
  taskId: string
  kind: ScheduleBlockKind
  start: string
  end: string
}

const EMPTY_FIELDS: AddBlockFields = {
  taskId: '',
  kind: 'focus',
  start: '',
  end: ''
}

export function ScheduleSection({ blocks, tasks, busy, onApply }: ScheduleSectionProps) {
  const [fields, setFields] = useState<AddBlockFields>(EMPTY_FIELDS)
  const [notice, setNotice] = useState<string | null>(null)

  const sorted = useMemo(
    () => [...blocks].sort((a, b) => a.startAtMs - b.startAtMs),
    [blocks]
  )
  const taskTitleById = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tasks) map.set(t.id, t.title)
    return map
  }, [tasks])

  async function run(command: StudyPlanningCommandEnvelope, reset?: () => void): Promise<void> {
    setNotice(null)
    const outcome = await onApply(command)
    if (outcome.ok) {
      reset?.()
      return
    }
    if (outcome.conflict) return
    setNotice(outcome.message)
  }

  async function handleAdd(): Promise<void> {
    const startMs = datetimeLocalToMs(fields.start)
    const endMs = datetimeLocalToMs(fields.end)
    if (startMs == null || endMs == null) {
      setNotice('请填写开始与结束时间。')
      return
    }
    if (endMs <= startMs) {
      setNotice('结束时间必须晚于开始时间。')
      return
    }
    const block: ScheduleBlock = {
      id: newId('block'),
      taskId: fields.taskId || null,
      kind: fields.kind,
      startAtMs: startMs,
      endAtMs: endMs,
      locked: false,
      source: 'manual',
      status: 'planned',
      revision: 1
    }
    await run(
      makeCommand('upsert_schedule_block', { block, hostTimeZone: userTimeZone() }),
      () => setFields(EMPTY_FIELDS)
    )
  }

  async function remove(block: ScheduleBlock): Promise<void> {
    await run(makeCommand('delete_schedule_block', { blockId: block.id }))
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">日程安排</h2>
        <span className="text-sm text-neutral-500">{blocks.length} 个时间段</span>
      </div>

      {notice && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{notice}</p>
      )}

      {/* Add form */}
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label>
          <span className="block text-xs text-neutral-500">关联任务（可选）</span>
          <select
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            value={fields.taskId}
            onChange={(e) => setFields({ ...fields, taskId: e.target.value })}
            disabled={busy}
          >
            <option value="">无</option>
            {tasks
              .filter((t) => t.status === 'open')
              .map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-neutral-500">类型</span>
          <select
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            value={fields.kind}
            onChange={(e) => setFields({ ...fields, kind: e.target.value as ScheduleBlockKind })}
            disabled={busy}
          >
            {(Object.keys(BLOCK_KIND_LABEL) as ScheduleBlockKind[]).map((k) => (
              <option key={k} value={k}>{BLOCK_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-neutral-500">开始</span>
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            value={fields.start}
            onChange={(e) => setFields({ ...fields, start: e.target.value })}
            disabled={busy}
          />
        </label>
        <label>
          <span className="block text-xs text-neutral-500">结束</span>
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            value={fields.end}
            onChange={(e) => setFields({ ...fields, end: e.target.value })}
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className="self-end rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void handleAdd()}
          disabled={busy || !fields.start || !fields.end}
        >
          添加
        </button>
      </div>

      {/* List */}
      {sorted.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-400">暂无日程，添加一个时间段来规划你的学习。</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sorted.map((block) => (
            <li key={block.id} className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
              <span className="rounded-md bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-700">
                {BLOCK_KIND_LABEL[block.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-800">
                  {formatBlockRange(block.startAtMs, block.endAtMs)}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  {block.taskId && (
                    <span>任务：{taskTitleById.get(block.taskId) ?? block.taskId}</span>
                  )}
                  <span>{BLOCK_STATUS_LABEL[block.status]}</span>
                  {block.locked && <span className="text-amber-600">已锁定</span>}
                </div>
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                onClick={() => void remove(block)}
                disabled={busy || block.locked}
                title={block.locked ? '锁定的时间段不可删除' : '删除'}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

