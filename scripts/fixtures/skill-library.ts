import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BUILTIN_SKILL_IDS, SkillLibraryService } from '../../src/main/skill-library'
import { createReadSkillResourceTool } from '../../src/main/ai/tools/skill-resource'
import { buildAgentChatSystemPrompt, composeTeachingUserTurn } from '../../src/main/teaching-conversation-runtime'
import { parseAgentChatStreamPayload } from '../../src/main/teaching-ipc-commands'
import {
  filterSkillSlashMatches,
  leadingSkillIds,
  skillSlashQuery
} from '../../src/shared/skill-command'
import { skillPackManifestSchema } from '../../src/shared/teaching-types'

const root = await mkdtemp(join(tmpdir(), 'studiumx-skill-library-'))
const builtInRoot = join(root, 'builtin-skills')
const personalRoot = join(root, '.studiumx', 'skills')
const teachRoot = join(builtInRoot, 'teach')
const builtInSharedRoot = join(builtInRoot, '_shared')
const personalSharedRoot = join(personalRoot, '_shared')

try {
  await mkdir(teachRoot, { recursive: true })
  await mkdir(builtInSharedRoot, { recursive: true })
  await writeFile(
    join(teachRoot, 'SKILL.md'),
    `---\nname: teach\ndescription: Teach a focused concept.\nargument-hint: "What should we learn?"\ncategory: learning\nicon: graduation-cap\n---\n\n# Teach\n\nUse retrieval practice.\n`,
    'utf8'
  )
  await writeFile(join(teachRoot, 'REFERENCE.md'), '# Reference\n', 'utf8')
  await writeFile(join(builtInSharedRoot, 'domain-primitives.md'), '# Built-in domain primitives\n', 'utf8')
  await writeFile(
    join(teachRoot, 'skill-pack.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'teach',
      version: '1.2.3',
      capabilities: ['read-resources', 'read-shared-resources'],
      resources: [
        { path: 'SKILL.md', kind: 'instructions' },
        { path: 'REFERENCE.md', kind: 'reference' },
        { path: '../_shared/domain-primitives.md', kind: 'reference' }
      ]
    }, null, 2),
    'utf8'
  )
  const unlistedRoot = join(builtInRoot, 'unlisted-skill')
  await mkdir(unlistedRoot, { recursive: true })
  await writeFile(join(unlistedRoot, 'SKILL.md'), '# Unlisted\n', 'utf8')
  await writeFile(join(unlistedRoot, 'skill-pack.json'), JSON.stringify({
    schemaVersion: 1,
    id: 'unlisted-skill',
    version: '1.0.0',
    capabilities: [],
    resources: [{ path: 'SKILL.md', kind: 'instructions' }]
  }), 'utf8')

  const service = new SkillLibraryService({ builtInRoots: [builtInRoot], personalRoot })
  const initial = await service.listSkills()
  assert.equal(initial.rootPath, personalRoot)
  assert.equal(initial.skills.length, 1)
  assert.deepEqual(initial.skills[0], {
    id: 'teach',
    name: 'teach',
    description: 'Teach a focused concept.',
    argumentHint: 'What should we learn?',
    category: 'learning',
    icon: 'graduation-cap',
    author: 'StudiumX',
    command: '/teach',
    source: 'builtin',
    installed: false,
    version: '1.2.3',
    capabilities: ['read-resources', 'read-shared-resources']
  })

  // ADR-0151: Teaching Kernel loads from app-shipped builtin without personal install.
  const preInstallKernel = await service.readCoreTeachingKernel()
  assert.equal(preInstallKernel.id, 'teach')
  assert.match(preInstallKernel.content, /Use retrieval practice/)
  assert.match(preInstallKernel.source, /builtin-skills|teach/i)
  const preInstallRefs = await service.readInstalledSkillReferences(['teach'])
  assert.equal(preInstallRefs.length, 1)
  assert.match(preInstallRefs[0]?.content ?? '', /Use retrieval practice/)

  const installed = await service.installSkill('teach')
  assert.equal(installed.installed, true)
  assert.equal(installed.installedPath, join(personalRoot, 'teach'))
  assert.equal(await readFile(join(personalRoot, 'teach', 'REFERENCE.md'), 'utf8'), '# Reference\n')
  assert.equal(
    await readFile(join(personalSharedRoot, 'domain-primitives.md'), 'utf8'),
    '# Built-in domain primitives\n'
  )

  await writeFile(join(personalSharedRoot, 'domain-primitives.md'), '# Personal domain primitives\n', 'utf8')
  await writeFile(join(builtInSharedRoot, 'new-shared-resource.md'), '# Newly bundled resource\n', 'utf8')
  await service.installSkill('teach')
  assert.equal(
    await readFile(join(personalSharedRoot, 'domain-primitives.md'), 'utf8'),
    '# Personal domain primitives\n'
  )
  await assert.rejects(() => access(join(personalSharedRoot, 'new-shared-resource.md')))

  // Personal same-id install must not shadow kernel body used by teaching runtime.
  await writeFile(
    join(personalRoot, 'teach', 'SKILL.md'),
    `---\nname: teach\ndescription: Personal shadow.\ncategory: learning\nicon: graduation-cap\n---\n\n# Teach\n\nPERSONAL_SHADOW_MARKER\n`,
    'utf8'
  )

  const afterInstall = await service.listSkills()
  assert.equal(afterInstall.skills.length, 1)
  assert.equal(afterInstall.skills[0]?.installed, true)
  assert.equal(afterInstall.skills[0]?.installedPath, join(personalRoot, 'teach'))

  const references = await service.readInstalledSkillReferences(['teach', '../escape', 'teach'])
  assert.equal(references.length, 1)
  assert.equal(references[0]?.id, 'teach')
  assert.match(references[0]?.content ?? '', /Use retrieval practice/)
  assert.doesNotMatch(references[0]?.content ?? '', /PERSONAL_SHADOW_MARKER/)
  assert.match(references[0]?.source ?? '', /builtin-skills|teach/i)
  const skillResourceTool = createReadSkillResourceTool(references)
  assert.ok(skillResourceTool)
  const resourceResult = JSON.parse(await skillResourceTool.handler({ skillId: 'teach', path: 'REFERENCE.md' }, {} as never))
  assert.equal(resourceResult.skillId, 'teach')
  assert.equal(resourceResult.path, 'REFERENCE.md')
  assert.equal(resourceResult.resourceKind, 'reference')
  assert.match(resourceResult.content, /# Reference/)
  // Kernel resources resolve under app-shipped builtin shared root, not personal shadow.
  const sharedResourceResult = JSON.parse(await skillResourceTool.handler({
    skillId: 'teach',
    path: '../_shared/domain-primitives.md'
  }, {} as never))
  assert.equal(sharedResourceResult.skillId, 'teach')
  assert.equal(sharedResourceResult.path, '../_shared/domain-primitives.md')
  assert.match(sharedResourceResult.content, /# Built-in domain primitives/)
  // Undeclared shared path under the kernel's (builtin) shared root must be rejected.
  await writeFile(join(builtInSharedRoot, 'undeclared.md'), '# Undeclared\n', 'utf8')
  const undeclaredResourceResult = JSON.parse(await skillResourceTool.handler({
    skillId: 'teach',
    path: '../_shared/undeclared.md'
  }, {} as never))
  assert.match(undeclaredResourceResult.error, /not declared/)
  await writeFile(join(personalSharedRoot, 'undeclared.md'), '# Undeclared personal\n', 'utf8')
  const escapedResourceResult = JSON.parse(await skillResourceTool.handler({ skillId: 'teach', path: '../outside.md' }, {} as never))
  assert.match(escapedResourceResult.error, /escapes/)
  const sharedEscapeResult = JSON.parse(await skillResourceTool.handler({
    skillId: 'teach',
    path: '../_shared/../../outside.md'
  }, {} as never))
  assert.match(sharedEscapeResult.error, /escapes/)
  const outsideSharedRoot = join(root, 'outside-shared')
  await mkdir(outsideSharedRoot, { recursive: true })
  await writeFile(join(outsideSharedRoot, 'private.md'), '# Outside shared root\n', 'utf8')
  const outsideSharedTool = createReadSkillResourceTool([{
    ...references[0]!,
    sharedRoot: outsideSharedRoot
  }])
  assert.ok(outsideSharedTool)
  const outsideSharedResult = JSON.parse(await outsideSharedTool.handler({
    skillId: 'teach',
    path: '../_shared/private.md'
  }, {} as never))
  assert.match(outsideSharedResult.error, /escapes/)
  const inferredReferences = await service.readInvokedSkillReferences('/teach explain closures')
  assert.deepEqual(inferredReferences.map((reference) => reference.id), ['teach'])
  const systemPrompt = buildAgentChatSystemPrompt({
    mode: 'temporary',
    lessonToolEnabled: false,
    skillReferences: references
  })
  assert.match(systemPrompt, /<skill-index>/)
  assert.match(systemPrompt, /id=teach/)
  // Full kernel body stays in turn-tail (ADR-0044 / ADR-0151), not stable system prefix.
  const turnTail = composeTeachingUserTurn({
    mode: 'temporary',
    lessonToolEnabled: false,
    skillReferences: references
  })
  assert.match(turnTail, /<teach-skill-reference/)
  assert.match(turnTail, /Use retrieval practice/)
  assert.match(turnTail, /progressive disclosure/i)
  assert.match(turnTail, /SKILL\.md/)
  assert.match(turnTail, /load only the referenced resources/i)

  const parsedPayload = parseAgentChatStreamPayload({
    mode: 'temporary',
    messages: [],
    userInput: '/teach explain closures',
    skillIds: ['teach', 'teach', '../escape']
  })
  assert.deepEqual(parsedPayload.skillIds, ['teach', '../escape'])

  const installedSkills = afterInstall.skills.filter((skill) => skill.installed)
  assert.equal(skillSlashQuery('/'), '')
  assert.equal(skillSlashQuery('/te'), 'te')
  assert.equal(skillSlashQuery('/teach something'), null)
  assert.deepEqual(filterSkillSlashMatches('/te', installedSkills).map((skill) => skill.id), ['teach'])
  assert.deepEqual(leadingSkillIds('/teach explain closures', installedSkills), ['teach'])
  assert.deepEqual(leadingSkillIds('explain closures', installedSkills), [])

  await assert.rejects(() => service.installSkill('../escape'), /Invalid skill id/)
  await assert.rejects(() => service.installSkill('unlisted-skill'), /allowlisted/i)
  await assert.rejects(() => service.installSkill('course-designer'), /not found/i)

  const forbiddenManifest = {
    schemaVersion: 1,
    id: 'teach',
    version: '1.0.0',
    capabilities: ['read-resources'],
    resources: [
      { path: 'SKILL.md', kind: 'instructions' },
      { path: 'run.js', kind: 'reference' }
    ],
    scripts: { install: 'node run.js' },
    activation: { hidden: true },
    marketplace: { slug: 'teach' }
  }
  assert.equal(skillPackManifestSchema.safeParse(forbiddenManifest).success, false)
  assert.equal(skillPackManifestSchema.safeParse({
    schemaVersion: 1,
    id: 'teach',
    version: '1.0.0',
    capabilities: ['execute-scripts'],
    resources: [{ path: 'SKILL.md', kind: 'instructions' }]
  }).success, false)

  const invalidBuiltInRoot = join(root, 'invalid-builtin')
  const invalidTeachRoot = join(invalidBuiltInRoot, 'teach')
  await mkdir(invalidTeachRoot, { recursive: true })
  await writeFile(join(invalidTeachRoot, 'SKILL.md'), '# Invalid manifest\n', 'utf8')
  await writeFile(join(invalidTeachRoot, 'run.js'), 'process.exit(1)\n', 'utf8')
  await writeFile(join(invalidTeachRoot, 'skill-pack.json'), JSON.stringify(forbiddenManifest), 'utf8')
  const invalidService = new SkillLibraryService({
    builtInRoots: [invalidBuiltInRoot],
    personalRoot: join(root, 'invalid-personal')
  })
  await assert.rejects(() => invalidService.installSkill('teach'), /invalid skill pack manifest/i)

  const symlinkBuiltInRoot = join(root, 'symlink-builtin')
  const symlinkTeachRoot = join(symlinkBuiltInRoot, 'teach')
  const outsideReference = join(root, 'outside-reference.md')
  await mkdir(symlinkTeachRoot, { recursive: true })
  await writeFile(join(symlinkTeachRoot, 'SKILL.md'), '# Symlink pack\n', 'utf8')
  await writeFile(outsideReference, '# Outside\n', 'utf8')
  let symlinkSupported = true
  try {
    await symlink(outsideReference, join(symlinkTeachRoot, 'REFERENCE.md'))
  } catch (error) {
    // Windows without Developer Mode / elevated privileges often returns EPERM for symlink.
    if ((error as NodeJS.ErrnoException).code === 'EPERM' || (error as NodeJS.ErrnoException).code === 'ENOTSUP') {
      symlinkSupported = false
    } else {
      throw error
    }
  }
  if (symlinkSupported) {
    await writeFile(join(symlinkTeachRoot, 'skill-pack.json'), JSON.stringify({
      schemaVersion: 1,
      id: 'teach',
      version: '1.0.0',
      capabilities: ['read-resources'],
      resources: [
        { path: 'SKILL.md', kind: 'instructions' },
        { path: 'REFERENCE.md', kind: 'reference' }
      ]
    }), 'utf8')
    const symlinkService = new SkillLibraryService({
      builtInRoots: [symlinkBuiltInRoot],
      personalRoot: join(root, 'symlink-personal')
    })
    await assert.rejects(() => symlinkService.installSkill('teach'), /regular file|symbolic links/i)
  }

  const legacyRoot = join(personalRoot, 'legacy-skill')
  await mkdir(legacyRoot, { recursive: true })
  await writeFile(join(legacyRoot, 'SKILL.md'), '---\nname: legacy-skill\n---\n\n# Legacy\n', 'utf8')
  const legacyCatalog = await service.listSkills()
  assert.equal(legacyCatalog.skills.find((skill) => skill.id === 'legacy-skill')?.version, undefined)
  assert.deepEqual(
    (await service.readInstalledSkillReferences(['legacy-skill'])).map((reference) => reference.id),
    ['legacy-skill']
  )

  const brokenRoot = join(personalRoot, 'broken-skill')
  await mkdir(brokenRoot, { recursive: true })
  await writeFile(join(brokenRoot, 'SKILL.md'), '# Broken\n', 'utf8')
  await writeFile(join(brokenRoot, 'skill-pack.json'), '{"schemaVersion":99}', 'utf8')
  assert.equal((await service.listSkills()).skills.some((skill) => skill.id === 'broken-skill'), false)

  // Personal pack corruption / escape must not remove core Teaching Kernel load.
  await rm(join(personalRoot, 'teach', 'REFERENCE.md'), { force: true })
  if (symlinkSupported) {
    await symlink(outsideReference, join(personalRoot, 'teach', 'REFERENCE.md'))
  } else {
    // Without symlink privilege, corrupt personal REFERENCE with a directory to prove
    // personal install state does not gate core kernel body load.
    await mkdir(join(personalRoot, 'teach', 'REFERENCE.md'), { recursive: true })
  }
  const coreAfterPersonalEscape = await service.readInstalledSkillReferences(['teach'])
  assert.equal(coreAfterPersonalEscape.length, 1)
  assert.equal(coreAfterPersonalEscape[0]?.id, 'teach')
  assert.match(coreAfterPersonalEscape[0]?.content ?? '', /Use retrieval practice/)
  const escapedPersonalTool = createReadSkillResourceTool(coreAfterPersonalEscape)
  assert.ok(escapedPersonalTool)
  const coreReferenceResource = JSON.parse(await escapedPersonalTool.handler({
    skillId: 'teach',
    path: 'REFERENCE.md'
  }, {} as never))
  assert.equal(coreReferenceResource.path, 'REFERENCE.md')
  assert.match(coreReferenceResource.content, /# Reference/)

  const repositoryBuiltIns = new SkillLibraryService({
    builtInRoots: [join(process.cwd(), 'resources', 'builtin-skills')],
    personalRoot: join(root, 'repository-personal')
  })
  const repositoryCatalog = await repositoryBuiltIns.listSkills()
  assert.deepEqual(
    repositoryCatalog.skills.map((skill) => skill.id).sort(),
    [...BUILTIN_SKILL_IDS].sort()
  )
  const repositoryKernel = await repositoryBuiltIns.readCoreTeachingKernel()
  assert.equal(repositoryKernel.id, 'teach')
  assert.ok(repositoryKernel.content.length > 100)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('check:skill-library passed')
