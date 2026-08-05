import type {
  AgentResourceMeter,
  AgentRunResourceBoundarySnapshot,
  AgentRunResourceGovernance,
  AgentRunResourceGovernanceAudit,
  AgentRunResourceLimit,
  AgentResourceLimitLayer
} from '../../shared/teaching-types'

const MAX_DURATION_TIMER_DELAY_MS = 0x7fffffff

const HIGH_EMERGENCY_FUSE_LIMITS: readonly AgentRunResourceLimit[] = [
  { meter: 'logical_requests', limit: 10_000, scope: 'run', auditId: 'host_emergency_logical_requests' },
  { meter: 'provider_transport_attempts', limit: 20_000, scope: 'run', auditId: 'host_emergency_provider_attempts' },
  { meter: 'tool_operation_attempts', limit: 20_000, scope: 'run', auditId: 'host_emergency_tool_attempts' },
  { meter: 'total_tokens', limit: 100_000_000, scope: 'run', auditId: 'host_emergency_total_tokens' },
  { meter: 'duration_ms', limit: 24 * 60 * 60 * 1_000, scope: 'run', auditId: 'host_emergency_duration' }
]

type NormalizedLimit = AgentRunResourceLimit & { layer: AgentResourceLimitLayer }

export class AgentRunResourceBoundaryError extends Error {
  constructor(readonly boundary: AgentRunResourceBoundarySnapshot) {
    super(boundary.action === 'suspended'
      ? '运行已由高位紧急熔断器暂停。请检查运行环境后开始新的续接。'
      : '已达到为本次任务明确设置的资源边界。请调整预算或开始新的续接。')
    this.name = 'AgentRunResourceBoundaryError'
  }
}

/**
 * Local, host-owned resource boundary enforcement. This deliberately remains
 * separate from teaching settlement and provider quota/billing classification.
 */
export class AgentRunResourceGovernor {
  readonly signal: AbortSignal

  private readonly controller = new AbortController()
  private readonly startedAt: number
  private readonly now: () => number
  private readonly limits: readonly NormalizedLimit[]
  private readonly parentGovernor?: AgentRunResourceGovernor
  private readonly usage: Record<AgentResourceMeter, number> = {
    logical_requests: 0,
    provider_transport_attempts: 0,
    tool_operation_attempts: 0,
    duration_ms: 0,
    total_tokens: 0
  }
  /** This governor's own cumulative provider total (not its descendants). */
  private localTotalTokens = 0
  /** Sum of token deltas forwarded by descendants. */
  private childTotalTokens = 0
  /** Aggregate token total already forwarded to the parent governor. */
  private parentForwardedTotalTokens = 0
  private terminal?: AgentRunResourceBoundarySnapshot
  private durationTimer?: ReturnType<typeof setTimeout>
  private detachParentAbort?: () => void

  constructor(input: {
    governance?: AgentRunResourceGovernance
    parentSignal?: AbortSignal
    parentGovernor?: AgentRunResourceGovernor
    now?: () => number
  }) {
    this.now = input.now ?? Date.now
    this.startedAt = this.now()
    this.parentGovernor = input.parentGovernor
    this.limits = normalizeLimits(input.governance)
    this.signal = this.controller.signal
    const parentSignal = input.parentSignal
    if (parentSignal) {
      const forwardParentAbort = (): void => {
        const boundary = this.parentGovernor?.boundary
        if (boundary) this.terminateBoundary(boundary)
        else this.controller.abort(parentSignal.reason)
      }
      if (parentSignal.aborted) forwardParentAbort()
      else {
        parentSignal.addEventListener('abort', forwardParentAbort, { once: true })
        this.detachParentAbort = () => parentSignal.removeEventListener('abort', forwardParentAbort)
      }
    }
    if (this.parentGovernor?.isTerminated && this.parentGovernor.boundary) {
      this.terminateBoundary(this.parentGovernor.boundary)
    }
    this.scheduleDurationCheck()
  }

  get isTerminated(): boolean {
    return this.terminal !== undefined
  }

  get boundary(): AgentRunResourceBoundarySnapshot | undefined {
    return this.terminal
  }

  /** Create a child view that charges operation and token usage to this host ledger. */
  createChild(now: () => number = this.now): AgentRunResourceGovernor {
    return new AgentRunResourceGovernor({
      parentGovernor: this,
      parentSignal: this.signal,
      now
    })
  }

  /** Reject before an operation would cross a hard resource boundary. */
  preflight(meter: Exclude<AgentResourceMeter, 'duration_ms' | 'total_tokens'>, amount = 1, now: () => number = this.now): void {
    this.checkDuration(now)
    this.parentGovernor?.preflight(meter, amount, now)
    this.assertAvailable(meter, amount)
  }

  /** Reserve an operation before side effects or provider dispatch. */
  claim(meter: Exclude<AgentResourceMeter, 'duration_ms' | 'total_tokens'>, amount = 1, now: () => number = this.now): void {
    this.checkDuration(now)
    this.parentGovernor?.claim(meter, amount, now)
    this.assertAvailable(meter, amount)
    this.usage[meter] += normalizeAmount(amount)
  }

  /** Record measured consumption. A terminal boundary aborts in-flight work. */
  consume(meter: Extract<AgentResourceMeter, 'duration_ms' | 'total_tokens'>, amount: number, now: () => number = this.now): void {
    if (this.terminal) return
    if (meter === 'total_tokens') {
      // Provider totals supplied by one execution lane are cumulative. Keep that
      // lane's own maximum, then forward only the newly observed aggregate delta
      // to its parent. This avoids both overwrite across sibling lanes and
      // double-counting when a child reports 20 then 50 cumulative tokens.
      this.localTotalTokens = Math.max(this.localTotalTokens, normalizeAmount(amount))
      this.refreshTotalTokens(now)
    } else {
      this.usage[meter] = Math.max(this.usage[meter], normalizeAmount(amount))
      this.evaluate(meter)
    }
    if (meter !== 'duration_ms') this.checkDuration(now)
  }

  /** Add only a newly observed descendant token delta to this shared host ledger. */
  private consumeChildDelta(amount: number, now: () => number): void {
    if (this.terminal) return
    this.childTotalTokens += normalizeAmount(amount)
    this.refreshTotalTokens(now)
    this.checkDuration(now)
  }

  /** Recompute this lane's token aggregate and forward its unreported delta once. */
  private refreshTotalTokens(now: () => number): void {
    const aggregate = this.localTotalTokens + this.childTotalTokens
    this.usage.total_tokens = aggregate
    const delta = aggregate - this.parentForwardedTotalTokens
    if (delta > 0 && this.parentGovernor) {
      this.parentForwardedTotalTokens = aggregate
      this.parentGovernor.consumeChildDelta(delta, now)
    }
    this.evaluate('total_tokens')
  }

  canClaim(meter: Exclude<AgentResourceMeter, 'duration_ms' | 'total_tokens'>, amount = 1, now: () => number = this.now): boolean {
    this.checkDuration(now)
    if (this.terminal) return false
    if (this.parentGovernor && !this.parentGovernor.canClaim(meter, amount, now)) return false
    const requested = this.usage[meter] + normalizeAmount(amount)
    return !this.limits.some((limit) => limit.meter === meter && requested > limit.limit)
  }

  audit(): AgentRunResourceGovernanceAudit {
    const inherited = this.parentGovernor?.audit()
    return {
      configured: inherited
        ? [...inherited.configured, ...this.limits.map(({ layer, meter, limit, scope, auditId }) => ({ layer, meter, limit, scope, ...(auditId ? { auditId } : {}) }))]
        : this.limits.map(({ layer, meter, limit, scope, auditId }) => ({ layer, meter, limit, scope, ...(auditId ? { auditId } : {}) })),
      ...(this.terminal ? { terminal: this.terminal } : inherited?.terminal ? { terminal: inherited.terminal } : {})
    }
  }

  dispose(): void {
    if (this.durationTimer) clearTimeout(this.durationTimer)
    this.durationTimer = undefined
    this.detachParentAbort?.()
    this.detachParentAbort = undefined
  }

  private scheduleDurationCheck(): void {
    if (this.terminal || this.durationTimer) return
    const durationLimit = this.minimumDurationLimit()
    if (durationLimit === undefined) return
    const elapsed = Math.max(0, this.now() - this.startedAt)
    const remaining = Math.max(0, durationLimit - elapsed)
    // Timers are bounded by the platform's maximum delay. Re-evaluate and
    // reschedule so long-running configured limits cannot wrap or fire early.
    const delay = Math.min(MAX_DURATION_TIMER_DELAY_MS, remaining)
    this.durationTimer = setTimeout(() => {
      this.durationTimer = undefined
      this.checkDuration(this.now)
      this.scheduleDurationCheck()
    }, delay)
    this.durationTimer.unref?.()
  }

  private minimumDurationLimit(): number | undefined {
    return this.limits
      .filter((limit) => limit.meter === 'duration_ms')
      .reduce<number | undefined>((minimum, limit) => minimum === undefined ? limit.limit : Math.min(minimum, limit.limit), undefined)
  }

  private checkDuration(now: () => number): void {
    if (this.terminal) return
    const elapsed = Math.max(0, now() - this.startedAt)
    // `consume` keeps duration monotonic; callers without an injected clock still
    // receive timer enforcement for in-flight requests.
    this.consume('duration_ms', Math.max(this.usage.duration_ms, elapsed), now)
  }

  private assertAvailable(meter: AgentResourceMeter, amount: number): void {
    if (this.terminal) throw new AgentRunResourceBoundaryError(this.terminal)
    const requested = this.usage[meter] + normalizeAmount(amount)
    const hit = this.limits.find((limit) => limit.meter === meter && requested > limit.limit)
    if (!hit) return
    this.terminate(hit, this.usage[meter])
    throw new AgentRunResourceBoundaryError(this.terminal!)
  }

  private evaluate(meter: AgentResourceMeter): void {
    const hit = this.limits.find((limit) => limit.meter === meter && this.usage[meter] >= limit.limit)
    if (hit) this.terminate(hit, this.usage[meter])
  }

  private terminate(limit: NormalizedLimit, used: number): void {
    this.terminateBoundary({
      layer: limit.layer,
      meter: limit.meter,
      used,
      limit: limit.limit,
      scope: limit.scope,
      ...(limit.auditId ? { auditId: limit.auditId } : {}),
      action: limit.layer === 'emergency_fuse' ? 'suspended' : 'resource_limit'
    })
  }

  private terminateBoundary(boundary: AgentRunResourceBoundarySnapshot): void {
    if (this.terminal) return
    if (this.durationTimer) clearTimeout(this.durationTimer)
    this.durationTimer = undefined
    this.terminal = boundary
    this.controller.abort(new AgentRunResourceBoundaryError(boundary))
  }
}

function normalizeLimits(governance: AgentRunResourceGovernance | undefined): readonly NormalizedLimit[] {
  const fromLayer = (layer: AgentResourceLimitLayer, limits: readonly AgentRunResourceLimit[] | undefined): NormalizedLimit[] =>
    (limits ?? []).flatMap((limit) => {
      const normalized = normalizeLimit(limit)
      return normalized ? [{ ...normalized, layer }] : []
    })
  return [
    ...fromLayer('user_budget', governance?.userBudget?.limits),
    ...fromLayer('deployment_policy', governance?.deploymentPolicy?.limits),
    // The baseline host fuse is unconditional. Configuration may only add
    // tighter emergency constraints; it can never remove host protection.
    ...fromLayer('emergency_fuse', HIGH_EMERGENCY_FUSE_LIMITS),
    ...fromLayer('emergency_fuse', governance?.emergencyFuse?.limits)
  ]
}

function normalizeLimit(limit: AgentRunResourceLimit): AgentRunResourceLimit | undefined {
  const value = Number.isFinite(limit.limit) ? Math.floor(limit.limit) : 0
  if (value <= 0) return undefined
  return { ...limit, limit: value }
}

function normalizeAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}
