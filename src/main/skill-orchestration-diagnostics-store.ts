/**
 * Local skill orchestration plan diagnostics (ADR-0163 §2.6).
 *
 * A bounded, append-only local ring of allow-listed plan facts so Doctor /
 * support-bundle inspection can answer "did the planner pick the right stage,
 * and how often are capabilities excluded or blocked?".
 *
 * Boundaries:
 * - identifiers, enums and counts ONLY — the record shape has nowhere to put
 *   objective text, skill bodies, workspace paths, secrets or learner Evidence;
 * - local-first: never phoned home, never default remote telemetry;
 * - zero authority: never a settlement input, never read back into planning.
 *   Deleting the file loses observability and nothing else.
 */

import { mkdir, readFile, rename, rm, writeFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { sanitizeSkillOrchestrationPresetId } from '../shared/skill-orchestration-presets'
import type {
  SkillOrchestrationDecisionStatus,
  SkillOrchestrationEvaluationSummary,
  SkillOrchestrationGateDiagnosticsFact,
  SkillOrchestrationPlanDiagnosticsFact,
  SkillOrchestrationPromptBudgetFact,
  SkillOrchestrationStageKind,
  SkillOrchestrationTeachingCompletenessFact
} from '../shared/teaching-types/skill-orchestration'

const DIAGNOSTICS_DIRECTORY = ['.agent-sessions', 'skill-orchestration'] as const
const DIAGNOSTICS_FILE = 'plan-diagnostics.json'
const MAX_DIAGNOSTICS_BYTES = 128 * 1024
/** Ring capacity — oldest entries drop first so the file can never grow without bound. */
const MAX_ENTRIES = 200
const MAX_STAGE_KINDS = 8
const MAX_DIAGNOSTIC_CODES = 32
const MAX_DECISION_COUNT = 64
const MAX_STAGE_SKILL_COUNT = 64
const MAX_PROMPT_CHAR_COUNT = 10_000_000
const MAX_GATE_COUNT = 512
const MAX_SUMMARY_COUNT = Number.MAX_SAFE_INTEGER
const SAFE_PLAN_ID = /^sop1_[0-9a-f]{8}$/
const MODES = new Set(['instant_help', 'teaching_turn', 'artifact_workflow'])
const STAGE_KINDS = new Set([
  'ground', 'diagnose', 'teach', 'elicit', 'artifact_authoring', 'enhance', 'verify', 'package'
])
const DECISION_STATUSES = [
  'active_now', 'scheduled_later', 'advisory_only', 'excluded', 'blocked'
] as const satisfies readonly SkillOrchestrationDecisionStatus[]
const DIAGNOSTIC_CODES = new Set([
  'unknown_skill',
  'skill_not_ready',
  'missing_dependency',
  'budget_defer',
  'missing_artifacts',
  'artifact_scope_conflict'
])
const DIAGNOSTIC_SEVERITIES = new Set(['info', 'warning', 'blocking'])

export type SkillOrchestrationDiagnosticsEntry = SkillOrchestrationPlanDiagnosticsFact & {
  recordedAt: string
}

export type SkillOrchestrationDiagnosticsStore = {
  /** Append one plan fact. Fail-soft: returns false, never throws, never blocks a turn. */
  record: (
    fact: SkillOrchestrationPlanDiagnosticsFact,
    options?: { recordedAt?: string }
  ) => Promise<boolean>
  /** Read the local ring for Doctor / support bundle. Fail-soft to []. */
  list: () => Promise<SkillOrchestrationDiagnosticsEntry[]>
}

export function createSkillOrchestrationDiagnosticsStore(input: {
  workspaceRoot: string
}): SkillOrchestrationDiagnosticsStore {
  const sessionDirectory = join(input.workspaceRoot, DIAGNOSTICS_DIRECTORY[0])
  const directory = join(sessionDirectory, DIAGNOSTICS_DIRECTORY[1])
  const path = join(directory, DIAGNOSTICS_FILE)
  const staging = join(directory, `.${DIAGNOSTICS_FILE}.tmp`)

  async function readEntries(): Promise<SkillOrchestrationDiagnosticsEntry[]> {
    try {
      if (!(await hasSafeStorageDirectory(sessionDirectory, directory))) return []
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_DIAGNOSTICS_BYTES) return []
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed
        .map(normalizeDiagnosticsEntry)
        .filter((entry): entry is SkillOrchestrationDiagnosticsEntry => entry !== null)
        .slice(-MAX_ENTRIES)
    } catch {
      return []
    }
  }

  return {
    async record(fact, options): Promise<boolean> {
      try {
        const projected = normalizeDiagnosticsFact(fact)
        const recordedAt = normalizeIsoTimestamp(options?.recordedAt ?? new Date().toISOString())
        if (!projected || !recordedAt) return false
        const entries = await readEntries()
        entries.push({ ...projected, recordedAt })
        const payload = `${JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)}\n`
        if (Buffer.byteLength(payload, 'utf8') > MAX_DIAGNOSTICS_BYTES) return false
        if (!(await ensureSafeStorageDirectory(sessionDirectory, directory))) return false
        // Remove only the staging directory entry itself, then create it with
        // O_EXCL so an attacker cannot redirect a predictable tmp filename.
        await rm(staging, { force: true })
        await writeFile(staging, payload, { encoding: 'utf8', flag: 'wx' })
        await rename(staging, path)
        return true
      } catch {
        await rm(staging, { force: true }).catch(() => {})
        return false
      }
    },

    list: readEntries
  }
}

/**
 * Re-project and validate before persistence. Invalid caller data is rejected,
 * rather than coerced into a wider or free-form local telemetry record.
 */
function normalizeDiagnosticsFact(value: unknown): SkillOrchestrationPlanDiagnosticsFact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const planId = record.planId
  if (typeof planId !== 'string' || !SAFE_PLAN_ID.test(planId)) return null

  const mode = record.mode
  if (typeof mode !== 'string' || !MODES.has(mode)) return null

  let presetId: string | undefined
  if (record.presetId !== undefined) {
    if (typeof record.presetId !== 'string') return null
    presetId = sanitizeSkillOrchestrationPresetId(record.presetId)
    if (!presetId || presetId !== record.presetId) return null
  }

  const stageKinds = normalizeStageKinds(record.stageKinds)
  const currentStageKind = normalizeOptionalStageKind(record.currentStageKind)
  const currentStageSkillCount = normalizeBoundedCount(record.currentStageSkillCount, MAX_STAGE_SKILL_COUNT)
  const decisionCounts = normalizeDecisionCounts(record.decisionCounts)
  const diagnosticCodes = normalizeDiagnosticCodes(record.diagnosticCodes)
  const promptBudget = normalizePromptBudget(record.promptBudget)
  const gates = normalizeGateDiagnostics(record.gates)
  const teachingCompleteness = normalizeTeachingCompleteness(record.teachingCompleteness)
  if (
    !stageKinds ||
    currentStageKind === null ||
    currentStageSkillCount === null ||
    !decisionCounts ||
    !diagnosticCodes ||
    record.userOverrideStatus !== 'not_supported' ||
    !promptBudget ||
    !gates ||
    !teachingCompleteness
  ) return null
  if (currentStageKind !== undefined && !stageKinds.includes(currentStageKind)) return null

  return {
    planId,
    mode: mode as SkillOrchestrationPlanDiagnosticsFact['mode'],
    ...(presetId ? { presetId } : {}),
    stageKinds,
    ...(currentStageKind ? { currentStageKind } : {}),
    currentStageSkillCount,
    decisionCounts,
    diagnosticCodes,
    userOverrideStatus: 'not_supported',
    promptBudget,
    gates,
    teachingCompleteness
  }
}


function normalizeOptionalStageKind(value: unknown): SkillOrchestrationStageKind | undefined | null {
  if (value === undefined) return undefined
  return typeof value === 'string' && STAGE_KINDS.has(value)
    ? value as SkillOrchestrationStageKind
    : null
}

function normalizeBoundedCount(value: unknown, max: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max
    ? value as number
    : null
}

function normalizePromptBudget(value: unknown): SkillOrchestrationPromptBudgetFact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const fields = [
    'kernelBudgetChars',
    'kernelInputChars',
    'kernelIncludedChars',
    'dynamicBudgetChars',
    'dynamicInputChars',
    'dynamicIncludedChars',
    'truncatedBodyCount'
  ] as const
  if (Object.keys(record).length !== fields.length || fields.some((field) => !(field in record))) return null
  const normalized = Object.fromEntries(fields.map((field) => [
    field,
    normalizeBoundedCount(
      record[field],
      field === 'truncatedBodyCount' ? MAX_STAGE_SKILL_COUNT + 1 : MAX_PROMPT_CHAR_COUNT
    )
  ])) as Record<(typeof fields)[number], number | null>
  if (fields.some((field) => normalized[field] === null)) return null
  if (
    (normalized.kernelIncludedChars as number) > (normalized.kernelBudgetChars as number) ||
    (normalized.kernelIncludedChars as number) > (normalized.kernelInputChars as number) ||
    (normalized.dynamicIncludedChars as number) > (normalized.dynamicBudgetChars as number) ||
    (normalized.dynamicIncludedChars as number) > (normalized.dynamicInputChars as number)
  ) return null
  return normalized as SkillOrchestrationPromptBudgetFact
}

function normalizeGateDiagnostics(value: unknown): SkillOrchestrationGateDiagnosticsFact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== 3) return null
  const checkedCount = normalizeBoundedCount(record.checkedCount, MAX_GATE_COUNT)
  const passedCount = normalizeBoundedCount(record.passedCount, MAX_GATE_COUNT)
  const failedCount = normalizeBoundedCount(record.failedCount, MAX_GATE_COUNT)
  if (checkedCount === null || passedCount === null || failedCount === null) return null
  if (passedCount + failedCount !== checkedCount) return null
  return { checkedCount, passedCount, failedCount }
}

function normalizeTeachingCompleteness(value: unknown): SkillOrchestrationTeachingCompletenessFact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const fields = ['applicable', 'elicitStagePresent', 'evidenceStatusPresent', 'nextStepActionPresent'] as const
  if (Object.keys(record).length !== fields.length || fields.some((field) => typeof record[field] !== 'boolean')) {
    return null
  }
  if (record.applicable !== true && fields.slice(1).some((field) => record[field] !== false)) return null
  return Object.fromEntries(fields.map((field) => [field, record[field]])) as SkillOrchestrationTeachingCompletenessFact
}

function addBounded(left: number, right: number): number {
  return Math.min(MAX_SUMMARY_COUNT, left + right)
}

/** Aggregate local diagnostics into a consentable counts-only Phase 6 summary. */
export function buildSkillOrchestrationEvaluationSummary(
  entries: readonly SkillOrchestrationDiagnosticsEntry[]
): SkillOrchestrationEvaluationSummary {
  const summary: SkillOrchestrationEvaluationSummary = {
    schemaVersion: 1,
    planCount: 0,
    stageSelectionCounts: {},
    unresolvedStageCount: 0,
    conflictExclusionCount: 0,
    overrideSupported: false,
    overrideCount: 0,
    promptBudget: { inputChars: 0, includedChars: 0, budgetChars: 0, truncatedBodyCount: 0 },
    gates: { checkedCount: 0, passedCount: 0, failedCount: 0, passRate: null },
    teachingCompleteness: {
      applicablePlanCount: 0,
      elicitPresentCount: 0,
      evidenceStatusPresentCount: 0,
      nextStepActionPresentCount: 0
    }
  }

  for (const candidate of entries.slice(-MAX_ENTRIES)) {
    const entry = normalizeDiagnosticsEntry(candidate)
    if (!entry) continue
    summary.planCount = addBounded(summary.planCount, 1)
    if (entry.currentStageKind) {
      summary.stageSelectionCounts[entry.currentStageKind] = addBounded(
        summary.stageSelectionCounts[entry.currentStageKind] ?? 0,
        1
      )
    } else {
      summary.unresolvedStageCount = addBounded(summary.unresolvedStageCount, 1)
    }
    summary.conflictExclusionCount = addBounded(
      summary.conflictExclusionCount,
      entry.diagnosticCodes.filter((item) => item.code === 'artifact_scope_conflict').length
    )
    summary.promptBudget.inputChars = addBounded(
      summary.promptBudget.inputChars,
      entry.promptBudget.kernelInputChars + entry.promptBudget.dynamicInputChars
    )
    summary.promptBudget.includedChars = addBounded(
      summary.promptBudget.includedChars,
      entry.promptBudget.kernelIncludedChars + entry.promptBudget.dynamicIncludedChars
    )
    summary.promptBudget.budgetChars = addBounded(
      summary.promptBudget.budgetChars,
      entry.promptBudget.kernelBudgetChars + entry.promptBudget.dynamicBudgetChars
    )
    summary.promptBudget.truncatedBodyCount = addBounded(
      summary.promptBudget.truncatedBodyCount,
      entry.promptBudget.truncatedBodyCount
    )
    summary.gates.checkedCount = addBounded(summary.gates.checkedCount, entry.gates.checkedCount)
    summary.gates.passedCount = addBounded(summary.gates.passedCount, entry.gates.passedCount)
    summary.gates.failedCount = addBounded(summary.gates.failedCount, entry.gates.failedCount)
    if (entry.teachingCompleteness.applicable) {
      const teaching = summary.teachingCompleteness
      teaching.applicablePlanCount = addBounded(teaching.applicablePlanCount, 1)
      if (entry.teachingCompleteness.elicitStagePresent) {
        teaching.elicitPresentCount = addBounded(teaching.elicitPresentCount, 1)
      }
      if (entry.teachingCompleteness.evidenceStatusPresent) {
        teaching.evidenceStatusPresentCount = addBounded(teaching.evidenceStatusPresentCount, 1)
      }
      if (entry.teachingCompleteness.nextStepActionPresent) {
        teaching.nextStepActionPresentCount = addBounded(teaching.nextStepActionPresentCount, 1)
      }
    }
  }
  summary.gates.passRate = summary.gates.checkedCount > 0
    ? summary.gates.passedCount / summary.gates.checkedCount
    : null
  return summary
}

function normalizeDiagnosticsEntry(value: unknown): SkillOrchestrationDiagnosticsEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const fact = normalizeDiagnosticsFact(record)
  const recordedAt = normalizeIsoTimestamp(record.recordedAt)
  return fact && recordedAt ? { ...fact, recordedAt } : null
}

function normalizeStageKinds(value: unknown): SkillOrchestrationStageKind[] | null {
  if (!Array.isArray(value) || value.length > MAX_STAGE_KINDS) return null
  const stageKinds: SkillOrchestrationStageKind[] = []
  for (const kind of value) {
    if (typeof kind !== 'string' || !STAGE_KINDS.has(kind) || stageKinds.includes(kind as SkillOrchestrationStageKind)) {
      return null
    }
    stageKinds.push(kind as SkillOrchestrationStageKind)
  }
  return stageKinds
}

function normalizeDecisionCounts(
  value: unknown
): Record<SkillOrchestrationDecisionStatus, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== DECISION_STATUSES.length || keys.some((key) => !DECISION_STATUSES.includes(key as SkillOrchestrationDecisionStatus))) {
    return null
  }
  const counts = {} as Record<SkillOrchestrationDecisionStatus, number>
  for (const status of DECISION_STATUSES) {
    const count = record[status]
    if (!Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > MAX_DECISION_COUNT) {
      return null
    }
    counts[status] = count as number
  }
  return counts
}

function normalizeDiagnosticCodes(
  value: unknown
): SkillOrchestrationPlanDiagnosticsFact['diagnosticCodes'] | null {
  if (!Array.isArray(value) || value.length > MAX_DIAGNOSTIC_CODES) return null
  const diagnostics: SkillOrchestrationPlanDiagnosticsFact['diagnosticCodes'] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const record = entry as Record<string, unknown>
    if (
      typeof record.code !== 'string' ||
      !DIAGNOSTIC_CODES.has(record.code) ||
      typeof record.severity !== 'string' ||
      !DIAGNOSTIC_SEVERITIES.has(record.severity)
    ) {
      return null
    }
    diagnostics.push({
      code: record.code,
      severity: record.severity as SkillOrchestrationPlanDiagnosticsFact['diagnosticCodes'][number]['severity']
    })
  }
  return diagnostics
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : value
}

async function hasSafeStorageDirectory(sessionDirectory: string, directory: string): Promise<boolean> {
  return (await isRegularDirectory(sessionDirectory)) && (await isRegularDirectory(directory))
}

async function ensureSafeStorageDirectory(sessionDirectory: string, directory: string): Promise<boolean> {
  return (await ensureRegularDirectory(sessionDirectory)) && (await ensureRegularDirectory(directory))
}

async function ensureRegularDirectory(path: string): Promise<boolean> {
  const existing = await lstat(path).catch(() => null)
  if (existing) return existing.isDirectory() && !existing.isSymbolicLink()
  await mkdir(path)
  return isRegularDirectory(path)
}

async function isRegularDirectory(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null)
  return Boolean(info?.isDirectory() && !info.isSymbolicLink())
}
