import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  COURSE_DEFINITION_FILE_NAME,
  COURSE_DEFINITION_SCHEMA_VERSION,
  CourseDefinitionStore,
  extractGoalsFromMissionMarkdown,
  isCourseDefinitionDocument,
  materializeCourseDefinition,
  orderSessionsByCourseDefinition,
  type CourseDefinition
} from '../../src/main/course-definition-store'
import type { LessonSummary } from '../../src/shared/teaching-types'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `studiumx-course-definition-${label}-`))
  roots.push(root)
  return root
}

function lesson(partial: Partial<LessonSummary> & Pick<LessonSummary, 'id' | 'title' | 'relativePath'>): LessonSummary {
  const courseRelativePath = partial.courseRelativePath ?? 'lessons'
  return {
    id: partial.id,
    title: partial.title,
    objective: partial.objective ?? '',
    prompt: partial.prompt ?? '',
    createdAt: partial.createdAt ?? '2026-07-01T00:00:00.000Z',
    durationMinutes: partial.durationMinutes ?? 15,
    relativePath: partial.relativePath,
    absolutePath: partial.absolutePath ?? join('/tmp', partial.relativePath),
    courseId: partial.courseId ?? 'default',
    courseName: partial.courseName ?? 'Default',
    courseRelativePath,
    courseAbsolutePath: partial.courseAbsolutePath ?? join('/tmp', courseRelativePath),
    sessionId: partial.sessionId ?? `lesson-${partial.id}`,
    sessionName: partial.sessionName ?? partial.title,
    sessionRelativePath: partial.sessionRelativePath ?? courseRelativePath,
    sessionAbsolutePath: partial.sessionAbsolutePath ?? join('/tmp', courseRelativePath)
  }
}

function fixedNow(): string {
  return '2026-07-20T12:00:00.000Z'
}

describe('CourseDefinitionStore', () => {
  it('materializes a CourseDefinition from Mission goals and Lesson order without writing', async () => {
    const root = await tempRoot('materialize-read')
    await writeFile(
      join(root, 'MISSION.md'),
      '# Mission: Teach Durable Courses\n\n## Why\nRecover session order.\n\n## Success looks like\n- Keep intentional session order\n- Recover status without SQLite\n',
      'utf8'
    )
    await mkdir(join(root, 'lessons'), { recursive: true })

    const store = new CourseDefinitionStore({
      workspaceRoot: root,
      workspaceName: 'Teach Durable Courses',
      now: fixedNow
    })
    const lessons = [
      lesson({
        id: '0002',
        title: 'Second',
        relativePath: 'lessons/0002-second.html',
        sessionId: 'lesson-0002',
        courseRelativePath: 'lessons',
        courseId: 'teach-durable-courses',
        courseName: 'Teach Durable Courses'
      }),
      lesson({
        id: '0001',
        title: 'First',
        relativePath: 'lessons/0001-first.html',
        sessionId: 'lesson-0001',
        courseRelativePath: 'lessons',
        courseId: 'teach-durable-courses',
        courseName: 'Teach Durable Courses'
      })
    ]

    const read = await store.read('lessons', {
      materializeIfMissing: true,
      materializeSource: { lessons }
    })

    expect(read.source).toBe('materialized')
    expect(read.definition).toMatchObject({
      schemaVersion: COURSE_DEFINITION_SCHEMA_VERSION,
      courseId: 'teach-durable-courses',
      courseName: 'Teach Durable Courses',
      relativePath: 'lessons',
      missionRelativePath: 'MISSION.md',
      goals: ['Keep intentional session order', 'Recover status without SQLite']
    })
    expect(read.definition?.sessions.map((session) => session.sessionId)).toEqual(['lesson-0001', 'lesson-0002'])
    await expect(readFile(join(root, 'lessons', COURSE_DEFINITION_FILE_NAME), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes a durable CourseDefinition and restores intentional session order', async () => {
    const root = await tempRoot('write-order')
    await mkdir(join(root, 'courses', 'quantum'), { recursive: true })
    const store = new CourseDefinitionStore({
      workspaceRoot: root,
      workspaceName: 'Physics',
      now: fixedNow
    })

    const definition = materializeCourseDefinition({
      workspaceName: 'Physics',
      courseRelativePath: 'courses/quantum',
      courseId: 'quantum',
      courseName: 'Quantum',
      goals: ['Master wave functions'],
      sessions: [
        {
          sessionId: 'lesson-0002',
          name: 'Operators',
          relativePath: 'courses/quantum/lesson',
          status: 'planned',
          lessonRelativePath: 'courses/quantum/lesson/0002-operators.html'
        },
        {
          sessionId: 'lesson-0001',
          name: 'Wave Functions',
          relativePath: 'courses/quantum/lesson',
          status: 'completed',
          lessonRelativePath: 'courses/quantum/lesson/0001-wave-functions.html'
        }
      ],
      updatedAt: fixedNow()
    })

    const written = await store.write(definition)
    expect(written.updatedAt).toBe(fixedNow())
    expect(isCourseDefinitionDocument(written)).toBe(true)

    const onDisk = JSON.parse(await readFile(join(root, 'courses', 'quantum', COURSE_DEFINITION_FILE_NAME), 'utf8')) as CourseDefinition
    expect(onDisk.sessions.map((session) => session.sessionId)).toEqual(['lesson-0002', 'lesson-0001'])
    expect(onDisk.sessions[1]?.status).toBe('completed')

    const reread = await store.read('courses/quantum')
    expect(reread.source).toBe('canonical')
    expect(reread.definition?.courseId).toBe('quantum')
    expect(reread.definition?.missionRelativePath).toBe('MISSION.md')

    const ordered = orderSessionsByCourseDefinition(
      [
        { id: 'lesson-0001', relativePath: 'courses/quantum/lesson' },
        { id: 'lesson-0002', relativePath: 'courses/quantum/lesson' }
      ],
      reread.definition
    )
    expect(ordered.map((session) => session.id)).toEqual(['lesson-0002', 'lesson-0001'])
  })

  it('repairs from backup without forcing unrelated courses to migrate', async () => {
    const root = await tempRoot('repair-backup')
    await mkdir(join(root, 'lessons'), { recursive: true })
    await mkdir(join(root, 'courses', 'optics'), { recursive: true })
    const store = new CourseDefinitionStore({
      workspaceRoot: root,
      workspaceName: 'Physics Lab',
      now: fixedNow
    })

    const definition = materializeCourseDefinition({
      workspaceName: 'Physics Lab',
      courseRelativePath: 'lessons',
      goals: ['Recover from backup'],
      sessions: [
        {
          sessionId: 'lesson-0001',
          name: 'Intro',
          relativePath: 'lessons',
          status: 'active',
          lessonRelativePath: 'lessons/0001-intro.html'
        }
      ],
      updatedAt: fixedNow()
    })
    await store.write(definition)

    const definitionPath = join(root, 'lessons', COURSE_DEFINITION_FILE_NAME)
    const backupPath = `${definitionPath}.bak`
    await writeFile(backupPath, await readFile(definitionPath, 'utf8'), 'utf8')
    await writeFile(definitionPath, '{ not valid course definition', 'utf8')

    const dryRun = await store.repair('lessons', { dryRun: true })
    expect(dryRun).toMatchObject({
      dryRun: true,
      applied: false,
      action: 'restore_from_backup',
      reason: 'would_restore_valid_backup'
    })
    await expect(readFile(definitionPath, 'utf8')).resolves.toBe('{ not valid course definition')

    const repaired = await store.repair('lessons')
    expect(repaired.applied).toBe(true)
    expect(repaired.action).toBe('restore_from_backup')
    expect(repaired.definition?.goals).toEqual(['Recover from backup'])
    expect(repaired.definition?.sessions[0]?.status).toBe('active')

    const opticsPlan = await store.repair('courses/optics', { dryRun: true })
    expect(opticsPlan.action).toBe('materialize')
    expect(opticsPlan.applied).toBe(false)
    await expect(readFile(join(root, 'courses', 'optics', COURSE_DEFINITION_FILE_NAME), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('plans workspace repair as a dry-run report without writing or embedding learner content', async () => {
    const root = await tempRoot('plan-repair')
    await mkdir(join(root, 'lessons'), { recursive: true })
    await mkdir(join(root, 'courses', 'history'), { recursive: true })
    await writeFile(join(root, 'MISSION.md'), '# Mission: History\n\n## Success looks like\n- Read old workspaces\n', 'utf8')

    const store = new CourseDefinitionStore({
      workspaceRoot: root,
      workspaceName: 'History',
      now: fixedNow
    })
    const reports = await store.planWorkspaceRepair({
      lessons: [
        lesson({
          id: '0001',
          title: 'Origins',
          relativePath: 'lessons/0001-origins.html',
          sessionId: 'lesson-0001',
          courseRelativePath: 'lessons',
          courseId: 'history',
          courseName: 'History'
        })
      ]
    })

    expect(reports.map((report) => report.courseRelativePath).sort()).toEqual(['courses/history', 'lessons'].sort())
    expect(reports.every((report) => report.dryRun && !report.applied)).toBe(true)
    expect(reports.every((report) => report.action === 'materialize')).toBe(true)
    const serialized = JSON.stringify(reports)
    expect(serialized).not.toMatch(/Origins|Read old workspaces|learner answer|provider payload/i)
    expect(reports.every((report) => report.definition === null)).toBe(true)
    expect(reports.find((report) => report.courseRelativePath === 'lessons')?.sessionCount).toBe(1)
    expect(serialized).toContain('would_materialize_missing_definition')
    await expect(readFile(join(root, 'lessons', COURSE_DEFINITION_FILE_NAME), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('extracts Mission success goals for lazy materialization', () => {
    expect(
      extractGoalsFromMissionMarkdown(
        '# Mission: Demo\n\n## Success looks like\n- One\n- Two\n\n## Constraints\n- Keep local files\n'
      )
    ).toEqual(['One', 'Two'])
  })

  it('rejects invalid course relative paths and invalid documents', () => {
    expect(isCourseDefinitionDocument({ schemaVersion: 1 })).toBe(false)
    expect(() =>
      materializeCourseDefinition({
        workspaceName: 'x',
        courseRelativePath: 'not-a-course'
      })
    ).toThrow(/Course-relative path/)
  })
})

