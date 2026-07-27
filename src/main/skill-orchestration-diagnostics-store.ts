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

import type { SkillOrchestrationPlanDiagnosticsFact } from '../shared/teaching-types/skill-orchestration'

const DIAGNOSTICS_DIRECTORY = ['.agent-sessions', 'skill-orchestration'] as const
const DIAGNOSTICS_FILE = 'plan-diagnostics.json'
const MAX_DIAGNOSTICS_BYTES = 128 * 1024
/** Ring capacity — oldest entries drop first so the file can never grow without bound. */
const MAX_ENTRIES = 200

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
  const directory = join(input.workspaceRoot, ...DIAGNOSTICS_DIRECTORY)
  const path = join(directory, DIAGNOSTICS_FILE)
  const staging = join(directory, `.${DIAGNOSTICS_FILE}.tmp`)

  async function readEntries(): Promise<SkillOrchestrationDiagnosticsEntry[]> {
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_DIAGNOSTICS_BYTES) return []
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isDiagnosticsEntry).slice(-MAX_ENTRIES)
    } catch {
      return []
    }
  }

  return {
    async record(fact, options): Promise<boolean> {
      try {
        const entries = await readEntries()
        entries.push({ ...projectFact(fact), recordedAt: options?.recordedAt ?? new Date().toISOString() })
        const payload = `${JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)}\n`
        if (Buffer.byteLength(payload, 'utf8') > MAX_DIAGNOSTICS_BYTES) return false
        await mkdir(directory, { recursive: true })
        await writeFile(staging, payload, 'utf8')
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
 * Re-project defensively so a caller can never widen the record with extra keys.
 * Only the allow-listed diagnostics shape reaches disk.
 */
function projectFact(fact: SkillOrchestrationPlanDiagnosticsFact): SkillOrchestrationPlanDiagnosticsFact {
  return {
    planId: String(fact.planId ?? ''),
    mode: fact.mode,
    ...(fact.presetId ? { presetId: fact.presetId } : {}),
    stageKinds: [...(fact.stageKinds ?? [])],
    decisionCounts: { ...fact.decisionCounts },
    diagnosticCodes: (fact.diagnosticCodes ?? []).map((entry) => ({
      code: entry.code,
      severity: entry.severity
    }))
  }
}

function isDiagnosticsEntry(value: unknown): value is SkillOrchestrationDiagnosticsEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.planId === 'string' && typeof record.recordedAt === 'string'
}
