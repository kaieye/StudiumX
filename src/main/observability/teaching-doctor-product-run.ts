/**
 * Product-facing TeachingDoctor run assembler (B-11 residual / ADR-0007).
 *
 * Multi-collector pure facts assemble (optional deps.factsCollectors), then process
 * crash-marker facts from an injected store (source of truth when
 * includeProcessCrashMarker is true), runs pure TeachingDoctor, and returns an
 * export-safe redacted report for renderer IPC.
 *
 * Gateway may later inject collectors from the composition root; this module does
 * not change the public IPC payload (still no free-form facts from renderer).
 *
 * Non-claims:
 * - no auto-repair
 * - no auto-upload / remote telemetry
 * - no automatic crash-marker clear on run
 * - no shell / MCP marketplace
 */

import {
  exportTeachingDoctorReport,
  runTeachingDoctor
} from '../teaching-doctor'
import type {
  TeachingDoctorFacts,
  TeachingDoctorReport
} from '../../shared/teaching-types/teaching-doctor'
import type { CrashMarker } from './crash-marker'
import { collectProcessCrashMarkerFacts } from './process-crash-marker-facts'
import {
  assembleTeachingDoctorFacts,
  type TeachingDoctorFactsCollector
} from './teaching-doctor-facts-assemble'

export type RunProductTeachingDoctorInput = {
  /**
   * Optional partial facts from the caller (tests / multi-collector base).
   * Product IPC currently starts empty for non-marker checks (they stay skipped
   * unless composition root injects factsCollectors).
   * processCrashMarker is overwritten from the store when include is true.
   */
  facts?: TeachingDoctorFacts | null
  /** When true (default), collect process crash marker if a store is provided. */
  includeProcessCrashMarker?: boolean
}

export type ProductTeachingDoctorCrashMarkerStore = {
  read(): Promise<CrashMarker | null>
}

export type ProductTeachingDoctorDeps = {
  crashMarkerStore?: ProductTeachingDoctorCrashMarkerStore | null
  /** Injected clock for deterministic reports in tests. */
  now?: () => string
  /**
   * Optional multi-collectors run before processCrashMarker store overwrite.
   * Composition root / gateway may inject these later without changing IPC payload.
   */
  factsCollectors?: readonly TeachingDoctorFactsCollector[]
}

/**
 * Assemble facts (multi-collectors + process crash marker store as SoT when
 * enabled), run pure doctor, and return an export-safe report. Collector and
 * store read failures are fail-soft and never throw secrets or absolute paths.
 */
export async function runProductTeachingDoctor(
  input: RunProductTeachingDoctorInput | undefined,
  deps: ProductTeachingDoctorDeps
): Promise<TeachingDoctorReport> {
  // 1) Multi-collector pure assemble (base + ordered collectors; fail-soft).
  const facts = await assembleTeachingDoctorFacts({
    base: input?.facts,
    collectors: deps.factsCollectors
  })

  // 2) processCrashMarker store remains product SoT when include is true.
  const includeMarker = input?.includeProcessCrashMarker !== false
  if (includeMarker && deps.crashMarkerStore) {
    facts.processCrashMarker = await collectProcessCrashMarkerFacts(deps.crashMarkerStore)
  }

  // 3) Pure doctor + export-safe redaction.
  const generatedAt = (deps.now ?? (() => new Date().toISOString()))()
  const report = runTeachingDoctor(facts, generatedAt)
  return exportTeachingDoctorReport(report)
}
