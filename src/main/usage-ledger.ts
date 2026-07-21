/**
 * Append-only usage / observability ledger.
 *
 * Canonical: durable JSONL under app-data (and optional workspace .studiumx).
 * SQLite rows are disposable projections only. Never stores secrets, prompts,
 * tool arguments, or raw provider payloads.
 */

import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'

import { appendDurableJsonlLine, readDurableJsonlSources } from './durable-jsonl'
import { annotationsForEffectClass } from './ai/tools/annotations'
import { classifyToolEffect } from './ai/tools/effect-policy'
import type { AgentRunUsageAggregate } from '../shared/teaching-types'

export const USAGE_LEDGER_APP_RELATIVE_PATH = 'usage/usage.jsonl'
export const USAGE_LEDGER_WORKSPACE_RELATIVE_PATH = '.studiumx/usage.jsonl'

export type UsageLedgerKind = 'model_usage' | 'tool_usage' | 'turn_usage'

export type UsageApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'allowed'
  | 'denied'
  | 'unknown'

export type UsageLedgerStatus =
  | 'started'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'unknown'

/**
 * Stable error classification labels for observability (not raw exception messages).
 * Keep short and secret-free.
 */
export type UsageErrorType =
  | 'provider_error'
  | 'timeout'
  | 'canceled'
  | 'tool_error'
  | 'rate_limit'
  | 'auth_error'
  | 'validation_error'
  | 'unknown'

/**
 * Minimal secret-free usage row. Field names stay stable for JSONL + projection.
 * Opaque correlation ids only — no titles, prompts, or args.
 */
export type UsageLedgerEntry = {
  version: 1
  entryId: string
  kind: UsageLedgerKind
  timestamp: string
  provider?: string
  model?: string
  status?: UsageLedgerStatus
  startedAt?: string
  completedAt?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheTokens?: number
  toolName?: string
  readOnly?: boolean
  destructive?: boolean
  approvalStatus?: UsageApprovalStatus
  /** Opaque correlation only. */
  traceId?: string
  turnId?: string
  conversationId?: string
  /** Time-to-first-token in milliseconds (model streaming latency). */
  ttftMs?: number
  /** Provider / tool retry count for this observation (non-negative). */
  retryCount?: number
  /** Whether the response or tool result was truncated by budget. */
  truncated?: boolean
  /** Stable error class — never a raw exception stack or secret-bearing message. */
  errorType?: UsageErrorType
}

export type UsageLedgerWriteInput = {
  appDataRoot: string
  /** When set, also append under workspace policy path (best-effort). */
  workspaceRoot?: string
  entry: Omit<UsageLedgerEntry, 'version' | 'entryId' | 'timestamp'> & {
    entryId?: string
    timestamp?: string
  }
  now?: () => Date
}

export type UsageLedgerReadResult = {
  path: string
  fingerprint: string
  lines: string[]
  entries: UsageLedgerEntry[]
  invalid: number
}

const ALLOWED_KEYS = new Set([
  'version',
  'entryId',
  'kind',
  'timestamp',
  'provider',
  'model',
  'status',
  'startedAt',
  'completedAt',
  'durationMs',
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheTokens',
  'toolName',
  'readOnly',
  'destructive',
  'approvalStatus',
  'traceId',
  'turnId',
  'conversationId',
  'ttftMs',
  'retryCount',
  'truncated',
  'errorType'
])

const pendingAppends = new Map<string, Promise<void>>()

export function usageLedgerActivePath(appDataRoot: string): string {
  return join(appDataRoot, USAGE_LEDGER_APP_RELATIVE_PATH)
}

export function usageLedgerWorkspacePath(workspaceRoot: string): string {
  return join(workspaceRoot, USAGE_LEDGER_WORKSPACE_RELATIVE_PATH)
}

/**
 * Builds a validated, redacted usage ledger entry. Rejects unknown keys and
 * any field that looks like prompt/secret payload material.
 */
export function buildUsageLedgerEntry(
  input: UsageLedgerWriteInput['entry'],
  now: () => Date = () => new Date()
): UsageLedgerEntry {
  const timestamp = instant(input.timestamp) ?? now().toISOString()
  const entry: UsageLedgerEntry = {
    version: 1,
    entryId: safeId(input.entryId) ?? randomUUID(),
    kind: normalizeKind(input.kind),
    timestamp
  }

  const provider = safeLabel(input.provider)
  const model = safeLabel(input.model)
  const status = normalizeStatus(input.status)
  const startedAt = instant(input.startedAt)
  const completedAt = instant(input.completedAt)
  const durationMs = nonNegInt(input.durationMs)
  const inputTokens = nonNegInt(input.inputTokens)
  const outputTokens = nonNegInt(input.outputTokens)
  const reasoningTokens = nonNegInt(input.reasoningTokens)
  const cacheTokens = nonNegInt(input.cacheTokens)
  const toolName = safeLabel(input.toolName)
  const approvalStatus = normalizeApproval(input.approvalStatus)
  const traceId = safeId(input.traceId)
  const turnId = safeId(input.turnId)
  const conversationId = safeId(input.conversationId)
  const ttftMs = nonNegInt(input.ttftMs)
  const retryCount = nonNegInt(input.retryCount)
  const errorType = normalizeErrorType(input.errorType)

  if (provider) entry.provider = provider
  if (model) entry.model = model
  if (status) entry.status = status
  if (startedAt) entry.startedAt = startedAt
  if (completedAt) entry.completedAt = completedAt
  if (durationMs !== undefined) entry.durationMs = durationMs
  if (inputTokens !== undefined) entry.inputTokens = inputTokens
  if (outputTokens !== undefined) entry.outputTokens = outputTokens
  if (reasoningTokens !== undefined) entry.reasoningTokens = reasoningTokens
  if (cacheTokens !== undefined) entry.cacheTokens = cacheTokens
  if (toolName) entry.toolName = toolName
  if (typeof input.readOnly === 'boolean') entry.readOnly = input.readOnly
  if (typeof input.destructive === 'boolean') entry.destructive = input.destructive
  if (approvalStatus) entry.approvalStatus = approvalStatus
  if (traceId) entry.traceId = traceId
  if (turnId) entry.turnId = turnId
  if (conversationId) entry.conversationId = conversationId
  if (ttftMs !== undefined) entry.ttftMs = ttftMs
  if (retryCount !== undefined) entry.retryCount = retryCount
  if (typeof input.truncated === 'boolean') entry.truncated = input.truncated
  if (errorType) entry.errorType = errorType

  assertNoSecrets(entry)
  return entry
}

/**
 * Appends one usage row. Failures are swallowed by recordUsageBestEffort; this
 * function itself may throw for callers that want strict diagnostics in tests.
 */
export async function appendUsageLedgerEntry(input: UsageLedgerWriteInput): Promise<UsageLedgerEntry> {
  const entry = buildUsageLedgerEntry(input.entry, input.now)
  const line = serializeUsageLedgerEntry(entry)
  const targets = [usageLedgerActivePath(input.appDataRoot)]
  if (input.workspaceRoot) targets.push(usageLedgerWorkspacePath(input.workspaceRoot))
  for (const activePath of targets) {
    await appendOnce(activePath, line)
  }
  return entry
}

/**
 * Best-effort observability write. Never rejects — projection/ledger faults
 * must not fail the agent turn success path.
 */
export async function recordUsageBestEffort(input: UsageLedgerWriteInput): Promise<UsageLedgerEntry | null> {
  try {
    return await appendUsageLedgerEntry(input)
  } catch {
    return null
  }
}

/** Strict parse of one JSONL line; returns null for invalid / secret-bearing rows. */
export function parseUsageLedgerLine(line: string): UsageLedgerEntry | null {
  try {
    const value = JSON.parse(line) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      if (!ALLOWED_KEYS.has(key)) return null
    }
    if (record.version !== 1) return null
    const kind = normalizeKind(record.kind)
    const entryId = safeId(record.entryId)
    const timestamp = instant(record.timestamp)
    if (!entryId || !timestamp) return null
    const built = buildUsageLedgerEntry({
      entryId,
      kind,
      timestamp,
      provider: text(record.provider),
      model: text(record.model),
      status: text(record.status) as UsageLedgerStatus | undefined,
      startedAt: text(record.startedAt),
      completedAt: text(record.completedAt),
      durationMs: nonNegInt(record.durationMs),
      inputTokens: nonNegInt(record.inputTokens),
      outputTokens: nonNegInt(record.outputTokens),
      reasoningTokens: nonNegInt(record.reasoningTokens),
      cacheTokens: nonNegInt(record.cacheTokens),
      toolName: text(record.toolName),
      readOnly: typeof record.readOnly === 'boolean' ? record.readOnly : undefined,
      destructive: typeof record.destructive === 'boolean' ? record.destructive : undefined,
      approvalStatus: text(record.approvalStatus) as UsageApprovalStatus | undefined,
      traceId: text(record.traceId),
      turnId: text(record.turnId),
      conversationId: text(record.conversationId),
      ttftMs: nonNegInt(record.ttftMs),
      retryCount: nonNegInt(record.retryCount),
      truncated: typeof record.truncated === 'boolean' ? record.truncated : undefined,
      errorType: text(record.errorType) as UsageErrorType | undefined
    })
    assertNoSecrets(built)
    return built
  } catch {
    return null
  }
}

export function serializeUsageLedgerEntry(entry: UsageLedgerEntry): string {
  assertNoSecrets(entry)
  return JSON.stringify(entry)
}

/** Reads durable segments for one active usage ledger path. */
export async function readUsageLedgerSources(activePath: string): Promise<UsageLedgerReadResult[]> {
  const sources = await readDurableJsonlSources(activePath)
  return sources.map((source) => {
    let invalid = 0
    const entries: UsageLedgerEntry[] = []
    for (const line of source.lines) {
      const entry = parseUsageLedgerLine(line)
      if (!entry) {
        invalid += 1
        continue
      }
      entries.push(entry)
    }
    return {
      path: source.path,
      fingerprint: createHash('sha256').update(source.bytes).digest('hex'),
      lines: source.lines,
      entries,
      invalid
    }
  })
}

export type TurnUsageObservation = {
  appDataRoot: string
  workspaceRoot?: string
  provider?: string
  model?: string
  conversationId?: string
  traceId?: string
  turnId?: string
  startedAt?: string
  completedAt?: string
  status: UsageLedgerStatus
  usage?: AgentRunUsageAggregate
  tools?: Array<{
    toolName: string
    approvalStatus?: UsageApprovalStatus
    isError?: boolean
  }>
  now?: () => Date
}

/**
 * Records a minimal turn-level usage row plus optional per-tool rows.
 * Safe for the turn success path: all I/O is best-effort.
 */
export async function recordTurnUsageObservation(input: TurnUsageObservation): Promise<void> {
  const now = input.now ?? (() => new Date())
  const completedAt = instant(input.completedAt) ?? now().toISOString()
  const startedAt = instant(input.startedAt)
  const durationMs =
    input.usage?.durationMs !== undefined
      ? nonNegInt(input.usage.durationMs)
      : startedAt
        ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
        : undefined

  await recordUsageBestEffort({
    appDataRoot: input.appDataRoot,
    workspaceRoot: input.workspaceRoot,
    now,
    entry: {
      kind: 'turn_usage',
      provider: input.provider,
      model: input.model,
      status: input.status,
      startedAt: startedAt ?? undefined,
      completedAt,
      durationMs,
      inputTokens: input.usage?.promptTokens,
      outputTokens: input.usage?.completionTokens,
      conversationId: input.conversationId,
      traceId: input.traceId,
      turnId: input.turnId
    }
  })

  if (input.provider || input.model || input.usage?.providerCalls) {
    await recordUsageBestEffort({
      appDataRoot: input.appDataRoot,
      workspaceRoot: input.workspaceRoot,
      now,
      entry: {
        kind: 'model_usage',
        provider: input.provider,
        model: input.model,
        status: input.status,
        startedAt: startedAt ?? undefined,
        completedAt,
        durationMs,
        inputTokens: input.usage?.promptTokens,
        outputTokens: input.usage?.completionTokens,
        conversationId: input.conversationId,
        traceId: input.traceId,
        turnId: input.turnId
      }
    })
  }

  for (const tool of input.tools ?? []) {
    const name = safeLabel(tool.toolName)
    if (!name) continue
    const effect = classifyToolEffect(name)
    const annotations = annotationsForEffectClass(effect)
    await recordUsageBestEffort({
      appDataRoot: input.appDataRoot,
      workspaceRoot: input.workspaceRoot,
      now,
      entry: {
        kind: 'tool_usage',
        toolName: name,
        readOnly: annotations.readOnlyHint,
        destructive: annotations.destructiveHint,
        approvalStatus: tool.approvalStatus ?? 'not_required',
        status: tool.isError ? 'failed' : 'completed',
        completedAt,
        conversationId: input.conversationId,
        traceId: input.traceId,
        turnId: input.turnId
      }
    })
  }
}

/** Aggregate-only analytics view — no raw JSONL / payload exposure. */
export type UsageAnalyticsSummary = {
  entryCount: number
  modelUsageCount: number
  toolUsageCount: number
  turnUsageCount: number
  totalInputTokens: number
  totalOutputTokens: number
  totalReasoningTokens: number
  totalCacheTokens: number
  totalDurationMs: number
  byProvider: Array<{ provider: string; count: number; inputTokens: number; outputTokens: number }>
  byTool: Array<{ toolName: string; count: number; readOnly: number; destructive: number }>
}

export function summarizeUsageEntries(entries: readonly UsageLedgerEntry[]): UsageAnalyticsSummary {
  const byProvider = new Map<string, { count: number; inputTokens: number; outputTokens: number }>()
  const byTool = new Map<string, { count: number; readOnly: number; destructive: number }>()
  let modelUsageCount = 0
  let toolUsageCount = 0
  let turnUsageCount = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalReasoningTokens = 0
  let totalCacheTokens = 0
  let totalDurationMs = 0

  for (const entry of entries) {
    if (entry.kind === 'model_usage') modelUsageCount += 1
    if (entry.kind === 'tool_usage') toolUsageCount += 1
    if (entry.kind === 'turn_usage') turnUsageCount += 1
    totalInputTokens += entry.inputTokens ?? 0
    totalOutputTokens += entry.outputTokens ?? 0
    totalReasoningTokens += entry.reasoningTokens ?? 0
    totalCacheTokens += entry.cacheTokens ?? 0
    totalDurationMs += entry.durationMs ?? 0

    if (entry.provider) {
      const bucket = byProvider.get(entry.provider) ?? { count: 0, inputTokens: 0, outputTokens: 0 }
      bucket.count += 1
      bucket.inputTokens += entry.inputTokens ?? 0
      bucket.outputTokens += entry.outputTokens ?? 0
      byProvider.set(entry.provider, bucket)
    }
    if (entry.toolName) {
      const bucket = byTool.get(entry.toolName) ?? { count: 0, readOnly: 0, destructive: 0 }
      bucket.count += 1
      if (entry.readOnly) bucket.readOnly += 1
      if (entry.destructive) bucket.destructive += 1
      byTool.set(entry.toolName, bucket)
    }
  }

  return {
    entryCount: entries.length,
    modelUsageCount,
    toolUsageCount,
    turnUsageCount,
    totalInputTokens,
    totalOutputTokens,
    totalReasoningTokens,
    totalCacheTokens,
    totalDurationMs,
    byProvider: [...byProvider.entries()]
      .map(([provider, value]) => ({ provider, ...value }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
    byTool: [...byTool.entries()]
      .map(([toolName, value]) => ({ toolName, ...value }))
      .sort((a, b) => a.toolName.localeCompare(b.toolName))
  }
}

async function appendOnce(activePath: string, line: string): Promise<void> {
  const previous = pendingAppends.get(activePath) ?? Promise.resolve()
  const append = previous.catch(() => undefined).then(async () => {
    await appendDurableJsonlLine({ activePath }, line)
  })
  pendingAppends.set(activePath, append)
  try {
    await append
  } finally {
    if (pendingAppends.get(activePath) === append) pendingAppends.delete(activePath)
  }
}

function assertNoSecrets(entry: UsageLedgerEntry): void {
  for (const [key, value] of Object.entries(entry)) {
    if (!ALLOWED_KEYS.has(key)) throw new Error(`Usage ledger rejects unknown field: ${key}`)
    if (typeof value === 'string' && looksLikeSecret(value)) {
      throw new Error(`Usage ledger rejects secret-like value for ${key}`)
    }
  }
}

function looksLikeSecret(value: string): boolean {
  if (value.length > 256) return true
  if (/sk-[A-Za-z0-9]{16,}/.test(value)) return true
  if (/Bearer\s+[A-Za-z0-9._\-]{16,}/i.test(value)) return true
  if (/api[_-]?key\s*[:=]/i.test(value)) return true
  if ((value.includes('\n') || value.includes('\r')) && value.length > 80) return true
  return false
}

function normalizeKind(value: unknown): UsageLedgerKind {
  if (value === 'model_usage' || value === 'tool_usage' || value === 'turn_usage') return value
  throw new Error(`Unsupported usage ledger kind: ${String(value)}`)
}

function normalizeStatus(value: unknown): UsageLedgerStatus | undefined {
  if (
    value === 'started' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'canceled' ||
    value === 'unknown'
  ) return value
  return undefined
}

function normalizeApproval(value: unknown): UsageApprovalStatus | undefined {
  if (
    value === 'not_required' ||
    value === 'pending' ||
    value === 'allowed' ||
    value === 'denied' ||
    value === 'unknown'
  ) return value
  return undefined
}

function normalizeErrorType(value: unknown): UsageErrorType | undefined {
  if (
    value === 'provider_error' ||
    value === 'timeout' ||
    value === 'canceled' ||
    value === 'tool_error' ||
    value === 'rate_limit' ||
    value === 'auth_error' ||
    value === 'validation_error' ||
    value === 'unknown'
  ) return value
  return undefined
}

function safeLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 120) return undefined
  if (looksLikeSecret(trimmed)) return undefined
  if (/[\r\n\t]/.test(trimmed)) return undefined
  return trimmed
}

function safeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 128) return undefined
  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) return undefined
  return trimmed
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function nonNegInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
