import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { LessonSummary } from '../shared/teaching-types'
import {
  COURSES_ROOT_RELATIVE_PATH,
  DEFAULT_COURSE_RELATIVE_PATH,
  describeCoursePlacement,
  isCourseRelativePath,
  isDefaultCourseRelativePath,
  joinTeachingRelativePath,
  normalizeTeachingRelativePath
} from '../shared/teaching-placement'
import {
  readValidatedWithBackup,
  replaceWithBackup,
  type DurableFileOperations
} from './persistence/durable-file'
import { cleanText } from './teaching-workspace-paths'

/** Current durable CourseDefinition document version. */
export const COURSE_DEFINITION_SCHEMA_VERSION = 1 as const

/** Canonical filename inside a Course directory. */
export const COURSE_DEFINITION_FILE_NAME = 'course-definition.json'

/** Workspace-root Mission link used when no course-local mission exists. */
export const DEFAULT_MISSION_RELATIVE_PATH = 'MISSION.md'

export type CourseDefinitionSchemaVersion = typeof COURSE_DEFINITION_SCHEMA_VERSION

export type CourseDefinitionSessionStatus = 'planned' | 'active' | 'completed' | 'archived'

/**
 * One ordered Session slot inside a CourseDefinition.
 * relativePath is workspace-relative; lessonRelativePath is optional and may be null
 * for conversation-only or planned Sessions.
 */
export type CourseDefinitionSessionEntry = {
  sessionId: string
  name: string
  relativePath: string
  status: CourseDefinitionSessionStatus
  lessonRelativePath: string | null
}

/**
 * Durable CourseDefinition: stable identity, Mission link, goals, and Session
 * ordering. Filesystem layout remains the discoverable source for Lessons;
 * this document restores intentional order and status without SQLite-as-truth.
 */
export type CourseDefinition = {
  schemaVersion: CourseDefinitionSchemaVersion
  courseId: string
  courseName: string
  relativePath: string
  missionRelativePath: string
  goals: string[]
  sessions: CourseDefinitionSessionEntry[]
  updatedAt: string
}

export type CourseDefinitionSource = 'canonical' | 'backup' | 'materialized' | 'missing'

export type CourseDefinitionReadResult = {
  definition: CourseDefinition | null
  source: CourseDefinitionSource
  absolutePath: string
  relativePath: string
  canonicalStatus: 'valid' | 'missing' | 'invalid'
  backupStatus: 'valid' | 'missing' | 'invalid' | 'not-read'
}

export type CourseDefinitionRepairAction =
  | 'none'
  | 'materialize'
  | 'restore_from_backup'
  | 'rewrite_canonical'

/**
 * Safe repair report fields only. Dry-run reports never embed Mission text,
 * learner answers, or provider payloads; sessionCount is aggregate-only.
 */
export type CourseDefinitionRepairReport = {
  courseRelativePath: string
  definitionRelativePath: string
  action: CourseDefinitionRepairAction
  dryRun: boolean
  applied: boolean
  reason: string
  definition: CourseDefinition | null
  sessionCount: number
  goalCount: number
  issues: string[]
}

export type CourseDefinitionMaterializeInput = {
  workspaceName: string
  courseRelativePath: string
  courseId?: string
  courseName?: string
  missionRelativePath?: string
  goals?: string[]
  lessons?: readonly LessonSummary[]
  sessions?: readonly CourseDefinitionSessionEntry[]
  updatedAt?: string
}

export type CourseDefinitionStoreOptions = {
  workspaceRoot: string
  workspaceName: string
  operations?: DurableFileOperations
  warn?: (message: string) => void
  now?: () => string
}

const SESSION_STATUSES = new Set<CourseDefinitionSessionStatus>([
  'planned',
  'active',
  'completed',
  'archived'
])

/**
 * Thin durable adapter for per-Course definition documents.
 * Read never rewrites the filesystem. Materialize/repair can publish with
 * `.bak` retention; dry-run reports stay free of learner content and payloads.
 */
export class CourseDefinitionStore {
  private readonly workspaceRoot: string
  private readonly workspaceName: string
  private readonly operations: DurableFileOperations | undefined
  private readonly warn: ((message: string) => void) | undefined
  private readonly now: () => string

  constructor(options: CourseDefinitionStoreOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.workspaceName = options.workspaceName
    this.operations = options.operations
    this.warn = options.warn
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /** Workspace-relative path to the durable CourseDefinition document. */
  definitionRelativePath(courseRelativePath: string): string {
    const course = normalizeCourseRelativePath(courseRelativePath)
    return joinTeachingRelativePath(course, COURSE_DEFINITION_FILE_NAME)
  }

  /** Absolute path to the durable CourseDefinition document. */
  definitionAbsolutePath(courseRelativePath: string): string {
    return join(this.workspaceRoot, ...this.definitionRelativePath(courseRelativePath).split('/'))
  }

  /**
   * Reads the durable document. When missing/invalid, optionally returns an
   * in-memory materialization without writing (lazy view for old workspaces).
   */
  async read(
    courseRelativePath: string,
    options: {
      materializeIfMissing?: boolean
      materializeSource?: Omit<CourseDefinitionMaterializeInput, 'workspaceName' | 'courseRelativePath'>
    } = {}
  ): Promise<CourseDefinitionReadResult> {
    const course = normalizeCourseRelativePath(courseRelativePath)
    const relativePath = this.definitionRelativePath(course)
    const absolutePath = this.definitionAbsolutePath(course)
    const recovered = await readValidatedWithBackup({
      path: absolutePath,
      validate: isCourseDefinitionDocument,
      operations: this.operations
    })

    if (recovered.value) {
      return {
        definition: normalizeCourseDefinition(recovered.value, {
          workspaceName: this.workspaceName,
          courseRelativePath: course
        }),
        source: recovered.source === 'backup' ? 'backup' : 'canonical',
        absolutePath,
        relativePath,
        canonicalStatus: recovered.canonicalStatus,
        backupStatus: recovered.backupStatus
      }
    }

    if (options.materializeIfMissing) {
      const definition = materializeCourseDefinition({
        workspaceName: this.workspaceName,
        courseRelativePath: course,
        ...options.materializeSource,
        goals: options.materializeSource?.goals ?? (await this.readMissionGoals()),
        updatedAt: options.materializeSource?.updatedAt ?? this.now()
      })
      return {
        definition,
        source: 'materialized',
        absolutePath,
        relativePath,
        canonicalStatus: recovered.canonicalStatus,
        backupStatus: recovered.backupStatus
      }
    }

    return {
      definition: null,
      source: 'missing',
      absolutePath,
      relativePath,
      canonicalStatus: recovered.canonicalStatus,
      backupStatus: recovered.backupStatus
    }
  }

  /** Publishes a validated CourseDefinition with `.bak` retention. */
  async write(definition: CourseDefinition): Promise<CourseDefinition> {
    const normalized = normalizeCourseDefinition(definition, {
      workspaceName: this.workspaceName,
      courseRelativePath: definition.relativePath
    })
    if (!isCourseDefinitionDocument(normalized)) {
      throw new Error('Refusing to publish CourseDefinition that does not satisfy its durable validator.')
    }
    const next: CourseDefinition = {
      ...normalized,
      updatedAt: this.now()
    }
    await replaceWithBackup({
      path: this.definitionAbsolutePath(next.relativePath),
      content: `${JSON.stringify(next, null, 2)}\n`,
      validate: isCourseDefinitionDocument,
      operations: this.operations,
      warn: this.warn
    })
    return next
  }

  /**
   * Repairs one Course definition. dryRun never writes; live repair may restore
   * from backup or lazy-materialize a missing definition once.
   */
  async repair(
    courseRelativePath: string,
    options: {
      dryRun?: boolean
      materializeSource?: Omit<CourseDefinitionMaterializeInput, 'workspaceName' | 'courseRelativePath'>
    } = {}
  ): Promise<CourseDefinitionRepairReport> {
    const course = normalizeCourseRelativePath(courseRelativePath)
    const definitionRelativePath = this.definitionRelativePath(course)
    const dryRun = options.dryRun === true
    const issues: string[] = []
    const current = await this.read(course, { materializeIfMissing: false })

    if (current.source === 'canonical' && current.definition) {
      return repairReport({
        courseRelativePath: course,
        definitionRelativePath,
        action: 'none',
        dryRun,
        applied: false,
        reason: 'canonical_course_definition_valid',
        definition: dryRun ? null : current.definition,
        issues
      })
    }

    if (current.source === 'backup' && current.definition) {
      issues.push('canonical_invalid_or_missing_backup_valid')
      if (dryRun) {
        return repairReport({
          courseRelativePath: course,
          definitionRelativePath,
          action: 'restore_from_backup',
          dryRun: true,
          applied: false,
          reason: 'would_restore_valid_backup',
          definition: null,
          sessionCount: current.definition.sessions.length,
          goalCount: current.definition.goals.length,
          issues
        })
      }
      const restored = await this.write(current.definition)
      return repairReport({
        courseRelativePath: course,
        definitionRelativePath,
        action: 'restore_from_backup',
        dryRun: false,
        applied: true,
        reason: 'restored_from_backup',
        definition: restored,
        issues
      })
    }

    if (current.canonicalStatus === 'invalid') issues.push('canonical_invalid')
    if (current.backupStatus === 'invalid') issues.push('backup_invalid')
    if (current.canonicalStatus === 'missing' && current.backupStatus === 'missing') {
      issues.push('definition_absent')
    }

    const definition = materializeCourseDefinition({
      workspaceName: this.workspaceName,
      courseRelativePath: course,
      ...options.materializeSource,
      goals: options.materializeSource?.goals ?? (await this.readMissionGoals()),
      updatedAt: options.materializeSource?.updatedAt ?? this.now()
    })

    if (dryRun) {
      return repairReport({
        courseRelativePath: course,
        definitionRelativePath,
        action: current.canonicalStatus === 'invalid' ? 'rewrite_canonical' : 'materialize',
        dryRun: true,
        applied: false,
        reason: current.canonicalStatus === 'invalid' ? 'would_rewrite_invalid_canonical' : 'would_materialize_missing_definition',
        definition: null,
        sessionCount: definition.sessions.length,
        goalCount: definition.goals.length,
        issues
      })
    }

    const written = await this.write(definition)
    return repairReport({
      courseRelativePath: course,
      definitionRelativePath,
      action: current.canonicalStatus === 'invalid' ? 'rewrite_canonical' : 'materialize',
      dryRun: false,
      applied: true,
      reason: current.canonicalStatus === 'invalid' ? 'rewrote_invalid_canonical' : 'materialized_missing_definition',
      definition: written,
      issues
    })
  }

  /**
   * Lazy materialization entry: write only when the durable document is absent
   * or unusable. Healthy canonical documents are left untouched.
   */
  async materialize(
    input: Omit<CourseDefinitionMaterializeInput, 'workspaceName'>,
    options: { dryRun?: boolean } = {}
  ): Promise<CourseDefinitionRepairReport> {
    return this.repair(input.courseRelativePath, {
      dryRun: options.dryRun,
      materializeSource: input
    })
  }

  /**
   * Discovers Course relative paths from the filesystem (default lessons and
   * courses children) so catalog rebuilds do not depend on prior definition files.
   */
  async listCourseRelativePaths(): Promise<string[]> {
    const paths = new Set<string>()
    paths.add(DEFAULT_COURSE_RELATIVE_PATH)

    const coursesRoot = join(this.workspaceRoot, COURSES_ROOT_RELATIVE_PATH)
    try {
      const entries = await readdir(coursesRoot, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name.startsWith('.')) continue
        paths.add(joinTeachingRelativePath(COURSES_ROOT_RELATIVE_PATH, entry.name))
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }

    return [...paths].sort((left, right) => {
      if (isDefaultCourseRelativePath(left)) return -1
      if (isDefaultCourseRelativePath(right)) return 1
      return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
  }

  /**
   * Dry-run repair across discovered Courses. Does not write. Report fields are
   * path/action codes only — no Mission text, learner answers, or provider payloads.
   */
  async planWorkspaceRepair(options: {
    lessons?: readonly LessonSummary[]
  } = {}): Promise<CourseDefinitionRepairReport[]> {
    const coursePaths = await this.listCourseRelativePaths()
    const lessonsByCourse = groupLessonsByCourse(options.lessons ?? [])
    const reports: CourseDefinitionRepairReport[] = []
    for (const courseRelativePath of coursePaths) {
      reports.push(
        await this.repair(courseRelativePath, {
          dryRun: true,
          materializeSource: {
            lessons: lessonsByCourse.get(normalizeTeachingRelativePath(courseRelativePath)) ?? []
          }
        })
      )
    }
    return reports
  }

  private async readMissionGoals(): Promise<string[]> {
    return readMissionGoals(this.workspaceRoot, this.operations)
  }
}

/** Pure materialization used by read/repair without forcing a full-workspace migrate. */
export function materializeCourseDefinition(input: CourseDefinitionMaterializeInput): CourseDefinition {
  const courseRelativePath = normalizeCourseRelativePath(input.courseRelativePath)
  const placement = describeCoursePlacement({
    workspaceName: input.workspaceName,
    courseRelativePath
  })
  const sessions = input.sessions
    ? input.sessions.map(normalizeSessionEntry)
    : sessionsFromLessons(input.lessons ?? [], courseRelativePath)

  return {
    schemaVersion: COURSE_DEFINITION_SCHEMA_VERSION,
    courseId: cleanText(input.courseId) || placement.courseId,
    courseName: cleanText(input.courseName) || placement.courseName,
    relativePath: courseRelativePath,
    missionRelativePath: normalizeTeachingRelativePath(input.missionRelativePath || DEFAULT_MISSION_RELATIVE_PATH) || DEFAULT_MISSION_RELATIVE_PATH,
    goals: normalizeGoals(input.goals ?? []),
    sessions,
    updatedAt: input.updatedAt || new Date(0).toISOString()
  }
}

/** Applies durable Session ordering onto a list of Session-like rows when definition is present. */
export function orderSessionsByCourseDefinition<T extends { id: string; relativePath?: string }>(
  sessions: readonly T[],
  definition: CourseDefinition | null | undefined
): T[] {
  if (!definition || definition.sessions.length === 0) {
    return [...sessions].sort((left, right) => left.id.localeCompare(right.id))
  }
  const rank = new Map(definition.sessions.map((entry, index) => [entry.sessionId, index]))
  return [...sessions].sort((left, right) => {
    const leftRank = rank.get(left.id)
    const rightRank = rank.get(right.id)
    if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
    if (leftRank !== undefined) return -1
    if (rightRank !== undefined) return 1
    return left.id.localeCompare(right.id)
  })
}

export function isCourseDefinitionDocument(value: unknown): value is CourseDefinition {
  if (!value || typeof value !== 'object') return false
  const document = value as Partial<CourseDefinition>
  if (document.schemaVersion !== COURSE_DEFINITION_SCHEMA_VERSION) return false
  if (!isNonEmptyString(document.courseId)) return false
  if (!isNonEmptyString(document.courseName)) return false
  if (!isNonEmptyString(document.relativePath) || !isCourseRelativePath(document.relativePath)) return false
  if (!isNonEmptyString(document.missionRelativePath)) return false
  if (!Array.isArray(document.goals) || !document.goals.every((goal) => typeof goal === 'string')) return false
  if (!Array.isArray(document.sessions) || !document.sessions.every(isSessionEntry)) return false
  if (!isNonEmptyString(document.updatedAt)) return false
  return true
}

export function normalizeCourseDefinition(
  value: CourseDefinition,
  context: { workspaceName: string; courseRelativePath?: string }
): CourseDefinition {
  const courseRelativePath = normalizeCourseRelativePath(context.courseRelativePath || value.relativePath)
  const placement = describeCoursePlacement({
    workspaceName: context.workspaceName,
    courseRelativePath
  })
  return {
    schemaVersion: COURSE_DEFINITION_SCHEMA_VERSION,
    courseId: cleanText(value.courseId) || placement.courseId,
    courseName: cleanText(value.courseName) || placement.courseName,
    relativePath: courseRelativePath,
    missionRelativePath: normalizeTeachingRelativePath(value.missionRelativePath || DEFAULT_MISSION_RELATIVE_PATH) || DEFAULT_MISSION_RELATIVE_PATH,
    goals: normalizeGoals(value.goals),
    sessions: value.sessions.map(normalizeSessionEntry),
    updatedAt: isNonEmptyString(value.updatedAt) ? value.updatedAt : new Date(0).toISOString()
  }
}

export async function readMissionGoals(
  workspaceRoot: string,
  operations?: DurableFileOperations
): Promise<string[]> {
  const missionPath = join(workspaceRoot, DEFAULT_MISSION_RELATIVE_PATH)
  let content = ''
  try {
    content = operations
      ? await operations.readFile(missionPath, 'utf8')
      : await readFile(missionPath, 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return []
    throw error
  }
  return extractGoalsFromMissionMarkdown(content)
}

export function extractGoalsFromMissionMarkdown(content: string): string[] {
  const section =
    /##[ \t]+Success looks like[ \t]*\r?\n([\s\S]*?)(?=\r?\n##[ \t]+\S|\s*$)/.exec(content)?.[1] ??
    /##[ \t]+Success[ \t]*\r?\n([\s\S]*?)(?=\r?\n##[ \t]+\S|\s*$)/.exec(content)?.[1] ??
    ''
  return normalizeGoals(
    section
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
      .filter(Boolean)
  )
}

function repairReport(input: {
  courseRelativePath: string
  definitionRelativePath: string
  action: CourseDefinitionRepairAction
  dryRun: boolean
  applied: boolean
  reason: string
  definition: CourseDefinition | null
  sessionCount?: number
  goalCount?: number
  issues: string[]
}): CourseDefinitionRepairReport {
  return {
    courseRelativePath: input.courseRelativePath,
    definitionRelativePath: input.definitionRelativePath,
    action: input.action,
    dryRun: input.dryRun,
    applied: input.applied,
    reason: input.reason,
    definition: input.definition,
    sessionCount: input.sessionCount ?? input.definition?.sessions.length ?? 0,
    goalCount: input.goalCount ?? input.definition?.goals.length ?? 0,
    issues: input.issues
  }
}

function sessionsFromLessons(
  lessons: readonly LessonSummary[],
  courseRelativePath: string
): CourseDefinitionSessionEntry[] {
  const course = normalizeTeachingRelativePath(courseRelativePath)
  return lessons
    .filter((lesson) => normalizeTeachingRelativePath(lesson.courseRelativePath || '') === course)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((lesson) => ({
      sessionId: cleanText(lesson.sessionId) || `lesson-${lesson.id}`,
      name: cleanText(lesson.sessionName) || cleanText(lesson.title) || lesson.id,
      relativePath: normalizeTeachingRelativePath(lesson.sessionRelativePath || lesson.relativePath),
      status: 'planned' as const,
      lessonRelativePath: normalizeTeachingRelativePath(lesson.relativePath) || null
    }))
}

function groupLessonsByCourse(lessons: readonly LessonSummary[]): Map<string, LessonSummary[]> {
  const map = new Map<string, LessonSummary[]>()
  for (const lesson of lessons) {
    const course = normalizeTeachingRelativePath(lesson.courseRelativePath || DEFAULT_COURSE_RELATIVE_PATH)
    const list = map.get(course) ?? []
    list.push(lesson)
    map.set(course, list)
  }
  return map
}

function normalizeCourseRelativePath(value: string): string {
  const normalized = normalizeTeachingRelativePath(value) || DEFAULT_COURSE_RELATIVE_PATH
  if (!isCourseRelativePath(normalized)) {
    throw new Error('CourseDefinition requires a Course-relative path (lessons or courses/<name>).')
  }
  return normalized
}

function normalizeGoals(goals: readonly string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const goal of goals) {
    const cleaned = cleanText(goal)
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    next.push(cleaned)
  }
  return next
}

function normalizeSessionEntry(entry: CourseDefinitionSessionEntry): CourseDefinitionSessionEntry {
  return {
    sessionId: cleanText(entry.sessionId),
    name: cleanText(entry.name) || cleanText(entry.sessionId),
    relativePath: normalizeTeachingRelativePath(entry.relativePath),
    status: SESSION_STATUSES.has(entry.status) ? entry.status : 'planned',
    lessonRelativePath: entry.lessonRelativePath
      ? normalizeTeachingRelativePath(entry.lessonRelativePath)
      : null
  }
}

function isSessionEntry(value: unknown): value is CourseDefinitionSessionEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CourseDefinitionSessionEntry>
  if (!isNonEmptyString(entry.sessionId)) return false
  if (!isNonEmptyString(entry.name)) return false
  if (!isNonEmptyString(entry.relativePath)) return false
  if (!entry.status || !SESSION_STATUSES.has(entry.status)) return false
  if (entry.lessonRelativePath !== null && entry.lessonRelativePath !== undefined && typeof entry.lessonRelativePath !== 'string') {
    return false
  }
  return true
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
