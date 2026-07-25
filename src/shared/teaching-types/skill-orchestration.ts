/**
 * Skill orchestration plan types (ADR-0151 Phase 2).
 * Planner is pure `plan(...)` only — never settlement / Evidence writer.
 */

export const SKILL_ORCHESTRATION_SCHEMA_VERSION = 1 as const

export type SkillOrchestrationMode = 'instant_help' | 'teaching_turn' | 'artifact_workflow'

export type SkillOrchestrationDecisionStatus =
  | 'active_now'
  | 'scheduled_later'
  | 'advisory_only'
  | 'excluded'
  | 'blocked'

export type SkillOrchestrationRole =
  | 'kernel'
  | 'teaching_strategy'
  | 'workflow_router'
  | 'artifact_producer'
  | 'cross_cutting_enhancer'
  | 'verifier'
  | 'variant_producer'
  | 'packager'

export type SkillOrchestrationStageKind =
  | 'ground'
  | 'diagnose'
  | 'teach'
  | 'elicit'
  | 'artifact_authoring'
  | 'enhance'
  | 'verify'
  | 'package'

export type SkillOrchestrationStageExecution = 'single' | 'sequential' | 'parallel_readonly'

export type SkillOrchestrationTeachingImpact =
  | 'kernel_principles'
  | 'teaching_strategy'
  | 'artifact_only'
  | 'verifier_only'
  | 'workflow_routing'
  | 'none'

export type SkillOrchestrationKernelProfile = 'interactive' | 'artifact'

export type SkillOrchestrationCompletionGate = {
  id: string
  description: string
}

export type SkillOrchestrationStage = {
  id: string
  kind: SkillOrchestrationStageKind
  execution: SkillOrchestrationStageExecution
  skillIds: string[]
  consumes: string[]
  produces: string[]
  completionGates: SkillOrchestrationCompletionGate[]
}

export type SkillOrchestrationDecision = {
  skillId: string
  status: SkillOrchestrationDecisionStatus
  reason: string
  /** Optional role echo for diagnostics / UI (not authority). */
  role?: SkillOrchestrationRole
  teachingImpact?: SkillOrchestrationTeachingImpact
}

export type SkillOrchestrationDiagnostic = {
  code: string
  severity: 'info' | 'warning' | 'blocking'
  message: string
}

/**
 * Allow-listed Teaching Authority Plane echoes projected into the plan (read-only).
 * Never settlement / Evidence payloads — action tokens and readiness enums only.
 */
export type SkillOrchestrationAuthorityEcho = {
  nextStepAction?: string
  nextStepReason?: string
  resourceReadiness?: string
  evidenceStatus?: string
  availableArtifacts?: string[]
}

export type SkillOrchestrationPlan = {
  schemaVersion: typeof SKILL_ORCHESTRATION_SCHEMA_VERSION
  planId: string
  mode: SkillOrchestrationMode
  objective: string
  contextIdentity: string
  kernel: {
    skillId: 'teach'
    profile: SkillOrchestrationKernelProfile
  }
  stages: SkillOrchestrationStage[]
  decisions: SkillOrchestrationDecision[]
  diagnostics: SkillOrchestrationDiagnostic[]
  /** Optional Authority Plane echoes (planId-stable; for turn-tail projection only). */
  authorityEcho?: SkillOrchestrationAuthorityEcho
}

/**
 * Allow-listed readiness for a selected or dependency skill.
 * Missing entry → treated as not ready / not installed for fail-closed rules.
 */
export type SkillOrchestrationReadiness = {
  skillId: string
  installed: boolean
  trustedBuiltin: boolean
  ready: boolean
}

/**
 * Pure planner input — no secrets, no timestamps, no full skill bodies.
 */
export type SkillOrchestrationInput = {
  /** User-selected capability skill ids (teach may be omitted; host injects kernel). */
  selectedSkillIds: string[]
  /** Explicit mode; if omitted, planner infers from selection + flags. */
  mode?: SkillOrchestrationMode
  objective?: string
  /** Stable teaching / workspace context identity (allow-listed). */
  contextIdentity?: string
  /** Next-step action from Teaching Authority Plane (allow-listed string). */
  nextStepAction?: string
  /** Next-step reason token (allow-listed; echo only). */
  nextStepReason?: string
  /** Resource readiness enum echo from loop facts. */
  resourceReadiness?: string
  /** Evidence status enum echo from loop facts. */
  evidenceStatus?: string
  /** Declared available artifact facts (e.g. CourseOutline). */
  availableArtifacts?: string[]
  /** Readiness for selected + known deps. */
  readiness?: SkillOrchestrationReadiness[]
  /**
   * Soft budget signal for planner deferral only (not run hard budget enforcement).
   * When true, low-priority enhancer/packager are deferred before cutting teaching roles.
   */
  budgetConstrained?: boolean
  /** Prefer artifact profile for kernel when true. */
  preferArtifactProfile?: boolean
}
