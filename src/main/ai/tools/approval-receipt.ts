/**
 * Durable append-only approval receipts for forced human approvals.
 *
 * File-truth (JSONL) is canonical; SQLite projection is optional and out of
 * scope for DB-P0-4. Receipts are audit evidence only — they are never
 * reusable authorization tokens (one-shot semantics, ADR-0005 / ADR-0007).
 *
 * Covered actions:
 * - Synthetic teaching memory remember / forget (always human-approved)
 * - High-risk workspace_write approvals that actually prompt a human
 */
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'

import { appendDurableJsonlLine, readDurableJsonlLines } from '../../durable-jsonl'
import { classifyToolEffect } from './effect-policy'
import type { ToolEffectClass } from './tool-outcome'
import type { ToolPermissionDecision, ToolPermissionRequest } from './registry'

export const APPROVAL_RECEIPT_SCHEMA_VERSION = 1 as const
export const APPROVAL_RECEIPT_KIND = 'approval_receipt' as const
/** Workspace-local append-only ledger (canonical file truth). */
export const APPROVAL_RECEIPT_LEDGER_RELATIVE_PATH = '.studiumx/approval-receipts.jsonl'

/** Decisions recorded after an interactive human approval prompt. */
export type ApprovalReceiptDecision =
  | 'allow_once'
  | 'allow_for_run'
  | 'allow_for_directory'
  | 'deny'

/**
 * Append-only receipt line. Intentionally omits full tool args and any field
 * that could be replayed as an authorization grant.
 */
export type ApprovalReceiptV1 = Readonly<{
  schemaVersion: typeof APPROVAL_RECEIPT_SCHEMA_VERSION
  kind: typeof APPROVAL_RECEIPT_KIND
  /** Opaque unique id for this one-shot receipt (not an auth token). */
  receiptId: string
  decision: ApprovalReceiptDecision
  tool: string
  effect: ToolEffectClass
  /** Correlation id (run / stream / tool-call). Opaque, not an auth grant. */
  trace_id: string
  timestamp: string
  /** SHA-256 hex of redacted args shape; never full sensitive args. */
  argsDigest: string
  /** Always false — receipts must never be treated as reusable authorization. */
  reusableAuthorization: false
  /** Always true — one decision, one receipt, no replay as a grant. */
  oneShot: true
  toolCallId?: string
  operation?: string
  /** Redacted target pointer (path truncated / scheme only); never secret payloads. */
  targetHint?: string
}>

export type ApprovalReceipt = ApprovalReceiptV1

export type AppendApprovalReceiptInput = Readonly<{
  /** Workspace or app-data root that contains `.studiumx/`. */
  rootPath: string
  decision: ApprovalReceiptDecision
  tool: string
  effect?: ToolEffectClass
  traceId: string
  args?: unknown
  toolCallId?: string
  operation?: string
  targetPath?: string
  nowIso?: () => string
  receiptId?: string
}>

export type RecordForcedHumanApprovalInput = Readonly<{
  rootPath?: string | null
  request: ToolPermissionRequest
  decision: ToolPermissionDecision
  args?: unknown
  traceId?: string
  toolCallId?: string
  nowIso?: () => string
}>

const SENSITIVE_KEY_PATTERN =
  /^(?:.*(?:password|passwd|secret|token|api[_-]?key|authorization|credential|cookie|session).*$|content|body|prompt|messages|transcript|raw|reasoning|answer|learneranswer|assessment|providerpayload|text)$/i

const MAX_HINT = 80
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

const DECISIONS = new Set<ApprovalReceiptDecision>([
  'allow_once',
  'allow_for_run',
  'allow_for_directory',
  'deny'
])

/**
 * Tools that always force interactive human approval and therefore always
 * produce a durable receipt when a human decides.
 */
export const FORCED_HUMAN_APPROVAL_TOOLS = new Set([
  'remember_teaching_memory',
  'forget_teaching_memory'
])

/** True when the tool is synthetic-memory remember/forget. */
export function isForcedHumanMemoryApprovalTool(toolName: string): boolean {
  return FORCED_HUMAN_APPROVAL_TOOLS.has(toolName.trim())
}

/**
 * High-risk for receipt purposes: forced memory mutations, workspace_write,
 * external_write, and privileged effect classes. Read tools never emit receipts.
 */
export function isHighRiskApprovalTool(toolName: string): boolean {
  const name = toolName.trim()
  if (!name) return false
  if (isForcedHumanMemoryApprovalTool(name)) return true
  const effect = classifyToolEffect(name)
  return effect === 'workspace_write' || effect === 'external_write' || effect === 'privileged'
}

/** Whether a human interactive decision should produce a durable receipt. */
export function shouldRecordForcedHumanApproval(request: ToolPermissionRequest): boolean {
  if (request.kind !== 'workspace_write') return false
  return isHighRiskApprovalTool(request.toolName)
}

export function approvalReceiptLedgerPath(rootPath: string): string {
  return join(resolve(rootPath), APPROVAL_RECEIPT_LEDGER_RELATIVE_PATH)
}

/**
 * Build a stable SHA-256 digest over a redacted args projection.
 * Sensitive values are replaced with type/length digests — never full args.
 */
export function buildRedactedArgsDigest(args: unknown): string {
  const redacted = redactArgsForDigest(args)
  return createHash('sha256').update(stableCanonicalJson(redacted), 'utf8').digest('hex')
}

/** Redact args to a digest-safe structure (pure; no I/O). */
export function redactArgsForDigest(args: unknown): unknown {
  return redactValue(args, 0)
}

/**
 * Receipts are audit evidence only. This always returns false so callers cannot
 * treat a receipt (or receipt id) as a reusable authorization token.
 */
export function isApprovalReceiptReusableAuthorization(
  _receipt: ApprovalReceipt | { receiptId?: string; reusableAuthorization?: unknown } | null | undefined
): false {
  return false
}

/**
 * Fail closed if any caller attempts to use a receipt as an authorization grant.
 * Production permission gates must never call this with an "allow" path.
 */
export function assertApprovalReceiptNotAuthorizationToken(
  receipt: ApprovalReceipt | { receiptId?: string; reusableAuthorization?: unknown } | null | undefined
): void {
  if (isApprovalReceiptReusableAuthorization(receipt) !== false) {
    throw new Error('Approval receipts must never be reusable authorization tokens.')
  }
  if (receipt && typeof receipt === 'object' && (receipt as { reusableAuthorization?: unknown }).reusableAuthorization === true) {
    throw new Error('Approval receipt reusableAuthorization must remain false.')
  }
}

/** Normalize interactive decision vocabulary onto receipt decision enum. */
export function normalizeApprovalReceiptDecision(
  decision: ToolPermissionDecision['decision'] | string
): ApprovalReceiptDecision {
  switch (decision) {
    case 'allow':
    case 'allow_once':
      return 'allow_once'
    case 'allow_for_run':
      return 'allow_for_run'
    case 'allow_for_directory':
      return 'allow_for_directory'
    case 'deny':
    default:
      return 'deny'
  }
}

/**
 * Append one durable approval receipt line. Returns the written receipt.
 * Uses fsync-backed durable JSONL; never rewrites prior lines.
 */
export async function appendApprovalReceipt(input: AppendApprovalReceiptInput): Promise<ApprovalReceipt> {
  const rootPath = resolve(input.rootPath)
  const tool = input.tool.trim()
  if (!tool) throw new Error('Approval receipt requires a tool name.')
  const traceId = normalizeTraceId(input.traceId)
  if (!traceId) throw new Error('Approval receipt requires a trace_id.')
  if (!DECISIONS.has(input.decision)) {
    throw new Error(`Unsupported approval receipt decision: ${String(input.decision)}`)
  }

  const receipt: ApprovalReceipt = {
    schemaVersion: APPROVAL_RECEIPT_SCHEMA_VERSION,
    kind: APPROVAL_RECEIPT_KIND,
    receiptId: input.receiptId?.trim() || randomUUID(),
    decision: input.decision,
    tool,
    effect: input.effect ?? classifyToolEffect(tool),
    trace_id: traceId,
    timestamp: (input.nowIso ?? (() => new Date().toISOString()))(),
    argsDigest: buildRedactedArgsDigest(input.args),
    reusableAuthorization: false,
    oneShot: true,
    ...(input.toolCallId?.trim() ? { toolCallId: input.toolCallId.trim().slice(0, 128) } : {}),
    ...(input.operation?.trim() ? { operation: input.operation.trim().slice(0, 128) } : {}),
    ...(input.targetPath?.trim() ? { targetHint: redactTargetHint(input.targetPath) } : {})
  }

  assertApprovalReceiptNotAuthorizationToken(receipt)

  const activePath = approvalReceiptLedgerPath(rootPath)
  await appendDurableJsonlLine({ activePath }, JSON.stringify(receipt))
  return receipt
}

/**
 * Record a forced human approval when the interactive gate actually decides.
 * No-op (returns null) when root is missing or the request is not high-risk.
 * Never grants permission from an existing receipt.
 */
export async function recordForcedHumanApprovalReceipt(
  input: RecordForcedHumanApprovalInput
): Promise<ApprovalReceipt | null> {
  const rootPath = input.rootPath?.trim()
  if (!rootPath) return null
  if (!shouldRecordForcedHumanApproval(input.request)) return null

  const decision = normalizeApprovalReceiptDecision(input.decision.decision)
  const traceId =
    normalizeTraceId(input.traceId) ??
    normalizeTraceId(input.toolCallId) ??
    normalizeTraceId(input.request.id)
  if (!traceId) return null

  return appendApprovalReceipt({
    rootPath,
    decision,
    tool: input.request.toolName,
    effect: classifyToolEffect(input.request.toolName),
    traceId,
    args: input.args,
    toolCallId: input.toolCallId ?? input.request.id,
    operation: input.request.operation,
    targetPath: input.request.targetPath,
    nowIso: input.nowIso
  })
}

/** Read all receipt lines from the workspace/app-data ledger (sealed + active). */
export async function readApprovalReceipts(rootPath: string): Promise<ApprovalReceipt[]> {
  const lines = await readDurableJsonlLines(approvalReceiptLedgerPath(rootPath))
  const receipts: ApprovalReceipt[] = []
  for (const line of lines) {
    const parsed = parseApprovalReceiptLine(line)
    if (parsed) receipts.push(parsed)
  }
  return receipts
}

/** Strict allowlist parse of one JSONL line. */
export function parseApprovalReceiptLine(line: string): ApprovalReceipt | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!isPlainObject(raw)) return null
  if (raw.schemaVersion !== APPROVAL_RECEIPT_SCHEMA_VERSION) return null
  if (raw.kind !== APPROVAL_RECEIPT_KIND) return null
  if (typeof raw.receiptId !== 'string' || !raw.receiptId.trim()) return null
  if (typeof raw.decision !== 'string' || !DECISIONS.has(raw.decision as ApprovalReceiptDecision)) return null
  if (typeof raw.tool !== 'string' || !raw.tool.trim()) return null
  if (typeof raw.effect !== 'string') return null
  if (typeof raw.trace_id !== 'string' || !normalizeTraceId(raw.trace_id)) return null
  if (typeof raw.timestamp !== 'string' || !raw.timestamp.trim()) return null
  if (typeof raw.argsDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.argsDigest)) return null
  if (raw.reusableAuthorization !== false) return null
  if (raw.oneShot !== true) return null

  const receipt: ApprovalReceipt = {
    schemaVersion: APPROVAL_RECEIPT_SCHEMA_VERSION,
    kind: APPROVAL_RECEIPT_KIND,
    receiptId: raw.receiptId.trim(),
    decision: raw.decision as ApprovalReceiptDecision,
    tool: raw.tool.trim(),
    effect: raw.effect as ToolEffectClass,
    trace_id: normalizeTraceId(raw.trace_id)!,
    timestamp: raw.timestamp.trim(),
    argsDigest: raw.argsDigest.toLowerCase(),
    reusableAuthorization: false,
    oneShot: true,
    ...(typeof raw.toolCallId === 'string' && raw.toolCallId.trim()
      ? { toolCallId: raw.toolCallId.trim() }
      : {}),
    ...(typeof raw.operation === 'string' && raw.operation.trim()
      ? { operation: raw.operation.trim() }
      : {}),
    ...(typeof raw.targetHint === 'string' && raw.targetHint.trim()
      ? { targetHint: raw.targetHint.trim().slice(0, MAX_HINT) }
      : {})
  }
  assertApprovalReceiptNotAuthorizationToken(receipt)
  return receipt
}

function redactTargetHint(targetPath: string): string {
  const trimmed = targetPath.trim().replace(/\\/g, '/')
  // memory:// targets: keep scheme + short id/title prefix only
  if (trimmed.startsWith('memory://')) {
    const rest = trimmed.slice('memory://'.length)
    return `memory://${rest.slice(0, 40)}${rest.length > 40 ? '…' : ''}`
  }
  // Relative workspace paths are already bounded; still truncate.
  if (trimmed.length <= MAX_HINT) return trimmed
  return `${trimmed.slice(0, MAX_HINT - 1)}…`
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 6) return { truncated: true }
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return { t: 'string', n: value.length, d: shortDigest(value) }
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1))
  }
  if (!isPlainObject(value)) return { t: typeof value }
  const out: Record<string, unknown> = {}
  const keys = Object.keys(value).sort()
  for (const key of keys.slice(0, 40)) {
    const child = value[key]
    if (isSensitiveKey(key)) {
      out[key] = redactSensitiveLeaf(child)
    } else {
      out[key] = redactValue(child, depth + 1)
    }
  }
  if (keys.length > 40) out._omittedKeys = keys.length - 40
  return out
}

function redactSensitiveLeaf(value: unknown): unknown {
  if (typeof value === 'string') {
    return { redacted: true, t: 'string', n: value.length, d: shortDigest(value) }
  }
  if (Array.isArray(value)) {
    return { redacted: true, t: 'array', n: value.length }
  }
  if (isPlainObject(value)) {
    return { redacted: true, t: 'object', keys: Object.keys(value).sort().slice(0, 20) }
  }
  if (value === null || value === undefined) return { redacted: true, t: 'null' }
  return { redacted: true, t: typeof value }
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

function shortDigest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)
}

function stableCanonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = sortJson(value[key])
  }
  return out
}

function normalizeTraceId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !ID_PATTERN.test(trimmed)) return null
  return trimmed.slice(0, 128)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
