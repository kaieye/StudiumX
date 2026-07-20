import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { inspect } from '../../src/main/teaching-workspace-inspector'

const tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-teaching-workspace-inspector-'))

try {
  const cleanRoot = join(tempRoot, 'clean')
  await scaffoldWorkspace(cleanRoot, {
    index: {
      id: 'workspace-clean',
      name: 'Clean',
      rootPath: cleanRoot,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      lessons: []
    }
  })

  const beforeClean = await treeSnapshot(cleanRoot)
  const cleanReport = await inspect(cleanRoot)
  assert.equal(cleanReport.readOnly, true)
  assert.equal(cleanReport.schemaVersion, 1)
  assert.equal(cleanReport.status, 'ok')
  assert.deepEqual(cleanReport.findings, [])
  assert.deepEqual(await treeSnapshot(cleanRoot), beforeClean, 'inspect must not mutate a clean workspace')

  const brokenRoot = join(tempRoot, 'broken')
  const lessonRelative = 'courses/quantum/lesson/0001-wave-functions.html'
  const unindexedRelative = 'courses/quantum/lesson/0002-only-disk.html'
  await scaffoldWorkspace(brokenRoot, {
    extraFiles: {
      [lessonRelative]: '<!doctype html><title>Wave</title>',
      [unindexedRelative]: '<!doctype html><title>Disk only</title>',
      'lessons/.studiumx-lesson-stage-11111111-2222-3333-4444-555555555555/pending.html': '<html></html>',
      'MISSION.md': '# Mission: Broken\n'
      // intentionally omit RESOURCES and several scaffold files
    },
    omit: ['RESOURCES.md', 'GLOSSARY.md', 'NOTES.md', 'assets/quiz.js'],
    index: {
      lessons: [
        {
          id: '0001',
          title: 'Wave Functions',
          objective: 'Understand wave functions',
          prompt: 'Teach wave functions',
          createdAt: '2026-07-01T00:00:00.000Z',
          durationMinutes: 12,
          courseId: 'course-1',
          courseName: 'Quantum',
          courseRelativePath: 'courses/quantum',
          courseAbsolutePath: join(brokenRoot, 'courses', 'quantum'),
          sessionId: 'lesson-0001',
          sessionName: 'Wave Functions',
          sessionRelativePath: 'courses/quantum/lesson',
          sessionAbsolutePath: join(brokenRoot, 'courses', 'quantum', 'lesson'),
          relativePath: lessonRelative,
          absolutePath: join(brokenRoot, ...lessonRelative.split('/'))
        },
        {
          id: '0003',
          title: 'Missing',
          objective: 'Missing on disk',
          prompt: 'Missing',
          createdAt: '2026-07-01T00:00:00.000Z',
          durationMinutes: 12,
          courseId: 'course-1',
          courseName: 'Quantum',
          courseRelativePath: 'courses/quantum',
          courseAbsolutePath: join(brokenRoot, 'courses', 'quantum'),
          sessionId: 'lesson-0003',
          sessionName: 'Missing',
          sessionRelativePath: 'courses/quantum/lesson',
          sessionAbsolutePath: join(brokenRoot, 'courses', 'quantum', 'lesson'),
          relativePath: 'courses/quantum/lesson/0003-missing.html',
          absolutePath: join(brokenRoot, 'courses', 'quantum', 'lesson', '0003-missing.html')
        }
      ],
      pathMeta: {
        'courses/ghost-folder': { archived: true }
      }
    }
  })

  // Corrupt a second index case for schema detection
  const invalidIndexRoot = join(tempRoot, 'invalid-index')
  await scaffoldWorkspace(invalidIndexRoot, {
    indexText: '{not-json'
  })

  const beforeBroken = await treeSnapshot(brokenRoot)
  const brokenReport = await inspect(brokenRoot)
  assert.equal(brokenReport.readOnly, true)
  assert.notEqual(brokenReport.status, 'ok')

  const codes = new Set(brokenReport.findings.map((finding) => finding.code))
  assert.equal(codes.has('missing_canonical_file'), true)
  assert.equal(codes.has('dangling_lesson_path') || codes.has('catalog_drift_missing_lesson'), true)
  assert.equal(codes.has('catalog_drift_unindexed_lesson'), true)
  assert.equal(codes.has('temp_artifact_present'), true)
  assert.equal(codes.has('dangling_path_meta'), true)

  for (const finding of brokenReport.findings) {
    assert.equal(typeof finding.code, 'string')
    assert.match(finding.severity, /^(info|warning|error)$/)
    assert.match(finding.repairability, /^(none|manual|safe_command)$/)
    if (finding.evidence.relativePath) {
      assert.doesNotMatch(finding.evidence.relativePath, /^[A-Za-z]:\\/)
      assert.doesNotMatch(finding.evidence.relativePath, /^\//)
    }
  }

  const serialized = JSON.stringify(brokenReport)
  assert.doesNotMatch(serialized, /C:\\\\Users/i)
  assert.equal(serialized.includes(brokenRoot), false, 'report must stay path-safe and omit absolute workspace roots')
  assert.deepEqual(await treeSnapshot(brokenRoot), beforeBroken, 'inspect must never auto-repair or delete artifacts')

  const invalidReport = await inspect(invalidIndexRoot)
  assert.equal(invalidReport.findings.some((finding) => finding.code === 'invalid_index_json'), true)
  assert.equal(invalidReport.status, 'error')

  console.log('teaching workspace inspector boundaries ok')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

async function scaffoldWorkspace(
  root: string,
  options: {
    index?: unknown
    indexText?: string
    extraFiles?: Record<string, string>
    omit?: string[]
  } = {}
): Promise<void> {
  const omit = new Set(options.omit ?? [])
  const files: Record<string, string> = {
    'MISSION.md': '# Mission: Clean\n\n## Why\nKeep inspect read-only.\n',
    'RESOURCES.md': '# Resources\n',
    'GLOSSARY.md': '# Glossary\n',
    'NOTES.md': '# Notes\n',
    'assets/lesson.css': 'body{}\n',
    'assets/quiz.js': 'export {}\n',
    'assets/flashcards.css': '.card{}\n',
    'assets/flashcards.js': 'export {}\n',
    ...(options.extraFiles ?? {})
  }

  await mkdir(root, { recursive: true })
  for (const dir of [
    'lessons',
    'conversation',
    'reference',
    'learning-records',
    'reviews',
    'assets',
    'learning-sessions',
    '.studiumx'
  ]) {
    await mkdir(join(root, dir), { recursive: true })
  }

  for (const [relativePath, content] of Object.entries(files)) {
    if (omit.has(relativePath)) continue
    const absolutePath = join(root, ...relativePath.split('/'))
    await mkdir(join(absolutePath, '..'), { recursive: true })
    await writeFile(absolutePath, content, 'utf8')
  }

  const indexPath = join(root, '.studiumx', 'index.json')
  if (typeof options.indexText === 'string') {
    await writeFile(indexPath, options.indexText, 'utf8')
  } else {
    await writeFile(indexPath, `${JSON.stringify(options.index ?? { lessons: [] }, null, 2)}\n`, 'utf8')
  }
}

async function treeSnapshot(root: string): Promise<string[]> {
  const results: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolutePath = join(current, entry.name)
      const relativePath = absolutePath.slice(root.length + 1).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        results.push(`${relativePath}/`)
        stack.push(absolutePath)
      } else {
        results.push(`${relativePath}:${await readFile(absolutePath, 'utf8')}`)
      }
    }
  }
  return results.sort()
}
