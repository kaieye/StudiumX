import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createResourceGrounder } from '../../src/main/resource-grounder'
import { createTeachingContextAssembler, type TeachingContextAssemblerInput } from '../../src/main/teaching-context-assembler'
import type { TrustedTeachingResourceDescriptor } from '../../src/shared/teaching-types/grounding'

const AUTHORITY_ID = 'authority-teaching-context'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function descriptor(
  sourceId: string,
  relativePath: string,
  content: string,
  overrides: Partial<TrustedTeachingResourceDescriptor> = {}
): TrustedTeachingResourceDescriptor {
  return {
    schemaVersion: 1,
    sourceId,
    relativePath,
    contentSha256: sha256(content),
    priority: 'recommended',
    authority: { kind: 'trusted_teaching_resource', authorityId: AUTHORITY_ID },
    provenance: { kind: 'workspace_resource', resourceId: `resource-${sourceId}`, revisionId: 'revision-1' },
    ...overrides
  }
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-teaching-context-unit-'))
  roots.push(root)
  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const target = join(root, relativePath)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, content, 'utf8')
  }))
  return root
}

function input(resources: readonly TrustedTeachingResourceDescriptor[]): TeachingContextAssemblerInput {
  return {
    mission: { id: 'mission-algebra', goalStatus: 'available' },
    course: { id: 'course-algebra' },
    currentSession: { id: 'session-algebra-1', source: 'canonical', readOnly: false },
    outcome: { status: 'trusted', id: 'outcome-algebra-1', kind: 'needs_practice' },
    nextStep: {
      schemaVersion: 1,
      action: 'contrast_and_retry',
      reason: 'needs_practice',
      safeInputSummary: {
        missionId: 'mission-algebra',
        courseId: 'course-algebra',
        latestSession: { id: 'session-algebra-1', source: 'canonical', readOnly: false },
        durableOutcome: { status: 'trusted', id: 'outcome-algebra-1', kind: 'needs_practice' },
        evidence: { status: 'verified' },
        resources: { readiness: 'ready', availableCount: resources.length },
        provenance: { outcomeEvidenceEventIds: ['event-safe'], resourceIds: resources.map((resource) => resource.sourceId) }
      }
    },
    resources
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('TeachingContextAssembler and ResourceGrounder', () => {
  it('returns exact stable JSON for repeated semantically identical facts in both consumer modes', async () => {
    const root = await fixture({ 'resources/required.txt': 'Required theorem.', 'resources/recommended.txt': 'Recommended example.' })
    const resources = [
      descriptor('source-recommended', 'resources/recommended.txt', 'Recommended example.'),
      descriptor('source-required', 'resources/required.txt', 'Required theorem.', { priority: 'required' })
    ]
    const assembler = createTeachingContextAssembler(createResourceGrounder({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 256
    }))

    const lesson = await assembler.assemble(input(resources), 'lesson')
    const conversation = await assembler.assemble(input([...resources].reverse()), 'conversation')

    expect(JSON.stringify(lesson)).toBe(JSON.stringify(conversation))
    expect(lesson.context.identity).toBe(conversation.context.identity)
    expect(lesson.grounding.identity).toBe(conversation.grounding.identity)
    expect(lesson.grounding.sources.map((source) => source.sourceId)).toEqual(['source-required', 'source-recommended'])
  })

  it('allow-lists normalized facts and never projects injected learner, transcript, evidence, assessment, or provider payloads', async () => {
    const root = await fixture({ 'resources/safe.txt': 'Safe reference text.' })
    const resource = {
      ...descriptor('source-safe', 'resources/safe.txt', 'Safe reference text.'),
      learnerAnswer: 'private learner answer',
      transcript: 'private transcript',
      providerResponse: 'private provider response'
    } as unknown as TrustedTeachingResourceDescriptor
    const facts = input([resource]) as TeachingContextAssemblerInput & {
      mission: TeachingContextAssemblerInput['mission'] & { learnerAnswer: string }
      outcome: TeachingContextAssemblerInput['outcome'] & { rawEvidenceText: string }
      nextStep: TeachingContextAssemblerInput['nextStep'] & { assessmentPayload: string }
    }
    facts.mission.learnerAnswer = 'private learner answer'
    facts.outcome = { ...facts.outcome, rawEvidenceText: 'private evidence' }
    facts.nextStep.assessmentPayload = 'private assessment payload'

    const assembly = await createTeachingContextAssembler(createResourceGrounder({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 128
    })).assemble(facts, 'lesson')
    const json = JSON.stringify(assembly)

    expect(json).not.toContain('private learner answer')
    expect(json).not.toContain('private transcript')
    expect(json).not.toContain('private evidence')
    expect(json).not.toContain('private assessment payload')
    expect(json).not.toContain('private provider response')
  })

  it('does not mutate deeply frozen normalized facts', async () => {
    const root = await fixture({ 'resources/safe.txt': 'Safe reference text.' })
    const facts = deepFreeze(input([descriptor('source-safe', 'resources/safe.txt', 'Safe reference text.')]))
    const before = structuredClone(facts)
    const assembler = createTeachingContextAssembler(createResourceGrounder({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 128
    }))

    await expect(assembler.assemble(facts, 'conversation')).resolves.toBeDefined()
    expect(facts).toEqual(before)
    expect(Object.isFrozen(facts.resources)).toBe(true)
    expect(Object.isFrozen(facts.nextStep.safeInputSummary.provenance.resourceIds)).toBe(true)
  })

  it('uses deterministic priority and records budget truncation conservatively', async () => {
    const root = await fixture({
      'resources/required.txt': '12345678',
      'resources/supplemental.txt': 'abcdefgh'
    })
    const grounder = createResourceGrounder({ workspaceRoot: root, trustedAuthorityId: AUTHORITY_ID, maxBytes: 10 })

    const pack = await grounder.ground([
      descriptor('source-supplemental', 'resources/supplemental.txt', 'abcdefgh', { priority: 'supplemental' }),
      descriptor('source-required', 'resources/required.txt', '12345678', { priority: 'required' })
    ])

    expect(pack.sources.map((source) => source.sourceId)).toEqual(['source-required'])
    expect(pack.budget).toMatchObject({ maxBytes: 10, availableBytes: 16, usedBytes: 8, remainingBytes: 2, truncated: true, truncationReason: 'budget_exhausted' })
    expect(pack.exclusions).toContainEqual({ sourceId: 'source-supplemental', relativePath: 'resources/supplemental.txt', code: 'budget_exhausted' })
  })

  it.each([
    ['unauthorized resources', () => descriptor('source-unauthorized', 'resources/valid.txt', 'valid', { authority: { kind: 'trusted_teaching_resource', authorityId: 'other-authority' } }), 'unauthorized_resource'],
    ['path escape locations', () => descriptor('source-escape', '../outside.txt', 'outside'), 'unsafe_location'],
    ['stale sources', () => descriptor('source-stale', 'resources/valid.txt', 'expected but stale'), 'stale_source'],
    ['duplicate chunks', () => descriptor('source-duplicate', 'resources/duplicate.txt', 'valid'), 'duplicate_chunk'],
    ['unknown schemas', () => ({ ...descriptor('source-unknown', 'resources/valid.txt', 'valid'), schemaVersion: 99 } as unknown as TrustedTeachingResourceDescriptor), 'unknown_schema']
  ] as const)('typed-excludes %s', async (_label, build, code) => {
    const root = await fixture({ 'resources/valid.txt': 'valid', 'resources/duplicate.txt': 'valid' })
    const grounder = createResourceGrounder({ workspaceRoot: root, trustedAuthorityId: AUTHORITY_ID, maxBytes: 128 })
    const descriptors = code === 'duplicate_chunk'
      ? [descriptor('source-original', 'resources/valid.txt', 'valid'), build()]
      : [build()]

    const pack = await grounder.ground(descriptors)

    expect(pack.exclusions.some((exclusion) => exclusion.code === code)).toBe(true)
    expect(code === 'duplicate_chunk' ? pack.status : pack.status).toBe(code === 'duplicate_chunk' ? 'degraded' : 'unavailable')
  })

  it.each([
    ['a missing trusted source', [descriptor('source-missing', 'resources/missing.txt', 'missing')], { sourceId: 'source-missing', relativePath: 'resources/missing.txt', code: 'source_unavailable' }],
    ['a repeated source ID', [
      descriptor('source-repeat', 'resources/valid.txt', 'valid'),
      descriptor('source-repeat', 'resources/other.txt', 'other')
    ], { sourceId: 'source-repeat', relativePath: 'resources/valid.txt', code: 'duplicate_source_id' }]
  ] as const)('typed-excludes %s', async (_label, descriptors, expected) => {
    const root = await fixture({ 'resources/valid.txt': 'valid', 'resources/other.txt': 'other' })
    const pack = await createResourceGrounder({ workspaceRoot: root, trustedAuthorityId: AUTHORITY_ID, maxBytes: 128 }).ground(descriptors)

    expect(pack.exclusions).toContainEqual(expected)
  })

  it('typed-excludes a source over the configured bounded-read limit', async () => {
    const root = await fixture({ 'resources/large.txt': '0123456789' })
    const pack = await createResourceGrounder({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 128,
      maxSourceBytes: 4
    }).ground([descriptor('source-large', 'resources/large.txt', '0123456789')])

    expect(pack).toMatchObject({
      status: 'unavailable',
      budget: { truncated: true, truncationReason: 'source_over_limit' },
      exclusions: [{ sourceId: 'source-large', relativePath: 'resources/large.txt', code: 'source_over_limit' }]
    })
  })

  it('keeps resource absence diagnostic and unavailable without producing grounded sources', async () => {
    const root = await fixture({})
    const pack = await createResourceGrounder({ workspaceRoot: root, trustedAuthorityId: AUTHORITY_ID, maxBytes: 128 }).ground([])

    expect(pack).toMatchObject({ status: 'unavailable', sources: [], exclusions: [{ sourceId: null, relativePath: null, code: 'resource_absent' }] })
  })
})
