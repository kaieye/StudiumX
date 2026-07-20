/**
 * Read-only Teaching workspace inspector.
 *
 * Produces a structured WorkspaceInspectionReport for one workspace root.
 * Never mutates the filesystem, never auto-repairs, and never treats catalog
 * projections as canonical truth. Repair remains a separate future effect.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import type { LessonSummary } from '../shared/teaching-types'
import { isPathInsideRoot } from './path-access'
import {
  directoryExists,
  fileExists,
  normalizeWorkspaceRelativePath,
  toWorkspaceRelativePath,
  collectTeachingFiles
} from './teaching-workspace-paths'

export type InspectionSeverity = 'info' | 'warning' | 'error'
export type InspectionRepairability = 'none' | 'manual' | 'safe_command'
export type InspectionCategory =
  | 'canonical_files'
  | 'schema'
  | 'dangling_links'
  | 'catalog_drift'
  | 'temp_artifacts'

export type WorkspaceInspectionEvidence = {
  /** Workspace-relative path only; never an absolute host path. */
  relativePath?: string
  detail?: string
}

export type WorkspaceInspectionFinding = {
  code: WorkspaceInspectionCode
  severity: InspectionSeverity
  category: InspectionCategory
  message: string
  evidence: WorkspaceInspectionEvidence
  repairability: InspectionRepairability
}

export type WorkspaceInspectionCode =
  | 'missing_canonical_file'
  | 'missing_canonical_directory'
  | 'invalid_index_json'
  | 'invalid_index_schema'
  | 'invalid_lesson_schema'
  | 'dangling_lesson_path'
  | 'dangling_path_meta'
  | 'catalog_drift_unindexed_lesson'
  | 'catalog_drift_missing_lesson'
  | 'temp_artifact_present'

export type WorkspaceInspectionStatus = 'ok' | 'warning' | 'error'

export type WorkspaceInspectionReport = {
  schemaVersion: 1
  readOnly: true
  inspectedAt: string
  status: WorkspaceInspectionStatus
  findings: WorkspaceInspectionFinding[]
  summary: {
    findingCount: number
    errorCount: number
    warningCount: number
    infoCount: number
  }
}

const CANONICAL_FILES = [
  'MISSION.md',
  'RESOURCES.md',
  'GLOSSARY.md',
  'NOTES.md',
  'assets/lesson.css',
  'assets/quiz.js',
  'assets/flashcards.css',
  'assets/flashcards.js'
] as const

const CANONICAL_DIRECTORIES = [
  'lessons',
  'conversation',
  'reference',
  'learning-records',
  'reviews',
  'assets',
  'learning-sessions',
  '.studiumx'
] as const

const INDEX_RELATIVE_PATH = '.studiumx/index.json'
const MAX_INDEX_BYTES = 2 * 1024 * 1024
const MAX_TEMP_WALK_DEPTH = 8
const MAX_TEMP_FINDINGS = 40
const TEMP_WALK_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'out',
  'dist',
  'release',
  '.agent-sessions'
])

const TEMP_BASENAME_PATTERNS: RegExp[] = [
  /^\..+\.[0-9]+\.[0-9a-f-]{8,}\.tmp$/i,
  /\.tmp-[0-9]+-/i,
  /^\.studiumx-bounded-read-/i,
  /^\.studiumx-lesson-stage-/i,
  /^\.learning-outcome-committer-stage$/i
]

/**
 * Inspect one Teaching workspace root without writing, renaming, or repairing.
 */
export async function inspect(root: string): Promise<WorkspaceInspectionReport> {
  const rootPath = resolve(root)
  const findings: WorkspaceInspectionFinding[] = []

  if (!(await directoryExists(rootPath))) {
    findings.push(finding({
      code: 'missing_canonical_directory',
      severity: 'error',
      category: 'canonical_files',
      message: 'Workspace root is missing or is not a directory.',
      evidence: { detail: 'root' },
      repairability: 'manual'
    }))
    return finalizeReport(findings)
  }

  findings.push(...await inspectCanonicalFiles(rootPath))
  const indexResult = await inspectIndexSchema(rootPath)
  findings.push(...indexResult.findings)

  if (indexResult.index) {
    findings.push(...await inspectDanglingLinks(rootPath, indexResult.index))
    findings.push(...await inspectCatalogDrift(rootPath, indexResult.index))
  }

  findings.push(...await inspectTempArtifacts(rootPath))

  return finalizeReport(findings)
}

async function inspectCanonicalFiles(rootPath: string): Promise<WorkspaceInspectionFinding[]> {
  const findings: WorkspaceInspectionFinding[] = []

  for (const relativePath of CANONICAL_DIRECTORIES) {
    const absolutePath = join(rootPath, ...relativePath.split('/'))
    if (!(await directoryExists(absolutePath))) {
      findings.push(finding({
        code: 'missing_canonical_directory',
        severity: relativePath === '.studiumx' ? 'error' : 'warning',
        category: 'canonical_files',
        message: `Canonical directory is missing: ${relativePath}`,
        evidence: { relativePath },
        repairability: 'safe_command'
      }))
    }
  }

  for (const relativePath of CANONICAL_FILES) {
    const absolutePath = join(rootPath, ...relativePath.split('/'))
    if (!(await fileExists(absolutePath))) {
      findings.push(finding({
        code: 'missing_canonical_file',
        severity: relativePath === 'MISSION.md' || relativePath === 'RESOURCES.md' ? 'warning' : 'info',
        category: 'canonical_files',
        message: `Canonical file is missing: ${relativePath}`,
        evidence: { relativePath },
        repairability: 'safe_command'
      }))
    }
  }

  return findings
}

type IndexInspection = {
  findings: WorkspaceInspectionFinding[]
  index: WorkspaceIndexSnapshot | null
}

type WorkspaceIndexSnapshot = {
  lessons: LessonSummary[]
  pathMetaKeys: string[]
  rawLessons: unknown[]
}

async function inspectIndexSchema(rootPath: string): Promise<IndexInspection> {
  const findings: WorkspaceInspectionFinding[] = []
  const indexPath = join(rootPath, ...INDEX_RELATIVE_PATH.split('/'))

  if (!(await fileExists(indexPath))) {
    findings.push(finding({
      code: 'invalid_index_schema',
      severity: 'warning',
      category: 'schema',
      message: 'Durable Lesson index is missing.',
      evidence: { relativePath: INDEX_RELATIVE_PATH },
      repairability: 'safe_command'
    }))
    return { findings, index: { lessons: [], pathMetaKeys: [], rawLessons: [] } }
  }

  let content: string
  try {
    const info = await stat(indexPath)
    if (!info.isFile()) {
      findings.push(finding({
        code: 'invalid_index_schema',
        severity: 'error',
        category: 'schema',
        message: 'Durable Lesson index path exists but is not a regular file.',
        evidence: { relativePath: INDEX_RELATIVE_PATH },
        repairability: 'manual'
      }))
      return { findings, index: null }
    }
    if (info.size > MAX_INDEX_BYTES) {
      findings.push(finding({
        code: 'invalid_index_schema',
        severity: 'error',
        category: 'schema',
        message: 'Durable Lesson index exceeds the inspection size limit.',
        evidence: {
          relativePath: INDEX_RELATIVE_PATH,
          detail: `limit_bytes=${MAX_INDEX_BYTES}`
        },
        repairability: 'manual'
      }))
      return { findings, index: null }
    }
    content = await readFile(indexPath, 'utf8')
  } catch {
    findings.push(finding({
      code: 'invalid_index_json',
      severity: 'error',
      category: 'schema',
      message: 'Durable Lesson index could not be read.',
      evidence: { relativePath: INDEX_RELATIVE_PATH },
      repairability: 'manual'
    }))
    return { findings, index: null }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content) as unknown
  } catch {
    findings.push(finding({
      code: 'invalid_index_json',
      severity: 'error',
      category: 'schema',
      message: 'Durable Lesson index is not valid JSON.',
      evidence: { relativePath: INDEX_RELATIVE_PATH },
      repairability: 'manual'
    }))
    return { findings, index: null }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    findings.push(finding({
      code: 'invalid_index_schema',
      severity: 'error',
      category: 'schema',
      message: 'Durable Lesson index must be a JSON object.',
      evidence: { relativePath: INDEX_RELATIVE_PATH },
      repairability: 'manual'
    }))
    return { findings, index: null }
  }

  const record = parsed as Record<string, unknown>
  const rawLessons = Array.isArray(record.lessons) ? record.lessons : null
  if (rawLessons === null) {
    findings.push(finding({
      code: 'invalid_index_schema',
      severity: 'error',
      category: 'schema',
      message: 'Durable Lesson index is missing a lessons array.',
      evidence: { relativePath: INDEX_RELATIVE_PATH, detail: 'field=lessons' },
      repairability: 'manual'
    }))
    return { findings, index: null }
  }

  const lessons: LessonSummary[] = []
  for (const [index, value] of rawLessons.entries()) {
    if (!isLessonSummaryShape(value)) {
      findings.push(finding({
        code: 'invalid_lesson_schema',
        severity: 'warning',
        category: 'schema',
        message: 'Lesson index entry is missing required fields.',
        evidence: {
          relativePath: INDEX_RELATIVE_PATH,
          detail: `lesson_index=${index}`
        },
        repairability: 'manual'
      }))
      continue
    }
    lessons.push(value)
  }

  const pathMetaKeys =
    record.pathMeta && typeof record.pathMeta === 'object' && !Array.isArray(record.pathMeta)
      ? Object.keys(record.pathMeta as Record<string, unknown>)
          .map((key) => normalizeWorkspaceRelativePath(key))
          .filter(Boolean)
      : []

  return {
    findings,
    index: {
      lessons,
      pathMetaKeys,
      rawLessons
    }
  }
}

async function inspectDanglingLinks(
  rootPath: string,
  index: WorkspaceIndexSnapshot
): Promise<WorkspaceInspectionFinding[]> {
  const findings: WorkspaceInspectionFinding[] = []

  for (const lesson of index.lessons) {
    const relativePath = normalizeWorkspaceRelativePath(lesson.relativePath)
    if (!relativePath) {
      findings.push(finding({
        code: 'dangling_lesson_path',
        severity: 'warning',
        category: 'dangling_links',
        message: 'Lesson index entry has an empty relative path.',
        evidence: { detail: `lesson_id=${lesson.id}` },
        repairability: 'manual'
      }))
      continue
    }

    const absoluteFromRelative = join(rootPath, ...relativePath.split('/'))
    if (!isPathInsideRoot(rootPath, absoluteFromRelative)) {
      findings.push(finding({
        code: 'dangling_lesson_path',
        severity: 'error',
        category: 'dangling_links',
        message: 'Lesson relative path escapes the workspace root.',
        evidence: { relativePath },
        repairability: 'manual'
      }))
      continue
    }

    if (!(await fileExists(absoluteFromRelative))) {
      findings.push(finding({
        code: 'dangling_lesson_path',
        severity: 'warning',
        category: 'dangling_links',
        message: 'Lesson index points to a missing file.',
        evidence: { relativePath },
        repairability: 'safe_command'
      }))
    }
  }

  for (const rawKey of index.pathMetaKeys) {
    const relativePath = normalizeWorkspaceRelativePath(rawKey)
    if (!relativePath) continue
    const absolutePath = join(rootPath, ...relativePath.split('/'))
    if (!isPathInsideRoot(rootPath, absolutePath)) {
      findings.push(finding({
        code: 'dangling_path_meta',
        severity: 'error',
        category: 'dangling_links',
        message: 'pathMeta key escapes the workspace root.',
        evidence: { relativePath },
        repairability: 'manual'
      }))
      continue
    }
    const exists = (await fileExists(absolutePath)) || (await directoryExists(absolutePath))
    if (!exists) {
      findings.push(finding({
        code: 'dangling_path_meta',
        severity: 'info',
        category: 'dangling_links',
        message: 'pathMeta refers to a path that is not present on disk.',
        evidence: { relativePath },
        repairability: 'safe_command'
      }))
    }
  }

  return findings
}

/**
 * Catalog drift is computed from the durable index and the filesystem.
 * Projections (fileTree/courses from buildWorkspaceCatalog) are deliberately
 * not consulted so a stale projection cannot be treated as authority.
 */
async function inspectCatalogDrift(
  rootPath: string,
  index: WorkspaceIndexSnapshot
): Promise<WorkspaceInspectionFinding[]> {
  const findings: WorkspaceInspectionFinding[] = []
  const diskHtmlPaths = await collectTeachingFiles(rootPath, (filePath) => filePath.toLowerCase().endsWith('.html'))
  const diskRelative = new Set(
    diskHtmlPaths
      .map((absolutePath) => normalizeWorkspaceRelativePath(toWorkspaceRelativePath(rootPath, absolutePath)))
      .filter(Boolean)
  )

  const indexedRelative = new Set(
    index.lessons
      .map((lesson) => normalizeWorkspaceRelativePath(lesson.relativePath))
      .filter(Boolean)
  )

  for (const relativePath of [...diskRelative].sort()) {
    if (indexedRelative.has(relativePath)) continue
    // Reference HTML is not a Lesson index record.
    if (relativePath.toLowerCase().endsWith('-reference.html')) continue
    findings.push(finding({
      code: 'catalog_drift_unindexed_lesson',
      severity: 'warning',
      category: 'catalog_drift',
      message: 'Filesystem Lesson is not present in the durable index.',
      evidence: { relativePath },
      repairability: 'safe_command'
    }))
  }

  for (const relativePath of [...indexedRelative].sort()) {
    if (diskRelative.has(relativePath)) continue
    // Missing files are also dangling links; keep a distinct drift code so
    // doctor/repair can group reconciliation work without re-reading disk.
    findings.push(finding({
      code: 'catalog_drift_missing_lesson',
      severity: 'warning',
      category: 'catalog_drift',
      message: 'Durable index Lesson is not present on the filesystem.',
      evidence: { relativePath },
      repairability: 'safe_command'
    }))
  }

  return findings
}

async function inspectTempArtifacts(rootPath: string): Promise<WorkspaceInspectionFinding[]> {
  const findings: WorkspaceInspectionFinding[] = []
  const stack: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
    { absolutePath: rootPath, relativePath: '', depth: 0 }
  ]

  while (stack.length > 0 && findings.length < MAX_TEMP_FINDINGS) {
    const current = stack.pop()
    if (!current) continue
    const entries = await readdir(current.absolutePath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (findings.length >= MAX_TEMP_FINDINGS) break
      const name = entry.name
      const relativePath = current.relativePath ? `${current.relativePath}/${name}` : name
      const absolutePath = join(current.absolutePath, name)

      if (!isPathInsideRoot(rootPath, absolutePath)) continue

      if (isTempArtifactName(name)) {
        findings.push(finding({
          code: 'temp_artifact_present',
          severity: 'info',
          category: 'temp_artifacts',
          message: 'Temporary or staging artifact is present in the workspace.',
          evidence: {
            relativePath: normalizeWorkspaceRelativePath(relativePath),
            detail: entry.isDirectory() ? 'kind=directory' : 'kind=file'
          },
          repairability: 'safe_command'
        }))
      }

      if (entry.isDirectory()) {
        if (TEMP_WALK_IGNORED_DIRS.has(name)) continue
        if (current.depth + 1 > MAX_TEMP_WALK_DEPTH) continue
        // Do not recurse into temp directories once reported; their contents
        // are not additional independent findings.
        if (isTempArtifactName(name)) continue
        stack.push({
          absolutePath,
          relativePath: normalizeWorkspaceRelativePath(relativePath),
          depth: current.depth + 1
        })
      }
    }
  }

  return findings
}

function isTempArtifactName(name: string): boolean {
  return TEMP_BASENAME_PATTERNS.some((pattern) => pattern.test(name))
}

function isLessonSummaryShape(value: unknown): value is LessonSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.title === 'string' &&
    typeof record.objective === 'string' &&
    typeof record.prompt === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.durationMinutes === 'number' &&
    typeof record.relativePath === 'string' &&
    typeof record.absolutePath === 'string'
  )
}

function finding(input: Omit<WorkspaceInspectionFinding, never>): WorkspaceInspectionFinding {
  return {
    code: input.code,
    severity: input.severity,
    category: input.category,
    message: input.message,
    evidence: sanitizeEvidence(input.evidence),
    repairability: input.repairability
  }
}

function sanitizeEvidence(evidence: WorkspaceInspectionEvidence): WorkspaceInspectionEvidence {
  const next: WorkspaceInspectionEvidence = {}
  if (typeof evidence.relativePath === 'string' && evidence.relativePath.trim()) {
    next.relativePath = normalizeWorkspaceRelativePath(evidence.relativePath)
  }
  if (typeof evidence.detail === 'string' && evidence.detail.trim()) {
    // Evidence stays machine-safe: no absolute paths, secrets, or raw content.
    next.detail = evidence.detail
      .replace(/[A-Za-z]:\\[^\s"']+/g, '[path]')
      .replace(/\/(?:Users|home|tmp|var|private)\/[^\s"']+/g, '[path]')
  }
  return next
}

function finalizeReport(findings: WorkspaceInspectionFinding[]): WorkspaceInspectionReport {
  const ordered = [...findings].sort((left, right) => {
    const severity = severityRank(left.severity) - severityRank(right.severity)
    if (severity !== 0) return severity
    const code = left.code.localeCompare(right.code)
    if (code !== 0) return code
    return (left.evidence.relativePath ?? '').localeCompare(right.evidence.relativePath ?? '')
  })

  const errorCount = ordered.filter((item) => item.severity === 'error').length
  const warningCount = ordered.filter((item) => item.severity === 'warning').length
  const infoCount = ordered.filter((item) => item.severity === 'info').length

  return {
    schemaVersion: 1,
    readOnly: true,
    inspectedAt: new Date().toISOString(),
    status: errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok',
    findings: ordered,
    summary: {
      findingCount: ordered.length,
      errorCount,
      warningCount,
      infoCount
    }
  }
}

function severityRank(severity: InspectionSeverity): number {
  if (severity === 'error') return 0
  if (severity === 'warning') return 1
  return 2
}
