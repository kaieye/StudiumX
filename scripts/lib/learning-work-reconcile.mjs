import { access, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'

const LEDGER_RELATIVE_PATH = '.studiumx/learning-work.jsonl'
const POINTER_KEYS = ['markdown', 'materializedJson', 'sessionAudit']

export async function reconcileLearningWorkLedger(rootPath) {
  const normalizedRoot = resolve(rootPath)
  const ledgerPath = join(normalizedRoot, LEDGER_RELATIVE_PATH)
  const content = await readFile(ledgerPath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (content === null) return emptyResult('not_found')

  const issues = {
    invalidLines: 0,
    duplicateEntries: 0,
    unsafePointers: 0,
    missingPointers: { markdown: 0, materializedJson: 0, sessionAudit: 0 },
    invalidTruth: 0,
    staleSnapshots: 0
  }
  const seenEntryIds = new Set()
  const entries = []

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue
    const entry = parseLedgerEntry(line)
    if (!entry) {
      issues.invalidLines += 1
      continue
    }
    if (seenEntryIds.has(entry.entryId)) issues.duplicateEntries += 1
    seenEntryIds.add(entry.entryId)
    entries.push(entry)
  }

  const latestByConversation = new Map()
  for (const entry of entries) {
    const previous = latestByConversation.get(entry.conversation.id)
    if (!previous || snapshotSortKey(entry) >= snapshotSortKey(previous)) {
      latestByConversation.set(entry.conversation.id, entry)
    }
    for (const key of POINTER_KEYS) {
      const pointer = entry.pointers[key]
      const state = await inspectPointer(normalizedRoot, pointer)
      if (state === 'unsafe') issues.unsafePointers += 1
      else if (state === 'missing') issues.missingPointers[key] += 1
    }
  }

  for (const entry of latestByConversation.values()) {
    const materialized = await readSafeJsonPointer(normalizedRoot, entry.pointers.materializedJson)
    if (materialized.status === 'missing' || materialized.status === 'unsafe') continue
    if (materialized.status === 'invalid') {
      issues.invalidTruth += 1
      continue
    }
    const truth = materialized.value
    const truthUpdatedAt = stringValue(truth.updatedAt)
    const truthMessageCount = finiteNumber(truth.messageCount)
      ?? (Array.isArray(truth.turns) ? truth.turns.length : null)
    if (
      (truthUpdatedAt && truthUpdatedAt !== entry.conversation.updatedAt) ||
      (truthMessageCount !== null && truthMessageCount !== entry.conversation.messageCount)
    ) {
      issues.staleSnapshots += 1
    }
  }

  const issueCount = issues.invalidLines + issues.duplicateEntries + issues.unsafePointers +
    Object.values(issues.missingPointers).reduce((sum, count) => sum + count, 0) +
    issues.invalidTruth + issues.staleSnapshots

  return {
    ledgerRelativePath: LEDGER_RELATIVE_PATH,
    status: issueCount > 0 ? 'issues' : 'ok',
    exists: true,
    entries: entries.length,
    conversations: latestByConversation.size,
    issues
  }
}

function emptyResult(status) {
  return {
    ledgerRelativePath: LEDGER_RELATIVE_PATH,
    status,
    exists: false,
    entries: 0,
    conversations: 0,
    issues: {
      invalidLines: 0,
      duplicateEntries: 0,
      unsafePointers: 0,
      missingPointers: { markdown: 0, materializedJson: 0, sessionAudit: 0 },
      invalidTruth: 0,
      staleSnapshots: 0
    }
  }
}

function parseLedgerEntry(line) {
  let value
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  if (value.version !== 1 || value.type !== 'conversation_snapshot') return null
  if (!stringValue(value.entryId) || !value.conversation || typeof value.conversation !== 'object') return null
  if (!stringValue(value.conversation.id) || !stringValue(value.conversation.updatedAt)) return null
  if (finiteNumber(value.conversation.messageCount) === null) return null
  if (!value.pointers || typeof value.pointers !== 'object') return null
  if (POINTER_KEYS.some((key) => !stringValue(value.pointers[key]))) return null
  return value
}

async function inspectPointer(rootPath, pointer) {
  const candidate = safePointerPath(rootPath, pointer)
  if (!candidate) return 'unsafe'
  try {
    await access(candidate)
  } catch {
    return 'missing'
  }
  const [realRoot, realCandidate] = await Promise.all([realpath(rootPath), realpath(candidate)]).catch(() => [])
  if (!realRoot || !realCandidate || !isInside(realRoot, realCandidate)) return 'unsafe'
  return 'ok'
}

async function readSafeJsonPointer(rootPath, pointer) {
  const state = await inspectPointer(rootPath, pointer)
  if (state !== 'ok') return { status: state }
  const candidate = safePointerPath(rootPath, pointer)
  try {
    const value = JSON.parse(await readFile(candidate, 'utf8'))
    return value && typeof value === 'object'
      ? { status: 'ok', value }
      : { status: 'invalid' }
  } catch {
    return { status: 'invalid' }
  }
}

function safePointerPath(rootPath, pointer) {
  if (!stringValue(pointer) || isAbsolute(pointer)) return null
  const candidate = resolve(rootPath, pointer)
  return isInside(rootPath, candidate) ? candidate : null
}

function isInside(rootPath, candidatePath) {
  const rel = relative(rootPath, candidatePath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function snapshotSortKey(entry) {
  return `${entry.conversation.updatedAt}\u0000${entry.createdAt ?? ''}\u0000${entry.entryId}`
}

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
