import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PACKAGED_APP_USER_MODEL_ID,
  resolveWindowsAppUserModelId
} from '../../src/main/app-identity'

describe('Windows application identity', () => {
  it('keeps development taskbar grouping separate from the packaged application', () => {
    const packagedId = resolveWindowsAppUserModelId(true)
    const developmentId = resolveWindowsAppUserModelId(false)

    expect(packagedId).toBe(PACKAGED_APP_USER_MODEL_ID)
    expect(packagedId).toBe('com.local.studiumx')
    expect(developmentId).toBe('com.local.studiumx.development')
    expect(developmentId).not.toBe(packagedId)
  })

  it('keeps the release identity aligned with packaging and applies the resolved identity before window creation', () => {
    const root = resolve(import.meta.dirname, '../..')
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      build?: { appId?: string }
    }
    const mainSource = readFileSync(resolve(root, 'src/main/index.ts'), 'utf8')
    const identityCall = mainSource.indexOf('app.setAppUserModelId(APP_USER_MODEL_ID)')
    const singleInstanceLock = mainSource.indexOf('app.requestSingleInstanceLock()')

    expect(packageJson.build?.appId).toBe(PACKAGED_APP_USER_MODEL_ID)
    expect(mainSource).toMatch(/const APP_USER_MODEL_ID = resolveWindowsAppUserModelId\(app\.isPackaged\)/)
    expect(identityCall).toBeGreaterThan(-1)
    expect(identityCall).toBeLessThan(singleInstanceLock)
    expect(mainSource).toMatch(/setAppDetails\(\{[\s\S]*?appId: APP_USER_MODEL_ID/)
  })
})
