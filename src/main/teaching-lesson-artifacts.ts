import * as fs from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  renderAssessmentHtmlFromPlan,
  renderLessonHtmlFromPlan,
  renderReferenceHtmlFromPlan
} from './ai/lesson-renderer'
import { buildLessonArtifactPlacement } from '../shared/teaching-placement'
import type { LessonPlan } from '../shared/lesson-schema'
import type { LessonSummary, TeachingSettingsV1 } from '../shared/teaching-types'
import { readContainedRegularFileBounded } from './path-access'

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
  assessmentRelativePath: string
  assessmentAbsolutePath: string
  referenceRelativePath: string | null
  referenceAbsolutePath: string | null
  reviewsRelativePath: string | null
  reviewsAbsolutePath: string | null
}

export type LessonArtifactPublication = {
  /** Publisher journal retained until outer index/event projections acknowledge it. */
  transactionId: string
  lesson: LessonSummary
  assessment: { relativePath: string; contentSha256: string }
  paths: LessonArtifactPaths
  eventPaths: string[]
}

/**
 * Publisher-owned commit hook. It binds immutable assessment facts only after
 * all satellites are durable but before the normal Lesson becomes discoverable.
 * A returned compensator is invoked if the final Lesson commit cannot finish.
 */
export type LessonArtifactPublicationOptions = {
  bindCanonicalSession?: (publication: Pick<LessonArtifactPublication, 'lesson' | 'assessment'>) => Promise<void | (() => Promise<void>)>
}

type RenderedLessonArtifact = {
  absolutePath: string
  relativePath: string
  bytes: string
}

type StagedLessonArtifact = RenderedLessonArtifact & {
  stagedPath: string
  sha256: string
}

type LessonPublicationJournal = {
  schemaVersion: 1
  id: string
  phase: 'staged' | 'binding' | 'publishing' | 'commit_intent' | 'projection_pending' | 'abandoned'
  stagingDirectory: string
  artifacts: Array<{ relativePath: string; absolutePath: string; stagedPath: string; sha256: string }>
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
  facts: LessonArtifactPublicationFacts,
  options: LessonArtifactPublicationOptions = {}
): Promise<LessonArtifactPublication> {
  const { paths, lesson } = deriveLessonArtifactPublication(facts)
  const artifacts = renderLessonArtifacts({ facts, paths, lesson })
  const assessmentArtifact = artifacts[1]
  if (!assessmentArtifact) throw new Error('Assessment artifact was not rendered.')
  const assessment = {
    relativePath: paths.assessmentRelativePath,
    contentSha256: createHash('sha256').update(Buffer.from(assessmentArtifact.bytes, 'utf8')).digest('hex')
  }

  const transactionId = await stageAndPublishArtifacts({
    workspaceRoot: facts.workspace.rootPath,
    artifacts,
    artifactDirectory: dirname(lesson.absolutePath),
    conversationDirectory: join(dirname(dirname(lesson.absolutePath)), 'conversation'),
    bindCanonicalSession: options.bindCanonicalSession
      ? () => options.bindCanonicalSession!({ lesson, assessment })
      : undefined
  })

  return {
    transactionId,
    lesson,
    assessment,
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
    assessmentRelativePath: placement.assessmentRelativePath,
    assessmentAbsolutePath: join(facts.workspace.rootPath, placement.assessmentRelativePath),
    referenceRelativePath: placement.referenceRelativePath,
    referenceAbsolutePath: placement.referenceRelativePath
      ? join(facts.workspace.rootPath, placement.referenceRelativePath)
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
      referenceRelativePath: paths.referenceRelativePath,
      generator: facts.generator
    })
  }]

  artifacts.push({
    absolutePath: paths.assessmentAbsolutePath,
    relativePath: paths.assessmentRelativePath,
    bytes: renderAssessmentHtmlFromPlan({ plan: facts.plan })
  })

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

export type LessonArtifactPublicationRecovery = {
  isolatedRelativePaths: string[]
}

const LESSON_PUBLICATION_JOURNAL_DIRECTORY = '.teachos/lesson-publications'
const MAX_PUBLICATION_JOURNAL_BYTES = 128 * 1024
const MAX_PUBLICATION_ARTIFACT_BYTES = 2 * 1024 * 1024

function publicationJournalPath(workspaceRoot: string, transactionId: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(transactionId)) throw new Error('Lesson publication transaction id is invalid.')
  return join(resolve(workspaceRoot), ...LESSON_PUBLICATION_JOURNAL_DIRECTORY.split('/'), `${transactionId}.json`)
}

/**
 * A committed publication remains explicitly projection-pending until the
 * workspace index/event layer acknowledges it. This is not a rollback signal:
 * its normal Lesson and canonical authority are already a single committed set.
 */
export async function finalizeLessonArtifactPublication(workspaceRoot: string, transactionId: string): Promise<void> {
  const path = publicationJournalPath(workspaceRoot, transactionId)
  await removeOwnedPublicationJournal(workspaceRoot, path)
}

/**
 * Deterministically cleans failed publications and quarantines any paths that
 * cannot be proven removable. Catalog reconciliation invokes this before it
 * considers filesystem discovery, so a failed binding never becomes a Lesson.
 */
export async function recoverLessonArtifactPublications(workspaceRoot: string): Promise<LessonArtifactPublicationRecovery> {
  const root = resolve(workspaceRoot)
  const journalDirectory = join(root, ...LESSON_PUBLICATION_JOURNAL_DIRECTORY.split('/'))
  let entries: string[]
  try {
    const info = await fs.lstat(journalDirectory)
    if (info.isSymbolicLink() || !info.isDirectory()) return { isolatedRelativePaths: [] }
    entries = await fs.readdir(journalDirectory)
  } catch (error) {
    if (isMissingPath(error)) return { isolatedRelativePaths: [] }
    return { isolatedRelativePaths: [] }
  }

  const isolated = new Set<string>()
  for (const entry of entries.sort()) {
    if (!/^[a-f0-9-]{36}\.json$/i.test(entry)) continue
    const journalPath = join(journalDirectory, entry)
    const journal = await readPublicationJournal(root, journalPath)
    if (!journal) continue
    // A normal Lesson is the visible commit marker. A crash after its rename
    // may leave an older journal phase, so verify bytes rather than trusting a
    // best-effort post-commit journal update. Never roll such a set back.
    if (await isCommittedPublication(root, journal)) {
      await removeOwnedStagingDirectory(root, journal).catch(() => undefined)
      continue
    }

    // Reconciliation can run concurrently with publishing. It must never
    // delete or expose a live transaction merely because it observed the
    // journal between two renames. Only a publisher-caught failure explicitly
    // enters `abandoned`; all other incomplete states are isolated fail-closed.
    if (journal.phase !== 'abandoned') {
      for (const artifact of journal.artifacts) isolated.add(artifact.relativePath)
      continue
    }

    const clean = await cleanupIncompletePublication(root, journal)
    if (clean) {
      await removeOwnedPublicationJournal(root, journalPath).catch(() => undefined)
    } else {
      for (const artifact of journal.artifacts) isolated.add(artifact.relativePath)
    }
  }
  return { isolatedRelativePaths: [...isolated].sort() }
}

async function stageAndPublishArtifacts(opts: {
  workspaceRoot: string
  artifacts: RenderedLessonArtifact[]
  artifactDirectory: string
  conversationDirectory: string
  bindCanonicalSession?: () => Promise<void | (() => Promise<void>)>
}): Promise<string> {
  const root = resolve(opts.workspaceRoot)
  const createdDirectories: string[] = []
  const artifactParent = await ensureSafeDirectory(root, opts.artifactDirectory, createdDirectories)
  await ensureSafeDirectory(root, opts.conversationDirectory, createdDirectories)
  const transactionId = randomUUID()
  const stagingDirectory = join(artifactParent.path, `.studiumx-lesson-stage-${transactionId}`)
  let journalPath: string | null = null
  let journal: LessonPublicationJournal | null = null
  let bindingRollback: (() => Promise<void>) | undefined
  let committed = false

  try {
    await assertDirectorySnapshot(root, artifactParent)
    await fs.mkdir(stagingDirectory)
    const stageInfo = await fs.lstat(stagingDirectory)
    if (stageInfo.isSymbolicLink() || !stageInfo.isDirectory()) throw new Error('Lesson publication staging directory is unsafe.')

    const stagedArtifacts: StagedLessonArtifact[] = opts.artifacts.map((artifact) => ({
      ...artifact,
      stagedPath: join(stagingDirectory, basename(artifact.absolutePath)),
      sha256: createHash('sha256').update(Buffer.from(artifact.bytes, 'utf8')).digest('hex')
    }))
    for (const artifact of stagedArtifacts) await fs.writeFile(artifact.stagedPath, artifact.bytes, { encoding: 'utf8', flag: 'wx' })

    for (const artifact of stagedArtifacts) {
      await assertSafeFinalTarget(root, artifact.absolutePath)
    }
    const journalDirectory = await ensureSafeDirectory(root, join(root, ...LESSON_PUBLICATION_JOURNAL_DIRECTORY.split('/')), createdDirectories)
    journalPath = join(journalDirectory.path, `${transactionId}.json`)
    journal = {
      schemaVersion: 1,
      id: transactionId,
      phase: 'staged',
      stagingDirectory,
      artifacts: stagedArtifacts.map((artifact) => ({
        relativePath: artifact.relativePath,
        absolutePath: artifact.absolutePath,
        stagedPath: artifact.stagedPath,
        sha256: artifact.sha256
      }))
    }
    await writePublicationJournal(root, journalPath, journal)

    // Bind the immutable Session before any final-path artifact exists. This
    // closes the window in which reconciliation could discover an unbound
    // satellite. A process death here leaves an inert Session with no readable
    // assessment; it cannot establish an outcome and is safely retryable.
    journal.phase = 'binding'
    await writePublicationJournal(root, journalPath, journal)
    bindingRollback = await opts.bindCanonicalSession?.() ?? undefined

    // Publish all internal satellites only after binding. They remain
    // catalog-ineligible until the ordinary Lesson is atomically committed.
    journal.phase = 'publishing'
    await writePublicationJournal(root, journalPath, journal)
    for (const artifact of stagedArtifacts.slice(1)) await moveStagedArtifact(root, artifact, artifactParent)

    const lessonArtifact = stagedArtifacts[0]
    if (!lessonArtifact) throw new Error('Lesson artifact was not staged.')
    // Durably record commit intent before the visible commit marker. Recovery
    // verifies final bytes, so a later journal-write failure cannot cause a
    // committed Lesson/session pair to be classified as abandoned.
    journal.phase = 'commit_intent'
    await writePublicationJournal(root, journalPath, journal)
    await moveStagedArtifact(root, lessonArtifact, artifactParent)
    committed = true

    // Never put post-commit cleanup under rollback handling. A retained stage
    // and journal are a recoverable diagnostic, not a reason to unpublish.
    journal.phase = 'projection_pending'
    // commit_intent is already durable. If this acknowledgement write is
    // interrupted, recovery verifies the final artifact set and keeps it
    // committed rather than rolling it back.
    await writePublicationJournal(root, journalPath, journal).catch(() => undefined)
    await removeOwnedStagingDirectory(root, journal).catch(() => undefined)
    return transactionId
  } catch (error) {
    if (committed) {
      // The ordinary Lesson has become discoverable with the authority set. Do
      // not reverse a committed artifact/session merely because journaling or
      // cleanup subsequently failed.
      throw error
    }
    if (journal) {
      journal.phase = 'abandoned'
      if (journalPath) await writePublicationJournal(root, journalPath, journal).catch(() => undefined)
    }
    let compensationFailed = false
    if (bindingRollback) {
      try { await bindingRollback() } catch { compensationFailed = true }
    }
    const cleaned = journal ? await cleanupIncompletePublication(root, journal) : false
    if (journalPath && cleaned && !compensationFailed) await removeOwnedPublicationJournal(root, journalPath).catch(() => undefined)
    await removeCreatedEmptyDirectories(createdDirectories)
    throw error
  }
}

type DirectorySnapshot = { path: string; chain: Array<{ path: string; dev: number; ino: number }> }

async function ensureSafeDirectory(rootPath: string, targetPath: string, createdDirectories: string[]): Promise<DirectorySnapshot> {
  const root = resolve(rootPath)
  const target = resolve(targetPath)
  if (!isPathInside(root, target)) throw new Error('Lesson publication path escapes its workspace root.')
  const rootInfo = await fs.lstat(root)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Lesson publication workspace root is unsafe.')
  const parts = relative(root, target).split(sep).filter(Boolean)
  let current = root
  const chain: Array<{ path: string; dev: number; ino: number }> = []
  for (const part of parts) {
    chain.push(await safeDirectoryIdentity(current))
    current = join(current, part)
    try {
      await fs.mkdir(current)
      createdDirectories.push(current)
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
    }
  }
  chain.push(await safeDirectoryIdentity(current))
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)])
  if (!isPathInside(realRoot, realTarget)) throw new Error('Lesson publication path escapes after resolving a reparse point.')
  return { path: target, chain }
}

async function safeDirectoryIdentity(path: string): Promise<{ path: string; dev: number; ino: number }> {
  const info = await fs.lstat(path)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Lesson publication directory is unsafe: ${path}`)
  return { path, dev: info.dev, ino: info.ino }
}

async function assertDirectorySnapshot(rootPath: string, snapshot: DirectorySnapshot): Promise<void> {
  for (const expected of snapshot.chain) {
    const current = await safeDirectoryIdentity(expected.path)
    if (current.dev !== expected.dev || current.ino !== expected.ino) throw new Error('Lesson publication parent directory identity changed.')
  }
  const [realRoot, realTarget] = await Promise.all([fs.realpath(resolve(rootPath)), fs.realpath(snapshot.path)])
  if (!isPathInside(realRoot, realTarget)) throw new Error('Lesson publication parent escaped its workspace root.')
}

async function assertSafeFinalTarget(rootPath: string, targetPath: string): Promise<void> {
  const parent = await ensureSafeDirectory(rootPath, dirname(targetPath), [])
  await assertDirectorySnapshot(rootPath, parent)
  try {
    await fs.lstat(targetPath)
    throw new Error(`Lesson artifact already exists: ${targetPath}`)
  } catch (error) {
    if (!isMissingPath(error)) throw error
  }
}

async function moveStagedArtifact(rootPath: string, artifact: StagedLessonArtifact, parent: DirectorySnapshot): Promise<void> {
  await assertDirectorySnapshot(rootPath, parent)
  await assertSafeFinalTarget(rootPath, artifact.absolutePath)
  await fs.rename(artifact.stagedPath, artifact.absolutePath)
  await assertDirectorySnapshot(rootPath, parent)
  const info = await fs.lstat(artifact.absolutePath)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Published Lesson artifact identity is unsafe.')
  const read = await readContainedRegularFileBounded(rootPath, artifact.absolutePath, MAX_PUBLICATION_ARTIFACT_BYTES)
  if (read.status !== 'ok' || createHash('sha256').update(read.content).digest('hex') !== artifact.sha256) {
    throw new Error('Published Lesson artifact bytes changed during commit.')
  }
}

async function writePublicationJournal(rootPath: string, journalPath: string, journal: LessonPublicationJournal): Promise<void> {
  const parent = await ensureSafeDirectory(rootPath, dirname(journalPath), [])
  await assertDirectorySnapshot(rootPath, parent)
  const temporary = `${journalPath}.tmp-${randomUUID()}`
  await fs.writeFile(temporary, `${JSON.stringify(journal)}\n`, { encoding: 'utf8', flag: 'wx' })
  await fs.rename(temporary, journalPath)
  await assertDirectorySnapshot(rootPath, parent)
}

async function readPublicationJournal(rootPath: string, journalPath: string): Promise<LessonPublicationJournal | null> {
  try {
    const bounded = await readContainedRegularFileBounded(rootPath, journalPath, MAX_PUBLICATION_JOURNAL_BYTES)
    if (bounded.status !== 'ok') return null
    const value = JSON.parse(bounded.content.toString('utf8')) as unknown
    return isPublicationJournal(value, rootPath) ? value : null
  } catch {
    return null
  }
}

function isPublicationJournal(value: unknown, rootPath: string): value is LessonPublicationJournal {
  if (!value || typeof value !== 'object') return false
  const journal = value as Partial<LessonPublicationJournal>
  if (journal.schemaVersion !== 1 || typeof journal.id !== 'string' || typeof journal.stagingDirectory !== 'string' || !Array.isArray(journal.artifacts)) return false
  if (!['staged', 'binding', 'publishing', 'commit_intent', 'projection_pending', 'abandoned'].includes(String(journal.phase))) return false
  return journal.artifacts.every((artifact) => {
    if (!artifact || typeof artifact !== 'object') return false
    const candidate = artifact as LessonPublicationJournal['artifacts'][number]
    return typeof candidate.relativePath === 'string' && typeof candidate.absolutePath === 'string' && typeof candidate.stagedPath === 'string' && /^[a-f0-9]{64}$/i.test(candidate.sha256) &&
      isPathInside(resolve(rootPath), resolve(candidate.absolutePath)) && isPathInside(resolve(rootPath), resolve(candidate.stagedPath))
  })
}

async function isCommittedPublication(rootPath: string, journal: LessonPublicationJournal): Promise<boolean> {
  const normal = journal.artifacts[0]
  if (!normal) return false
  for (const artifact of journal.artifacts) {
    try {
      const read = await readContainedRegularFileBounded(rootPath, artifact.absolutePath, MAX_PUBLICATION_ARTIFACT_BYTES)
      if (read.status !== 'ok' || createHash('sha256').update(read.content).digest('hex') !== artifact.sha256) return false
    } catch {
      return false
    }
  }
  return true
}

async function cleanupIncompletePublication(rootPath: string, journal: LessonPublicationJournal): Promise<boolean> {
  let clean = true
  for (const artifact of journal.artifacts) {
    if (!(await removeOwnedArtifact(rootPath, artifact.absolutePath, artifact.sha256))) clean = false
    if (!(await removeOwnedArtifact(rootPath, artifact.stagedPath, artifact.sha256))) clean = false
  }
  if (!(await removeOwnedStagingDirectory(rootPath, journal))) clean = false
  return clean
}

async function removeOwnedArtifact(rootPath: string, path: string, sha256: string): Promise<boolean> {
  try {
    const read = await readContainedRegularFileBounded(rootPath, path, MAX_PUBLICATION_ARTIFACT_BYTES)
    if (read.status === 'over_limit') return false
    if (createHash('sha256').update(read.content).digest('hex') !== sha256) return false
    await fs.rm(path, { force: false })
    return true
  } catch (error) {
    return isMissingPath(error)
  }
}

async function removeOwnedStagingDirectory(rootPath: string, journal: LessonPublicationJournal): Promise<boolean> {
  try {
    const staging = resolve(journal.stagingDirectory)
    if (!isPathInside(resolve(rootPath), staging)) return false
    const info = await fs.lstat(staging)
    if (info.isSymbolicLink() || !info.isDirectory() || basename(staging) !== `.studiumx-lesson-stage-${journal.id}`) return false
    await fs.rmdir(staging)
    return true
  } catch (error) {
    return isMissingPath(error)
  }
}

async function removeOwnedPublicationJournal(rootPath: string, journalPath: string): Promise<void> {
  const relativePath = relative(resolve(rootPath), resolve(journalPath)).replace(/\\/g, '/')
  if (!relativePath.startsWith(`${LESSON_PUBLICATION_JOURNAL_DIRECTORY}/`) || !relativePath.endsWith('.json')) {
    throw new Error('Lesson publication journal path is unsafe.')
  }
  await fs.rm(journalPath, { force: true })
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relation = relative(resolve(rootPath), resolve(targetPath))
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !relation.includes(`:${sep}`))
}

async function removeCreatedEmptyDirectories(createdDirectories: string[]): Promise<void> {
  for (const directory of [...createdDirectories].reverse()) {
    await fs.rmdir(directory).catch(() => undefined)
  }
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}