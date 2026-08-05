import type { AgentArtifactRef } from '../../shared/teaching-types'
import type { ToolRuntimeChildRunRecord, ToolRuntimeEvent } from './tools/registry'
import type { AgentRunResourceBoundarySnapshot } from '../../shared/teaching-types'
import type { AgentRunResourceGovernor } from './agent-run-resource-governance'

export type ChildAgentProfile = 'read_only' | 'research' | 'workspace_audit'
export type ChildRunStatus = ToolRuntimeChildRunRecord['status']

export type ChildRunInput = {
  label: string
  prompt: string
  context?: string
  profile?: ChildAgentProfile
  timeoutMs?: number
}

export type ChildRunUsage = NonNullable<ToolRuntimeChildRunRecord['usage']>

export type ChildRunResult = {
  childRunId: string
  label: string
  profile: ChildAgentProfile
  status: ChildRunStatus
  stopReason?: ToolRuntimeChildRunRecord['stopReason']
  summary: string
  error?: string
  citations?: Array<{ sourceId: string; url: string; title?: string }>
  filesRead?: string[]
  usage?: ChildRunUsage
  archive?: AgentArtifactRef
}

export type ChildRunRecord = ToolRuntimeChildRunRecord & {
  prompt: string
  parentStreamId?: string
}

export type SupervisedChildRun = {
  label: string
  prompt: string
  context: string
  profile: ChildAgentProfile
  /** Local child-execution timeout; it aborts this child without imposing a run-wide quota. */
  timeoutMs: number
}

export type ChildRunExecutionResult = Omit<ChildRunResult, 'childRunId' | 'label' | 'profile' | 'status'> & {
  status: 'completed' | 'failed' | 'canceled'
}

export type ChildRunExecutor = (
  input: SupervisedChildRun,
  lifecycle: { childRunId: string; signal: AbortSignal; onDelta: (message: string) => void }
) => Promise<ChildRunExecutionResult>

export type ChildRunSupervisorRunOptions = {
  emit?: (event: ToolRuntimeEvent) => void
}

export type ChildRunPersistence = {
  save(record: ChildRunRecord): Promise<void>
}

export class ChildRunStore {
  private readonly records = new Map<string, ChildRunRecord>()
  private persistenceTail = Promise.resolve()
  private latestPersistence = Promise.resolve()

  constructor(private readonly persistence?: ChildRunPersistence) {}

  create(input: {
    id: string
    label: string
    profile: ChildAgentProfile
    prompt: string
    parentStreamId?: string
  }): ChildRunRecord {
    if (this.records.has(input.id)) throw new Error(`Duplicate child run: ${input.id}`)
    const now = new Date().toISOString()
    const record: ChildRunRecord = {
      id: input.id,
      parentStreamId: input.parentStreamId,
      label: input.label,
      profile: input.profile,
      status: 'queued',
      prompt: input.prompt,
      startedAt: now
    }
    this.records.set(record.id, record)
    this.persist(record)
    return record
  }

  transition(
    id: string,
    status: ChildRunStatus,
    patch: Omit<Partial<ChildRunRecord>, 'status'> = {}
  ): ChildRunRecord {
    const current = this.require(id)
    if (!isLegalTransition(current.status, status)) {
      throw new Error(`Illegal child run transition: ${current.status} -> ${status}`)
    }
    const next: ChildRunRecord = { ...current, ...patch, status }
    assertResourceStopIsFailed(next)
    this.records.set(id, next)
    this.persist(next)
    return next
  }

  update(id: string, patch: Partial<ChildRunRecord>): ChildRunRecord {
    const { status, ...metadata } = patch
    return status === undefined
      ? this.patch(id, metadata)
      : this.transition(id, status, metadata)
  }

  get(id: string): ChildRunRecord | null {
    return this.records.get(id) ?? null
  }

  list(parentStreamId?: string): ChildRunRecord[] {
    const records = [...this.records.values()]
    return parentStreamId ? records.filter((record) => record.parentStreamId === parentStreamId) : records
  }

  /** Wait until every currently queued durable write has settled. */
  flush(): Promise<void> {
    return this.latestPersistence
  }

  private patch(id: string, patch: Partial<ChildRunRecord>): ChildRunRecord {
    const current = this.require(id)
    const next: ChildRunRecord = { ...current, ...patch }
    assertResourceStopIsFailed(next)
    this.records.set(id, next)
    this.persist(next)
    return next
  }

  private persist(record: ChildRunRecord): void {
    if (!this.persistence) return
    const snapshot = { ...record }
    const write = this.persistenceTail.then(() => this.persistence?.save(snapshot))
    this.latestPersistence = write
    this.persistenceTail = write.then(() => undefined, () => undefined)
  }

  private require(id: string): ChildRunRecord {
    const current = this.records.get(id)
    if (!current) throw new Error(`Unknown child run: ${id}`)
    return current
  }
}

type SupervisedJob = {
  id: string
  input: SupervisedChildRun
  emit: (event: ToolRuntimeEvent) => void
  controller?: AbortController
  timer?: ReturnType<typeof setTimeout>
  detachParentAbort?: () => void
  detachResourceAbort?: () => void
  terminalResult?: ChildRunResult
  cancelPersistence?: Promise<boolean>
  canceledEventEmitted?: boolean
}

export class ChildRunSupervisor {
  private readonly store: ChildRunStore
  private readonly jobs = new Map<string, SupervisedJob>()
  private nextRunNumber = 0

  constructor(private readonly options: {
    execute: ChildRunExecutor
    parentStreamId?: string
    signal?: AbortSignal
    resourceGovernor?: AgentRunResourceGovernor
    store?: ChildRunStore
  }) {
    this.store = options.store ?? new ChildRunStore()
  }

  async run(input: SupervisedChildRun, options: ChildRunSupervisorRunOptions = {}): Promise<ChildRunResult> {
    return this.runQueued(await this.queue(input, options))
  }

  async runMany(
    inputs: SupervisedChildRun[],
    concurrency: number,
    options: ChildRunSupervisorRunOptions = {}
  ): Promise<ChildRunResult[]> {
    const jobs = await Promise.all(inputs.map((input) => this.queue(input, options)))
    return mapWithConcurrencyLimit(jobs, concurrency, (job) => this.runQueued(job))
  }

  async abort(childRunId: string): Promise<boolean> {
    const job = this.jobs.get(childRunId)
    const record = this.store.get(childRunId)
    if (!record || isTerminal(record.status)) return false
    return await this.cancel(job, '子任务已取消或超时。')
  }

  list(parentStreamId?: string): ChildRunRecord[] {
    return this.store.list(parentStreamId)
  }

  diagnostics(): { runs: ChildRunRecord[] } {
    return { runs: this.store.list() }
  }

  private async queue(input: SupervisedChildRun, options: ChildRunSupervisorRunOptions): Promise<SupervisedJob> {
    const id = this.createChildRunId()
    const emit = options.emit ?? (() => undefined)
    const record = this.store.create({
      id,
      label: input.label,
      profile: input.profile,
      prompt: input.prompt,
      parentStreamId: this.options.parentStreamId
    })
    const job: SupervisedJob = { id, input, emit }
    this.jobs.set(id, job)
    try {
      await this.store.flush()
    } catch (error) {
      this.jobs.delete(id)
      throw error
    }
    emit({ type: 'child_run_queued', child: toRuntimeRecord(record) })
    const cancelFromParent = (): void => {
      const boundary = this.options.resourceGovernor?.boundary
      void (boundary
        ? this.stopForResource(job, boundary)
        : this.cancel(job, '子任务已取消或超时。')
      ).catch(() => undefined)
    }
    if (this.options.signal?.aborted) {
      await this.cancel(job, '子任务已取消或超时。')
    } else if (this.options.signal) {
      this.options.signal.addEventListener('abort', cancelFromParent, { once: true })
      job.detachParentAbort = () => this.options.signal?.removeEventListener('abort', cancelFromParent)
    }

    const stopFromResourceBoundary = (): void => {
      const boundary = this.options.resourceGovernor?.boundary
      if (boundary) void this.stopForResource(job, boundary).catch(() => undefined)
    }
    if (this.options.resourceGovernor?.isTerminated) {
      stopFromResourceBoundary()
    } else if (this.options.resourceGovernor) {
      this.options.resourceGovernor.signal.addEventListener('abort', stopFromResourceBoundary, { once: true })
      job.detachResourceAbort = () => this.options.resourceGovernor?.signal.removeEventListener('abort', stopFromResourceBoundary)
    }
    return job
  }

  private async runQueued(job: SupervisedJob): Promise<ChildRunResult> {
    const beforeStart = this.store.get(job.id)
    if (!beforeStart) throw new Error(`Unknown child run: ${job.id}`)
    if (isTerminal(beforeStart.status)) {
      await job.cancelPersistence
      await this.store.flush()
      const result = this.requireTerminalResult(job, beforeStart)
      this.dispose(job)
      return result
    }

    const controller = new AbortController()
    job.controller = controller
    const running = this.store.transition(job.id, 'running', { startedAt: new Date().toISOString() })
    await this.store.flush()
    const afterStart = this.store.get(job.id)
    if (!afterStart || isTerminal(afterStart.status)) {
      const result = this.requireTerminalResult(job, afterStart ?? running)
      this.dispose(job)
      return result
    }
    job.emit({ type: 'child_run_started', child: toRuntimeRecord(afterStart) })
    job.timer = setTimeout(() => {
      void this.cancel(job, '子任务已取消或超时。').catch(() => undefined)
    }, job.input.timeoutMs)

    try {
      const output = await this.options.execute(job.input, {
        childRunId: job.id,
        signal: this.composeSignal(controller.signal),
        onDelta: (message) => {
          const current = this.store.get(job.id)
          if (current?.status === 'running') job.emit({ type: 'child_run_delta', childRunId: job.id, message })
        }
      })
      return await this.settle(job, output)
    } catch (error) {
      const canceled = this.store.get(job.id)
      if (canceled?.status === 'canceled') {
        return await this.settle(job, {
          status: 'canceled',
          summary: canceled.summary ?? '子任务已取消或超时。',
          usage: canceled.usage,
          archive: canceled.archive
        })
      }
      const message = error instanceof Error ? error.message : String(error)
      return await this.settle(job, {
        status: 'failed',
        summary: `子任务失败：${message}`,
        error: message,
        usage: { toolCalls: 0 }
      })
    } finally {
      this.dispose(job)
    }
  }

  private async settle(job: SupervisedJob, output: ChildRunExecutionResult): Promise<ChildRunResult> {
    const current = this.store.get(job.id)
    if (!current) throw new Error(`Unknown child run: ${job.id}`)
    if (current.status === 'canceled') {
      const canceled = this.store.update(job.id, {
        summary: output.status === 'canceled' ? output.summary : current.summary,
        usage: output.usage ?? current.usage,
        archive: output.archive ?? current.archive,
        completedAt: current.completedAt ?? new Date().toISOString()
      })
      const result = this.resultFrom(job, canceled, {
        ...output,
        status: 'canceled',
        summary: canceled.summary ?? '子任务已取消或超时。',
        error: undefined
      })
      job.terminalResult = result
      await this.store.flush()
      if (!job.canceledEventEmitted) {
        job.canceledEventEmitted = true
        job.emit({ type: 'child_run_canceled', child: toRuntimeRecord(canceled) })
      }
      return result
    }
    if (current.status !== 'running') return this.requireTerminalResult(job, current)

    // A resource terminal never becomes a successful child result, even if a
    // future executor accidentally supplies it with a completed status.
    const terminalStatus: ChildRunStatus = output.stopReason ? 'failed' : output.status
    const terminal = this.store.transition(job.id, terminalStatus, {
      summary: output.summary,
      error: output.error,
      stopReason: terminalStatus === 'failed' ? output.stopReason : undefined,
      usage: output.usage,
      archive: output.archive,
      completedAt: new Date().toISOString()
    })
    const result = this.resultFrom(job, terminal, output)
    job.terminalResult = result
    await this.store.flush()
    if (terminal.status === 'completed') job.emit({ type: 'child_run_completed', child: toRuntimeRecord(terminal) })
    else if (terminal.status === 'failed') job.emit({ type: 'child_run_failed', child: toRuntimeRecord(terminal) })
    else job.emit({ type: 'child_run_canceled', child: toRuntimeRecord(terminal) })
    return result
  }

  private cancel(job: SupervisedJob | undefined, summary: string): Promise<boolean> {
    if (!job) return Promise.resolve(false)
    if (job.cancelPersistence) return job.cancelPersistence
    const current = this.store.get(job.id)
    if (!current || isTerminal(current.status)) return Promise.resolve(false)
    job.controller?.abort()
    const canceled = this.store.transition(job.id, 'canceled', {
      summary,
      completedAt: new Date().toISOString()
    })
    const result = this.resultFrom(job, canceled, {
      status: 'canceled',
      summary,
      usage: canceled.usage
    })
    job.terminalResult = result
    const emitImmediately = current.status === 'queued'
    job.cancelPersistence = this.store.flush().then(() => {
      if (emitImmediately && !job.canceledEventEmitted) {
        job.canceledEventEmitted = true
        job.emit({ type: 'child_run_canceled', child: toRuntimeRecord(canceled) })
      }
      return true
    })
    return job.cancelPersistence
  }

  /** Preserve a parent resource terminal as a failed child, never as canceled. */
  private stopForResource(job: SupervisedJob | undefined, boundary: AgentRunResourceBoundarySnapshot): Promise<boolean> {
    if (!job) return Promise.resolve(false)
    if (job.cancelPersistence) return job.cancelPersistence
    const current = this.store.get(job.id)
    if (!current || isTerminal(current.status)) return Promise.resolve(false)
    job.controller?.abort(boundary)
    const summary = boundary.action === 'suspended'
      ? '子任务因父运行资源治理暂停，未完成。'
      : '子任务达到父运行资源边界，未完成。'
    const failed = this.store.transition(job.id, 'failed', {
      summary,
      error: boundary.action === 'suspended' ? 'suspended' : 'resource_limit',
      stopReason: boundary.action === 'suspended' ? 'suspended' : 'resource_limit',
      completedAt: new Date().toISOString()
    })
    job.terminalResult = this.resultFrom(job, failed, {
      status: 'failed',
      stopReason: failed.stopReason,
      summary,
      error: failed.error,
      usage: failed.usage
    })
    job.cancelPersistence = this.store.flush().then(() => {
      job.emit({ type: 'child_run_failed', child: toRuntimeRecord(failed) })
      return true
    })
    return job.cancelPersistence
  }

  private composeSignal(controllerSignal: AbortSignal): AbortSignal {
    const signals = [this.options.signal, this.options.resourceGovernor?.signal, controllerSignal]
      .filter((signal): signal is AbortSignal => signal !== undefined)
    return signals.length === 1 ? signals[0] : AbortSignal.any(signals)
  }

  private dispose(job: SupervisedJob): void {
    if (job.timer) clearTimeout(job.timer)
    job.detachParentAbort?.()
    job.detachResourceAbort?.()
    this.jobs.delete(job.id)
  }

  private requireTerminalResult(job: SupervisedJob, record: ChildRunRecord): ChildRunResult {
    if (job.terminalResult) return job.terminalResult
    const status = record.status === 'completed' || record.status === 'failed' ? record.status : 'canceled'
    return this.resultFrom(job, record, {
      status,
      summary: record.summary ?? (status === 'canceled' ? '子任务已取消或超时。' : '子任务结束。'),
      error: record.error,
      usage: record.usage
    })
  }

  private resultFrom(job: SupervisedJob, record: ChildRunRecord, output: ChildRunExecutionResult): ChildRunResult {
    return {
      childRunId: job.id,
      label: job.input.label,
      profile: job.input.profile,
      status: record.status,
      stopReason: record.status === 'failed' ? output.stopReason ?? record.stopReason : undefined,
      summary: output.summary,
      error: output.error,
      filesRead: output.filesRead,
      citations: output.citations,
      usage: output.usage,
      archive: output.archive
    }
  }

  private createChildRunId(): string {
    this.nextRunNumber += 1
    return `child-${Date.now().toString(36)}-${this.nextRunNumber.toString(36)}`
  }
}

function assertResourceStopIsFailed(record: ChildRunRecord): void {
  if (record.stopReason && record.status !== 'failed') {
    throw new Error('A child resource terminal must use failed status.')
  }
}

function isLegalTransition(from: ChildRunStatus, to: ChildRunStatus): boolean {
  if (from === to) return true
  if (from === 'queued') return to === 'running' || to === 'canceled' || to === 'failed'
  if (from === 'running') return to === 'completed' || to === 'failed' || to === 'canceled'
  return false
}

function isTerminal(status: ChildRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled'
}

function toRuntimeRecord(record: ChildRunRecord): ToolRuntimeChildRunRecord {
  return {
    id: record.id,
    label: record.label,
    profile: record.profile,
    status: record.status,
    stopReason: record.stopReason,
    summary: record.summary,
    error: record.error,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    archive: record.archive,
    usage: record.usage
  }
}

async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>
): Promise<TOut[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<TOut>(items.length)
  let nextIndex = 0
  await Promise.all(
    new Array(limit).fill(null).map(async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await worker(items[index], index)
      }
    })
  )
  return results
}