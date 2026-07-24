import { lstat, mkdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { isSafeSkillId } from '../../shared/skill-command'
import { isPathInsideRoot } from '../path-access'

/** Staging directory name under the personal skill install root (not a skill id). */
export const SKILL_STAGING_DIR_NAME = '.staging'

export type StageThenSwapSkillPackOptions = {
  /** Final install root (e.g. personal skills directory). */
  installRoot: string
  /** Allowlisted skill id; becomes the final directory leaf. */
  skillId: string
  /**
   * Build the complete skill pack tree under `stagingSkillDir`.
   * Must not write outside that directory (shared resources stay outside this helper).
   */
  stageBuild: (stagingSkillDir: string) => Promise<void>
  /**
   * Optional post-build verification of the staged tree before promotion.
   * On throw, staging is removed and the final skill path is left untouched.
   */
  verifyStaged?: (stagingSkillDir: string) => Promise<void>
}

export type StageThenSwapSkillPackResult = {
  finalPath: string
  stagingPath: string
}

/**
 * Build a skill pack under `<installRoot>/.staging/<skillId>`, verify it, then
 * promote into `<installRoot>/<skillId>` via rename. Readers that only list
 * safe skill ids never observe a half-built tree at the final path.
 *
 * Windows: when the final path already exists, move it aside then rename the
 * staging tree into place (rename does not reliably replace directories).
 *
 * Product floor: caller must still enforce allowlist + pack verifier; this
 * helper only provides atomic promotion discipline (no marketplace, no shell).
 */
export async function stageThenSwapSkillPack(
  options: StageThenSwapSkillPackOptions
): Promise<StageThenSwapSkillPackResult> {
  const skillId = requireSafeSkillId(options.skillId)
  const installRoot = resolve(options.installRoot)
  if (!installRoot) throw new Error('Skill install root is required.')

  await mkdir(installRoot, { recursive: true })
  const installRootInfo = await lstat(installRoot)
  if (installRootInfo.isSymbolicLink() || !installRootInfo.isDirectory()) {
    throw new Error('Skill install root must be a regular directory.')
  }

  const stagingRoot = join(installRoot, SKILL_STAGING_DIR_NAME)
  const stagingSkillDir = join(stagingRoot, skillId)
  const finalPath = join(installRoot, skillId)
  const backupPath = join(stagingRoot, `${skillId}.prev`)

  assertContained(installRoot, stagingRoot)
  assertContained(installRoot, stagingSkillDir)
  assertContained(installRoot, finalPath)
  assertContained(installRoot, backupPath)

  await mkdir(stagingRoot, { recursive: true })
  await rm(stagingSkillDir, { recursive: true, force: true }).catch(() => undefined)
  await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)

  let promoted = false
  let existingMovedToBackup = false

  try {
    await mkdir(stagingSkillDir, { recursive: true })
    await options.stageBuild(stagingSkillDir)

    const stagedInfo = await lstat(stagingSkillDir)
    if (stagedInfo.isSymbolicLink() || !stagedInfo.isDirectory()) {
      throw new Error('Staged skill pack must be a regular directory.')
    }

    if (options.verifyStaged) {
      await options.verifyStaged(stagingSkillDir)
    }

    const existing = await lstat(finalPath).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new Error('Skill install target must be a regular directory.')
      }
      // Windows: rename does not reliably replace an existing directory.
      await rename(finalPath, backupPath)
      existingMovedToBackup = true
    }

    await rename(stagingSkillDir, finalPath)
    promoted = true

    if (existingMovedToBackup) {
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
    }

    return { finalPath, stagingPath: stagingSkillDir }
  } catch (error) {
    if (existingMovedToBackup && !promoted) {
      const current = await lstat(finalPath).catch((targetError: unknown) => {
        if (isErrnoException(targetError, 'ENOENT')) return null
        throw targetError
      })
      if (!current) {
        await rename(backupPath, finalPath).catch(() => undefined)
      }
    }
    throw error
  } finally {
    // Never leave a half-built pack under .staging for this skill id.
    await rm(stagingSkillDir, { recursive: true, force: true }).catch(() => undefined)
    if (promoted) {
      await rm(backupPath, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

/**
 * True when a directory entry under the install root must never be treated as
 * an installable skill pack (staging / write-guard leafs).
 */
export function isSkillInstallWriteGuardName(entryName: string): boolean {
  const name = String(entryName ?? '').trim()
  if (!name) return true
  if (name === SKILL_STAGING_DIR_NAME) return true
  if (name.startsWith('.')) return true
  return !isSafeSkillId(name)
}

function requireSafeSkillId(value: string): string {
  const skillId = String(value ?? '').trim().toLocaleLowerCase()
  if (!isSafeSkillId(skillId)) throw new Error('Invalid skill id.')
  return skillId
}

function assertContained(root: string, target: string): void {
  if (!isPathInsideRoot(root, target)) {
    throw new Error('Skill install path escapes the install root.')
  }
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === code)
}
