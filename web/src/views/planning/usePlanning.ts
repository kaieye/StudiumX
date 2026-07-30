/**
 * Data hook for the web planning view.
 *
 * Wraps `window.teachingSystem.readStudyPlanning` / `applyStudyPlanning` and
 * keeps a local { snapshot, revision } mirror so the UI can render instantly
 * and pass `expectedRevision` for CAS. On a `revision_conflict` (server changed
 * between read and write, or a concurrent writer won the CAS PUT) it surfaces a
 * conflict notice and auto-refetches the latest snapshot so the user can retry.
 *
 * A `busy` guard serializes applies: action buttons are disabled while a
 * command is in flight, preventing stale-`expectedRevision` double-submits.
 */

import { useCallback, useEffect, useState } from 'react'
import type {
  StudyPlanningCommandEnvelope,
  StudyPlanningSnapshotV1
} from '@shared/study-planning'

export type PlanningState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: StudyPlanningSnapshotV1; revision: number }
  | { status: 'error'; message: string }

export type ConflictNotice = { message: string; serverRevision: number }

export type ApplyOutcome =
  | { ok: true }
  | { ok: false; conflict: true; message: string }
  | { ok: false; conflict: false; message: string }

export interface UsePlanning {
  state: PlanningState
  conflict: ConflictNotice | null
  busy: boolean
  reload: () => Promise<void>
  /** Apply one command against the current revision; updates local mirror on success. */
  apply: (command: StudyPlanningCommandEnvelope) => Promise<ApplyOutcome>
  dismissConflict: () => void
}

export function usePlanning(workspaceRoot: string): UsePlanning {
  const [state, setState] = useState<PlanningState>({ status: 'loading' })
  const [conflict, setConflict] = useState<ConflictNotice | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const res = await window.teachingSystem.readStudyPlanning({ workspaceRoot })
      if (!res.ok) {
        setState({ status: 'error', message: res.error.message })
        return
      }
      setState({ status: 'ready', snapshot: res.snapshot, revision: res.snapshot.revision })
      setConflict(null)
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }, [workspaceRoot])

  useEffect(() => {
    void reload()
  }, [reload])

  const apply = useCallback(
    async (command: StudyPlanningCommandEnvelope): Promise<ApplyOutcome> => {
      // Snapshot the revision at call time to avoid stale-closure races.
      const base = state
      if (base.status !== 'ready') {
        return { ok: false, conflict: false, message: '学习计划尚未就绪，请稍候。' }
      }
      if (busy) {
        return { ok: false, conflict: false, message: '正在处理上一项操作，请稍候。' }
      }
      setBusy(true)
      try {
        const res = await window.teachingSystem.applyStudyPlanning({
          workspaceRoot,
          expectedRevision: base.revision,
          command
        })
        if (res.ok) {
          setState({ status: 'ready', snapshot: res.snapshot, revision: res.revision })
          setConflict(null)
          return { ok: true }
        }
        if (res.error.code === 'revision_conflict') {
          setConflict({
            message: res.error.message,
            serverRevision: res.revision
          })
          // Auto-refetch the authoritative server snapshot so retry uses fresh data.
          void reload()
          return { ok: false, conflict: true, message: res.error.message }
        }
        return { ok: false, conflict: false, message: res.error.message }
      } catch (err) {
        return {
          ok: false,
          conflict: false,
          message: err instanceof Error ? err.message : String(err)
        }
      } finally {
        setBusy(false)
      }
    },
    [state, busy, workspaceRoot, reload]
  )

  const dismissConflict = useCallback(() => setConflict(null), [])

  return { state, conflict, busy, reload, apply, dismissConflict }
}
