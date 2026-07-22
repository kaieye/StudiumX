/**
 * IMPL-V: true multi-process Electron cold-start e2e for V1 sole-authority.
 *
 * Proves (real Playwright electron-e2e process kill + relaunch, not unit mock):
 * 1. Seed demote marker + presence-only V1 in isolated runtime userData
 * 2. After demote seed: V1 tasks empty (no task authority)
 * 3. forceKillElectronRuntime + relaunch same workspace/userData
 * 4. Cold reopen hydrates tasks from canonical sole-read snapshot.json — not defaultStudySnapshot catalog
 * 5. No auto ≥30d silent wipe path (stale demote marker does not invent wipe; tasks stay empty shell)
 *
 * Residual honesty: §18 still not product-complete (other residuals remain).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

import {
  STUDY_PLANNING_SCHEMA,
  STUDY_PLANNING_SCHEMA_VERSION
} from '../../src/shared/study-planning'
import type { StudyPlanningSnapshotV1 } from '../../src/shared/study-planning'
import type { TeachingAppState } from '../../src/shared/teaching-types'
import { expect, test } from '../helpers/electron'
import { createTestRuntime, type TestRuntime } from '../helpers/test-runtime'
import { forceKillElectronRuntime, launchElectronRuntime } from '../helpers/test-runtime/electron'

const DEMOTED_AT_MS = 1_700_000_000_111
/** Marker age well past 30d — proves no auto wipe job runs on cold start. */
const STALE_DEMOTED_AT_MS = DEMOTED_AT_MS - 40 * 24 * 60 * 60 * 1000
const CANONICAL_TASK_ID = 'canonical-v1-cold-start-e2e-task'
const CANONICAL_TASK_TITLE = 'Canonical sole-read task V1 cold-start e2e'
const DEFAULT_CATALOG_TITLES = ['整理下一节课的重点', '复盘一组检索练习'] as const

const STUDY_SPACE_STORAGE_KEY = 'studiumx:study-space:v1'
const STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY = 'studiumx:study-space:v1-authority-demoted:v1'

type TeachingSystemPageApi = {
  createWorkspace: (payload: { name: string; prompt: string }) => Promise<TeachingAppState>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  getState: () => Promise<TeachingAppState>
  readStudyPlanning: (payload: { workspaceRoot: string }) => Promise<{
    ok: boolean
    snapshot?: StudyPlanningSnapshotV1
    source?: string
    error?: { code: string; message: string }
  }>
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

async function teachingSystemOn(page: Page): Promise<TeachingSystemPageApi> {
  await waitForTeachingSystem(page)
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
    getState: () =>
      page.evaluate(async () => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.getState()
      }),
    readStudyPlanning: (payload) =>
      page.evaluate(async (input) => {
        const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
        return api.readStudyPlanning(input)
      }, payload)
  }
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return page
}

/**
 * Force Chromium/Electron to write localStorage (and other DOM storage) to disk
 * before forceKill — otherwise kill can race unflushed session storage.
 */
async function flushRendererStorage(app: ElectronApplication, page: Page): Promise<void> {
  // Touch storage + brief settle so the renderer partition is dirty-then-synced.
  await page.evaluate(() => {
    try {
      localStorage.setItem('studiumx:e2e:flush-ping', String(Date.now()))
    } catch {
      // ignore
    }
  })
  await app.evaluate(async ({ session }) => {
    await session.defaultSession.flushStorageData()
  })
  // Small delay so file locks settle before taskkill.
  await new Promise<void>((resolve) => setTimeout(resolve, 200))
}

function buildCanonicalSnapshot(nowMs: number): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision: 11,
    updatedAtMs: nowMs,
    tasks: [
      {
        id: CANONICAL_TASK_ID,
        title: CANONICAL_TASK_TITLE,
        status: 'open',
        categoryId: 'study',
        inbox: false,
        splittable: true,
        revision: 1,
        source: 'manual'
      }
    ],
    scheduleBlocks: [],
    timerPlans: [],
    timerSessions: [],
    preferences: {
      emptyStartPolicy: 'ask_every_time',
      classificationPromptOptOut: false,
      defaultTimerPlanId: 'classic_25_5'
    },
    localAnalyticsHints: {}
  }
}

async function seedCanonicalSnapshotOnDisk(workspaceRoot: string, nowMs = Date.now()): Promise<string> {
  const dir = join(workspaceRoot, '.studiumx', 'study-planning')
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'snapshot.json')
  const snapshot = buildCanonicalSnapshot(nowMs)
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return path
}

/**
 * Seed demote marker + presence-only V1 shell (empty task authority).
 * Brief allows seed via evaluate when full demote UX is heavy.
 */
async function seedDemotedPresenceOnlyV1(page: Page, demotedAtMs: number): Promise<void> {
  await page.evaluate(
    ({ demotedKey, storageKey, demotedAt }) => {
      const shell = {
        clientId: 'studiumx-v1-cold-start-e2e',
        nickname: 'ColdStartE2E',
        spaceCode: 'PUBLIC',
        presenceRelayUrl: 'wss://broker.emqx.io:8084/mqtt',
        signalId: 'reading',
        modeId: 'free',
        contractText: '',
        contractLocked: false,
        roomId: 'silent',
        seatIndex: 0,
        seatClaimedAt: 0,
        timerMode: 'focus',
        timerState: 'idle',
        focusMinutes: 25,
        breakMinutes: 5,
        simulationStartTime: '09:00',
        simulationEndTime: '11:00',
        remainingSeconds: 1500,
        todayFocusSeconds: 0,
        todaySessions: 0,
        totalFocusSeconds: 0,
        totalSessions: 0,
        streakDays: 0,
        xp: 0,
        lastStudyDate: '',
        // Presence shell only — no task authority after demote.
        tasks: [] as unknown[],
        timerPlans: [] as unknown[]
      }
      localStorage.setItem(demotedKey, String(demotedAt))
      localStorage.setItem(storageKey, JSON.stringify(shell))
    },
    {
      demotedKey: STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
      storageKey: STUDY_SPACE_STORAGE_KEY,
      demotedAt: demotedAtMs
    }
  )
}

type V1StorageProbe = {
  demotedAt: string | null
  tasks: unknown[]
  timerPlans: unknown[]
  raw: string | null
  hasDefaultCatalogTitle: boolean
  hasCanonicalTitle: boolean
}

async function probeV1LocalStorage(page: Page): Promise<V1StorageProbe> {
  return page.evaluate(
    ({ demotedKey, storageKey, defaults, canonicalTitle }) => {
      const demotedAt = localStorage.getItem(demotedKey)
      const raw = localStorage.getItem(storageKey)
      let tasks: unknown[] = []
      let timerPlans: unknown[] = []
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { tasks?: unknown[]; timerPlans?: unknown[] }
          tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
          timerPlans = Array.isArray(parsed.timerPlans) ? parsed.timerPlans : []
        } catch {
          tasks = []
          timerPlans = []
        }
      }
      const blob = `${raw ?? ''}|${JSON.stringify(tasks)}`
      return {
        demotedAt,
        tasks,
        timerPlans,
        raw,
        hasDefaultCatalogTitle: defaults.some((t) => blob.includes(t)),
        hasCanonicalTitle: blob.includes(canonicalTitle)
      }
    },
    {
      demotedKey: STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
      storageKey: STUDY_SPACE_STORAGE_KEY,
      defaults: [...DEFAULT_CATALOG_TITLES],
      canonicalTitle: CANONICAL_TASK_TITLE
    }
  )
}

async function openWorkbench(page: Page): Promise<void> {
  const taskToggle = page.locator('.workbench-task-toggle-card')
  if ((await taskToggle.count()) === 0) {
    await page.getByRole('button', { name: '自习室' }).click()
  }
  await expect(taskToggle).toBeVisible({ timeout: 45_000 })
  const expanded = await taskToggle.getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await taskToggle.click()
  }
  // Prefer "全部" so unscheduled open tasks are visible regardless of day window.
  const allTab = page.getByRole('button', { name: /全部任务|全部/ }).first()
  if (await allTab.isVisible().catch(() => false)) {
    await allTab.click()
  }
}

async function assertUiHydratedFromCanonical(page: Page): Promise<void> {
  await openWorkbench(page)
  await expect(page.getByText(CANONICAL_TASK_TITLE).first()).toBeVisible({ timeout: 45_000 })
  for (const title of DEFAULT_CATALOG_TITLES) {
    await expect(page.getByText(title)).toHaveCount(0)
  }
}

async function assertV1PresenceOnlyNoCatalog(page: Page): Promise<void> {
  const probe = await probeV1LocalStorage(page)
  expect(probe.demotedAt).toBeTruthy()
  expect(Number(probe.demotedAt)).toBeGreaterThan(0)
  expect(probe.tasks).toEqual([])
  expect(probe.timerPlans).toEqual([])
  expect(probe.hasDefaultCatalogTitle).toBe(false)
  // Canonical sole-read must not co-write task authority into demoted V1 shell.
  expect(probe.hasCanonicalTitle).toBe(false)
}

test.describe('V1 sole-authority — true Electron multi-process cold-start', () => {
  test('demote seed → kill → relaunch: canonical sole-read, no default catalog resurrection @p0', async (
    {},
    testInfo: TestInfo
  ) => {
    test.setTimeout(240_000)

    const runtime: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-v1-cold-${testInfo.workerIndex}`
    )
    runtime.env.STUDIUMX_E2E = '1'
    runtime.env.STUDIUMX_TEST = '1'

    let launched = await launchElectronRuntime(runtime, testInfo)
    let failed = false
    let workspaceRoot = ''
    let workspaceId = ''

    try {
      // --- Phase 0: first process — create workspace + seed demote + canonical disk ---
      // Write snapshot on disk BEFORE any durable host warm-load can cache empty seed.
      // Then force-kill so main-process DurableStudyPlanningStore registry is cold on relaunch.
      let page = await firstWindow(launched.application)
      const api = await teachingSystemOn(page)
      const created = await api.createWorkspace({
        name: 'V1 Cold Start E2E',
        prompt: 'Prove demoted V1 does not resurrect default catalog over canonical sole-read.'
      })
      const workspace = created.activeWorkspace
      if (!workspace?.id || !workspace.rootPath) {
        throw new Error('createWorkspace did not return active workspace with rootPath')
      }
      workspaceId = workspace.id
      workspaceRoot = workspace.rootPath

      await seedCanonicalSnapshotOnDisk(workspaceRoot, Date.now())
      // Stale demote marker (≥30d age) — cold start must not auto-wipe anything.
      await seedDemotedPresenceOnlyV1(page, STALE_DEMOTED_AT_MS)
      await assertV1PresenceOnlyNoCatalog(page)

      // --- Phase 1: real multi-process kill (not unit mock) ---
      // Critical: clears process-local planning host registry so next ensureLoaded
      // reads snapshot.json from disk (not an empty in-memory seed).
      // Flush localStorage so demote marker survives forceKill.
      await flushRendererStorage(launched.application, page)
      await forceKillElectronRuntime(launched)

      // --- Phase 2: cold relaunch same userData + workspace ---
      launched = await launchElectronRuntime(runtime, testInfo)
      page = await firstWindow(launched.application)
      await waitForTeachingSystem(page)

      // Active workspace should restore from registry under isolated userData.
      await expect
        .poll(
          async () => {
            const state = await (await teachingSystemOn(page)).getState()
            return state.activeWorkspace?.id === workspaceId
              ? state.activeWorkspace.rootPath
              : null
          },
          { timeout: 45_000 }
        )
        .toBeTruthy()

      // Ensure selection + hydrate path even if UI race.
      await (await teachingSystemOn(page)).selectWorkspace(workspaceId)
      // Hard reload so useState(() => readStudySnapshot()) re-reads demote marker + empty shell.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForTeachingSystem(page)
      await (await teachingSystemOn(page)).selectWorkspace(workspaceId)

      // Canonical sole-read must hydrate UI; demoted V1 stays presence-only.
      await assertUiHydratedFromCanonical(page)
      await assertV1PresenceOnlyNoCatalog(page)

      // Canonical IPC sole-read (main process durable host, cold after kill).
      const planning = await (await teachingSystemOn(page)).readStudyPlanning({
        workspaceRoot
      })
      expect(planning.ok).toBe(true)
      expect(planning.snapshot?.tasks?.some((t) => t.title === CANONICAL_TASK_TITLE)).toBe(true)
      expect(planning.source === 'canonical' || planning.source === 'backup').toBe(true)

      // Demote marker still present after multi-process cold start (no auto wipe job).
      const afterCold = await probeV1LocalStorage(page)
      expect(afterCold.demotedAt).toBe(String(STALE_DEMOTED_AT_MS))
      expect(afterCold.tasks).toEqual([])

      // --- Phase 3: second kill+relaunch (stability / non-resurrection) ---
      await flushRendererStorage(launched.application, page)
      await forceKillElectronRuntime(launched)
      launched = await launchElectronRuntime(runtime, testInfo)
      page = await firstWindow(launched.application)
      await waitForTeachingSystem(page)
      await (await teachingSystemOn(page)).selectWorkspace(workspaceId)
      await assertUiHydratedFromCanonical(page)
      await assertV1PresenceOnlyNoCatalog(page)

      // Negative contract: no auto ≥30d wipe introduced (marker + empty shell intact).
      const finalProbe = await probeV1LocalStorage(page)
      expect(finalProbe.demotedAt).toBe(String(STALE_DEMOTED_AT_MS))
      expect(finalProbe.raw).toBeTruthy()
      expect(finalProbe.raw).toContain('ColdStartE2E')
      expect(finalProbe.hasDefaultCatalogTitle).toBe(false)
      expect(finalProbe.hasCanonicalTitle).toBe(false)
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
