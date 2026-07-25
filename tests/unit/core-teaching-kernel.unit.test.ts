import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CORE_TEACHING_KERNEL_ID,
  CoreTeachingKernelError,
  loadCoreTeachingKernelReference
} from '../../src/main/skill-library/core-teaching-kernel'
import { SkillLibraryService } from '../../src/main/skill-library'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-core-kernel-unit-'))
  roots.push(root)
  return root
}

function frontmatter(name = 'teach', body = 'Core kernel body from builtin.'): string {
  return `---\nname: ${name}\ndescription: Teaching kernel.\ncategory: learning\nicon: graduation-cap\n---\n\n# ${name}\n\n${body}\n`
}

async function writeTeachPack(input: {
  root: string
  skillContent?: string
  corruptManifest?: boolean
}): Promise<string> {
  const directory = join(input.root, 'teach')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), input.skillContent ?? frontmatter(), 'utf8')
  if (input.corruptManifest) {
    await writeFile(join(directory, 'skill-pack.json'), '{ not-json', 'utf8')
  } else {
    await writeFile(
      join(directory, 'skill-pack.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'teach',
        version: '1.0.0',
        capabilities: ['read-resources'],
        resources: [
          { path: 'SKILL.md', kind: 'instructions' },
          { path: 'REFERENCE.md', kind: 'reference' }
        ]
      }),
      'utf8'
    )
    await writeFile(join(directory, 'REFERENCE.md'), '# Reference\n', 'utf8')
  }
  return directory
}

describe('core teaching kernel load (ADR-0151 Phase 1)', () => {
  it('loads Teaching Kernel from builtin without personal install', async () => {
    const root = await createRoot()
    const builtInRoot = join(root, 'builtins')
    const personalRoot = join(root, 'personal')
    await mkdir(personalRoot, { recursive: true })
    await writeTeachPack({
      root: builtInRoot,
      skillContent: frontmatter('teach', 'Builtin kernel retrieval practice.')
    })

    const service = new SkillLibraryService({ builtInRoots: [builtInRoot], personalRoot })
    const catalog = await service.listSkills()
    expect(catalog.skills.find((skill) => skill.id === 'teach')?.installed).toBe(false)

    const kernel = await service.readCoreTeachingKernel()
    expect(kernel.id).toBe(CORE_TEACHING_KERNEL_ID)
    expect(kernel.content).toMatch(/Builtin kernel retrieval practice/)
    expect(kernel.source.toLocaleLowerCase()).toContain(join(builtInRoot, 'teach').toLocaleLowerCase())

    const references = await service.readInstalledSkillReferences(['teach'])
    expect(references).toHaveLength(1)
    expect(references[0]?.content).toMatch(/Builtin kernel retrieval practice/)
    expect(references[0]?.source.toLocaleLowerCase()).toContain(join(builtInRoot, 'teach').toLocaleLowerCase())
  })

  it('fails closed when core pack is missing', async () => {
    const root = await createRoot()
    const builtInRoot = join(root, 'builtins')
    const personalRoot = join(root, 'personal')
    await mkdir(builtInRoot, { recursive: true })
    await mkdir(personalRoot, { recursive: true })

    const service = new SkillLibraryService({ builtInRoots: [builtInRoot], personalRoot })
    await expect(service.readCoreTeachingKernel()).rejects.toMatchObject({
      name: 'CoreTeachingKernelError',
      code: 'core_teaching_kernel_missing'
    })
    await expect(service.readInstalledSkillReferences(['teach'])).rejects.toBeInstanceOf(CoreTeachingKernelError)
  })

  it('fails closed when core pack is corrupt', async () => {
    const root = await createRoot()
    const builtInRoot = join(root, 'builtins')
    await writeTeachPack({ root: builtInRoot, corruptManifest: true })

    await expect(
      loadCoreTeachingKernelReference({ builtInRoots: [builtInRoot] })
    ).rejects.toMatchObject({
      name: 'CoreTeachingKernelError',
      code: 'core_teaching_kernel_invalid'
    })
  })

  it('does not use personal same-id content for teaching kernel load', async () => {
    const root = await createRoot()
    const builtInRoot = join(root, 'builtins')
    const personalRoot = join(root, 'personal')
    await writeTeachPack({
      root: builtInRoot,
      skillContent: frontmatter('teach', 'APP_SHIPPED_CORE_MARKER')
    })
    await writeTeachPack({
      root: personalRoot,
      skillContent: frontmatter('teach', 'PERSONAL_SHADOW_MARKER')
    })

    const service = new SkillLibraryService({ builtInRoots: [builtInRoot], personalRoot })
    const catalog = await service.listSkills()
    expect(catalog.skills.find((skill) => skill.id === 'teach')?.installed).toBe(true)
    expect(catalog.skills.find((skill) => skill.id === 'teach')?.installedPath).toBe(join(personalRoot, 'teach'))

    const kernel = await service.readCoreTeachingKernel()
    expect(kernel.content).toMatch(/APP_SHIPPED_CORE_MARKER/)
    expect(kernel.content).not.toMatch(/PERSONAL_SHADOW_MARKER/)
    expect(kernel.source.toLocaleLowerCase()).toContain(join(builtInRoot, 'teach').toLocaleLowerCase())
    expect(kernel.source.toLocaleLowerCase()).not.toContain(join(personalRoot, 'teach').toLocaleLowerCase())

    const viaReferences = await service.readInvokedSkillReferences('/teach explain', ['teach'])
    expect(viaReferences).toHaveLength(1)
    expect(viaReferences[0]?.content).toMatch(/APP_SHIPPED_CORE_MARKER/)
    expect(viaReferences[0]?.content).not.toMatch(/PERSONAL_SHADOW_MARKER/)
  })

  it('loads from real shipped builtin-skills path when present', async () => {
    const shipped = join(process.cwd(), 'resources', 'builtin-skills')
    const personalRoot = join(await createRoot(), 'personal-empty')
    await mkdir(personalRoot, { recursive: true })
    const service = new SkillLibraryService({ builtInRoots: [shipped], personalRoot })
    const kernel = await service.readCoreTeachingKernel()
    expect(kernel.id).toBe('teach')
    expect(kernel.content.length).toBeGreaterThan(100)
    expect(kernel.source.toLocaleLowerCase()).toContain(join(shipped, 'teach').toLocaleLowerCase())
  })
})
