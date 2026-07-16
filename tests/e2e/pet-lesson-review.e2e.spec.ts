import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { test, expect } from '../helpers/electron'

const LESSON_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Variables</title></head>
<body><h1>Variables</h1><p>Learn about variables.</p></body>
</html>`

const FLASHCARDS_JSON = JSON.stringify({
  lessonId: '0001',
  lessonTitle: 'Variables',
  cards: [
    { front: 'What is a variable?', back: 'A named storage location for a value.' }
  ]
})

async function seedDueLessonReviewFixture(workspacePath: string): Promise<void> {
  const lessonsDir = join(workspacePath, 'lessons')
  await mkdir(lessonsDir, { recursive: true })
  await writeFile(join(lessonsDir, '0001-variables.html'), LESSON_HTML)
  await writeFile(join(lessonsDir, '0001-variables-flashcards.json'), FLASHCARDS_JSON)
}

async function importWorkspaceViaDialog(mainWindow: import('@playwright/test').Page, workspacePath: string): Promise<void> {
  const addButton = mainWindow.locator('.sidebar-section--courses .section-add-button')
  await addButton.click()
  const dialog = mainWindow.locator('.import-dialog[role="dialog"]')
  await expect(dialog).toBeVisible()
  const input = mainWindow.locator('.import-dialog-field input[type="text"]')
  await input.fill(workspacePath)
  await input.press('Enter')
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })
}

test.describe('Pet lesson review notifications', () => {
  test('lesson review notification appears for a due lesson and opens the lesson on activate', async ({ mainWindow, workspacePath }) => {
    await seedDueLessonReviewFixture(workspacePath)
    await importWorkspaceViaDialog(mainWindow, workspacePath)

    const actionButton = mainWindow.getByRole('button', { name: /开始复习|review now/i })
    await expect(actionButton).toBeVisible({ timeout: 20_000 })

    await actionButton.click()

    await expect(mainWindow.locator('.lesson-reader-panel')).toBeVisible({ timeout: 10_000 })
  })

  test('lesson review notification clears on workspace switch', async ({ mainWindow, workspacePath }) => {
    await seedDueLessonReviewFixture(workspacePath)
    await importWorkspaceViaDialog(mainWindow, workspacePath)

    await expect(mainWindow.getByRole('button', { name: /开始复习|review now/i })).toBeVisible({ timeout: 20_000 })

    const emptyWorkspacePath = join(workspacePath, '..', 'workspace-empty')
    await mkdir(emptyWorkspacePath, { recursive: true })
    await importWorkspaceViaDialog(mainWindow, emptyWorkspacePath)

    await expect(mainWindow.getByRole('button', { name: /开始复习|review now/i })).not.toBeVisible({ timeout: 10_000 })
  })
})
