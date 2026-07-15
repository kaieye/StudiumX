import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

import { parse } from 'parse5'

import type { LessonSummary } from '../../shared/teaching-types'
import { deriveLessonPlacementFromRelativePath } from '../../shared/teaching-placement'
import { createLearningSessionLedger } from '../learning-session-ledger'
import { readContainedRegularFileBounded } from '../path-access'
import { recoverLessonArtifactPublications } from '../teaching-lesson-artifacts'
import {
  collectTeachingFiles,
  titleFromFilename,
  toWorkspaceRelativePath
} from '../teaching-workspace-paths'

export type LessonIndexReconciliationInput = {
  rootPath: string
  workspaceName: string
  /** Required before a canonical assessment may be hidden from the catalog. */
  workspaceId?: string
  lessons: LessonSummary[]
}

export type LessonIndexReconciliationPlan = {
  /**
   * The complete durable Lesson index for the files currently on disk. Catalog
   * visibility (pinning and archiving) is deliberately not applied here.
   */
  lessons: LessonSummary[]
  requiresPersist: boolean
  recoveredRelativePaths: string[]
  removedRelativePaths: string[]
}

/**
 * Reconciles the durable Lesson index with the workspace filesystem.
 *
 * The plan is intentionally separate from the Workspace catalog: it decides
 * only which Lesson records must be retained, recovered, or removed. The
 * caller owns the single durable write step, while the catalog remains a
 * read-only projection of the resulting index and path metadata.
 */
export async function planLessonIndexReconciliation(
  input: LessonIndexReconciliationInput
): Promise<LessonIndexReconciliationPlan> {
  const recovery = await recoverLessonArtifactPublications(input.rootPath)
  const isolatedPaths = new Set(recovery.isolatedRelativePaths.map(canonicalRelativePath))
  const diskLessonPaths = (await collectTeachingFiles(input.rootPath, (filePath) => filePath.toLowerCase().endsWith('.html')))
    .filter((filePath) => !isolatedPaths.has(canonicalRelativePath(toWorkspaceRelativePath(input.rootPath, filePath))))
  const visibleLessonPaths = await filterPublishedAssessmentSidecars(input, diskLessonPaths)
  const diskPathsByKey = new Map(
    visibleLessonPaths.map((absolutePath) => [canonicalPath(absolutePath), absolutePath])
  )
  const retainedKeys = new Set<string>()
  const reconciledLessons: LessonSummary[] = []

  for (const lesson of input.lessons) {
    const key = canonicalPath(lesson.absolutePath)
    if (!diskPathsByKey.has(key) || retainedKeys.has(key)) continue
    retainedKeys.add(key)
    reconciledLessons.push(lesson)
  }

  const recoveredLessons = [...diskPathsByKey.entries()]
    .filter(([key]) => !retainedKeys.has(key))
    .sort(([, left], [, right]) => left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' }))
    .map(([, absolutePath]) => recoveredLessonSummary(input.rootPath, input.workspaceName, absolutePath))

  const lessons = [...reconciledLessons, ...recoveredLessons]
  const nextPaths = new Set(lessons.map((lesson) => canonicalPath(lesson.absolutePath)))

  return {
    lessons,
    requiresPersist: !sameLessonIndex(input.lessons, lessons),
    recoveredRelativePaths: recoveredLessons.map((lesson) => lesson.relativePath),
    removedRelativePaths: input.lessons
      .filter((lesson) => !nextPaths.has(canonicalPath(lesson.absolutePath)))
      .map((lesson) => lesson.relativePath)
      .filter((relativePath, index, values) => Boolean(relativePath) && values.indexOf(relativePath) === index)
  }
}


const MAX_ASSESSMENT_SIDECAR_BYTES = 512 * 1024

type CanonicalAssessmentSidecar = {
  normalRelativePath: string
  sha256: string
}

/**
 * A sidecar is catalog-internal only when a canonical Session immutably claims
 * this exact path and exact bytes. Public HTML markers and filename suffixes
 * are presentation data, never authority.
 */
async function filterPublishedAssessmentSidecars(
  input: LessonIndexReconciliationInput,
  paths: string[]
): Promise<string[]> {
  if (!input.workspaceId) return paths
  const sidecars = await canonicalAssessmentSidecars(input)
  if (sidecars.size === 0) return paths
  const verdicts = await Promise.all(paths.map(async (filePath) => ({
    filePath,
    sidecar: await isPublishedAssessmentSidecar(input.rootPath, filePath, sidecars)
  })))
  return verdicts.filter((entry) => !entry.sidecar).map((entry) => entry.filePath)
}

async function canonicalAssessmentSidecars(input: LessonIndexReconciliationInput): Promise<Map<string, CanonicalAssessmentSidecar>> {
  try {
    const scan = await createLearningSessionLedger({ workspaceRoot: input.rootPath }).scan()
    const sidecars = new Map<string, CanonicalAssessmentSidecar>()
    const ambiguous = new Set<string>()
    for (const session of scan.canonicalSessions) {
      const lesson = session.lessonRef
      const assessment = lesson?.assessment
      if (!lesson || !assessment || session.workspaceId !== input.workspaceId) continue
      if (!canonicalLessonIdentityMatches(input, session.id, session.courseRef, lesson)) continue
      const key = canonicalRelativePath(assessment.relativePath)
      if (ambiguous.has(key)) continue
      if (sidecars.has(key)) {
        sidecars.delete(key)
        ambiguous.add(key)
        continue
      }
      sidecars.set(key, {
        normalRelativePath: canonicalRelativePath(lesson.relativePath),
        sha256: assessment.contentSha256
      })
    }
    return sidecars
  } catch {
    // Unsafe/corrupt Session storage must retain possible legacy lessons.
    return new Map()
  }
}

async function isPublishedAssessmentSidecar(
  rootPath: string,
  filePath: string,
  sidecars: Map<string, CanonicalAssessmentSidecar>
): Promise<boolean> {
  try {
    const relativePath = canonicalRelativePath(toWorkspaceRelativePath(rootPath, filePath))
    const claimed = sidecars.get(relativePath)
    if (!claimed) return false

    // A claimed sidecar is never hidden without its matching ordinary Lesson;
    // this prevents a detached assessment from disappearing from recovery.
    const normalPath = join(rootPath, ...claimed.normalRelativePath.split('/'))
    const normalRead = await readContainedRegularFileBounded(rootPath, normalPath, MAX_ASSESSMENT_SIDECAR_BYTES)
    if (normalRead.status !== 'ok') return false

    const read = await readContainedRegularFileBounded(rootPath, filePath, MAX_ASSESSMENT_SIDECAR_BYTES)
    if (read.status !== 'ok') return false
    if (createHash('sha256').update(read.content).digest('hex') !== claimed.sha256) return false

    const errors: unknown[] = []
    parse(read.content.toString('utf8'), { onParseError: (error) => errors.push(error) })
    return errors.length === 0
  } catch {
    return false
  }
}

function canonicalLessonIdentityMatches(
  input: LessonIndexReconciliationInput,
  sessionId: string,
  courseRef: { courseId: string; courseName: string; relativePath: string },
  lesson: { lessonId: string; relativePath: string }
): boolean {
  try {
    const relativePath = canonicalRelativePath(lesson.relativePath)
    const placement = deriveLessonPlacementFromRelativePath({ workspaceName: input.workspaceName, relativePath })
    return placement.sessionId === sessionId &&
      placement.courseId === courseRef.courseId &&
      placement.courseName === courseRef.courseName &&
      canonicalRelativePath(placement.courseRelativePath) === canonicalRelativePath(courseRef.relativePath) &&
      lesson.lessonId === placement.sessionId.replace(/^lesson-/, '')
  } catch {
    return false
  }
}

function canonicalRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase()
}

function recoveredLessonSummary(rootPath: string, workspaceName: string, absolutePath: string): LessonSummary {
  const file = basename(absolutePath)
  const relativePath = toWorkspaceRelativePath(rootPath, absolutePath)
  const placement = deriveLessonPlacementFromRelativePath({ workspaceName, relativePath })
  const idMatch = /^(\d{4})-/.exec(file)
  return {
    id: idMatch?.[1] ?? '0000',
    title: titleFromFilename(file),
    objective: '从本地 lesson 文件恢复的课程。',
    prompt: '',
    createdAt: new Date(0).toISOString(),
    durationMinutes: 12,
    courseId: placement.courseId,
    courseName: placement.courseName,
    courseRelativePath: placement.courseRelativePath,
    courseAbsolutePath: resolve(rootPath, placement.courseRelativePath),
    sessionId: placement.sessionId,
    sessionName: placement.sessionName,
    sessionRelativePath: placement.sessionRelativePath,
    sessionAbsolutePath: resolve(rootPath, placement.sessionRelativePath),
    relativePath,
    absolutePath
  }
}

function sameLessonIndex(left: LessonSummary[], right: LessonSummary[]): boolean {
  return left.length === right.length && left.every((lesson, index) => JSON.stringify(lesson) === JSON.stringify(right[index]))
}

function canonicalPath(path: string): string {
  return resolve(path).toLocaleLowerCase()
}