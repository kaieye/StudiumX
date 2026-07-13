import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SkillLibraryService } from '../../src/main/skill-library'
import { resolveUniqueSkillPackDirectories } from '../../src/main/skill-library/skill-pack-resolver'
import { verifySkillPack } from '../../src/main/skill-library/skill-pack-verifier'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-skill-pack-unit-'))
  roots.push(root)
  return root
}

function frontmatter(name = 'teach'): string {
  return `---\nname: ${name}\ndescription: A verified skill.\n---\n\n# ${name}\n`
}

async function writePack(input: {
  root: string
  id?: string
  directoryName?: string
  skillContent?: string
  manifestResources?: Array<{ path: string; kind: 'instructions' | 'reference' | 'template' | 'asset' }>
  extraFiles?: Record<string, string>
}): Promise<string> {
  const id = input.id ?? 'teach'
  const directory = join(input.root, input.directoryName ?? id)
  const resources = input.manifestResources ?? [{ path: 'SKILL.md', kind: 'instructions' }]
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), input.skillContent ?? frontmatter(id), 'utf8')
  for (const [path, content] of Object.entries(input.extraFiles ?? {})) {
    const target = join(directory, path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  await writeFile(join(directory, 'skill-pack.json'), JSON.stringify({
    schemaVersion: 1,
    id,
    version: '1.0.0',
    capabilities: resources.some((resource) => resource.path !== 'SKILL.md') ? ['read-resources'] : [],
    resources
  }), 'utf8')
  return directory
}

describe('verified skill pack resolution', () => {
  it('keeps valid built-in, personal, and legacy packs available through the library interface', async () => {
    const root = await createRoot()
    const builtInRoot = join(root, 'builtins')
    const personalRoot = join(root, 'personal')
    await writePack({ root: builtInRoot })
    const legacyDirectory = join(personalRoot, 'legacy-skill')
    await mkdir(legacyDirectory, { recursive: true })
    await writeFile(join(legacyDirectory, 'SKILL.md'), frontmatter('legacy-skill'), 'utf8')

    const service = new SkillLibraryService({ builtInRoots: [builtInRoot], personalRoot })
    const catalog = await service.listSkills()

    expect(catalog.skills.map((skill) => skill.id).sort()).toEqual(['legacy-skill', 'teach'])
    expect(catalog.skills.find((skill) => skill.id === 'teach')?.source).toBe('builtin')
    expect(catalog.skills.find((skill) => skill.id === 'legacy-skill')?.installed).toBe(true)
  })

  it('fails closed for duplicate case-normalized source IDs', async () => {
    const root = await createRoot()
    const firstRoot = join(root, 'first')
    const secondRoot = join(root, 'second')
    await writePack({ root: firstRoot, directoryName: 'Teach' })
    await writePack({ root: secondRoot, directoryName: 'teach' })

    await expect(resolveUniqueSkillPackDirectories([firstRoot, secondRoot])).resolves.toEqual([])
    const service = new SkillLibraryService({ builtInRoots: [firstRoot, secondRoot], personalRoot: join(root, 'personal') })
    await expect(service.listSkills()).resolves.toMatchObject({ skills: [] })
  })

  it('rejects malformed instruction frontmatter before exposing a manifest-backed pack', async () => {
    const root = await createRoot()
    const directory = await writePack({ root, skillContent: '---\nname\n---\n# broken\n' })

    await expect(verifySkillPack(directory, {
      containingRoot: root,
      expectedId: 'teach',
      manifestRequired: true,
      requireCompleteResourceList: true
    })).rejects.toThrow(/frontmatter/i)
  })

  it('rejects a manifest resource that is declared but missing', async () => {
    const root = await createRoot()
    const directory = await writePack({
      root,
      manifestResources: [
        { path: 'SKILL.md', kind: 'instructions' },
        { path: 'REFERENCE.md', kind: 'reference' }
      ]
    })

    await expect(verifySkillPack(directory, {
      containingRoot: root,
      expectedId: 'teach',
      manifestRequired: true,
      requireCompleteResourceList: true
    })).rejects.toThrow(/regular file/i)
  })

  it('rejects incomplete manifest resource declarations', async () => {
    const root = await createRoot()
    const directory = await writePack({
      root,
      extraFiles: { 'REFERENCE.md': '# not declared\n' }
    })

    await expect(verifySkillPack(directory, {
      containingRoot: root,
      expectedId: 'teach',
      manifestRequired: true,
      requireCompleteResourceList: true
    })).rejects.toThrow(/missing from its manifest/i)
  })

  it('rejects a skill directory outside its configured root', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    const directory = await writePack({ root: outside })

    await expect(verifySkillPack(directory, {
      containingRoot: root,
      expectedId: 'teach',
      manifestRequired: true,
      requireCompleteResourceList: true
    })).rejects.toThrow(/escapes its configured root/i)
  })

  it('rejects a declared resource that resolves through a symlink outside its pack when symlinks are permitted', async () => {
    const root = await createRoot()
    const directory = await writePack({
      root,
      manifestResources: [
        { path: 'SKILL.md', kind: 'instructions' },
        { path: 'REFERENCE.md', kind: 'reference' }
      ]
    })
    const outside = join(root, 'outside.md')
    await writeFile(outside, '# outside\n', 'utf8')
    try {
      await symlink(outside, join(directory, 'REFERENCE.md'))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return
      throw error
    }

    await expect(verifySkillPack(directory, {
      containingRoot: root,
      expectedId: 'teach',
      manifestRequired: true,
      requireCompleteResourceList: true
    })).rejects.toThrow(/regular file|symbolic links|escapes/i)
  })
})
