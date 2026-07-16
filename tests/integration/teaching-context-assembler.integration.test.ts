import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createResourceGrounder } from '../../src/main/resource-grounder'
import { createTeachingContextAssembler, type TeachingContextAssemblerInput } from '../../src/main/teaching-context-assembler'
import type { TrustedTeachingResourceDescriptor } from '../../src/shared/teaching-types/grounding'

const AUTHORITY_ID = 'integration-teaching-authority'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function source(sourceId: string, relativePath: string, content: string): TrustedTeachingResourceDescriptor {
  return {
    schemaVersion: 1,
    sourceId,
    relativePath,
    contentSha256: createHash('sha256').update(content).digest('hex'),
    priority: sourceId === 'source-foundation' ? 'required' : 'recommended',
    authority: { kind: 'trusted_teaching_resource', authorityId: AUTHORITY_ID },
    provenance: { kind: 'workspace_resource', resourceId: `resource-${sourceId}`, revisionId: 'fixture-revision-1' }
  }
}

function facts(resources: readonly TrustedTeachingResourceDescriptor[]): TeachingContextAssemblerInput {
  return {
    mission: { id: 'mission-fixture', goalStatus: 'available' },
    course: { id: 'course-fixture' },
    currentSession: { id: 'session-fixture', source: 'canonical', readOnly: false },
    outcome: { status: 'trusted', id: 'outcome-fixture', kind: 'misconception_corrected' },
    nextStep: {
      schemaVersion: 1,
      action: 'continue_next_session',
      reason: 'misconception_corrected_with_next_goal',
      safeInputSummary: {
        missionId: 'mission-fixture',
        courseId: 'course-fixture',
        latestSession: { id: 'session-fixture', source: 'canonical', readOnly: false },
        durableOutcome: { status: 'trusted', id: 'outcome-fixture', kind: 'misconception_corrected' },
        evidence: { status: 'verified' },
        resources: { readiness: 'ready', availableCount: resources.length },
        provenance: { outcomeEvidenceEventIds: ['event-fixture'], resourceIds: resources.map((item) => item.sourceId) }
      }
    },
    resources
  }
}

describe('teaching context assembler integration', () => {
  it('assembles exactly two fixture-like trusted sources for lesson and conversation, then excludes source removal and invalidity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studiumx-teaching-context-integration-'))
    roots.push(root)
    await mkdir(join(root, 'resources'), { recursive: true })
    await writeFile(join(root, 'resources', 'foundation.txt'), 'Foundation reference.', 'utf8')
    await writeFile(join(root, 'resources', 'practice.txt'), 'Practice reference.', 'utf8')
    const resources = [
      source('source-foundation', 'resources/foundation.txt', 'Foundation reference.'),
      source('source-practice', 'resources/practice.txt', 'Practice reference.')
    ]
    const assembler = createTeachingContextAssembler(createResourceGrounder({
      workspaceRoot: root,
      trustedAuthorityId: AUTHORITY_ID,
      maxBytes: 1024
    }))

    const lesson = await assembler.assemble(facts(resources), 'lesson')
    const conversation = await assembler.assemble(facts(resources), 'conversation')

    expect(lesson.grounding.sources).toHaveLength(2)
    expect(lesson.grounding.sources.map((item) => item.sourceId)).toEqual(['source-foundation', 'source-practice'])
    expect(lesson.context).toEqual(conversation.context)
    expect(lesson.grounding.identity).toBe(conversation.grounding.identity)

    await rm(join(root, 'resources', 'practice.txt'))
    const removed = await assembler.assemble(facts(resources), 'lesson')
    expect(removed.grounding).toMatchObject({ status: 'degraded' })
    expect(removed.grounding.exclusions).toContainEqual({ sourceId: 'source-practice', relativePath: 'resources/practice.txt', code: 'source_unavailable' })

    await writeFile(join(root, 'resources', 'practice.txt'), 'Changed fixture reference.', 'utf8')
    const stale = await assembler.assemble(facts(resources), 'conversation')
    expect(stale.grounding.exclusions).toContainEqual({ sourceId: 'source-practice', relativePath: 'resources/practice.txt', code: 'stale_source' })
  })
})
