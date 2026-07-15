import { basename, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

import type { LessonSummary } from '../../shared/teaching-types'
import { deriveLessonPlacementFromRelativePath } from '../../shared/teaching-placement'
import {
  collectTeachingFiles,
  titleFromFilename,
  toWorkspaceRelativePath
} from '../teaching-workspace-paths'

export type LessonIndexReconciliationInput = {
  rootPath: string
  workspaceName: string
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
  const diskLessonPaths = await collectTeachingFiles(input.rootPath, (filePath) => filePath.toLowerCase().endsWith('.html'))
  const visibleLessonPaths = await filterPublishedAssessmentSidecars(diskLessonPaths)
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


const ASSESSMENT_SIDECAR_HEAD_PREFIX = '<!doctype html>\n<html lang="zh-CN">\n<head>\n  <title>'
const ASSESSMENT_SIDECAR_MARKER = '</title>\n  <meta name="studiumx-artifact-kind" content="assessment-sidecar">\n</head>\n<body>\n'

/** Excludes only publisher-marked assessment sidecars; filename suffixes remain valid Lesson titles. */
async function filterPublishedAssessmentSidecars(paths: string[]): Promise<string[]> {
  const verdicts = await Promise.all(paths.map(async (filePath) => ({
    filePath,
    sidecar: await isPublishedAssessmentSidecar(filePath)
  })))
  return verdicts.filter((entry) => !entry.sidecar).map((entry) => entry.filePath)
}

async function isPublishedAssessmentSidecar(filePath: string): Promise<boolean> {
  // Keep this intentionally narrower than generic HTML marker matching: only the
  // deterministic publisher head layout is catalog-internal. A failed or
  // non-matching read is never used to hide a potential legacy Lesson.
  try {
    const content = await readFile(filePath, 'utf8')
    if (!content.startsWith(ASSESSMENT_SIDECAR_HEAD_PREFIX)) return false
    const markerIndex = content.indexOf(ASSESSMENT_SIDECAR_MARKER, ASSESSMENT_SIDECAR_HEAD_PREFIX.length)
    return markerIndex > ASSESSMENT_SIDECAR_HEAD_PREFIX.length &&
      content.indexOf('<', ASSESSMENT_SIDECAR_HEAD_PREFIX.length) === markerIndex
  } catch {
    return false
  }
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