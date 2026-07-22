/**
 * IMPL-AE: Dual-process Path B thrash Electron Playwright evidence (study planning timer).
 *
 * Path B: two Electron processes with **different** userData dirs (bypasses
 * requestSingleInstanceLock which is per-userData) sharing the **same**
 * workspace root on disk (canonical snapshot.json authority):
 *
 * 1. Launch Electron A; createWorkspace; seed running focus + pin
 * 2. Capture workspace id + rootPath from A
 * 3. Launch Electron B with separate userData; importWorkspacePath(same root)
 *    so B registers the shared workspace without inventing multi-window UI
 * 4. Both read revision (or share number from A); fire concurrent
 *    applyStudyPlanning with same expectedRevision / different actionIds
 * 5. Assert honest sole-writer outcomes:
 *    - exactly one durable winner
 *    - loser revision_conflict (or B reload-and-retry path)
 *    - no silent double-count invent of focus seconds
 *    - durable sole-read matches single winner
 *
 * Honesty:
 * - Different userData is required: same userData second instance quits.
 * - Shared authority is workspace snapshot.json on disk, not userData.
 * - Product does not expose multi-window study BrowserWindow API.
 * - Does NOT claim section 18 product complete.
 * - Dual OS study windows still N/A as product surface.
 *
 * Prior: impl-aa Path A same-process IPC thrash, impl-w force-kill e2e.
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
import type { TeachingAppState } from '../../src/shared/teaching-types'
import { expect, test } from '../helpers/electron'
import { createTestRuntime, type TestRuntime } from '../helpers/test-runtime'
import {
  launchElectronRuntime,
  type LaunchedElectronRuntime
} from '../helpers/test-runtime/electron'

const SESSION_ID = 'e2e-timer-thrash-dual-focus-1'
const TASK_ID = 'e2e-timer-thrash-dual-task-1'
const PIN_FOCUS_SECONDS = 40
const PROC_A_DELTA_SECONDS = 50
const PROC_B_INVENT_SECONDS = 70

type TeachingSystemPageApi = {
  createWorkspace: (payload: { name: string; prompt: string }) => Promise<TeachingAppState>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  importWorkspacePath: (rootPath: string) => Promise<TeachingAppState>
  getState: () => Promise<TeachingAppState>
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
      { timeout: 45_000 }
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
    selectWorkspace: (workspaceId) =>
      page.evaluate(async (id) => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.selectWorkspace(id)
      }, workspaceId),
    importWorkspacePath: (rootPath) =>
      page.evaluate(async (path) => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.importWorkspacePath(path)
      }, rootPath),
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
    name: 'Timer Thrash Dual Process E2E',
    prompt: 'Seed workspace for dual-process study planning thrash Path B.'
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
    `e2e-ae-start:${Date.now()}`
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
    `e2e-ae-pin:${pinAt}`,
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
 * Register the same on-disk workspace root in process B via product
 * importWorkspacePath (no multi-window UI invention).
 */
async function importSharedWorkspace(
  pageB: Page,
  workspaceRoot: string
): Promise<{ id: string; rootPath: string }> {
  const api = teachingSystemOn(pageB)
  const state = await api.importWorkspacePath(workspaceRoot)
  const active = state.activeWorkspace
  if (!active?.id || !active.rootPath) {
    throw new Error('importWorkspacePath did not activate shared workspace')
  }
  // Normalize path comparison for Windows case/separators.
  const imported = active.rootPath.replace(/\\/g, '/').toLowerCase()
  const expected = workspaceRoot.replace(/\\/g, '/').toLowerCase()
  if (imported !== expected) {
    // Prefer match by listing workspaces if active points elsewhere.
    const match = state.workspaces?.find(
      (w) => w.rootPath.replace(/\\/g, '/').toLowerCase() === expected
    )
    if (!match) {
      throw new Error(
        `importWorkspacePath root mismatch: got ${active.rootPath}, expected ${workspaceRoot}`
      )
    }
    const selected = await api.selectWorkspace(match.id)
    const sel = selected.activeWorkspace
    if (!sel?.id || !sel.rootPath) {
      throw new Error('selectWorkspace after import failed')
    }
    return { id: sel.id, rootPath: sel.rootPath }
  }
  return { id: active.id, rootPath: active.rootPath }
}

test.describe('study planning timer — dual-process thrash (IMPL-AE Path B)', () => {
  test('two Electron processes same workspaceRoot: one ok, one revision_conflict @p0', async (
    {},
    testInfo: TestInfo
  ) => {
    test.setTimeout(240_000)

    const runtimeA: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-thrash-dp-a-${testInfo.workerIndex}`
    )
    const runtimeB: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-thrash-dp-b-${testInfo.workerIndex}`
    )
    runtimeA.env.STUDIUMX_E2E = '1'
    runtimeB.env.STUDIUMX_E2E = '1'

    let launchedA: LaunchedElectronRuntime | undefined
    let launchedB: LaunchedElectronRuntime | undefined
    let failed = false

    try {
      // --- Process A: create + seed ---
      launchedA = await launchElectronRuntime(runtimeA, testInfo)
      const pageA = await firstWindow(launchedA.application)
      const workspace = await createWorkspace(pageA)
      const pin = await seedRunningFocusWithPin(pageA, workspace.rootPath)
      const sharedRev = pin.revision

      // --- Process B: different userData, import same workspace root ---
      launchedB = await launchElectronRuntime(runtimeB, testInfo)
      const pageB = await firstWindow(launchedB.application)
      const sharedOnB = await importSharedWorkspace(pageB, workspace.rootPath)

      // B sole-read sees the same durable pin (shared disk authority).
      const readB = await readPlanning(pageB, sharedOnB.rootPath)
      expect(readB.snapshot.revision).toBe(sharedRev)
      const sessionOnB = readB.snapshot.timerSessions.find((s) => s.id === SESSION_ID)
      expect(sessionOnB).toBeTruthy()
      expect(sessionOnB!.accumulatedFocusSeconds).toBe(PIN_FOCUS_SECONDS)
      expect(sessionOnB!.lastSampleWallMs).toBe(pin.lastSampleWallMs)

      // Concurrent advances from two processes with the same expectedRevision.
      const wallA = pin.lastSampleWallMs + PROC_A_DELTA_SECONDS * 1000
      const wallB = pin.startedAtMs + PROC_B_INVENT_SECONDS * 1000

      const cmdA = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        `e2e-ae-thrash-a:${wallA}`,
        wallA,
        wallA
      )
      const cmdB = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        `e2e-ae-thrash-b:${wallB}`,
        wallB,
        wallB
      )

      const applyAPromise = teachingSystemOn(pageA).applyStudyPlanning({
        workspaceRoot: workspace.rootPath,
        expectedRevision: sharedRev,
        command: cmdA
      })
      const applyBPromise = teachingSystemOn(pageB).applyStudyPlanning({
        workspaceRoot: sharedOnB.rootPath,
        expectedRevision: sharedRev,
        command: cmdB
      })

      const [rA, rB] = await Promise.all([applyAPromise, applyBPromise])
      const results = [rA, rB]
      const winners = results.filter((r) => r.ok)
      const losers = results.filter((r) => !r.ok)

      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)

      const winner = winners[0]!
      const loser = losers[0]!
      if (!winner.ok || loser.ok) return

      // Honest sole-writer: loser must surface revision_conflict (not silent clobber).
      expect(loser.error.code).toBe('revision_conflict')
      expect(loser.revision).toBe(winner.revision)

      const winnerSession = winner.snapshot.timerSessions.find((s) => s.id === SESSION_ID)
      if (!winnerSession) throw new Error('winner snapshot missing session')
      expect(winnerSession.state).toBe('running')
      expect(winnerSession.phase).toBe('focus')

      const winnerIsA = winnerSession.lastSampleWallMs === wallA
      const winnerIsB = winnerSession.lastSampleWallMs === wallB
      expect(winnerIsA || winnerIsB).toBe(true)

      if (winnerIsA) {
        expect(winnerSession.accumulatedFocusSeconds).toBe(PIN_FOCUS_SECONDS + PROC_A_DELTA_SECONDS)
        expect(winnerSession.accumulatedFocusSeconds).not.toBe(PROC_B_INVENT_SECONDS)
        expect(winnerSession.lastSampleWallMs).toBe(wallA)
      } else {
        expect(winnerSession.lastSampleWallMs).toBe(wallB)
        expect(winnerSession.accumulatedFocusSeconds).toBeGreaterThan(PIN_FOCUS_SECONDS)
      }

      // Durable sole-read from BOTH processes matches single winner (no silent merge).
      const durableA = await readPlanning(pageA, workspace.rootPath)
      const durableB = await readPlanning(pageB, sharedOnB.rootPath)
      expect(durableA.snapshot.revision).toBe(winner.revision)
      expect(durableB.snapshot.revision).toBe(winner.revision)

      const durableSessionA = durableA.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      const durableSessionB = durableB.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(durableSessionA.accumulatedFocusSeconds).toBe(winnerSession.accumulatedFocusSeconds)
      expect(durableSessionA.lastSampleWallMs).toBe(winnerSession.lastSampleWallMs)
      expect(durableSessionB.accumulatedFocusSeconds).toBe(winnerSession.accumulatedFocusSeconds)
      expect(durableSessionB.lastSampleWallMs).toBe(winnerSession.lastSampleWallMs)

      // Loser retries with fresh revision from the other process — monotonic.
      const loserPage = rA.ok ? pageB : pageA
      const loserRoot = rA.ok ? sharedOnB.rootPath : workspace.rootPath
      const retryWall = Math.max(wallA, wallB) + 20_000
      const retryCmd = buildAdvanceTimerSessionCommand(
        SESSION_ID,
        `e2e-ae-thrash-retry:${retryWall}`,
        retryWall,
        retryWall
      )
      const retry = await applyPlanning(loserPage, loserRoot, winner.revision, retryCmd)
      const afterRetry = retry.snapshot.timerSessions.find((s) => s.id === SESSION_ID)!
      expect(afterRetry.accumulatedFocusSeconds).toBeGreaterThan(
        winnerSession.accumulatedFocusSeconds
      )
      expect(afterRetry.lastSampleWallMs).toBe(retryWall)
      const expectedRetryFocus = Math.round((retryWall - pin.startedAtMs) / 1000)
      expect(afterRetry.accumulatedFocusSeconds).toBe(expectedRetryFocus)

      // Winner process sole-read also sees the retry (shared disk authority).
      const winnerPage = rA.ok ? pageA : pageB
      const winnerRoot = rA.ok ? workspace.rootPath : sharedOnB.rootPath
      const afterRetryOnWinner = await readPlanning(winnerPage, winnerRoot)
      expect(afterRetryOnWinner.snapshot.revision).toBe(retry.revision)
      const sessionOnWinner = afterRetryOnWinner.snapshot.timerSessions.find(
        (s) => s.id === SESSION_ID
      )!
      expect(sessionOnWinner.accumulatedFocusSeconds).toBe(expectedRetryFocus)
      expect(sessionOnWinner.lastSampleWallMs).toBe(retryWall)
    } catch (error) {
      failed = true
      throw error
    } finally {
      const closeFailed = failed || testInfo.status !== testInfo.expectedStatus
      if (launchedB) {
        await launchedB.close({ failed: closeFailed }).catch(() => undefined)
      }
      if (launchedA) {
        await launchedA.close({ failed: closeFailed }).catch(() => undefined)
      }
      await runtimeB.cleanup().catch(() => undefined)
      await runtimeA.cleanup().catch(() => undefined)
    }
  })
})
