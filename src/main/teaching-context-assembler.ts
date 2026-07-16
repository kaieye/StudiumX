import { createHash } from 'node:crypto'
import type { ResourceGrounder } from './resource-grounder'
import {
  TEACHING_CONTEXT_SCHEMA_VERSION,
  type TeachingContext,
  type TeachingContextConsumer,
  type NormalizedTeachingCourse,
  type NormalizedTeachingMission,
  type NormalizedTeachingOutcome,
  type NormalizedTeachingSession
} from '../shared/teaching-types/teaching-context'
import type { TrustedTeachingResourceDescriptor } from '../shared/teaching-types/grounding'
import type { NextTeachingStepDecision } from '../shared/teaching-types/next-teaching-step'

export type TeachingContextAssemblerInput = {
  mission: NormalizedTeachingMission
  course: NormalizedTeachingCourse
  currentSession: NormalizedTeachingSession
  outcome: NormalizedTeachingOutcome
  nextStep: NextTeachingStepDecision
  resources: readonly TrustedTeachingResourceDescriptor[]
}

export type TeachingContextAssembly = {
  context: TeachingContext
  grounding: import('../shared/teaching-types/grounding').GroundingPack
}

export interface TeachingContextAssembler {
  assemble(input: TeachingContextAssemblerInput, consumer: TeachingContextConsumer): Promise<TeachingContextAssembly>
}

/**
 * Projects normalized durable policy facts and read-only grounding into one
 * consumer-neutral context. Consumer mode is intentionally not represented in
 * the result so lesson and conversation callers receive the same identity.
 */
export function createTeachingContextAssembler(grounder: ResourceGrounder): TeachingContextAssembler {
  return {
    async assemble(input, consumer): Promise<TeachingContextAssembly> {
      void consumer
      const grounding = await grounder.ground(input.resources)
      const contextWithoutIdentity = {
        schemaVersion: TEACHING_CONTEXT_SCHEMA_VERSION,
        mission: { id: input.mission.id, goalStatus: input.mission.goalStatus },
        course: { id: input.course.id },
        currentSession: {
          id: input.currentSession.id,
          source: input.currentSession.source,
          readOnly: input.currentSession.readOnly
        },
        outcome: normalizeOutcome(input.outcome),
        nextStep: { action: input.nextStep.action, reason: input.nextStep.reason },
        grounding: {
          identity: grounding.identity,
          status: grounding.status,
          sourceIds: grounding.sources.map((source) => source.sourceId),
          exclusionCount: grounding.exclusions.length
        }
      } satisfies Omit<TeachingContext, 'identity'>

      return {
        grounding,
        context: {
          ...contextWithoutIdentity,
          identity: sha256(JSON.stringify(contextWithoutIdentity))
        }
      }
    }
  }
}

export async function assembleTeachingContext(
  input: TeachingContextAssemblerInput,
  consumer: TeachingContextConsumer,
  grounder: ResourceGrounder
): Promise<TeachingContextAssembly> {
  return createTeachingContextAssembler(grounder).assemble(input, consumer)
}

function normalizeOutcome(outcome: NormalizedTeachingOutcome): NormalizedTeachingOutcome {
  if (outcome.status !== 'trusted') return { status: outcome.status }
  return { status: 'trusted', id: outcome.id, kind: outcome.kind }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
