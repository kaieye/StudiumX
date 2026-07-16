import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ipcMain } from 'electron'

import {
  createLearningOutcomeCommitter,
  type LearningOutcomeCommitterFaultPoint,
  type OutcomeReconciliation
} from '../../../src/main/learning-outcome-committer'
import { createLearningSessionLedger, type LearningSessionLedger } from '../../../src/main/learning-session-ledger'
import { createLessonInteractionRecorder } from '../../../src/main/lesson-interaction-recorder'
import { createNextTeachingStepPlanner } from '../../../src/main/next-teaching-step-planner'
import { createResourceGrounder } from '../../../src/main/resource-grounder'
import {
  createTeachingContextAssembler,
  type TeachingContextAssembly
} from '../../../src/main/teaching-context-assembler'
import { defaultSettings } from '../../../src/main/teaching-settings'
import {
  deriveLessonArtifactPublication,
  publishLessonArtifacts,
  type LessonArtifactPublication,
  type LessonArtifactPublicationFacts
} from '../../../src/main/teaching-lesson-artifacts'
import { TeachingWorkspaceService } from '../../../src/main/teaching-workspace'
import { registerTeachingIpcGateway, type TeachingIpcRegistration } from '../../../src/main/teaching-ipc-gateway'
import { teachingInvokeChannels } from '../../../src/shared/teaching-ipc-contract'
import type { TeachingSettingsV1 } from '../../../src/shared/teaching-types'
import type { LearningOutcomeCommitResult } from '../../../src/shared/teaching-types/learning-outcome'
import type { TrustedTeachingResourceDescriptor } from '../../../src/shared/teaching-types/grounding'
import type { NextTeachingStepDecision } from '../../../src/shared/teaching-types/next-teaching-step'
import type { TeachingTurnSnapshot } from '../../../src/renderer/src/teaching-turn-presentation'

export const GOLDEN_SESSION_ID = 'session-golden-001'
export const GOLDEN_SOURCE_IDS = ['source-golden-foundation', 'source-golden-practice'] as const
export const GOLDEN_NEEDS_PRACTICE_OPERATION_ID = 'operation-golden-needs-practice-001'
export const GOLDEN_CORRECTION_OPERATION_ID = 'operation-golden-correction-002'
export const CRASH_A_NEEDS_PRACTICE_OPERATION_ID = 'operation-crash-a-needs-practice'
export const CRASH_A_CORRECTION_OPERATION_ID = 'operation-crash-a-correction'
export const CRASH_B_NEEDS_PRACTICE_OPERATION_ID = 'operation-crash-b-needs-practice'
export const CRASH_B_CORRECTION_OPERATION_ID = 'operation-crash-b-correction'
const GOLDEN_AUTHORITY_ID = 'golden-offline-authority'
const FIXED_NOW = '2026-07-16T00:00:00.000Z'

type IpcMainTestDouble = {
  handlers: Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>
}

type GoldenFault = Extract<LearningOutcomeCommitterFaultPoint, 'after_stage_flush' | 'before_catalog_reconcile'>

type CanonicalFacts = {
  session: Record<string, unknown>
  outcome: Record<string, unknown> | null
  records: string[]
}

type PublishedNextLesson = {
  decision: NextTeachingStepDecision
  context: TeachingContextAssembly
  lessonPath: string
  lessonGroundingSourceId: string
}

export type GoldenTeachingLoopHarness = {
  root: string
  cleanup(): Promise<void>
  openPreviewThroughIpc(): Promise<{ sessionId: string }>
  submitWrongEvidenceThroughIpc(): Promise<{ eventId: string; duplicate: boolean }>
  submitCorrectedEvidenceThroughIpc(): Promise<{ eventId: string; duplicate: boolean }>
  commitThroughIpc(operationId: string): Promise<LearningOutcomeCommitResult>
  planFor(result: LearningOutcomeCommitResult): NextTeachingStepDecision
  publishGroundedNextLesson(result: LearningOutcomeCommitResult): Promise<PublishedNextLesson>
  readCanonical(): Promise<CanonicalFacts>
  restartWithoutFault(): Promise<GoldenTeachingLoopHarness>
  readRepair(sessionId: string): Promise<OutcomeReconciliation>
  presentationSnapshot(result: LearningOutcomeCommitResult, next: PublishedNextLesson): TeachingTurnSnapshot
  recoveredPresentationSnapshot(): TeachingTurnSnapshot
  incompletePresentationSnapshot(): TeachingTurnSnapshot
}

export async function createGoldenTeachingLoopHarness(
  options: { fault?: GoldenFault; root?: string } = {}
): Promise<GoldenTeachingLoopHarness> {
  const ownsRoot = options.root === undefined
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'studiumx-golden-teaching-loop-'))
  await writeOfflineFixture(root)

  const publication = await ensureInitialLessonPublication(root)

  let outcomeId = 1
  const ledger = createLearningSessionLedger({
    workspaceRoot: root,
    now: () => FIXED_NOW,
    createId: () => GOLDEN_SESSION_ID
  })

  const service = new TeachingWorkspaceService({
    registryPath: join(root, '.test-app-data', 'teaching-workspaces.json'),
    defaultRoot: join(root, '.managed'),
    settingsProvider: async () => defaultSettings(join(root, '.managed')),
    learningOutcomeLedgerFactory: () => ledger,
    learningOutcomeCommitterFactory: (workspaceRoot, serviceLedger) => createLearningOutcomeCommitter({
      workspaceRoot,
      ledger: serviceLedger as LearningSessionLedger,
      now: () => FIXED_NOW,
      createId: () => `outcome-golden-${String(outcomeId++).padStart(3, '0')}`,
      ...(options.fault
        ? {
            testingFaults: {
              inject(point, context) {
                // Crash windows only target the correction path. needs_practice also
                // reaches before_catalog_reconcile, so always-on injection would break setup.
                if (point === options.fault && /correction/i.test(context.operationId)) {
                  throw new Error(`golden test pause: ${point}`)
                }
              }
            }
          }
        : {})
    })
  })

  const state = await service.importWorkspace(root)
  const workspace = state.activeWorkspace
  if (!workspace) throw new Error('Golden fixture workspace did not activate.')

  const opened = await ledger.open({
    sessionId: GOLDEN_SESSION_ID,
    workspaceId: workspace.id,
    courseRef: {
      courseId: publication.lesson.courseId,
      courseName: publication.lesson.courseName,
      relativePath: publication.lesson.courseRelativePath
    },
    lessonRef: {
      lessonId: publication.lesson.id,
      title: publication.lesson.title,
      relativePath: publication.lesson.relativePath,
      assessment: publication.assessment
    }
  })

  registerGateway(service)
  const recorder = createLessonInteractionRecorder({ ledger })
  const committer = createLearningOutcomeCommitter({
    workspaceRoot: root,
    ledger,
    now: () => FIXED_NOW,
    createId: () => `outcome-repair-${String(outcomeId++).padStart(3, '0')}`
  })

  const invokeCommit = async (operationId: string): Promise<LearningOutcomeCommitResult> => {
    const handler = gatewayHandler(teachingInvokeChannels.commitLearningOutcome)
    return handler({ sender: { id: 700, isDestroyed: () => false } }, {
      schemaVersion: 1,
      type: 'commit',
      workspaceId: workspace.id,
      sessionId: GOLDEN_SESSION_ID,
      operationId
    }) as Promise<LearningOutcomeCommitResult>
  }

  const recordEvidence = async (input: {
    eventId: string
    attempt: number
    selectedOptionIds: string[]
  }) => {
    const receipt = await recorder.record({
      schemaVersion: 1,
      eventId: input.eventId,
      kind: 'quiz_answered',
      workspaceId: workspace.id,
      courseId: publication.lesson.courseId,
      sessionId: GOLDEN_SESSION_ID,
      lessonId: publication.lesson.id,
      itemId: 'quiz-1',
      attempt: input.attempt,
      observedAt: input.attempt === 1 ? '2026-07-16T00:00:01.000Z' : '2026-07-16T00:00:02.000Z',
      artifactDigest: publication.assessment.contentSha256,
      surface: 'lesson_preview',
      selectedOptionIds: input.selectedOptionIds,
      correct: false
    })
    return { eventId: receipt.eventId, duplicate: receipt.duplicate }
  }

  const planner = createNextTeachingStepPlanner()
  const groundingResources = await trustedResources(root)

  return {
    root,
    cleanup: async () => {
      if (ownsRoot) await rm(root, { recursive: true, force: true })
    },
    openPreviewThroughIpc: async () => {
      // Residual: full preview-binding IPC is heavier than R6 needs. The harness
      // still opens/loads the fixed canonical session through the real ledger seam.
      const session = await ledger.open({
        sessionId: GOLDEN_SESSION_ID,
        workspaceId: workspace.id,
        courseRef: {
          courseId: publication.lesson.courseId,
          courseName: publication.lesson.courseName,
          relativePath: publication.lesson.courseRelativePath
        },
        lessonRef: {
          lessonId: publication.lesson.id,
          title: publication.lesson.title,
          relativePath: publication.lesson.relativePath,
          assessment: publication.assessment
        }
      })
      if (session.id !== opened.id) throw new Error('Golden preview session identity drifted.')
      return { sessionId: session.id }
    },
    submitWrongEvidenceThroughIpc: async () => recordEvidence({
      eventId: 'evidence-golden-wrong-001',
      attempt: 1,
      selectedOptionIds: ['a']
    }),
    submitCorrectedEvidenceThroughIpc: async () => recordEvidence({
      eventId: 'evidence-golden-corrected-002',
      attempt: 2,
      selectedOptionIds: ['b']
    }),
    commitThroughIpc: invokeCommit,
    planFor: (result) => planForOutcome(planner, result, workspace.id, publication.lesson.courseId),
    publishGroundedNextLesson: async (result) => {
      const decision = planForOutcome(planner, result, workspace.id, publication.lesson.courseId)
      const context = await createTeachingContextAssembler(createResourceGrounder({
        workspaceRoot: root,
        trustedAuthorityId: GOLDEN_AUTHORITY_ID,
        maxBytes: 4096
      })).assemble({
        mission: { id: 'mission-golden-001', goalStatus: 'available' },
        course: { id: publication.lesson.courseId },
        currentSession: { id: GOLDEN_SESSION_ID, source: 'canonical', readOnly: false },
        outcome: trustedOutcome(result),
        nextStep: decision,
        resources: groundingResources
      }, 'lesson')
      const lessonGroundingSourceId = context.grounding.sources[0]?.sourceId
      if (!lessonGroundingSourceId) throw new Error('Golden fixture did not produce a trusted GroundingPack source.')
      const nextPublication = await publishLessonArtifacts({
        workspace: { name: 'Golden Teaching Workspace', rootPath: root },
        plan: {
          title: 'Grounded next lesson',
          objective: 'Continue from verified sources.',
          durationMinutes: 25,
          sections: [{ heading: 'Trusted grounding', body: `Continue with trusted source ${lessonGroundingSourceId}.` }],
          keyPoints: [`Grounding sourceId: ${lessonGroundingSourceId}`],
          quiz: [],
          flashcards: [],
          callouts: [],
          referenceNotes: `GroundingPack sourceId: ${lessonGroundingSourceId}`,
          learningRecordNote: ''
        },
        sequence: 2,
        title: 'Grounded next lesson',
        objective: 'Continue from verified sources.',
        prompt: `grounded:${lessonGroundingSourceId}`,
        createdAt: '2026-07-16T00:10:00.000Z',
        durationMinutes: 25,
        mission: { title: 'Golden Teaching Workspace', excerpt: 'Offline deterministic teaching loop.' },
        generator: generatorSettings(),
        includeReference: false
      })
      return { decision, context, lessonPath: nextPublication.lesson.absolutePath, lessonGroundingSourceId }
    },
    readCanonical: () => readCanonical(root),
    restartWithoutFault: () => createGoldenTeachingLoopHarness({ root }),
    readRepair: (sessionId) => committer.reconcile(sessionId),
    presentationSnapshot: (result, next) => snapshotFrom({
      result,
      decision: next.decision,
      sourceIds: next.context.grounding.sources.map((source) => source.sourceId),
      canonicalStatus: 'record_saved',
      sessionStatus: 'completed'
    }),
    recoveredPresentationSnapshot: () => snapshotFrom({
      result: { status: 'already_committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true },
      decision: planForOutcome(
        planner,
        { status: 'already_committed', outcome: { kind: 'misconception_corrected' }, recordSaved: true },
        workspace.id,
        publication.lesson.courseId
      ),
      sourceIds: [...GOLDEN_SOURCE_IDS],
      canonicalStatus: 'record_saved',
      sessionStatus: 'completed'
    }),
    incompletePresentationSnapshot: () => snapshotFrom({
      result: { status: 'retryable_failure', reason: 'reconciliation_required' },
      decision: null,
      sourceIds: [],
      canonicalStatus: 'failed',
      sessionStatus: 'active'
    })
  }
}

function initialLessonFacts(root: string): LessonArtifactPublicationFacts {
  return {
    workspace: { name: 'Golden Teaching Workspace', rootPath: root },
    plan: {
      title: 'Canonical evidence review',
      objective: 'Verify assessment evidence.',
      durationMinutes: 25,
      sections: [{ heading: 'Evidence', body: 'Review the available evidence before answering.' }],
      keyPoints: ['Assessment sidecar facts are authoritative.'],
      quiz: [{
        type: 'single',
        question: 'Which source is authoritative?',
        choices: ['Preview', 'Assessment sidecar'],
        answer: 1,
        explanation: 'The sidecar is verified.'
      }],
      flashcards: [],
      callouts: [],
      referenceNotes: '',
      learningRecordNote: ''
    },
    sequence: 1,
    title: 'Canonical evidence review',
    objective: 'Verify assessment evidence.',
    prompt: 'offline deterministic fixture',
    createdAt: FIXED_NOW,
    durationMinutes: 25,
    mission: { title: 'Golden Teaching Workspace', excerpt: 'Offline deterministic teaching loop.' },
    generator: generatorSettings(),
    includeReference: false
  }
}

async function ensureInitialLessonPublication(root: string): Promise<LessonArtifactPublication> {
  const facts = initialLessonFacts(root)
  const derived = deriveLessonArtifactPublication(facts)
  try {
    const assessmentContent = await readFile(derived.paths.assessmentAbsolutePath, 'utf8')
    await readFile(derived.lesson.absolutePath, 'utf8')
    return {
      transactionId: 'fixture-restart-publication',
      lesson: derived.lesson,
      assessment: {
        relativePath: derived.paths.assessmentRelativePath,
        contentSha256: createHash('sha256').update(Buffer.from(assessmentContent, 'utf8')).digest('hex')
      },
      paths: derived.paths,
      eventPaths: [derived.paths.lessonRelativePath, derived.paths.assessmentRelativePath]
    }
  } catch (error: unknown) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
    return publishLessonArtifacts(facts)
  }
}

function registerGateway(service: TeachingWorkspaceService): void {
  registerTeachingIpcGateway({
    workspaceService: service,
    settingsService: {} as TeachingIpcRegistration['settingsService'],
    skillLibraryService: {} as TeachingIpcRegistration['skillLibraryService'],
    learningAnalyticsService: {} as TeachingIpcRegistration['learningAnalyticsService'],
    logger: { error: () => undefined, path: 'golden-test.log' },
    applyAppBehavior: async () => undefined
  })
}

function gatewayHandler(channel: string): (event: unknown, ...args: unknown[]) => Promise<unknown> {
  const testIpc = ipcMain as unknown as IpcMainTestDouble
  const handler = testIpc.handlers.get(channel)
  if (!handler) throw new Error(`Teaching IPC channel is not registered: ${channel}`)
  return handler
}

function planForOutcome(
  planner: ReturnType<typeof createNextTeachingStepPlanner>,
  result: LearningOutcomeCommitResult,
  workspaceId: string,
  courseId: string
): NextTeachingStepDecision {
  void workspaceId
  return planner.plan({
    mission: { id: 'mission-golden-001', nextGoal: 'available' },
    course: { id: courseId },
    latestSession: { id: GOLDEN_SESSION_ID, source: 'canonical', readOnly: false },
    durableOutcome: trustedOutcome(result),
    evidence: result.status === 'committed' || result.status === 'already_committed'
      ? { status: 'verified' }
      : { status: 'unavailable' },
    resources: {
      readiness: 'ready',
      availableCount: GOLDEN_SOURCE_IDS.length,
      provenanceIds: [...GOLDEN_SOURCE_IDS]
    }
  })
}

function trustedOutcome(result: LearningOutcomeCommitResult) {
  if (result.status === 'committed' || result.status === 'already_committed') {
    return {
      status: 'trusted' as const,
      id: `outcome-${result.outcome.kind}`,
      kind: result.outcome.kind,
      evidenceEventIds: result.outcome.kind === 'misconception_corrected'
        ? ['evidence-golden-corrected-002', 'evidence-golden-wrong-001']
        : ['evidence-golden-wrong-001']
    }
  }
  return { status: 'absent' as const }
}

function snapshotFrom(input: {
  result: LearningOutcomeCommitResult
  decision: NextTeachingStepDecision | null
  sourceIds: readonly string[]
  canonicalStatus: TeachingTurnSnapshot['save']['canonicalStatus']
  sessionStatus: TeachingTurnSnapshot['session']['status']
}): TeachingTurnSnapshot {
  const outcome = input.result.status === 'committed' || input.result.status === 'already_committed'
    ? { kind: input.result.outcome.kind }
    : null
  return {
    operation: { id: GOLDEN_CORRECTION_OPERATION_ID, revision: 2 },
    session: {
      id: GOLDEN_SESSION_ID,
      source: 'canonical',
      readOnly: false,
      status: input.sessionStatus,
      outcome
    },
    nextStep: input.decision,
    context: { readiness: 'ready' },
    save: { canonicalStatus: input.canonicalStatus, commit: input.result },
    event: {
      id: 'event-golden-save-002',
      operationId: GOLDEN_CORRECTION_OPERATION_ID,
      revision: 2,
      kind: 'save_continue_requested'
    },
    sourceIds: input.sourceIds
  }
}

async function writeOfflineFixture(root: string): Promise<void> {
  await mkdir(join(root, 'resources'), { recursive: true })
  await writeFile(join(root, 'MISSION.md'), '# Mission: Golden Teaching Workspace\n\n## Why\nOffline deterministic learning.\n', 'utf8')
  await writeFile(join(root, 'RESOURCES.md'), '## Trusted\n- Foundation: offline canonical source\n- Practice: offline retry source\n', 'utf8')
  await writeFile(join(root, 'resources', 'foundation.txt'), 'Assessment sidecars are canonical for evidence.', 'utf8')
  await writeFile(join(root, 'resources', 'practice.txt'), 'Contrast wrong and corrected evidence before continuing.', 'utf8')
}

async function trustedResources(root: string): Promise<TrustedTeachingResourceDescriptor[]> {
  const definitions = [
    { sourceId: GOLDEN_SOURCE_IDS[0], relativePath: 'resources/foundation.txt', priority: 'required' as const },
    { sourceId: GOLDEN_SOURCE_IDS[1], relativePath: 'resources/practice.txt', priority: 'recommended' as const }
  ]
  return Promise.all(definitions.map(async (definition) => ({
    schemaVersion: 1 as const,
    sourceId: definition.sourceId,
    relativePath: definition.relativePath,
    contentSha256: createHash('sha256').update(await readFile(join(root, ...definition.relativePath.split('/')))).digest('hex'),
    priority: definition.priority,
    authority: { kind: 'trusted_teaching_resource' as const, authorityId: GOLDEN_AUTHORITY_ID },
    provenance: {
      kind: 'workspace_resource' as const,
      resourceId: `resource-${definition.sourceId}`,
      revisionId: 'fixture-r1'
    }
  })))
}

async function readCanonical(root: string): Promise<CanonicalFacts> {
  const session = JSON.parse(
    await readFile(join(root, 'learning-sessions', GOLDEN_SESSION_ID, 'session.json'), 'utf8')
  ) as Record<string, unknown>
  const outcome = await readJsonOrNull(join(root, 'learning-sessions', GOLDEN_SESSION_ID, 'outcome.json'))
  const recordDirectory = join(root, 'learning-records')
  const files = await readdir(recordDirectory).catch(() => [] as string[])
  const records = await Promise.all(
    files.filter((file) => file.endsWith('.md')).sort().map((file) => readFile(join(recordDirectory, file), 'utf8'))
  )
  return { session, outcome, records }
}

async function readJsonOrNull(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

function generatorSettings(): TeachingSettingsV1['generator'] {
  return {
    providerId: 'offline-fixture',
    model: 'offline-fixture',
    endpointFormat: 'chat_completions',
    temperature: 0,
    maxOutputTokens: 512,
    lessonDurationMinutes: 25,
    includeRetrievalPractice: true,
    generateReference: false,
    structuredOutput: true,
    streaming: false,
    reasoningEffort: 'off',
    requestTimeoutMs: 1_000
  }
}
