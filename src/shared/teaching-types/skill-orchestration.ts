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

export type SkillOrchestrationStageStatus = 'completed' | 'current' | 'pending'

export type SkillOrchestrationStage = {
  id: string
  kind: SkillOrchestrationStageKind
  execution: SkillOrchestrationStageExecution
  skillIds: string[]
  consumes: string[]
  produces: string[]
  completionGates: SkillOrchestrationCompletionGate[]
  /** Present only when prior conversation state informed the plan (ADR-0156). */
  status?: SkillOrchestrationStageStatus
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
  /** First not-yet-completed stage id when prior state informed the plan (ADR-0156). */
  currentStageId?: string
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
  /**
   * Prior-turn orchestration continuity facts (ADR-0156). Allow-listed
   * projection of the durable conversation state — never a second state
   * machine: same canonical facts + same prior state → same plan.
   */
  priorState?: SkillOrchestrationPriorState
}

/** Allow-listed prior-state projection consumed by the pure planner (ADR-0156). */
export type SkillOrchestrationPriorState = {
  planId: string
  planRevision: number
  stageCursor: string | null
  completedStageKinds: SkillOrchestrationStageKind[]
  /** Artifact tokens confirmed by deterministic gate checks in prior turns. */
  artifactFacts: string[]
}

export const SKILL_ORCHESTRATION_STATE_SCHEMA_VERSION = 1 as const

export type SkillOrchestrationGateResult = {
  stageId: string
  gateId: string
  passed: boolean
  /** Allow-listed deterministic check description (tokens only, no content). */
  checkedFact: string
}

export type SkillOrchestrationStageProgress = {
  stageId: string
  kind: SkillOrchestrationStageKind
  status: 'completed' | 'active' | 'pending'
  gateResults: SkillOrchestrationGateResult[]
}

/**
 * Durable per-conversation orchestration continuity state (ADR-0156).
 * A rebuildable workflow projection: it stores stage cursor + gate checks only,
 * never ledger/Evidence facts, and always yields to a fresh re-plan when
 * missing or conflicting. Zero settlement authority.
 */
export type ConversationOrchestrationState = {
  schemaVersion: typeof SKILL_ORCHESTRATION_STATE_SCHEMA_VERSION
  conversationId: string
  planId: string
  planRevision: number
  mode: SkillOrchestrationMode
  stageCursor: string | null
  stages: SkillOrchestrationStageProgress[]
  artifactFacts: string[]
  updatedAt: string
}

/**
 * Read-only orchestration preview request (ADR-0163).
 *
 * Preview reuses the same host assembly + pure `plan(...)` as a real teaching
 * turn, so the previewed plan equals the executed plan for the same canonical
 * facts. It NEVER advances the ADR-0156 continuity cursor and never writes.
 */
export type SkillOrchestrationPreviewRequest = {
  /** Conversation whose prior continuity state should be READ (never written). */
  conversationId?: string
  workspaceId?: string
  /** Explicit capability selection (chips + expanded preset). */
  selectedSkillIds: string[]
  /** Raw composer text; leading slash tokens merge with the explicit selection. */
  userInput?: string
  /** Product intent preset the selection came from, when applicable. */
  presetId?: string
  /** True when the composer is in teaching mode. */
  isTeachingConversation?: boolean
}

export type SkillOrchestrationPreviewResult = {
  ok: boolean
  /** Null whenever preview degraded — callers render "no preview", never block. */
  plan: SkillOrchestrationPlan | null
  /**
   * Ids the host added as predeclared builtin dependencies rather than the user.
   * Surfaced separately so auto-fill is never disguised as a user choice.
   */
  autoAddedSkillIds: string[]
  /** Allow-listed failure token when `ok` is false (never raw error text). */
  reason?: string
}

/**
 * Local-only, redactable plan diagnostics fact (ADR-0163 §2.6).
 * Identifiers, enums and counts ONLY — never objective text, skill bodies,
 * workspace paths, secrets or learner Evidence. Never phoned home.
 */
export type SkillOrchestrationPromptBudgetFact = {
  kernelBudgetChars: number
  kernelInputChars: number
  kernelIncludedChars: number
  dynamicBudgetChars: number
  dynamicInputChars: number
  dynamicIncludedChars: number
  truncatedBodyCount: number
}

export type SkillOrchestrationGateDiagnosticsFact = {
  checkedCount: number
  passedCount: number
  failedCount: number
}

export type SkillOrchestrationTeachingCompletenessFact = {
  applicable: boolean
  elicitStagePresent: boolean
  evidenceStatusPresent: boolean
  nextStepActionPresent: boolean
}

export type SkillOrchestrationPlanDiagnosticsFact = {
  planId: string
  mode: SkillOrchestrationMode
  presetId?: string
  stageKinds: SkillOrchestrationStageKind[]
  currentStageKind?: SkillOrchestrationStageKind
  currentStageSkillCount: number
  decisionCounts: Record<SkillOrchestrationDecisionStatus, number>
  diagnosticCodes: Array<{ code: string; severity: SkillOrchestrationDiagnostic['severity'] }>
  /** There is no product gate-override path yet; never fabricate override events. */
  userOverrideStatus: 'not_supported'
  promptBudget: SkillOrchestrationPromptBudgetFact
  gates: SkillOrchestrationGateDiagnosticsFact
  teachingCompleteness: SkillOrchestrationTeachingCompletenessFact
}

export type SkillOrchestrationEvaluationSummary = {
  schemaVersion: 1
  planCount: number
  stageSelectionCounts: Partial<Record<SkillOrchestrationStageKind, number>>
  unresolvedStageCount: number
  conflictExclusionCount: number
  overrideSupported: false
  overrideCount: 0
  promptBudget: {
    inputChars: number
    includedChars: number
    budgetChars: number
    truncatedBodyCount: number
  }
  gates: {
    checkedCount: number
    passedCount: number
    failedCount: number
    passRate: number | null
  }
  teachingCompleteness: {
    applicablePlanCount: number
    elicitPresentCount: number
    evidenceStatusPresentCount: number
    nextStepActionPresentCount: number
  }
}
