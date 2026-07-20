import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { replaceDurably, type DurableFileOperations } from '../persistence/durable-file'

/** Workspace-private mission action receipts live only under this relative directory. */
export const MISSION_ACTION_RECEIPT_DIR_RELATIVE = '.studiumx/mission-actions'
export const MISSION_ACTION_RECEIPT_SCHEMA_VERSION = 1 as const
export const MISSION_ACTION_OPERATION_KIND = 'mission_update' as const

const RECEIPT_MAX_BYTES = 4 * 1024
const ACTION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const REQUEST_TAG_RE = /^[0-9a-f]{64}$/
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export type MissionActionReceiptPhase =
  | 'prepared'
  | 'mission_published'
  | 'event_appended'
  | 'final'

export type MissionActionReceiptV1 = {
  schemaVersion: typeof MISSION_ACTION_RECEIPT_SCHEMA_VERSION
  kind: typeof MISSION_ACTION_OPERATION_KIND
  workspaceId: string
  actionId: string
  traceId: string
  eventId: string
  phase: MissionActionReceiptPhase
  /**
   * Main-keyed irreversible request binding tag. Not a content hash and not
   * derived for export; never log or surface this value.
   */
  requestTag: string
  createdAt: string
  updatedAt: string
}

export type MissionActionReceipt = MissionActionReceiptV1

export type MissionActionReceiptReadResult =
  | { status: 'missing' }
  | { status: 'valid'; receipt: MissionActionReceipt }
  | { status: 'invalid' }

const ALLOWED_RECEIPT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'workspaceId',
  'actionId',
  'traceId',
  'eventId',
  'phase',
  'requestTag',
  'createdAt',
  'updatedAt'
])

const PHASES: ReadonlySet<MissionActionReceiptPhase> = new Set([
  'prepared',
  'mission_published',
  'event_appended',
  'final'
])

export function isMissionActionId(value: unknown): value is string {
  return typeof value === 'string' && ACTION_ID_RE.test(value)
}

export function normalizeMissionActionId(value: unknown): string | undefined {
  return isMissionActionId(value) ? value.toLowerCase() : undefined
}

export function missionActionReceiptRelativePath(actionId: string): string {
  const normalized = normalizeMissionActionId(actionId)
  if (!normalized) {
    throw new Error('Mission action receipt path requires a canonical action id.')
  }
  return `${MISSION_ACTION_RECEIPT_DIR_RELATIVE}/${normalized}.json`
}

export function missionActionReceiptPath(workspaceRoot: string, actionId: string): string {
  return join(workspaceRoot, missionActionReceiptRelativePath(actionId))
}

export function isMissionActionReceipt(value: unknown): value is MissionActionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== ALLOWED_RECEIPT_KEYS.size || keys.some((key) => !ALLOWED_RECEIPT_KEYS.has(key))) {
    return false
  }
  if (record.schemaVersion !== MISSION_ACTION_RECEIPT_SCHEMA_VERSION) return false
  if (record.kind !== MISSION_ACTION_OPERATION_KIND) return false
  if (typeof record.workspaceId !== 'string' || !record.workspaceId.trim() || record.workspaceId.length > 160) {
    return false
  }
  if (!normalizeMissionActionId(record.actionId)) return false
  if (!normalizeMissionActionId(record.traceId)) return false
  if (!normalizeMissionActionId(record.eventId)) return false
  if (typeof record.phase !== 'string' || !PHASES.has(record.phase as MissionActionReceiptPhase)) {
    return false
  }
  if (typeof record.requestTag !== 'string' || !REQUEST_TAG_RE.test(record.requestTag)) return false
  if (typeof record.createdAt !== 'string' || !ISO_TIMESTAMP_RE.test(record.createdAt)) return false
  if (typeof record.updatedAt !== 'string' || !ISO_TIMESTAMP_RE.test(record.updatedAt)) return false
  return true
}

/**
 * Strict allowlist parser for private receipts. Unknown versions, extra fields,
 * or malformed values are invalid — callers must fail closed.
 */
export function parseMissionActionReceipt(raw: string): MissionActionReceiptReadResult {
  if (Buffer.byteLength(raw, 'utf8') > RECEIPT_MAX_BYTES) return { status: 'invalid' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'invalid' }
  }
  if (!isMissionActionReceipt(parsed)) return { status: 'invalid' }
  return {
    status: 'valid',
    receipt: {
      ...parsed,
      actionId: parsed.actionId.toLowerCase(),
      traceId: parsed.traceId.toLowerCase(),
      eventId: parsed.eventId.toLowerCase()
    }
  }
}

export async function readMissionActionReceipt(options: {
  workspaceRoot: string
  actionId: string
  operations?: Pick<DurableFileOperations, 'readFile'>
}): Promise<MissionActionReceiptReadResult> {
  const path = missionActionReceiptPath(options.workspaceRoot, options.actionId)
  const readFileFn = options.operations?.readFile ?? readFile
  try {
    const raw = await readFileFn(path, 'utf8')
    return parseMissionActionReceipt(raw)
  } catch (error) {
    if (isMissingFile(error)) return { status: 'missing' }
    return { status: 'invalid' }
  }
}

export async function writeMissionActionReceipt(options: {
  workspaceRoot: string
  receipt: MissionActionReceipt
  operations?: DurableFileOperations
  warn?: (message: string) => void
}): Promise<void> {
  if (!isMissionActionReceipt(options.receipt)) {
    throw new Error('Mission action receipt failed validation before write.')
  }
  if (normalizeMissionActionId(options.receipt.actionId) !== options.receipt.actionId) {
    throw new Error('Mission action receipt action id must be canonical.')
  }
  const path = missionActionReceiptPath(options.workspaceRoot, options.receipt.actionId)
  await mkdir(dirname(path), { recursive: true })
  await replaceDurably({
    path,
    content: `${JSON.stringify(options.receipt)}\n`,
    mode: 0o600,
    operations: options.operations,
    warn: options.warn
  })
}

export function advanceMissionActionReceiptPhase(
  receipt: MissionActionReceipt,
  phase: MissionActionReceiptPhase,
  updatedAt: string
): MissionActionReceipt {
  assertPhaseTransition(receipt.phase, phase)
  return {
    ...receipt,
    phase,
    updatedAt
  }
}

function assertPhaseTransition(from: MissionActionReceiptPhase, to: MissionActionReceiptPhase): void {
  const allowed: Record<MissionActionReceiptPhase, MissionActionReceiptPhase[]> = {
    prepared: ['mission_published'],
    mission_published: ['event_appended'],
    event_appended: ['final'],
    final: []
  }
  if (!allowed[from].includes(to)) {
    throw new Error('Invalid mission action receipt phase transition.')
  }
}

/**
 * App-private binding material for irreversible request tags. Stored outside
 * workspace trees so workspace export/copy does not export the key.
 */
export const MISSION_ACTION_BINDING_KEY_RELATIVE = 'mission-action-binding.v1.key'

export async function loadOrCreateMissionActionBindingKey(options: {
  appDataRoot: string
  durableOperations?: DurableFileOperations
  warn?: (message: string) => void
}): Promise<Buffer> {
  const path = join(options.appDataRoot, MISSION_ACTION_BINDING_KEY_RELATIVE)
  const readFileFn = options.durableOperations?.readFile ?? readFile
  try {
    const existing = await readFileFn(path, 'utf8')
    const key = Buffer.from(existing.trim(), 'base64url')
    if (key.length >= 32) return key
  } catch (error) {
    if (!isMissingFile(error)) {
      // Unreadable key material is a hard stop for binding; callers treat as indeterminate.
      throw new Error('Mission action binding key is unreadable.')
    }
  }
  const key = randomBytes(32)
  await replaceDurably({
    path,
    content: `${key.toString('base64url')}\n`,
    mode: 0o600,
    operations: options.durableOperations,
    warn: options.warn
  })
  return key
}

/**
 * Computes a main-keyed irreversible request tag. Never log or persist the
 * raw prompt alongside this tag outside private receipt bytes.
 */
export function computeMissionRequestTag(options: {
  bindingKey: Buffer
  workspaceId: string
  actionId: string
  prompt: string
}): string {
  const actionId = normalizeMissionActionId(options.actionId)
  if (!actionId) throw new Error('Mission request tag requires a canonical action id.')
  return createHmac('sha256', options.bindingKey)
    .update('mission_update\0', 'utf8')
    .update(options.workspaceId, 'utf8')
    .update('\0', 'utf8')
    .update(actionId, 'utf8')
    .update('\0', 'utf8')
    .update(options.prompt, 'utf8')
    .digest('hex')
}

export function missionRequestTagsMatch(left: string, right: string): boolean {
  if (!REQUEST_TAG_RE.test(left) || !REQUEST_TAG_RE.test(right)) return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT')
}
