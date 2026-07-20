import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { inspect } from '../../src/main/teaching-workspace-inspector'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createRoot(files: Record<string, string | null> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-workspace-inspector-'))
  roots.push(root)
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, ...relativePath.split('/'))
    if (content === null) {
      await mkdir(absolutePath, { recursive: true })
      continue
    }
    await mkdir(join(absolutePath, '..'), { recursive: true })
    await writeFile(absolutePath, content, 'utf8')
  }
  return root
}

function scaffold(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    'MISSION.md': '# Mission: Inspector\n\n## Why\nTest.\n',
    'RESOURCES.md': '# Resources\n',
    'GLOSSARY.md': '# Glossary\n',
    'NOTES.md': '# Notes\n',
    'assets/lesson.css': 'body{}\n',
    'assets/quiz.js': 'export {}\n',
    'assets/flashcards.css': '.card{}\n',
    'assets/flashcards.js': 'export {}\n',
    lessons: null,
    conversation: null,
    reference: null,
    'learning-records': null,
    reviews: null,
    'learning-sessions': null,
    '.studiumx/index.json': JSON.stringify({
      id: 'workspace-1',
      name: 'Inspector',
      rootPath: 'ignored-absolute',
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      lessons: []
    }, null, 2),
    ...overrides
  }
}

function lessonEntry(relativePath: string, absolutePath: string) {
  return {
    id: '0001',
    title: 'Wave Functions',
    objective: 'Understand wave functions',
    prompt: 'Teach wave functions',
    createdAt: '2026-07-01T00:00:00.000Z',
    durationMinutes: 12,
    courseId: 'course-1',
    courseName: 'Quantum',
    courseRelativePath: 'courses/quantum',
    courseAbsolutePath: '/ignored/course',
    sessionId: 'lesson-0001',
    sessionName: 'Wave Functions',
    sessionRelativePath: 'courses/quantum/lesson',
    sessionAbsolutePath: '/ignored/session',
    relativePath,
    absolutePath
  }
}

describe('TeachingWorkspaceInspector', () => {
  it('reports a clean scaffold as ok and never writes files', async () => {
    const root = await createRoot(scaffold())
    const before = await snapshotTree(root)

    const report = await inspect(root)

    expect(report.readOnly).toBe(true)
    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('ok')
    expect(report.findings).toEqual([])
    expect(report.summary).toEqual({
      findingCount: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0
    })
    expect(await snapshotTree(root)).toEqual(before)
  })

  it('flags missing canonical files and directories without creating them', async () => {
    const root = await createRoot({
      '.studiumx/index.json': JSON.stringify({ lessons: [] })
    })
    const before = await snapshotTree(root)

    const report = await inspect(root)

    expect(['warning', 'error']).toContain(report.status)
    expect(report.findings.some((finding) => finding.code === 'missing_canonical_directory' && finding.evidence.relativePath === 'lessons')).toBe(true)
    expect(report.findings.some((finding) => finding.code === 'missing_canonical_file' && finding.evidence.relativePath === 'MISSION.md')).toBe(true)
    expect(report.findings.every((finding) => finding.repairability === 'safe_command' || finding.repairability === 'manual' || finding.repairability === 'none')).toBe(true)
    expect(await fileExists(join(root, 'MISSION.md'))).toBe(false)
    expect(await snapshotTree(root)).toEqual(before)
  })

  it('detects invalid index JSON and schema without rewriting the index', async () => {
    const root = await createRoot(scaffold({
      '.studiumx/index.json': '{ not-json'
    }))
    const beforeIndex = await readFile(join(root, '.studiumx', 'index.json'), 'utf8')

    const report = await inspect(root)

    expect(report.findings.some((finding) => finding.code === 'invalid_index_json')).toBe(true)
    expect(report.status).toBe('error')
    expect(await readFile(join(root, '.studiumx', 'index.json'), 'utf8')).toBe(beforeIndex)
  })

  it('detects dangling lesson links and pathMeta entries with path-safe evidence only', async () => {
    const root = await createRoot(scaffold({
      '.studiumx/index.json': JSON.stringify({
        lessons: [lessonEntry('courses/quantum/lesson/0001-wave.html', join('C:\\\\Users\\\\secret\\\\0001-wave.html'))],
        pathMeta: {
          'courses/quantum/lesson/0001-wave.html': { pinned: true },
          'courses/ghost': { archived: true }
        }
      }, null, 2)
    }))

    const report = await inspect(root)
    const serialized = JSON.stringify(report)

    expect(report.findings.some((finding) => finding.code === 'dangling_lesson_path' && finding.evidence.relativePath === 'courses/quantum/lesson/0001-wave.html')).toBe(true)
    expect(report.findings.some((finding) => finding.code === 'dangling_path_meta' && finding.evidence.relativePath === 'courses/ghost')).toBe(true)
    expect(serialized).not.toMatch(/C:\\\\Users\\\\secret/i)
    expect(serialized).not.toContain(root)
  })

  it('reports catalog drift from durable index vs filesystem, not catalog projections', async () => {
    const relativePath = 'courses/quantum/lesson/0001-wave-functions.html'
    const root = await createRoot(scaffold({
      [relativePath]: '<!doctype html><title>Wave Functions</title>',
      'courses/quantum/lesson/0002-only-on-disk.html': '<!doctype html><title>Only on disk</title>',
      '.studiumx/index.json': JSON.stringify({
        lessons: [
          lessonEntry(relativePath, join('/tmp/ignored', relativePath)),
          lessonEntry('courses/quantum/lesson/0003-only-in-index.html', join('/tmp/ignored', 'courses/quantum/lesson/0003-only-in-index.html'))
        ]
      }, null, 2)
    }))
    const beforeIndex = await readFile(join(root, '.studiumx', 'index.json'), 'utf8')

    const report = await inspect(root)

    expect(report.findings.some((finding) =>
      finding.code === 'catalog_drift_unindexed_lesson' &&
      finding.evidence.relativePath === 'courses/quantum/lesson/0002-only-on-disk.html'
    )).toBe(true)
    expect(report.findings.some((finding) =>
      finding.code === 'catalog_drift_missing_lesson' &&
      finding.evidence.relativePath === 'courses/quantum/lesson/0003-only-in-index.html'
    )).toBe(true)
    expect(report.findings.some((finding) => finding.evidence.relativePath === relativePath && finding.category === 'catalog_drift')).toBe(false)
    expect(await readFile(join(root, '.studiumx', 'index.json'), 'utf8')).toBe(beforeIndex)
  })

  it('flags temporary staging artifacts and never deletes them', async () => {
    const root = await createRoot(scaffold({
      'lessons/.studiumx-lesson-stage-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/pending.html': '<html></html>',
      '.studiumx/.index.json.12345.aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.tmp': '{partial}',
      'MISSION.md.tmp-9-stamp-id': 'leftover'
    }))
    const before = await snapshotTree(root)

    const report = await inspect(root)

    expect(report.findings.filter((finding) => finding.code === 'temp_artifact_present').length).toBeGreaterThanOrEqual(2)
    expect(report.findings.every((finding) => finding.code !== 'temp_artifact_present' || finding.repairability === 'safe_command')).toBe(true)
    expect(await snapshotTree(root)).toEqual(before)
  })

  it('never treats reference HTML as a Lesson index requirement', async () => {
    const root = await createRoot(scaffold({
      'reference/0001-wave-functions-reference.html': '<!doctype html><title>Reference</title>'
    }))

    const report = await inspect(root)

    expect(report.findings.some((finding) => finding.category === 'catalog_drift')).toBe(false)
  })
})

async function snapshotTree(root: string): Promise<string[]> {
  const results: string[] = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = join(current, entry.name)
      const relativePath = absolutePath.slice(root.length + 1).replace(/\\/g, '/')
      if (entry.isDirectory()) {
        results.push(`${relativePath}/`)
        stack.push(absolutePath)
      } else {
        const info = await stat(absolutePath)
        const content = await readFile(absolutePath, 'utf8')
        results.push(`${relativePath}:${info.size}:${content}`)
      }
    }
  }
  return results.sort()
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path).then((info) => info.isFile()).catch(() => false)
}

