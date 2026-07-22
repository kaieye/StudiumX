/**
 * IMPL-AA: Multi-writer thrash Electron Playwright evidence (study planning timer).
 *
 * Path A (preferred, landed): dual concurrent durable writers via real Electron IPC
 * within ONE launched process (same userData / same host):
 * 1. createWorkspace via real teachingSystem.createWorkspace
 * 2. seed running focus TimerSession + dual-write pin
 * 3. read expectedRevision once
 * 4. fire two concurrent applyStudyPlanning advances (Promise.all) with the same
 *    expectedRevision and different actionIds / different target walls
 * 5. Assert: exactly one ok; other revision_conflict; winner focus/lastSample intact;
 *    loser retry with fresh revision succeeds and is monotonic (no silent merge)
 *
 * Honesty:
 * - Same-process concurrent IPC thrash != two OS BrowserWindows / two Electron processes.
 * - Product does not expose a study multi-window BrowserWindow API (music login only).
 * - Dual-process Path B not attempted product-side: requestSingleInstanceLock + no
 *   multi-window study surface; do not invent UI or hack single-instance for thrash.
 * - Does NOT claim section 18 product complete.
 * - Does NOT claim multi-window multi-process thrash fully closed (dual-window product N/A).
 *
 * Prior: impl-w force-kill e2e, impl-q product-path thrash proxy (describe 4), impl-i unit CAS.
 */

import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

import {
  buildAdvanceTimerSessionCommand,
  buildStartTimerSessionCommand
} from '../../src/renderer/src/study-space/planning-timer-dual-write'
import type {
  ApplyResult,
  StudyPlanningCommandEnvelope,
  StudyPlanningSnapshotV1
} from '../../src/shared/study-planning'
import { expect, test } from '../helpers/electron'
import { createTestRuntime, type TestRuntime } from '../helpers/test-runtime'
import {
  launchElectronRuntime,
  type LaunchedElectronRuntime
} from '../helpers/test-runtime/electron'

const SESSION_ID = 'e2e-timer-thrash-focus-1'
const TASK_ID = 'e2e-timer-thrash-task-1'
const PIN_FOCUS_SECONDS = 40
/** Window-A advance wall delta from last pin (seconds). */
const WIN_A_DELTA_SECONDS = 50
/** Window-B would invent this wall if it clobbered (seconds from start of pin base). */
const WIN_B_INVENT_SECONDS = 70

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
    name: 'Timer Thrash E2E',
    prompt: 'Seed workspace for study planning timer concurrent IPC thrash.'
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
    `e2e-aa-start:${Date.now()}`
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
    `e2e-aa-pin:${pinAt}`,
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

/**
 * Fire two concurrent applyStudyPlanning IPC invokes from the renderer with the
 * same expectedRevision. Uses a single page.evaluate so both invoke promises are
 * created before either awaits — true host/IPC thrash, not serial unit mock.
 */
async function concurrentAdvances(
  page: Page,
  workspaceRoot: string,
  expectedRevision: number,
  cmdA: StudyPlanningCommandEnvelope,
  cmdB: StudyPlanningCommandEnvelope
): Promise<[ApplyResult & { path?: string }, ApplyResult & { path?: string }]> {
  return page.evaluate(
    async (input) => {
      const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
      return Promise.all([
        api.applyStudyPlanning({
          workspaceRoot: input.workspaceRoot,
          expectedRevision: input.expectedRevision,
          command: input.cmdA
        }),
        api.applyStudyPlanning({
          workspaceRoot: input.workspaceRoot,
          expectedRevision: input.expectedRevision,
          command: input.cmdB
        })
      ])
    },
    { workspaceRoot, expectedRevision, cmdA, cmdB }
  ) as Promise<[ApplyResult & { path?: string }, ApplyResult & { path?: string }]>
}

test.describe('study planning timer — concurrent IPC thrash (IMPL-AA Path A)', () => {
  test('dual concurrent advances same expectedRevision: one ok, one revision_conflict @p0', async (
    {},
    testInfo: TestInfo
  ) => {
    test.setTimeout(180_000)
    const runtime: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-timer-thrash-${testInfo.workerIndex}`
    )
    runtime.env.STUDIUMX_E2E = '1'
    const launched: LaunchedElectronRuntime = await launchElectronRuntime(runtime, testInfo)
    let failed = false

    try {
      const page = await firstWindow(launched.application)
      const workspace = await createWorkspace(page)
      const pin = await seedRunningFocusWithPin(page, workspace.rootPath)

      // Both writers sample from the same durable revision (true concurrent thrash).
      const sharedRev = pin.revision
      const wallA = pin.lastSampleWallMs + WIN_A_DELTA_SECONDS * 1000
      const wallB = pin.startedAtMs + WIN_B_INVENT_SECONDS * 1000 // invent 70s from start if clobber

      const cmdA = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        `e2e-aa-thrash-a:${wallA}`,
        wallA,
        wallA
      )
      const cmdB = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        `e2e-aa-thrash-b:${wallB}`,
        wallB,
        wallB
      )

      const [r0, r1] = await concurrentAdvances(
        page,
        workspace.rootPath,
        sharedRev,
        cmdA,
        cmdB
      )

      const results = [r0, r1]
      const winners = results.filter((r) => r.ok)
      const losers = results.filter((r) => !r.ok)

      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)

      const winner = winners[0]!
      const loser = losers[0]!
      if (!winner.ok || loser.ok) return

      expect(loser.error.code).toBe('revision_conflict')
      expect(loser.revision).toBe(winner.revision)

      const winnerSession = winner.snapshot.timerSessions.find((s) => s.id === SESSION_ID)
      if (!winnerSession) throw new Error('winner snapshot missing session')
      expect(winnerSession.state).toBe('running')
      expect(winnerSession.phase).toBe('focus')

      // Winner is one of the two advances; loser must not have clobbered durable state.
      const winnerIsA = winnerSession.lastSampleWallMs === wallA
      const winnerIsB = winnerSession.lastSampleWallMs === wallB
      expect(winnerIsA || winnerIsB).toBe(true)

      if (winnerIsA) {
        // A advances pin@40s + 50s wall delta -> focus 90; B invent 70 from start would clobber.
        expect(winnerSession.accumulatedFocusSeconds).toBe(PIN_FOCUS_SECONDS + WIN_A_DELTA_SECONDS)
        expect(winnerSession.accumulatedFocusSeconds).not.toBe(WIN_B_INVENT_SECONDS)
        expect(winnerSession.lastSampleWallMs).toBe(wallA)
      } else {
        // B won the race: focus is a single clean advance, not a silent merge of both.
        expect(winnerSession.lastSampleWallMs).toBe(wallB)
        expect(winnerSession.accumulatedFocusSeconds).toBeGreaterThan(PIN_FOCUS_SECONDS)
      }

      // Durable sole-read agrees with winner (no silent merge of both walls).
      const durable = await readPlanning(page, workspace.rootPath)
      expect(durable.snapshot.revision).toBe(winner.revision)
      const durableSession = durable.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(durableSession.accumulatedFocusSeconds).toBe(winnerSession.accumulatedFocusSeconds)
      expect(durableSession.lastSampleWallMs).toBe(winnerSession.lastSampleWallMs)

      // Loser retries with fresh revision — monotonic, no double-count invent.
      const retryWall = Math.max(wallA, wallB) + 20_000
      const retryCmd = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        `e2e-aa-thrash-retry:${retryWall}`,
        retryWall,
        retryWall
      )
      const retry = await applyPlanning(page, workspace.rootPath, winner.revision, retryCmd)
      const afterRetry = retry.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(afterRetry.accumulatedFocusSeconds).toBeGreaterThan(
        winnerSession.accumulatedFocusSeconds
      )
      expect(afterRetry.lastSampleWallMs).toBe(retryWall)
      // Continuous running: focus from startedAt via pure wall sample (no pause).
      const expectedRetryFocus = Math.round((retryWall - pin.startedAtMs) / 1000)
      expect(afterRetry.accumulatedFocusSeconds).toBe(expectedRetryFocus)
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

  test('three-way concurrent thrash: exactly one winner; others revision_conflict', async (
    {},
    testInfo: TestInfo
  ) => {
    test.setTimeout(180_000)
    const runtime: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-timer-thrash3-${testInfo.workerIndex}`
    )
    runtime.env.STUDIUMX_E2E = '1'
    const launched: LaunchedElectronRuntime = await launchElectronRuntime(runtime, testInfo)
    let failed = false

    try {
      const page = await firstWindow(launched.application)
      const workspace = await createWorkspace(page)
      const pin = await seedRunningFocusWithPin(page, workspace.rootPath)
      const sharedRev = pin.revision

      const walls = [20, 35, 55].map((sec) => pin.lastSampleWallMs + sec * 1000)
      const cmds = walls.map((wall, i) =>
        buildAdvanceTimerSessionCommand(
          SESSION_ID,
          `e2e-aa-thrash3-${i}:${wall}`,
          wall,
          wall
        )
      )

      const results = await page.evaluate(
        async (input) => {
          const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
          return Promise.all(
            input.cmds.map((command) =>
              api.applyStudyPlanning({
                workspaceRoot: input.workspaceRoot,
                expectedRevision: input.expectedRevision,
                command
              })
            )
          )
        },
        { workspaceRoot: workspace.rootPath, expectedRevision: sharedRev, cmds }
      )

      const winners = results.filter((r) => r.ok)
      const losers = results.filter((r) => !r.ok)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(2)
      for (const lose of losers) {
        expect(lose.ok).toBe(false)
        if (lose.ok) continue
        expect(lose.error.code).toBe('revision_conflict')
        expect(lose.revision).toBe(winners[0]!.revision)
      }

      const win = winners[0]!
      if (!win.ok) return
      const session = win.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(walls).toContain(session.lastSampleWallMs)
      expect(session.accumulatedFocusSeconds).toBeGreaterThan(PIN_FOCUS_SECONDS)

      // Sole-read matches single winner — no silent merge of three walls.
      const durable = await readPlanning(page, workspace.rootPath)
      expect(durable.snapshot.revision).toBe(win.revision)
      const durableSession = durable.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(durableSession.lastSampleWallMs).toBe(session.lastSampleWallMs)
      expect(durableSession.accumulatedFocusSeconds).toBe(session.accumulatedFocusSeconds)
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
