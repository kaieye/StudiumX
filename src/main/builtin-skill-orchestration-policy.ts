/**
 * Host-owned skill orchestration registry (ADR-0014).
 * Authority is host policy — not skill markdown / personal manifest hints.
 */

import { BUILTIN_SKILL_IDS } from './skill-library'
import { listSkillOrchestrationPresets } from '../shared/skill-orchestration-presets'
import type {
  SkillOrchestrationAdmission,
  SkillOrchestrationEligibility,
  SkillOrchestrationRole,
  SkillOrchestrationStageKind,
  SkillOrchestrationTeachingImpact
} from '../shared/teaching-types/skill-orchestration'

/** Bump when registry semantics change in a way that must re-key planId. */
export const SKILL_ORCHESTRATION_POLICY_VERSION = 'builtin-orch-v2' as const

export type BuiltinSkillOrchestrationEntry = {
  skillId: (typeof BUILTIN_SKILL_IDS)[number]
  role: SkillOrchestrationRole
  stages: SkillOrchestrationStageKind[]
  requires: string[]
  accepts: string[]
  produces: string[]
  artifactScopes: string[]
  teachingImpact: SkillOrchestrationTeachingImpact
  /** Higher runs earlier within the same stage class when resolving conflicts (0–100). */
  priority: number
  /** When true, may be auto-scheduled as a predeclared builtin dependency. */
  autoSchedulableDependency: boolean
  /** Host-owned admission/cardinality — never inferred from a skill pack manifest. */
  admission: SkillOrchestrationAdmission
}

const RAW_ENTRIES: Omit<BuiltinSkillOrchestrationEntry, 'admission'>[] = [
  {
    skillId: 'teach',
    role: 'kernel',
    stages: ['ground', 'teach', 'elicit'],
    requires: [],
    accepts: [],
    produces: [],
    artifactScopes: [],
    teachingImpact: 'kernel_principles',
    priority: 100,
    autoSchedulableDependency: false
  },
  {
    skillId: 'learning-assessor',
    role: 'teaching_strategy',
    stages: ['diagnose', 'elicit'],
    requires: [],
    accepts: ['LearningObjective', 'LearnerLevel'],
    produces: ['AssessmentRubric', 'ElicitationPlan'],
    artifactScopes: [],
    // Quiz/rubric authoring is artifact/strategy metadata — not learner Evidence/outcome.
    teachingImpact: 'teaching_strategy',
    priority: 80,
    autoSchedulableDependency: true
  },
  {
    skillId: 'teaching-resource-generator',
    role: 'artifact_producer',
    stages: ['artifact_authoring'],
    requires: [],
    accepts: ['LearningObjective', 'LearnerLevel', 'Misconception', 'CourseContent'],
    produces: ['LessonAsset', 'ExerciseSet'],
    // May also touch day content paths — host treats dual lead with course-content-authoring as conflict.
    artifactScopes: ['lesson-assets/**', 'course-package/day*/content.md'],
    teachingImpact: 'artifact_only',
    priority: 55,
    autoSchedulableDependency: false
  },
  {
    skillId: 'course-outline-design',
    role: 'artifact_producer',
    stages: ['artifact_authoring'],
    requires: [],
    accepts: ['CourseBrief'],
    produces: ['CourseOutline'],
    artifactScopes: ['course-package/outline.md'],
    teachingImpact: 'artifact_only',
    priority: 70,
    autoSchedulableDependency: true
  },
  {
    skillId: 'course-content-authoring',
    role: 'artifact_producer',
    stages: ['artifact_authoring'],
    requires: ['course-outline-design'],
    accepts: ['CourseOutline'],
    produces: ['CourseContent'],
    artifactScopes: ['course-package/day*/content.md'],
    teachingImpact: 'artifact_only',
    priority: 60,
    autoSchedulableDependency: true
  },
  {
    skillId: 'course-designer',
    role: 'workflow_router',
    stages: ['ground', 'artifact_authoring'],
    requires: [],
    accepts: ['CourseBrief'],
    produces: ['CourseWorkflowPlan'],
    artifactScopes: [],
    teachingImpact: 'workflow_routing',
    priority: 65,
    autoSchedulableDependency: false
  },
  {
    skillId: 'grilling',
    role: 'workflow_router',
    stages: ['ground'],
    requires: [],
    accepts: [],
    produces: [],
    artifactScopes: [],
    // This skill is intentionally exposed as an explicit, advisory workflow
    // helper; it has not been validated as part of the built-in teaching flow.
    teachingImpact: 'none',
    priority: 10,
    autoSchedulableDependency: false
  },
  {
    skillId: 'teaching-site',
    role: 'workflow_router',
    stages: ['ground', 'artifact_authoring'],
    requires: [],
    accepts: ['CourseContent', 'CourseOutline'],
    produces: ['TeachingSitePlan'],
    artifactScopes: ['teaching-site/**'],
    teachingImpact: 'workflow_routing',
    priority: 75,
    autoSchedulableDependency: false
  },
  {
    skillId: 'static-spa-conversion',
    role: 'artifact_producer',
    stages: ['artifact_authoring'],
    requires: [],
    accepts: ['CourseContent', 'TeachingSitePlan'],
    produces: ['StaticSpa'],
    artifactScopes: ['teaching-site/spa/**'],
    teachingImpact: 'artifact_only',
    priority: 50,
    autoSchedulableDependency: true
  },
  {
    skillId: 'static-spa-interactions',
    role: 'cross_cutting_enhancer',
    stages: ['enhance'],
    requires: ['static-spa-conversion'],
    accepts: ['StaticSpa'],
    produces: ['StaticSpaInteractions'],
    artifactScopes: ['teaching-site/spa/**'],
    teachingImpact: 'artifact_only',
    priority: 40,
    autoSchedulableDependency: true
  },
  {
    skillId: 'teaching-site-design-system',
    role: 'cross_cutting_enhancer',
    stages: ['enhance'],
    requires: [],
    accepts: ['StaticSpa', 'TeachingSitePlan'],
    produces: ['DesignSystemTokens'],
    artifactScopes: ['teaching-site/design/**'],
    teachingImpact: 'artifact_only',
    priority: 35,
    autoSchedulableDependency: true
  },
  {
    skillId: 'web-visual-assets',
    role: 'cross_cutting_enhancer',
    stages: ['enhance'],
    requires: [],
    accepts: ['StaticSpa', 'CourseContent'],
    produces: ['VisualAssets'],
    artifactScopes: ['teaching-site/assets/**'],
    teachingImpact: 'artifact_only',
    priority: 30,
    autoSchedulableDependency: true
  },
  {
    skillId: 'web-content-audit',
    role: 'verifier',
    stages: ['verify'],
    requires: [],
    accepts: ['StaticSpa', 'CourseContent'],
    produces: ['ContentAuditReport'],
    artifactScopes: [],
    teachingImpact: 'verifier_only',
    priority: 45,
    autoSchedulableDependency: true
  },
  {
    skillId: 'web-visual-verification',
    role: 'verifier',
    stages: ['verify'],
    requires: [],
    accepts: ['VisualAssets', 'StaticSpa'],
    produces: ['VisualVerificationReport'],
    artifactScopes: [],
    teachingImpact: 'verifier_only',
    priority: 45,
    autoSchedulableDependency: true
  },
  {
    skillId: 'course-corporate-edition',
    role: 'variant_producer',
    stages: ['package'],
    requires: ['course-content-authoring'],
    accepts: ['CourseContent'],
    produces: ['CorporateEdition'],
    artifactScopes: ['course-package/corporate/**'],
    teachingImpact: 'artifact_only',
    priority: 25,
    autoSchedulableDependency: false
  },
  {
    skillId: 'course-ebook-publishing',
    role: 'packager',
    stages: ['package'],
    requires: ['course-content-authoring'],
    accepts: ['CourseContent', 'StaticSpa'],
    produces: ['CourseEbook'],
    artifactScopes: ['course-package/ebook/**'],
    teachingImpact: 'artifact_only',
    priority: 20,
    autoSchedulableDependency: false
  }
]

function admissionFor(entry: Omit<BuiltinSkillOrchestrationEntry, 'admission'>): SkillOrchestrationAdmission {
  const role = entry.role
  const allowedModes: SkillOrchestrationAdmission['allowedModes'] =
    role === 'kernel'
      ? ['instant_help', 'teaching_turn', 'artifact_workflow']
      : role === 'teaching_strategy'
        ? ['instant_help', 'teaching_turn']
        : role === 'workflow_router' ||
            role === 'artifact_producer' ||
            role === 'cross_cutting_enhancer' ||
            role === 'verifier' ||
            role === 'variant_producer' ||
            role === 'packager'
          ? ['artifact_workflow']
          : []
  const slot =
    role === 'kernel'
      ? 'kernel'
      : role === 'teaching_strategy'
        ? 'primary_teaching_strategy'
        : role === 'workflow_router'
          ? 'workflow_router'
          : role === 'verifier'
            ? 'verification'
            : 'artifact'
  return {
    allowedModes,
    slot,
    ...(role === 'teaching_strategy'
      ? {
          exclusiveGroup: 'primary_teaching_strategy',
          maxActivePerStage: 1,
          preferredNextStepActions: ['diagnose', 'assess', 'check_mastery']
        }
      : role === 'workflow_router'
        ? { exclusiveGroup: 'workflow_router', maxActivePerStage: 1 }
        : {}),
    trustLevel: 'host_governed',
    selectionSurface: role === 'kernel' ? 'hidden' : 'default'
  }
}

const ENTRIES: BuiltinSkillOrchestrationEntry[] = RAW_ENTRIES.map((entry) => ({
  ...entry,
  admission: admissionFor(entry)
}))
// Shipped for explicit/advisory use only until it has been validated against
// the current teaching flow. This projection keeps that boundary visible in
// the library without changing the host registry's fail-closed planner rules.
const UNVERIFIED_BUILTIN_SKILL_IDS = new Set(['grilling'])

/**
 * Main-process projection consumed by the renderer. Unknown/personal entries
 * remain visible only to an explicitly advanced surface and never gain a formal
 * teaching slot merely by being installed.
 */
export function getSkillOrchestrationEligibility(skill: {
  id: string
  source: 'builtin' | 'personal'
}): SkillOrchestrationEligibility {
  const policy = getBuiltinSkillOrchestrationPolicy(skill.id)
  if (policy) {
    const unverified = UNVERIFIED_BUILTIN_SKILL_IDS.has(skill.id.toLocaleLowerCase())
    return {
      allowedModes: unverified ? ['instant_help'] : [...policy.admission.allowedModes],
      slot: unverified ? 'artifact' : policy.admission.slot,
      trustLevel: unverified ? 'advisory_only' : policy.admission.trustLevel,
      selectionSurface: unverified ? 'advanced' : policy.admission.selectionSurface,
      formalTeachingEligible: !unverified && policy.role !== 'kernel',
      reason: unverified
        ? 'This skill has not been validated with the current teaching flow and is available for explicit advisory use only.'
        : policy.role === 'kernel'
          ? 'The app-shipped Teaching Kernel is always active and is not a user-selectable capability.'
          : 'Host-governed builtin capability; final scheduling still depends on mode, readiness, and plan constraints.'
    }
  }
  return {
    allowedModes: [],
    slot: 'artifact',
    trustLevel: skill.source === 'personal' ? 'advisory_only' : 'untrusted',
    selectionSurface: 'advanced',
    formalTeachingEligible: false,
    reason:
      'Personal or unregistered skills are not admitted to the formal teaching chain and cannot become a Teaching Kernel, primary strategy, or settlement writer.'
  }
}

const BY_ID = new Map(ENTRIES.map((e) => [e.skillId, e] as const))

/** Compile-time completeness: every allowlisted builtin has a policy row. */
const REGISTERED = new Set(ENTRIES.map((e) => e.skillId))
for (const id of BUILTIN_SKILL_IDS) {
  if (!REGISTERED.has(id)) {
    throw new Error(`Missing host orchestration policy for builtin skill "${id}".`)
  }
}
if (ENTRIES.length !== BUILTIN_SKILL_IDS.length) {
  throw new Error('Host orchestration policy length must match BUILTIN_SKILL_IDS.')
}

/**
 * Product presets (ADR-0014) may only reference registered builtin skills.
 * A preset can never introduce an unknown, personal or custom id into planning.
 */
for (const preset of listSkillOrchestrationPresets()) {
  for (const skillId of preset.skillIds) {
    if (!REGISTERED.has(skillId as BuiltinSkillOrchestrationEntry['skillId'])) {
      throw new Error(
        `Preset "${preset.id}" references unregistered skill "${skillId}" (ADR-0014).`
      )
    }
    if (skillId === 'teach') {
      throw new Error(
        `Preset "${preset.id}" must not list the reserved kernel id "teach" (ADR-0014).`
      )
    }
  }
}

export function listBuiltinSkillOrchestrationPolicies(): readonly BuiltinSkillOrchestrationEntry[] {
  return ENTRIES
}

export function getBuiltinSkillOrchestrationPolicy(
  skillId: string
): BuiltinSkillOrchestrationEntry | null {
  const id = String(skillId ?? '')
    .trim()
    .toLocaleLowerCase()
  return BY_ID.get(id as BuiltinSkillOrchestrationEntry['skillId']) ?? null
}

export function isRegisteredBuiltinOrchestrationSkill(skillId: string): boolean {
  return getBuiltinSkillOrchestrationPolicy(skillId) !== null
}
