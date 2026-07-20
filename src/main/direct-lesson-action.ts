import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { replaceDurably, type DurableFileOperations } from './persistence/durable-file'

/** Fixed operation key for direct-UI lesson generation receipts. */
export const DIRECT_LESSON_OPERATION = 'direct_ui_lesson_generation/v1' as const

export const DIRECT_LESSON_RECEIPT_SCHEMA_VERSION = 1 as const

export const DIRECT_LESSON_RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const ACTION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_RECEIPT_BYTES = 16 * 1024
const PRIVATE_DIR_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export type DirectLessonReceiptPhase =
  | 'accepted'
  | 'provider_started'
  | 'completed'
  | 'tombstone'

export type DirectLessonReceipt = {
  schemaVersion: typeof DIRECT_LESSON_RECEIPT_SCHEMA_VERSION
  operation: typeof DIRECT_LESSON_OPERATION
  actionId: string
  workspaceId: string
  createdAt: string
  updatedAt: string
  phase: DirectLessonReceiptPhase
  requestTag: string
  effectTimestamp?: string
  generationStartedAt?: string
  publicationTransactionId?: string
  lessonId?: string
  lessonRelativePath?: string
  lifecycleEventId?: string
  source?: 'ai' | 'fallback'
  reason?: string
  terminalKind?: 'completed' | 'expired'
}

export type CanonicalDirectLessonInput = {
  workspaceId: string
  prompt: string
  courseName?: string
  messages: Array<{
    role: string
    content: string | null
    toolCallId?: string
    toolCalls?: Array<{ id: string; name: string; arguments: string }>
  }>
}

export function isRfc4122UuidV4(value: string): boolean {
  return ACTION_ID_RE.test(value)
}

export function assertActionId(actionId: string): string {
  const id = actionId.trim()
  if (!isRfc4122UuidV4(id)) {
    throw new Error('IPC payload field "actionId" must be an RFC 4122 UUID v4.')
  }
  return id.toLowerCase()
}

/**
 * Canonical JSON for request binding. Order and null/empty rules must match the
 * gateway parser output used at first accept.
 */
export function canonicalizeDirectLessonInput(input: CanonicalDirectLessonInput): string {
  const messages = input.messages.map((message) => {
    const entry: Record<string, unknown> = {
      role: message.role,
      content: message.content === null ? null : message.content
    }
    if (message.toolCallId !== undefined) entry.toolCallId = message.toolCallId
    if (message.toolCalls !== undefined) {
      entry.toolCalls = message.toolCalls.map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments
      }))
    }
    return entry
  })
  return JSON.stringify({
    operation: DIRECT_LESSON_OPERATION,
    workspaceId: input.workspaceId,
    prompt: input.prompt,
    courseName: input.courseName ?? null,
    messages
  })
}

export function computeRequestTag(installKey: Buffer, input: CanonicalDirectLessonInput): string {
  return createHmac('sha256', installKey)
    .update(canonicalizeDirectLessonInput(input), 'utf8')
    .digest('hex')
}

export function requestTagsEqual(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, 'hex')
    const right = Buffer.from(b, 'hex')
    if (left.length === 0 || left.length !== right.length) return false
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

export function receiptDirectory(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), '.studiumx', 'private', 'direct-lesson-actions', 'v1')
}

export function receiptPath(workspaceRoot: string, actionId: string): string {
  const id = assertActionId(actionId)
  const dir = receiptDirectory(workspaceRoot)
  const path = join(dir, `${id}.json`)
  const resolvedDir = resolve(dir) + sep
  const resolvedPath = resolve(path)
  if (!resolvedPath.startsWith(resolvedDir) || resolvedPath.includes('..')) {
    throw new Error('Direct lesson receipt path escaped containment.')
  }
  return resolvedPath
}

export function isDirectLessonReceipt(value: unknown): value is DirectLessonReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== DIRECT_LESSON_RECEIPT_SCHEMA_VERSION) return false
  if (record.operation !== DIRECT_LESSON_OPERATION) return false
  if (typeof record.actionId !== 'string' || !isRfc4122UuidV4(record.actionId)) return false
  if (typeof record.workspaceId !== 'string' || !record.workspaceId) return false
  if (typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') return false
  if (typeof record.requestTag !== 'string' || !/^[0-9a-f]{64}$/i.test(record.requestTag)) return false
  const phase = record.phase
  if (
    phase !== 'accepted' &&
    phase !== 'provider_started' &&
    phase !== 'completed' &&
    phase !== 'tombstone'
  ) {
    return false
  }
  if (record.effectTimestamp !== undefined && typeof record.effectTimestamp !== 'string') return false
  if (record.generationStartedAt !== undefined && typeof record.generationStartedAt !== 'string') return false
  if (record.publicationTransactionId !== undefined && typeof record.publicationTransactionId !== 'string') return false
  if (record.lessonId !== undefined && typeof record.lessonId !== 'string') return false
  if (record.lessonRelativePath !== undefined && typeof record.lessonRelativePath !== 'string') return false
  if (record.lifecycleEventId !== undefined && typeof record.lifecycleEventId !== 'string') return false
  if (record.source !== undefined && record.source !== 'ai' && record.source !== 'fallback') return false
  if (record.reason !== undefined && typeof record.reason !== 'string') return false
  if (record.terminalKind !== undefined && record.terminalKind !== 'completed' && record.terminalKind !== 'expired') {
    return false
  }
  return true
}

export type DirectLessonReceiptStoreOptions = {
  workspaceRoot: string
  operations?: DurableFileOperations
  warn?: (message: string) => void
  now?: () => Date
}

export async function ensureReceiptDirectory(workspaceRoot: string): Promise<string> {
  const dir = receiptDirectory(workspaceRoot)
  await mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE })
  await chmod(dir, PRIVATE_DIR_MODE).catch(() => undefined)
  // Ensure parent private dirs stay private when the platform supports chmod.
  const privateRoot = join(resolve(workspaceRoot), '.studiumx', 'private')
  await chmod(privateRoot, PRIVATE_DIR_MODE).catch(() => undefined)
  await chmod(join(privateRoot, 'direct-lesson-actions'), PRIVATE_DIR_MODE).catch(() => undefined)
  return dir
}

export async function readDirectLessonReceipt(
  workspaceRoot: string,
  actionId: string
): Promise<
  | { status: 'missing' }
  | { status: 'corrupt' }
  | { status: 'ok'; receipt: DirectLessonReceipt }
> {
  const path = receiptPath(workspaceRoot, actionId)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { status: 'missing' }
    return { status: 'corrupt' }
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_RECEIPT_BYTES) return { status: 'corrupt' }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isDirectLessonReceipt(parsed)) return { status: 'corrupt' }
    if (parsed.actionId.toLowerCase() !== assertActionId(actionId)) return { status: 'corrupt' }
    return { status: 'ok', receipt: parsed }
  } catch {
    return { status: 'corrupt' }
  }
}

export async function writeDirectLessonReceipt(
  receipt: DirectLessonReceipt,
  options: DirectLessonReceiptStoreOptions
): Promise<DirectLessonReceipt> {
  if (!isDirectLessonReceipt(receipt)) {
    throw new Error('Direct lesson receipt failed schema validation before write.')
  }
  await ensureReceiptDirectory(options.workspaceRoot)
  const path = receiptPath(options.workspaceRoot, receipt.actionId)
  const content = `${JSON.stringify(receipt)}\n`
  if (Buffer.byteLength(content, 'utf8') > MAX_RECEIPT_BYTES) {
    throw new Error('Direct lesson receipt exceeds size limit.')
  }
  await replaceDurably({
    path,
    content,
    mode: PRIVATE_FILE_MODE,
    operations: options.operations,
    warn: options.warn
  })
  const readBack = await readDirectLessonReceipt(options.workspaceRoot, receipt.actionId)
  if (readBack.status !== 'ok') {
    throw new Error('Direct lesson receipt read-back failed after durable write.')
  }
  if (
    readBack.receipt.phase !== receipt.phase ||
    !requestTagsEqual(readBack.receipt.requestTag, receipt.requestTag) ||
    readBack.receipt.workspaceId !== receipt.workspaceId
  ) {
    throw new Error('Direct lesson receipt read-back mismatched written state.')
  }
  return readBack.receipt
}

export function isReceiptResultExpired(receipt: DirectLessonReceipt, now = Date.now()): boolean {
  if (receipt.phase === 'tombstone' || receipt.terminalKind === 'expired') return true
  if (receipt.phase !== 'completed') return false
  const completedAt = Date.parse(receipt.updatedAt)
  if (!Number.isFinite(completedAt)) return true
  return now - completedAt > DIRECT_LESSON_RESULT_RETENTION_MS
}

export async function loadOrCreateInstallKey(appDataRoot: string): Promise<Buffer> {
  const keyPath = join(resolve(appDataRoot), 'direct-lesson-action-hmac.key')
  try {
    const existing = await readFile(keyPath)
    if (existing.length >= 32) return existing
  } catch {
    // create below
  }
  await mkdir(dirname(keyPath), { recursive: true, mode: PRIVATE_DIR_MODE })
  const key = randomBytes(32)
  await writeFile(keyPath, key, { mode: PRIVATE_FILE_MODE, flag: 'wx' }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return
    // Fallback without exclusive create for platforms that race.
    await writeFile(keyPath, key, { mode: PRIVATE_FILE_MODE })
  })
  const loaded = await readFile(keyPath)
  if (loaded.length < 32) throw new Error('Direct lesson install key is invalid.')
  await chmod(keyPath, PRIVATE_FILE_MODE).catch(() => undefined)
  return loaded
}

/** Process-local serialization for one {workspaceId, operation, actionId}. */
export class DirectLessonActionMutex {
  private readonly chains = new Map<string, Promise<void>>()

  key(workspaceId: string, actionId: string): string {
    return `${workspaceId}\0${DIRECT_LESSON_OPERATION}\0${assertActionId(actionId)}`
  }

  async runExclusive<T>(workspaceId: string, actionId: string, task: () => Promise<T>): Promise<T> {
    const key = this.key(workspaceId, actionId)
    const previous = this.chains.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate
    })
    const chain = previous.then(() => gate, () => gate)
    this.chains.set(key, chain)
    await previous.catch(() => undefined)
    try {
      return await task()
    } finally {
      release()
      if (this.chains.get(key) === chain) this.chains.delete(key)
    }
  }
}

export type InFlightDirectLessonAction = {
  workspaceId: string
  actionId: string
  startedAt: number
}

export class DirectLessonInFlightRegistry {
  private readonly active = new Map<string, InFlightDirectLessonAction>()

  private key(workspaceId: string, actionId: string): string {
    return `${workspaceId}\0${assertActionId(actionId)}`
  }

  mark(workspaceId: string, actionId: string): void {
    this.active.set(this.key(workspaceId, actionId), {
      workspaceId,
      actionId: assertActionId(actionId),
      startedAt: Date.now()
    })
  }

  clear(workspaceId: string, actionId: string): void {
    this.active.delete(this.key(workspaceId, actionId))
  }

  isActive(workspaceId: string, actionId: string): boolean {
    return this.active.has(this.key(workspaceId, actionId))
  }
}
