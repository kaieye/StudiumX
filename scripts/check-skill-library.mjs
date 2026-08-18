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
  const [app, skillView, slashMenu, mainIndex, ipcGateway, preload, contract, packageJson, builtinSkill, sharedSchema, teachingSiteSkill] = await Promise.all([
    readFile(join(process.cwd(), 'src', 'renderer', 'src', 'App.tsx'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'renderer', 'src', 'views', 'resources', 'SkillLibrary.tsx'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'renderer', 'src', 'skills', 'SkillSlashMenu.tsx'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'main', 'teaching-ipc-gateway.ts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8'),
    readFile(join(process.cwd(), 'src', 'shared', 'teaching-ipc-contract.ts'), 'utf8'),
    readFile(join(process.cwd(), 'package.json'), 'utf8'),
    readFile(join(process.cwd(), 'resources', 'builtin-skills', 'teach', 'SKILL.md'), 'utf8'),
    readFile(join(process.cwd(), 'resources', 'builtin-skills', '_shared', 'domain-primitives.md'), 'utf8'),
    readFile(join(process.cwd(), 'resources', 'builtin-skills', 'teaching-site', 'SKILL.md'), 'utf8')
  ])
  assert.match(app, /resourcePageSection === 'skills'[\s\S]*<SkillLibrary/)
  assert.match(app, /<ResourceHome[\s\S]*onOpenSkills=/)
  assert.match(skillView, /window\.teachingSystem\.installSkill\(skill\.id\)/)
  assert.match(skillView, /announceSkillCatalogChanged\(\)/)
  assert.match(skillView, /<strong>\{skill\.name\}<\/strong>/)
  assert.doesNotMatch(skillView, /<code>\{skill\.command\}<\/code>/)
  assert.match(slashMenu, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/)
  assert.match(slashMenu, /event\.key === 'Enter' \|\| event\.key === 'Tab'/)
  assert.match(slashMenu, /event\.key === 'Escape'/)
  assert.match(mainIndex, /join\(process\.resourcesPath, 'builtin-skills'\)/)
  assert.match(ipcGateway, /teachingInvokeChannels\.installSkill/)
  assert.match(preload, /installSkill: \(skillId\) => ipcRenderer\.invoke\(teachingInvokeChannels\.installSkill, skillId\)/)
  assert.match(contract, /listSkills: 'teach:list-skills'/)
  assert.match(contract, /installSkill: 'teach:install-skill'/)
  assert.deepEqual(JSON.parse(packageJson).build.extraResources, [
    { from: 'resources/builtin-skills', to: 'builtin-skills' },
    { from: 'resources/sandbox', to: 'sandbox' }
  ])
  assert.match(builtinSkill, /name: teach/)
  assert.match(builtinSkill, /category: learning/)
  assert.match(sharedSchema, /## 0\. Canonical Project Paths/)
  assert.match(sharedSchema, /## 13\. Cross-File Consistency/)
  assert.match(teachingSiteSkill, /StudiumX loads an installed skill only through an explicit leading slash command/)
  assert.doesNotMatch(teachingSiteSkill, /activate_skill|Claude Code:|Codex: `skill` tool/)

  // ADR-0014: every shipped skill declares the same human-readable
  // governance contract. The host registry remains authoritative, but these
  // declarations prevent a skill body from silently losing its role, I/O,
  // artifact boundary, completion gate, or non-responsibilities.
  const builtinSkillContracts = {
    'course-content-authoring': ['artifact_producer', 'artifact_authoring', 'CourseOutline', 'CourseContent', 'course-package/day*/content.md', 'course-outline-design'],
    'course-corporate-edition': ['variant_producer', 'package', 'CourseContent', 'CorporateEdition', 'course-package/corporate/**', 'course-content-authoring'],
    'course-designer': ['workflow_router', 'ground, artifact_authoring', 'CourseBrief', 'CourseWorkflowPlan', '—', '—'],
    'course-ebook-publishing': ['packager', 'package', 'CourseContent, StaticSpa', 'CourseEbook', 'course-package/ebook/**', 'course-content-authoring'],
    'course-outline-design': ['artifact_producer', 'artifact_authoring', 'CourseBrief', 'CourseOutline', 'course-package/outline.md', '—'],
    'learning-assessor': ['teaching_strategy', 'diagnose, elicit', 'LearningObjective, LearnerLevel', 'AssessmentRubric, ElicitationPlan', '—', '—'],
    'static-spa-conversion': ['artifact_producer', 'artifact_authoring', 'CourseContent, TeachingSitePlan', 'StaticSpa', 'teaching-site/spa/**', '—'],
    'static-spa-interactions': ['cross_cutting_enhancer', 'enhance', 'StaticSpa', 'StaticSpaInteractions', 'teaching-site/spa/**', 'static-spa-conversion'],
    teach: ['kernel', 'ground, teach, elicit', '—', '—', '—', '—'],
    'teaching-resource-generator': ['artifact_producer', 'artifact_authoring', 'LearningObjective, LearnerLevel, Misconception, CourseContent', 'LessonAsset, ExerciseSet', 'lesson-assets/**`, `course-package/day*/content.md', '—'],
    'teaching-site-design-system': ['cross_cutting_enhancer', 'enhance', 'StaticSpa, TeachingSitePlan', 'DesignSystemTokens', 'teaching-site/design/**', '—'],
    'teaching-site': ['workflow_router', 'ground, artifact_authoring', 'CourseContent, CourseOutline', 'TeachingSitePlan', 'teaching-site/**', '—'],
    'web-content-audit': ['verifier', 'verify', 'StaticSpa, CourseContent', 'ContentAuditReport', '—', '—'],
    'web-visual-assets': ['cross_cutting_enhancer', 'enhance', 'StaticSpa, CourseContent', 'VisualAssets', 'teaching-site/assets/**', '—'],
    'web-visual-verification': ['verifier', 'verify', 'VisualAssets, StaticSpa', 'VisualVerificationReport', '—', '—']
  }
  const builtinSkillDocs = Object.fromEntries(await Promise.all(
    Object.keys(builtinSkillContracts).map(async (id) => [
      id,
      await readFile(join(process.cwd(), 'resources', 'builtin-skills', id, 'SKILL.md'), 'utf8')
    ])
  ))
  for (const [id, [role, stages, consumes, produces, artifactScope, requires]] of Object.entries(builtinSkillContracts)) {
    const skill = builtinSkillDocs[id]
    assert.match(skill, new RegExp(`^name: ${id}$`, 'm'), `${id} must retain its public skill id`)
    assert.ok(skill.includes(`> - **角色：** \`${role}\``), `${id} must declare its role`)
    assert.ok(skill.includes(`> - **阶段：** \`${stages}\``), `${id} must declare its stages`)
    assert.ok(skill.includes(`> - **消费：** \`${consumes}\``), `${id} must declare its inputs`)
    assert.ok(skill.includes(`> - **产出：** \`${produces}\``), `${id} must declare its outputs`)
    assert.ok(skill.includes(`> - **产物范围：** \`${artifactScope}\``), `${id} must declare its artifact scope`)
    assert.ok(skill.includes(`> - **前置依赖：** \`${requires}\``), `${id} must declare its dependencies`)
    assert.match(skill, /^> - \*\*完成门槛：\*\* .+$/m, `${id} must declare a completion gate`)
    assert.match(skill, /^> - \*\*非职责：\*\* .+$/m, `${id} must declare non-responsibilities`)
    assert.match(skill, /本块是文档，不是信任权威；与 host registry 冲突时以 registry 为准。/, `${id} must keep host authority explicit`)
  }

  const courseDesignerSkill = builtinSkillDocs['course-designer']
  assert.match(courseDesignerSkill, /课程设计入口的\*\*兼容路由层\*\*/)
  assert.match(courseDesignerSkill, /无结构 → `course-outline-design`/)
  assert.match(courseDesignerSkill, /已有 outline → `course-content-authoring`/)
  assert.match(courseDesignerSkill, /advisory mode（本技能直接回答，不产出产物）/)
  assert.match(courseDesignerSkill, /不会\*\*自动激活或执行未安装的子 skill/)
  assert.doesNotMatch(courseDesignerSkill, /N\+1|部署监控|技术栈|框架依赖/)
  assert.match(builtinSkillDocs['static-spa-conversion'], /Legacy Chinese names .* are deprecated/)
  assert.match(builtinSkillDocs['course-corporate-edition'], /Legacy Chinese names .* are deprecated/)

  const learningAssessorSkill = builtinSkillDocs['learning-assessor']
  assert.match(learningAssessorSkill, /Assessment Authoring/)
  assert.match(learningAssessorSkill, /Elicitation Strategy/)
  assert.match(learningAssessorSkill, /Evidence Interpretation Hint/)
  assert.match(learningAssessorSkill, /rubric 是评估工具，不是 Evidence/)
  assert.match(learningAssessorSkill, /模型生成的参考答案不是 learner response/)
  assert.match(learningAssessorSkill, /没有证据时只能说「未知 \/ 待验证」，不能推断「已掌握」/)

  const resourceGeneratorSkill = builtinSkillDocs['teaching-resource-generator']
  for (const typedInput of ['LearningObjective', 'LearnerLevel', 'Misconception', 'CourseContent']) {
    assert.match(resourceGeneratorSkill, new RegExp(`\`${typedInput}\``), `resource generator must name ${typedInput} as input`)
  }
  for (const output of ['LessonAsset', 'ExerciseSet', 'CaseStudy', 'StudyGuide']) {
    assert.match(resourceGeneratorSkill, new RegExp(`\\*\\*${output}\\*\\*`), `resource generator must name ${output} as an output type`)
  }
  assert.match(resourceGeneratorSkill, /绝不同时写同一文件/)
  assert.match(resourceGeneratorSkill, /sessionId.*eventId.*sequence/)
  assert.match(resourceGeneratorSkill, /不复制敏感正文/)
  assert.match(resourceGeneratorSkill, /不自行判定 mastery/)

  assert.match(teachingSiteSkill, /## Stage 1 Gate \(Hard Rule — read before any dispatch\)/)
  assert.match(teachingSiteSkill, /## Stage 2 Gate \(Hard Rule — read before dispatching to Stage 3\+\)/)
  assert.match(teachingSiteSkill, /Do not invoke them while Stages 1–5 are still in flux/)
  assert.match(teachingSiteSkill, /Does not write any code itself — always dispatches to a sub-skill/)

  // ADR-0014: app-shipped Teaching Kernel loader must exist and fail closed.
  const coreKernel = await readFile(join(process.cwd(), 'src', 'main', 'skill-library', 'core-teaching-kernel.ts'), 'utf8')
  const skillLibrary = await readFile(join(process.cwd(), 'src', 'main', 'skill-library.ts'), 'utf8')
  const conversationRuntime = await readFile(join(process.cwd(), 'src', 'main', 'teaching-conversation-runtime.ts'), 'utf8')
  assert.match(coreKernel, /CORE_TEACHING_KERNEL_ID/)
  assert.match(coreKernel, /loadCoreTeachingKernelReference/)
  assert.match(coreKernel, /CoreTeachingKernelError/)
  assert.match(coreKernel, /fail-closed|Fail-closed/)
  assert.match(skillLibrary, /readCoreTeachingKernel/)
  assert.match(skillLibrary, /isCoreTeachingKernelId/)
  assert.match(conversationRuntime, /Teaching Kernel unavailable/)
  assert.match(conversationRuntime, /ADR-0014/)

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
