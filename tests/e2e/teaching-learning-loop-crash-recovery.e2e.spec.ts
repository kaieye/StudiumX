import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ElectronApplication, Page, TestInfo } from '@playwright/test'

import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'
import { publishLessonArtifacts } from '../../src/main/teaching-lesson-artifacts'
import {
  loadWorkspaceIndex,
  saveWorkspaceIndex
} from '../../src/main/teaching-workspace/lifecycle'
import type { RegistryWorkspace } from '../../src/main/teaching-workspace/registry'
import type { TeachingAppState, TeachingSettingsV1 } from '../../src/shared/teaching-types'
import { learningSessionOutcomeRelativePath } from '../../src/shared/teaching-placement'
import { expect, test } from '../helpers/electron'
import { createTestRuntime, type TestRuntime } from '../helpers/test-runtime'
import { launchElectronRuntime } from '../helpers/test-runtime/electron'

const generator: TeachingSettingsV1['generator'] = {
  providerId: 'test-provider',
  model: 'test-model',
  endpointFormat: 'chat_completions',
  temperature: 0.2,
  maxOutputTokens: 4096,
  lessonDurationMinutes: 25,
  includeRetrievalPractice: true,
  generateReference: false,
  structuredOutput: true,
  streaming: false,
  reasoningEffort: 'off',
  requestTimeoutMs: 30_000
}

/** Fixed assessment plan — mirrors the integration golden (answer index 1 → choice "b"). */
const FIXED_ASSESSMENT_PLAN = {
  title: 'Trusted assessment',
  objective: 'Use canonical sidecar facts.',
  durationMinutes: 25,
  sections: [{ heading: 'Evidence', body: 'Normal previews are not assessment authority.' }],
  keyPoints: ['Bind the sidecar digest'],
  quiz: [
    {
      type: 'single' as const,
      question: 'Which artifact is authoritative?',
      choices: ['Normal preview', 'Assessment sidecar'],
      answer: 1,
      explanation: 'Only the static sidecar is evaluated.'
    }
  ],
  flashcards: [] as [],
  callouts: [] as [],
  referenceNotes: '',
  learningRecordNote: ''
}

type SeededWorkspace = {
  id: string
  name: string
  rootPath: string
  sessionId: string
  lessonRelativePath: string
  lessonTitle: string
  sessionName: string
}

type TeachingSystemPageApi = {
  createWorkspace: (payload: { name: string; prompt: string }) => Promise<TeachingAppState>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  getState: () => Promise<TeachingAppState>
  commitLearningOutcome: (request: {
    schemaVersion: 1
    type: 'commit'
    workspaceId: string
    sessionId: string
    operationId: string
  }) => Promise<{
    status: string
    recordSaved?: boolean
    outcome?: { kind?: string }
  }>
}

function teachingSystemOn(page: Page): Promise<TeachingSystemPageApi> {
  return page.evaluate(() => {
    const api = (window as unknown as { teachingSystem?: TeachingSystemPageApi }).teachingSystem
    if (!api) throw new Error('window.teachingSystem is unavailable')
    return true
  }).then(async () => {
    // Bound methods must run inside the page; return a thin proxy via evaluate wrappers.
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
      commitLearningOutcome: (request) =>
        page.evaluate(async (input) => {
          const api = (window as unknown as { teachingSystem: TeachingSystemPageApi }).teachingSystem
          return api.commitLearningOutcome(input)
        }, request)
    }
  })
}

async function countLearningRecords(workspaceRoot: string): Promise<number> {
  const entries = await readdir(join(workspaceRoot, 'learning-records')).catch(() => [] as string[])
  return entries.filter((name) => name.endsWith('.md')).length
}

async function readOutcomeJson(workspaceRoot: string, sessionId: string): Promise<unknown | null> {
  const relativePath = learningSessionOutcomeRelativePath(sessionId)
  const absolutePath = join(workspaceRoot, ...relativePath.split('/'))
  try {
    return JSON.parse(await readFile(absolutePath, 'utf8')) as unknown
  } catch {
    return null
  }
}

/**
 * Seed a fixed published lesson + canonical session into an app-managed workspace
 * without generateLesson / provider generation (same seam as integration golden).
 */
async function seedFixedPreviewLesson(workspace: Pick<RegistryWorkspace, 'id' | 'name' | 'rootPath'>) {
  const publication = await publishLessonArtifacts(
    {
      workspace: { name: workspace.name, rootPath: workspace.rootPath },
      plan: FIXED_ASSESSMENT_PLAN,
      sequence: 1,
      title: FIXED_ASSESSMENT_PLAN.title,
      objective: FIXED_ASSESSMENT_PLAN.objective,
      prompt: 'Teach trusted assessment with a fixed fixture.',
      createdAt: '2026-07-15T15:00:00.000Z',
      durationMinutes: 25,
      mission: { title: workspace.name, excerpt: 'Trust static evidence.' },
      generator,
      includeReference: false
    },
    {
      bindCanonicalSession: async ({ lesson, assessment }) => {
        const ledger = createLearningSessionLedger({ workspaceRoot: workspace.rootPath })
        await ledger.open({
          sessionId: lesson.sessionId,
          workspaceId: workspace.id,
          courseRef: {
            courseId: lesson.courseId,
            courseName: lesson.courseName,
            relativePath: lesson.courseRelativePath
          },
          lessonRef: {
            lessonId: lesson.id,
            title: lesson.title,
            relativePath: lesson.relativePath,
            assessment
          }
        })
      }
    }
  )

  const index = await loadWorkspaceIndex({ rootPath: workspace.rootPath } as RegistryWorkspace)
  await saveWorkspaceIndex(workspace.rootPath, {
    ...index,
    updatedAt: '2026-07-15T15:00:00.000Z',
    lessons: [publication.lesson]
  })

  return publication
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

async function createWorkspaceViaApi(page: Page): Promise<SeededWorkspace> {
  await waitForTeachingSystem(page)
  const api = await teachingSystemOn(page)
  const created = await api.createWorkspace({
    name: 'P0 Longitudinal Golden',
    prompt: 'Teach trusted assessment with a fixed fixture.'
  })
  const workspace = created.activeWorkspace
  if (!workspace?.id || !workspace.rootPath) {
    throw new Error('createWorkspace did not return an active workspace with rootPath')
  }
  return {
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.rootPath,
    sessionId: '',
    lessonRelativePath: '',
    lessonTitle: FIXED_ASSESSMENT_PLAN.title,
    sessionName: ''
  }
}

async function refreshRendererFromMain(page: Page, workspaceId: string): Promise<void> {
  const api = await teachingSystemOn(page)
  await api.selectWorkspace(workspaceId)
  // Force App store re-hydrate from sole-writer main state.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForTeachingSystem(page)
  await expect
    .poll(
      async () => {
        const state = await (await teachingSystemOn(page)).getState()
        return state.activeWorkspace?.id === workspaceId && (state.activeWorkspace?.lessons.length ?? 0) > 0
      },
      { timeout: 30_000 }
    )
    .toBe(true)
}

async function openSeededLesson(page: Page, labels: { lessonTitle: string; sessionName: string }): Promise<void> {
  const matchText = new RegExp(`${labels.lessonTitle}|${labels.sessionName}|0001`, 'i')

  const libraryCard = page.locator('button.lesson-course-card').filter({ hasText: matchText }).first()
  if (await libraryCard.isVisible().catch(() => false)) {
    await libraryCard.click()
  } else {
    const coursesTree = page.locator('.workspace-file-tree--courses')
    await expect(coursesTree).toBeVisible({ timeout: 20_000 })

    // Expand workspace root folder if present and collapsed.
    const workspaceButton = coursesTree.locator('.workspace-node-row.is-workspace-folder .workspace-node-button').first()
    if (await workspaceButton.isVisible().catch(() => false)) {
      await workspaceButton.click()
    }

    // Default-course content folder is path "lessons" (also a course folder open target).
    const lessonsFolder = coursesTree
      .locator('.workspace-node-row.is-course-folder .workspace-node-button')
      .filter({ hasText: /lessons|课程/i })
      .first()
    if (await lessonsFolder.isVisible().catch(() => false)) {
      await lessonsFolder.click()
    }

    // Prefer lesson library cards after course open.
    const cardAfterCourse = page.locator('button.lesson-course-card').filter({ hasText: matchText }).first()
    if (await cardAfterCourse.isVisible().catch(() => false)) {
      await cardAfterCourse.click()
    } else {
      const anyCard = page.locator('button.lesson-course-card').first()
      if (await anyCard.isVisible().catch(() => false)) {
        await anyCard.click()
      } else {
        const lessonButton = coursesTree
          .locator('.workspace-node-button')
          .filter({ hasText: matchText })
          .first()
        await expect(lessonButton).toBeVisible({ timeout: 20_000 })
        await lessonButton.click()
      }
    }
  }

  const iframe = page.locator('iframe.lesson-reader-frame')
  await expect(iframe).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => iframe.getAttribute('src'), { timeout: 30_000 }).toMatch(/studiumx-preview:/)

  const frame = page.frameLocator('iframe.lesson-reader-frame')
  await expect(frame.locator('.quiz-card button[data-choice="a"]')).toBeVisible({ timeout: 30_000 })
  await expect(frame.locator('.quiz-card button[data-choice="b"]')).toBeVisible({ timeout: 30_000 })
  // Allow main-process preview binding to activate on the non-main-frame navigation.
  await page.waitForTimeout(500)
}

async function clickQuizChoice(page: Page, choice: 'a' | 'b'): Promise<void> {
  const frame = page.frameLocator('iframe.lesson-reader-frame')
  await frame.locator(`.quiz-card button[data-choice="${choice}"]`).click()
}

async function firstWindow(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return page
}

test.describe('P0 longitudinal Electron Golden — crash recovery', () => {
  for (const crashPoint of ['after_stage_flush', 'before_catalog_reconcile'] as const) {
    test(`wrong → crash(${crashPoint}) → recover corrected outcome @p0`, async ({}, testInfo: TestInfo) => {
      test.setTimeout(180_000)
      const runtime: TestRuntime = await createTestRuntime(`${testInfo.project.name}-crash-${crashPoint}-${testInfo.workerIndex}`)
      runtime.env.STUDIUMX_E2E = '1'
      // Arm the guarded crash seam before the app starts; wrong evidence and correction run in one process.
      runtime.env.STUDIUMX_E2E_CRASH_POINT = crashPoint
      let launched = await launchElectronRuntime(runtime, testInfo)
      let failed = false
      try {
        let page = await firstWindow(launched.application)
        const created = await createWorkspaceViaApi(page)
        const publication = await seedFixedPreviewLesson({ id: created.id, name: created.name, rootPath: created.rootPath })
        const seeded: SeededWorkspace = { ...created, sessionId: publication.lesson.sessionId, lessonRelativePath: publication.lesson.relativePath, lessonTitle: publication.lesson.title, sessionName: publication.lesson.sessionName }
        await refreshRendererFromMain(page, seeded.id); await openSeededLesson(page, { lessonTitle: seeded.lessonTitle, sessionName: seeded.sessionName })
        await clickQuizChoice(page, 'a'); await expect(page.locator('[data-learning-outcome-commit="needs_practice"]')).toBeVisible({ timeout: 30_000 })
        expect(await countLearningRecords(seeded.rootPath)).toBe(0); expect(await readOutcomeJson(seeded.rootPath, seeded.sessionId)).toBeNull()
        const child = launched.application.process()
        const exited = new Promise<void>((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', () => resolve()) })
        await clickQuizChoice(page, 'b').catch(() => undefined)
        await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 30_000 }).toBe(true)
        await exited
        delete runtime.env.STUDIUMX_E2E_CRASH_POINT
        launched = await launchElectronRuntime(runtime, testInfo); page = await firstWindow(launched.application)
        await refreshRendererFromMain(page, seeded.id); await openSeededLesson(page, { lessonTitle: seeded.lessonTitle, sessionName: seeded.sessionName })
        // The renderer-local banner resets after a process restart. Re-submit the same preview
        // interaction to prove the real evidence → preload/IPC path replays idempotently.
        await clickQuizChoice(page, 'b')
        await expect(page.locator('[data-learning-outcome-commit="saved"]')).toBeVisible({ timeout: 30_000 }); await expect.poll(async () => countLearningRecords(seeded.rootPath), { timeout: 15_000 }).toBe(1)
        expect(await readOutcomeJson(seeded.rootPath, seeded.sessionId)).toMatchObject({ kind: 'misconception_corrected' })
        const replay = await (await teachingSystemOn(page)).commitLearningOutcome({ schemaVersion: 1, type: 'commit', workspaceId: seeded.id, sessionId: seeded.sessionId, operationId: 'outcome-seq-2' })
        expect(replay).toMatchObject({ status: 'already_committed', recordSaved: true, outcome: { kind: 'misconception_corrected' } }); expect(await countLearningRecords(seeded.rootPath)).toBe(1)
      } catch (error) { failed = true; throw error } finally { await launched.close({ failed: failed || testInfo.status !== testInfo.expectedStatus }).catch(() => undefined); await runtime.cleanup().catch(() => undefined) }
    })
  }
})
