import { createLearningOutcomeCommitter } from '../../src/main/learning-outcome-committer'
import { createLearningSessionLedger } from '../../src/main/learning-session-ledger'

type WorkerRequest = {
  workspaceRoot: string
  operation: 'open' | 'appendEvidence' | 'commit' | 'reconcile'
  sessionId: string
  operationId?: string
  outcomeId?: string
  evidenceEventId?: string
  kind?: 'established' | 'needs_practice' | 'not_evidenced' | 'misconception_corrected'
  crashPoint?: string
  writerLockStaleMs?: number
  writerLockWaitMs?: number
  assessmentRelativePath?: string
  assessmentSha256?: string
}

const request = JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64url').toString('utf8')) as WorkerRequest

const ledger = createLearningSessionLedger({
  workspaceRoot: request.workspaceRoot,
  writerLockStaleMs: request.writerLockStaleMs,
  writerLockWaitMs: request.writerLockWaitMs
})

try {
  let result: unknown
  if (request.operation === 'open') {
    result = await ledger.open({
      sessionId: request.sessionId,
      workspaceId: 'workspace-1',
      courseRef: { courseId: 'course-1', courseName: 'Foundations', relativePath: 'courses/foundations' },
      lessonRef: { lessonId: 'lesson-1', title: 'Evidence', relativePath: 'courses/foundations/lesson-1.html' }
    })
  } else if (request.operation === 'appendEvidence') {
    result = await ledger.append(request.sessionId, {
      schemaVersion: 1,
      eventId: request.evidenceEventId ?? 'evidence-1',
      sessionId: request.sessionId,
      kind: 'quiz_attempted',
      occurredAt: '2026-07-15T14:00:01.000Z',
      payload: {}
    })
  } else if (request.operation === 'commit') {
    const kind = request.kind ?? 'established'
    const evidenceEventIds = kind === 'established' || kind === 'misconception_corrected'
      ? [request.evidenceEventId ?? 'evidence-1']
      : []
    const committer = createLearningOutcomeCommitter({
      workspaceRoot: request.workspaceRoot,
      ledger,
      createId: () => request.outcomeId ?? 'outcome-process-1',
      evaluate: async ({ session }) => ({
        schemaVersion: 1,
        sessionId: session.id,
        kind,
        mastery: kind === 'established',
        evidenceEventIds,
        artifact: kind === 'established' || kind === 'misconception_corrected'
          ? {
              relativePath: request.assessmentRelativePath ?? 'courses/foundations/lesson-1-assessment.html',
              sha256: request.assessmentSha256 ?? 'a'.repeat(64),
              status: 'verified' as const
            }
          : { relativePath: null, sha256: null, status: 'missing_assessment' as const },
        assessments: []
      }),
      testingFaults: request.crashPoint
        ? {
            inject(point) {
              if (point === request.crashPoint) process.exit(86)
            }
          }
        : undefined
    })
    result = await committer.commit({
      sessionId: request.sessionId,
      operationId: request.operationId ?? 'operation-process-1'
    })
  } else if (request.operation === 'reconcile') {
    const committer = createLearningOutcomeCommitter({
      workspaceRoot: request.workspaceRoot,
      ledger,
      createId: () => request.outcomeId ?? 'outcome-process-1'
    })
    result = await committer.reconcile(request.sessionId)
  } else {
    throw new Error(`Unknown operation: ${String((request as { operation?: string }).operation)}`)
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result })}
`)
} catch (error) {
  const value = error as Error & { code?: string }
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: { name: value.name, message: value.message, code: value.code }
  })}
`)
  process.exitCode = 2
}
