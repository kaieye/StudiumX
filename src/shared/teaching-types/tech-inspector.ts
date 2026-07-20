/**
 * Privacy-safe Advanced Technical Inspector contracts (P2-3).
 *
 * Diagnostic-mode only views of typed events, effects, projection reports,
 * run lifecycle, and capability snapshots. Default mode is learner-hidden.
 * Reports carry redacted summaries only — never raw payloads, learner answers,
 * provider responses, or secrets.
 *
 * Future IPC / renderer toggle may surface these sections; wiring is out of
 * scope here (types + pure assembler only).
 */

export const TECH_INSPECTOR_SCHEMA_VERSION = 1 as const

export type TechInspectorSchemaVersion = typeof TECH_INSPECTOR_SCHEMA_VERSION

/** Visibility mode. Learner UI stays hidden by default. */
export type TechInspectorMode = 'learner_hidden' | 'diagnostic'

/** Stable section ids for structured tech inspector reports. */
export type TechInspectorSectionId =
  | 'events'
  | 'effects'
  | 'projection_report'
  | 'run_lifecycle'
  | 'capability'

/** Report / section status ladder. */
export type TechInspectorStatus =
  | 'hidden'
  | 'ok'
  | 'empty'
  | 'degraded'
  | 'unavailable'

/** Finding severity for diagnostic summaries only. */
export type TechInspectorFindingSeverity = 'info' | 'warning' | 'error'

/**
 * Single redacted finding. Summaries and evidence fields must already be
 * secret-free or pass through redaction before export.
 */
export type TechInspectorFinding = {
  code: string
  severity: TechInspectorFindingSeverity
  /** Short, redacted, human-readable summary — no freeform secret payloads. */
  summary: string
  /** Bounded, redacted key/value pairs safe for diagnostic export. */
  evidence?: Readonly<Record<string, string | number | boolean | null>>
}

/** Pre-normalized event view accepted by the assembler (no freeform payloads). */
export type TechInspectorEventView = {
  type: string
  durability?: string
  sessionId?: string
  turnId?: string
  eventId?: string
}

/** Pre-normalized effect / tool-outcome view. */
export type TechInspectorEffectView = {
  name: string
  effectClass: string
  status: string
  code?: string
}

/**
 * Projection-report summary derived from ContextProjectionReport shape.
 * Full included/omitted item lists are not required for the inspector view.
 */
export type TechInspectorProjectionSummary = {
  fingerprint: string
  sourceCount: number
  droppedCount?: number
}

/** Run lifecycle summary (state machine projection only). */
export type TechInspectorRunLifecycleView = {
  runId?: string
  state?: string
  legalTransitions?: readonly string[]
}

/** Capability catalog counts only. */
export type TechInspectorCapabilityView = {
  readyCount: number
  disabledCount: number
  unconfiguredCount: number
}

/** One section of the inspector report. */
export type TechInspectorSection = {
  id: TechInspectorSectionId
  status: TechInspectorStatus
  findings: readonly TechInspectorFinding[]
  /** Optional redacted count summary for the section. */
  counts?: Readonly<Record<string, number>>
}

/**
 * Assembled tech inspector report. Fingerprint is deterministic and secret-free
 * for the same normalized inputs + mode.
 */
export type TechInspectorReport = {
  schemaVersion: TechInspectorSchemaVersion
  mode: TechInspectorMode
  status: TechInspectorStatus
  sections: readonly TechInspectorSection[]
  /** Deterministic `sha256:<hex>` of secret-free section facts. */
  fingerprint: string
  generatedAt?: string
}

/**
 * Pure input for inspectTeachingTech. Callers (collectors / future IPC) own I/O
 * and must pre-normalize views so freeform secret payloads never enter.
 */
export type TechInspectorInput = {
  mode?: TechInspectorMode
  events?: readonly TechInspectorEventView[] | null
  effects?: readonly TechInspectorEffectView[] | null
  projectionReport?: TechInspectorProjectionSummary | null
  runLifecycle?: TechInspectorRunLifecycleView | null
  capability?: TechInspectorCapabilityView | null
  /** Injected clock for deterministic reports in tests. */
  now?: () => string
}
