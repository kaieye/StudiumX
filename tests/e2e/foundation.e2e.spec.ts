import { test, expect } from '../helpers/electron'

test('launches the built Electron app with isolated user data', async ({
  electronApp,
  mainWindow,
  runtime,
  workspacePath
}) => {
  const paths = await electronApp.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    documents: app.getPath('documents')
  }))

  expect(paths.userData).toContain(runtime.rootDir)
  expect(paths.documents).toContain(runtime.homeDir)
  expect(workspacePath).toContain(runtime.rootDir)
  await expect(mainWindow).toHaveTitle('StudiumX')
  await expect(mainWindow.locator('#root')).not.toBeEmpty()
})
