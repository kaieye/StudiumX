/**
 * IMPL-AF: V1 demote UX click-path Electron e2e.
 *
 * Proves demote is **user-confirmed**, not silent (ADR-0011):
 * 1. Isolated Electron + createWorkspace
 * 2. Hybrid seed: canonical sole-read on disk + non-demoted V1 task authority
 *    (triggers post_hydrate demote offer; full migrate UX not required)
 * 3. Real UI: Workbench mounts V1AuthorityDemoteSheet → click confirm label
 * 4. After confirm: demote marker + presence-only V1 (empty tasks/timerPlans)
 * 5. forceKill + relaunch: canonical sole-read holds; no default catalog
 *    resurrection; stale marker does not auto-wipe
 * 6. Optional: dismiss does **not** demote
 *
 * Residual honesty: §18 still not product-complete.
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

const CANONICAL_TASK_ID = 'canonical-v1-demote-ux-e2e-task'
const CANONICAL_TASK_TITLE = 'Canonical sole-read task V1 demote UX e2e'
const V1_AUTHORITY_TASK_TITLE = 'V1 dual-authority cache task demote UX e2e'
const DEFAULT_CATALOG_TITLES = ['整理下一节课的重点', '复盘一组检索练习'] as const

const STUDY_SPACE_STORAGE_KEY = 'studiumx:study-space:v1'
const STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY = 'studiumx:study-space:v1-authority-demoted:v1'

/** Confirm button copy from buildV1DemoteBannerModel (busy=false). */
const DEMOTE_CONFIRM_LABEL = '归档并停止本地权威'
const DEMOTE_DISMISS_LABEL = '关闭'
const DEMOTE_EYEBROW = '停止本地任务权威'

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
 * Force Chromium/Electron to write localStorage to disk before forceKill.
 */
async function flushRendererStorage(app: ElectronApplication, page: Page): Promise<void> {
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
  await new Promise<void>((resolve) => setTimeout(resolve, 200))
}

function buildCanonicalSnapshot(nowMs: number): StudyPlanningSnapshotV1 {
  return {
    schema: STUDY_PLANNING_SCHEMA,
    schemaVersion: STUDY_PLANNING_SCHEMA_VERSION,
    revision: 21,
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
 * Hybrid seed: non-demoted V1 still holds task authority (co-cache).
 * Hydrate with non-empty canonical then offers demote sheet (post_hydrate).
 * Does **not** set demote marker — that must come from real confirm click.
 */
async function seedNonDemotedV1TaskAuthority(page: Page): Promise<void> {
  await page.evaluate(
    ({ storageKey, demotedKey, v1TaskTitle }) => {
      // Ensure demote marker is absent so offer can surface.
      try {
        localStorage.removeItem(demotedKey)
      } catch {
        // ignore
      }
      const shell = {
        clientId: 'studiumx-v1-demote-ux-e2e',
        nickname: 'DemoteUxE2E',
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
        // Dual-authority co-cache — demote UX must archive then strip these.
        tasks: [
          {
            id: 'v1-demote-ux-authority-task',
            title: v1TaskTitle,
            done: false,
            categoryId: 'study'
          }
        ],
        timerPlans: [] as unknown[]
      }
      localStorage.setItem(storageKey, JSON.stringify(shell))
    },
    {
      storageKey: STUDY_SPACE_STORAGE_KEY,
      demotedKey: STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
      v1TaskTitle: V1_AUTHORITY_TASK_TITLE
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
  hasV1AuthorityTitle: boolean
}

async function probeV1LocalStorage(page: Page): Promise<V1StorageProbe> {
  return page.evaluate(
    ({ demotedKey, storageKey, defaults, canonicalTitle, v1AuthorityTitle }) => {
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
        hasCanonicalTitle: blob.includes(canonicalTitle),
        hasV1AuthorityTitle: blob.includes(v1AuthorityTitle)
      }
    },
    {
      demotedKey: STUDY_SPACE_V1_AUTHORITY_DEMOTED_KEY,
      storageKey: STUDY_SPACE_STORAGE_KEY,
      defaults: [...DEFAULT_CATALOG_TITLES],
      canonicalTitle: CANONICAL_TASK_TITLE,
      v1AuthorityTitle: V1_AUTHORITY_TASK_TITLE
    }
  )
}

async function openWorkbench(page: Page, options?: { expandTasks?: boolean }): Promise<void> {
  const expandTasks = options?.expandTasks !== false
  const taskToggle = page.locator('.workbench-task-toggle-card')
  if ((await taskToggle.count()) === 0) {
    await page.getByRole('button', { name: '自习室' }).click()
  }
  await expect(taskToggle).toBeVisible({ timeout: 45_000 })
  if (!expandTasks) return
  // Demote sheet backdrop intercepts pointer events — never click under a dialog.
  const demoteOpen = await page
    .locator('.workbench-v1-demote-backdrop')
    .isVisible()
    .catch(() => false)
  if (demoteOpen) return
  const expanded = await taskToggle.getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await taskToggle.click()
  }
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
  expect(probe.hasCanonicalTitle).toBe(false)
  expect(probe.hasV1AuthorityTitle).toBe(false)
}

async function restoreWorkspaceAndHydrate(
  page: Page,
  workspaceId: string
): Promise<void> {
  await waitForTeachingSystem(page)
  // Force select even if registry restore races.
  await (await teachingSystemOn(page)).selectWorkspace(workspaceId)
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
  // Hard reload so useState(() => readStudySnapshot()) re-reads V1 co-cache + demote absence.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForTeachingSystem(page)
  await (await teachingSystemOn(page)).selectWorkspace(workspaceId)
}

/**
 * Wait for demote sheet dialog (post_hydrate offer after sole-read applied).
 * Prefer role/text over data-testid (brief).
 */
async function waitForDemoteSheet(page: Page): Promise<void> {
  // OfficeWorkbench hosts the sheet; ensure workbench route is up without
  // expanding task panel under the demote backdrop.
  await openWorkbench(page, { expandTasks: false })
  const dialog = page.getByRole('dialog').filter({ hasText: DEMOTE_EYEBROW })
  await expect(dialog).toBeVisible({ timeout: 45_000 })
  await expect(dialog.getByRole('heading', { name: /归档并停止|本地任务缓存/ })).toBeVisible()
  await expect(dialog.getByRole('button', { name: DEMOTE_CONFIRM_LABEL })).toBeVisible()
}

async function clickDemoteConfirm(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: DEMOTE_EYEBROW })
  const confirm = dialog.getByRole('button', { name: DEMOTE_CONFIRM_LABEL })
  await expect(confirm).toBeEnabled({ timeout: 15_000 })
  // Best-effort: accept archive JSON download if Chromium surfaces it.
  const downloadWait = page.waitForEvent('download', { timeout: 8_000 }).catch(() => null)
  await confirm.click()
  await downloadWait
  // Sheet closes on success; busy label may flash first.
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

async function clickDemoteDismiss(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ hasText: DEMOTE_EYEBROW })
  const dismiss = dialog.getByRole('button', { name: DEMOTE_DISMISS_LABEL })
  await expect(dismiss).toBeEnabled({ timeout: 15_000 })
  await dismiss.click()
  await expect(dialog).toBeHidden({ timeout: 15_000 })
}

/**
 * Shared bootstrap: workspace + canonical disk + non-demoted V1, then cold
 * relaunch so durable host reads snapshot.json and hydrate offers demote.
 */
async function bootstrapDemoteOfferReady(options: {
  runtime: TestRuntime
  testInfo: TestInfo
  workspaceName: string
}): Promise<{
  launched: Awaited<ReturnType<typeof launchElectronRuntime>>
  page: Page
  workspaceId: string
  workspaceRoot: string
}> {
  let launched = await launchElectronRuntime(options.runtime, options.testInfo)
  const page0 = await firstWindow(launched.application)
  const api = await teachingSystemOn(page0)
  const created = await api.createWorkspace({
    name: options.workspaceName,
    prompt: 'Prove V1 demote requires user confirm click path.'
  })
  const workspace = created.activeWorkspace
  if (!workspace?.id || !workspace.rootPath) {
    throw new Error('createWorkspace did not return active workspace with rootPath')
  }
  const workspaceId = workspace.id
  const workspaceRoot = workspace.rootPath

  await seedCanonicalSnapshotOnDisk(workspaceRoot, Date.now())
  await seedNonDemotedV1TaskAuthority(page0)
  const pre = await probeV1LocalStorage(page0)
  expect(pre.demotedAt).toBeNull()
  expect(pre.hasV1AuthorityTitle).toBe(true)
  expect(pre.tasks.length).toBeGreaterThan(0)

  await flushRendererStorage(launched.application, page0)
  await forceKillElectronRuntime(launched)

  launched = await launchElectronRuntime(options.runtime, options.testInfo)
  const page = await firstWindow(launched.application)
  await restoreWorkspaceAndHydrate(page, workspaceId)

  return { launched, page, workspaceId, workspaceRoot }
}

test.describe('V1 demote UX — Electron click-path confirm', () => {
  test('confirm demote sheet → marker + presence-only V1 → kill/relaunch sole-read @p0', async (
    {},
    testInfo: TestInfo
  ) => {
    test.setTimeout(240_000)

    const runtime: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-v1-demote-ux-${testInfo.workerIndex}`
    )
    runtime.env.STUDIUMX_E2E = '1'
    runtime.env.STUDIUMX_TEST = '1'

    let launched: Awaited<ReturnType<typeof launchElectronRuntime>> | null = null
    let failed = false
    let workspaceId = ''
    let workspaceRoot = ''

    try {
      const boot = await bootstrapDemoteOfferReady({
        runtime,
        testInfo,
        workspaceName: 'V1 Demote UX E2E Confirm'
      })
      launched = boot.launched
      let page = boot.page
      workspaceId = boot.workspaceId
      workspaceRoot = boot.workspaceRoot

      // --- Real confirm click path (not evaluate-only demote) ---
      await waitForDemoteSheet(page)
      await clickDemoteConfirm(page)

      // Demote marker + empty task authority shell after user confirm.
      await expect
        .poll(async () => {
          const probe = await probeV1LocalStorage(page)
          return {
            demoted: Boolean(probe.demotedAt && Number(probe.demotedAt) > 0),
            emptyTasks: probe.tasks.length === 0,
            emptyPlans: probe.timerPlans.length === 0,
            noV1Title: !probe.hasV1AuthorityTitle,
            noCatalog: !probe.hasDefaultCatalogTitle,
            noCanonicalInV1: !probe.hasCanonicalTitle
          }
        }, { timeout: 30_000 })
        .toEqual({
          demoted: true,
          emptyTasks: true,
          emptyPlans: true,
          noV1Title: true,
          noCatalog: true,
          noCanonicalInV1: true
        })

      await assertV1PresenceOnlyNoCatalog(page)
      // UI still shows sole-read canonical tasks (demote does not wipe in-memory sole-read).
      await assertUiHydratedFromCanonical(page)

      const demotedAtAfterConfirm = (await probeV1LocalStorage(page)).demotedAt
      expect(demotedAtAfterConfirm).toBeTruthy()

      // --- forceKill + relaunch: sole-read holds; no auto wipe / catalog resurrection ---
      await flushRendererStorage(launched.application, page)
      await forceKillElectronRuntime(launched)
      launched = await launchElectronRuntime(runtime, testInfo)
      page = await firstWindow(launched.application)
      await restoreWorkspaceAndHydrate(page, workspaceId)

      await assertUiHydratedFromCanonical(page)
      await assertV1PresenceOnlyNoCatalog(page)

      const planning = await (await teachingSystemOn(page)).readStudyPlanning({
        workspaceRoot
      })
      expect(planning.ok).toBe(true)
      expect(planning.snapshot?.tasks?.some((t) => t.title === CANONICAL_TASK_TITLE)).toBe(true)
      expect(planning.source === 'canonical' || planning.source === 'backup').toBe(true)

      // Marker survived multi-process cold start (no auto ≥30d wipe job).
      const afterCold = await probeV1LocalStorage(page)
      expect(afterCold.demotedAt).toBe(demotedAtAfterConfirm)
      expect(afterCold.tasks).toEqual([])
      expect(afterCold.hasDefaultCatalogTitle).toBe(false)
      expect(afterCold.hasCanonicalTitle).toBe(false)
      expect(afterCold.raw).toBeTruthy()
      expect(afterCold.raw).toContain('DemoteUxE2E')
    } catch (error) {
      failed = true
      throw error
    } finally {
      if (launched) {
        await launched
          .close({ failed: failed || testInfo.status !== testInfo.expectedStatus })
          .catch(() => undefined)
      }
      await runtime.cleanup().catch(() => undefined)
    }
  })

  test('dismiss demote sheet does not write demote marker @p1', async ({}, testInfo: TestInfo) => {
    test.setTimeout(180_000)

    const runtime: TestRuntime = await createTestRuntime(
      `${testInfo.project.name}-v1-demote-dismiss-${testInfo.workerIndex}`
    )
    runtime.env.STUDIUMX_E2E = '1'
    runtime.env.STUDIUMX_TEST = '1'

    let launched: Awaited<ReturnType<typeof launchElectronRuntime>> | null = null
    let failed = false

    try {
      const boot = await bootstrapDemoteOfferReady({
        runtime,
        testInfo,
        workspaceName: 'V1 Demote UX E2E Dismiss'
      })
      launched = boot.launched
      const page = boot.page

      await waitForDemoteSheet(page)
      const beforeDismiss = await probeV1LocalStorage(page)
      expect(beforeDismiss.demotedAt).toBeNull()

      await clickDemoteDismiss(page)

      const probe = await probeV1LocalStorage(page)
      // Dismiss/later must never write demote marker or run erase path.
      expect(probe.demotedAt).toBeNull()
      // Dual-authority may still co-cache (hydrate can rewrite V1 with sole-read
      // tasks while not demoted). Critical: marker absent + no silent wipe job.
      expect(probe.raw).toBeTruthy()
      // Sheet closed; re-open path does not invent demote marker without confirm.
      await expect(page.getByRole('dialog').filter({ hasText: DEMOTE_EYEBROW })).toHaveCount(0)
    } catch (error) {
      failed = true
      throw error
    } finally {
      if (launched) {
        await launched
          .close({ failed: failed || testInfo.status !== testInfo.expectedStatus })
          .catch(() => undefined)
      }
      await runtime.cleanup().catch(() => undefined)
    }
  })
})
