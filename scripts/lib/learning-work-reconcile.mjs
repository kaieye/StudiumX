import { access, mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const LEDGER_RELATIVE_PATH = '.studiumx/learning-work.jsonl'
const POINTER_KEYS = ['markdown', 'materializedJson', 'sessionAudit']
const SEALED_SEGMENT_SEQUENCE_WIDTH = 6

/**
 * Reconciles the canonical logical learning-work source: every strictly named
 * sealed sibling in (month, sequence) order, followed by the active basename.
 */
export async function reconcileLearningWorkLedger(rootPath) {
  const normalizedRoot = resolve(rootPath)
  const ledgerPath = join(normalizedRoot, LEDGER_RELATIVE_PATH)
  const sources = await readLearningWorkLedgerSources(ledgerPath)
  if (sources.length === 0) return emptyResult('not_found')

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

  for (const source of sources) {
    for (const line of source.content.split(/\r?\n/)) {
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
    segments: sources.map(segmentDescriptor),
    entries: entries.length,
    conversations: latestByConversation.size,
    issues
  }
}

/**
 * Explicit C-2A rollback export. It validates every non-blank JSONL record in
 * the strict sealed+active source, writes their ordered logical content to a
 * same-directory temporary file, fsyncs it, atomically replaces the active
 * basename, then verifies its SHA-256 checksum. Sealed source files are never
 * renamed, deleted, or modified.
 *
 * This is deliberately a rollback-only export: after it succeeds, run an old
 * active-only application (or restore the pre-export active file) before using
 * an all-segment reader again, otherwise it would observe the retained sealed
 * files plus the merged active copy.
 */
export async function mergeLearningWorkLedgerToLegacyActive(rootPath) {
  const normalizedRoot = resolve(rootPath)
  const ledgerPath = join(normalizedRoot, LEDGER_RELATIVE_PATH)
  const sources = await readLearningWorkLedgerSources(ledgerPath)
  if (sources.length === 0) {
    throw new Error(`Cannot create legacy learning-work rollback export: no source exists at ${ledgerPath}.`)
  }

  const merged = mergeStrictJsonlSources(sources)
  const sourceChecksums = sources.map((source) => ({
    path: source.path,
    kind: source.kind,
    sha256: sha256(source.content)
  }))
  const sourceChecksum = sha256(merged)

  await atomicWriteFile(ledgerPath, merged)
  const output = await readFile(ledgerPath, 'utf8')
  const outputChecksum = sha256(output)
  if (outputChecksum !== sourceChecksum) {
    throw new Error(`Legacy learning-work rollback export checksum mismatch for ${ledgerPath}.`)
  }

  return {
    ledgerRelativePath: LEDGER_RELATIVE_PATH,
    activePath: ledgerPath,
    sourceSegments: sources.map(segmentDescriptor),
    sourceChecksums,
    sourceChecksum,
    outputChecksum,
    bytes: Buffer.byteLength(output, 'utf8'),
    lines: countNonBlankLines(output)
  }
}

async function readLearningWorkLedgerSources(ledgerPath) {
  const segments = await discoverStrictLedgerSegments(ledgerPath)
  const sources = []
  for (const segment of segments) {
    sources.push({ ...segment, content: await readFile(segment.path, 'utf8') })
  }
  return sources
}

async function discoverStrictLedgerSegments(activePath) {
  const directory = dirname(activePath)
  const activeName = basename(activePath)
  const sealed = await readdir(directory, { withFileTypes: true }).then((entries) => entries
    .filter((entry) => entry.isFile())
    .map((entry) => parseSealedSegmentName(activeName, entry.name))
    .filter((segment) => segment !== null)
    .sort((left, right) => left.month.localeCompare(right.month) || left.sequence - right.sequence)
    .map((segment) => ({ path: join(directory, segment.name), kind: 'sealed', month: segment.month, sequence: segment.sequence }))).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })

  const activeExists = await stat(activePath).then((info) => info.isFile()).catch((error) => {
    if (error?.code === 'ENOENT') return false
    throw error
  })
  return activeExists ? [...sealed, { path: activePath, kind: 'active' }] : sealed
}

function mergeStrictJsonlSources(sources) {
  let merged = ''
  for (const source of sources) {
    validateJsonlSource(source)
    if (merged && !endsWithLineBreak(merged) && source.content) merged += '\n'
    merged += source.content
  }
  return merged
}

function validateJsonlSource(source) {
  for (const [index, line] of source.content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    try {
      JSON.parse(line)
    } catch {
      throw new Error(`Cannot create legacy learning-work rollback export: invalid JSONL in ${source.path} at line ${index + 1}.`)
    }
  }
}

async function atomicWriteFile(path, content) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true })
  const temporaryPath = join(directory, `.${basename(path)}.rollback-${randomBytes(12).toString('hex')}.tmp`)
  let renamed = false
  try {
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(content, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporaryPath, path)
    renamed = true
    await syncDirectory(directory)
  } finally {
    if (!renamed) await unlink(temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

async function syncDirectory(directory) {
  try {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (isDirectorySyncUnsupportedError(error)) return
    throw error
  }
}

function isDirectorySyncUnsupportedError(error) {
  return ['EOPNOTSUPP', 'ENOTSUP', 'ENOSYS', 'EINVAL', 'EISDIR'].includes(error?.code)
}

function parseSealedSegmentName(activeFileName, candidate) {
  const stem = activeFileName.endsWith('.jsonl')
    ? activeFileName.slice(0, -'.jsonl'.length)
    : activeFileName
  const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escapedStem}\\.sealed-(\\d{4}-(?:0[1-9]|1[0-2]))-(\\d{${SEALED_SEGMENT_SEQUENCE_WIDTH}})\\.jsonl$`).exec(candidate)
  if (!match) return null
  const sequence = Number(match[2])
  if (!Number.isInteger(sequence) || sequence < 1) return null
  return { name: candidate, month: match[1], sequence }
}

function segmentDescriptor(source) {
  return {
    path: source.path,
    kind: source.kind,
    ...(source.kind === 'sealed' ? { month: source.month, sequence: source.sequence } : {})
  }
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function endsWithLineBreak(value) {
  return value.endsWith('\n') || value.endsWith('\r')
}

function countNonBlankLines(value) {
  return value.split(/\r?\n/).filter((line) => line.trim()).length
}

function emptyResult(status) {
  return {
    ledgerRelativePath: LEDGER_RELATIVE_PATH,
    status,
    exists: false,
    segments: [],
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
