import type { DueLessonReview } from './lesson-review-due'
import type { PetNotificationPreferences } from '../../../../shared/teaching-types'

export type PetNotificationState = 'waiting' | 'failed' | 'review' | 'running' | 'waving'

export type PetNotificationSource = 'agent' | 'lesson-generation' | 'lesson-review' | 'onboarding'

export type PetNotificationAction =
  | 'open-assistant'
  | 'open-conversation'
  | 'open-lesson'
  | 'open-lessons'
  | 'stop-run'

export type PetNotification = {
  id: string
  source: PetNotificationSource
  sourceId?: string
  resultId?: string
  targetId?: string
  state: PetNotificationState
  title: string
  detail: string
  action: PetNotificationAction
  actionLabel: string
  createdAt: number
  expiresAt?: number
}

export type PetPendingRequestSignal = {
  id: string
  conversationId: string
  kind: 'ask' | 'tool-permission'
}

export type PetNotificationFailureSignal = {
  id: string
  source: Exclude<PetNotificationSource, 'onboarding'>
  sourceId?: string
  targetId?: string
  detail: string
  createdAt: number
}

export type PetNotificationRunSignal = {
  busy: boolean
  runId?: string
  conversationId?: string
  result?: {
    runId: string
    resultId: string
    targetId: string
  }
}

export type PetNotificationSignals = {
  now: number
  enabled: boolean
  pendingRequest: PetPendingRequestSignal | null
  agent: PetNotificationRunSignal
  lessonGeneration: PetNotificationRunSignal
  lessonReview: {
    dueLessons: DueLessonReview[]
  }
  errors: PetNotificationFailureSignal[]
}

type PetRunLifecycle = {
  id: string
  source: Exclude<PetNotificationSource, 'onboarding'>
  sourceId: string
  targetId?: string
  createdAt: number
}

type PetReviewLifecycle = PetRunLifecycle & {
  resultId: string
  expiresAt: number
}

type PetWavingLifecycle = {
  id: string
  createdAt: number
  expiresAt: number
}

type PetWaitingLifecycle = {
  id: string
  sourceId: string
}

export type PetLessonReviewLifecycle = {
  id: string
  lessonId: string
  lessonTitle: string
  lessonRelativePath: string
  reason: DueLessonReview['reason']
  createdAt: number
}

export type PetNotificationProjectionState = {
  enabled: boolean
  sequence: number
  agentRun: PetRunLifecycle | null
  lessonGenerationRun: PetRunLifecycle | null
  waiting: PetWaitingLifecycle | null
  reviews: PetReviewLifecycle[]
  lessonReviews: PetLessonReviewLifecycle[]
  waving: PetWavingLifecycle | null
}

type PetNotificationCopyBlock = {
  title: string
  detail: string
  actionLabel: string
}

export type PetNotificationCopy = {
  waiting: PetNotificationCopyBlock
  agentRunning: PetNotificationCopyBlock
  lessonRunning: PetNotificationCopyBlock
  agentReview: PetNotificationCopyBlock
  lessonReview: PetNotificationCopyBlock
  lessonReviewDue: PetNotificationCopyBlock
  agentFailed: Omit<PetNotificationCopyBlock, 'detail'>
  lessonFailed: Omit<PetNotificationCopyBlock, 'detail'>
  waving: PetNotificationCopyBlock
}

export type DismissedPetNotifications = Readonly<Record<string, number>>

export const PET_REVIEW_DURATION_MS = 7_000
export const PET_WAVING_DURATION_MS = 8_000

export const PET_QUIET_MODE_DURATIONS_MS = {
  thirtyMinutes: 30 * 60 * 1_000,
  oneHour: 60 * 60 * 1_000
} as const

const PET_NOTIFICATION_PRIORITY: Record<PetNotificationState, number> = {
  waiting: 5,
  failed: 4,
  review: 3,
  running: 2,
  waving: 1
}

export function createInitialPetNotificationProjectionState(): PetNotificationProjectionState {
  return {
    enabled: false,
    sequence: 0,
    agentRun: null,
    lessonGenerationRun: null,
    waiting: null,
    reviews: [],
    lessonReviews: [],
    waving: null
  }
}

export function advancePetNotificationProjection(
  previous: PetNotificationProjectionState,
  signals: PetNotificationSignals
): PetNotificationProjectionState {
  let sequence = previous.sequence
  let waving = previous.waving?.expiresAt && previous.waving.expiresAt > signals.now
    ? previous.waving
    : null
  let reviews = previous.reviews.filter((review) => review.expiresAt > signals.now)

  if (!signals.enabled) {
    return {
      enabled: false,
      sequence,
      agentRun: null,
      lessonGenerationRun: null,
      waiting: null,
      reviews: [],
      lessonReviews: [],
      waving: null
    }
  }

  if (!previous.enabled) {
    sequence += 1
    waving = {
      id: `onboarding:${sequence}:waving`,
      createdAt: signals.now,
      expiresAt: signals.now + PET_WAVING_DURATION_MS
    }
  }

  const agent = advanceRunLifecycle({
    previous: previous.agentRun,
    signal: signals.agent,
    source: 'agent',
    sequence,
    now: signals.now,
    errors: signals.errors,
    requireResultForReview: true
  })
  sequence = agent.sequence
  if (agent.review) reviews = replaceReview(reviews, agent.review)

  const lesson = advanceRunLifecycle({
    previous: previous.lessonGenerationRun,
    signal: signals.lessonGeneration,
    source: 'lesson-generation',
    sequence,
    now: signals.now,
    errors: signals.errors,
    requireResultForReview: true
  })
  sequence = lesson.sequence
  if (lesson.review) reviews = replaceReview(reviews, lesson.review)

  const currentWaiting = signals.pendingRequest
    ? {
        id: waitingNotificationId(signals.pendingRequest),
        sourceId: signals.pendingRequest.conversationId
      }
    : null
  const waiting = currentWaiting ?? (
    previous.waiting && agent.run?.sourceId === previous.waiting.sourceId
      ? previous.waiting
      : null
  )

  const lessonReviews = reconcileLessonReviews(previous.lessonReviews, signals.lessonReview.dueLessons, signals.now)

  return {
    enabled: true,
    sequence,
    agentRun: agent.run,
    lessonGenerationRun: lesson.run,
    waiting,
    reviews,
    lessonReviews,
    waving
  }
}

function reconcileLessonReviews(
  previous: PetLessonReviewLifecycle[],
  dueLessons: DueLessonReview[],
  now: number
): PetLessonReviewLifecycle[] {
  if (dueLessons.length === 0) return []
  const previousByLessonId = new Map(previous.map((entry) => [entry.lessonId, entry]))
  const reconciled: PetLessonReviewLifecycle[] = []
  for (const due of dueLessons) {
    const existing = previousByLessonId.get(due.lessonId)
    reconciled.push({
      id: `lesson-review:${due.lessonId}`,
      lessonId: due.lessonId,
      lessonTitle: due.lessonTitle,
      lessonRelativePath: due.lessonRelativePath,
      reason: due.reason,
      createdAt: existing?.createdAt ?? now
    })
  }
  return reconciled
}

function waitingNotificationId(request: PetPendingRequestSignal): string {
  return `agent:${request.conversationId}:${request.id}:waiting`
}

function advanceRunLifecycle(input: {
  previous: PetRunLifecycle | null
  signal: PetNotificationRunSignal
  source: Exclude<PetNotificationSource, 'onboarding'>
  sequence: number
  now: number
  errors: PetNotificationFailureSignal[]
  requireResultForReview: boolean
}): { run: PetRunLifecycle | null; review: PetReviewLifecycle | null; sequence: number } {
  let { sequence } = input
  const signaledRunId = input.signal.runId?.trim() || null
  const sameRun = input.previous && (!signaledRunId || input.previous.sourceId === signaledRunId)
    ? input.previous
    : null

  if (input.signal.busy) {
    if (sameRun) {
      return {
        run: { ...sameRun, targetId: input.signal.conversationId ?? sameRun.targetId },
        review: null,
        sequence
      }
    }
    sequence += 1
    const sourceId = signaledRunId ?? `lifecycle-${sequence}`
    return {
      run: {
        id: `${input.source}:${sourceId}:running`,
        source: input.source,
        sourceId,
        targetId: input.signal.conversationId,
        createdAt: input.now
      },
      review: null,
      sequence
    }
  }

  if (!input.previous) return { run: null, review: null, sequence }
  const failed = input.errors.some((error) =>
    error.source === input.source &&
    (!error.sourceId || error.sourceId === input.previous?.sourceId)
  )
  const result = input.signal.result
  const resultMatchesRun = Boolean(
    result?.runId.trim() && result.runId.trim() === input.previous.sourceId
  )
  if (failed || (input.requireResultForReview && !resultMatchesRun)) {
    return { run: null, review: null, sequence }
  }

  if (!result) return { run: null, review: null, sequence }

  return {
    run: null,
    review: {
      ...input.previous,
      id: `${input.source}:${input.previous.sourceId}:review`,
      resultId: result.resultId,
      targetId: result.targetId,
      createdAt: input.now,
      expiresAt: input.now + PET_REVIEW_DURATION_MS
    },
    sequence
  }
}

function replaceReview(reviews: PetReviewLifecycle[], review: PetReviewLifecycle): PetReviewLifecycle[] {
  return [...reviews.filter((item) => item.id !== review.id), review]
}

export function projectPetNotifications(
  state: PetNotificationProjectionState,
  signals: PetNotificationSignals,
  copy: PetNotificationCopy
): PetNotification[] {
  if (!signals.enabled) return []
  const notifications: PetNotification[] = []

  if (signals.pendingRequest) {
    notifications.push({
      id: waitingNotificationId(signals.pendingRequest),
      source: 'agent',
      sourceId: signals.pendingRequest.conversationId,
      targetId: signals.pendingRequest.conversationId,
      state: 'waiting',
      action: 'open-conversation',
      ...copy.waiting,
      createdAt: state.agentRun?.createdAt ?? signals.now
    })
  }

  for (const error of signals.errors) {
    const errorCopy = error.source === 'agent' ? copy.agentFailed : copy.lessonFailed
    notifications.push({
      id: error.id,
      source: error.source,
      sourceId: error.sourceId,
      targetId: error.targetId,
      state: 'failed',
      title: errorCopy.title,
      detail: error.detail,
      action: 'open-assistant',
      actionLabel: errorCopy.actionLabel,
      createdAt: error.createdAt
    })
  }

  for (const review of state.reviews) {
    const reviewCopy = review.source === 'agent' ? copy.agentReview : copy.lessonReview
    notifications.push({
      ...review,
      state: 'review',
      action: review.source === 'agent' ? 'open-conversation' : 'open-lessons',
      ...reviewCopy
    })
  }

  for (const review of state.lessonReviews) {
    notifications.push({
      id: review.id,
      source: 'lesson-review',
      sourceId: review.lessonId,
      targetId: review.lessonId,
      state: 'review',
      action: 'open-lesson',
      title: copy.lessonReviewDue.title,
      detail: copy.lessonReviewDue.detail,
      actionLabel: copy.lessonReviewDue.actionLabel,
      createdAt: review.createdAt
    })
  }

  for (const run of [state.agentRun, state.lessonGenerationRun]) {
    if (!run) continue
    const runningCopy = run.source === 'agent' ? copy.agentRunning : copy.lessonRunning
    notifications.push({
      ...run,
      state: 'running',
      action: run.source === 'agent' ? 'open-conversation' : 'open-assistant',
      ...runningCopy
    })
  }

  if (state.waving) {
    notifications.push({
      ...state.waving,
      source: 'onboarding',
      state: 'waving',
      action: 'open-assistant',
      ...copy.waving
    })
  }

  return notifications.filter((notification) =>
    notification.expiresAt === undefined || notification.expiresAt > signals.now
  )
}

export function projectPetNotificationVisibility(
  notifications: readonly PetNotification[],
  preferences: PetNotificationPreferences,
  now: number
): PetNotification[] {
  const quietModeActive = preferences.quietUntil !== null && preferences.quietUntil > now

  return notifications.filter((notification) => {
    if (notification.expiresAt !== undefined && notification.expiresAt <= now) return false
    if (notification.state === 'waiting' || notification.state === 'failed') return true
    if (quietModeActive || preferences.actionableOnly) return false
    if (!isPetNotificationSourceEnabled(notification.source, preferences)) return false
    if (notification.state === 'running') return preferences.showRunning
    if (notification.state === 'review') return preferences.showReview
    return preferences.showWaving
  })
}

function isPetNotificationSourceEnabled(
  source: PetNotificationSource,
  preferences: PetNotificationPreferences
): boolean {
  if (source === 'agent') return preferences.sources.agent
  if (source === 'lesson-generation') return preferences.sources.lessonGeneration
  if (source === 'lesson-review') return preferences.sources.lessonReview
  return preferences.sources.onboarding
}

export function selectHighestPriorityPetNotification(
  notifications: PetNotification[],
  dismissed: DismissedPetNotifications,
  now: number
): PetNotification | null {
  return selectPetNotifications(notifications, dismissed, now, 1)[0] ?? null
}

export function selectPetNotifications(
  notifications: PetNotification[],
  dismissed: DismissedPetNotifications,
  now: number,
  limit = notifications.length
): PetNotification[] {
  return notifications
    .filter((item) => item.expiresAt === undefined || item.expiresAt > now)
    .filter((item) => dismissed[item.id] === undefined)
    .sort((left, right) =>
      PET_NOTIFICATION_PRIORITY[right.state] - PET_NOTIFICATION_PRIORITY[left.state]
      || right.createdAt - left.createdAt
      || left.id.localeCompare(right.id)
    )
    .slice(0, Math.max(0, limit))
}

export function dismissPetNotification(
  dismissed: DismissedPetNotifications,
  notification: PetNotification,
  now: number
): DismissedPetNotifications {
  return {
    ...dismissed,
    [notification.id]: now
  }
}

export function pruneDismissedPetNotifications(
  dismissed: DismissedPetNotifications,
  retainedIds: readonly string[]
): DismissedPetNotifications {
  const retained = new Set(retainedIds)
  return Object.fromEntries(Object.entries(dismissed).filter(([id]) => retained.has(id)))
}

export function retainedPetNotificationIds(
  state: PetNotificationProjectionState,
  signals: PetNotificationSignals
): string[] {
  const ids = new Set<string>()
  if (state.waiting) ids.add(state.waiting.id)
  if (state.agentRun) ids.add(state.agentRun.id)
  if (state.lessonGenerationRun) ids.add(state.lessonGenerationRun.id)
  for (const review of state.reviews) {
    if (review.expiresAt > signals.now) ids.add(review.id)
  }
  for (const review of state.lessonReviews) {
    ids.add(review.id)
  }
  if (state.waving?.expiresAt && state.waving.expiresAt > signals.now) ids.add(state.waving.id)
  for (const error of signals.errors) ids.add(error.id)
  return [...ids]
}
