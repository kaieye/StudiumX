import { join } from 'node:path'

import {
  copyFirstExistingLegacyFileIfMissing,
  legacyUserDataCandidatePaths
} from './app-data-migration'

const REGISTRY_FILE_NAME = 'studiumx-workspaces.json'
const LEGACY_REGISTRY_FILE_NAME = 'teachos-workspaces.json'
const SETTINGS_FILE_NAME = 'studiumx-settings.json'
const LEGACY_SETTINGS_FILE_NAME = 'teachos-settings.json'

export interface AppDataMigrationPaths {
  appDataPath: string
  userDataPath: string
}

/**
 * Startup's complete, ordered migration decision. Call `apply()` before any
 * consumer opens the registry or settings files. Existing targets are left
 * untouched by the durable copy helper, so applying the same plan is safe.
 */
export interface AppDataMigrationPlan {
  registryPath: string
  apply(): Promise<void>
}

/**
 * Keeps startup's durable-data policy in one place: current targets win;
 * otherwise the local legacy name wins, followed by historical product roots.
 * Registry and settings are independent, so either may migrate on its own.
 */
export function createAppDataMigrationPlan({
  appDataPath,
  userDataPath
}: AppDataMigrationPaths): AppDataMigrationPlan {
  const registryPath = join(userDataPath, REGISTRY_FILE_NAME)
  const legacyUserDataPaths = legacyUserDataCandidatePaths(appDataPath, userDataPath)
  const migrations = [
    {
      targetPath: registryPath,
      legacyFileName: LEGACY_REGISTRY_FILE_NAME
    },
    {
      targetPath: join(userDataPath, SETTINGS_FILE_NAME),
      legacyFileName: LEGACY_SETTINGS_FILE_NAME
    }
  ]

  return {
    registryPath,
    async apply(): Promise<void> {
      for (const migration of migrations) {
        await copyFirstExistingLegacyFileIfMissing(migration.targetPath, [
          join(userDataPath, migration.legacyFileName),
          ...legacyUserDataPaths.map((legacyUserDataPath) =>
            join(legacyUserDataPath, migration.legacyFileName)
          )
        ])
      }
    }
  }
}
