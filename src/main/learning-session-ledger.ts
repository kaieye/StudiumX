import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { link, lstat, mkdir, open, opendir, readFile, readdir, realpath, rename, rm, rmdir, stat, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

import {
  LEARNING_SESSION_OUTCOME_SCHEMA_VERSION,
  LEARNING_SESSION_SCHEMA_VERSION,
  type AppendLearningSessionEventInput,
  type CanonicalLearningSessionSnapshot,
  type CommittedLearningSessionOutcome,
  type LearningOutcomeRef,
  type LearningSessionDiagnostic,
  type LearningSessionDurabilitySettlement,
  type LearningSessionEvent,
  type LearningSessionEventKind,
  type LearningSessionRecoveryInfo,
  type LearningSessionScanInput,
  type LearningSessionScanResult,
  type LearningSessionSnapshot,
  type LearningSessionStageInfo,
  type LegacyLearningSessionSnapshot,
  type OpenLearningSessionInput
} from '../shared/teaching-types/learning-session'
import {
  LEARNING_SESSIONS_ROOT_RELATIVE_PATH,
  LEARNING_SESSION_EVENTS_DIRECTORY_NAME,
  LEARNING_SESSION_MANIFEST_FILE_NAME,
  LEARNING_SESSION_OUTCOME_FILE_NAME,
  isLearningSessionId,
  learningSessionOutcomeRelativePath,
  requireLearningSessionId,
  requireSafeTeachingRelativePath,
  windowsTeachingRelativePathKey
} from '../shared/teaching-placement'
import type { LearningSessionTeachingSummary, LessonSummary } from '../shared/teaching-types/workspace'
import { isPathInsideRoot } from './path-access'

const LEARNING_SESSIONS_DIRECTORY = LEARNING_SESSIONS_ROOT_RELATIVE_PATH
const SESSION_MANIFEST_FILE = LEARNING_SESSION_MANIFEST_FILE_NAME
const SESSION_EVENTS_DIRECTORY = LEARNING_SESSION_EVENTS_DIRECTORY_NAME
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const EVENT_FILE_PATTERN = /^[a-f0-9]{64}\.json$/
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_EVENT_BYTES = 1024 * 1024
const MAX_OUTCOME_BYTES = 256 * 1024
const MAX_JSON_DEPTH = 64
const EVENT_KINDS = new Set<LearningSessionEventKind>([
  'lesson_opened',
  'lesson_completed',
  'retrieval_attempted',
  'quiz_attempted',
  'flashcard_reviewed',
  'learner_response_recorded'
])
const WRITER_LOCK_DIRECTORY = '.learning-session-ledger-writer.lock'
const WRITER_LOCK_OWNER_FILE = 'owner.json'
const RECOVERED_WRITER_LOCK_PREFIX = '.learning-session-ledger-recovered-lock-'
const WRITER_OWNER_INITIALIZATION_GRACE_MS = 1_000
const MAX_RECOVERED_WRITER_LOCKS = 32
const DEFAULT_WRITER_LOCK_WAIT_MS = 10_000
const DEFAULT_WRITER_LOCK_STALE_MS = 120_000
const WRITER_LOCK_POLL_MS = 20
const STALE_STAGE_MS = 5 * 60 * 1000
const MAX_STAGE_TREE_ENTRIES = 64
const MAX_STAGE_TREE_DEPTH = 4
const HARDLINK_FALLBACK_CODES = new Set(['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'])
const workspaceWriteTails = new Map<string, Promise<void>>()

type CanonicalLearningSessionManifest = Omit<CanonicalLearningSessionSnapshot, 'events'>

export type LegacyLearningSessionResolver = (sessionId: string) => Promise<LegacyLearningSessionSnapshot | null>

export type LearningSessionWriterOperation = 'open' | 'append' | 'complete' | 'load' | 'scan' | 'repair'

export type LearningSessionWriterOwner = {
  schemaVersion: 1
  token: string
  pid: number
  hostname: string
  operation: LearningSessionWriterOperation
  sessionId: string | null
  acquiredAt: string
}

export type LearningSessionLedgerFaultPoint =
  | 'after_writer_lock_acquired'
  | 'after_writer_lock_lstat'
  | 'after_state_loaded'
  | 'after_event_publish'
  | 'after_stage_sync'
  | 'after_file_stat'
  | 'before_manifest_repair'

export type LearningSessionLedgerFaultContext = {
  operation: LearningSessionWriterOperation
  sessionId: string | null
  path?: string
}

export type LearningSessionLedgerFaultHooks = {
  inject(point: LearningSessionLedgerFaultPoint, context: LearningSessionLedgerFaultContext): Promise<void> | void
}

export type LearningSessionLedgerOptions = {
  workspaceRoot: string
  now?: () => string
  createId?: () => string
  resolveLegacySession?: LegacyLearningSessionResolver
  writerLockWaitMs?: number
  writerLockStaleMs?: number
  testingFaults?: LearningSessionLedgerFaultHooks
}

export interface LearningSessionLedger {
  open(input: OpenLearningSessionInput): Promise<LearningSessionSnapshot>
  append(sessionId: string, event: AppendLearningSessionEventInput): Promise<LearningSessionSnapshot>
  complete(sessionId: string, outcomeRef: LearningOutcomeRef): Promise<LearningSessionSnapshot>
  load(sessionId: string): Promise<LearningSessionSnapshot | null>
  scan(input?: LearningSessionScanInput): Promise<LearningSessionScanResult>
}

export type LearningSessionLedgerErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'read_only'
  | 'invalid_transition'
  | 'identity_conflict'
  | 'corrupt_session'
  | 'unsafe_storage'
  | 'writer_busy'

export class LearningSessionLedgerError extends Error {
  constructor(
    readonly code: LearningSessionLedgerErrorCode,
    message: string,
    readonly diagnostic?: LearningSessionDiagnostic,
    readonly writerOwner?: LearningSessionWriterOwner | null
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

export function projectLearningSessionToTeachingSummary(
  snapshot: LearningSessionSnapshot
): LearningSessionTeachingSummary {
  const common = {
    id: snapshot.id,
    workspaceId: snapshot.workspaceId,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    completedAt: snapshot.completedAt,
    courseRef: snapshot.courseRef,
    lessonRef: snapshot.lessonRef,
    conversationRefs: snapshot.conversationRefs,
    version: snapshot.version,
    eventCount: snapshot.eventCount,
    outcomeRef: snapshot.outcomeRef
  }
  if (snapshot.source === 'canonical') {
    return {
      ...common,
      kind: 'canonical_learning_session',
      source: 'canonical',
      status: snapshot.status,
      readOnly: false,
      workspaceId: snapshot.workspaceId
    }
  }
  return {
    ...common,
    kind: 'legacy_lesson_projection',
    source: 'legacy_lesson',
    status: 'legacy_read_only',
    readOnly: true,
    lessonRef: snapshot.lessonRef,
    conversationRefs: [],
    version: 0,
    eventCount: 0,
    outcomeRef: null,
    completedAt: null
  }
}

export type EncodeCommittedLearningSessionOutcomeInput = {
  sessionId: string
  outcomeId: string
  kind: LearningOutcomeRef['kind']
  evidenceEventIds: string[]
}

export type EncodedCommittedLearningSessionOutcome = {
  envelope: CommittedLearningSessionOutcome
  content: string
  ref: LearningOutcomeRef
}

export function encodeCommittedLearningSessionOutcome(
  input: EncodeCommittedLearningSessionOutcomeInput
): EncodedCommittedLearningSessionOutcome {
  const sessionId = requireSessionId(input.sessionId, 'Outcome Session ID')
  const outcomeId = requireStableId(input.outcomeId, 'Learning outcome ID')
  const kind = requireOutcomeKind(input.kind)
  const evidenceEventIds = uniqueStableIds(input.evidenceEventIds, 'Learning outcome evidence event ID')
  const relativePath = learningSessionOutcomeRelativePath(sessionId)
  const envelope: CommittedLearningSessionOutcome = {
    schemaVersion: LEARNING_SESSION_OUTCOME_SCHEMA_VERSION,
    sessionId,
    outcomeId,
    kind,
    relativePath,
    evidenceEventIds
  }
  const content = serializeJson(envelope)
  return {
    envelope,
    content,
    ref: {
      outcomeId,
      kind,
      relativePath,
      evidenceEventIds,
      contentSha256: sha256(content)
    }
  }
}

class FileLearningSessionLedger implements LearningSessionLedger {
  private readonly now: () => string
  private readonly createId: () => string
  private readonly settlement: LearningSessionDurabilitySettlement = {
    fileSync: 'supported',
    directorySync: 'supported'
  }

  constructor(private readonly options: LearningSessionLedgerOptions) {
    if (!options.workspaceRoot.trim()) throw invalidInput('Teaching workspace root is required.')
    this.now = options.now ?? (() => new Date().toISOString())
    this.createId = options.createId ?? (() => `session-${randomUUID()}`)
  }

  async open(input: OpenLearningSessionInput): Promise<LearningSessionSnapshot> {
    const sessionId = requireSessionId(input.sessionId ?? this.createId(), 'Session ID')
    const normalizedIdentity = {
      workspaceId: requireNonEmptyText(input.workspaceId, 'Workspace ID'),
      courseRef: normalizeCourseRef(input.courseRef),
      lessonRef: input.lessonRef ? normalizeLessonRef(input.lessonRef) : null,
      conversationRefs: normalizeConversationRefs(input.conversationRefs ?? [])
    }
    return this.withWriter('open', sessionId, async (workspaceRoot) => {
      const sessionsRoot = join(workspaceRoot, LEARNING_SESSIONS_DIRECTORY)
      await ensureContainedDirectory(workspaceRoot, sessionsRoot, this.settlement)
      const existing = await this.loadUnlocked(workspaceRoot, sessionId, 'open')
      await injectFault(this.options, 'after_state_loaded', { operation: 'open', sessionId })
      if (existing) {
        if (existing.readOnly) {
          throw new LearningSessionLedgerError('read_only', `Session "${sessionId}" is a legacy read-only projection.`)
        }
        assertSameOpenIdentity(existing, normalizedIdentity)
        const conversationRefs = mergeConversationRefs(existing.conversationRefs, normalizedIdentity.conversationRefs)
        if (sameConversationRefs(conversationRefs, existing.conversationRefs)) return existing
        if (existing.status !== 'active') {
          throw new LearningSessionLedgerError('invalid_transition', `Cannot bind a conversation to completed Session "${sessionId}".`)
        }
        const sessionRoot = await requireCanonicalSessionRoot(workspaceRoot, sessionsRoot, sessionId)
        const updatedAt = latestTimestamp(existing.updatedAt, requireIsoTimestamp(this.now(), 'Session update time'))
        const nextManifest: CanonicalLearningSessionManifest = {
          ...manifestFromSnapshot(existing),
          version: existing.version + 1,
          updatedAt,
          conversationRefs
        }
        await durableAtomicReplaceFile(
          workspaceRoot,
          join(sessionRoot, SESSION_MANIFEST_FILE),
          serializeManifest(nextManifest),
          this.options,
          this.settlement,
          { operation: 'open', sessionId }
        )
        return { ...nextManifest, events: existing.events }
      }

      const createdAt = requireIsoTimestamp(this.now(), 'Session creation time')
      const manifest: CanonicalLearningSessionManifest = {
        schemaVersion: LEARNING_SESSION_SCHEMA_VERSION,
        id: sessionId,
        workspaceId: normalizedIdentity.workspaceId,
        source: 'canonical',
        readOnly: false,
        status: 'active',
        version: 1,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        courseRef: normalizedIdentity.courseRef,
        lessonRef: normalizedIdentity.lessonRef,
        conversationRefs: normalizedIdentity.conversationRefs,
        eventCount: 0,
        outcomeRef: null
      }
      const sessionRoot = join(sessionsRoot, sessionId)
      await publishNewSessionDirectory(
        workspaceRoot,
        sessionsRoot,
        sessionRoot,
        manifest,
        this.options,
        this.settlement,
        sessionId
      )
      return { ...manifest, events: [] }
    })
  }

  async append(sessionId: string, event: AppendLearningSessionEventInput): Promise<LearningSessionSnapshot> {
    const safeSessionId = requireSessionId(sessionId, 'Session ID')
    const normalizedInput = normalizeEventInput(event, safeSessionId)
    return this.withWriter('append', safeSessionId, async (workspaceRoot) => {
      const current = await this.loadUnlocked(workspaceRoot, safeSessionId, 'append')
      await injectFault(this.options, 'after_state_loaded', { operation: 'append', sessionId: safeSessionId })
      if (!current) throw new LearningSessionLedgerError('not_found', `Learning Session "${safeSessionId}" was not found.`)
      if (current.readOnly) {
        throw new LearningSessionLedgerError('read_only', `Session "${safeSessionId}" is a legacy read-only projection.`)
      }
      if (current.status !== 'active') {
        throw new LearningSessionLedgerError('invalid_transition', `Cannot append evidence to completed Session "${safeSessionId}".`)
      }
      const duplicate = current.events.find((candidate) => candidate.eventId === normalizedInput.eventId)
      if (duplicate) {
        if (!sameEventInput(duplicate, normalizedInput)) {
          throw new LearningSessionLedgerError('identity_conflict', `Event ID "${normalizedInput.eventId}" already exists with different content.`)
        }
        return current
      }

      const sessionsRoot = await requireLearningSessionsRoot(workspaceRoot)
      const sessionRoot = await requireCanonicalSessionRoot(workspaceRoot, sessionsRoot, safeSessionId)
      const recordedAt = requireIsoTimestamp(this.now(), 'Session event recordedAt')
      const persistedEvent: LearningSessionEvent = {
        ...normalizedInput,
        sequence: current.events.length + 1,
        recordedAt
      }
      const eventsRoot = join(sessionRoot, SESSION_EVENTS_DIRECTORY)
      await assertSafeExistingDirectory(workspaceRoot, eventsRoot, safeSessionId)
      await durablePublishImmutableFile(
        workspaceRoot,
        join(eventsRoot, eventFilename(persistedEvent.eventId)),
        serializeJson(persistedEvent),
        this.options,
        this.settlement,
        { operation: 'append', sessionId: safeSessionId }
      )
      await injectFault(this.options, 'after_event_publish', {
        operation: 'append',
        sessionId: safeSessionId,
        path: relativePath(workspaceRoot, join(eventsRoot, eventFilename(persistedEvent.eventId)))
      })

      const nextEvents = [...current.events, persistedEvent]
      const nextManifest: CanonicalLearningSessionManifest = {
        ...manifestFromSnapshot(current),
        version: current.version + 1,
        updatedAt: latestTimestamp(current.updatedAt, recordedAt),
        eventCount: nextEvents.length
      }
      await durableAtomicReplaceFile(
        workspaceRoot,
        join(sessionRoot, SESSION_MANIFEST_FILE),
        serializeManifest(nextManifest),
        this.options,
        this.settlement,
        { operation: 'append', sessionId: safeSessionId }
      )
      return { ...nextManifest, events: nextEvents }
    })
  }

  async complete(sessionId: string, outcomeRef: LearningOutcomeRef): Promise<LearningSessionSnapshot> {
    const safeSessionId = requireSessionId(sessionId, 'Session ID')
    return this.withWriter('complete', safeSessionId, async (workspaceRoot) => {
      const current = await this.loadUnlocked(workspaceRoot, safeSessionId, 'complete')
      await injectFault(this.options, 'after_state_loaded', { operation: 'complete', sessionId: safeSessionId })
      if (!current) throw new LearningSessionLedgerError('not_found', `Learning Session "${safeSessionId}" was not found.`)
      if (current.readOnly) {
        throw new LearningSessionLedgerError('read_only', `Session "${safeSessionId}" is a legacy read-only projection.`)
      }
      const normalizedOutcomeRef = normalizeOutcomeRef(outcomeRef, safeSessionId)
      if (current.status === 'completed') {
        if (!sameOutcomeRefs(current.outcomeRef, normalizedOutcomeRef)) {
          throw new LearningSessionLedgerError('invalid_transition', `Completed Session "${safeSessionId}" cannot be committed to a different outcome.`)
        }
        return current
      }

      const knownEventIds = new Set(current.events.map((candidate) => candidate.eventId))
      const missingEvidenceIds = normalizedOutcomeRef.evidenceEventIds.filter((eventId) => !knownEventIds.has(eventId))
      if (missingEvidenceIds.length > 0) {
        throw invalidInput(`Learning outcome references unknown Session evidence: ${missingEvidenceIds.join(', ')}.`)
      }
      const sessionsRoot = await requireLearningSessionsRoot(workspaceRoot)
      const sessionRoot = await requireCanonicalSessionRoot(workspaceRoot, sessionsRoot, safeSessionId)
      await validateCommittedOutcome(
        workspaceRoot,
        safeSessionId,
        sessionRoot,
        normalizedOutcomeRef,
        'input',
        this.options,
        'complete'
      )

      const completedAt = latestTimestamp(
        current.createdAt,
        current.updatedAt,
        requireIsoTimestamp(this.now(), 'Session completion time')
      )
      const nextManifest: CanonicalLearningSessionManifest = {
        ...manifestFromSnapshot(current),
        status: 'completed',
        version: current.version + 1,
        updatedAt: completedAt,
        completedAt,
        outcomeRef: normalizedOutcomeRef
      }
      await durableAtomicReplaceFile(
        workspaceRoot,
        join(sessionRoot, SESSION_MANIFEST_FILE),
        serializeManifest(nextManifest),
        this.options,
        this.settlement,
        { operation: 'complete', sessionId: safeSessionId }
      )
      await validateCommittedOutcome(
        workspaceRoot,
        safeSessionId,
        sessionRoot,
        normalizedOutcomeRef,
        'corrupt',
        this.options,
        'complete'
      )
      return { ...nextManifest, events: current.events }
    })
  }

  async load(sessionId: string): Promise<LearningSessionSnapshot | null> {
    const safeSessionId = requireSessionId(sessionId, 'Session ID')
    return this.withWriter('load', safeSessionId, async (workspaceRoot) => {
      const loaded = await this.loadUnlocked(workspaceRoot, safeSessionId, 'load')
      await injectFault(this.options, 'after_state_loaded', { operation: 'load', sessionId: safeSessionId })
      return loaded
    })
  }

  async scan(input: LearningSessionScanInput = {}): Promise<LearningSessionScanResult> {
    if (!isRecord(input)) throw invalidInput('Learning Session scan input must be an object.')
    assertOnlyKeys(input, ['legacyLessons'])
    if (input.legacyLessons !== undefined && !Array.isArray(input.legacyLessons)) {
      throw invalidInput('Learning Session legacy scan inputs must be an array.')
    }
    return this.withWriter('scan', null, async (workspaceRoot) => this.scanUnlocked(workspaceRoot, input))
  }

  private async withWriter<T>(
    operation: LearningSessionWriterOperation,
    sessionId: string | null,
    execute: (workspaceRoot: string) => Promise<T>
  ): Promise<T> {
    const workspaceRoot = await prepareWorkspaceRoot(this.options.workspaceRoot)
    return withFilesystemWriterLock(
      workspaceRoot,
      operation,
      sessionId,
      this.options,
      this.settlement,
      () => execute(workspaceRoot)
    )
  }

  private async loadUnlocked(
    workspaceRoot: string,
    safeSessionId: string,
    operation: LearningSessionWriterOperation
  ): Promise<LearningSessionSnapshot | null> {
    const sessionsRoot = await existingLearningSessionsRoot(workspaceRoot)
    if (!sessionsRoot) return this.loadLegacy(safeSessionId)
    const sessionRoot = await resolveCanonicalSessionRoot(workspaceRoot, sessionsRoot, safeSessionId)
    if (!sessionRoot) return this.loadLegacy(safeSessionId)
    return this.loadCanonicalAtRoot(workspaceRoot, safeSessionId, sessionRoot, operation)
  }

  private async loadCanonicalAtRoot(
    workspaceRoot: string,
    safeSessionId: string,
    sessionRoot: string,
    operation: LearningSessionWriterOperation
  ): Promise<CanonicalLearningSessionSnapshot> {
    await assertSafeExistingDirectory(workspaceRoot, sessionRoot, safeSessionId)
    const manifestPath = join(sessionRoot, SESSION_MANIFEST_FILE)
    const manifestBytes = await readStableRegularFile(
      workspaceRoot,
      manifestPath,
      MAX_MANIFEST_BYTES,
      safeSessionId,
      'invalid_session_manifest',
      this.options,
      operation
    )
    let parsed: unknown
    try {
      parsed = JSON.parse(manifestBytes.toString('utf8'))
    } catch (error) {
      throw corruptSession(
        safeSessionId,
        relativePath(workspaceRoot, manifestPath),
        `Session manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        'invalid_session_manifest'
      )
    }
    const manifest = parseManifest(parsed, safeSessionId, relativePath(workspaceRoot, manifestPath))
    const events = await readSessionEvents(workspaceRoot, safeSessionId, sessionRoot, this.options, operation)
    const repaired = reconcileManifest(
      manifest,
      events,
      safeSessionId,
      relativePath(workspaceRoot, join(sessionRoot, SESSION_EVENTS_DIRECTORY))
    )
    if (stableJsonStringify(repaired) !== stableJsonStringify(manifest)) {
      await injectFault(this.options, 'before_manifest_repair', {
        operation,
        sessionId: safeSessionId,
        path: relativePath(workspaceRoot, manifestPath)
      })
      await durableAtomicReplaceFile(
        workspaceRoot,
        manifestPath,
        serializeManifest(repaired),
        this.options,
        this.settlement,
        { operation: 'repair', sessionId: safeSessionId }
      )
    }
    if (repaired.status === 'completed' && repaired.outcomeRef) {
      const knownEventIds = new Set(events.map((event) => event.eventId))
      const missingEvidenceIds = repaired.outcomeRef.evidenceEventIds.filter((eventId) => !knownEventIds.has(eventId))
      if (missingEvidenceIds.length > 0) {
        throw corruptSession(
          safeSessionId,
          repaired.outcomeRef.relativePath,
          `Learning outcome references missing Session evidence: ${missingEvidenceIds.join(', ')}.`,
          'invalid_session_outcome'
        )
      }
      await validateCommittedOutcome(
        workspaceRoot,
        safeSessionId,
        sessionRoot,
        repaired.outcomeRef,
        'corrupt',
        this.options,
        operation
      )
    }
    return { ...repaired, events }
  }

  private async scanUnlocked(
    workspaceRoot: string,
    input: LearningSessionScanInput
  ): Promise<LearningSessionScanResult> {
    const diagnostics: LearningSessionDiagnostic[] = []
    const quarantined: LearningSessionScanResult['quarantined'] = []
    const stages: LearningSessionStageInfo[] = []
    const canonicalSessions: CanonicalLearningSessionSnapshot[] = []
    const canonicalIdentities = new Set<string>()
    const sessionsRoot = await existingLearningSessionsRoot(workspaceRoot)

    if (sessionsRoot) {
      const entries = await readdir(sessionsRoot, { withFileTypes: true })
      const aliases = new Map<string, string[]>()
      for (const entry of entries) {
        if (entry.name === WRITER_LOCK_DIRECTORY || entry.name.startsWith(RECOVERED_WRITER_LOCK_PREFIX)) continue
        if (entry.name.startsWith('.session-stage-')) {
          await inspectSessionStage(workspaceRoot, sessionsRoot, entry.name, stages, diagnostics, this.settlement)
          continue
        }
        if (!isLearningSessionId(entry.name)) {
          diagnostics.push({
            code: 'unsafe_session_storage',
            sessionId: entry.name.toLocaleLowerCase('en-US'),
            relativePath: relativePath(workspaceRoot, join(sessionsRoot, entry.name)),
            message: 'Learning Session root contains an unknown entry.'
          })
          continue
        }
        const id = requireSessionId(entry.name, 'Session ID')
        canonicalIdentities.add(id)
        const names = aliases.get(id) ?? []
        names.push(entry.name)
        aliases.set(id, names)
      }

      for (const [sessionId, names] of [...aliases].sort(([left], [right]) => left.localeCompare(right))) {
        if (names.length !== 1) {
          const diagnostic: LearningSessionDiagnostic = {
            code: 'canonical_identity_conflict',
            sessionId,
            relativePath: LEARNING_SESSIONS_DIRECTORY,
            message: `Multiple case aliases claim canonical Session "${sessionId}": ${names.sort().join(', ')}.`
          }
          diagnostics.push(diagnostic)
          quarantined.push({ sessionId, diagnostic })
          continue
        }
        const sessionRoot = join(sessionsRoot, names[0]!)
        await inspectCanonicalStages(
          workspaceRoot,
          sessionId,
          sessionRoot,
          stages,
          diagnostics,
          this.settlement
        )
        try {
          canonicalSessions.push(await this.loadCanonicalAtRoot(workspaceRoot, sessionId, sessionRoot, 'scan'))
        } catch (error) {
          if (!(error instanceof LearningSessionLedgerError) || error.code !== 'corrupt_session' || !error.diagnostic) throw error
          diagnostics.push(error.diagnostic)
          quarantined.push({ sessionId, diagnostic: error.diagnostic })
        }
      }
    }

    const legacySessions: LegacyLearningSessionSnapshot[] = []
    const seenLegacy = new Set<string>()
    for (const legacyInput of input.legacyLessons ?? []) {
      if (!isRecord(legacyInput) || !('lesson' in legacyInput)) {
        throw invalidInput('Legacy scan input must contain a Lesson summary.')
      }
      const legacy = projectLegacyLessonToLearningSession(
        legacyInput.lesson as LessonSummary,
        legacyInput.workspaceId === undefined ? null : legacyInput.workspaceId
      )
      if (canonicalIdentities.has(legacy.id)) {
        diagnostics.push({
          code: 'canonical_legacy_conflict',
          sessionId: legacy.id,
          relativePath: legacy.lessonRef.relativePath,
          message: 'Canonical Learning Session identity takes precedence over a legacy Lesson projection.'
        })
        continue
      }
      if (seenLegacy.has(legacy.id)) {
        throw invalidInput(`Legacy Session projection "${legacy.id}" is duplicated.`)
      }
      seenLegacy.add(legacy.id)
      legacySessions.push(legacy)
    }

    canonicalSessions.sort((left, right) => left.id.localeCompare(right.id))
    legacySessions.sort((left, right) => left.id.localeCompare(right.id))
    const recoveries = await inspectRecoveredWriterLocks(workspaceRoot, this.options)
    diagnostics.push(...recoveries.map((recovery) => ({
      code: 'writer_recovery' as const,
      sessionId: recovery.owner?.sessionId ?? 'workspace',
      relativePath: recovery.relativePath,
      message: 'A stale filesystem writer lock was recovered and preserved for diagnosis.'
    })))
    return {
      sessions: [...canonicalSessions, ...legacySessions].sort((left, right) => left.id.localeCompare(right.id)),
      canonicalSessions,
      legacySessions,
      diagnostics,
      quarantined,
      stages,
      recoveries,
      settlement: { ...this.settlement }
    }
  }

  private async loadLegacy(sessionId: string): Promise<LegacyLearningSessionSnapshot | null> {
    const legacy = await this.options.resolveLegacySession?.(sessionId)
    if (!legacy) return null
    return normalizeLegacyProjection(legacy, sessionId)
  }
}

async function readSessionEvents(
  workspaceRoot: string,
  sessionId: string,
  sessionRoot: string,
  options: LearningSessionLedgerOptions,
  operation: LearningSessionWriterOperation
): Promise<LearningSessionEvent[]> {
  const eventsRoot = join(sessionRoot, SESSION_EVENTS_DIRECTORY)
  await assertSafeExistingDirectory(workspaceRoot, eventsRoot, sessionId)
  const entries = await readdir(eventsRoot, { withFileTypes: true })
  const events: LearningSessionEvent[] = []
  for (const entry of entries) {
    const eventPath = join(eventsRoot, entry.name)
    if (entry.name.startsWith('.event-stage-')) {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw corruptSession(
          sessionId,
          relativePath(workspaceRoot, eventPath),
          'Session event staging entry is unsafe.',
          'invalid_session_event'
        )
      }
      continue
    }
    if (!entry.isFile() || entry.isSymbolicLink() || !EVENT_FILE_PATTERN.test(entry.name)) {
      throw corruptSession(
        sessionId,
        relativePath(workspaceRoot, eventPath),
        'Session events directory contains an unsafe or unknown entry.',
        'invalid_session_event'
      )
    }
    const event = await readAndParseEvent(workspaceRoot, sessionId, eventPath, options, operation)
    if (entry.name !== eventFilename(event.eventId)) {
      throw corruptSession(
        sessionId,
        relativePath(workspaceRoot, eventPath),
        'Session event filename does not match its eventId.',
        'invalid_session_event'
      )
    }
    events.push(event)
  }
  events.sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId))
  const seenIds = new Set<string>()
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!
    if (seenIds.has(event.eventId)) {
      throw corruptSession(
        sessionId,
        relativePath(workspaceRoot, eventsRoot),
        `Session eventId "${event.eventId}" is duplicated.`,
        'invalid_session_event'
      )
    }
    seenIds.add(event.eventId)
    if (event.sequence !== index + 1) {
      throw corruptSession(
        sessionId,
        relativePath(workspaceRoot, eventsRoot),
        'Session event sequence is not contiguous.',
        'event_sequence_conflict'
      )
    }
  }
  return events
}

async function readAndParseEvent(
  workspaceRoot: string,
  sessionId: string,
  eventPath: string,
  options: LearningSessionLedgerOptions,
  operation: LearningSessionWriterOperation
): Promise<LearningSessionEvent> {
  const bytes = await readStableRegularFile(
    workspaceRoot,
    eventPath,
    MAX_EVENT_BYTES,
    sessionId,
    'invalid_session_event',
    options,
    operation
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
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
  if (isRecord(value) && value.schemaVersion !== LEARNING_SESSION_SCHEMA_VERSION) {
    throw corruptSession(expectedId, path, 'Unsupported Session schema version.', 'unknown_session_schema')
  }
  try {
    if (!isRecord(value)) throw new Error('Session manifest must contain an object.')
    assertOnlyKeys(value, [
      'schemaVersion', 'id', 'workspaceId', 'source', 'readOnly', 'status', 'version', 'createdAt', 'updatedAt',
      'completedAt', 'courseRef', 'lessonRef', 'conversationRefs', 'eventCount', 'outcomeRef'
    ])
    const manifestId = requireSessionId(value.id, 'Session manifest ID')
    if (manifestId !== expectedId) throw new Error('Session manifest ID does not match its directory.')
    if (value.source !== 'canonical' || value.readOnly !== false) throw new Error('Canonical Session identity flags are invalid.')
    if (value.status !== 'active' && value.status !== 'completed') throw new Error('Session status is invalid.')
    const createdAt = requireIsoTimestamp(value.createdAt, 'Session createdAt')
    const updatedAt = requireIsoTimestamp(value.updatedAt, 'Session updatedAt')
    const completedAt = value.completedAt === null ? null : requireIsoTimestamp(value.completedAt, 'Session completedAt')
    if (updatedAt < createdAt) throw new Error('Session updatedAt cannot precede createdAt.')
    if (value.status === 'active' && completedAt !== null) throw new Error('Active Session cannot have completedAt.')
    if (value.status === 'completed' && completedAt === null) throw new Error('Completed Session requires completedAt.')
    if (completedAt !== null && (completedAt < createdAt || updatedAt < completedAt)) {
      throw new Error('Session completedAt must be between createdAt and updatedAt.')
    }
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
    if (error instanceof LearningSessionLedgerError && error.code === 'corrupt_session') throw error
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
    requireSessionId(value.id, 'Legacy Session ID') !== expectedId ||
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
  const createdAt = requireIsoTimestamp(value.createdAt, 'Legacy Session createdAt')
  const updatedAt = requireIsoTimestamp(value.updatedAt, 'Legacy Session updatedAt')
  if (updatedAt < createdAt) throw invalidInput('Legacy Session updatedAt cannot precede createdAt.')
  return {
    ...value,
    id: expectedId,
    workspaceId: value.workspaceId === null ? null : requireNonEmptyText(value.workspaceId, 'Workspace ID'),
    createdAt,
    updatedAt,
    courseRef: normalizeCourseRef(value.courseRef),
    lessonRef: normalizeLessonRef(value.lessonRef),
    conversationRefs: [],
    events: []
  }
}

function assertSameOpenIdentity(
  snapshot: CanonicalLearningSessionSnapshot,
  input: Pick<OpenLearningSessionInput, 'workspaceId' | 'courseRef' | 'lessonRef'>
): void {
  const workspaceId = requireNonEmptyText(input.workspaceId, 'Workspace ID')
  const courseRef = normalizeCourseRef(input.courseRef)
  const lessonRef = input.lessonRef ? normalizeLessonRef(input.lessonRef) : null
  if (
    snapshot.workspaceId !== workspaceId ||
    !sameCourseRefs(snapshot.courseRef, courseRef) ||
    !sameLessonRefs(snapshot.lessonRef, lessonRef)
  ) {
    throw new LearningSessionLedgerError(
      'identity_conflict',
      `Session "${snapshot.id}" already exists with different identity references.`
    )
  }
}

function sameCourseRefs(
  left: CanonicalLearningSessionSnapshot['courseRef'],
  right: CanonicalLearningSessionSnapshot['courseRef']
): boolean {
  return left.courseId === right.courseId &&
    left.courseName === right.courseName &&
    windowsTeachingRelativePathKey(left.relativePath) === windowsTeachingRelativePathKey(right.relativePath)
}

function sameLessonRefs(
  left: CanonicalLearningSessionSnapshot['lessonRef'],
  right: CanonicalLearningSessionSnapshot['lessonRef']
): boolean {
  if (left === null || right === null) return left === right
  return left.lessonId === right.lessonId &&
    left.title === right.title &&
    windowsTeachingRelativePathKey(left.relativePath) === windowsTeachingRelativePathKey(right.relativePath)
}

function mergeConversationRefs(
  existing: CanonicalLearningSessionSnapshot['conversationRefs'],
  requested: OpenLearningSessionInput['conversationRefs']
): CanonicalLearningSessionSnapshot['conversationRefs'] {
  const merged = new Map(existing.map((ref) => [ref.conversationId, ref]))
  for (const ref of normalizeConversationRefs(requested ?? [])) {
    const current = merged.get(ref.conversationId)
    if (current && windowsTeachingRelativePathKey(current.relativePath) !== windowsTeachingRelativePathKey(ref.relativePath)) {
      throw new LearningSessionLedgerError(
        'identity_conflict',
        `Conversation "${ref.conversationId}" is already bound to a different Session path.`
      )
    }
    if (!current) merged.set(ref.conversationId, ref)
  }
  return [...merged.values()].sort((left, right) => left.conversationId.localeCompare(right.conversationId))
}

function sameConversationRefs(
  left: CanonicalLearningSessionSnapshot['conversationRefs'],
  right: CanonicalLearningSessionSnapshot['conversationRefs']
): boolean {
  return stableJsonStringify(left) === stableJsonStringify(right)
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
  assertOnlyKeys(value, ['outcomeId', 'kind', 'relativePath', 'evidenceEventIds', 'contentSha256'])
  if (!Array.isArray(value.evidenceEventIds)) throw invalidInput('Learning outcome evidence refs must be an array.')
  const relativeOutcomePath = requireSafeRelativePath(value.relativePath, 'Learning outcome path')
  const expectedPath = learningSessionOutcomeRelativePath(sessionId)
  if (relativeOutcomePath !== expectedPath) throw invalidInput(`Learning outcome path must be ${expectedPath}.`)
  if (typeof value.contentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentSha256)) {
    throw invalidInput('Learning outcome content digest must be a lowercase SHA-256 value.')
  }
  return {
    outcomeId: requireStableId(value.outcomeId, 'Learning outcome ID'),
    kind: requireOutcomeKind(value.kind),
    relativePath: relativeOutcomePath,
    evidenceEventIds: uniqueStableIds(value.evidenceEventIds, 'Learning outcome evidence event ID'),
    contentSha256: value.contentSha256
  }
}

function requireOutcomeKind(value: unknown): LearningOutcomeRef['kind'] {
  const kinds = new Set<LearningOutcomeRef['kind']>([
    'established',
    'misconception_corrected',
    'needs_practice',
    'not_evidenced'
  ])
  if (typeof value !== 'string' || !kinds.has(value as LearningOutcomeRef['kind'])) {
    throw invalidInput('Learning outcome kind is invalid.')
  }
  return value as LearningOutcomeRef['kind']
}

function sameOutcomeRefs(left: LearningOutcomeRef | null, right: LearningOutcomeRef): boolean {
  return left !== null && stableJsonStringify(left) === stableJsonStringify(right)
}

async function validateCommittedOutcome(
  workspaceRoot: string,
  sessionId: string,
  sessionRoot: string,
  ref: LearningOutcomeRef,
  mode: 'input' | 'corrupt',
  options: LearningSessionLedgerOptions,
  operation: LearningSessionWriterOperation
): Promise<void> {
  const expectedRelativePath = learningSessionOutcomeRelativePath(sessionId)
  const outcomePath = join(sessionRoot, LEARNING_SESSION_OUTCOME_FILE_NAME)
  const fail = (message: string): never => {
    if (mode === 'input') throw invalidInput(message)
    throw corruptSession(
      sessionId,
      relativePath(workspaceRoot, outcomePath),
      message,
      'invalid_session_outcome'
    )
  }
  if (ref.relativePath !== expectedRelativePath) fail(`Learning outcome path must be ${expectedRelativePath}.`)
  const content = await readStableRegularFileRaw(
    workspaceRoot,
    outcomePath,
    MAX_OUTCOME_BYTES,
    options,
    operation,
    sessionId,
    fail
  )
  if (sha256(content) !== ref.contentSha256) fail('Learning outcome content digest does not match its committed reference.')
  let parsed: unknown
  try {
    parsed = JSON.parse(content.toString('utf8'))
  } catch (error) {
    fail(`Learning outcome is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed)) fail('Learning outcome envelope must be an object.')
  const record = parsed as Record<string, unknown>
  try {
    assertOnlyKeys(record, ['schemaVersion', 'sessionId', 'outcomeId', 'kind', 'relativePath', 'evidenceEventIds'])
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  if (record.schemaVersion !== LEARNING_SESSION_OUTCOME_SCHEMA_VERSION) {
    fail('Learning outcome schema version is unknown.')
  }
  if (!Array.isArray(record.evidenceEventIds)) fail('Learning outcome evidence refs must be an array.')
  let envelope: CommittedLearningSessionOutcome
  try {
    envelope = {
      schemaVersion: LEARNING_SESSION_OUTCOME_SCHEMA_VERSION,
      sessionId: requireSessionId(record.sessionId, 'Outcome Session ID'),
      outcomeId: requireStableId(record.outcomeId, 'Learning outcome ID'),
      kind: requireOutcomeKind(record.kind),
      relativePath: requireSafeRelativePath(record.relativePath, 'Learning outcome path'),
      evidenceEventIds: uniqueStableIds(record.evidenceEventIds as unknown[], 'Learning outcome evidence event ID')
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  if (
    envelope!.sessionId !== sessionId ||
    envelope!.outcomeId !== ref.outcomeId ||
    envelope!.kind !== ref.kind ||
    envelope!.relativePath !== ref.relativePath ||
    stableJsonStringify(envelope!.evidenceEventIds) !== stableJsonStringify(ref.evidenceEventIds)
  ) {
    fail('Learning outcome envelope does not match its committed Session reference.')
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

async function existingLearningSessionsRoot(workspaceRoot: string): Promise<string | null> {
  const sessionsRoot = join(workspaceRoot, LEARNING_SESSIONS_DIRECTORY)
  const info = await lstat(sessionsRoot).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!info) return null
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session root must be a regular directory.')
  }
  await assertRealContained(workspaceRoot, sessionsRoot)
  return sessionsRoot
}

async function requireLearningSessionsRoot(workspaceRoot: string): Promise<string> {
  const sessionsRoot = await existingLearningSessionsRoot(workspaceRoot)
  if (!sessionsRoot) throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session root disappeared during a ledger operation.')
  return sessionsRoot
}

async function resolveCanonicalSessionRoot(
  workspaceRoot: string,
  sessionsRoot: string,
  sessionId: string
): Promise<string | null> {
  await assertSafeWriterRoot(workspaceRoot, sessionsRoot)
  const entries = await readdir(sessionsRoot, { withFileTypes: true })
  const matches = entries.filter((entry) =>
    isLearningSessionId(entry.name) && requireLearningSessionId(entry.name) === sessionId
  )
  if (matches.length > 1) {
    throw corruptSession(
      sessionId,
      relativePath(workspaceRoot, sessionsRoot),
      `Multiple case aliases claim canonical Session "${sessionId}".`,
      'canonical_identity_conflict'
    )
  }
  if (matches.length === 0) return null
  const sessionRoot = join(sessionsRoot, matches[0]!.name)
  await assertSafeExistingDirectory(workspaceRoot, sessionRoot, sessionId)
  return sessionRoot
}

async function requireCanonicalSessionRoot(
  workspaceRoot: string,
  sessionsRoot: string,
  sessionId: string
): Promise<string> {
  const sessionRoot = await resolveCanonicalSessionRoot(workspaceRoot, sessionsRoot, sessionId)
  if (!sessionRoot) throw new LearningSessionLedgerError('not_found', `Learning Session "${sessionId}" was not found.`)
  return sessionRoot
}

async function ensureContainedDirectory(
  rootPath: string,
  targetPath: string,
  settlement: LearningSessionDurabilitySettlement
): Promise<void> {
  if (!isPathInsideRoot(rootPath, targetPath)) {
    throw new LearningSessionLedgerError('unsafe_storage', 'Session path escapes the Teaching workspace.')
  }
  const relation = relative(rootPath, targetPath)
  let current = rootPath
  for (const part of relation.split(sep).filter(Boolean)) {
    const parent = current
    current = join(current, part)
    let info = await lstat(current).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (!info) {
      try {
        await mkdir(current)
        await syncDirectory(parent, settlement)
      } catch (error) {
        if (!isErrnoException(error, 'EEXIST')) throw error
      }
      info = await lstat(current)
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new LearningSessionLedgerError(
        'unsafe_storage',
        `Session directory path is unsafe: ${relativePath(rootPath, current)}`
      )
    }
  }
  await assertRealContained(rootPath, targetPath)
}

type DirectoryIdentity = {
  dev: number
  ino: number
  realPath: string
}

async function captureDirectoryIdentity(
  rootPath: string,
  targetPath: string,
  sessionId?: string
): Promise<DirectoryIdentity> {
  if (!isPathInsideRoot(rootPath, targetPath)) {
    if (sessionId) {
      throw corruptSession(
        sessionId,
        relativePath(rootPath, targetPath),
        'Session directory escapes the Teaching workspace.',
        'unsafe_session_storage'
      )
    }
    throw new LearningSessionLedgerError('unsafe_storage', 'Session directory escapes the Teaching workspace.')
  }
  const info = await lstat(targetPath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!info || info.isSymbolicLink() || !info.isDirectory()) {
    if (sessionId) {
      throw corruptSession(
        sessionId,
        relativePath(rootPath, targetPath),
        'Session directory must be a regular directory.',
        'unsafe_session_storage'
      )
    }
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session directory must be a regular directory.')
  }
  const realTarget = await realpath(targetPath)
  const realRoot = await realpath(rootPath)
  if (!isPathInsideRoot(realRoot, realTarget)) {
    if (sessionId) {
      throw corruptSession(
        sessionId,
        relativePath(rootPath, targetPath),
        'Session path escapes the Teaching workspace through a symbolic link.',
        'unsafe_session_storage'
      )
    }
    throw new LearningSessionLedgerError('unsafe_storage', 'Session path escapes the Teaching workspace through a symbolic link.')
  }
  return { dev: info.dev, ino: info.ino, realPath: realTarget }
}

function sameDirectoryIdentity(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.realPath === right.realPath
}

async function assertDirectoryIdentity(
  rootPath: string,
  targetPath: string,
  expected: DirectoryIdentity,
  sessionId?: string
): Promise<void> {
  const current = await captureDirectoryIdentity(rootPath, targetPath, sessionId)
  if (!sameDirectoryIdentity(expected, current)) {
    if (sessionId) {
      throw corruptSession(
        sessionId,
        relativePath(rootPath, targetPath),
        'Session directory identity changed during filesystem settlement.',
        'unsafe_session_storage'
      )
    }
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session directory identity changed during filesystem settlement.')
  }
}

async function assertSafeExistingDirectory(rootPath: string, targetPath: string, sessionId: string): Promise<void> {
  await captureDirectoryIdentity(rootPath, targetPath, sessionId)
}

async function assertRealContained(rootPath: string, targetPath: string, sessionId?: string): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(rootPath), realpath(targetPath)])
  if (!isPathInsideRoot(realRoot, realTarget)) {
    if (sessionId) {
      throw corruptSession(
        sessionId,
        relativePath(rootPath, targetPath),
        'Session path escapes the Teaching workspace through a symbolic link.',
        'unsafe_session_storage'
      )
    }
    throw new LearningSessionLedgerError('unsafe_storage', 'Session path escapes the Teaching workspace through a symbolic link.')
  }
}

type StableFileFailure = (message: string) => never

async function readStableRegularFile(
  workspaceRoot: string,
  path: string,
  maxBytes: number,
  sessionId: string,
  diagnosticCode: LearningSessionDiagnostic['code'],
  options: LearningSessionLedgerOptions,
  operation: LearningSessionWriterOperation
): Promise<Buffer> {
  return readStableRegularFileRaw(
    workspaceRoot,
    path,
    maxBytes,
    options,
    operation,
    sessionId,
    (message) => {
      throw corruptSession(sessionId, relativePath(workspaceRoot, path), message, diagnosticCode)
    }
  )
}

async function readStableRegularFileRaw(
  workspaceRoot: string,
  path: string,
  maxBytes: number,
  options: LearningSessionLedgerOptions,
  operation: LearningSessionWriterOperation,
  sessionId: string,
  fail: StableFileFailure
): Promise<Buffer> {
  if (!isPathInsideRoot(workspaceRoot, path)) fail('Session file escapes the Teaching workspace.')
  await captureDirectoryIdentity(workspaceRoot, dirname(path), sessionId)
  const beforePath = await lstat(path).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!beforePath || beforePath.isSymbolicLink() || !beforePath.isFile()) {
    fail('Session file must exist as a regular file.')
  }
  if (beforePath!.size > maxBytes) fail('Session file exceeds the size limit.')
  await assertRealContained(workspaceRoot, path, sessionId)

  const handle = await open(path, 'r').catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) fail('Session file disappeared before it could be read.')
    throw error
  })
  try {
    const beforeHandle = await handle.stat()
    if (!beforeHandle.isFile()) fail('Session file must be a regular file.')
    if (!sameFileIdentity(beforePath!, beforeHandle)) fail('Session file identity changed before it could be read.')
    if (beforeHandle.size > maxBytes) fail('Session file exceeds the size limit.')
    await injectFault(options, 'after_file_stat', {
      operation,
      sessionId,
      path: relativePath(workspaceRoot, path)
    })
    const content = await readFileHandleBounded(handle, maxBytes)
    const afterHandle = await handle.stat()
    const afterPath = await lstat(path).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (!afterPath || afterPath.isSymbolicLink() || !afterPath.isFile()) {
      fail('Session file identity changed while it was being read.')
    }
    if (
      !sameFileIdentity(beforeHandle, afterHandle) ||
      !sameFileIdentity(afterHandle, afterPath!) ||
      beforeHandle.size !== afterHandle.size ||
      beforeHandle.mtimeMs !== afterHandle.mtimeMs
    ) {
      fail('Session file changed while it was being read.')
    }
    if (content.byteLength > maxBytes || afterHandle.size > maxBytes) fail('Session file exceeds the size limit.')
    await assertRealContained(workspaceRoot, path, sessionId)
    return content
  } finally {
    await handle.close()
  }
}

async function readFileHandleBounded(
  handle: Awaited<ReturnType<typeof open>>,
  maxBytes: number
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(maxBytes + 1)
  let offset = 0
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino
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

async function createStagedFile(
  workspaceRoot: string,
  parentPath: string,
  prefix: '.event-stage-' | '.manifest-stage-',
  content: string,
  options: LearningSessionLedgerOptions,
  context: LearningSessionLedgerFaultContext
): Promise<{ stagePath: string; parentIdentity: DirectoryIdentity }> {
  const parentIdentity = await captureDirectoryIdentity(workspaceRoot, parentPath, context.sessionId ?? undefined)
  const stagePath = join(parentPath, `${prefix}${randomUUID()}`)
  await durableWriteNewFile(stagePath, content)
  await injectFault(options, 'after_stage_sync', {
    ...context,
    path: relativePath(workspaceRoot, stagePath)
  })
  await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, context.sessionId ?? undefined)
  return { stagePath, parentIdentity }
}

async function removeStagedFileIfSafe(
  workspaceRoot: string,
  stagePath: string,
  parentIdentity: DirectoryIdentity,
  sessionId: string | null
): Promise<void> {
  try {
    await assertDirectoryIdentity(workspaceRoot, dirname(stagePath), parentIdentity, sessionId ?? undefined)
    const info = await lstat(stagePath).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (info && !info.isSymbolicLink() && info.isFile()) await rm(stagePath, { force: true })
  } catch {
    // Preserve uncertain stage bytes for a later bounded scan; never follow a swapped parent.
  }
}

async function durablePublishImmutableFile(
  workspaceRoot: string,
  path: string,
  content: string,
  options: LearningSessionLedgerOptions,
  settlement: LearningSessionDurabilitySettlement,
  context: LearningSessionLedgerFaultContext
): Promise<'published' | 'existing'> {
  const parentPath = dirname(path)
  const { stagePath, parentIdentity } = await createStagedFile(
    workspaceRoot,
    parentPath,
    '.event-stage-',
    content,
    options,
    context
  )
  let stagePublished = false
  try {
    await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, context.sessionId ?? undefined)
    const existing = await lstat(path).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (existing) {
      if (existing.isSymbolicLink() || !existing.isFile()) {
        throw new LearningSessionLedgerError('unsafe_storage', 'Immutable Session target is not a regular file.')
      }
      return 'existing'
    }
    try {
      await link(stagePath, path)
    } catch (error) {
      if (isErrnoException(error, 'EEXIST')) return 'existing'
      if (!(error instanceof Error) || !('code' in error) || !HARDLINK_FALLBACK_CODES.has(String(error.code))) throw error
      await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, context.sessionId ?? undefined)
      const raced = await lstat(path).catch((candidate: unknown) => {
        if (isErrnoException(candidate, 'ENOENT')) return null
        throw candidate
      })
      if (raced) return 'existing'
      await rename(stagePath, path)
      stagePublished = true
    }
    await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, context.sessionId ?? undefined)
    await assertRealContained(workspaceRoot, path, context.sessionId ?? undefined)
    await syncDirectory(parentPath, settlement)
    return 'published'
  } finally {
    if (!stagePublished) await removeStagedFileIfSafe(workspaceRoot, stagePath, parentIdentity, context.sessionId)
  }
}

async function durableAtomicReplaceFile(
  workspaceRoot: string,
  path: string,
  content: string,
  options: LearningSessionLedgerOptions,
  settlement: LearningSessionDurabilitySettlement,
  context: LearningSessionLedgerFaultContext
): Promise<void> {
  const parentPath = dirname(path)
  const { stagePath, parentIdentity } = await createStagedFile(
    workspaceRoot,
    parentPath,
    '.manifest-stage-',
    content,
    options,
    context
  )
  let stagePublished = false
  try {
    await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, context.sessionId ?? undefined)
    await rename(stagePath, path)
    stagePublished = true
    await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, context.sessionId ?? undefined)
    await assertRealContained(workspaceRoot, path, context.sessionId ?? undefined)
    await syncDirectory(parentPath, settlement)
  } finally {
    if (!stagePublished) await removeStagedFileIfSafe(workspaceRoot, stagePath, parentIdentity, context.sessionId)
  }
}

async function publishNewSessionDirectory(
  workspaceRoot: string,
  sessionsRoot: string,
  sessionRoot: string,
  manifest: CanonicalLearningSessionManifest,
  options: LearningSessionLedgerOptions,
  settlement: LearningSessionDurabilitySettlement,
  sessionId: string
): Promise<void> {
  const sessionsIdentity = await captureDirectoryIdentity(workspaceRoot, sessionsRoot)
  const stagingRoot = join(sessionsRoot, `.session-stage-${sessionId}-${randomUUID()}`)
  let published = false
  await mkdir(stagingRoot)
  await syncDirectory(sessionsRoot, settlement)
  try {
    await mkdir(join(stagingRoot, SESSION_EVENTS_DIRECTORY))
    await syncDirectory(stagingRoot, settlement)
    await durableWriteNewFile(join(stagingRoot, SESSION_MANIFEST_FILE), serializeManifest(manifest))
    await syncDirectory(stagingRoot, settlement)
    await injectFault(options, 'after_stage_sync', {
      operation: 'open',
      sessionId,
      path: relativePath(workspaceRoot, stagingRoot)
    })
    await assertDirectoryIdentity(workspaceRoot, sessionsRoot, sessionsIdentity)
    const existing = await lstat(sessionRoot).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (existing) throw new LearningSessionLedgerError('identity_conflict', `Session "${sessionId}" already exists.`)
    await rename(stagingRoot, sessionRoot)
    published = true
    await assertDirectoryIdentity(workspaceRoot, sessionsRoot, sessionsIdentity)
    await assertSafeExistingDirectory(workspaceRoot, sessionRoot, sessionId)
    await syncDirectory(sessionsRoot, settlement)
  } finally {
    if (!published) await removeSessionStageIfSafe(workspaceRoot, sessionsRoot, stagingRoot, sessionsIdentity)
  }
}

async function removeSessionStageIfSafe(
  workspaceRoot: string,
  sessionsRoot: string,
  stagePath: string,
  sessionsIdentity: DirectoryIdentity
): Promise<void> {
  try {
    await assertDirectoryIdentity(workspaceRoot, sessionsRoot, sessionsIdentity)
    const info = await lstat(stagePath).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (!info || info.isSymbolicLink() || !info.isDirectory()) return
    const stageIdentity = await captureDirectoryIdentity(workspaceRoot, stagePath)
    if (await isBoundedSafeStageTree(stagePath)) {
      await assertDirectoryIdentity(workspaceRoot, sessionsRoot, sessionsIdentity)
      await assertDirectoryIdentity(workspaceRoot, stagePath, stageIdentity)
      await rm(stagePath, { recursive: true, force: true })
    }
  } catch {
    // Preserve uncertain stage bytes for scan diagnostics.
  }
}

async function syncDirectory(
  path: string,
  settlement: LearningSessionDurabilitySettlement
): Promise<void> {
  if (settlement.directorySync === 'unsupported') return
  const handle = await open(path, 'r').catch((error: unknown) => {
    if (isDirectorySyncUnsupported(error)) {
      settlement.directorySync = 'unsupported'
      return null
    }
    throw error
  })
  if (!handle) return
  try {
    await handle.sync().catch((error: unknown) => {
      if (isDirectorySyncUnsupported(error)) {
        settlement.directorySync = 'unsupported'
        return
      }
      throw error
    })
  } finally {
    await handle.close()
  }
}

function isDirectorySyncUnsupported(error: unknown): boolean {
  return isErrnoException(error, 'EISDIR') ||
    isErrnoException(error, 'EPERM') ||
    isErrnoException(error, 'EINVAL') ||
    isErrnoException(error, 'ENOTSUP') ||
    isErrnoException(error, 'EACCES')
}

async function withFilesystemWriterLock<T>(
  workspaceRoot: string,
  operation: LearningSessionWriterOperation,
  sessionId: string | null,
  options: LearningSessionLedgerOptions,
  settlement: LearningSessionDurabilitySettlement,
  execute: () => Promise<T>
): Promise<T> {
  const queueKey = workspaceRoot.toLocaleLowerCase('en-US')
  return withWorkspaceWriteQueue(queueKey, async () => {
    const owner: LearningSessionWriterOwner = {
      schemaVersion: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname().toLocaleLowerCase('en-US'),
      operation,
      sessionId,
      acquiredAt: new Date().toISOString()
    }
    const lockPath = await acquireFilesystemWriterLock(
      workspaceRoot,
      workspaceRoot,
      owner,
      options,
      options.writerLockWaitMs ?? DEFAULT_WRITER_LOCK_WAIT_MS,
      options.writerLockStaleMs ?? DEFAULT_WRITER_LOCK_STALE_MS,
      settlement
    )
    try {
      await injectFault(options, 'after_writer_lock_acquired', { operation, sessionId })
      return await execute()
    } finally {
      await releaseFilesystemWriterLock(workspaceRoot, workspaceRoot, lockPath, owner, settlement)
    }
  })
}

async function withWorkspaceWriteQueue<T>(key: string, execute: () => Promise<T>): Promise<T> {
  const previous = workspaceWriteTails.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const tail = previous.then(() => gate)
  workspaceWriteTails.set(key, tail)
  await previous
  try {
    return await execute()
  } finally {
    release()
    if (workspaceWriteTails.get(key) === tail) workspaceWriteTails.delete(key)
  }
}

async function acquireFilesystemWriterLock(
  workspaceRoot: string,
  sessionsRoot: string,
  owner: LearningSessionWriterOwner,
  options: LearningSessionLedgerOptions,
  waitMs: number,
  staleMs: number,
  settlement: LearningSessionDurabilitySettlement
): Promise<string> {
  if (!Number.isFinite(waitMs) || waitMs < 0 || !Number.isFinite(staleMs) || staleMs < 0) {
    throw invalidInput('Writer lock timing options must be non-negative finite numbers.')
  }
  const lockPath = join(sessionsRoot, WRITER_LOCK_DIRECTORY)
  const deadline = Date.now() + waitMs
  let observedOwner: LearningSessionWriterOwner | null = null
  while (true) {
    const sessionsIdentity = await captureDirectoryIdentity(workspaceRoot, sessionsRoot)
    let created = false
    try {
      await mkdir(lockPath)
      created = true
    } catch (error) {
      if (!isErrnoException(error, 'EEXIST') && !isWriterLockLifecycleError(error)) throw error
      if (isWriterLockLifecycleError(error)) {
        await assertDirectoryIdentity(workspaceRoot, sessionsRoot, sessionsIdentity)
      }
    }

    if (created) {
      try {
        await assertDirectoryIdentity(workspaceRoot, sessionsRoot, sessionsIdentity)
        await syncDirectory(sessionsRoot, settlement)
        await durableWriteNewFile(join(lockPath, WRITER_LOCK_OWNER_FILE), serializeJson(owner))
        await syncDirectory(lockPath, settlement)
        await syncDirectory(sessionsRoot, settlement)
        return lockPath
      } catch (error) {
        await removeWriterLockDirectoryIfSafe(workspaceRoot, sessionsRoot, lockPath, null, settlement).catch(() => undefined)
        throw error
      }
    }

    let observed: InspectedWriterLock
    try {
      observed = await inspectWriterLock(workspaceRoot, sessionsRoot, lockPath, options, owner.operation, owner.sessionId)
    } catch (error) {
      if (!isWriterLockObservationUnstable(error)) throw error
      await waitForWriterLockRetry(deadline, observedOwner)
      continue
    }
    observedOwner = observed.owner
    if (await isConservativelyStaleWriter(observed, staleMs)) {
      const recoveredPath = join(sessionsRoot, `${RECOVERED_WRITER_LOCK_PREFIX}${Date.now()}-${randomUUID()}`)
      try {
        await rename(lockPath, recoveredPath)
        await syncDirectory(sessionsRoot, settlement)
        continue
      } catch (error) {
        if (
          isWriterLockLifecycleError(error) ||
          isErrnoException(error, 'EEXIST') ||
          isErrnoException(error, 'ENOTEMPTY')
        ) {
          await waitForWriterLockRetry(deadline, observedOwner)
          continue
        }
        throw error
      }
    }
    await waitForWriterLockRetry(deadline, observedOwner)
  }
}

type WriterLockEntryIdentity = {
  dev: number
  ino: number
  kind: 'directory' | 'symlink' | 'other'
}

type InspectedWriterLock = {
  owner: LearningSessionWriterOwner | null
  modifiedAtMs: number
  entryIdentity: WriterLockEntryIdentity
}

class WriterLockObservationUnstableError extends Error {
  constructor(readonly observationError?: unknown) {
    super('Learning Session writer lock observation was unstable.')
    this.name = 'WriterLockObservationUnstableError'
  }
}

async function inspectWriterLock(
  workspaceRoot: string,
  sessionsRoot: string,
  lockPath: string,
  options?: LearningSessionLedgerOptions,
  operation: LearningSessionWriterOperation = 'repair',
  sessionId: string | null = null
): Promise<InspectedWriterLock> {
  await assertSafeWriterRoot(workspaceRoot, sessionsRoot)
  const info = await lstatWriterLockEntry(lockPath)
  const entryIdentity = writerLockEntryIdentity(info)
  if (entryIdentity.kind !== 'directory') {
    await assertStableWriterLockEntry(lockPath, entryIdentity)
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session writer lock path is unsafe.')
  }

  const realWorkspaceRoot = await realpath(workspaceRoot)
  let realLockPath: string
  try {
    if (options) {
      await injectFault(options, 'after_writer_lock_lstat', {
        operation,
        sessionId,
        path: relativePath(workspaceRoot, lockPath)
      })
    }
    realLockPath = await realpath(lockPath)
  } catch (error) {
    return await throwWriterLockObservationFailure(lockPath, entryIdentity, error)
  }

  await assertStableWriterLockEntry(lockPath, entryIdentity)
  if (!isPathInsideRoot(realWorkspaceRoot, realLockPath)) {
    throw new LearningSessionLedgerError(
      'unsafe_storage',
      'Learning Session writer lock escapes the Teaching workspace through a symbolic link.'
    )
  }

  const ownerPath = join(lockPath, WRITER_LOCK_OWNER_FILE)
  let ownerInfo: Stats | null
  try {
    ownerInfo = await lstat(ownerPath)
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) ownerInfo = null
    else return await throwWriterLockObservationFailure(lockPath, entryIdentity, error)
  }
  if (!ownerInfo) {
    await assertStableWriterLockEntry(lockPath, entryIdentity)
    return { owner: null, modifiedAtMs: info.mtimeMs, entryIdentity }
  }
  const modifiedAtMs = Math.max(info.mtimeMs, ownerInfo.mtimeMs)
  if (ownerInfo.isSymbolicLink() || !ownerInfo.isFile() || ownerInfo.size > 16 * 1024) {
    await assertStableWriterLockEntry(lockPath, entryIdentity)
    return { owner: null, modifiedAtMs, entryIdentity }
  }

  let ownerText: string
  try {
    ownerText = await readFile(ownerPath, 'utf8')
  } catch (error) {
    if (isWriterLockLifecycleError(error)) {
      return await throwWriterLockObservationFailure(lockPath, entryIdentity, error)
    }
    await assertStableWriterLockEntry(lockPath, entryIdentity)
    return { owner: null, modifiedAtMs, entryIdentity }
  }
  let owner: LearningSessionWriterOwner | null = null
  try {
    owner = parseWriterOwner(JSON.parse(ownerText))
  } catch {
    owner = null
  }
  await assertStableWriterLockEntry(lockPath, entryIdentity)
  return { owner, modifiedAtMs, entryIdentity }
}

async function lstatWriterLockEntry(lockPath: string): Promise<Stats> {
  try {
    return await lstat(lockPath)
  } catch (error) {
    if (isWriterLockLifecycleError(error)) throw new WriterLockObservationUnstableError(error)
    throw error
  }
}

async function assertStableWriterLockEntry(
  lockPath: string,
  expected: WriterLockEntryIdentity
): Promise<Stats> {
  const current = await lstatWriterLockEntry(lockPath)
  if (!sameWriterLockEntryIdentity(expected, writerLockEntryIdentity(current))) {
    throw new WriterLockObservationUnstableError()
  }
  return current
}

async function throwWriterLockObservationFailure(
  lockPath: string,
  expected: WriterLockEntryIdentity,
  error: unknown
): Promise<never> {
  await assertStableWriterLockEntry(lockPath, expected)
  if (isWriterLockLifecycleError(error)) throw new WriterLockObservationUnstableError(error)
  throw error
}

function writerLockEntryIdentity(info: Stats): WriterLockEntryIdentity {
  return {
    dev: info.dev,
    ino: info.ino,
    kind: info.isSymbolicLink() ? 'symlink' : info.isDirectory() ? 'directory' : 'other'
  }
}

function sameWriterLockEntryIdentity(left: WriterLockEntryIdentity, right: WriterLockEntryIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.kind === right.kind
}

function isWriterLockLifecycleError(error: unknown): boolean {
  return isErrnoException(error, 'ENOENT') || isErrnoException(error, 'EPERM') || isErrnoException(error, 'EBADF')
}

function isWriterLockObservationUnstable(error: unknown): error is WriterLockObservationUnstableError {
  return error instanceof WriterLockObservationUnstableError
}

async function waitForWriterLockRetry(
  deadline: number,
  observedOwner: LearningSessionWriterOwner | null
): Promise<void> {
  if (Date.now() >= deadline) {
    throw new LearningSessionLedgerError(
      'writer_busy',
      `Learning Session filesystem writer is busy${observedOwner ? ` (${observedOwner.operation}).` : '.'}`,
      undefined,
      observedOwner
    )
  }
  await sleep(Math.min(WRITER_LOCK_POLL_MS, Math.max(1, deadline - Date.now())))
}

function parseWriterOwner(value: unknown): LearningSessionWriterOwner | null {
  if (!isRecord(value)) return null
  const operations = new Set<LearningSessionWriterOperation>(['open', 'append', 'complete', 'load', 'scan', 'repair'])
  if (
    value.schemaVersion !== 1 ||
    typeof value.token !== 'string' || !value.token ||
    !Number.isInteger(value.pid) || Number(value.pid) <= 0 ||
    typeof value.hostname !== 'string' || !value.hostname ||
    typeof value.operation !== 'string' || !operations.has(value.operation as LearningSessionWriterOperation) ||
    !(value.sessionId === null || typeof value.sessionId === 'string') ||
    typeof value.acquiredAt !== 'string' || !Number.isFinite(new Date(value.acquiredAt).getTime())
  ) return null
  let sessionId: string | null = null
  try {
    sessionId = value.sessionId === null ? null : requireSessionId(value.sessionId, 'Writer Session ID')
  } catch {
    return null
  }
  return {
    schemaVersion: 1,
    token: value.token,
    pid: Number(value.pid),
    hostname: value.hostname.toLocaleLowerCase('en-US'),
    operation: value.operation as LearningSessionWriterOperation,
    sessionId,
    acquiredAt: new Date(value.acquiredAt).toISOString()
  }
}

async function isConservativelyStaleWriter(observed: InspectedWriterLock, staleMs: number): Promise<boolean> {
  if (!observed.owner) {
    return Date.now() - observed.modifiedAtMs >= Math.max(staleMs, WRITER_OWNER_INITIALIZATION_GRACE_MS)
  }
  if (observed.owner.hostname !== hostname().toLocaleLowerCase('en-US')) return false
  const acquiredAt = new Date(observed.owner.acquiredAt).getTime()
  if (Date.now() - acquiredAt < staleMs) return false
  return !isProcessAlive(observed.owner.pid)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isErrnoException(error, 'EPERM')
  }
}

async function releaseFilesystemWriterLock(
  workspaceRoot: string,
  sessionsRoot: string,
  lockPath: string,
  owner: LearningSessionWriterOwner,
  settlement: LearningSessionDurabilitySettlement
): Promise<void> {
  await removeWriterLockDirectoryIfSafe(workspaceRoot, sessionsRoot, lockPath, owner.token, settlement)
}

async function removeWriterLockDirectoryIfSafe(
  workspaceRoot: string,
  sessionsRoot: string,
  lockPath: string,
  expectedToken: string | null,
  settlement: LearningSessionDurabilitySettlement
): Promise<void> {
  await assertSafeWriterRoot(workspaceRoot, sessionsRoot)
  const info = await lstat(lockPath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!info) return
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session writer lock changed identity before release.')
  }
  const inspected = await inspectWriterLock(workspaceRoot, sessionsRoot, lockPath)
  if (expectedToken !== null && (!inspected.owner || inspected.owner.token !== expectedToken)) {
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session writer lock ownership changed before release.')
  }
  const entries = await readdir(lockPath, { withFileTypes: true })
  if (entries.some((entry) => entry.name !== WRITER_LOCK_OWNER_FILE || entry.isSymbolicLink() || !entry.isFile())) {
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session writer lock contains unexpected entries.')
  }
  if (entries.length === 1) await unlink(join(lockPath, WRITER_LOCK_OWNER_FILE))
  await rmdir(lockPath)
  await syncDirectory(sessionsRoot, settlement)
}

async function assertSafeWriterRoot(workspaceRoot: string, sessionsRoot: string): Promise<void> {
  if (!isPathInsideRoot(workspaceRoot, sessionsRoot)) {
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session writer root escapes the Teaching workspace.')
  }
  const info = await lstat(sessionsRoot)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new LearningSessionLedgerError('unsafe_storage', 'Learning Session writer root must be a regular directory.')
  }
  await assertRealContained(workspaceRoot, sessionsRoot)
}

async function inspectSessionStage(
  workspaceRoot: string,
  sessionsRoot: string,
  name: string,
  stages: LearningSessionStageInfo[],
  diagnostics: LearningSessionDiagnostic[],
  settlement: LearningSessionDurabilitySettlement
): Promise<void> {
  const stagePath = join(sessionsRoot, name)
  const sessionId = sessionIdFromStageName(name)
  const info = await lstat(stagePath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!info) return
  const relativeStagePath = relativePath(workspaceRoot, stagePath)
  if (info.isSymbolicLink() || !info.isDirectory()) {
    stages.push({ relativePath: relativeStagePath, kind: 'session', state: 'unsafe', modifiedAt: info.mtime.toISOString() })
    diagnostics.push({
      code: 'unsafe_session_stage',
      sessionId,
      relativePath: relativeStagePath,
      message: 'Learning Session staging directory is unsafe and was preserved.'
    })
    return
  }
  const stageIdentity = await captureDirectoryIdentity(workspaceRoot, stagePath)
  if (!(await isBoundedSafeStageTree(stagePath))) {
    stages.push({ relativePath: relativeStagePath, kind: 'session', state: 'unsafe', modifiedAt: info.mtime.toISOString() })
    diagnostics.push({
      code: 'unsafe_session_stage',
      sessionId,
      relativePath: relativeStagePath,
      message: 'Learning Session staging directory is unsafe and was preserved.'
    })
    return
  }
  if (Date.now() - info.mtimeMs < STALE_STAGE_MS) {
    stages.push({ relativePath: relativeStagePath, kind: 'session', state: 'pending', modifiedAt: info.mtime.toISOString() })
    return
  }
  const parentIdentity = await captureDirectoryIdentity(workspaceRoot, sessionsRoot)
  await assertDirectoryIdentity(workspaceRoot, stagePath, stageIdentity)
  await rm(stagePath, { recursive: true, force: true })
  await assertDirectoryIdentity(workspaceRoot, sessionsRoot, parentIdentity)
  await syncDirectory(sessionsRoot, settlement)
  stages.push({ relativePath: relativeStagePath, kind: 'session', state: 'cleaned', modifiedAt: info.mtime.toISOString() })
  diagnostics.push({
    code: 'stale_session_stage',
    sessionId,
    relativePath: relativeStagePath,
    message: 'A stale bounded Session staging directory was cleaned.'
  })
}

async function inspectCanonicalStages(
  workspaceRoot: string,
  sessionId: string,
  sessionRoot: string,
  stages: LearningSessionStageInfo[],
  diagnostics: LearningSessionDiagnostic[],
  settlement: LearningSessionDurabilitySettlement
): Promise<void> {
  try {
    await assertSafeExistingDirectory(workspaceRoot, sessionRoot, sessionId)
    const entries = await readdir(sessionRoot, { withFileTypes: true })
    for (const entry of entries.filter((candidate) => candidate.name.startsWith('.manifest-stage-')).slice(0, MAX_STAGE_TREE_ENTRIES)) {
      await inspectFileStage(
        workspaceRoot,
        sessionId,
        sessionRoot,
        entry.name,
        'manifest',
        stages,
        diagnostics,
        settlement
      )
    }
    const eventsRoot = join(sessionRoot, SESSION_EVENTS_DIRECTORY)
    const eventsInfo = await lstat(eventsRoot).catch((error: unknown) => {
      if (isErrnoException(error, 'ENOENT')) return null
      throw error
    })
    if (!eventsInfo || eventsInfo.isSymbolicLink() || !eventsInfo.isDirectory()) return
    const eventEntries = await readdir(eventsRoot, { withFileTypes: true })
    for (const entry of eventEntries.filter((candidate) => candidate.name.startsWith('.event-stage-')).slice(0, MAX_STAGE_TREE_ENTRIES)) {
      await inspectFileStage(
        workspaceRoot,
        sessionId,
        eventsRoot,
        entry.name,
        'event',
        stages,
        diagnostics,
        settlement
      )
    }
  } catch (error) {
    if (error instanceof LearningSessionLedgerError && error.diagnostic) {
      diagnostics.push(error.diagnostic)
      return
    }
    throw error
  }
}

async function inspectFileStage(
  workspaceRoot: string,
  sessionId: string,
  parentPath: string,
  name: string,
  kind: 'event' | 'manifest',
  stages: LearningSessionStageInfo[],
  diagnostics: LearningSessionDiagnostic[],
  settlement: LearningSessionDurabilitySettlement
): Promise<void> {
  const stagePath = join(parentPath, name)
  const info = await lstat(stagePath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!info) return
  const relativeStagePath = relativePath(workspaceRoot, stagePath)
  if (info.isSymbolicLink() || !info.isFile()) {
    stages.push({ relativePath: relativeStagePath, kind, state: 'unsafe', modifiedAt: info.mtime.toISOString() })
    diagnostics.push({
      code: 'unsafe_session_stage',
      sessionId,
      relativePath: relativeStagePath,
      message: 'Learning Session staging file is unsafe and was preserved.'
    })
    return
  }
  if (Date.now() - info.mtimeMs < STALE_STAGE_MS) {
    stages.push({ relativePath: relativeStagePath, kind, state: 'pending', modifiedAt: info.mtime.toISOString() })
    return
  }
  const parentIdentity = await captureDirectoryIdentity(workspaceRoot, parentPath, sessionId)
  await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, sessionId)
  const currentInfo = await lstat(stagePath).catch((error: unknown) => {
    if (isErrnoException(error, 'ENOENT')) return null
    throw error
  })
  if (!currentInfo || currentInfo.isSymbolicLink() || !currentInfo.isFile() || !sameFileIdentity(info, currentInfo)) {
    stages.push({ relativePath: relativeStagePath, kind, state: 'unsafe', modifiedAt: info.mtime.toISOString() })
    diagnostics.push({
      code: 'unsafe_session_stage',
      sessionId,
      relativePath: relativeStagePath,
      message: 'Learning Session staging file changed identity and was preserved.'
    })
    return
  }
  await unlink(stagePath)
  await assertDirectoryIdentity(workspaceRoot, parentPath, parentIdentity, sessionId)
  await syncDirectory(parentPath, settlement)
  stages.push({ relativePath: relativeStagePath, kind, state: 'cleaned', modifiedAt: info.mtime.toISOString() })
  diagnostics.push({
    code: 'stale_session_stage',
    sessionId,
    relativePath: relativeStagePath,
    message: 'A stale Session staging file was cleaned.'
  })
}

async function isBoundedSafeStageTree(rootPath: string): Promise<boolean> {
  let entriesSeen = 0
  const visit = async (path: string, depth: number): Promise<boolean> => {
    if (depth > MAX_STAGE_TREE_DEPTH) return false
    const info = await lstat(path)
    if (info.isSymbolicLink()) return false
    entriesSeen += 1
    if (entriesSeen > MAX_STAGE_TREE_ENTRIES) return false
    if (info.isFile()) return true
    if (!info.isDirectory()) return false

    const directory = await opendir(path)
    try {
      while (true) {
        const entry = await directory.read()
        if (!entry) break
        if (entry.isSymbolicLink()) return false
        if (!(await visit(join(path, entry.name), depth + 1))) return false
      }
      return true
    } finally {
      await directory.close()
    }
  }
  return visit(rootPath, 0)
}

function sessionIdFromStageName(name: string): string {
  const match = /^\.session-stage-(.+)-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(name)
  if (!match?.[1]) return 'unknown-stage'
  try {
    return requireSessionId(match[1], 'Staged Session ID')
  } catch {
    return 'unknown-stage'
  }
}

async function inspectRecoveredWriterLocks(
  workspaceRoot: string,
  _options: LearningSessionLedgerOptions
): Promise<LearningSessionRecoveryInfo[]> {
  const entries = (await readdir(workspaceRoot, { withFileTypes: true }))
    .filter((entry) => entry.name.startsWith(RECOVERED_WRITER_LOCK_PREFIX))
    .sort((left, right) => right.name.localeCompare(left.name))
    .slice(0, MAX_RECOVERED_WRITER_LOCKS)
  const recoveries: LearningSessionRecoveryInfo[] = []
  for (const entry of entries) {
    const lockPath = join(workspaceRoot, entry.name)
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue
    const inspected = await inspectWriterLock(workspaceRoot, workspaceRoot, lockPath).catch(() => null)
    recoveries.push({
      relativePath: relativePath(workspaceRoot, lockPath),
      state: 'preserved',
      owner: inspected?.owner ? {
        operation: inspected.owner.operation,
        sessionId: inspected.owner.sessionId,
        pid: inspected.owner.pid,
        hostname: inspected.owner.hostname,
        acquiredAt: inspected.owner.acquiredAt
      } : null
    })
  }
  return recoveries
}

async function injectFault(
  options: LearningSessionLedgerOptions,
  point: LearningSessionLedgerFaultPoint,
  context: LearningSessionLedgerFaultContext
): Promise<void> {
  await options.testingFaults?.inject(point, context)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function sameEventInput(event: LearningSessionEvent, input: AppendLearningSessionEventInput): boolean {
  const { sequence: _sequence, recordedAt: _recordedAt, ...persistedInput } = event
  return stableJsonStringify(persistedInput) === stableJsonStringify(input)
}

function eventFilename(eventId: string): string {
  return `${sha256(eventId)}.json`
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
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
  try {
    return requireLearningSessionId(text)
  } catch (error) {
    throw invalidInput(error instanceof Error ? error.message : `${label} is not a safe stable identifier.`)
  }
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
  if (typeof value !== 'string' || !value.trim()) throw invalidInput(`${label} is required.`)
  try {
    return requireSafeTeachingRelativePath(value, label)
  } catch (error) {
    throw invalidInput(error instanceof Error ? error.message : `${label} must be a safe workspace-relative path.`)
  }
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
