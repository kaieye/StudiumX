import { describe, expect, it } from 'vitest'
import { inspectTeachingTech } from '../../src/main/tech-inspector'
import {
  TECH_INSPECTOR_SCHEMA_VERSION,
  type TechInspectorInput,
  type TechInspectorReport,
  type TechInspectorSectionId
} from '../../src/shared/teaching-types/tech-inspector'

const NOW = '2026-07-20T12:00:00.000Z'

function diagnosticInput(overrides: Partial<TechInspectorInput> = {}): TechInspectorInput {
  return {
    mode: 'diagnostic',
    now: () => NOW,
    events: [
      {
        type: 'quiz_attempted',
        durability: 'durable',
        sessionId: 'session-1',
        turnId: 'turn-1',
        eventId: 'evt-1'
      },
      {
        type: 'quiz_attempted',
        durability: 'durable',
        sessionId: 'session-1',
        eventId: 'evt-2'
      },
      {
        type: 'lesson_opened',
        durability: 'ephemeral',
        sessionId: 'session-1',
        eventId: 'evt-3'
      }
    ],
    effects: [
      {
        name: 'read_workspace_file',
        effectClass: 'read',
        status: 'succeeded'
      },
      {
        name: 'web_search',
        effectClass: 'external_write',
        status: 'failed',
        code: 'provider_timeout'
      }
    ],
    projectionReport: {
      fingerprint: 'sha256:abc123',
      sourceCount: 4,
      droppedCount: 1
    },
    runLifecycle: {
      runId: 'run-1',
      state: 'running',
      legalTransitions: ['await_user', 'request_cancel', 'complete', 'fail', 'interrupt']
    },
    capability: {
      readyCount: 3,
      disabledCount: 1,
      unconfiguredCount: 0
    },
    ...overrides
  }
}

function sectionById(report: TechInspectorReport, id: TechInspectorSectionId) {
  const section = report.sections.find((item) => item.id === id)
  if (!section) throw new Error(`missing section ${id}`)
  return section
}

describe('inspectTeachingTech', () => {
  it('defaults to learner_hidden with empty sections and hidden status', () => {
    const report = inspectTeachingTech()

    expect(report.schemaVersion).toBe(TECH_INSPECTOR_SCHEMA_VERSION)
    expect(report.mode).toBe('learner_hidden')
    expect(report.status).toBe('hidden')
    expect(report.sections).toEqual([])
    expect(report.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('does not leak diagnostic details when mode is learner_hidden even if views are supplied', () => {
    const report = inspectTeachingTech({
      mode: 'learner_hidden',
      events: diagnosticInput().events,
      effects: diagnosticInput().effects,
      projectionReport: diagnosticInput().projectionReport,
      runLifecycle: diagnosticInput().runLifecycle,
      capability: diagnosticInput().capability
    })

    expect(report.mode).toBe('learner_hidden')
    expect(report.status).toBe('hidden')
    expect(report.sections).toEqual([])
    expect(JSON.stringify(report)).not.toMatch(/quiz_attempted|provider_timeout|run-1/)
  })

  it('assembles all five diagnostic sections from pre-normalized views', () => {
    const report = inspectTeachingTech(diagnosticInput())

    expect(report.mode).toBe('diagnostic')
    expect(report.generatedAt).toBe(NOW)
    expect(report.sections.map((section) => section.id)).toEqual([
      'events',
      'effects',
      'projection_report',
      'run_lifecycle',
      'capability'
    ])
    expect(report.status).toBe('degraded')

    const events = sectionById(report, 'events')
    expect(events.status).toBe('ok')
    expect(events.counts?.eventCount).toBe(3)
    expect(events.findings.some((finding) => finding.code === 'event_type_count')).toBe(true)

    const effects = sectionById(report, 'effects')
    expect(effects.status).toBe('degraded')
    expect(effects.counts?.failureLikeCount).toBe(1)
    expect(
      effects.findings.some(
        (finding) => finding.code === 'effect_code' && finding.evidence?.code === 'provider_timeout'
      )
    ).toBe(true)

    const projection = sectionById(report, 'projection_report')
    expect(projection.status).toBe('degraded')
    expect(projection.counts?.droppedCount).toBe(1)

    const lifecycle = sectionById(report, 'run_lifecycle')
    expect(lifecycle.status).toBe('ok')
    expect(lifecycle.findings.some((finding) => finding.evidence?.state === 'running')).toBe(true)

    const capability = sectionById(report, 'capability')
    expect(capability.status).toBe('ok')
    expect(capability.counts?.readyCount).toBe(3)
  })

  it('marks missing optional views as unavailable instead of inventing data', () => {
    const report = inspectTeachingTech({
      mode: 'diagnostic',
      now: () => NOW
    })

    expect(report.sections).toHaveLength(5)
    expect(report.sections.every((section) => section.status === 'unavailable')).toBe(true)
    expect(report.status).toBe('unavailable')
  })

  it('returns empty status for empty arrays / zero capability totals', () => {
    const report = inspectTeachingTech({
      mode: 'diagnostic',
      events: [],
      effects: [],
      projectionReport: { fingerprint: 'sha256:empty', sourceCount: 0, droppedCount: 0 },
      runLifecycle: { runId: 'run-empty', state: 'waiting', legalTransitions: [] },
      capability: { readyCount: 0, disabledCount: 0, unconfiguredCount: 0 }
    })

    expect(sectionById(report, 'events').status).toBe('empty')
    expect(sectionById(report, 'effects').status).toBe('empty')
    expect(sectionById(report, 'projection_report').status).toBe('empty')
    expect(sectionById(report, 'capability').status).toBe('empty')
  })

  it('redacts secret-shaped strings in summaries and evidence', () => {
    const report = inspectTeachingTech({
      mode: 'diagnostic',
      events: [
        {
          type: 'Bearer sk-should-not-leak-abcdefghijklmnop',
          durability: 'durable',
          eventId: 'evt-secret'
        }
      ],
      effects: [
        {
          name: 'tool',
          effectClass: 'read',
          status: 'failed',
          code: 'token=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'
        }
      ],
      projectionReport: {
        fingerprint: 'sha256:ok',
        sourceCount: 1,
        droppedCount: 0
      },
      runLifecycle: {
        runId: 'run-1',
        state: 'failed',
        legalTransitions: ['recover']
      },
      capability: { readyCount: 1, disabledCount: 0, unconfiguredCount: 0 }
    })

    const json = JSON.stringify(report)
    expect(json).not.toMatch(/sk-should-not-leak/)
    expect(json).not.toMatch(/sk-proj-abcdefghijklmnopqrstuvwxyz0123456789/)
    expect(json).toMatch(/\[redacted\]/i)
  })

  it('produces a stable fingerprint for semantically identical diagnostic inputs', () => {
    const first = inspectTeachingTech(diagnosticInput())
    const second = inspectTeachingTech(diagnosticInput())

    expect(first.fingerprint).toBe(second.fingerprint)
    expect(first.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('changes fingerprint when diagnostic facts change', () => {
    const base = inspectTeachingTech(diagnosticInput())
    const changed = inspectTeachingTech(
      diagnosticInput({
        capability: { readyCount: 0, disabledCount: 2, unconfiguredCount: 1 }
      })
    )

    expect(changed.fingerprint).not.toBe(base.fingerprint)
  })

  it('does not mutate deeply frozen input views', () => {
    const input = deepFreeze(diagnosticInput())
    const report = inspectTeachingTech(input)

    expect(report.mode).toBe('diagnostic')
    expect(input.events?.[0]?.type).toBe('quiz_attempted')
    expect(input.capability?.readyCount).toBe(3)
  })

  it('treats unknown mode values as learner_hidden', () => {
    const report = inspectTeachingTech({
      // @ts-expect-error intentional invalid mode for runtime guard
      mode: 'debug',
      events: [{ type: 'quiz_attempted', eventId: 'evt-1' }]
    })

    expect(report.mode).toBe('learner_hidden')
    expect(report.sections).toEqual([])
  })
})

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value as object)) deepFreeze(nested)
  }
  return value
}
