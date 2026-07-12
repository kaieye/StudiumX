import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import type {
  AgentRunBudget,
  AgentRunUsageAggregate,
  InterruptedAgentRun
} from '../../shared/teaching-types'

export type AgentRunCheckpointStatus =
  | 'running'
  | 'waiting_for_permission'
  | 'waiting_for_elicitation'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'interrupted'

export type AgentRunCheckpoint = {
  version: 1
  runId: string
  streamId: string
  workspaceId?: string
  conversationId?: string
  status: AgentRunCheckpointStatus
  previousStatus?: 'running' | 'waiting_for_permission' | 'waiting_for_elicitation'
  lastDurableSequence: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  interruptedAt?: string
  transcriptPointer?: string
  operationJournalPointer: string
  pendingPermissionId?: string
  pendingElicitationId?: string
  budget: AgentRunBudget
  usage: AgentRunUsageAggregate
  stopReason?: string
  interruptionReason?: string
}

export type AgentOperationState =
  | 'started'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'needs_review'

export type AgentOperationRecord = {
  version: 1
  operationId: string
  runId: string
  toolCallId: string
  toolName: string
  normalizedTarget?: string
  state: AgentOperationState
  resultHash?: string
  result?: string
  artifactPointer?: string
  artifactExists?: boolean
  disposition: 'first_execution' | 'idempotent_reuse' | 'manual_review'
  createdAt: string
  updatedAt: string
  completedAt?: string
  error?: string
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/
const MAX_RESULT_BYTES = 16 * 1024
const ACTIVE_STATUSES = new Set<AgentRunCheckpointStatus>([
  'running',
  'waiting_for_permission',
  'waiting_for_elicitation'
])

export const DEFAULT_AGENT_RUN_BUDGET: AgentRunBudget = {
  maxDurationMs: 120_000,
  maxProviderCalls: 16,
  maxToolCalls: 32,
  maxTotalTokens: 200_000,
  warningThreshold: 0.8
}

export function normalizeAgentRunBudget(input: Partial<AgentRunBudget> | null | undefined): AgentRunBudget {
  return {
    maxDurationMs: boundedInteger(input?.maxDurationMs, 5_000, 30 * 60_000, DEFAULT_AGENT_RUN_BUDGET.maxDurationMs),
    maxProviderCalls: boundedInteger(input?.maxProviderCalls, 1, 100, DEFAULT_AGENT_RUN_BUDGET.maxProviderCalls),
    maxToolCalls: boundedInteger(input?.maxToolCalls, 1, 500, DEFAULT_AGENT_RUN_BUDGET.maxToolCalls),
    maxTotalTokens: boundedInteger(input?.maxTotalTokens, 1_000, 2_000_000, DEFAULT_AGENT_RUN_BUDGET.maxTotalTokens),
    warningThreshold: boundedNumber(input?.warningThreshold, 0.5, 0.95, DEFAULT_AGENT_RUN_BUDGET.warningThreshold)
  }
}

export function emptyAgentRunUsage(): AgentRunUsageAggregate {
  return {
    providerCalls: 0,
    toolCalls: 0,
    toolErrors: 0,
    iterations: 0,
    childRuns: 0,
    durationMs: 0
  }
}

export function agentOperationId(runId: string, toolCallId: string): string {
  assertSafeId(runId, 'runId')
  if (!toolCallId.trim()) throw new Error('toolCallId is required.')
  return createHash('sha256').update(`${runId}\0${toolCallId}`).digest('hex')
}

export class AgentRunStore {
  private queue = Promise.resolve()

  constructor(readonly storageRoot: string, private readonly now: () => string = () => new Date().toISOString()) {}

  async create(input: {
    runId: string
    streamId: string
    workspaceId?: string
    conversationId?: string
    budget: AgentRunBudget
  }): Promise<AgentRunCheckpoint> {
    assertSafeId(input.runId, 'runId')
    assertSafeId(input.streamId, 'streamId')
    if (input.workspaceId) assertSafeId(input.workspaceId, 'workspaceId')
    if (input.conversationId) assertSafeId(input.conversationId, 'conversationId')
    const now = this.now()
    const checkpoint: AgentRunCheckpoint = {
      version: 1,
      runId: input.runId,
      streamId: input.streamId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      status: 'running',
      lastDurableSequence: 0,
      createdAt: now,
      updatedAt: now,
      operationJournalPointer: `.agent-sessions/operations/${input.runId}`,
      budget: normalizeAgentRunBudget(input.budget),
      usage: emptyAgentRunUsage()
    }
    await this.enqueue(() => this.writeCheckpoint(checkpoint, false))
    return checkpoint
  }

  async update(runId: string, patch: Partial<Omit<AgentRunCheckpoint, 'version' | 'runId' | 'createdAt'>>): Promise<AgentRunCheckpoint> {
    return this.enqueue(async () => {
      const current = await this.readCheckpoint(runId)
      const next = validateCheckpoint({
        ...current,
        ...patch,
        version: 1,
        runId: current.runId,
        createdAt: current.createdAt,
        updatedAt: this.now()
      })
      await this.writeCheckpoint(next, true)
      return next
    })
  }

  async readCheckpoint(runId: string): Promise<AgentRunCheckpoint> {
    assertSafeId(runId, 'runId')
    const path = await this.safeFilePath('runs', `${runId}.json`, false)
    return this.readValidated(path, validateCheckpoint)
  }

  async reconcileInterrupted(): Promise<InterruptedAgentRun[]> {
    return this.enqueue(async () => {
      const directory = await this.safeDirectory('runs', true)
      const names = await readdir(directory).catch(() => [])
      const interrupted: InterruptedAgentRun[] = []
      for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
        const path = await this.safeFilePath('runs', name, false)
        let checkpoint: AgentRunCheckpoint
        try {
          checkpoint = await this.readValidated(path, validateCheckpoint)
        } catch {
          continue
        }
        if (!ACTIVE_STATUSES.has(checkpoint.status)) continue
        const previousStatus = checkpoint.status as InterruptedAgentRun['previousStatus']
        const at = this.now()
        const reviewCount = await this.reconcileOperations(checkpoint.runId)
        checkpoint = {
          ...checkpoint,
          status: 'interrupted',
          previousStatus,
          pendingPermissionId: undefined,
          pendingElicitationId: undefined,
          interruptedAt: at,
          updatedAt: at,
          interruptionReason: '应用在运行完成前退出；旧审批和追问已失效，需要用户明确继续或重新发送。'
        }
        await this.writeCheckpoint(checkpoint, true)
        interrupted.push(toInterruptedRun(checkpoint, reviewCount))
      }
      return interrupted
    })
  }

  async listInterrupted(): Promise<InterruptedAgentRun[]> {
    const directory = await this.safeDirectory('runs', true)
    const names = await readdir(directory).catch(() => [])
    const out: InterruptedAgentRun[] = []
    for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
      const path = await this.safeFilePath('runs', name, false)
      try {
        const checkpoint = await this.readValidated(path, validateCheckpoint)
        if (checkpoint.status !== 'interrupted' || !checkpoint.previousStatus || !checkpoint.interruptedAt) continue
        out.push(toInterruptedRun(checkpoint, await this.countReviewOperations(checkpoint.runId)))
      } catch {
        // Invalid records have already been quarantined and never reach the renderer.
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async startOperation(input: {
    runId: string
    toolCallId: string
    toolName: string
    normalizedTarget?: string
    artifactPointer?: string
  }): Promise<{ action: 'execute' | 'reuse' | 'review'; record: AgentOperationRecord }> {
    assertSafeId(input.runId, 'runId')
    const operationId = agentOperationId(input.runId, input.toolCallId)
    return this.enqueue(async () => {
      const existing = await this.readOperation(input.runId, operationId).catch((error) => {
        if (isNotFound(error)) return null
        throw error
      })
      if (existing?.state === 'completed') {
        if (existing.result === undefined) {
          const record = await this.markOperationNeedsReview(existing)
          return { action: 'review' as const, record }
        }
        return { action: 'reuse' as const, record: { ...existing, disposition: 'idempotent_reuse' } }
      }
      if (existing && (
        existing.state === 'started'
        || existing.state === 'failed'
        || existing.state === 'interrupted'
        || existing.state === 'needs_review'
      )) {
        const record = await this.markOperationNeedsReview(existing)
        return { action: 'review' as const, record }
      }
      const now = this.now()
      const record: AgentOperationRecord = validateOperation({
        version: 1,
        operationId,
        runId: input.runId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        ...(input.normalizedTarget ? { normalizedTarget: safePointer(input.normalizedTarget) } : {}),
        ...(input.artifactPointer ? { artifactPointer: safePointer(input.artifactPointer) } : {}),
        state: 'started',
        disposition: 'first_execution',
        createdAt: now,
        updatedAt: now
      })
      await this.writeOperation(record, false)
      return { action: 'execute' as const, record }
    })
  }

  async completeOperation(record: AgentOperationRecord, result: string): Promise<AgentOperationRecord> {
    return this.enqueue(async () => {
      const now = this.now()
      const compact = Buffer.byteLength(result, 'utf8') <= MAX_RESULT_BYTES ? result : undefined
      const next = validateOperation({
        ...record,
        state: 'completed',
        disposition: 'first_execution',
        resultHash: createHash('sha256').update(result).digest('hex'),
        ...(compact !== undefined ? { result: compact } : {}),
        updatedAt: now,
        completedAt: now
      })
      await this.writeOperation(next, true)
      return next
    })
  }

  async failOperation(record: AgentOperationRecord, error: unknown, interrupted = false): Promise<AgentOperationRecord> {
    return this.enqueue(async () => {
      const next = validateOperation({
        ...record,
        state: interrupted ? 'interrupted' : 'failed',
        error: cleanDiagnostic(error),
        updatedAt: this.now()
      })
      await this.writeOperation(next, true)
      return next
    })
  }

  async flush(): Promise<void> {
    await this.queue
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  private async reconcileOperations(runId: string): Promise<number> {
    const directory = await this.safeDirectory(join('operations', runId), true)
    const names = await readdir(directory).catch(() => [])
    let count = 0
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      const path = await this.safeFilePath(join('operations', runId), name, false)
      try {
        const record = await this.readValidated(path, validateOperation)
        if (record.state !== 'started') continue
        await this.markOperationNeedsReview(record)
        count += 1
      } catch {
        // Quarantined by readValidated.
      }
    }
    return count
  }

  private async countReviewOperations(runId: string): Promise<number> {
    const directory = await this.safeDirectory(join('operations', runId), true)
    const names = await readdir(directory).catch(() => [])
    let count = 0
    for (const name of names.filter((item) => item.endsWith('.json'))) {
      try {
        const record = await this.readOperation(runId, name.slice(0, -5))
        if (record.state === 'needs_review' || record.state === 'interrupted') count += 1
      } catch {
        // Invalid records are excluded.
      }
    }
    return count
  }

  private async markOperationNeedsReview(record: AgentOperationRecord): Promise<AgentOperationRecord> {
    const artifactExists = record.artifactPointer
      ? await containedArtifactExists(this.storageRoot, record.artifactPointer).catch(() => undefined)
      : undefined
    const next = validateOperation({
      ...record,
      state: 'needs_review',
      disposition: 'manual_review',
      ...(artifactExists !== undefined ? { artifactExists } : {}),
      updatedAt: this.now()
    })
    await this.writeOperation(next, true)
    return next
  }

  private async readOperation(runId: string, operationId: string): Promise<AgentOperationRecord> {
    assertSafeId(runId, 'runId')
    assertSafeId(operationId, 'operationId')
    const path = await this.safeFilePath(join('operations', runId), `${operationId}.json`, false)
    return this.readValidated(path, validateOperation)
  }

  private async writeCheckpoint(checkpoint: AgentRunCheckpoint, replace: boolean): Promise<void> {
    const path = await this.safeFilePath('runs', `${checkpoint.runId}.json`, true)
    await atomicPrivateJson(path, validateCheckpoint(checkpoint), replace)
  }

  private async writeOperation(record: AgentOperationRecord, replace: boolean): Promise<void> {
    const path = await this.safeFilePath(join('operations', record.runId), `${record.operationId}.json`, true)
    await atomicPrivateJson(path, validateOperation(record), replace)
  }

  private async readValidated<T>(path: string, validate: (value: unknown) => T): Promise<T> {
    try {
      return validate(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if (isNotFound(error)) throw error
      await quarantine(path, this.now())
      throw new Error(`Agent state record is corrupt or unsupported: ${cleanDiagnostic(error)}`)
    }
  }

  private async safeDirectory(relativeDirectory: string, create: boolean): Promise<string> {
    safePointer(relativeDirectory)
    const root = resolve(this.storageRoot)
    if (create) await mkdir(root, { recursive: true })
    const rootReal = await realpath(root)
    const sessions = join(root, '.agent-sessions')
    const sessionsInfo = await lstat(sessions).catch(() => null)
    if (sessionsInfo?.isSymbolicLink()) {
      const sessionsReal = await realpath(sessions)
      if (!inside(rootReal, sessionsReal)) throw new Error('Agent session directory escapes storage root through a symlink.')
    }
    if (create) await mkdir(join(sessions, relativeDirectory), { recursive: true })
    const directory = join(sessions, relativeDirectory)
    const existingParent = await nearestExisting(directory)
    const parentReal = await realpath(existingParent)
    if (!inside(rootReal, parentReal)) throw new Error('Agent state path escapes storage root.')
    return directory
  }

  private async safeFilePath(relativeDirectory: string, name: string, create: boolean): Promise<string> {
    if (!/^[A-Za-z0-9._:-]+\.json$/.test(name)) throw new Error('Unsafe agent state file name.')
    const directory = await this.safeDirectory(relativeDirectory, create)
    const path = join(directory, name)
    if (!inside(resolve(this.storageRoot), resolve(path))) throw new Error('Agent state path escapes storage root.')
    return path
  }
}

function validateCheckpoint(value: unknown): AgentRunCheckpoint {
  const record = strictRecord(value, [
    'version', 'runId', 'streamId', 'workspaceId', 'conversationId', 'status', 'previousStatus',
    'lastDurableSequence', 'createdAt', 'updatedAt', 'completedAt', 'interruptedAt', 'transcriptPointer',
    'operationJournalPointer', 'pendingPermissionId', 'pendingElicitationId', 'budget', 'usage', 'stopReason',
    'interruptionReason'
  ])
  if (record.version !== 1) throw new Error('Unsupported checkpoint version.')
  const status = stringEnum(record.status, ['running', 'waiting_for_permission', 'waiting_for_elicitation', 'completed', 'failed', 'canceled', 'interrupted'] as const)
  const checkpoint: AgentRunCheckpoint = {
    version: 1,
    runId: safeIdValue(record.runId, 'runId'),
    streamId: safeIdValue(record.streamId, 'streamId'),
    ...(optionalSafeId(record.workspaceId, 'workspaceId') ? { workspaceId: optionalSafeId(record.workspaceId, 'workspaceId') } : {}),
    ...(optionalSafeId(record.conversationId, 'conversationId') ? { conversationId: optionalSafeId(record.conversationId, 'conversationId') } : {}),
    status,
    ...(record.previousStatus !== undefined ? { previousStatus: stringEnum(record.previousStatus, ['running', 'waiting_for_permission', 'waiting_for_elicitation'] as const) } : {}),
    lastDurableSequence: nonNegativeInteger(record.lastDurableSequence),
    createdAt: isoString(record.createdAt),
    updatedAt: isoString(record.updatedAt),
    ...(record.completedAt !== undefined ? { completedAt: isoString(record.completedAt) } : {}),
    ...(record.interruptedAt !== undefined ? { interruptedAt: isoString(record.interruptedAt) } : {}),
    ...(record.transcriptPointer !== undefined ? { transcriptPointer: safePointerValue(record.transcriptPointer) } : {}),
    operationJournalPointer: safePointerValue(record.operationJournalPointer),
    ...(record.pendingPermissionId !== undefined ? { pendingPermissionId: safeIdValue(record.pendingPermissionId, 'pendingPermissionId') } : {}),
    ...(record.pendingElicitationId !== undefined ? { pendingElicitationId: safeIdValue(record.pendingElicitationId, 'pendingElicitationId') } : {}),
    budget: validateBudget(record.budget),
    usage: validateUsage(record.usage),
    ...(record.stopReason !== undefined ? { stopReason: shortText(record.stopReason) } : {}),
    ...(record.interruptionReason !== undefined ? { interruptionReason: shortText(record.interruptionReason) } : {})
  }
  return checkpoint
}

function validateOperation(value: unknown): AgentOperationRecord {
  const record = strictRecord(value, [
    'version', 'operationId', 'runId', 'toolCallId', 'toolName', 'normalizedTarget', 'state', 'resultHash',
    'result', 'artifactPointer', 'artifactExists', 'disposition', 'createdAt', 'updatedAt', 'completedAt', 'error'
  ])
  if (record.version !== 1) throw new Error('Unsupported operation version.')
  return {
    version: 1,
    operationId: safeIdValue(record.operationId, 'operationId'),
    runId: safeIdValue(record.runId, 'runId'),
    toolCallId: shortText(record.toolCallId),
    toolName: safeIdValue(record.toolName, 'toolName'),
    ...(record.normalizedTarget !== undefined ? { normalizedTarget: safePointerValue(record.normalizedTarget) } : {}),
    state: stringEnum(record.state, ['started', 'completed', 'failed', 'interrupted', 'needs_review'] as const),
    ...(record.resultHash !== undefined ? { resultHash: hashValue(record.resultHash) } : {}),
    ...(record.result !== undefined ? { result: limitedString(record.result, MAX_RESULT_BYTES) } : {}),
    ...(record.artifactPointer !== undefined ? { artifactPointer: safePointerValue(record.artifactPointer) } : {}),
    ...(typeof record.artifactExists === 'boolean' ? { artifactExists: record.artifactExists } : {}),
    disposition: stringEnum(record.disposition, ['first_execution', 'idempotent_reuse', 'manual_review'] as const),
    createdAt: isoString(record.createdAt),
    updatedAt: isoString(record.updatedAt),
    ...(record.completedAt !== undefined ? { completedAt: isoString(record.completedAt) } : {}),
    ...(record.error !== undefined ? { error: shortText(record.error) } : {})
  }
}

function validateBudget(value: unknown): AgentRunBudget {
  const record = strictRecord(value, ['maxDurationMs', 'maxProviderCalls', 'maxToolCalls', 'maxTotalTokens', 'warningThreshold'])
  return {
    maxDurationMs: integerInRange(record.maxDurationMs, 5_000, 30 * 60_000),
    maxProviderCalls: integerInRange(record.maxProviderCalls, 1, 100),
    maxToolCalls: integerInRange(record.maxToolCalls, 1, 500),
    maxTotalTokens: integerInRange(record.maxTotalTokens, 1_000, 2_000_000),
    warningThreshold: numberInRange(record.warningThreshold, 0.5, 0.95)
  }
}

function validateUsage(value: unknown): AgentRunUsageAggregate {
  const record = strictRecord(value, [
    'providerCalls', 'toolCalls', 'toolErrors', 'iterations', 'childRuns', 'durationMs',
    'promptTokens', 'completionTokens', 'totalTokens', 'budgetStopReason'
  ])
  return {
    providerCalls: nonNegativeInteger(record.providerCalls),
    toolCalls: nonNegativeInteger(record.toolCalls),
    toolErrors: nonNegativeInteger(record.toolErrors),
    iterations: nonNegativeInteger(record.iterations),
    childRuns: nonNegativeInteger(record.childRuns),
    durationMs: nonNegativeInteger(record.durationMs),
    ...(record.promptTokens !== undefined ? { promptTokens: nonNegativeInteger(record.promptTokens) } : {}),
    ...(record.completionTokens !== undefined ? { completionTokens: nonNegativeInteger(record.completionTokens) } : {}),
    ...(record.totalTokens !== undefined ? { totalTokens: nonNegativeInteger(record.totalTokens) } : {}),
    ...(record.budgetStopReason !== undefined ? { budgetStopReason: stringEnum(record.budgetStopReason, ['duration', 'provider_calls', 'tool_calls', 'total_tokens'] as const) } : {})
  }
}

function toInterruptedRun(checkpoint: AgentRunCheckpoint, operationReviewCount: number): InterruptedAgentRun {
  if (!checkpoint.previousStatus || !checkpoint.interruptedAt) throw new Error('Interrupted checkpoint is incomplete.')
  return {
    runId: checkpoint.runId,
    streamId: checkpoint.streamId,
    ...(checkpoint.workspaceId ? { workspaceId: checkpoint.workspaceId } : {}),
    ...(checkpoint.conversationId ? { conversationId: checkpoint.conversationId } : {}),
    status: 'interrupted',
    previousStatus: checkpoint.previousStatus,
    lastDurableSequence: checkpoint.lastDurableSequence,
    updatedAt: checkpoint.updatedAt,
    interruptedAt: checkpoint.interruptedAt,
    reason: checkpoint.interruptionReason ?? '上次运行被中断。',
    operationReviewCount,
    usage: checkpoint.usage
  }
}

async function atomicPrivateJson(path: string, value: unknown, replace: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  if (!replace && await stat(path).then(() => true).catch(() => false)) {
    throw new Error('Agent state record already exists.')
  }
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await chmod(temporary, 0o600)
  await rename(temporary, path)
  await chmod(path, 0o600)
}

async function quarantine(path: string, now: string): Promise<void> {
  const suffix = now.replace(/[^0-9]/g, '').slice(0, 17) || String(Date.now())
  await rename(path, `${path}.corrupt-${suffix}`).catch(() => undefined)
}

async function nearestExisting(path: string): Promise<string> {
  let current = resolve(path)
  while (true) {
    if (await lstat(current).then(() => true).catch(() => false)) return current
    const parent = dirname(current)
    if (parent === current) throw new Error('No existing parent for agent state path.')
    current = parent
  }
}

async function containedArtifactExists(storageRoot: string, pointer: string): Promise<boolean> {
  const root = resolve(storageRoot)
  const rootReal = await realpath(root)
  const target = resolve(root, safePointer(pointer))
  if (!inside(root, target)) throw new Error('Artifact pointer escapes storage root.')
  const existing = await nearestExisting(target)
  const existingReal = await realpath(existing)
  if (!inside(rootReal, existingReal)) throw new Error('Artifact pointer escapes storage root through a symlink.')
  return stat(target).then(() => true).catch((error) => {
    if (isNotFound(error)) return false
    throw error
  })
}

function strictRecord(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.')
  const record = value as Record<string, unknown>
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) throw new Error(`Unknown field: ${key}`)
  }
  return record
}

function safePointer(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (!normalized || isAbsolute(normalized) || normalized.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('Unsafe persisted pointer.')
  }
  return normalized
}

function safePointerValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Persisted pointer must be a string.')
  return safePointer(value)
}

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Invalid ${label}.`)
}

function safeIdValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  assertSafeId(value, label)
  return value
}

function optionalSafeId(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : safeIdValue(value, label)
}

function stringEnum<const T extends readonly string[]>(value: unknown, values: T): T[number] {
  if (typeof value === 'string' && values.includes(value)) return value as T[number]
  throw new Error('Invalid enum value.')
}

function isoString(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp.')
  return value
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error('Expected a non-negative integer.')
  return value
}

function integerInRange(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer between ${min} and ${max}.`)
  }
  return value
}

function numberInRange(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Expected a number between ${min} and ${max}.`)
  }
  return value
}

function shortText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) throw new Error('Invalid short text.')
  return value
}

function limitedString(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error('String exceeds storage limit.')
  return value
}

function hashValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid hash.')
  return value
}

function cleanDiagnostic(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/\b(?:authorization|proxy-authorization)\s*[:=]\s*[^\r\n]*/gi, '[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:api[-_ ]?key|token|secret|password|proxy)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .slice(0, 1000)
}

function inside(root: string, target: string): boolean {
  const relation = relative(resolve(root), resolve(target))
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation))
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.floor(value)))
    : fallback
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
