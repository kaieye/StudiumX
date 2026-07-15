import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { buildWorkspaceCatalog } from '../../src/main/teaching-workspace-catalog'
import { readLearningAssetCatalog } from '../../src/main/teaching-workspace/learning-assets-catalog'
import { planLessonIndexReconciliation } from '../../src/main/teaching-workspace/catalog-reconciliation'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'

const temporaryRoots: string[] = []

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'studiumx-learning-assets-catalog-'))
  temporaryRoots.push(rootPath)
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(rootPath, relativePath)
    await mkdir(join(absolutePath, '..'), { recursive: true })
    await writeFile(absolutePath, content, 'utf8')
  }
  return rootPath
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

describe('learning asset catalog', () => {
  it('projects Mission, resources, records, and reference files while excluding Agent conversation Markdown', async () => {
    const rootPath = await createWorkspace({
      'MISSION.md': '# Mission: Become a confident tester\n\n## Why\n- Ship changes with evidence.\n\n## Success\n- Diagnose failures quickly.\n',
      'RESOURCES.md': '# Resources\n\n## Official\n- [Vitest](https://vitest.dev) Testing framework\n- Team guide: Run narrow checks first\n\n## Notes\n- Evidence — Keep the test output\n',
      'lessons/0001-testing-basics.html': '<!doctype html><title>Lesson</title>',
      'reference/0001-testing-basics-reference.html': '<!doctype html><title>Reference</title>',
      'lessons/conversation/chat-001.md': '# Agent conversation\n\nThis must not become a learning record.\n',
      'learning-records/0001-testing-reflection.md': '# Testing reflection\n\nI can now choose a narrow regression test.\n'
    })

    const catalog = await readLearningAssetCatalog(rootPath, 'Testing workspace')

    expect(catalog.mission).toEqual({
      title: 'Become a confident tester',
      excerpt: 'Ship changes with evidence.'
    })
    expect(catalog.resources).toEqual([
      { title: 'Vitest', detail: 'Testing framework', tag: 'Official' },
      { title: 'Team guide', detail: 'Run narrow checks first', tag: 'Official' },
      { title: 'Evidence', detail: 'Keep the test output', tag: 'Notes' }
    ])
    expect(catalog.records).toHaveLength(1)
    expect(catalog.records[0]).toMatchObject({
      title: 'Testing reflection',
      relativePath: 'learning-records/0001-testing-reflection.md',
      absolutePath: join(rootPath, 'learning-records', '0001-testing-reflection.md')
    })
    expect(catalog.records[0]?.date).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/)
    expect(catalog.referenceCount).toBe(1)
    expect(catalog).toMatchObject({
      missionPath: join(rootPath, 'MISSION.md'),
      resourcesPath: join(rootPath, 'RESOURCES.md'),
      recordsDir: join(rootPath, 'learning-records'),
      referenceDir: join(rootPath, 'reference')
    })

    await expect(buildWorkspaceCatalog({ id: 'workspace-1', name: 'Testing workspace', rootPath }, { lessons: [] }))
      .resolves.toMatchObject({
        missionTitle: 'Become a confident tester',
        resources: catalog.resources,
        records: [{ relativePath: 'learning-records/0001-testing-reflection.md' }],
        referenceCount: 1
      })
  })

  it('keeps marker-spoofed and unbound assessment-looking files as legacy Lessons', async () => {
    const rootPath = await createWorkspace({
      'lessons/0001-testing-basics.html': '<!doctype html><title>Lesson</title>',
      'lessons/0001-testing-basics-assessment.html': '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <title>Testing basics assessment</title>\n  <meta name="studiumx-artifact-kind" content="assessment-sidecar">\n</head>\n<body>\n</body>\n</html>\n',
      'lessons/0002-assessment.html': '<!doctype html><title>Assessment</title>',
      'lessons/0003-foo-assessment.html': '<!doctype html><title>Foo Assessment</title>',
      'lessons/0004-legacy-assessment.html': '<!doctype html><title>Legacy normal Lesson</title>'
    })
    const plan = await planLessonIndexReconciliation({
      rootPath,
      workspaceName: 'Testing workspace',
      workspaceId: 'workspace-1',
      lessons: []
    })

    expect(plan.recoveredRelativePaths).toEqual([
      'lessons/0001-testing-basics-assessment.html',
      'lessons/0001-testing-basics.html',
      'lessons/0002-assessment.html',
      'lessons/0003-foo-assessment.html',
      'lessons/0004-legacy-assessment.html'
    ])
  })

  it('hides only a safely-read sidecar immutably claimed by its matching canonical Session', async () => {
    const normal = '<!doctype html><title>Lesson</title>'
    const assessment = '<!doctype html><html><head><title>Assessment</title></head><body></body></html>'
    const rootPath = await createWorkspace({
      'lessons/0001-testing-basics.html': normal,
      'lessons/0001-testing-basics-assessment.html': assessment
    })
    const ledger = createLearningSessionLedger({ workspaceRoot: rootPath })
    await ledger.open({
      sessionId: 'lesson-0001',
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'testing-workspace', courseName: 'Testing workspace', relativePath: 'lessons' },
      lessonRef: {
        lessonId: '0001',
        title: 'Testing basics',
        relativePath: 'lessons/0001-testing-basics.html',
        assessment: {
          relativePath: 'lessons/0001-testing-basics-assessment.html',
          contentSha256: createHash('sha256').update(assessment).digest('hex')
        }
      }
    })

    const plan = await planLessonIndexReconciliation({
      rootPath,
      workspaceName: 'Testing workspace',
      workspaceId: 'workspace-1',
      lessons: []
    })

    expect(plan.recoveredRelativePaths).toEqual(['lessons/0001-testing-basics.html'])
  })

  it('retains a claimed sidecar when its immutable digest or parsed bytes no longer match', async () => {
    const rootPath = await createWorkspace({
      'lessons/0001-testing-basics.html': '<!doctype html><title>Lesson</title>',
      'lessons/0001-testing-basics-assessment.html': '<!doctype html><html><body><div broken></body></html>'
    })
    const ledger = createLearningSessionLedger({ workspaceRoot: rootPath })
    await ledger.open({
      sessionId: 'lesson-0001', workspaceId: 'workspace-1',
      courseRef: { courseId: 'testing-workspace', courseName: 'Testing workspace', relativePath: 'lessons' },
      lessonRef: { lessonId: '0001', title: 'Testing basics', relativePath: 'lessons/0001-testing-basics.html', assessment: {
        relativePath: 'lessons/0001-testing-basics-assessment.html', contentSha256: 'a'.repeat(64)
      } }
    })
    const plan = await planLessonIndexReconciliation({ rootPath, workspaceName: 'Testing workspace', workspaceId: 'workspace-1', lessons: [] })
    expect(plan.recoveredRelativePaths).toContain('lessons/0001-testing-basics-assessment.html')
  })

  it('keeps the existing empty workspace fallbacks', async () => {
    const rootPath = await createWorkspace({})

    await expect(readLearningAssetCatalog(rootPath, 'Empty workspace')).resolves.toMatchObject({
      mission: { title: 'Empty workspace', excerpt: '等待补充学习使命。' },
      resources: [{ title: 'RESOURCES.md', detail: '等待添加首批可信资源。', tag: 'Gaps' }],
      records: [],
      referenceCount: 0
    })
  })
})
