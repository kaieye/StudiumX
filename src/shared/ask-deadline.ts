/**
 * Authoritative ask deadline + timeout settlement policy (ADR-0010).
 *
 * Host stamps `__deadlineAt` once; all surfaces count down from that ISO timestamp.
 * Timeout settles **ask only** to the recommended option (or first option).
 * Timeout must never auto-approve write / privileged / turn-review gates.
 */

import type { AskAnswer, AskOption, AskQuestion } from './teaching-types'

/** Host-stamped ISO deadline field on ask tool-call arguments (not model schema). */
export const ASK_DEADLINE_AT_KEY = '__deadlineAt' as const

/** Default wait window when the host does not override timeoutMs. */
export const DEFAULT_ASK_TIMEOUT_MS = 5 * 60 * 1000

/** Surfaces that must never auto-approve on ask timeout. */
export type AskTimeoutNonAutoApproveTarget =
  | 'workspace_write'
  | 'external_write'
  | 'privileged'
  | 'turn_review'
  | 'ask'

export type ResolveAskDeadlineInput = Readonly<{
  /** Existing host-stamped deadline (ISO-8601). When valid, it wins (authority). */
  existingDeadlineAt?: string | null
  nowMs: number
  /** Wait window when minting a new deadline. Clamped to a safe range. */
  timeoutMs?: number
}>

export type ResolveAskDeadlineResult = Readonly<{
  deadlineAt: string
  /** True when a new deadline was minted; false when an existing valid stamp was kept. */
  minted: boolean
  timeoutMs: number
}>

const MIN_ASK_TIMEOUT_MS = 1_000
const MAX_ASK_TIMEOUT_MS = 30 * 60 * 1000

/** Clamp timeout to a safe product range. */
export function clampAskTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return DEFAULT_ASK_TIMEOUT_MS
  }
  const rounded = Math.floor(timeoutMs)
  if (rounded < MIN_ASK_TIMEOUT_MS) return MIN_ASK_TIMEOUT_MS
  if (rounded > MAX_ASK_TIMEOUT_MS) return MAX_ASK_TIMEOUT_MS
  return rounded
}

/**
 * Parse a host-stamped deadline. Returns null when missing or not a valid time.
 */
export function parseAskDeadlineAt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const ms = Date.parse(trimmed)
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/**
 * Resolve the authoritative deadline for an ask interaction.
 *
 * Monotonic authority: a valid existing stamp is never replaced (even if past).
 * Surfaces share that single timestamp for countdown and timeout settlement.
 */
export function resolveAskDeadlineAt(input: ResolveAskDeadlineInput): ResolveAskDeadlineResult {
  const timeoutMs = clampAskTimeoutMs(input.timeoutMs)
  const existing = parseAskDeadlineAt(input.existingDeadlineAt)
  if (existing) {
    return { deadlineAt: existing, minted: false, timeoutMs }
  }
  const nowMs = Number.isFinite(input.nowMs) ? Math.floor(input.nowMs) : Date.now()
  const deadlineAt = new Date(nowMs + timeoutMs).toISOString()
  return { deadlineAt, minted: true, timeoutMs }
}

/**
 * Stamp ask tool-call arguments with an authoritative `__deadlineAt`.
 * Preserves other top-level fields; overwrites only when minting a new deadline.
 */
export function stampAskArguments(
  args: unknown,
  input: { nowMs: number; timeoutMs?: number }
): { args: Record<string, unknown>; deadlineAt: string; minted: boolean } {
  const base =
    args && typeof args === 'object' && !Array.isArray(args)
      ? { ...(args as Record<string, unknown>) }
      : {}
  const existingRaw = base[ASK_DEADLINE_AT_KEY]
  const existingDeadlineAt =
    typeof existingRaw === 'string' || existingRaw == null
      ? (existingRaw as string | null | undefined)
      : undefined
  const resolved = resolveAskDeadlineAt({
    existingDeadlineAt,
    nowMs: input.nowMs,
    timeoutMs: input.timeoutMs
  })
  base[ASK_DEADLINE_AT_KEY] = resolved.deadlineAt
  return { args: base, deadlineAt: resolved.deadlineAt, minted: resolved.minted }
}

/**
 * Remaining milliseconds until deadline. Negative when overdue.
 * Returns null when deadline is missing/invalid (UI should hide countdown).
 */
export function remainingAskMs(deadlineAt: string | null | undefined, nowMs: number): number | null {
  const parsed = parseAskDeadlineAt(deadlineAt)
  if (!parsed) return null
  return Date.parse(parsed) - Math.floor(nowMs)
}

/**
 * Pick the timeout default label for one question:
 * recommended option when marked, otherwise first option.
 */
export function pickAskTimeoutOption(options: readonly AskOption[]): AskOption | null {
  if (!options || options.length === 0) return null
  const recommended = options.find((option) => option.recommended === true)
  if (recommended) return recommended
  return options[0] ?? null
}

/**
 * Build synthetic answers for timeout settlement (recommended / first per question).
 * Questions with no usable options are omitted (treated as unanswered).
 */
export function buildAskTimeoutAnswers(questions: readonly AskQuestion[]): AskAnswer[] {
  const answers: AskAnswer[] = []
  for (const question of questions) {
    const picked = pickAskTimeoutOption(question.options)
    if (!picked?.label) continue
    answers.push({ questionId: question.id, selected: [picked.label] })
  }
  return answers
}

/**
 * Product-floor policy: ask timeout may settle **ask** only.
 * Never auto-approves write / privileged / turn-review surfaces.
 */
export function askTimeoutMayAutoApprove(target: AskTimeoutNonAutoApproveTarget): boolean {
  return target === 'ask'
}

/**
 * Format remaining time for UI (mm:ss when under 1h, else h:mm:ss).
 * Returns null when remaining is unknown; "0:00" when overdue.
 */
export function formatAskRemainingLabel(remainingMs: number | null): string | null {
  if (remainingMs === null) return null
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  }
  // Under 1h: minutes unpadded (e.g. "4:05", "0:00" when overdue).
  return `${minutes}:${ss}`
}
