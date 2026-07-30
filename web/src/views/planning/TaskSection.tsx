/**
 * Task list + add/edit/complete/reopen/delete for the web planning view.
 *
 * All mutations go through `onApply` (-> usePlanning -> adapter -> server CAS).
 * The reducer semantics (porting-features.md §0 / study-planning-store.ts):
 *  - create_task: { id, title, categoryId?, splittable? } (estimate set via update)
 *  - update_task: { id, title?, categoryId?, estimateMinutes? }
 *  - complete_task / reopen_task / delete_task: { id } (delete = soft cancel)
 */

import { useState } from 'react'
import type {
  PlanningTask,
  StudyPlanningCommandEnvelope
} from '@shared/study-planning'
import type { ApplyOutcome } from './usePlanning'
import {
  BUILTIN_CATEGORIES,
  TASK_STATUS_LABEL,
  categoryColor,
  categoryLabel,
  formatMinutes,
  formatTimestamp,
  makeCommand,
  newId
} from './planningUi'

interface TaskSectionProps {
  tasks: PlanningTask[]
  busy: boolean
  onApply: (command: StudyPlanningCommandEnvelope) => Promise<ApplyOutcome>
}

interface AddFields {
  title: string
  categoryId: string
  splittable: boolean
}

interface EditFields {
  title: string
  categoryId: string
  estimateMinutes: string
}

const EMPTY_ADD: AddFields = { title: '', categoryId: 'study', splittable: true }

export function TaskSection({ tasks, busy, onApply }: TaskSectionProps) {
  const [add, setAdd] = useState<AddFields>(EMPTY_ADD)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edit, setEdit] = useState<EditFields>({ title: '', categoryId: 'study', estimateMinutes: '' })
  const [notice, setNotice] = useState<string | null>(null)

  const openTasks = tasks.filter((t) => t.status === 'open')
  const doneTasks = tasks.filter((t) => t.status === 'done')
  const cancelledCount = tasks.filter((t) => t.status === 'cancelled').length

  async function run(command: StudyPlanningCommandEnvelope, reset?: () => void): Promise<void> {
    setNotice(null)
    const outcome = await onApply(command)
    if (outcome.ok) {
      reset?.()
      return
    }
    if (outcome.conflict) return // conflict banner is shown by PlanningView
    setNotice(outcome.message)
  }

  async function handleAdd(): Promise<void> {
    const title = add.title.trim()
    if (!title) {
      setNotice('请输入任务标题。')
      return
    }
    await run(
      makeCommand('create_task', {
        id: newId('task'),
        title,
        categoryId: add.categoryId || null,
        splittable: add.splittable
      }),
      () => setAdd(EMPTY_ADD)
    )
  }

  function beginEdit(task: PlanningTask): void {
    setEditingId(task.id)
    setEdit({
      title: task.title,
      categoryId: task.categoryId ?? '',
      estimateMinutes:
        task.estimateMinutes != null ? String(task.estimateMinutes) : ''
    })
    setNotice(null)
  }

  async function saveEdit(task: PlanningTask): Promise<void> {
    const title = edit.title.trim()
    if (!title) {
      setNotice('任务标题不能为空。')
      return
    }
    const estimateRaw = edit.estimateMinutes.trim()
    const estimateMinutes =
      estimateRaw === '' ? null : Number(estimateRaw)
    if (estimateRaw !== '' && (!Number.isFinite(estimateMinutes) || (estimateMinutes as number) < 0)) {
      setNotice('预估时长需为非负数字（分钟）。')
      return
    }
    await run(
      makeCommand('update_task', {
        id: task.id,
        title,
        categoryId: edit.categoryId || null,
        estimateMinutes
      }),
      () => setEditingId(null)
    )
  }

  async function toggleComplete(task: PlanningTask): Promise<void> {
    await run(
      makeCommand(task.status === 'open' ? 'complete_task' : 'reopen_task', { id: task.id })
    )
  }

  async function remove(task: PlanningTask): Promise<void> {
    await run(makeCommand('delete_task', { id: task.id }))
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">任务</h2>
        <span className="text-sm text-neutral-500">{openTasks.length} 进行中 · {doneTasks.length} 已完成</span>
      </div>

      {notice && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{notice}</p>
      )}

      {/* Add form */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[180px]">
          <span className="block text-xs text-neutral-500">新任务标题</span>
          <input
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            value={add.title}
            onChange={(e) => setAdd({ ...add, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAdd()
            }}
            placeholder="例如：复习高数第三章"
            disabled={busy}
          />
        </label>
        <label>
          <span className="block text-xs text-neutral-500">分类</span>
          <select
            className="mt-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
            value={add.categoryId}
            onChange={(e) => setAdd({ ...add, categoryId: e.target.value })}
            disabled={busy}
          >
            <option value="">收件箱</option>
            {BUILTIN_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={add.splittable}
            onChange={(e) => setAdd({ ...add, splittable: e.target.checked })}
            disabled={busy}
          />
          可拆分
        </label>
        <button
          type="button"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void handleAdd()}
          disabled={busy || !add.title.trim()}
        >
          添加
        </button>
      </div>

      {/* Open tasks */}
      <ul className="mt-5 space-y-2">
        {openTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            busy={busy}
            editing={editingId === task.id}
            edit={edit}
            onBeginEdit={() => beginEdit(task)}
            onCancelEdit={() => setEditingId(null)}
            onChangeEdit={setEdit}
            onSave={() => void saveEdit(task)}
            onToggleComplete={() => void toggleComplete(task)}
            onDelete={() => void remove(task)}
          />
        ))}
      </ul>

      {openTasks.length === 0 && (
        <p className="mt-4 text-sm text-neutral-400">暂无进行中的任务，添加一个开始吧。</p>
      )}

      {/* Done tasks */}
      {doneTasks.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-medium text-neutral-500">已完成</h3>
          <ul className="mt-2 space-y-2">
            {doneTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                busy={busy}
                editing={editingId === task.id}
                edit={edit}
                onBeginEdit={() => beginEdit(task)}
                onCancelEdit={() => setEditingId(null)}
                onChangeEdit={setEdit}
                onSave={() => void saveEdit(task)}
                onToggleComplete={() => void toggleComplete(task)}
                onDelete={() => void remove(task)}
              />
            ))}
          </ul>
        </>
      )}

      {cancelledCount > 0 && (
        <p className="mt-4 text-xs text-neutral-400">另有 {cancelledCount} 个已取消任务已隐藏。</p>
      )}
    </section>
  )
}

interface TaskRowProps {
  task: PlanningTask
  busy: boolean
  editing: boolean
  edit: EditFields
  onBeginEdit: () => void
  onCancelEdit: () => void
  onChangeEdit: (next: EditFields) => void
  onSave: () => void
  onToggleComplete: () => void
  onDelete: () => void
}

function TaskRow({
  task,
  busy,
  editing,
  edit,
  onBeginEdit,
  onCancelEdit,
  onChangeEdit,
  onSave,
  onToggleComplete,
  onDelete
}: TaskRowProps) {
  if (editing) {
    return (
      <li className="rounded-lg border border-neutral-300 bg-neutral-50 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[160px]">
            <span className="block text-xs text-neutral-500">标题</span>
            <input
              className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              value={edit.title}
              onChange={(e) => onChangeEdit({ ...edit, title: e.target.value })}
              disabled={busy}
            />
          </label>
          <label>
            <span className="block text-xs text-neutral-500">分类</span>
            <select
              className="mt-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              value={edit.categoryId}
              onChange={(e) => onChangeEdit({ ...edit, categoryId: e.target.value })}
              disabled={busy}
            >
              <option value="">收件箱</option>
              {BUILTIN_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="block text-xs text-neutral-500">预估(分钟)</span>
            <input
              className="mt-1 w-24 rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none"
              type="number"
              min={0}
              value={edit.estimateMinutes}
              onChange={(e) => onChangeEdit({ ...edit, estimateMinutes: e.target.value })}
              disabled={busy}
            />
          </label>
          <button type="button" className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50" onClick={onSave} disabled={busy}>保存</button>
          <button type="button" className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50" onClick={onCancelEdit} disabled={busy}>取消</button>
        </div>
      </li>
    )
  }

  const done = task.status === 'done'
  return (
    <li className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
      <button
        type="button"
        title={done ? '重新打开' : '标记完成'}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${done ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300'} disabled:opacity-50`}
        onClick={onToggleComplete}
        disabled={busy}
      >
        {done && '✓'}
      </button>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${done ? 'text-neutral-400 line-through' : 'text-neutral-800'}`}>{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-white"
            style={{ backgroundColor: categoryColor(task.categoryId) }}
          >
            {categoryLabel(task.categoryId)}
          </span>
          {task.estimateMinutes != null && <span>预估 {formatMinutes(task.estimateMinutes)}</span>}
          {task.dueAtMs != null && <span>截止 {formatTimestamp(task.dueAtMs)}</span>}
          <span>{TASK_STATUS_LABEL[task.status]}</span>
        </div>
      </div>
      <button type="button" className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-50" onClick={onBeginEdit} disabled={busy}>编辑</button>
      <button type="button" className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50" onClick={onDelete} disabled={busy}>删除</button>
    </li>
  )
}
