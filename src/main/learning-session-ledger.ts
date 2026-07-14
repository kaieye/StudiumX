import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import {
  LEARNING_SESSION_SCHEMA_VERSION,
  type AppendLearningSessionEventInput,
  type CanonicalLearningSessionSnapshot,
  type LearningOutcomeRef,
  type LearningSessionDiagnostic,
  type LearningSessionEvent,
  type LearningSessionEventKind,
  type LearningSessionSnapshot,
  type LegacyLearningSessionSnapshot,
  type OpenLearningSessionInput
} from '../shared/teaching-types/learning-session'
import {
  LEARNING_SESSIONS_ROOT_RELATIVE_PATH,
  LEARNING_SESSION_EVENTS_DIRECTORY_NAME,
  LEARNING_SESSION_MANIFEST_FILE_NAME,
  isLearningSessionId,
  learningSessionOutcomeRelativePath
} from '../shared/teaching-placement'
import type { LessonSummary } from '../shared/teaching-types/workspace'
import { isPathInsideRoot } from './path-access'

const LEARNING_SESSIONS_DIRECTORY = LEARNING_SESSIONS_ROOT_RELATIVE_PATH
const SESSION_MANIFEST_FILE = LEARNING_SESSION_MANIFEST_FILE_NAME
const SESSION_EVENTS_DIRECTORY = LEARNING_SESSION_EVENTS_DIRECTORY_NAME
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const EVENT_FILE_PATTERN = /^[a-f0-9]{64}\.json$/
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_EVENT_BYTES = 1024 * 1024
const MAX_JSON_DEPTH = 64
const EVENT_KINDS = new Set<LearningSessionEventKind>([
  'lesson_opened',
  'lesson_completed',
  'retrieval_attempted',
  'quiz_attempted',
  'flashcard_reviewed',
  'learner_response_recorded'
])
const sessionWriteTails = new Map<string, Promise<void>>()

type CanonicalLearningSessionManifest = Omit<CanonicalLearningSessionSnapshot, 'events'>

export type LegacyLearningSessionResolver = (sessionId: string) => Promise<LegacyLearningSessionSnapshot | null>

export type LearningSessionLedgerOptions = {
  workspaceRoot: string
  now?: () => string
  createId?: () => string
  resolveLegacySession?: LegacyLearningSessionResolver
}

export interface LearningSessionLedger {
  open(input: OpenLearningSessionInput): Promise<LearningSessionSnapshot>
  append(sessionId: string, event: AppendLearningSessionEventInput): Promise<LearningSessionSnapshot>
  complete(sessionId: string, outcomeRef: LearningOutcomeRef): Promise<LearningSessionSnapshot>
  load(sessionId: string): Promise<LearningSessionSnapshot | null>
}

export type LearningSessionLedgerErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'read_only'
  | 'invalid_transition'
  | 'identity_conflict'
  | 'corrupt_session'
  | 'unsafe_storage'

export class LearningSessionLedgerError extends Error {
  constructor(
    readonly code: LearningSessionLedgerErrorCode,
    message: string,
    readonly diagnostic?: LearningSessionDiagnostic
  ) {
    super(message)
    this.name = 'LearningSessionLedgerError'
  }
}

export function createLearningSessionLedger(options: LearningSessionLedgerOptions): LearningSessionLedger {
  return new FileLearningSessionLedger(options)
}

export function projectLegacyLessonToLearningSession(
  lesson: LessonSummary,
  workspaceId: string | null = null
): LegacyLearningSessionSnapshot {
  const createdAt = requireIsoTimestamp(lesson.createdAt, 'Legacy Lesson createdAt')
  return {
    schemaVersion: LEARNING_SESSION_SCHEMA_VERSION,
    id: requireSessionId(lesson.sessionId, 'Legacy Session ID'),
    workspaceId: workspaceId === null ? null : requireNonEmptyText(workspaceId, 'Workspace ID'),
    source: 'legacy_lesson',
    readOnly: true,
    status: 'legacy_read_only',
    version: 0,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    courseRef: normalizeCourseRef({
      courseId: lesson.courseId,
      courseName: lesson.courseName,
      relativePath: lesson.courseRelativePath
    }),
    lessonRef: normalizeLessonRef({
      lessonId: lesson.id,
      title: lesson.title,
      relativePath: lesson.relativePath
    }),
    conversationRefs: [],
    eventCount: 0,
    outcomeRef: null,
    events: []
  }
}

class FileLearningSessionLedger implements LearningSessionLedger {
  private readonly now: () => string
  private readonly createId: () => string

  constructor(private readonly options: LearningSessionLedgerOptions) {
    if (!options.workspaceRoot.trim()) throw invalidInput('Teaching workspace root is required.')
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? (() => `session-${randomUUID()}`)
  }

  async open(input: OpenLearningSessionInput): Promise<LearningSessionSnapshot> {
    const sessionId = requireSessionId(input.sessionId ?? this.createId(), 'Session ID')
    const workspaceRoot = await prepareWorkspaceRoot(this.options.workspaceRoot)
    return withSessionWriteLock(workspaceRoot, sessionId, async () => {
      const learningSessionsRoot = join(workspaceRoot, LEARNING_SESSIONS_DIRECTORY)
      await ensureContainedDirectory(workspaceRoot, learningSessionsRoot)
      const sessionRoot = join(learningSessionsRoot, sessionId)

      const existing = await this.loadUnlocked(workspaceRoot, sessionId)
      if (existing) {
        if (existing.readOnly) throw new LearningSessionLedgerError('read_only', `Session "${sessionId}" is a legacy read-only projection.`)
        assertSameOpenIdentity(existing, input)
        const conversationRefs = mergeConversationRefs(existing.conversationRefs, input.conversationRefs ?? [])
        if (JSON.stringify(conversationRefs) === JSON.stringify(existing.conversationRefs)) return existing
        if (existing.status !== 'active') {
          throw new LearningSessionLedgerError('invalid_transition', `Cannot bind a conversation to completed Session "${sessionId}".`)
        }
        const updatedAt = requireIsoTimestamp(this.now(), 'Session update time')
        const nextManifest: CanonicalLearningSessionManifest = {
          ...manifestFromSnapshot(existing),
          version: existing.version + 1,
          updatedAt: latestTimestamp(existing.updatedAt, updatedAt),
          conversationRefs
        }
        await durableAtomicReplaceFile(join(sessionRoot, SESSION_MANIFEST_FILE), serializeManifest(nextManifest))
        await syncDirectory(sessionRoot)
        return { ...nextManifest, events: existing.events }
      }

      const createdAt = requireIsoTimestamp(this.now(), 'Session creation time')
      const manifest: CanonicalLearningSessionManifest = {
        schemaVersion: LEARNING_SESSION_SCHEMA_VERSION,
        id: sessionId,
        workspaceId: requireNonEmptyText(input.workspaceId, 'Workspace ID'),
        source: 'canonical',
        readOnly: false,
        status: 'active',
        version: 1,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        courseRef: normalizeCourseRef(input.courseRef),
        lessonRef: input.lessonRef ? normalizeLessonRef(input.lessonRef) : null,
        conversationRefs: normalizeConversationRefs(input.conversationRefs ?? []),
        eventCount: 0,
        outcomeRef: null
      }

      const stagingRoot = join(learningSessionsRoot, `.session-stage-${sessionId}-${randomUUID()}`)
      await ensureContainedDirectory(workspaceRoot, stagingRoot)
      try {
        await ensureContainedDirectory(workspaceRoot, join(stagingRoot, SESSION_EVENTS_DIRECTORY))
        await durableWriteNewFile(join(stagingRoot, SESSION_MANIFEST_FILE), serializeManifest(manifest))
        await syncDirectory(stagingRoot)
        try {
          await rename(stagingRoot, sessionRoot)
        } catch (error) {
          if (!isErrnoException(error, 'EEXIST') && !isErrnoException(error, 'ENOTEMPTY')) throw error
          const raced = await this.loadUnlocked(workspaceRoot, sessionId)
          if (!raced || raced.readOnly) throw error
          assertSameOpenIdentity(raced, input)
          return raced
        }
        await syncDirectory(learningSessionsRoot)
        return { ...manifest, events: [] }
      } finally {
        await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
      }
    })
  }

  async append(sessionId: string, event: AppendLearningSessionEventInput): Promise<LearningSessionSnapshot> {
    const safeSessionId = requireSessionId(sessionId, 'Session ID')
    const workspaceRoot = await prepareWorkspaceRoot(this.options.workspaceRoot)
    return withSessionWriteLock(workspaceRoot, safeSessionId, async () => {
      const current = await this.loadUnlocked(workspaceRoot, safeSessionId)
      if (!current) throw new LearningSessionLedgerError('not_found', `Learning Session "${safeSessionId}" was not found.`)
      if (current.readOnly) throw new LearningSessionLedgerError('read_only', `Session "${safeSessionId}" is a legacy read-only projection.`)
      if (current.status !== 'active') {
        throw new LearningSessionLedgerError('invalid_transition', `Cannot append evidence to completed Session "${safeSessionId}".`)
      }

      const normalizedInput = normalizeEventInput(event, safeSessionId)
      const duplicate = current.events.find((candidate) => candidate.eventId === normalizedInput.eventId)
      if (duplicate) {
        if (!sameEventInput(duplicate, normalizedInput)) {
          throw new LearningSessionLedgerError('identity_conflict', `Event ID "${normalizedInput.eventId}" already exists with different content.`)
        }
        return current
      }

      const recordedAt = requireIsoTimestamp(this.now(), 'Session event recordedAt')
      const persistedEvent: LearningSessionEvent = {
        ...normalizedInput,
        sequence: current.events.length + 1,
        recordedAt
      }
      const sessionRoot = join(workspaceRoot, LEARNING_SESSIONS_DIRECTORY, safeSessionId)
      const eventsRoot = join(sessionRoot, SESSION_EVENTS_DIRECTORY)
      await assertSafeExistingDirectory(workspaceRoot, eventsRoot, safeSessionId)
      const eventPath = join(eventsRoot, eventFilename(persistedEvent.eventId))
      const publish = await durablePublishImmutableFile(eventPath, serializeJson(persistedEvent))
      if (publish === 'existing') {
        const raced = await readAndParseEvent(workspaceRoot, safeSessionId, eventPath)
        if (!sameEventInput(raced, normalizedInput)) {
          throw new LearningSessionLedgerError('identity_conflict', `Event ID "${normalizedInput.eventId}" already exists with different content.`)
        }
        return this.loadCanonicalRequired(workspaceRoot, safeSessionId)
      }
      await syncDirectory(eventsRoot)

      const nextEvents = [...current.events, persistedEvent]
      const nextManifest: CanonicalLearningSessionManifest = {
        ...manifestFromSnapshot(current),
        version: current.version + 1,
        updatedAt: latestTimestamp(current.updatedAt, recordedAt),
        eventCount: nextEvents.length
      }
      await durableAtomicReplaceFile(join(sessionRoot, SESSION_MANIFEST_FILE), serializeManifest(nextManifest))
      await syncDirectory(sessionRoot)
      return { ...nextManifest, events: nextEvents }
    })
  }

  async complete(sessionId: string, outcomeRef: LearningOutcomeRef): Promise<LearningSessionSnapshot> {
    const safeSessionId = requireSessionId(sessionId, 'Session ID')
    const workspaceRoot = await prepareWorkspaceRoot(this.options.workspaceRoot)
    return withSessionWriteLock(workspaceRoot, safeSessionId, async () => {
      const current = await this.loadUnlocked(workspaceRoot, safeSessionId)
      if (!current) throw new LearningSessionLedgerError('not_found', `Learning Session "${safeSessionId}" was not found.`)
      if (current.readOnly) throw new LearningSessionLedgerError('read_only', `Session "${safeSessionId}" is a legacy read-only projection.`)
      const normalizedOutcomeRef = normalizeOutcomeRef(outcomeRef, safeSessionId)
      if (current.status === 'completed') {
        if (JSON.stringify(current.outcomeRef) !== JSON.stringify(normalizedOutcomeRef)) {
          throw new LearningSessionLedgerError('invalid_transition', `Completed Session "${safeSessionId}" cannot be committed to a different outcome.`)
        }
        return current
      }

      const knownEventIds = new Set(current.events.map((event) => event.eventId))
      const missingEvidenceIds = normalizedOutcomeRef.evidenceEventIds.filter((eventId) => !knownEventIds.has(eventId))
      if (missingEvidenceIds.length > 0) {
        throw invalidInput(`Learning outcome references unknown Session evidence: ${missingEvidenceIds.join(', ')}.`)
      }
      const outcomePath = join(workspaceRoot, ...normalizedOutcomeRef.relativePath.split('/'))
      const outcomeInfo = await lstat(outcomePath).catch((error: unknown) => {
        if (isErrnoException(error, 'ENOENT')) return null
        throw error
      })
      if (!outcomeInfo || outcomeInfo.isSymbolicLink() || !outcomeInfo.isFile()) {
        throw invalidInput('Learning outcome must be published as a regular canonical file before Session completion.')
      }
      await assertRealContained(workspaceRoot, outcomePath, safeSessionId)

      const completedAt = requireIsoTimestamp(this.now(), 'Session completion time')
      const nextManifest: CanonicalLearningSessionManifest = {
        ...manifestFromSnapshot(current),
        status: 'completed',
        version: current.version + 1,
        updatedAt: latestTimestamp(current.updatedAt, completedAt),
        completedAt,
        outcomeRef: normalizedOutcomeRef
      }
      const sessionRoot = join(workspaceRoot, LEARNING_SESSIONS_DIRECTORY, safeSessionId)
      await durableAtomicReplaceFile(join(sessionRoot, SESSION_MANIFEST_FILE), serializeManifest(nextManifest))
      await syncDirectory(sessionRoot)
      return { ...nextManifest, events: current.events }
    })
  }

  async load(sessionId: string): Promise<LearningSessionSnapshot | null> {
    const safeSessionId = requireSessionId(sessionId, 'Session ID')
    const workspaceRoot = await prepareWorkspaceRoot(this.options.workspaceRoot)
    return withSessionWriteLock(workspaceRoot, safeSessionId, () => this.loadUnlocked(workspaceRoot, safeSessionId))
  }

  private async loadUnlocked(workspaceRoot: string, safeSessionId: string): Promise<LearningSessionSnapshot | null> {
    const sessionRoot = join(workspaceRoot, LEARNING_SESSIONS_DIRECTORY, safeSessionId)
    const info = await lstat(sessionRoot).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (!info) return this.loadLegacy(safeSessionId)
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw corruptSession(safeSessionId, `${LEARNING_SESSIONS_DIRECTORY}/${safeSessionId}`, 'Session storage must be a regular directory.', 'unsafe_session_storage')
    }
    await assertRealContained(workspaceRoot, sessionRoot, safeSessionId)

    const manifestPath = join(sessionRoot, SESSION_MANIFEST_FILE)
    const manifestInfo = await lstat(manifestPath).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (!manifestInfo || manifestInfo.isSymbolicLink() || !manifestInfo.isFile()) {
      throw corruptSession(safeSessionId, relativePath(workspaceRoot, manifestPath), 'Session manifest must be a regular file.', 'invalid_session_manifest')
    }
    if (manifestInfo.size > MAX_MANIFEST_BYTES) {
      throw corruptSession(safeSessionId, relativePath(workspaceRoot, manifestPath), 'Session manifest exceeds the size limit.', 'invalid_session_manifest')
    }
    await assertRealContained(workspaceRoot, manifestPath, safeSessionId)

    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
    } catch (error) {
      throw corruptSession(
        safeSessionId,
        relativePath(workspaceRoot, manifestPath),
        `Session manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        'invalid_session_manifest'
      )
    }
    const manifest = parseManifest(parsed, safeSessionId, relativePath(workspaceRoot, manifestPath))
    const events = await readSessionEvents(workspaceRoot, safeSessionId, sessionRoot)
    const repaired = reconcileManifest(
      manifest,
      events,
      safeSessionId,
      relativePath(workspaceRoot, join(sessionRoot, SESSION_EVENTS_DIRECTORY))
    )
    if (JSON.stringify(repaired) !== JSON.stringify(manifest)) {
      await durableAtomicReplaceFile(manifestPath, serializeManifest(repaired))
      await syncDirectory(sessionRoot)
    }
    return { ...repaired, events }
  }

  private async loadCanonicalRequired(
    workspaceRoot: string,
    sessionId: string
  ): Promise<CanonicalLearningSessionSnapshot> {
    const loaded = await this.loadUnlocked(workspaceRoot, sessionId)
    if (!loaded || loaded.readOnly) throw new LearningSessionLedgerError('not_found', `Canonical Learning Session "${sessionId}" was not found.`)
    return loaded
  }

  private async loadLegacy(sessionId: string): Promise<LearningSessionSnapshot | null> {
    const legacy = await this.options.resolveLegacySession?.(sessionId)
    if (!legacy) return null
    return normalizeLegacyProjection(legacy, sessionId)
  }
}

async function readSessionEvents(
  workspaceRoot: string,
  sessionId: string,
  sessionRoot: string
): Promise<LearningSessionEvent[]> {
  const eventsRoot = join(sessionRoot, SESSION_EVENTS_DIRECTORY)
  await assertSafeExistingDirectory(workspaceRoot, eventsRoot, sessionId)
  const entries = await readdir(eventsRoot, { withFileTypes: true })
  const events: LearningSessionEvent[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.event-stage-')) {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw corruptSession(sessionId, relativePath(workspaceRoot, join(eventsRoot, entry.name)), 'Session event staging entry is unsafe.', 'invalid_session_event')
      }
      continue
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !EVENT_FILE_PATTERN.test(entry.name)) {
      throw corruptSession(sessionId, relativePath(workspaceRoot, join(eventsRoot, entry.name)), 'Session events directory contains an unsafe or unknown entry.', 'invalid_session_event')
    }
    const eventPath = join(eventsRoot, entry.name)
    const event = await readAndParseEvent(workspaceRoot, sessionId, eventPath)
    if (entry.name !== eventFilename(event.eventId)) {
      throw corruptSession(sessionId, relativePath(workspaceRoot, eventPath), 'Session event filename does not match its eventId.', 'invalid_session_event')
    }
    events.push(event)
  }
  events.sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId))
  const seenIds = new Set<string>()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (seenIds.has(event.eventId)) {
      throw corruptSession(sessionId, relativePath(workspaceRoot, eventsRoot), `Session eventId "${event.eventId}" is duplicated.`, 'invalid_session_event')
    }
    seenIds.add(event.eventId)
    if (event.sequence !== index + 1) {
      throw corruptSession(sessionId, relativePath(workspaceRoot, eventsRoot), 'Session event sequence is not contiguous.', 'event_sequence_conflict')
    }
  }
  return events
}

async function readAndParseEvent(workspaceRoot: string, sessionId: string, eventPath: string): Promise<LearningSessionEvent> {
  const info = await lstat(eventPath)
  if (info.isSymbolicLink() || !info.isFile()) {
    throw corruptSession(sessionId, relativePath(workspaceRoot, eventPath), 'Session event must be a regular file.', 'invalid_session_event')
  }
  if (info.size > MAX_EVENT_BYTES) {
    throw corruptSession(sessionId, relativePath(workspaceRoot, eventPath), 'Session event exceeds the size limit.', 'invalid_session_event')
  }
  await assertRealContained(workspaceRoot, eventPath, sessionId)
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(eventPath, 'utf8'))
  } catch (error) {
    throw corruptSession(
      sessionId,
      relativePath(workspaceRoot, eventPath),
      `Session event is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'invalid_session_event'
    )
  }
  return parseEvent(parsed, sessionId, relativePath(workspaceRoot, eventPath))
}

function parseEvent(value: unknown, sessionId: string, path: string): LearningSessionEvent {
  try {
    if (!isRecord(value)) throw new Error('Session event must contain an object.')
    assertOnlyKeys(value, ['schemaVersion', 'eventId', 'sessionId', 'kind', 'occurredAt', 'turnId', 'payload', 'sequence', 'recordedAt'])
    const normalized = normalizeEventInput(value, sessionId, true)
    return {
      ...normalized,
      sequence: requirePositiveInteger(value.sequence, 'Session event sequence'),
      recordedAt: requireIsoTimestamp(value.recordedAt, 'Session event recordedAt')
    }
  } catch (error) {
    throw corruptSession(sessionId, path, error instanceof Error ? error.message : String(error), 'invalid_session_event')
  }
}

function reconcileManifest(
  manifest: CanonicalLearningSessionManifest,
  events: LearningSessionEvent[],
  sessionId: string,
  eventsPath: string
): CanonicalLearningSessionManifest {
  if (manifest.eventCount > events.length) {
    throw corruptSession(
      sessionId,
      eventsPath,
      'Session manifest references evidence files that are missing.',
      'event_sequence_conflict'
    )
  }
  const unpublishedEventCount = events.length - manifest.eventCount
  const updatedAt = latestTimestamp(
    manifest.updatedAt,
    ...events.map((event) => event.recordedAt),
    ...(manifest.completedAt ? [manifest.completedAt] : [])
  )
  return {
    ...manifest,
    version: manifest.version + unpublishedEventCount,
    updatedAt,
    eventCount: events.length
  }
}

function parseManifest(value: unknown, expectedId: string, path: string): CanonicalLearningSessionManifest {
  try {
    if (!isRecord(value)) throw new Error('Session manifest must contain an object.')
    assertOnlyKeys(value, [
      'schemaVersion', 'id', 'workspaceId', 'source', 'readOnly', 'status', 'version', 'createdAt', 'updatedAt',
      'completedAt', 'courseRef', 'lessonRef', 'conversationRefs', 'eventCount', 'outcomeRef'
    ])
    if (value.schemaVersion !== LEARNING_SESSION_SCHEMA_VERSION) throw new Error('Unsupported Session schema version.')
    if (value.id !== expectedId) throw new Error('Session manifest ID does not match its directory.')
    if (value.source !== 'canonical' || value.readOnly !== false) throw new Error('Canonical Session identity flags are invalid.')
    if (value.status !== 'active' && value.status !== 'completed') throw new Error('Session status is invalid.')
    const createdAt = requireIsoTimestamp(value.createdAt, 'Session createdAt')
    const updatedAt = requireIsoTimestamp(value.updatedAt, 'Session updatedAt')
    const completedAt = value.completedAt === null ? null : requireIsoTimestamp(value.completedAt, 'Session completedAt')
    if (value.status === 'active' && completedAt !== null) throw new Error('Active Session cannot have completedAt.')
    if (value.status === 'completed' && completedAt === null) throw new Error('Completed Session requires completedAt.')
    if (value.status === 'active' && value.outcomeRef !== null) throw new Error('Active Session cannot have an outcome ref.')
    if (value.status === 'completed' && value.outcomeRef === null) throw new Error('Completed Session requires an outcome ref.')
    const version = requirePositiveInteger(value.version, 'Session version')
    const eventCount = requireNonNegativeInteger(value.eventCount, 'Session event count')
    const minimumVersion = 1 + eventCount + (value.status === 'completed' ? 1 : 0)
    if (version < minimumVersion) throw new Error('Session version is behind its canonical facts.')
    if (!Array.isArray(value.conversationRefs)) throw new Error('Session conversationRefs must be an array.')
    return {
      schemaVersion: LEARNING_SESSION_SCHEMA_VERSION,
      id: expectedId,
      workspaceId: requireNonEmptyText(value.workspaceId, 'Workspace ID'),
      source: 'canonical',
      readOnly: false,
      status: value.status,
      version,
      createdAt,
      updatedAt,
      completedAt,
      courseRef: normalizeCourseRef(value.courseRef),
      lessonRef: value.lessonRef === null ? null : normalizeLessonRef(value.lessonRef),
      conversationRefs: normalizeConversationRefs(value.conversationRefs),
      eventCount,
      outcomeRef: value.outcomeRef === null ? null : normalizeOutcomeRef(value.outcomeRef, expectedId)
    }
  } catch (error) {
    throw corruptSession(expectedId, path, error instanceof Error ? error.message : String(error), 'invalid_session_manifest')
  }
}

function normalizeLegacyProjection(value: LegacyLearningSessionSnapshot, expectedId: string): LegacyLearningSessionSnapshot {
  if (!isRecord(value)) throw invalidInput('Legacy Session resolver returned an invalid projection.')
  assertOnlyKeys(value, [
    'schemaVersion', 'id', 'workspaceId', 'source', 'readOnly', 'status', 'version', 'createdAt', 'updatedAt',
    'completedAt', 'courseRef', 'lessonRef', 'conversationRefs', 'eventCount', 'outcomeRef', 'events'
  ])
  if (
    value.schemaVersion !== LEARNING_SESSION_SCHEMA_VERSION ||
    value.id !== expectedId ||
    value.source !== 'legacy_lesson' ||
    value.readOnly !== true ||
    value.status !== 'legacy_read_only' ||
    value.version !== 0 ||
    value.completedAt !== null ||
    value.eventCount !== 0 ||
    value.outcomeRef !== null ||
    !Array.isArray(value.conversationRefs) ||
    value.conversationRefs.length !== 0 ||
    !Array.isArray(value.events) ||
    value.events.length !== 0
  ) {
    throw invalidInput('Legacy Session resolver returned an invalid projection.')
  }
  return {
    ...value,
    workspaceId: value.workspaceId === null ? null : requireNonEmptyText(value.workspaceId, 'Workspace ID'),
    createdAt: requireIsoTimestamp(value.createdAt, 'Legacy Session createdAt'),
    updatedAt: requireIsoTimestamp(value.updatedAt, 'Legacy Session updatedAt'),
    courseRef: normalizeCourseRef(value.courseRef),
    lessonRef: normalizeLessonRef(value.lessonRef),
    conversationRefs: [],
    events: []
  }
}

function assertSameOpenIdentity(snapshot: CanonicalLearningSessionSnapshot, input: OpenLearningSessionInput): void {
  const expected = {
    workspaceId: requireNonEmptyText(input.workspaceId, 'Workspace ID'),
    courseRef: normalizeCourseRef(input.courseRef),
    lessonRef: input.lessonRef ? normalizeLessonRef(input.lessonRef) : null
  }
  if (JSON.stringify({
    workspaceId: snapshot.workspaceId,
    courseRef: snapshot.courseRef,
    lessonRef: snapshot.lessonRef
  }) !== JSON.stringify(expected)) {
    throw new LearningSessionLedgerError('identity_conflict', `Session "${snapshot.id}" already exists with different identity references.`)
  }
}

function mergeConversationRefs(
  existing: CanonicalLearningSessionSnapshot['conversationRefs'],
  requested: OpenLearningSessionInput['conversationRefs']
): CanonicalLearningSessionSnapshot['conversationRefs'] {
  const merged = new Map(existing.map((ref) => [ref.conversationId, ref]))
  for (const ref of normalizeConversationRefs(requested ?? [])) {
    const current = merged.get(ref.conversationId)
    if (current && current.relativePath !== ref.relativePath) {
      throw new LearningSessionLedgerError(
        'identity_conflict',
        `Conversation "${ref.conversationId}" is already bound to a different Session path.`
      )
    }
    merged.set(ref.conversationId, ref)
  }
  return [...merged.values()].sort((left, right) => left.conversationId.localeCompare(right.conversationId))
}

function normalizeEventInput(value: unknown, expectedSessionId: string, persisted = false): AppendLearningSessionEventInput {
  if (!isRecord(value)) throw invalidInput('Session event must be an object.')
  const allowedKeys = persisted
    ? ['schemaVersion', 'eventId', 'sessionId', 'kind', 'occurredAt', 'turnId', 'payload', 'sequence', 'recordedAt']
    : ['schemaVersion', 'eventId', 'sessionId', 'kind', 'occurredAt', 'turnId', 'payload']
  const unexpectedKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key))
  if (unexpectedKeys.length > 0) throw invalidInput('Session event contains unknown fields: ' + unexpectedKeys.join(', ') + '.')
  if (value.schemaVersion !== LEARNING_SESSION_SCHEMA_VERSION) throw invalidInput('Session event schema version is unsupported.')
  const sessionId = requireSessionId(value.sessionId, 'Session event sessionId')
  if (sessionId !== expectedSessionId) throw invalidInput('Session event sessionId does not match append target.')
  if (typeof value.kind !== 'string' || !EVENT_KINDS.has(value.kind as LearningSessionEventKind)) {
    throw invalidInput('Session event kind is unsupported.')
  }
  if (!isRecord(value.payload)) throw invalidInput('Session event payload must be a JSON object.')
  const payload = cloneJsonObject(value.payload, 'Session event payload')
  const turnId = value.turnId === undefined ? undefined : requireStableId(value.turnId, 'Session event turnId')
  return {
    schemaVersion: LEARNING_SESSION_SCHEMA_VERSION,
    eventId: requireStableId(value.eventId, 'Session eventId'),
    sessionId,
    kind: value.kind as LearningSessionEventKind,
    occurredAt: requireIsoTimestamp(value.occurredAt, 'Session event occurredAt'),
    ...(turnId ? { turnId } : {}),
    payload
  }
}

function normalizeOutcomeRef(value: unknown, sessionId: string): LearningOutcomeRef {
  if (!isRecord(value)) throw invalidInput('Learning outcome ref must be an object.')
  assertOnlyKeys(value, ['outcomeId', 'kind', 'relativePath', 'evidenceEventIds'])
  const kinds = new Set(['established', 'misconception_corrected', 'needs_practice', 'not_evidenced'])
  if (typeof value.kind !== 'string' || !kinds.has(value.kind)) throw invalidInput('Learning outcome kind is invalid.')
  if (!Array.isArray(value.evidenceEventIds)) throw invalidInput('Learning outcome evidence refs must be an array.')
  const relativeOutcomePath = requireSafeRelativePath(value.relativePath, 'Learning outcome path')
  const expectedPath = learningSessionOutcomeRelativePath(sessionId)
  if (relativeOutcomePath !== expectedPath) throw invalidInput(`Learning outcome path must be ${expectedPath}.`)
  return {
    outcomeId: requireStableId(value.outcomeId, 'Learning outcome ID'),
    kind: value.kind as LearningOutcomeRef['kind'],
    relativePath: relativeOutcomePath,
    evidenceEventIds: uniqueStableIds(value.evidenceEventIds, 'Learning outcome evidence event ID')
  }
}

function normalizeCourseRef(value: unknown) {
  if (!isRecord(value)) throw invalidInput('Course ref must be an object.')
  assertOnlyKeys(value, ['courseId', 'courseName', 'relativePath'])
  return {
    courseId: requireNonEmptyText(value.courseId, 'Course ID'),
    courseName: requireNonEmptyText(value.courseName, 'Course name'),
    relativePath: requireSafeRelativePath(value.relativePath, 'Course path')
  }
}

function normalizeLessonRef(value: unknown) {
  if (!isRecord(value)) throw invalidInput('Lesson ref must be an object.')
  assertOnlyKeys(value, ['lessonId', 'title', 'relativePath'])
  return {
    lessonId: requireNonEmptyText(value.lessonId, 'Lesson ID'),
    title: requireNonEmptyText(value.title, 'Lesson title'),
    relativePath: requireSafeRelativePath(value.relativePath, 'Lesson path')
  }
}

function normalizeConversationRef(value: unknown) {
  if (!isRecord(value)) throw invalidInput('Conversation ref must be an object.')
  assertOnlyKeys(value, ['conversationId', 'relativePath'])
  return {
    conversationId: requireNonEmptyText(value.conversationId, 'Conversation ID'),
    relativePath: requireSafeRelativePath(value.relativePath, 'Conversation path')
  }
}

function normalizeConversationRefs(value: unknown[]): ReturnType<typeof normalizeConversationRef>[] {
  const normalized = value.map(normalizeConversationRef)
  const ids = new Set<string>()
  for (const ref of normalized) {
    if (ids.has(ref.conversationId)) throw invalidInput(`Conversation ref "${ref.conversationId}" is duplicated.`)
    ids.add(ref.conversationId)
  }
  return normalized.sort((left, right) => left.conversationId.localeCompare(right.conversationId))
}

function manifestFromSnapshot(snapshot: CanonicalLearningSessionSnapshot): CanonicalLearningSessionManifest {
  const { events: _events, ...manifest } = snapshot
  return manifest
}

async function prepareWorkspaceRoot(rootPath: string): Promise<string> {
  const absoluteRoot = resolve(rootPath)
  const rootInfo = await stat(absoluteRoot)
  if (!rootInfo.isDirectory()) throw new LearningSessionLedgerError('unsafe_storage', 'Teaching workspace root must be a directory.')
  return realpath(absoluteRoot)
}

async function ensureContainedDirectory(rootPath: string, targetPath: string): Promise<void> {
  if (!isPathInsideRoot(rootPath, targetPath)) throw new LearningSessionLedgerError('unsafe_storage', 'Session path escapes the Teaching workspace.')
  const relation = relative(rootPath, targetPath)
  let current = rootPath
  for (const part of relation.split(sep).filter(Boolean)) {
    current = join(current, part)
    const info = await lstat(current).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (info) {
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new LearningSessionLedgerError('unsafe_storage', `Session directory path is unsafe: ${relativePath(rootPath, current)}`)
      }
      continue
    }
    try {
      await mkdir(current)
    } catch (error) {
      if (!isErrnoException(error, 'EEXIST')) throw error
    }
    const created = await lstat(current)
    if (created.isSymbolicLink() || !created.isDirectory()) {
      throw new LearningSessionLedgerError('unsafe_storage', `Session directory path is unsafe: ${relativePath(rootPath, current)}`)
    }
  }
  await assertRealContained(rootPath, targetPath)
}

async function assertSafeExistingDirectory(rootPath: string, targetPath: string, sessionId: string): Promise<void> {
  if (!isPathInsideRoot(rootPath, targetPath)) {
    throw corruptSession(sessionId, relativePath(rootPath, targetPath), 'Session directory escapes the Teaching workspace.', 'unsafe_session_storage')
  }
  const info = await lstat(targetPath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!info || info.isSymbolicLink() || !info.isDirectory()) {
    throw corruptSession(sessionId, relativePath(rootPath, targetPath), 'Session directory must be a regular directory.', 'unsafe_session_storage')
  }
  await assertRealContained(rootPath, targetPath, sessionId)
}

async function assertRealContained(rootPath: string, targetPath: string, sessionId?: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  if (!isPathInsideRoot(realRoot, realTarget)) {
    if (sessionId) {
      throw corruptSession(sessionId, relativePath(rootPath, targetPath), 'Session path escapes the Teaching workspace through a symbolic link.', 'unsafe_session_storage')
    }
    throw new LearningSessionLedgerError('unsafe_storage', 'Session path escapes the Teaching workspace through a symbolic link.')
  }
}

async function durableWriteNewFile(path: string, content: string): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function durablePublishImmutableFile(path: string, content: string): Promise<'published' | 'existing'> {
  const tempPath = join(dirname(path), `.event-stage-${randomUUID()}`)
  await durableWriteNewFile(tempPath, content)
  try {
    try {
      await link(tempPath, path)
    } catch (error) {
      if (isErrnoException(error, 'EEXIST')) return 'existing'
      throw error
    }
    return 'published'
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

async function durableAtomicReplaceFile(path: string, content: string): Promise<void> {
  const tempPath = join(dirname(path), `.manifest-stage-${randomUUID()}`)
  await durableWriteNewFile(tempPath, content)
  try {
    await rename(tempPath, path)
    await syncDirectory(dirname(path))
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined)
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, 'r').catch((error: unknown) => {
    if (isErrnoException(error, 'EISDIR') || isErrnoException(error, 'EPERM') || isErrnoException(error, 'EINVAL')) return null
    throw error
  })
  if (!handle) return
  try {
    await handle.sync().catch((error: unknown) => {
      if (!isErrnoException(error, 'EINVAL') && !isErrnoException(error, 'EPERM')) throw error
    })
  } finally {
    await handle.close()
  }
}

async function withSessionWriteLock<T>(workspaceRoot: string, sessionId: string, operation: () => Promise<T>): Promise<T> {
  const key = `${workspaceRoot.toLocaleLowerCase()}\u0000${sessionId}`
  const previous = sessionWriteTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const tail = previous.then(() => gate)
  sessionWriteTails.set(key, tail)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (sessionWriteTails.get(key) === tail) sessionWriteTails.delete(key)
  }
}

function sameEventInput(event: LearningSessionEvent, input: AppendLearningSessionEventInput): boolean {
  const { sequence: _sequence, recordedAt: _recordedAt, ...persistedInput } = event
  return stableJsonStringify(persistedInput) === stableJsonStringify(input)
}

function eventFilename(eventId: string): string {
  return `${createHash('sha256').update(eventId).digest('hex')}.json`
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function serializeManifest(manifest: CanonicalLearningSessionManifest): string {
  const content = serializeJson(manifest)
  if (Buffer.byteLength(content, 'utf8') > MAX_MANIFEST_BYTES) {
    throw invalidInput('Session manifest exceeds the size limit.')
  }
  return content
}

function cloneJsonObject(value: Record<string, unknown>, label: string): Record<string, unknown> {
  try {
    const canonical = canonicalJsonValue(value, label)
    if (!isRecord(canonical)) throw invalidInput(`${label} must be a JSON object.`)
    const encoded = JSON.stringify(canonical)
    if (Buffer.byteLength(encoded, 'utf8') > MAX_EVENT_BYTES / 2) {
      throw invalidInput(`${label} exceeds the size limit.`)
    }
    return canonical
  } catch (error) {
    if (error instanceof LearningSessionLedgerError) throw error
    throw invalidInput(`${label} could not be serialized as strict JSON.`)
  }
}

function canonicalJsonValue(
  value: unknown,
  label: string,
  ancestors: Set<object> = new Set(),
  depth = 0
): unknown {
  if (depth > MAX_JSON_DEPTH) throw invalidInput(`${label} exceeds the nesting limit.`)
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidInput(`${label} contains a non-finite number.`)
    return value
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw invalidInput(`${label} contains a circular reference.`)
    ancestors.add(value)
    try {
      return Array.from({ length: value.length }, (_, index) => {
        if (!(index in value)) throw invalidInput(`${label} contains a sparse array.`)
        return canonicalJsonValue(value[index], `${label}[${index}]`, ancestors, depth + 1)
      })
    } finally {
      ancestors.delete(value)
    }
  }
  if (!isRecord(value)) throw invalidInput(`${label} must contain only JSON values.`)
  if (ancestors.has(value)) throw invalidInput(`${label} contains a circular reference.`)
  ancestors.add(value)
  try {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJsonValue(value[key], `${label}.${key}`, ancestors, depth + 1)])
    )
  } finally {
    ancestors.delete(value)
  }
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value, 'Session event'))
}

function latestTimestamp(...values: string[]): string {
  return [...values].sort().at(-1)!
}
function requireSessionId(value: unknown, label: string): string {
  const text = requireNonEmptyText(value, label)
  if (!isLearningSessionId(text)) throw invalidInput(`${label} is not a safe stable identifier.`)
  return text
}

function requireStableId(value: unknown, label: string): string {
  const text = requireNonEmptyText(value, label)
  if (!ID_PATTERN.test(text) || text === '.' || text === '..') throw invalidInput(`${label} is not a safe stable identifier.`)
  return text
}

function uniqueStableIds(values: unknown[], label: string): string[] {
  const ids = values.map((value) => requireStableId(value, label))
  if (new Set(ids).size !== ids.length) throw invalidInput(`${label}s must be unique.`)
  return ids
}

function requireNonEmptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalidInput(`${label} is required.`)
  return value.trim()
}

function requireSafeRelativePath(value: unknown, label: string): string {
  const text = requireNonEmptyText(value, label).replace(/\\/g, '/')
  if (isAbsolute(text) || text.startsWith('/') || text.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw invalidInput(`${label} must be a safe workspace-relative path.`)
  }
  return text
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const text = requireNonEmptyText(value, label)
  const date = new Date(text)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) throw invalidInput(`${label} must be an ISO timestamp.`)
  return text
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw invalidInput(`${label} must be a positive integer.`)
  return Number(value)
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw invalidInput(`${label} must be a non-negative integer.`)
  return Number(value)
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[]): void {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key))
  if (unexpected.length > 0) throw invalidInput(`Session file contains unknown fields: ${unexpected.join(', ')}.`)
}

function corruptSession(
  sessionId: string,
  path: string,
  message: string,
  code: LearningSessionDiagnostic['code']
): LearningSessionLedgerError {
  const diagnostic = { code, sessionId, relativePath: path, message }
  return new LearningSessionLedgerError('corrupt_session', `Learning Session "${sessionId}" is corrupt: ${message}`, diagnostic)
}

function invalidInput(message: string): LearningSessionLedgerError {
  return new LearningSessionLedgerError('invalid_input', message)
}

function relativePath(rootPath: string, path: string): string {
  return relative(rootPath, path).replace(/\\/g, '/')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
