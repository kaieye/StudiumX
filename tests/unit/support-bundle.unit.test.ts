import { describe, expect, it } from 'vitest'
import {
  exportSupportBundle,
  previewSupportBundle,
  type SupportBundleInput
} from '../../src/main/support-bundle'
import { runTeachingDoctor } from '../../src/main/teaching-doctor'
import type { TeachingDoctorFacts } from '../../src/shared/teaching-types/teaching-doctor'
import {
  DEFAULT_SUPPORT_BUNDLE_REDACTION_POLICY,
  SUPPORT_BUNDLE_SCHEMA_VERSION,
  type SupportBundleConsent
} from '../../src/shared/teaching-types/support-bundle'
import {
  TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
  type TeachingAuditSafeMetadata
} from '../../src/main/teaching-audit-correlation'
import type { WorkspaceInspectionReport } from '../../src/main/teaching-workspace-inspector'

const NOW = '2026-07-20T12:00:00.000Z'
const WORKSPACE_ROOT = 'C:/Users/alice/Documents/studiumx-workspace'

function doctorFacts(overrides: Partial<TeachingDoctorFacts> = {}): TeachingDoctorFacts {
  return {
    sessionCrashWindow: {
      pendingStageCount: 0,
      unsafeStageCount: 0,
      quarantinedSessionCount: 0,
      recoveryCount: 0,
      diagnosticCodes: [],
      eventManifestGapCount: 0
    },
    outcomeCrashWindow: {
      pendingSettlementCount: 0,
      needsProjectionRepairCount: 0,
      reviewRequiredCount: 0,
      settledCount: 1
    },
    config: {
      settingsAvailable: true,
      settingsReadable: true,
      settingsParseable: true,
      providerConfigured: true,
      reason: null
    },
    sourceGap: {
      status: 'ready',
      availableSourceCount: 1,
      exclusionCodes: [],
      gapCount: 0
    },
    catalogDrift: {
      requiresPersist: false,
      recoveredCount: 0,
      removedCount: 0,
      recoveredRelativePaths: [],
      removedRelativePaths: []
    },
    ...overrides
  }
}

function sampleInspector(): WorkspaceInspectionReport {
  return {
    schemaVersion: 1,
    readOnly: true,
    inspectedAt: NOW,
    status: 'warning',
    findings: [
      {
        code: 'dangling_lesson_path',
        severity: 'warning',
        category: 'dangling_links',
        message: `Missing lesson at ${WORKSPACE_ROOT}/lessons/intro.md with apiKey sk-live-should-not-leak-abcdef0123456789`,
        evidence: {
          relativePath: 'lessons/intro.md',
          detail: `absolute=${WORKSPACE_ROOT}/lessons/intro.md`
        },
        repairability: 'manual'
      }
    ],
    summary: {
      findingCount: 1,
      errorCount: 0,
      warningCount: 1,
      infoCount: 0
    }
  }
}

function sampleAudit(): TeachingAuditSafeMetadata {
  return {
    schemaVersion: TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
    kind: 'teaching_audit',
    correlation: {
      sessionId: 'session-support-1',
      turnId: 'turn-support-1',
      operationId: 'op-support-1'
    },
    toolName: 'web_fetch',
    effectClass: 'read',
    isError: false
  }
}

function fullInput(overrides: Partial<SupportBundleInput> = {}): SupportBundleInput {
  return {
    now: () => NOW,
    workspaceRoot: WORKSPACE_ROOT,
    doctor: runTeachingDoctor(doctorFacts(), NOW),
    inspector: sampleInspector(),
    configFingerprint: {
      fingerprint: 'sha256:abc123',
      sources: [
        { path: 'provider.activeProviderId', source: 'user' },
        { path: `${WORKSPACE_ROOT}/.studiumx/settings.json`, source: 'workspace' }
      ],
      diagnostics: [
        {
          code: 'secret_stripped',
          severity: 'warning',
          source: 'user',
          path: 'provider.providers.0.apiKey',
          message: 'Secret field stripped; raw=sk-proj-should-not-export-XYZ0123456789ABCDEF'
        }
      ],
      valueSummary: {
        activeProviderId: 'openai',
        toolsEnabled: true
      }
    },
    capability: {
      generatedAt: NOW,
      policyId: 'teaching',
      totalCount: 3,
      availableCount: 1,
      countsByStatus: { available: 1, disabled: 1, unconfigured: 1 },
      countsByKind: { model_provider: 1, web_search: 1, skill: 1 },
      items: [
        {
          id: 'model:openai',
          kind: 'model_provider',
          name: 'OpenAI',
          status: 'available',
          reason: 'configured',
          promptEligible: true
        }
      ]
    },
    auditCorrelation: sampleAudit(),
    environment: {
      platform: 'win32',
      appVersion: '0.1.0',
      electronVersion: '33.0.0',
      nodeVersion: '20.0.0',
      arch: 'x64'
    },
    localDataIndex: {
      pathExists: true,
      indexPathLabel: 'userData/studiumx-index.sqlite',
      status: 'ready',
      reason: null,
      complete: true,
      rebuiltAt: NOW,
      version: '2',
      migrationIds: ['0001', '0002'],
      appliedMigrations: [
        {
          id: '0001',
          checksum: 'a' * 64,
          appliedAt: NOW,
          appVersion: '0.1.0',
          appliedBy: 'local-data-index',
          sqlBytes: 1200
        }
      ],
      issueCountsByCode: {},
      issueCount: 0,
      projectionRowCounts: {
        conversation_projection: 2,
        memory_projection: 1
      }
    },
    ...overrides
  }
}

describe('support bundle', () => {
  it('previews redacted sections and strips secrets and absolute paths', () => {
    const preview = previewSupportBundle(fullInput())
    const json = JSON.stringify(preview)

    expect(preview.schemaVersion).toBe(SUPPORT_BUNDLE_SCHEMA_VERSION)
    expect(preview.generatedAt).toBe(NOW)
    expect(preview.redactionPolicy).toEqual(DEFAULT_SUPPORT_BUNDLE_REDACTION_POLICY)
    expect(preview.sections.map((section) => section.id)).toEqual([
      'doctor',
      'inspector',
      'config_fingerprint',
      'capability',
      'audit_correlation',
      'environment',
      'local_data_index'
    ])

    expect(json).not.toMatch(/sk-live-should-not-leak/)
    expect(json).not.toMatch(/sk-proj-should-not-export/)
    expect(json).not.toMatch(/C:\/Users\/alice/)
    expect(json).not.toMatch(/C:\\\\Users\\\\alice/i)
    expect(json).toMatch(/\[redacted\]|redacted-absolute-path|lessons\/intro\.md/)

    const inspector = preview.sections.find((section) => section.id === 'inspector')
    expect(inspector).toBeTruthy()
    const inspectorJson = JSON.stringify(inspector?.payload)
    expect(inspectorJson).toContain('lessons/intro.md')
    expect(inspectorJson).not.toContain(WORKSPACE_ROOT)
    expect(inspectorJson).toMatch(/\[redacted\]/)

    const config = preview.sections.find((section) => section.id === 'config_fingerprint')
    expect(config).toBeTruthy()
    const configJson = JSON.stringify(config?.payload)
    expect(configJson).toContain('sha256:abc123')
    expect(configJson).not.toContain('sk-proj-should-not-export')
    expect(configJson).toContain('.studiumx/settings.json')
    expect(configJson).not.toContain('C:/Users/alice')
  })

  it('export without consent fails with consent_required', () => {
    const preview = previewSupportBundle(fullInput())

    const denied = exportSupportBundle(preview, null)
    expect(denied).toMatchObject({ ok: false, code: 'consent_required' })

    const partial = exportSupportBundle(preview, {
      accepted: false as unknown as true,
      acceptedAt: NOW,
      sectionsAllowed: ['doctor']
    } as SupportBundleConsent)
    expect(partial).toMatchObject({ ok: false, code: 'consent_required' })
  })

  it('export honors section allowlist and rejects sections not in preview', () => {
    const preview = previewSupportBundle(fullInput())
    const consent: SupportBundleConsent = {
      accepted: true,
      acceptedAt: NOW,
      sectionsAllowed: ['doctor', 'environment']
    }

    const exported = exportSupportBundle(preview, consent, { now: () => NOW })
    expect('ok' in exported && exported.ok === false).toBe(false)
    if ('ok' in exported && exported.ok === false) throw new Error('unexpected failure')

    expect(exported.schemaVersion).toBe(1)
    expect(exported.exportedAt).toBe(NOW)
    expect(exported.consent.sectionsAllowed).toEqual(['doctor', 'environment'])
    expect(exported.sections.map((section) => section.id)).toEqual(['doctor', 'environment'])
    expect(exported.redactionPolicy.noRawPrompts).toBe(true)
    expect(exported.redactionPolicy.noApiKeys).toBe(true)
    expect(exported.redactionPolicy.noAbsoluteHomePaths).toBe(true)
    expect(exported.redactionPolicy.noLearnerAnswers).toBe(true)

    const missing = exportSupportBundle(
      {
        ...preview,
        sections: preview.sections.filter((section) => section.id === 'doctor')
      },
      {
        accepted: true,
        acceptedAt: NOW,
        sectionsAllowed: ['doctor', 'capability']
      }
    )
    expect(missing).toMatchObject({ ok: false, code: 'section_not_previewed' })
  })

  it('doctor fail is still exportable after consent', () => {
    const failingDoctor = runTeachingDoctor(
      doctorFacts({
        sessionCrashWindow: {
          pendingStageCount: 1,
          unsafeStageCount: 0,
          quarantinedSessionCount: 0,
          recoveryCount: 0,
          diagnosticCodes: ['stale_session_stage'],
          eventManifestGapCount: 2
        }
      }),
      NOW
    )
    expect(failingDoctor.overallStatus).toBe('fail')

    const preview = previewSupportBundle({
      now: () => NOW,
      doctor: failingDoctor,
      environment: { platform: 'darwin', appVersion: '0.1.0' }
    })

    const doctorSection = preview.sections.find((section) => section.id === 'doctor')
    expect(doctorSection).toBeTruthy()
    expect(JSON.stringify(doctorSection?.payload)).toContain('"overallStatus":"fail"')
    expect(doctorSection?.warnings.some((warning) => /exportable/i.test(warning))).toBe(true)

    const exported = exportSupportBundle(preview, {
      accepted: true,
      acceptedAt: NOW,
      sectionsAllowed: ['doctor']
    }, { now: () => NOW })

    if ('ok' in exported && exported.ok === false) {
      throw new Error(`export failed: ${exported.code}`)
    }
    expect(exported.sections).toHaveLength(1)
    expect(exported.sections[0]?.id).toBe('doctor')
    expect(JSON.stringify(exported.sections[0]?.payload)).toContain('"overallStatus":"fail"')
  })

  it('strips denied free-text fields such as learner answers and prompts', () => {
    const preview = previewSupportBundle({
      now: () => NOW,
      auditCorrelation: {
        schemaVersion: TEACHING_AUDIT_CORRELATION_SCHEMA_VERSION,
        kind: 'teaching_audit',
        correlation: { sessionId: 's1', turnId: 't1' },
        // @ts-expect-error intentional smuggled fields for redaction coverage
        learnerAnswer: 'full free text learner answer must not export',
        prompt: 'raw system prompt must not export',
        apiKey: 'sk-live-smuggled-key-0123456789abcdef'
      } as TeachingAuditSafeMetadata
    })

    const json = JSON.stringify(preview)
    expect(json).not.toContain('full free text learner answer')
    expect(json).not.toContain('raw system prompt')
    expect(json).not.toContain('sk-live-smuggled-key')
  })
  it('packs aggregate-only local data index diagnostics and redacts absolute paths', () => {
    const preview = previewSupportBundle(
      fullInput({
        localDataIndex: {
          pathExists: true,
          indexPathLabel: `${WORKSPACE_ROOT}/userData/studiumx-index.sqlite`,
          status: 'incomplete',
          reason: `open failed at ${WORKSPACE_ROOT}/userData/studiumx-index.sqlite`,
          complete: false,
          rebuiltAt: NOW,
          version: '2',
          migrationIds: ['0001', '0002'],
          appliedMigrations: [
            {
              id: '0001',
              checksum: 'b' * 64,
              appliedAt: NOW,
              appVersion: '0.1.0',
              appliedBy: 'local-data-index',
              sqlBytes: 900
            }
          ],
          issueCountsByCode: { source_drift: 2, read_failed: 1 },
          issueCount: 3,
          projectionRowCounts: { conversation_projection: 4, memory_projection: 2 }
        }
      })
    )

    const section = preview.sections.find((entry) => entry.id === 'local_data_index')
    expect(section).toBeTruthy()
    const payload = section?.payload as Record<string, unknown>
    const json = JSON.stringify(section)

    expect(payload?.aggregateOnly).toBe(true)
    expect(payload?.disposable).toBe(true)
    expect(payload?.includesProjectionRowBodies).toBe(false)
    expect(payload?.includesConversationBodies).toBe(false)
    expect(payload?.includesMemoryBodies).toBe(false)
    expect(payload?.status).toBe('incomplete')
    expect(payload?.issueCount).toBe(3)
    expect(payload?.issueCountsByCode).toEqual({ source_drift: 2, read_failed: 1 })
    expect(json).toMatch(/safely deleted and rebuilt/i)
    expect(json).not.toContain(WORKSPACE_ROOT)
    expect(json).not.toMatch(/C:\/Users\/alice/)
    expect(section?.warnings.some((warning) => /aggregate-only/i.test(warning))).toBe(true)
  })

  it('never packs smuggled conversation/memory projection row bodies in local data index section', () => {
    const preview = previewSupportBundle({
      now: () => NOW,
      workspaceRoot: WORKSPACE_ROOT,
      localDataIndex: {
        pathExists: true,
        indexPathLabel: 'userData/studiumx-index.sqlite',
        status: 'ready',
        complete: true,
        rebuiltAt: NOW,
        migrationIds: ['0001'],
        issueCountsByCode: {},
        issueCount: 0,
        // @ts-expect-error intentional smuggled projection bodies for redaction coverage
        turn_projection_json: '{"turns":[{"content":"private learner answer must not export"}]}',
        // @ts-expect-error intentional smuggled projection bodies for redaction coverage
        snapshot_json: '{"conversation":{"title":"secret transcript"}}',
        // @ts-expect-error intentional smuggled projection bodies for redaction coverage
        conversationBodies: [{ id: 'c1', content: 'full conversation body' }],
        // @ts-expect-error intentional smuggled projection bodies for redaction coverage
        memoryBodies: [{ id: 'm1', content: 'full memory body' }],
        // @ts-expect-error intentional smuggled projection bodies for redaction coverage
        content: 'raw projection content body'
      } as SupportBundleInput['localDataIndex']
    })

    const section = preview.sections.find((entry) => entry.id === 'local_data_index')
    expect(section).toBeTruthy()
    const json = JSON.stringify(section)
    expect(json).not.toContain('private learner answer')
    expect(json).not.toContain('secret transcript')
    expect(json).not.toContain('full conversation body')
    expect(json).not.toContain('full memory body')
    expect(json).not.toContain('raw projection content body')
    // Aggregate-only builder never copies smuggled row-body keys into the payload.
    expect(json).not.toContain('turn_projection_json')
    expect(json).not.toContain('snapshot_json')
    expect(json).not.toContain('conversationBodies')
    expect(json).not.toContain('memoryBodies')
    expect((section?.payload as Record<string, unknown>)?.includesProjectionRowBodies).toBe(false)
    expect((section?.payload as Record<string, unknown>)?.aggregateOnly).toBe(true)
  })

})

