import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tempParent = join(process.cwd(), '.studiumx')
await mkdir(tempParent, { recursive: true })
const tempRoot = await mkdtemp(join(tempParent, 'skill-library-check-'))
const outfile = join(tempRoot, 'skill-library.mjs')

try {
  const [app, skillView, slashMenu, mainIndex, preload, contract, packageJson, builtinSkill] = await Promise.all([
    readFile(join(process.cwd(), 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'renderer', 'src', 'views', 'resources', 'SkillLibrary.tsx'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'renderer', 'src', 'skills', 'SkillSlashMenu.tsx'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'shared', 'teaching-ipc-contract.ts'), 'utf8'),
    readFile(join(process.cwd(), 'package.json'), 'utf8'),
    readFile(join(process.cwd(), 'resources', 'builtin-skills', 'teach', 'SKILL.md'), 'utf8')
  ])
  assert.match(app, /resourcePageSection === 'skills'[\s\S]*<SkillLibrary/)
  assert.match(app, /<ResourceHome[\s\S]*onOpenSkills=/)
  assert.match(skillView, /window\.teachingSystem\.installSkill\(skill\.id\)/)
  assert.match(skillView, /announceSkillCatalogChanged\(\)/)
  assert.match(slashMenu, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/)
  assert.match(slashMenu, /event\.key === 'Enter' \|\| event\.key === 'Tab'/)
  assert.match(slashMenu, /event\.key === 'Escape'/)
  assert.match(mainIndex, /join\(process\.resourcesPath, 'builtin-skills'\)/)
  assert.match(mainIndex, /ipcMain\.handle\(teachingInvokeChannels\.installSkill/)
  assert.match(preload, /installSkill: \(skillId\) => ipcRenderer\.invoke\(teachingInvokeChannels\.installSkill, skillId\)/)
  assert.match(contract, /listSkills: 'teach:list-skills'/)
  assert.match(contract, /installSkill: 'teach:install-skill'/)
  assert.deepEqual(JSON.parse(packageJson).build.extraResources, [
    { from: 'resources/builtin-skills', to: 'builtin-skills' }
  ])
  assert.match(builtinSkill, /name: teach/)
  assert.match(builtinSkill, /category: learning/)

  await build({
    absWorkingDir: process.cwd(),
    entryPoints: [join(process.cwd(), 'scripts', 'fixtures', 'skill-library.ts')],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent'
  })
  await import(pathToFileURL(outfile).href)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
