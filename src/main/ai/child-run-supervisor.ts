import type { ToolRuntimeChildRunRecord, ToolRuntimeEvent } from './tools/registry'

export type ChildAgentProfile = 'read_only' | 'research' | 'workspace_audit'
export type ChildRunStatus = ToolRuntimeChildRunRecord['status']

export type ChildRunInput = {
  label: string
  prompt: string
  context?: string
  profile?: ChildAgentProfile
  maxIterations?: number
  timeoutMs?: number
}

export type ChildRunUsage = NonNullable<ToolRuntimeChildRunRecord['usage']>

export type ChildRunResult = {
  childRunId: string
  label: string
  profile: ChildAgentProfile
  status: ChildRunStatus
  summary: string
  error?: string
  citations?: Array<{ sourceId: string; url: string; title?: string }>
  filesRead?: string[]
  usage?: ChildRunUsage
}

export type ChildRunRecord = ToolRuntimeChildRunRecord & {
  prompt: string
  parentStreamId?: string
}

export type SupervisedChildRun = Required<ChildRunInput> & { profile: ChildAgentProfile }

export type ChildRunExecutionResult = Omit<ChildRunResult, 'childRunId' | 'label' | 'profile' | 'status'> & {
  status: 'completed' | 'failed' | 'canceled'
}

export type ChildRunExecutor = (
  input: SupervisedChildRun,
  lifecycle: { signal: AbortSignal; onDelta: (message: string) => void }
) => Promise<ChildRunExecutionResult>

export type ChildRunSupervisorRunOptions = {
  emit?: (event: ToolRuntimeEvent) => void
}

export class ChildRunStore {
  private readonly records = new Map<string, ChildRunRecord>()

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
    this.records.set(id, next)
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

  private patch(id: string, patch: Partial<ChildRunRecord>): ChildRunRecord {
    const current = this.require(id)
    const next: ChildRunRecord = { ...current, ...patch }
    this.records.set(id, next)
    return next
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
  terminalResult?: ChildRunResult
}

export class ChildRunSupervisor {
  private readonly store: ChildRunStore
  private readonly jobs = new Map<string, SupervisedJob>()
  private nextRunNumber = 0

  constructor(private readonly options: {
    execute: ChildRunExecutor
    parentStreamId?: string
    signal?: AbortSignal
    store?: ChildRunStore
  }) {
    this.store = options.store ?? new ChildRunStore()
  }

  async run(input: SupervisedChildRun, options: ChildRunSupervisorRunOptions = {}): Promise<ChildRunResult> {
    const job = this.queue(input, options)
    return this.runQueued(job)
  }

  async runMany(
    inputs: SupervisedChildRun[],
    concurrency: number,
    options: ChildRunSupervisorRunOptions = {}
  ): Promise<ChildRunResult[]> {
    const jobs = inputs.map((input) => this.queue(input, options))
    return mapWithConcurrencyLimit(jobs, concurrency, (job) => this.runQueued(job))
  }

  abort(childRunId: string): boolean {
    const job = this.jobs.get(childRunId)
    const record = this.store.get(childRunId)
    if (!record || isTerminal(record.status)) return false
    this.cancel(job, '子任务已取消或超时。')
    return true
  }

  list(parentStreamId?: string): ChildRunRecord[] {
    return this.store.list(parentStreamId)
  }

  diagnostics(): { runs: ChildRunRecord[] } {
    return { runs: this.store.list() }
  }

  private queue(input: SupervisedChildRun, options: ChildRunSupervisorRunOptions): SupervisedJob {
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
    emit({ type: 'child_run_queued', child: toRuntimeRecord(record) })
    const cancelFromParent = (): void => this.cancel(job, '子任务已取消或超时。')
    if (this.options.signal?.aborted) {
      cancelFromParent()
    } else if (this.options.signal) {
      this.options.signal.addEventListener('abort', cancelFromParent, { once: true })
      job.detachParentAbort = () => this.options.signal?.removeEventListener('abort', cancelFromParent)
    }
    return job
  }

  private async runQueued(job: SupervisedJob): Promise<ChildRunResult> {
    const beforeStart = this.store.get(job.id)
    if (!beforeStart) throw new Error(`Unknown child run: ${job.id}`)
    if (isTerminal(beforeStart.status)) {
      const result = this.requireTerminalResult(job, beforeStart)
      this.dispose(job)
      return result
    }

    const controller = new AbortController()
    job.controller = controller
    const running = this.store.transition(job.id, 'running', { startedAt: new Date().toISOString() })
    job.emit({ type: 'child_run_started', child: toRuntimeRecord(running) })
    job.timer = setTimeout(() => this.cancel(job, '子任务已取消或超时。'), job.input.timeoutMs)

    try {
      const output = await this.options.execute(job.input, {
        signal: this.composeSignal(controller.signal),
        onDelta: (message) => {
          const current = this.store.get(job.id)
          if (current?.status === 'running') job.emit({ type: 'child_run_delta', childRunId: job.id, message })
        }
      })
      return this.settle(job, output)
    } catch (error) {
      if (this.store.get(job.id)?.status === 'canceled') return this.requireTerminalResult(job, this.store.get(job.id)!)
      const message = error instanceof Error ? error.message : String(error)
      return this.settle(job, {
        status: 'failed',
        summary: `子任务失败：${message}`,
        error: message,
        usage: { toolCalls: 0 }
      })
    } finally {
      this.dispose(job)
    }
  }

  private settle(job: SupervisedJob, output: ChildRunExecutionResult): ChildRunResult {
    const current = this.store.get(job.id)
    if (!current) throw new Error(`Unknown child run: ${job.id}`)
    if (current.status === 'canceled') {
      const canceled = this.store.update(job.id, {
        summary: output.status === 'canceled' ? output.summary : current.summary,
        usage: output.usage ?? current.usage,
        completedAt: current.completedAt ?? new Date().toISOString()
      })
      const result = this.resultFrom(job, canceled, {
        ...output,
        status: 'canceled',
        summary: canceled.summary ?? '子任务已取消或超时。',
        error: undefined
      })
      job.terminalResult = result
      return result
    }
    if (current.status !== 'running') return this.requireTerminalResult(job, current)

    const terminal = this.store.transition(job.id, output.status, {
      summary: output.summary,
      error: output.error,
      usage: output.usage,
      completedAt: new Date().toISOString()
    })
    const result = this.resultFrom(job, terminal, output)
    job.terminalResult = result
    if (output.status === 'completed') job.emit({ type: 'child_run_completed', child: toRuntimeRecord(terminal) })
    else if (output.status === 'failed') job.emit({ type: 'child_run_failed', child: toRuntimeRecord(terminal) })
    else job.emit({ type: 'child_run_canceled', child: toRuntimeRecord(terminal) })
    return result
  }

  private cancel(job: SupervisedJob | undefined, summary: string): void {
    if (!job) return
    const current = this.store.get(job.id)
    if (!current || isTerminal(current.status)) return
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
    job.emit({ type: 'child_run_canceled', child: toRuntimeRecord(canceled) })
  }

  private composeSignal(controllerSignal: AbortSignal): AbortSignal {
    return this.options.signal ? AbortSignal.any([this.options.signal, controllerSignal]) : controllerSignal
  }

  private dispose(job: SupervisedJob): void {
    if (job.timer) clearTimeout(job.timer)
    job.detachParentAbort?.()
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
      summary: output.summary,
      error: output.error,
      filesRead: output.filesRead,
      citations: output.citations,
      usage: output.usage
    }
  }

  private createChildRunId(): string {
    this.nextRunNumber += 1
    return `child-${Date.now().toString(36)}-${this.nextRunNumber.toString(36)}`
  }
}

function isLegalTransition(from: ChildRunStatus, to: ChildRunStatus): boolean {
  if (from === to) return true
  if (from === 'queued') return to === 'running' || to === 'canceled'
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
    summary: record.summary,
    error: record.error,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
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