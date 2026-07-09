import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  copyFirstExistingLegacyFileIfMissing,
  legacyUserDataCandidatePaths
} from '../../src/main/app-data-migration'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-app-data-migration-'))
  const appData = join(tempRoot, 'AppData')
  const currentUserData = join(appData, 'StudiumX')
  const oldProductUserData = join(appData, 'AI Teaching System')
  const oldPackageUserData = join(appData, 'ai-teaching-system')

  const candidates = legacyUserDataCandidatePaths(appData, currentUserData)
  assert.deepEqual(candidates, [
    join(appData, 'TeachOS'),
    oldProductUserData,
    oldPackageUserData
  ])

  await mkdir(oldProductUserData, { recursive: true })
  await mkdir(oldPackageUserData, { recursive: true })
  await writeFile(join(oldProductUserData, 'teachos-workspaces.json'), '{"registry":"old-product"}\n', 'utf8')
  await writeFile(join(oldPackageUserData, 'teachos-settings.json'), '{"settings":"old-package"}\n', 'utf8')

  const copiedRegistry = await copyFirstExistingLegacyFileIfMissing(
    join(currentUserData, 'studiumx-workspaces.json'),
    [
      join(currentUserData, 'teachos-workspaces.json'),
      ...candidates.map((path) => join(path, 'teachos-workspaces.json'))
    ]
  )
  assert.equal(copiedRegistry, join(oldProductUserData, 'teachos-workspaces.json'))
  assert.equal(
    await readFile(join(currentUserData, 'studiumx-workspaces.json'), 'utf8'),
    '{"registry":"old-product"}\n'
  )

  const copiedSettings = await copyFirstExistingLegacyFileIfMissing(
    join(currentUserData, 'studiumx-settings.json'),
    [
      join(currentUserData, 'teachos-settings.json'),
      ...candidates.map((path) => join(path, 'teachos-settings.json'))
    ]
  )
  assert.equal(copiedSettings, join(oldPackageUserData, 'teachos-settings.json'))
  assert.equal(
    await readFile(join(currentUserData, 'studiumx-settings.json'), 'utf8'),
    '{"settings":"old-package"}\n'
  )

  await writeFile(join(currentUserData, 'studiumx-settings.json'), '{"settings":"current"}\n', 'utf8')
  const skipped = await copyFirstExistingLegacyFileIfMissing(
    join(currentUserData, 'studiumx-settings.json'),
    [join(oldPackageUserData, 'teachos-settings.json')]
  )
  assert.equal(skipped, null)
  assert.equal(
    await readFile(join(currentUserData, 'studiumx-settings.json'), 'utf8'),
    '{"settings":"current"}\n',
    'existing StudiumX settings should not be overwritten'
  )

  console.log('app data migration ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
