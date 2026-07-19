import { build } from 'esbuild'
import { resolve } from 'node:path'
import { test, expect } from '../helpers/electron'
import { expectNoAccessibilityViolations } from '../helpers/accessibility'

const repositoryRoot = resolve(import.meta.dirname, '../..')
async function mountTeachingTurnReader(
  mainWindow: import('@playwright/test').Page,
  outputPath: (pathSegment: string) => string
): Promise<void> {
  const harnessPath = outputPath('teaching-turn-reader-renderer-harness.js')
  await build({
    stdin: {
      loader: 'tsx',
      resolveDir: repositoryRoot,
      contents: `
        import { createElement } from 'react'
        import { createRoot } from 'react-dom/client'
        import { AgentConversationReader } from './src/renderer/src/views/agent-conversation/AgentConversationReader'
        import { buildTeachingTurnPresentation } from './src/renderer/src/teaching-turn-presentation'

        const presentation = buildTeachingTurnPresentation({
          operation: { id: 'operation-e2e-1', revision: 1 },
          session: {
            id: 'session-e2e-1',
            source: 'canonical',
            readOnly: false,
            status: 'active',
            outcome: { kind: 'misconception_corrected' }
          },
          nextStep: {
            schemaVersion: 1,
            action: 'continue_next_session',
            reason: 'misconception_corrected_with_next_goal',
            safeInputSummary: {
              missionId: 'mission-e2e-1',
              courseId: 'course-e2e-1',
              latestSession: { id: 'session-e2e-1', source: 'canonical', readOnly: false },
              durableOutcome: { status: 'trusted', id: 'outcome-e2e-1', kind: 'misconception_corrected' },
              evidence: { status: 'verified' },
              resources: { readiness: 'ready', availableCount: 2 },
              provenance: { outcomeEvidenceEventIds: ['event-e2e-1'], resourceIds: ['source.alpha', 'source-beta'] }
            }
          },
          context: { readiness: 'ready' },
          save: {
            canonicalStatus: 'record_saved',
            commit: {
              status: 'committed',
              outcome: { kind: 'misconception_corrected' },
              recordSaved: true
            }
          },
          event: {
            id: 'event-e2e-1',
            operationId: 'operation-e2e-1',
            revision: 1,
            kind: 'save_continue_requested'
          },
          sourceIds: ['source.alpha', 'source-beta']
        })

        const host = document.createElement('div')
        host.id = 'teaching-turn-reader-e2e-host'
        host.setAttribute('aria-label', 'Teaching turn accessibility fixture')
        document.body.append(host)
        createRoot(host).render(createElement(AgentConversationReader, {
          presentation: undefined,
          teachingPresentation: presentation,
          onTeachingAction: (action) => { host.dataset.lastAction = action.kind }
        }))
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
  await expect(mainWindow.locator('#teaching-turn-reader-e2e-host .teaching-turn-panel')).toBeVisible()
}

test('renders the learner-facing TeachingTurnReader in Electron with accessible controls and restrained status @a11y', async ({
  mainWindow
}, testInfo) => {
  await mountTeachingTurnReader(mainWindow, (pathSegment) => testInfo.outputPath(pathSegment))

  const panel = mainWindow.locator('#teaching-turn-reader-e2e-host .teaching-turn-panel')
  const continueAction = panel.getByRole('button', { name: '继续下一步' })
  await expect(continueAction).toBeFocused()

  await mainWindow.keyboard.press('Enter')
  await expect(panel.locator('..')).toHaveAttribute('data-last-action', 'continue')

  const sources = panel.getByText('来源摘要', { exact: true })
  await mainWindow.keyboard.press('Tab')
  await expect(sources).toBeFocused()
  await mainWindow.keyboard.press('Enter')
  await expect(panel.getByRole('list', { name: '可信来源标识' })).toBeVisible()
  await expect(panel.getByText('来源 source.alpha', { exact: true })).toBeVisible()
  await expect(panel.getByText('来源 source-beta', { exact: true })).toBeVisible()

  const liveStatus = panel.getByRole('status')
  await expect(liveStatus).toHaveAttribute('aria-live', 'polite')
  await expect(liveStatus).toHaveText('本次学习进展已保存。你可以继续下一步。')
  await expect(panel.getByRole('log')).toHaveCount(0)

  const diagnostic = panel.locator('.teaching-turn-panel__diagnostic')
  await expect(diagnostic).toBeVisible()
  await expect(diagnostic).not.toHaveAttribute('open')
  const diagnosticSummary = diagnostic.getByText('技术诊断', { exact: true })
  await mainWindow.keyboard.press('Tab')
  await expect(diagnosticSummary).toBeFocused()
  await mainWindow.keyboard.press('Enter')
  await expect(diagnostic).toHaveAttribute('open', '')
  await expect(diagnostic.getByText('学习记录已由规范保存状态确认')).toBeVisible()
  await expect(panel).not.toContainText('secret')
  await expect(panel).not.toContainText('RAW-ANSWER')
  await expect(panel).not.toContainText('C:\\')

  await expectNoAccessibilityViolations(mainWindow, { include: '#teaching-turn-reader-e2e-host' })
})
