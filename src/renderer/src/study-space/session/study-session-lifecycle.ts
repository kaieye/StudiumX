import type { StudyAnalyticsFact, StudyTaskAttribution } from '../../../../shared/teaching-types/analytics'
import {
  createStudyAnalyticsFactId,
  createTaskActivityFacts
} from '../../views/workbench/analytics/domain/activityLedger'
import { getLocalDateKey, resolvedLocalTimeZone } from '../../views/workbench/analytics/domain/dateRange'
import {
  advanceActiveStudySession,
  createActiveStudySession,
  finalizeActiveStudySession,
  pauseActiveStudySession,
  remainingActiveStudySessionSeconds,
  resumeActiveStudySession,
  type ActiveStudySessionV1
} from '../../views/workbench/analytics/domain/sessionFacts'
import type { ReliableTimerSample } from '../../views/workbench/analytics/domain/reliableTimer'
import type { StudyRoomEventKind, StudyRoomId, StudySnapshot } from '../types'
import {
  advanceStudyTimerBySeconds,
  defaultStudyContractText,
  followStudyRoomCycle,
  toggleStudyTimer
} from './transitions'

export type StudyPresenceIntent = {
  kind: 'presence'
  event: StudyRoomEventKind
  text: string
  target: { roomId: StudyRoomId; spaceCode: string }
}

export type StudyNotificationIntent = {
  kind: 'notification'
  title: string
  body: string
}

export type StudyAnalyticsIntent = {
  kind: 'analytics'
  clientId: string
  facts: StudyAnalyticsFact[]
  localToday?: string
  updatedAt?: string
}

export type StudySessionLifecycleIntent = StudyPresenceIntent | StudyNotificationIntent | StudyAnalyticsIntent

export type StudySessionLifecycleResult = {
  snapshot: StudySnapshot
  completed: boolean
  intents: StudySessionLifecycleIntent[]
}

export type StudySessionLifecycleEnvironment = {
  sample: () => ReliableTimerSample
  timeZone?: () => string
  localDate?: (wallMs: number, timeZone: string) => string
  createFactId?: (prefix: string, now?: number) => string
}

export type StudySessionStartOptions = {
  taskId?: string | null
  workspaceId?: string
}

export type FollowStudyRoomCycleOptions = StudySessionStartOptions & {
  room: Parameters<typeof followStudyRoomCycle>[0]['room']
  phase: 'focus' | 'break'
  remainingSeconds: number
  activeModeName: string
}

function browserIndependentTimeZone(): string {
  return resolvedLocalTimeZone()
}

function explicitTaskAttribution(
  snapshot: StudySnapshot,
  taskId: string | null | undefined,
  workspaceId?: string
): StudyTaskAttribution {
  if (!taskId) return { kind: 'unattributed', reason: 'no_task_selected' }
  const task = snapshot.tasks.find((item) => item.id === taskId)
  if (!task) return { kind: 'unattributed', reason: 'task_missing' }
  return {
    kind: 'explicit',
    capturedAt: 'session_start',
    taskId: task.id,
    taskTitleSnapshot: task.title,
    ...(workspaceId ? { workspaceId } : {})
  }
}

/**
 * Owns the durable facts and terminal policy of one Study Session timer.
 * The React hook supplies clocks and dispatches the returned intents to browser adapters.
 */
export class StudySessionLifecycle {
  private activeSession: ActiveStudySessionV1 | null = null

  constructor(private readonly environment: StudySessionLifecycleEnvironment) {}

  recover(snapshot: StudySnapshot, options: StudySessionStartOptions = {}): void {
    if (this.activeSession || snapshot.timerState === 'idle') return
    this.activeSession = this.createSession(snapshot, this.sample(), options, true)
  }

  advance(snapshot: StudySnapshot, options: StudySessionStartOptions = {}): StudySessionLifecycleResult {
    if (snapshot.timerState !== 'running') return { snapshot, completed: false, intents: [] }
    const sample = this.sample()
    const session = this.activeSession ?? this.createSession(snapshot, sample, options, true)
    const advanced = advanceActiveStudySession(session, { sample, timeZone: this.timeZone() })
    this.activeSession = advanced.session
    return this.applyAdvance(snapshot, advanced.session, advanced.activeDeltaSeconds, advanced.activeSecondsByLocalDate, advanced.completed, sample.wallMs)
  }

  toggle(
    snapshot: StudySnapshot,
    options: StudySessionStartOptions & { activeModeName: string }
  ): StudySessionLifecycleResult {
    const fallbackContract = defaultStudyContractText(snapshot, options.activeModeName)
    if (snapshot.timerState === 'running') {
      const advanced = this.advance(snapshot, options)
      if (advanced.completed) return advanced
      if (this.activeSession) {
        this.activeSession = pauseActiveStudySession(this.activeSession, { sample: this.sample(), timeZone: this.timeZone() })
      }
      return { snapshot: toggleStudyTimer(advanced.snapshot, fallbackContract), completed: false, intents: advanced.intents }
    }

    if (snapshot.timerState === 'paused') {
      const session = this.activeSession ?? this.createSession(snapshot, this.sample(), options, true)
      this.activeSession = resumeActiveStudySession(session, { sample: this.sample(), timeZone: this.timeZone() })
      return { snapshot: toggleStudyTimer(snapshot, fallbackContract), completed: false, intents: [] }
    }

    this.activeSession = this.createSession(snapshot, this.sample(), options)
    const intents: StudySessionLifecycleIntent[] = snapshot.timerMode === 'focus'
      ? [this.presence('focus_start', `${snapshot.nickname} 开始专注：${snapshot.contractText.trim() || fallbackContract}`, snapshot)]
      : []
    return { snapshot: toggleStudyTimer(snapshot, fallbackContract), completed: false, intents }
  }

  finish(
    snapshot: StudySnapshot,
    outcome: 'interrupted' | 'canceled',
    options: StudySessionStartOptions = {}
  ): StudySessionLifecycleResult {
    let session = this.activeSession
    if (!session && snapshot.timerState !== 'idle') session = this.createSession(snapshot, this.sample(), options, true)
    if (!session) return { snapshot, completed: false, intents: [] }

    let next = snapshot
    const sample = this.sample()
    if (session.timer.status === 'running') {
      const advanced = advanceActiveStudySession(session, { sample, timeZone: this.timeZone() })
      this.activeSession = advanced.session
      const applied = this.applyAdvance(next, advanced.session, advanced.activeDeltaSeconds, advanced.activeSecondsByLocalDate, advanced.completed, sample.wallMs)
      next = applied.snapshot
      if (applied.completed) return applied
      session = this.activeSession
    } else {
      session = resumeActiveStudySession(session, { sample, timeZone: this.timeZone() })
    }

    const fact = finalizeActiveStudySession(session, outcome)
    this.activeSession = null
    return { snapshot: next, completed: false, intents: [this.analytics(fact.clientId, [fact], sample.wallMs, fact.recordedAt)] }
  }

  followRoomCycle(snapshot: StudySnapshot, options: FollowStudyRoomCycleOptions): StudySessionLifecycleResult {
    const finished = this.finish(snapshot, 'interrupted', options)
    const current = finished.snapshot
    const contract = (current.contractText.trim() || defaultStudyContractText(current, options.activeModeName)).slice(0, 120)
    const next = followStudyRoomCycle({
      snapshot: current,
      room: options.room,
      phase: options.phase,
      remainingSeconds: options.remainingSeconds,
      fallbackContract: defaultStudyContractText(current, options.activeModeName)
    })
    this.activeSession = this.createSession(next, this.sample(), options)
    const intents = [...finished.intents]
    if (options.phase === 'focus') {
      intents.push(this.presence('focus_start', `${current.nickname} 跟随自习室周期开始专注：${contract}`, current))
    }
    return { snapshot: next, completed: false, intents }
  }

  recordTaskMutation(before: StudySnapshot, after: StudySnapshot, workspaceId?: string): StudySessionLifecycleIntent[] {
    const facts = createTaskActivityFacts(before.tasks, after.tasks, {
      clientId: before.clientId,
      ...(workspaceId ? { workspaceId } : {}),
      occurredAtMs: this.sample().wallMs,
      timeZone: this.timeZone()
    })
    return facts.length > 0 ? [this.analytics(before.clientId, facts)] : []
  }

  /**
   * Drop the parallel V1 ActiveStudySession without emitting study_session analytics.
   * Used when a canonical TimerSession is the segment authority and already projected
   * its own fact (sole-authority demotion). Presence/notification intents are owned
   * by the product-path handoff handlers, not re-emitted here.
   */
  discardActiveSessionWithoutAnalytics(): void {
    this.activeSession = null
  }

  private applyAdvance(
    current: StudySnapshot,
    session: ActiveStudySessionV1,
    activeDeltaSeconds: number,
    activeSecondsByLocalDate: Partial<Record<string, number>>,
    completed: boolean,
    wallMs: number
  ): StudySessionLifecycleResult {
    const completedFact = completed ? finalizeActiveStudySession(session, 'completed') : null
    const next = advanceStudyTimerBySeconds(current, {
      activeSeconds: activeDeltaSeconds,
      remainingSeconds: remainingActiveStudySessionSeconds(session),
      completed,
      localToday: this.localDate(wallMs),
      ...(current.timerMode === 'focus' ? { focusSecondsByLocalDate: activeSecondsByLocalDate } : {}),
      ...(completedFact ? { xpEarned: completedFact.xpEarned } : {})
    })
    if (!completedFact) return { snapshot: next, completed: false, intents: [] }

    this.activeSession = null
    const intents: StudySessionLifecycleIntent[] = [
      this.analytics(completedFact.clientId, [completedFact], wallMs, completedFact.recordedAt)
    ]
    if (current.timerMode === 'focus') {
      intents.push(
        this.presence('task_done', `${current.nickname} 完成 ${current.focusMinutes} 分钟专注，进入 ${current.breakMinutes} 分钟休息。`, current),
        { kind: 'notification', title: '自习室', body: `完成 ${current.focusMinutes} 分钟专注，进入休息。` }
      )
    } else {
      intents.push({ kind: 'notification', title: '自习室', body: '休息结束，可以开始下一轮专注。' })
    }
    return { snapshot: next, completed: true, intents }
  }

  private createSession(
    snapshot: StudySnapshot,
    sample: ReliableTimerSample,
    options: StudySessionStartOptions,
    legacy = false
  ): ActiveStudySessionV1 {
    const session = createActiveStudySession({
      id: this.factId('study-session', sample.wallMs),
      clientId: snapshot.clientId,
      timerMode: snapshot.timerMode,
      plannedSeconds: snapshot.remainingSeconds,
      sample,
      timeZone: this.timeZone(),
      context: {
        modeId: snapshot.modeId,
        roomId: snapshot.roomId,
        signalId: snapshot.signalId,
        spaceCode: snapshot.spaceCode
      },
      taskAttribution: legacy
        ? { kind: 'unattributed', reason: 'legacy_session' }
        : explicitTaskAttribution(snapshot, options.taskId, options.workspaceId)
    })
    return snapshot.timerState === 'paused'
      ? pauseActiveStudySession(session, { sample, timeZone: session.currentTimeZone })
      : session
  }

  private analytics(clientId: string, facts: StudyAnalyticsFact[], wallMs?: number, updatedAt?: string): StudyAnalyticsIntent {
    return {
      kind: 'analytics',
      clientId,
      facts,
      ...(updatedAt ? { localToday: this.localDate(wallMs ?? this.sample().wallMs), updatedAt } : {})
    }
  }

  private presence(event: StudyRoomEventKind, text: string, snapshot: StudySnapshot): StudyPresenceIntent {
    return { kind: 'presence', event, text, target: { roomId: snapshot.roomId, spaceCode: snapshot.spaceCode } }
  }

  private sample(): ReliableTimerSample {
    return this.environment.sample()
  }

  private timeZone(): string {
    return this.environment.timeZone?.() ?? browserIndependentTimeZone()
  }

  private localDate(wallMs: number): string {
    const timeZone = this.timeZone()
    return this.environment.localDate?.(wallMs, timeZone) ?? getLocalDateKey(wallMs, timeZone)
  }

  private factId(prefix: string, now: number): string {
    return this.environment.createFactId?.(prefix, now) ?? createStudyAnalyticsFactId(prefix, now)
  }
}