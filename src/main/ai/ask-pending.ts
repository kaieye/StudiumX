import type { AskAnswer, AskQuestion } from '../../shared/teaching-types'
import { buildAskTimeoutAnswers, parseAskDeadlineAt, remainingAskMs } from '../../shared/ask-deadline'

/**
 * In-flight ask-tool resolvers, keyed by `${streamId}:${toolCallId}`.
 *
 * The ask handler registers a pending entry and awaits its resolver; the
 * renderer-side `teach:agent-chat-tool-answer` IPC call resolves it. When
 * the agent stream is canceled, {@link cancelStreamAskPending} rejects all
 * pending entries for that stream so the agent loop's `isCanceled()` path
 * can take over.
 *
 * Host-stamped `deadlineAt` is authoritative (ADR-0144): a timer settles the
 * ask to recommended/first options on timeout. Timeout never auto-approves
 * write / privileged / turn-review gates.
 */
type PendingEntry = {
  resolve: (answers: AskAnswer[]) => void
  reject: (error: Error) => void
  deadlineAt: string
  questions: AskQuestion[]
  clearTimer: () => void
  settled: boolean
}

export type RegisterAskPendingOptions = Readonly<{
  questions: readonly AskQuestion[]
  /** Authoritative ISO deadline shared with UI surfaces. */
  deadlineAt: string
  /** Injectable clock for tests. */
  nowMs?: () => number
  /**
   * Injectable timer schedule for tests. Defaults to real setTimeout.
   * `clear` must cancel a pending callback.
   */
  scheduleTimeout?: (callback: () => void, delayMs: number) => { clear: () => void }
}>

const pending = new Map<string, PendingEntry>()

function key(streamId: string, toolCallId: string): string {
  return `${streamId}:${toolCallId}`
}

function settleResolve(entry: PendingEntry, mapKey: string, answers: AskAnswer[]): void {
  if (entry.settled) return
  entry.settled = true
  entry.clearTimer()
  pending.delete(mapKey)
  entry.resolve(answers)
}

function settleReject(entry: PendingEntry, mapKey: string, error: Error): void {
  if (entry.settled) return
  entry.settled = true
  entry.clearTimer()
  pending.delete(mapKey)
  entry.reject(error)
}

/** Register a pending ask and return a promise that resolves when the user
 *  answers (via {@link resolveAskPending}), times out to recommended/first
 *  options, or rejects when the stream is canceled
 *  (via {@link cancelStreamAskPending}). */
export function registerAskPending(
  streamId: string,
  toolCallId: string,
  options: RegisterAskPendingOptions
): Promise<AskAnswer[]> {
  const mapKey = key(streamId, toolCallId)
  const existing = pending.get(mapKey)
  if (existing && !existing.settled) {
    settleReject(existing, mapKey, new Error('ask pending replaced'))
  }

  const deadlineAt = parseAskDeadlineAt(options.deadlineAt) ?? String(options.deadlineAt)
  const questions = options.questions.map((question) => ({
    ...question,
    options: question.options.map((option) => ({ ...option }))
  }))
  const now = options.nowMs ?? (() => Date.now())
  const schedule =
    options.scheduleTimeout ??
    ((callback: () => void, delayMs: number) => {
      const handle = setTimeout(callback, delayMs)
      return { clear: () => clearTimeout(handle) }
    })

  return new Promise<AskAnswer[]>((resolve, reject) => {
    const entry: PendingEntry = {
      resolve,
      reject,
      deadlineAt,
      questions,
      clearTimer: () => undefined,
      settled: false
    }
    pending.set(mapKey, entry)

    const fireTimeout = (): void => {
      const current = pending.get(mapKey)
      if (!current || current.settled) return
      settleResolve(current, mapKey, buildAskTimeoutAnswers(current.questions))
    }

    const remaining = remainingAskMs(deadlineAt, now())
    const delayMs = remaining === null ? 0 : Math.max(0, remaining)
    const scheduled = schedule(fireTimeout, delayMs)
    entry.clearTimer = scheduled.clear
  })
}

/** Resolve a pending ask with the user's answers. Returns true if a pending
 *  entry existed. Called from the renderer→main IPC handler. */
export function resolveAskPending(
  streamId: string,
  toolCallId: string,
  answers: AskAnswer[]
): boolean {
  const mapKey = key(streamId, toolCallId)
  const entry = pending.get(mapKey)
  if (!entry || entry.settled) return false
  settleResolve(entry, mapKey, answers)
  return true
}

/** Reject one pending ask when its handler fails before it can await the
 *  user's answer (for example while persisting the waiting checkpoint). */
export function rejectAskPending(streamId: string, toolCallId: string, error: Error): boolean {
  const mapKey = key(streamId, toolCallId)
  const entry = pending.get(mapKey)
  if (!entry || entry.settled) return false
  settleReject(entry, mapKey, error)
  return true
}

/** Reject every pending ask for a stream (e.g. when the user cancels the
 *  agent chat). Used by the cancel-IPC handler so no resolver dangles. */
export function cancelStreamAskPending(streamId: string): void {
  const prefix = `${streamId}:`
  for (const [mapKey, entry] of [...pending.entries()]) {
    if (!mapKey.startsWith(prefix)) continue
    settleReject(entry, mapKey, new Error('ask canceled: stream aborted'))
  }
}

/** Test helper: peek authoritative deadline for a pending ask. */
export function peekAskPendingDeadline(streamId: string, toolCallId: string): string | null {
  return pending.get(key(streamId, toolCallId))?.deadlineAt ?? null
}

/** Test helper: number of in-flight pending asks (all streams). */
export function countAskPending(): number {
  return pending.size
}
