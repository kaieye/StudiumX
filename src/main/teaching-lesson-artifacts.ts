import * as fs from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  renderLearningRecordFromPlan,
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan
} from './ai/lesson-renderer'
import { buildLessonArtifactPlacement } from '../shared/teaching-placement'
import type { LessonPlan } from '../shared/lesson-schema'
import type { LessonSummary, TeachingSettingsV1 } from '../shared/teaching-types'

/** The workspace facts the generator has already validated/normalized for publication. */
export type LessonArtifactPublicationFacts = {
  workspace: {
    name: string
    rootPath: string
  }
  plan: LessonPlan
  sequence: number
  title: string
  objective: string
  prompt: string
  createdAt: string
  durationMinutes: number
  requestedCourseName?: string
  mission: { title: string; excerpt: string }
  generator: TeachingSettingsV1['generator']
  includeReference: boolean
  includeLearningRecord: boolean
}

export type LessonArtifactPaths = {
  courseId: string
  courseName: string
  courseRelativePath: string
  courseAbsolutePath: string
  sessionId: string
  sessionName: string
  sessionRelativePath: string
  sessionAbsolutePath: string
  lessonRelativePath: string
  lessonAbsolutePath: string
  referenceRelativePath: string | null
  referenceAbsolutePath: string | null
  recordRelativePath: string | null
  recordAbsolutePath: string | null
  reviewsRelativePath: string | null
  reviewsAbsolutePath: string | null
}

export type LessonArtifactPublication = {
  lesson: LessonSummary
  paths: LessonArtifactPaths
  eventPaths: string[]
}

type RenderedLessonArtifact = {
  absolutePath: string
  relativePath: string
  bytes: string
}

/**
 * Publishes a fully-rendered Lesson artifact set.
 *
 * Rendering is deliberately completed before this function creates a workspace
 * directory. Files are then written to a hidden sibling staging directory and
 * atomically renamed into their durable paths. A failed stage or publish rolls
 * back every file this attempt made visible, leaving no incomplete lesson set.
 */
export async function publishLessonArtifacts(
  facts: LessonArtifactPublicationFacts
): Promise<LessonArtifactPublication> {
  const { paths, lesson } = deriveLessonArtifactPublication(facts)
  const artifacts = renderLessonArtifacts({ facts, paths, lesson })

  await stageAndPublishArtifacts({
    workspaceRoot: facts.workspace.rootPath,
    artifacts,
    artifactDirectory: dirname(lesson.absolutePath),
    conversationDirectory: join(dirname(dirname(lesson.absolutePath)), 'conversation')
  })

  return {
    lesson,
    paths,
    eventPaths: artifacts.map((artifact) => artifact.relativePath)
  }
}

export function deriveLessonArtifactPublication(facts: LessonArtifactPublicationFacts): {
  paths: LessonArtifactPaths
  lesson: LessonSummary
} {
  const placement = buildLessonArtifactPlacement({
    workspaceName: facts.workspace.name,
    sequence: facts.sequence,
    title: facts.title,
    requestedCourseName: facts.requestedCourseName,
    includeReference: facts.includeReference,
    includeLearningRecord: facts.includeLearningRecord,
    includeReviews: facts.plan.flashcards.length > 0
  })
  const paths: LessonArtifactPaths = {
    courseId: placement.courseId,
    courseName: placement.courseName,
    courseRelativePath: placement.courseRelativePath,
    courseAbsolutePath: join(facts.workspace.rootPath, placement.courseRelativePath),
    sessionId: placement.sessionId,
    sessionName: placement.sessionName,
    sessionRelativePath: placement.sessionRelativePath,
    sessionAbsolutePath: join(facts.workspace.rootPath, placement.sessionRelativePath),
    lessonRelativePath: placement.lessonRelativePath,
    lessonAbsolutePath: join(facts.workspace.rootPath, placement.lessonRelativePath),
    referenceRelativePath: placement.referenceRelativePath,
    referenceAbsolutePath: placement.referenceRelativePath
      ? join(facts.workspace.rootPath, placement.referenceRelativePath)
      : null,
    recordRelativePath: placement.recordRelativePath,
    recordAbsolutePath: placement.recordRelativePath
      ? join(facts.workspace.rootPath, placement.recordRelativePath)
      : null,
    reviewsRelativePath: placement.reviewsRelativePath,
    reviewsAbsolutePath: placement.reviewsRelativePath
      ? join(facts.workspace.rootPath, placement.reviewsRelativePath)
      : null
  }
  const lesson: LessonSummary = {
    id: String(facts.sequence).padStart(4, '0'),
    title: facts.title,
    objective: facts.objective,
    prompt: facts.prompt,
    createdAt: facts.createdAt,
    durationMinutes: facts.durationMinutes,
    courseId: paths.courseId,
    courseName: paths.courseName,
    courseRelativePath: paths.courseRelativePath,
    courseAbsolutePath: paths.courseAbsolutePath,
    sessionId: paths.sessionId,
    sessionName: paths.sessionName,
    sessionRelativePath: paths.sessionRelativePath,
    sessionAbsolutePath: paths.sessionAbsolutePath,
    relativePath: paths.lessonRelativePath,
    absolutePath: paths.lessonAbsolutePath
  }

  return { paths, lesson }
}

function renderLessonArtifacts(opts: {
  facts: LessonArtifactPublicationFacts
  paths: LessonArtifactPaths
  lesson: LessonSummary
}): RenderedLessonArtifact[] {
  const { facts, paths, lesson } = opts
  const artifacts: RenderedLessonArtifact[] = [{
    absolutePath: paths.lessonAbsolutePath,
    relativePath: paths.lessonRelativePath,
    bytes: renderLessonHtmlFromPlan({
      plan: facts.plan,
      lesson,
      mission: facts.mission,
      workspaceName: facts.workspace.name,
      recordRelativePath: paths.recordRelativePath,
      referenceRelativePath: paths.referenceRelativePath,
      generator: facts.generator
    })
  }]

  if (paths.referenceAbsolutePath && paths.referenceRelativePath) {
    artifacts.push({
      absolutePath: paths.referenceAbsolutePath,
      relativePath: paths.referenceRelativePath,
      bytes: renderReferenceHtmlFromPlan({
        plan: facts.plan,
        lesson,
        mission: facts.mission,
        workspaceName: facts.workspace.name
      })
    })
  }
  if (paths.recordAbsolutePath && paths.recordRelativePath) {
    artifacts.push({
      absolutePath: paths.recordAbsolutePath,
      relativePath: paths.recordRelativePath,
      bytes: renderLearningRecordFromPlan({ plan: facts.plan, lesson, mission: facts.mission })
    })
  }
  if (paths.reviewsAbsolutePath && paths.reviewsRelativePath) {
    artifacts.push({
      absolutePath: paths.reviewsAbsolutePath,
      relativePath: paths.reviewsRelativePath,
      bytes: `${JSON.stringify({
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        relativePath: paths.reviewsRelativePath,
        cards: facts.plan.flashcards
      }, null, 2)}\n`
    })
  }

  return artifacts
}

async function stageAndPublishArtifacts(opts: {
  workspaceRoot: string
  artifacts: RenderedLessonArtifact[]
  artifactDirectory: string
  conversationDirectory: string
}): Promise<void> {
  const createdDirectories: string[] = []
  const publishedPaths: string[] = []
  let stagingDirectory: string | null = null

  try {
    await ensureDirectory(opts.artifactDirectory, createdDirectories)
    await ensureDirectory(opts.conversationDirectory, createdDirectories)
    stagingDirectory = join(opts.artifactDirectory, `.studiumx-lesson-stage-${randomUUID()}`)
    await fs.mkdir(stagingDirectory)

    const stagedArtifacts = opts.artifacts.map((artifact) => ({
      ...artifact,
      stagedPath: join(stagingDirectory!, basename(artifact.absolutePath))
    }))
    for (const artifact of stagedArtifacts) {
      await fs.writeFile(artifact.stagedPath, artifact.bytes, 'utf8')
    }

    // Do not replace an existing lesson asset. The generation sequence should
    // make this impossible; failing closed preserves any independently-created
    // workspace file and gives rollback a clear ownership boundary.
    for (const artifact of stagedArtifacts) {
      if (await pathExists(artifact.absolutePath)) {
        throw new Error(`Lesson artifact already exists: ${artifact.relativePath}`)
      }
    }
    // Publish satellite artifacts before the lesson HTML. The lesson is the
    // workspace's discoverable entry point, so its final atomic rename acts as
    // the commit: it cannot become visible until every linked artifact exists.
    const publishOrder = [...stagedArtifacts.slice(1), stagedArtifacts[0]!]
    for (const artifact of publishOrder) {
      await fs.rename(artifact.stagedPath, artifact.absolutePath)
      publishedPaths.push(artifact.absolutePath)
    }

    await fs.rmdir(stagingDirectory)
    stagingDirectory = null
  } catch (error) {
    await Promise.all(publishedPaths.map((path) => fs.rm(path, { force: true }).catch(() => undefined)))
    if (stagingDirectory) await fs.rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
    await removeCreatedEmptyDirectories(createdDirectories)
    throw error
  }
}

async function ensureDirectory(path: string, createdDirectories: string[]): Promise<void> {
  const missing: string[] = []
  let current = path
  while (true) {
    try {
      const info = await fs.lstat(current)
      if (!info.isDirectory()) throw new Error(`Expected a directory at ${current}`)
      break
    } catch (error) {
      if (!isMissingPath(error)) throw error
      const parent = dirname(current)
      if (parent === current) throw error
      missing.push(current)
      current = parent
    }
  }

  for (const directory of missing.reverse()) {
    try {
      await fs.mkdir(directory)
      createdDirectories.push(directory)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const info = await fs.lstat(directory)
      if (!info.isDirectory()) throw error
    }
  }
}

async function removeCreatedEmptyDirectories(createdDirectories: string[]): Promise<void> {
  for (const directory of [...createdDirectories].reverse()) {
    await fs.rmdir(directory).catch(() => undefined)
  }
}

async function pathExists(path: string): Promise<boolean> {
  return fs.lstat(path).then(() => true).catch((error) => {
    if (isMissingPath(error)) return false
    throw error
  })
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}