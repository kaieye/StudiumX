import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  COURSE_DEFINITION_FILE_NAME,
  COURSE_DEFINITION_SCHEMA_VERSION,
  CourseDefinitionStore,
  materializeCourseDefinition,
  orderSessionsByCourseDefinition
} from '../../src/main/course-definition-store'
import { applyDurableCourseSessionOrder, buildCourseSummaries } from '../../src/main/teaching-workspace-catalog'
import type { LessonSummary } from '../../src/shared/teaching-types'

let tempRoot = ''

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'studiumx-course-definition-store-check-'))
  const workspaceRoot = join(tempRoot, 'workspace')
  await mkdir(join(workspaceRoot, 'lessons'), { recursive: true })
  await mkdir(join(workspaceRoot, 'courses', 'quantum-mechanics', 'lesson'), { recursive: true })
  await writeFile(
    join(workspaceRoot, 'MISSION.md'),
    '# Mission: Catalog Courses\n\n## Success looks like\n- Course is not path-guess only\n- Session order is recoverable\n',
    'utf8'
  )

  const store = new CourseDefinitionStore({
    workspaceRoot,
    workspaceName: 'Catalog Courses',
    now: () => '2026-07-20T15:00:00.000Z'
  })

  // Old workspace: readable without forcing a write.
  const lazy = await store.read('lessons', { materializeIfMissing: true })
  assert.equal(lazy.source, 'materialized')
  assert.equal(lazy.definition?.schemaVersion, COURSE_DEFINITION_SCHEMA_VERSION)
  assert.deepEqual(lazy.definition?.goals, ['Course is not path-guess only', 'Session order is recoverable'])
  await assert.rejects(readFile(join(workspaceRoot, 'lessons', COURSE_DEFINITION_FILE_NAME), 'utf8'), (error: NodeJS.ErrnoException) => {
    assert.equal(error.code, 'ENOENT')
    return true
  })

  // Explicit write persists courseId, mission link, goals, and session order/status.
  const written = await store.write(
    materializeCourseDefinition({
      workspaceName: 'Catalog Courses',
      courseRelativePath: 'courses/quantum-mechanics',
      goals: ['Course is not path-guess only', 'Session order is recoverable'],
      sessions: [
        {
          sessionId: 'lesson-0002',
          name: 'Operators',
          relativePath: 'courses/quantum-mechanics/lesson',
          status: 'planned',
          lessonRelativePath: 'courses/quantum-mechanics/lesson/0002-operators.html'
        },
        {
          sessionId: 'lesson-0001',
          name: 'Wave Functions',
          relativePath: 'courses/quantum-mechanics/lesson',
          status: 'completed',
          lessonRelativePath: 'courses/quantum-mechanics/lesson/0001-wave-functions.html'
        }
      ],
      updatedAt: '2026-07-20T15:00:00.000Z'
    })
  )
  assert.equal(written.courseId, 'quantum-mechanics')
  assert.equal(written.missionRelativePath, 'MISSION.md')
  assert.deepEqual(
    written.sessions.map((session) => ({ id: session.sessionId, status: session.status })),
    [
      { id: 'lesson-0002', status: 'planned' },
      { id: 'lesson-0001', status: 'completed' }
    ]
  )

  const reread = await store.read('courses/quantum-mechanics')
  assert.equal(reread.source, 'canonical')
  assert.ok(reread.definition)
  assert.deepEqual(
    orderSessionsByCourseDefinition(
      [
        { id: 'lesson-0001' },
        { id: 'lesson-0002' }
      ],
      reread.definition
    ).map((session) => session.id),
    ['lesson-0002', 'lesson-0001']
  )

  // Dry-run repair report for old courses; no forced full migrate.
  const plan = await store.planWorkspaceRepair()
  assert.equal(plan.some((report) => report.courseRelativePath === 'lessons' && report.dryRun && report.action === 'materialize'), true)
  assert.equal(plan.some((report) => report.courseRelativePath === 'courses/quantum-mechanics' && report.action === 'none'), true)
  assert.equal(plan.every((report) => report.dryRun ? !report.applied : true), true)
  await assert.rejects(readFile(join(workspaceRoot, 'lessons', COURSE_DEFINITION_FILE_NAME), 'utf8'), (error: NodeJS.ErrnoException) => {
    assert.equal(error.code, 'ENOENT')
    return true
  })

  // Catalog rebuild remains possible from filesystem lessons + durable order.
  const lessons: LessonSummary[] = [
    {
      id: '0001',
      title: 'Wave Functions',
      objective: '',
      prompt: '',
      createdAt: '2026-07-01T00:00:00.000Z',
      durationMinutes: 15,
      relativePath: 'courses/quantum-mechanics/lesson/0001-wave-functions.html',
      absolutePath: join(workspaceRoot, 'courses/quantum-mechanics/lesson/0001-wave-functions.html'),
      courseId: 'quantum-mechanics',
      courseName: 'Quantum Mechanics',
      courseRelativePath: 'courses/quantum-mechanics',
      courseAbsolutePath: join(workspaceRoot, 'courses/quantum-mechanics'),
      sessionId: 'lesson-0001',
      sessionName: 'Wave Functions',
      sessionRelativePath: 'courses/quantum-mechanics/lesson',
      sessionAbsolutePath: join(workspaceRoot, 'courses/quantum-mechanics/lesson')
    },
    {
      id: '0002',
      title: 'Operators',
      objective: '',
      prompt: '',
      createdAt: '2026-07-01T00:00:00.000Z',
      durationMinutes: 15,
      relativePath: 'courses/quantum-mechanics/lesson/0002-operators.html',
      absolutePath: join(workspaceRoot, 'courses/quantum-mechanics/lesson/0002-operators.html'),
      courseId: 'quantum-mechanics',
      courseName: 'Quantum Mechanics',
      courseRelativePath: 'courses/quantum-mechanics',
      courseAbsolutePath: join(workspaceRoot, 'courses/quantum-mechanics'),
      sessionId: 'lesson-0002',
      sessionName: 'Operators',
      sessionRelativePath: 'courses/quantum-mechanics/lesson',
      sessionAbsolutePath: join(workspaceRoot, 'courses/quantum-mechanics/lesson')
    }
  ]

  const courses = await applyDurableCourseSessionOrder(
    { id: 'ws-1', name: 'Catalog Courses', rootPath: workspaceRoot },
    buildCourseSummaries({ id: 'ws-1', name: 'Catalog Courses', rootPath: workspaceRoot }, lessons)
  )
  const quantum = courses.find((course) => course.relativePath === 'courses/quantum-mechanics')
  assert.ok(quantum)
  assert.deepEqual(
    quantum.sessions.map((session) => session.id),
    ['lesson-0002', 'lesson-0001'],
    'catalog rebuild should honor durable CourseDefinition session order'
  )

  // Live materialize remains opt-in for one course.
  const materialized = await store.materialize({ courseRelativePath: 'lessons', goals: ['Course is not path-guess only'] })
  assert.equal(materialized.applied, true)
  assert.equal(materialized.action, 'materialize')
  const onDisk = JSON.parse(await readFile(join(workspaceRoot, 'lessons', COURSE_DEFINITION_FILE_NAME), 'utf8'))
  assert.equal(onDisk.schemaVersion, COURSE_DEFINITION_SCHEMA_VERSION)
  assert.equal(onDisk.courseId, 'catalog-courses')
  assert.equal(onDisk.missionRelativePath, 'MISSION.md')

  console.log('course definition store boundaries ok')
} finally {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
}
