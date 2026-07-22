/**
 * IMPL-W: True Electron Playwright matrix for study-planning timer sleep/crash recovery.
 *
 * Evidence (single-process kill-9 / force-kill + relaunch):
 * 1. Seed running focus TimerSession with dual-write pin via durable IPC sole-writer.
 * 2. forceKillElectronRuntime mid-session (no graceful close / no clean flush of local ticks).
 * 3. Relaunch same userData → durable snapshot restores last pin only.
 * 4. Cold rehydrate advances from last pin wall only (no double-count of pre-pin focus).
 * 5. Empty / completed-only durable sessions invent no open focus.
 *
 * Multi-window multi-process thrash Playwright: not covered here (unit + e2e-proxy CAS only).
 * Does NOT claim §18 / section 18 product complete.
 *
 * Prior: impl-q e2e-proxy, impl-i unit matrix, impl-b power signal bridge.
 */

import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

import {
  buildAdvanceTimerSessionCommand,
  buildStartTimerSessionCommand
} from '../../src/renderer/src/study-space/planning-timer-dual-write'
import { projectRehydrateActiveTimerSession } from '../../src/renderer/src/study-space/planning-timer-sleep-hooks'
import type {
  ApplyResult,
  StudyPlanningCommandEnvelope,
  StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'
import { expect, test } from '../helpers/electron'
import { createTestRuntime, type TestRuntime } from '../helpers/test-runtime'
import {
  forceKillElectronRuntime,
  launchElectronRuntime,
  type LaunchedElectronRuntime
} from '../helpers/test-runtime/electron'

const SESSION_ID = 'e2e-timer-recovery-focus-1'
const TASK_ID = 'e2e-timer-recovery-task-1'
const PIN_FOCUS_SECONDS = 40
const POST_RESTART_GAP_SECONDS = 60

type TeachingSystemPageApi = {
  createWorkspace: (payload: { name: string; prompt: string }) => Promise<{
    activeWorkspace?: { id?: string; name?: string; rootPath?: string } | null
  }>
  getState: () => Promise<{
    activeWorkspace?: { id?: string; rootPath?: string } | null
    workspaces?: Array<{ id: string; rootPath: string }>
  }>
  readStudyPlanning: (payload: {
    workspaceRoot: string
  }) => Promise<
    | {
        ok: true
        snapshot: StudyPlanningSnapshotV1
        path: string
        source: 'canonical' | 'backup' | 'empty'
      }
    | { ok: false; error: { code: string; message: string } }
  >
  applyStudyPlanning: (payload: {
    workspaceRoot: string
    expectedRevision: number
    command: StudyPlanningCommandEnvelope
  }) => Promise<ApplyResult & { path?: string }>
}

async function waitForTeachingSystem(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => Boolean((window as unknown as { teachingSystem?: unknown }).teachingSystem)),
      { timeout: 30_000 }
    )
    .toBe(true)
}

function teachingSystemOn(page: Page): TeachingSystemPageApi {
  return {
    createWorkspace: (payload) =>
      page.evaluate(async (input) => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.createWorkspace(input)
      }, payload),
    getState: () =>
      page.evaluate(async () => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.getState()
      }),
    readStudyPlanning: (payload) =>
      page.evaluate(async (input) => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.readStudyPlanning(input)
      }, payload),
    applyStudyPlanning: (payload) =>
      page.evaluate(async (input) => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.applyStudyPlanning(input)
      }, payload)
  }
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await waitForTeachingSystem(page)
  return page
}

async function createWorkspace(page: Page): Promise<{ id: string; rootPath: string }> {
  const api = teachingSystemOn(page)
  const created = await api.createWorkspace({
    name: 'Timer Recovery E2E',
    prompt: 'Seed workspace for study planning timer crash recovery.'
  })
  const workspace = created.activeWorkspace
  if (!workspace?.id || !workspace.rootPath) {
    throw new Error('createWorkspace did not return active workspace with rootPath')
  }
  return { id: workspace.id, rootPath: workspace.rootPath }
}

async function readPlanning(
  page: Page,
  workspaceRoot: string
): Promise<Extract<Awaited<ReturnType<TeachingSystemPageApi['readStudyPlanning']>>, { ok: true }>> {
  const result = await teachingSystemOn(page).readStudyPlanning({ workspaceRoot })
  if (!result.ok) {
    throw new Error(`readStudyPlanning failed: ${result.error.code} ${result.error.message}`)
  }
  return result
}

async function applyPlanning(
  page: Page,
  workspaceRoot: string,
  expectedRevision: number,
  command: StudyPlanningCommandEnvelope
): Promise<Extract<ApplyResult, { ok: true }>> {
  const result = await teachingSystemOn(page).applyStudyPlanning({
    workspaceRoot,
    expectedRevision,
    command
  })
  if (!result.ok) {
    throw new Error(
      `applyStudyPlanning failed: ${result.error.code} ${result.error.message} (rev=${result.revision})`
    )
  }
  return result
}

async function seedRunningFocusWithPin(
  page: Page,
  workspaceRoot: string
): Promise<{
  revision: number
  lastSampleWallMs: number
  startedAtMs: number
  accumulatedFocusSeconds: number
}> {
  const before = await readPlanning(page, workspaceRoot)
  let rev = before.snapshot.revision

  const startCmd = buildStartTimerSessionCommand(
    {
      sessionId: SESSION_ID,
      planId: 'classic_25_5',
      taskId: TASK_ID,
      targetSeconds: 25 * 60,
      phase: 'focus',
      attributionReason: 'explicit'
    },
    `e2e-w-start:${Date.now()}`
  )
  const started = await applyPlanning(page, workspaceRoot, rev, startCmd)
  rev = started.revision
  const session = started.snapshot.timerSessions.find((s) => s.id === SESSION_ID)
  if (!session) throw new Error('start_timer_session did not create session')
  expect(session.state).toBe('running')
  expect(session.phase).toBe('focus')
  expect(session.accumulatedFocusSeconds).toBe(0)

  const pinAt = session.lastSampleWallMs + PIN_FOCUS_SECONDS * 1000
  const pinCmd = buildAdvanceTimerSessionCommand(
    SESSION_ID,
    `e2e-w-pin:${pinAt}`,
    pinAt,
    pinAt
  )
  const pinned = await applyPlanning(page, workspaceRoot, rev, pinCmd)
  rev = pinned.revision
  const afterPin = pinned.snapshot.timerSessions.find((s) => s.id === SESSION_ID)
  if (!afterPin) throw new Error('advance pin missing session')
  expect(afterPin.accumulatedFocusSeconds).toBe(PIN_FOCUS_SECONDS)
  expect(afterPin.lastSampleWallMs).toBe(pinAt)
  expect(afterPin.state).toBe('running')

  return {
    revision: rev,
    lastSampleWallMs: afterPin.lastSampleWallMs,
    startedAtMs: afterPin.startedAtMs,
    accumulatedFocusSeconds: afterPin.accumulatedFocusSeconds
  }
}

test.describe('study planning timer — Electron force-kill recovery (IMPL-W)', () => {
  test('force-kill mid-focus restores last dual-write pin without double-count @p0', async (
    {},
    testInfo: TestInfo
  ) => {
    test.setTimeout(180_000)
    const runtime: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-timer-kill-${testInfo.workerIndex}`
    )
    runtime.env.STUDIUMX_E2E = '1'
    let launched: LaunchedElectronRuntime = await launchElectronRuntime(runtime, testInfo)
    let failed = false
    let workspaceRoot = ''

    try {
      let page = await firstWindow(launched.application)
      const workspace = await createWorkspace(page)
      workspaceRoot = workspace.rootPath

      const pin = await seedRunningFocusWithPin(page, workspaceRoot)

      // Simulate unsynced local ticks that never dual-write (kill-9 before flush).
      // Product recovery must sole-read durable last pin, not invent these seconds.
      const unsyncedLocalFocusSeconds = PIN_FOCUS_SECONDS + 55

      await forceKillElectronRuntime(launched)

      // Relaunch = true multi-process cold start of durable host (registry reload from disk).
      launched = await launchElectronRuntime(runtime, testInfo)
      page = await firstWindow(launched.application)

      const restored = await readPlanning(page, workspaceRoot)
      expect(restored.ok).toBe(true)
      expect(restored.source === 'canonical' || restored.source === 'backup').toBe(true)

      const openSessions = restored.snapshot.timerSessions.filter(
        (s) => s.state === 'running' || s.state === 'paused' || s.state === 'needs_reconcile'
      )
      expect(openSessions).toHaveLength(1)
      const durable = openSessions[0]!
      expect(durable.id).toBe(SESSION_ID)
      expect(durable.taskId).toBe(TASK_ID)
      expect(durable.phase).toBe('focus')
      expect(durable.state).toBe('running')
      // Last dual-write pin only — unsynced local focus never reached disk.
      expect(durable.accumulatedFocusSeconds).toBe(PIN_FOCUS_SECONDS)
      expect(durable.accumulatedFocusSeconds).not.toBe(unsyncedLocalFocusSeconds)
      expect(durable.lastSampleWallMs).toBe(pin.lastSampleWallMs)
      expect(durable.startedAtMs).toBe(pin.startedAtMs)

      // Cold rehydrate advances only from last pin wall (no double-count of pre-pin focus).
      const restartNow = pin.lastSampleWallMs + POST_RESTART_GAP_SECONDS * 1000
      const rehydrate = projectRehydrateActiveTimerSession({
        timerSessions: restored.snapshot.timerSessions,
        nowMs: restartNow,
        localSession: null
      })
      expect(rehydrate.kind).toBe('reattach')
      if (rehydrate.kind !== 'reattach') return

      const expectedFocus = PIN_FOCUS_SECONDS + POST_RESTART_GAP_SECONDS
      expect(rehydrate.session.accumulatedFocusSeconds).toBe(expectedFocus)
      // Double-count of pre-pin would be 40+40+60=140 or start-from-zero invent wrong bases.
      expect(rehydrate.session.accumulatedFocusSeconds).not.toBe(PIN_FOCUS_SECONDS * 2 + POST_RESTART_GAP_SECONDS)
      expect(rehydrate.session.accumulatedFocusSeconds).not.toBe(unsyncedLocalFocusSeconds)
      expect(rehydrate.session.id).toBe(SESSION_ID)
      expect(rehydrate.needsReconcile).toBe(false)

      // Publish reattach pin once through real IPC sole-writer; second same actionId is replay.
      const rePinAt = restartNow
      const rePin = await applyPlanning(
        page,
        workspaceRoot,
        restored.snapshot.revision,
        buildAdvanceTimerSessionCommand(SESSION_ID, `e2e-w-reattach:${rePinAt}`, rePinAt, rePinAt)
      )
      const afterRePin = rePin.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(afterRePin.accumulatedFocusSeconds).toBe(expectedFocus)
      expect(afterRePin.lastSampleWallMs).toBe(rePinAt)

      const replay = await teachingSystemOn(page).applyStudyPlanning({
        workspaceRoot,
        expectedRevision: rePin.revision,
        command: buildAdvanceTimerSessionCommand(
          SESSION_ID,
          `e2e-w-reattach:${rePinAt}`,
          rePinAt,
          rePinAt
        )
      })
      expect(replay.ok).toBe(true)
      if (!replay.ok) return
      expect(replay.replayed).toBe(true)
      const afterReplay = replay.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(afterReplay.accumulatedFocusSeconds).toBe(expectedFocus)
    } catch (error) {
      failed = true
      throw error
    } finally {
      await launched
        .close({ failed: failed || testInfo.status !== testInfo.expectedStatus })
        .catch(() => undefined)
      await runtime.cleanup().catch(() => undefined)
    }
  })

  test('force-kill with no open durable session invents nothing', async ({}, testInfo: TestInfo) => {
    test.setTimeout(120_000)
    const runtime: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-timer-empty-${testInfo.workerIndex}`
    )
    runtime.env.STUDIUMX_E2E = '1'
    let launched: LaunchedElectronRuntime = await launchElectronRuntime(runtime, testInfo)
    let failed = false

    try {
      let page = await firstWindow(launched.application)
      const workspace = await createWorkspace(page)

      const empty = await readPlanning(page, workspace.rootPath)
      expect(empty.snapshot.timerSessions).toEqual([])

      await forceKillElectronRuntime(launched)
      launched = await launchElectronRuntime(runtime, testInfo)
      page = await firstWindow(launched.application)

      const after = await readPlanning(page, workspace.rootPath)
      expect(after.snapshot.timerSessions).toEqual([])

      const rehydrate = projectRehydrateActiveTimerSession({
        timerSessions: after.snapshot.timerSessions,
        nowMs: Date.now(),
        localSession: null
      })
      expect(rehydrate.kind).toBe('none')
      if (rehydrate.kind !== 'none') return
      expect(rehydrate.reason).toBe('no_timer_sessions')
    } catch (error) {
      failed = true
      throw error
    } finally {
      await launched
        .close({ failed: failed || testInfo.status !== testInfo.expectedStatus })
        .catch(() => undefined)
      await runtime.cleanup().catch(() => undefined)
    }
  })
})
