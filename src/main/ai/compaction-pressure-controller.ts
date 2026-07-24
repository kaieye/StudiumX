/**
 * Compaction pressure ladder + single-flight mutex (Phase A / worth-learning §2.3).
 *
 * Authority split (product floor):
 * - Projection compaction remains **reference-only / non-durable** (ADR-0064).
 * - **Hard run budget** and durable-success fallback remain authoritative; this
 *   module must never substitute soft reminders for hard budget stops.
 * - Concurrent pre-send / mid-stream / post-tool style triggers share one in-flight
 *   compaction; pressure escalates only when a completed compact still sits over threshold.
 */

export type CompactionTriggerPoint = 'pre_send' | 'mid_stream' | 'post_tool'

/** Discrete prune pressure; higher → smaller kept tail / more aggressive mode bias. */
export type CompactionPressureLevel = 0 | 1 | 2 | 3

export type CompactionPressureState = {
  level: CompactionPressureLevel
  consecutiveStillOver: number
}

/**
 * Pure product-floor flags: compaction must not fight hard budget / fallback.
 * Callers may document or gate via `shouldSkipCompactionForHardBudget`.
 */
export const COMPACTION_HARD_BUDGET_AUTHORITY = {
  /** Soft reminders / soft thresholds never replace hard run budget stops. */
  softReminderSubstitutesHardBudget: false,
  /** When a hard run budget stop is pending/exhausted, budget is sole authority. */
  hardRunBudgetAuthoritative: true,
  /** Durable-success fallback remains a host path; compaction is not a substitute. */
  durableSuccessFallbackAuthoritative: true,
  /** Default compaction stays non-durable projection rewrite only (ADR-0064). */
  durableRewriteDefault: false
} as const

export type CompactionPressureOptionOverrides = {
  /** Multiplier applied to normal/aggressive tail ratios (lower = keep less tail). */
  tailRatioScale: number
  /** When true, soft_threshold triggers plan as aggressive (harder prune). */
  preferAggressive: boolean
  /** Optional absolute min tail messages floor reduction (never below 1 at apply site). */
  minTailMessagesDelta: number
}

const MAX_PRESSURE_LEVEL: CompactionPressureLevel = 3

export function createCompactionPressureState(): CompactionPressureState {
  return { level: 0, consecutiveStillOver: 0 }
}

/**
 * Escalate when a completed compact still sits over the trigger threshold;
 * reset when under threshold (or when no compact applied and not still over).
 */
export function nextPressureState(
  current: CompactionPressureState,
  input: { stillOverThreshold: boolean; compacted: boolean }
): CompactionPressureState {
  if (!input.stillOverThreshold) {
    return createCompactionPressureState()
  }
  // Only climb the ladder after an actual compact that failed to bring us under.
  // Mid-run protect: do not thrash escalate on no-op / skipped flights.
  if (!input.compacted) {
    return current
  }
  const consecutiveStillOver = current.consecutiveStillOver + 1
  const level = Math.min(MAX_PRESSURE_LEVEL, current.level + 1) as CompactionPressureLevel
  return { level, consecutiveStillOver }
}

/** Map pressure level → prune option overrides (pure). */
export function pressureOptionOverrides(level: CompactionPressureLevel): CompactionPressureOptionOverrides {
  switch (level) {
    case 0:
      return { tailRatioScale: 1, preferAggressive: false, minTailMessagesDelta: 0 }
    case 1:
      return { tailRatioScale: 0.85, preferAggressive: false, minTailMessagesDelta: 0 }
    case 2:
      return { tailRatioScale: 0.7, preferAggressive: true, minTailMessagesDelta: -1 }
    case 3:
      return { tailRatioScale: 0.55, preferAggressive: true, minTailMessagesDelta: -2 }
    default:
      return { tailRatioScale: 1, preferAggressive: false, minTailMessagesDelta: 0 }
  }
}

/**
 * Hard budget / durable-success authority gate.
 * When true, callers should skip starting a new compaction attempt.
 */
export function shouldSkipCompactionForHardBudget(input: {
  hardBudgetExhausted?: boolean
  runBudgetStopPending?: boolean
}): boolean {
  if (!COMPACTION_HARD_BUDGET_AUTHORITY.hardRunBudgetAuthoritative) return false
  return input.hardBudgetExhausted === true || input.runBudgetStopPending === true
}

/**
 * Single-flight mutex: at most one async compaction body runs.
 * Concurrent callers **join** the first in-flight promise and reuse its result
 * (not a second summarize, and not a skip-with-empty result).
 */
export class CompactionSingleFlight {
  private inFlight: Promise<unknown> | null = null

  get isInFlight(): boolean {
    return this.inFlight !== null
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.inFlight) {
      // Join semantics: late callers observe the first flight's outcome.
      return this.inFlight as Promise<T>
    }
    const pending = Promise.resolve()
      .then(work)
      .finally(() => {
        if (this.inFlight === pending) this.inFlight = null
      })
    this.inFlight = pending
    return pending
  }
}

/**
 * Run-scoped pressure + single-flight controller used by ContextCompactor.
 * Keeps ladder state across multi-point triggers on the same projector/compactor.
 */
export class CompactionPressureController {
  private readonly flight = new CompactionSingleFlight()
  private state: CompactionPressureState = createCompactionPressureState()

  get pressure(): Readonly<CompactionPressureState> {
    return this.state
  }

  get isCompactionInFlight(): boolean {
    return this.flight.isInFlight
  }

  optionOverrides(): CompactionPressureOptionOverrides {
    return pressureOptionOverrides(this.state.level)
  }

  /**
   * Record outcome after a compact attempt finishes (including joined single-flight).
   * Escalates only when compact changed the projection and tokens remain over threshold.
   */
  recordOutcome(input: { stillOverThreshold: boolean; compacted: boolean }): void {
    this.state = nextPressureState(this.state, input)
  }

  /** Reset ladder (e.g. new conversation / force opt-in). */
  reset(): void {
    this.state = createCompactionPressureState()
  }

  runSingleFlight<T>(work: () => Promise<T>): Promise<T> {
    return this.flight.run(work)
  }
}
