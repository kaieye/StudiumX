import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SkillLibraryService } from '../../src/main/skill-library'
import { createReadSkillResourceTool } from '../../src/main/ai/tools/skill-resource'
import { buildAgentChatSystemPrompt } from '../../src/main/teaching-conversation-runtime'
import { parseAgentChatStreamPayload } from '../../src/main/teaching-ipc-commands'
import {
  filterSkillSlashMatches,
  leadingSkillIds,
  skillSlashQuery
} from '../../src/shared/skill-command'

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
    installed: false
  })

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
  assert.equal(
    await readFile(join(personalSharedRoot, 'new-shared-resource.md'), 'utf8'),
    '# Newly bundled resource\n'
  )

  const afterInstall = await service.listSkills()
  assert.equal(afterInstall.skills.length, 1)
  assert.equal(afterInstall.skills[0]?.installed, true)
  assert.equal(afterInstall.skills[0]?.installedPath, join(personalRoot, 'teach'))

  const references = await service.readInstalledSkillReferences(['teach', '../escape', 'teach'])
  assert.equal(references.length, 1)
  assert.equal(references[0]?.id, 'teach')
  assert.match(references[0]?.content ?? '', /Use retrieval practice/)
  const skillResourceTool = createReadSkillResourceTool(references)
  assert.ok(skillResourceTool)
  const resourceResult = JSON.parse(await skillResourceTool.handler({ skillId: 'teach', path: 'REFERENCE.md' }, {} as never))
  assert.equal(resourceResult.skillId, 'teach')
  assert.equal(resourceResult.path, 'REFERENCE.md')
  assert.match(resourceResult.content, /# Reference/)
  const sharedResourceResult = JSON.parse(await skillResourceTool.handler({
    skillId: 'teach',
    path: '../_shared/domain-primitives.md'
  }, {} as never))
  assert.equal(sharedResourceResult.skillId, 'teach')
  assert.equal(sharedResourceResult.path, '../_shared/domain-primitives.md')
  assert.match(sharedResourceResult.content, /# Personal domain primitives/)
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
  assert.match(systemPrompt, /<teach-skill-reference/)
  assert.match(systemPrompt, /Use retrieval practice/)
  assert.match(systemPrompt, /progressive disclosure/i)
  assert.match(systemPrompt, /SKILL\.md/)
  assert.match(systemPrompt, /load only the referenced resources/i)

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
  await assert.rejects(() => service.installSkill('missing'), /not found/i)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log('check:skill-library passed')
