import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  isSkillInstallWriteGuardName,
  SKILL_STAGING_DIR_NAME,
  stageThenSwapSkillPack
} from '../../src/main/skill-library/skill-install-stage-swap'
import { resolveUniqueSkillPackDirectories } from '../../src/main/skill-library/skill-pack-resolver'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-skill-stage-swap-'))
  roots.push(root)
  return root
}

describe('skill install stage-then-swap (ADR-0150)', () => {
  it('promotes a staged pack so the final path appears only after success', async () => {
    const installRoot = await createRoot()
    const finalPath = join(installRoot, 'teach')

    await expect(access(finalPath)).rejects.toMatchObject({ code: 'ENOENT' })

    await stageThenSwapSkillPack({
      installRoot,
      skillId: 'teach',
      stageBuild: async (stagingSkillDir) => {
        await writeFile(join(stagingSkillDir, 'SKILL.md'), '# Teach\n', 'utf8')
        await writeFile(join(stagingSkillDir, 'skill-pack.json'), '{"id":"teach"}\n', 'utf8')
        // Final path must still be absent while the stage tree is building.
        await expect(access(finalPath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
    })

    await expect(readFile(join(finalPath, 'SKILL.md'), 'utf8')).resolves.toBe('# Teach\n')
    await expect(access(join(installRoot, SKILL_STAGING_DIR_NAME, 'teach'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('cleans staging on failure and never leaves a final half-built skill tree', async () => {
    const installRoot = await createRoot()
    const finalPath = join(installRoot, 'teach')

    await expect(
      stageThenSwapSkillPack({
        installRoot,
        skillId: 'teach',
        stageBuild: async (stagingSkillDir) => {
          await writeFile(join(stagingSkillDir, 'partial.txt'), 'broken', 'utf8')
          throw new Error('simulated stage failure')
        }
      })
    ).rejects.toThrow(/simulated stage failure/)

    await expect(access(finalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(installRoot, SKILL_STAGING_DIR_NAME, 'teach'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('cleans staging when verifyStaged fails and preserves an existing final pack', async () => {
    const installRoot = await createRoot()
    const finalPath = join(installRoot, 'teach')
    await mkdir(finalPath, { recursive: true })
    await writeFile(join(finalPath, 'SKILL.md'), '# existing\n', 'utf8')

    await expect(
      stageThenSwapSkillPack({
        installRoot,
        skillId: 'teach',
        stageBuild: async (stagingSkillDir) => {
          await writeFile(join(stagingSkillDir, 'SKILL.md'), '# staged\n', 'utf8')
        },
        verifyStaged: async () => {
          throw new Error('verify refused staged pack')
        }
      })
    ).rejects.toThrow(/verify refused/)

    await expect(readFile(join(finalPath, 'SKILL.md'), 'utf8')).resolves.toBe('# existing\n')
    await expect(access(join(installRoot, SKILL_STAGING_DIR_NAME, 'teach'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('replaces an existing final pack only after a successful staged build', async () => {
    const installRoot = await createRoot()
    const finalPath = join(installRoot, 'teach')
    await mkdir(finalPath, { recursive: true })
    await writeFile(join(finalPath, 'SKILL.md'), '# old\n', 'utf8')

    await stageThenSwapSkillPack({
      installRoot,
      skillId: 'teach',
      stageBuild: async (stagingSkillDir) => {
        await writeFile(join(stagingSkillDir, 'SKILL.md'), '# new\n', 'utf8')
      }
    })

    await expect(readFile(join(finalPath, 'SKILL.md'), 'utf8')).resolves.toBe('# new\n')
  })

  it('write-guard names are never resolved as skill packs by the resolver', async () => {
    expect(isSkillInstallWriteGuardName(SKILL_STAGING_DIR_NAME)).toBe(true)
    expect(isSkillInstallWriteGuardName('.hidden')).toBe(true)
    expect(isSkillInstallWriteGuardName('teach')).toBe(false)

    const installRoot = await createRoot()
    const stagingTeach = join(installRoot, SKILL_STAGING_DIR_NAME, 'teach')
    await mkdir(stagingTeach, { recursive: true })
    await writeFile(join(stagingTeach, 'SKILL.md'), '# should not list\n', 'utf8')
    await mkdir(join(installRoot, 'teach'), { recursive: true })
    await writeFile(join(installRoot, 'teach', 'SKILL.md'), '# real\n', 'utf8')

    const dirs = await resolveUniqueSkillPackDirectories([installRoot])
    expect(dirs.map((d) => d.id)).toEqual(['teach'])
    expect(dirs[0]?.directory).toBe(join(installRoot, 'teach'))

    // Staging leaf still exists but is invisible to pack discovery.
    const stagingEntries = await readdir(join(installRoot, SKILL_STAGING_DIR_NAME))
    expect(stagingEntries).toContain('teach')
  })

  it('rejects unsafe skill ids before creating any paths', async () => {
    const installRoot = await createRoot()
    await expect(
      stageThenSwapSkillPack({
        installRoot,
        skillId: '../escape',
        stageBuild: async () => {
          throw new Error('should not build')
        }
      })
    ).rejects.toThrow(/Invalid skill id/)
  })
})
