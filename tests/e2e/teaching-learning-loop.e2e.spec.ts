import { build } from 'esbuild'
import { resolve } from 'node:path'
import { test, expect } from '../helpers/electron'
import { expectNoAccessibilityViolations } from '../helpers/accessibility'

const repositoryRoot = resolve(import.meta.dirname, '../..')

async function mountGoldenTeachingLoop(
  mainWindow: import('@playwright/test').Page,
  outputPath: (pathSegment: string) => string
): Promise<void> {
  const harnessPath = outputPath('golden-teaching-loop-renderer-harness.js')
  await build({
    stdin: {
      loader: 'tsx',
      resolveDir: repositoryRoot,
      contents: `
        import { createElement, useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import { AgentConversationReader } from './src/renderer/src/views/agent-conversation/AgentConversationReader'
        import { buildTeachingTurnPresentation } from './src/renderer/src/teaching-turn-presentation'

        const base = {
          operation: { id: 'operation-golden-needs-practice-001', revision: 1 },
          session: {
            id: 'session-golden-001',
            source: 'canonical',
            readOnly: false,
            status: 'active',
            outcome: { kind: 'needs_practice' }
          },
          nextStep: {
            schemaVersion: 1,
            action: 'contrast_and_retry',
            reason: 'needs_practice',
            safeInputSummary: {
              missionId: 'mission-golden-001',
              courseId: 'course-golden-001',
              latestSession: { id: 'session-golden-001', source: 'canonical', readOnly: false },
              durableOutcome: { status: 'trusted', id: 'outcome-golden-needs-practice-001', kind: 'needs_practice' },
              evidence: { status: 'verified' },
              resources: { readiness: 'ready', availableCount: 2 },
              provenance: {
                outcomeEvidenceEventIds: ['evidence-golden-wrong-001'],
                resourceIds: ['source-golden-foundation', 'source-golden-practice']
              }
            }
          },
          context: { readiness: 'ready' },
          save: {
            canonicalStatus: 'not_started',
            commit: { status: 'committed', outcome: { kind: 'needs_practice' }, recordSaved: false }
          },
          event: {
            id: 'event-golden-retry-001',
            operationId: 'operation-golden-needs-practice-001',
            revision: 1,
            kind: 'explanation_retry_requested'
          },
          sourceIds: ['source-golden-foundation', 'source-golden-practice', 'secret-token-not-rendered', 'raw-private-answer']
        }

        const retry = buildTeachingTurnPresentation(base)
        const saved = buildTeachingTurnPresentation({
          ...base,
          operation: { id: 'operation-golden-correction-002', revision: 2 },
          session: {
            ...base.session,
            status: 'completed',
            outcome: { kind: 'misconception_corrected' }
          },
          nextStep: {
            ...base.nextStep,
            action: 'continue_next_session',
            reason: 'misconception_corrected_with_next_goal',
            safeInputSummary: {
              ...base.nextStep.safeInputSummary,
              durableOutcome: {
                status: 'trusted',
                id: 'outcome-golden-correction-002',
                kind: 'misconception_corrected'
              },
              provenance: {
                outcomeEvidenceEventIds: ['evidence-golden-corrected-002', 'evidence-golden-wrong-001'],
                resourceIds: ['source-golden-foundation', 'source-golden-practice']
              }
            }
          },
          save: {
            canonicalStatus: 'record_saved',
            commit: {
              status: 'committed',
              outcome: { kind: 'misconception_corrected' },
              recordSaved: true
            }
          },
          event: {
            id: 'event-golden-save-002',
            operationId: 'operation-golden-correction-002',
            revision: 2,
            kind: 'save_continue_requested'
          },
          sourceIds: ['source-golden-foundation', 'source-golden-practice']
        })

        const host = document.createElement('div')
        host.id = 'golden-teaching-loop-e2e-host'
        document.body.append(host)

        function GoldenLoop() {
          const [presentation, setPresentation] = useState(retry)
          return createElement(AgentConversationReader, {
            presentation: undefined,
            teachingPresentation: presentation,
            onTeachingAction: (action) => {
              host.dataset.lastAction = action.kind
              if (action.kind === 'retry') {
                setPresentation(saved)
              }
            }
          })
        }

        createRoot(host).render(createElement(GoldenLoop))
      `
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    outfile: harnessPath,
    logLevel: 'silent'
  })

  await mainWindow.addScriptTag({ path: harnessPath })
  await expect(mainWindow.locator('#golden-teaching-loop-e2e-host .teaching-turn-panel')).toBeVisible()
}

test('runs the offline Golden teaching learner path in Electron with keyboard, semantic status, redaction, and restrained announcements @a11y', async ({
  mainWindow
}, testInfo) => {
  await mountGoldenTeachingLoop(mainWindow, (pathSegment) => testInfo.outputPath(pathSegment))

  const host = mainWindow.locator('#golden-teaching-loop-e2e-host')
  const panel = host.locator('.teaching-turn-panel')
  const phases = panel.getByRole('list', { name: '学习流程阶段' }).getByRole('listitem')
  const retry = panel.getByRole('button', { name: '查看讲解并重试' })
  await expect(retry).toBeFocused()
  await expect(phases.filter({ hasText: '讲解并重试' })).toHaveAttribute('aria-current', 'step')
  await expect(panel.getByLabel('当前阶段：讲解并重试。需要再练习一次')).toBeVisible()

  await mainWindow.keyboard.press('Enter')
  await expect(host).toHaveAttribute('data-last-action', 'retry')

  const continueAction = panel.getByRole('button', { name: '继续下一步' })
  await expect(continueAction).toBeFocused()
  await expect(phases.filter({ hasText: '保存并继续' })).toHaveAttribute('aria-current', 'step')
  await expect(panel.getByLabel('当前阶段：保存并继续。学习进展已保存，可以继续')).toBeVisible()

  const liveStatus = panel.getByRole('status')
  await expect(liveStatus).toHaveCount(1)
  await expect(liveStatus).toHaveAttribute('aria-live', 'polite')
  await expect(liveStatus).toHaveText('本次学习进展已保存。你可以继续下一步。')
  await expect(panel.getByRole('log')).toHaveCount(0)

  await mainWindow.keyboard.press('Tab')
  const sources = panel.getByText('来源摘要', { exact: true })
  await expect(sources).toBeFocused()
  await mainWindow.keyboard.press('Enter')
  await expect(panel.getByRole('list', { name: '可信来源标识' })).toBeVisible()
  await expect(panel.getByText('来源 source-golden-foundation', { exact: true })).toBeVisible()
  await expect(panel.getByText('来源 source-golden-practice', { exact: true })).toBeVisible()

  await expect(host).not.toContainText('secret-token-not-rendered')
  await expect(host).not.toContainText('raw-private-answer')

  const diagnostic = panel.locator('.teaching-turn-panel__diagnostic')
  await expect(diagnostic).not.toHaveAttribute('open')
  await mainWindow.keyboard.press('Tab')
  await expect(diagnostic.getByText('技术诊断', { exact: true })).toBeFocused()
  await mainWindow.keyboard.press('Enter')
  await expect(diagnostic).toHaveAttribute('open', '')
  await expect(diagnostic.getByText('学习记录已由规范保存状态确认')).toBeVisible()
  await expect(host).not.toContainText('secret-token-not-rendered')
  await expect(host).not.toContainText('raw-private-answer')

  await expectNoAccessibilityViolations(mainWindow, { include: '#golden-teaching-loop-e2e-host' })
})
