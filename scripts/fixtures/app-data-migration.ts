import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAppDataMigrationPlan } from '../../src/main/app-data-migration-plan'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-app-data-migration-'))
  const appData = join(tempRoot, 'AppData')
  const currentUserData = join(appData, 'StudiumX')
  const teachOsUserData = join(appData, 'TeachOS')
  const oldProductUserData = join(appData, 'AI Teaching System')
  const oldPackageUserData = join(appData, 'ai-teaching-system')

  await mkdir(currentUserData, { recursive: true })
  await mkdir(teachOsUserData, { recursive: true })
  await mkdir(oldProductUserData, { recursive: true })
  await mkdir(oldPackageUserData, { recursive: true })

  // The same product directory's old filename has priority over every old root.
  await writeFile(join(currentUserData, 'teachos-workspaces.json'), '{"registry":"same-product"}\n', 'utf8')
  await writeFile(join(teachOsUserData, 'teachos-workspaces.json'), '{"registry":"teachos"}\n', 'utf8')
  await writeFile(join(oldProductUserData, 'teachos-workspaces.json'), '{"registry":"old-product"}\n', 'utf8')
  await writeFile(join(oldPackageUserData, 'teachos-settings.json'), '{"settings":"old-package"}\n', 'utf8')

  const plan = createAppDataMigrationPlan({ appDataPath: appData, userDataPath: currentUserData })
  assert.equal(plan.registryPath, join(currentUserData, 'studiumx-workspaces.json'))

  // Registry and settings migrate independently from their own first valid source.
  await plan.apply()
  assert.equal(
    await readFile(plan.registryPath, 'utf8'),
    '{"registry":"same-product"}\n',
    'the local legacy registry should win over historical product directories'
  )
  assert.equal(
    await readFile(join(currentUserData, 'studiumx-settings.json'), 'utf8'),
    '{"settings":"old-package"}\n',
    'a missing settings target should migrate even when the registry came from another source'
  )

  // A current target is never overwritten, while another missing target can still migrate.
  await writeFile(plan.registryPath, '{"registry":"current"}\n', 'utf8')
  await rm(join(currentUserData, 'studiumx-settings.json'))
  await writeFile(join(oldProductUserData, 'teachos-settings.json'), '{"settings":"old-product"}\n', 'utf8')
  await plan.apply()
  assert.equal(
    await readFile(plan.registryPath, 'utf8'),
    '{"registry":"current"}\n',
    'a current registry must not be overwritten'
  )
  assert.equal(
    await readFile(join(currentUserData, 'studiumx-settings.json'), 'utf8'),
    '{"settings":"old-product"}\n',
    'partial migration should still fill a newly missing settings target'
  )

  // Reapplying the plan is idempotent even if legacy sources later change.
  await writeFile(join(oldProductUserData, 'teachos-settings.json'), '{"settings":"changed-source"}\n', 'utf8')
  await plan.apply()
  assert.equal(
    await readFile(join(currentUserData, 'studiumx-settings.json'), 'utf8'),
    '{"settings":"old-product"}\n',
    'reapplying a completed plan must preserve the already migrated target'
  )

  console.log('app data migration plan ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
