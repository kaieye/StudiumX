/**
 * Advanced Technical Inspector (P2-3).
 *
 * Pure, read-only assembler for diagnostic views of typed events, effects,
 * projection reports, run lifecycle, and capability snapshots. Default mode
 * is learner_hidden (empty sections / status hidden). Never mutates the
 * filesystem and never auto-repairs.
 *
 * Future IPC / renderer toggle may call inspectTeachingTech; wiring is out of
 * scope for this module.
 */

import { createHash } from 'node:crypto'

import {
  TECH_INSPECTOR_SCHEMA_VERSION,
  type TechInspectorCapabilityView,
  type TechInspectorEffectView,
  type TechInspectorEventView,
  type TechInspectorFinding,
  type TechInspectorFindingSeverity,
  type TechInspectorInput,
  type TechInspectorMode,
  type TechInspectorProjectionSummary,
  type TechInspectorReport,
  type TechInspectorRunLifecycleView,
  type TechInspectorSection,
  type TechInspectorSectionId,
  type TechInspectorStatus
} from '../shared/teaching-types/tech-inspector'
import { redactAgentSecretText } from '../shared/agent-secret-redaction'

const EMPTY_FINGERPRINT = fingerprintPayload({
  schemaVersion: TECH_INSPECTOR_SCHEMA_VERSION,
  mode: 'learner_hidden',
  status: 'hidden',
  sections: []
})

/**
 * Inspect teaching tech surfaces from pre-normalized views.
 * Read-only pure function: no I/O, no mutation, no auto-repair.
 */
export function inspectTeachingTech(input: TechInspectorInput = {}): TechInspectorReport {
  const mode: TechInspectorMode = input.mode === 'diagnostic' ? 'diagnostic' : 'learner_hidden'
  const generatedAt = typeof input.now === 'function' ? input.now() : undefined

  if (mode === 'learner_hidden') {
    return {
      schemaVersion: TECH_INSPECTOR_SCHEMA_VERSION,
      mode: 'learner_hidden',
      status: 'hidden',
      sections: [],
      fingerprint: EMPTY_FINGERPRINT,
      ...(generatedAt ? { generatedAt: redactText(generatedAt) } : {})
    }
  }

  const sections: TechInspectorSection[] = [
    assembleEventsSection(input.events),
    assembleEffectsSection(input.effects),
    assembleProjectionSection(input.projectionReport),
    assembleRunLifecycleSection(input.runLifecycle),
    assembleCapabilitySection(input.capability)
  ]

  const status = overallStatus(sections)
  const fingerprint = fingerprintPayload({
    schemaVersion: TECH_INSPECTOR_SCHEMA_VERSION,
    mode: 'diagnostic',
    status,
    sections: sections.map(canonicalizeSection)
  })

  return {
    schemaVersion: TECH_INSPECTOR_SCHEMA_VERSION,
    mode: 'diagnostic',
    status,
    sections,
    fingerprint,
    ...(generatedAt ? { generatedAt: redactText(generatedAt) } : {})
  }
}

function assembleEventsSection(
  events: readonly TechInspectorEventView[] | null | undefined
): TechInspectorSection {
  const id: TechInspectorSectionId = 'events'
  if (events == null) {
    return section(id, 'unavailable', [
      finding('events_not_supplied', 'info', 'Event views were not supplied.')
    ])
  }
  if (events.length === 0) {
    return section(id, 'empty', [], { eventCount: 0 })
  }

  const typeCounts = new Map<string, number>()
  const durabilityCounts = new Map<string, number>()
  const findings: TechInspectorFinding[] = []

  for (const event of events) {
    const type = redactText(String(event.type ?? '').trim() || 'unknown')
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
    if (event.durability != null && String(event.durability).trim()) {
      const durability = redactText(String(event.durability).trim())
      durabilityCounts.set(durability, (durabilityCounts.get(durability) ?? 0) + 1)
    }
  }

  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)

  findings.push(
    finding('events_summary', 'info', `Observed ${events.length} pre-normalized event view(s).`, {
      eventCount: events.length,
      distinctTypes: typeCounts.size
    })
  )

  for (const [type, count] of topTypes) {
    findings.push(
      finding('event_type_count', 'info', `Event type ${type}: ${count}`, {
        type,
        count
      })
    )
  }

  const missingIds = events.filter(
    (event) => !event.eventId || !String(event.eventId).trim()
  ).length
  if (missingIds > 0) {
    findings.push(
      finding('events_missing_event_id', 'warning', 'Some event views lack eventId.', {
        missingEventIdCount: missingIds
      })
    )
  }

  const status: TechInspectorStatus = missingIds > 0 ? 'degraded' : 'ok'
  return section(id, status, findings, {
    eventCount: events.length,
    distinctTypes: typeCounts.size,
    durabilityKinds: durabilityCounts.size
  })
}

function assembleEffectsSection(
  effects: readonly TechInspectorEffectView[] | null | undefined
): TechInspectorSection {
  const id: TechInspectorSectionId = 'effects'
  if (effects == null) {
    return section(id, 'unavailable', [
      finding('effects_not_supplied', 'info', 'Effect / tool-outcome views were not supplied.')
    ])
  }
  if (effects.length === 0) {
    return section(id, 'empty', [], { effectCount: 0 })
  }

  const statusCounts = new Map<string, number>()
  const classCounts = new Map<string, number>()
  let failureLike = 0
  const findings: TechInspectorFinding[] = []

  for (const effect of effects) {
    const statusKey = redactText(String(effect.status ?? '').trim() || 'unknown')
    const classKey = redactText(String(effect.effectClass ?? '').trim() || 'unknown')
    statusCounts.set(statusKey, (statusCounts.get(statusKey) ?? 0) + 1)
    classCounts.set(classKey, (classCounts.get(classKey) ?? 0) + 1)
    if (isFailureLikeStatus(statusKey)) failureLike += 1
  }

  findings.push(
    finding('effects_summary', 'info', `Observed ${effects.length} effect / tool-outcome view(s).`, {
      effectCount: effects.length,
      failureLikeCount: failureLike,
      distinctStatuses: statusCounts.size,
      distinctClasses: classCounts.size
    })
  )

  for (const [statusKey, count] of [...statusCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )) {
    const severity: TechInspectorFindingSeverity = isFailureLikeStatus(statusKey)
      ? 'warning'
      : 'info'
    findings.push(
      finding('effect_status_count', severity, `Effect status ${statusKey}: ${count}`, {
        status: statusKey,
        count
      })
    )
  }

  for (const [classKey, count] of [...classCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  )) {
    findings.push(
      finding('effect_class_count', 'info', `Effect class ${classKey}: ${count}`, {
        effectClass: classKey,
        count
      })
    )
  }

  // Surface a few coded failures without freeform content payloads.
  const coded = effects
    .filter((effect) => effect.code && String(effect.code).trim())
    .slice(0, 8)
  for (const effect of coded) {
    findings.push(
      finding('effect_code', isFailureLikeStatus(effect.status) ? 'warning' : 'info', 'Effect code observed.', {
        name: redactText(String(effect.name ?? '').trim() || 'unknown'),
        effectClass: redactText(String(effect.effectClass ?? '').trim() || 'unknown'),
        status: redactText(String(effect.status ?? '').trim() || 'unknown'),
        code: redactText(String(effect.code).trim())
      })
    )
  }

  const status: TechInspectorStatus = failureLike > 0 ? 'degraded' : 'ok'
  return section(id, status, findings, {
    effectCount: effects.length,
    failureLikeCount: failureLike,
    distinctStatuses: statusCounts.size,
    distinctClasses: classCounts.size
  })
}

function assembleProjectionSection(
  summary: TechInspectorProjectionSummary | null | undefined
): TechInspectorSection {
  const id: TechInspectorSectionId = 'projection_report'
  if (summary == null) {
    return section(id, 'unavailable', [
      finding('projection_not_supplied', 'info', 'Projection report summary was not supplied.')
    ])
  }

  const sourceCount = nonNeg(summary.sourceCount)
  const droppedCount = nonNeg(summary.droppedCount ?? 0)
  const fingerprint = redactText(String(summary.fingerprint ?? '').trim())
  const findings: TechInspectorFinding[] = [
    finding(
      'projection_summary',
      droppedCount > 0 ? 'warning' : 'info',
      droppedCount > 0
        ? `Projection dropped ${droppedCount} item(s) from ${sourceCount} source(s).`
        : `Projection summary over ${sourceCount} source(s); none dropped.`,
      {
        sourceCount,
        droppedCount,
        fingerprint: fingerprint || null
      }
    )
  ]

  if (!fingerprint) {
    findings.push(
      finding('projection_missing_fingerprint', 'warning', 'Projection summary lacks a fingerprint.')
    )
  }

  const status: TechInspectorStatus =
    !fingerprint || droppedCount > 0 ? 'degraded' : sourceCount === 0 ? 'empty' : 'ok'

  return section(id, status, findings, { sourceCount, droppedCount })
}

function assembleRunLifecycleSection(
  view: TechInspectorRunLifecycleView | null | undefined
): TechInspectorSection {
  const id: TechInspectorSectionId = 'run_lifecycle'
  if (view == null) {
    return section(id, 'unavailable', [
      finding('run_lifecycle_not_supplied', 'info', 'Run lifecycle view was not supplied.')
    ])
  }

  const runId = view.runId != null && String(view.runId).trim() ? redactText(String(view.runId).trim()) : null
  const state =
    view.state != null && String(view.state).trim() ? redactText(String(view.state).trim()) : null
  const transitions = uniqueStrings(view.legalTransitions).map(redactText)

  const findings: TechInspectorFinding[] = [
    finding('run_lifecycle_summary', 'info', state ? `Run state is ${state}.` : 'Run state is unknown.', {
      runId,
      state,
      legalTransitionCount: transitions.length
    })
  ]

  if (transitions.length > 0) {
    findings.push(
      finding('run_legal_transitions', 'info', 'Legal transitions projected for current state.', {
        legalTransitions: transitions.slice(0, 16).join(','),
        legalTransitionCount: transitions.length
      })
    )
  }

  if (!state) {
    findings.push(finding('run_state_missing', 'warning', 'Run lifecycle view lacks a state.'))
  }

  const status: TechInspectorStatus = !state ? 'degraded' : 'ok'
  return section(id, status, findings, {
    legalTransitionCount: transitions.length,
    hasRunId: runId ? 1 : 0,
    hasState: state ? 1 : 0
  })
}

function assembleCapabilitySection(
  view: TechInspectorCapabilityView | null | undefined
): TechInspectorSection {
  const id: TechInspectorSectionId = 'capability'
  if (view == null) {
    return section(id, 'unavailable', [
      finding('capability_not_supplied', 'info', 'Capability view was not supplied.')
    ])
  }

  const readyCount = nonNeg(view.readyCount)
  const disabledCount = nonNeg(view.disabledCount)
  const unconfiguredCount = nonNeg(view.unconfiguredCount)
  const total = readyCount + disabledCount + unconfiguredCount

  const findings: TechInspectorFinding[] = [
    finding(
      'capability_summary',
      readyCount === 0 && total > 0 ? 'warning' : 'info',
      `Capability snapshot: ready=${readyCount}, disabled=${disabledCount}, unconfigured=${unconfiguredCount}.`,
      {
        readyCount,
        disabledCount,
        unconfiguredCount,
        total
      }
    )
  ]

  if (unconfiguredCount > 0) {
    findings.push(
      finding('capability_unconfigured', 'warning', 'Some capabilities are unconfigured.', {
        unconfiguredCount
      })
    )
  }

  if (disabledCount > 0) {
    findings.push(
      finding('capability_disabled', 'info', 'Some capabilities are disabled.', {
        disabledCount
      })
    )
  }

  let status: TechInspectorStatus = 'ok'
  if (total === 0) status = 'empty'
  else if (readyCount === 0 || unconfiguredCount > 0) status = 'degraded'

  return section(id, status, findings, {
    readyCount,
    disabledCount,
    unconfiguredCount,
    total
  })
}

function overallStatus(sections: readonly TechInspectorSection[]): TechInspectorStatus {
  if (sections.some((item) => item.status === 'degraded')) return 'degraded'
  if (sections.every((item) => item.status === 'unavailable')) return 'unavailable'
  if (sections.every((item) => item.status === 'empty' || item.status === 'unavailable')) {
    return 'empty'
  }
  if (sections.some((item) => item.status === 'ok')) return 'ok'
  if (sections.some((item) => item.status === 'empty')) return 'empty'
  return 'unavailable'
}

function section(
  id: TechInspectorSectionId,
  status: TechInspectorStatus,
  findings: TechInspectorFinding[],
  counts?: Record<string, number>
): TechInspectorSection {
  return {
    id,
    status,
    findings: findings.map(redactFinding),
    ...(counts ? { counts: { ...counts } } : {})
  }
}

function finding(
  code: string,
  severity: TechInspectorFindingSeverity,
  summary: string,
  evidence?: Record<string, string | number | boolean | null>
): TechInspectorFinding {
  return {
    code,
    severity,
    summary: redactText(summary),
    ...(evidence
      ? {
          evidence: Object.fromEntries(
            Object.entries(evidence).map(([key, value]) => [
              key,
              typeof value === 'string' ? redactText(value) : value
            ])
          )
        }
      : {})
  }
}

function redactFinding(item: TechInspectorFinding): TechInspectorFinding {
  return {
    code: item.code,
    severity: item.severity,
    summary: redactText(item.summary),
    ...(item.evidence
      ? {
          evidence: Object.fromEntries(
            Object.entries(item.evidence).map(([key, value]) => [
              key,
              typeof value === 'string' ? redactText(value) : value
            ])
          )
        }
      : {})
  }
}

function canonicalizeSection(item: TechInspectorSection): unknown {
  return {
    id: item.id,
    status: item.status,
    counts: item.counts ?? null,
    findings: item.findings.map((findingItem) => ({
      code: findingItem.code,
      severity: findingItem.severity,
      summary: findingItem.summary,
      evidence: findingItem.evidence ?? null
    }))
  }
}

function fingerprintPayload(payload: unknown): string {
  const canonical = canonicalJson(payload)
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return `sha256:${digest}`
}

function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalJson)
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    out[key] = canonicalJson(record[key])
  }
  return out
}

function isFailureLikeStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase()
  return (
    normalized === 'failed' ||
    normalized === 'denied' ||
    normalized === 'cancelled' ||
    normalized === 'canceled' ||
    normalized === 'timed_out' ||
    normalized === 'error'
  )
}

function nonNeg(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.trunc(value))
}

function uniqueStrings(values: readonly string[] | undefined): string[] {
  if (!values) return []
  return [...new Set(values.map((value) => String(value)).filter(Boolean))].sort()
}

function redactText(value: string): string {
  return redactAgentSecretText(value)
}
