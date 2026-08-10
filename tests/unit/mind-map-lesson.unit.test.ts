import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  MIND_MAP_LESSON_MAX_BYTES,
  MindMapLessonError,
  normalizeMindMapLessonWorkspacePath,
  resolveMindMapLesson
} from '../../src/main/mindmap/mind-map-selected-file'

const roots: string[] = []

async function workspaceRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `studiumx-lesson-${label}-`))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('normalizeMindMapLessonWorkspacePath', () => {
  it.each([
    ['lessons\\0001-intro.html', 'lessons/0001-intro.html'],
    ['courses/biology/lesson\\0002-cells.htm', 'courses/biology/lesson/0002-cells.htm'],
    ['lessons/course/session/0003-review.html', 'lessons/course/session/0003-review.html']
  ])('normalizes generated Lesson path %j', (input, expected) => {
    expect(normalizeMindMapLessonWorkspacePath(input)).toBe(expected)
  })

  it.each([
    'NOTES.md',
    'notes/reading.html',
    'courses/biology/lessons/0001-intro.html',
    'courses/biology/lesson/0001-intro.json',
    'courses/biology/lesson/0001-intro-assessment.html',
    'courses/biology/lesson/0001-intro-reference.html',
    '../lessons/0001-intro.html',
    '/private/lessons/0001-intro.html',
    'C:\\private\\lessons\\0001-intro.html',
    'lessons/unsafe\u0000.html'
  ])('rejects non-Lesson or unsafe path %j', (input) => {
    expect(normalizeMindMapLessonWorkspacePath(input)).toBeNull()
  })
})

describe('resolveMindMapLesson', () => {
  it('reads default and named-course Lesson artifacts with canonical metadata only', async () => {
    const root = await workspaceRoot('valid')
    const defaultPath = 'lessons/0001-intro.html'
    const namedPath = 'courses/biology/lesson/0002-cells.html'
    const defaultContent = '<html><body>Intro</body></html>'
    const namedContent = '<html><body>Cells</body></html>'
    await mkdir(join(root, 'lessons'), { recursive: true })
    await mkdir(join(root, 'courses', 'biology', 'lesson'), { recursive: true })
    await writeFile(join(root, defaultPath), defaultContent, 'utf8')
    await writeFile(join(root, namedPath), namedContent, 'utf8')

    const first = await resolveMindMapLesson(root, 'lessons\\0001-intro.html')
    const second = await resolveMindMapLesson(root, namedPath)

    expect(first).toMatchObject({
      sourceRef: {
        id: `lesson:${createHash('sha256').update(defaultPath).digest('hex')}`,
        workspacePath: defaultPath,
        contentHash: createHash('sha256').update(Buffer.from(defaultContent)).digest('hex')
      },
      content: defaultContent,
      byteLength: Buffer.byteLength(defaultContent)
    })
    expect(second).toMatchObject({
      sourceRef: {
        id: `lesson:${createHash('sha256').update(namedPath).digest('hex')}`,
        workspacePath: namedPath,
        contentHash: createHash('sha256').update(Buffer.from(namedContent)).digest('hex')
      },
      content: namedContent,
      byteLength: Buffer.byteLength(namedContent)
    })
    expect(JSON.stringify({ first, second })).not.toContain(root)
  })

  it('fails closed for missing, oversized, symlink, and directory artifacts', async () => {
    const root = await workspaceRoot('failures')
    await mkdir(join(root, 'lessons'), { recursive: true })
    await writeFile(join(root, 'lessons', 'large.html'), '12345', 'utf8')
    await writeFile(join(root, 'lessons', 'real.html'), 'safe', 'utf8')
    await symlink(join(root, 'lessons', 'real.html'), join(root, 'lessons', 'link.html'))

    await expect(resolveMindMapLesson(root, 'lessons/missing.html')).rejects.toMatchObject({
      name: 'MindMapLessonError',
      code: 'missing_file'
    })
    await expect(resolveMindMapLesson(root, 'lessons/large.html', 4)).rejects.toMatchObject({
      name: 'MindMapLessonError',
      code: 'over_limit'
    })
    await expect(resolveMindMapLesson(root, 'lessons/link.html')).rejects.toMatchObject({
      name: 'MindMapLessonError',
      code: 'unsafe_path'
    })
    await expect(resolveMindMapLesson(root, 'lessons')).rejects.toMatchObject({
      name: 'MindMapLessonError',
      code: 'invalid_path'
    })
  })

  it('keeps the default read bounded by the Lesson limit', async () => {
    const root = await workspaceRoot('bounded')
    await mkdir(join(root, 'lessons'), { recursive: true })
    const content = 'x'.repeat(MIND_MAP_LESSON_MAX_BYTES + 1)
    await writeFile(join(root, 'lessons', 'too-large.html'), content, 'utf8')

    await expect(resolveMindMapLesson(root, 'lessons/too-large.html')).rejects.toMatchObject({
      name: 'MindMapLessonError',
      code: 'over_limit'
    })
  })

  it('rejects invalid paths before filesystem access', async () => {
    const root = await workspaceRoot('invalid')
    for (const path of ['../outside.html', '/tmp/outside.html', 'C:\\outside.html', 'bad\u0000.html']) {
      await expect(resolveMindMapLesson(root, path)).rejects.toMatchObject({
        name: 'MindMapLessonError',
        code: 'invalid_path'
      })
    }
  })
})
