export const DEFAULT_COURSE_RELATIVE_PATH = 'lessons'
export const COURSES_ROOT_RELATIVE_PATH = 'courses'
export const DEFAULT_COURSE_LESSON_FOLDER_NAME = 'lessons'
export const COURSE_LESSON_FOLDER_NAME = 'lesson'
export const LEARNING_SESSIONS_ROOT_RELATIVE_PATH = 'learning-sessions'
export const LEARNING_SESSION_MANIFEST_FILE_NAME = 'session.json'
export const LEARNING_SESSION_EVENTS_DIRECTORY_NAME = 'events'
export const LEARNING_SESSION_OUTCOME_FILE_NAME = 'outcome.json'

const LEARNING_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9_-])?$/
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i
const WINDOWS_UNSAFE_SEGMENT_CHARACTER_PATTERN = /[<>\"|?*:\u0000-\u001f\u007f-\u009f]/
const WINDOWS_DRIVE_PREFIX_PATTERN = /^[A-Za-z]:/
const MAX_TEACHING_RELATIVE_PATH_LENGTH = 4096
const MAX_TEACHING_RELATIVE_PATH_SEGMENT_LENGTH = 255

export type CoursePlacement = {
  courseId: string
  courseName: string
  courseRelativePath: string
}

export type LessonPlacement = CoursePlacement & {
  sessionId: string
  sessionName: string
  sessionRelativePath: string
}

export type LessonArtifactPlacement = LessonPlacement & {
  lessonRelativePath: string
  assessmentRelativePath: string
  referenceRelativePath: string | null
  reviewsRelativePath: string | null
}

export function learningSessionRelativePath(sessionId: string): string {
  return joinTeachingRelativePath(LEARNING_SESSIONS_ROOT_RELATIVE_PATH, requireLearningSessionId(sessionId))
}

export function learningSessionManifestRelativePath(sessionId: string): string {
  return joinTeachingRelativePath(learningSessionRelativePath(sessionId), LEARNING_SESSION_MANIFEST_FILE_NAME)
}

export function learningSessionEventsRelativePath(sessionId: string): string {
  return joinTeachingRelativePath(learningSessionRelativePath(sessionId), LEARNING_SESSION_EVENTS_DIRECTORY_NAME)
}

export function learningSessionOutcomeRelativePath(sessionId: string): string {
  return joinTeachingRelativePath(learningSessionRelativePath(sessionId), LEARNING_SESSION_OUTCOME_FILE_NAME)
}

export function isLearningSessionId(value: string): boolean {
  return typeof value === 'string' &&
    LEARNING_SESSION_ID_PATTERN.test(value) &&
    !WINDOWS_DEVICE_NAME_PATTERN.test(value)
}

export function requireLearningSessionId(value: string): string {
  if (!isLearningSessionId(value)) throw new Error('Learning Session path requires a stable Session ID.')
  return value.toLocaleLowerCase('en-US')
}

/**
 * Validates portable workspace-relative refs using Windows' stricter path rules
 * on every platform. This prevents drive-relative, UNC, ADS/device-name, and
 * case-alias surprises before a ref is ever resolved against a workspace.
 */
export function requireSafeTeachingRelativePath(value: string, label = 'Teaching path'): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized.length > MAX_TEACHING_RELATIVE_PATH_LENGTH ||
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    WINDOWS_DRIVE_PREFIX_PATTERN.test(normalized)
  ) {
    throw new Error(`${label} must be a safe workspace-relative path.`)
  }
  const segments = normalized.split('/')
  if (segments.some((segment) =>
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.length > MAX_TEACHING_RELATIVE_PATH_SEGMENT_LENGTH ||
    segment.endsWith('.') ||
    segment.endsWith(' ') ||
    WINDOWS_UNSAFE_SEGMENT_CHARACTER_PATTERN.test(segment) ||
    WINDOWS_DEVICE_NAME_PATTERN.test(segment)
  )) {
    throw new Error(`${label} must be a safe workspace-relative path.`)
  }
  return normalized
}

/** Identity key for refs that resolve on Windows' case-insensitive namespace. */
export function windowsTeachingRelativePathKey(value: string): string {
  return requireSafeTeachingRelativePath(value).toLocaleLowerCase('en-US')
}

export function normalizeTeachingRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function joinTeachingRelativePath(...parts: string[]): string {
  return normalizeTeachingRelativePath(parts.filter(Boolean).join('/'))
}

export function sameTeachingRelativePath(left: string, right: string): boolean {
  return normalizeTeachingRelativePath(left) === normalizeTeachingRelativePath(right)
}

export function isDefaultCourseRelativePath(relativePath: string): boolean {
  return sameTeachingRelativePath(relativePath, DEFAULT_COURSE_RELATIVE_PATH)
}

export function isCourseRelativePath(relativePath: string): boolean {
  const normalized = normalizeTeachingRelativePath(relativePath)
  return normalized === DEFAULT_COURSE_RELATIVE_PATH || /^courses\/[^/]+$/.test(normalized)
}

export function courseRelativePathFromWorkspacePath(relativePath: string): string | null {
  const parts = normalizeTeachingRelativePath(relativePath).split('/').filter(Boolean)
  if (parts[0] === DEFAULT_COURSE_RELATIVE_PATH) return DEFAULT_COURSE_RELATIVE_PATH
  if (parts[0] === COURSES_ROOT_RELATIVE_PATH && parts[1]) return joinTeachingRelativePath(COURSES_ROOT_RELATIVE_PATH, parts[1])
  return null
}

export function courseRelativePathFromCourseName(workspaceName: string, requestedCourseName?: string | null): string {
  const requested = clampPlacementTitle(requestedCourseName ?? '')
  if (!requested || samePlacementTitle(requested, workspaceName)) return DEFAULT_COURSE_RELATIVE_PATH
  return joinTeachingRelativePath(COURSES_ROOT_RELATIVE_PATH, slugifyPlacement(requested, 'course'))
}

export function describeCoursePlacement(input: {
  workspaceName: string
  courseRelativePath?: string | null
  requestedCourseName?: string | null
}): CoursePlacement {
  const courseRelativePath = input.courseRelativePath
    ? normalizeTeachingRelativePath(input.courseRelativePath)
    : courseRelativePathFromCourseName(input.workspaceName, input.requestedCourseName)
  const parts = courseRelativePath.split('/').filter(Boolean)
  const courseName = isDefaultCourseRelativePath(courseRelativePath)
    ? clampPlacementTitle(input.workspaceName)
    : titleFromPlacementFilename(parts[1] ?? input.requestedCourseName ?? input.workspaceName)
  return {
    courseId: slugifyPlacement(courseName, 'course'),
    courseName,
    courseRelativePath
  }
}

export function lessonFolderNameForCourse(courseRelativePath: string): 'lessons' | 'lesson' {
  return isDefaultCourseRelativePath(courseRelativePath) ? DEFAULT_COURSE_LESSON_FOLDER_NAME : COURSE_LESSON_FOLDER_NAME
}

export function lessonFolderRelativePathForCourse(courseRelativePath: string): string {
  const course = normalizeTeachingRelativePath(courseRelativePath) || DEFAULT_COURSE_RELATIVE_PATH
  return isDefaultCourseRelativePath(course)
    ? DEFAULT_COURSE_RELATIVE_PATH
    : joinTeachingRelativePath(course, COURSE_LESSON_FOLDER_NAME)
}

export function deriveLessonPlacementFromRelativePath(input: {
  workspaceName: string
  relativePath: string
  title?: string
}): LessonPlacement {
  const relativePath = normalizeTeachingRelativePath(input.relativePath)
  const parts = relativePath.split('/').filter(Boolean)
  const file = parts.at(-1) ?? ''
  const courseRelativePath = courseRelativePathFromWorkspacePath(relativePath) ?? DEFAULT_COURSE_RELATIVE_PATH
  const course = describeCoursePlacement({ workspaceName: input.workspaceName, courseRelativePath })
  const idMatch = /^(\d{4})-/.exec(file)
  const sessionId = idMatch?.[1] ? `lesson-${idMatch[1]}` : `lesson-${file.slice(0, 4) || '0000'}`
  const sessionRelativePath = parts.length > 1 ? joinTeachingRelativePath(...parts.slice(0, -1)) : DEFAULT_COURSE_RELATIVE_PATH
  return {
    ...course,
    sessionId,
    sessionName: placementSessionName(input.title, file),
    sessionRelativePath
  }
}

export function buildLessonArtifactPlacement(input: {
  workspaceName: string
  sequence: number
  title: string
  requestedCourseName?: string | null
  includeReference: boolean
  includeReviews: boolean
}): LessonArtifactPlacement {
  const course = describeCoursePlacement({
    workspaceName: input.workspaceName,
    requestedCourseName: input.requestedCourseName
  })
  const paddedSequence = String(input.sequence).padStart(4, '0')
  const sessionId = `lesson-${paddedSequence}`
  const sessionName = `${paddedSequence} ${input.title}`
  const lessonDirRelativePath = lessonFolderRelativePathForCourse(course.courseRelativePath)
  const fileSlug = slugifyPlacement(input.title, 'lesson')
  const lessonRelativePath = joinTeachingRelativePath(lessonDirRelativePath, `${paddedSequence}-${fileSlug}.html`)
  const assessmentRelativePath = joinTeachingRelativePath(lessonDirRelativePath, `${paddedSequence}-${fileSlug}-assessment.html`)
  const referenceRelativePath = input.includeReference
    ? joinTeachingRelativePath(lessonDirRelativePath, `${paddedSequence}-${fileSlug}-reference.html`)
    : null
  const reviewsRelativePath = input.includeReviews
    ? joinTeachingRelativePath(lessonDirRelativePath, `${paddedSequence}-${fileSlug}-flashcards.json`)
    : null

  return {
    ...course,
    sessionId,
    sessionName,
    sessionRelativePath: lessonDirRelativePath,
    lessonRelativePath,
    assessmentRelativePath,
    referenceRelativePath,
    reviewsRelativePath
  }
}

function placementSessionName(title: string | undefined, file: string): string {
  const cleanedTitle = clampPlacementTitle(title ?? '')
  if (cleanedTitle) return cleanedTitle
  return titleFromPlacementFilename(file)
}

function clampPlacementTitle(value: string): string {
  const trimmed = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed
}

function samePlacementTitle(left: string, right: string): boolean {
  return clampPlacementTitle(left).toLocaleLowerCase() === clampPlacementTitle(right).toLocaleLowerCase()
}

function slugifyPlacement(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}

function titleFromPlacementFilename(file: string): string {
  return (
    file
      .replace(/\.[^.]+$/, '')
      .replace(/^\d{4}-/, '')
      .replace(/-reference$/i, '')
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join(' ') || file
  )
}
