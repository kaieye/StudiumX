/**
 * Pure SkillOrchestrationPlanner (ADR-0151 Phase 2).
 * No I/O, no ledger, no tools, no settlement authority.
 */

import {
  getBuiltinSkillOrchestrationPolicy,
  SKILL_ORCHESTRATION_POLICY_VERSION,
  type BuiltinSkillOrchestrationEntry
} from './builtin-skill-orchestration-policy'
import { resolveActiveRoleCardinality } from './skill-orchestration-cardinality'
import {
  SKILL_ORCHESTRATION_SCHEMA_VERSION,
  type SkillOrchestrationDecision,
  type SkillOrchestrationDiagnostic,
  type SkillOrchestrationInput,
  type SkillOrchestrationMode,
  type SkillOrchestrationPlan,
  type SkillOrchestrationPriorState,
  type SkillOrchestrationReadiness,
  type SkillOrchestrationStage,
  type SkillOrchestrationStageKind
} from '../shared/teaching-types/skill-orchestration'

const CORE_KERNEL_ID = 'teach' as const

const STAGE_ORDER: SkillOrchestrationStageKind[] = [
  'ground',
  'diagnose',
  'teach',
  'elicit',
  'artifact_authoring',
  'enhance',
  'verify',
  'package'
]

function normalizeId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLocaleLowerCase()
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids.map(normalizeId).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/**
 * Artifact tokens are case-significant (registry declares `CourseOutline`).
 * Lowercasing them (the id normalizer) silently broke accepts/produces
 * matching — keep the declared casing, trim, dedupe, sort.
 */
function uniqueSortedArtifacts(tokens: string[]): string[] {
  return [...new Set(tokens.map((token) => String(token ?? '').trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )
}

/** Strict allow-listed prior-state normalization (ADR-0156); invalid → undefined. */
function normalizePriorState(
  raw: SkillOrchestrationPriorState | undefined
): SkillOrchestrationPriorState | undefined {
  if (!raw) return undefined
  const planId = String(raw.planId ?? '').trim()
  if (!/^sop1_[0-9a-f]{8}$/.test(planId)) return undefined
  const planRevision = Number.isInteger(raw.planRevision) && raw.planRevision > 0 ? raw.planRevision : 1
  const stageCursor =
    typeof raw.stageCursor === 'string' && /^stage_[a-z_]{1,32}$/.test(raw.stageCursor)
      ? raw.stageCursor
      : null
  const completedStageKinds = [...new Set((raw.completedStageKinds ?? []).filter((kind) =>
    STAGE_ORDER.includes(kind)
  ))]
  const artifactFacts = uniqueSortedArtifacts([...(raw.artifactFacts ?? [])]).filter((token) =>
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(token)
  )
  return { planId, planRevision, stageCursor, completedStageKinds, artifactFacts }
}

function readinessMap(
  list: SkillOrchestrationReadiness[] | undefined
): Map<string, SkillOrchestrationReadiness> {
  const map = new Map<string, SkillOrchestrationReadiness>()
  for (const item of list ?? []) {
    const id = normalizeId(item.skillId)
    if (!id) continue
    map.set(id, { ...item, skillId: id })
  }
  return map
}

/**
 * Explicit readiness wins.
 * Missing row: registered builtins stay eligible only when host omitted readiness entirely
 * (empty map); if host supplied any readiness rows, missing ⇒ not ready (fail-closed).
 */
function isSkillReady(
  id: string,
  readiness: Map<string, SkillOrchestrationReadiness>
): boolean {
  const row = readiness.get(id)
  if (!row) {
    if (readiness.size === 0) {
      return getBuiltinSkillOrchestrationPolicy(id) !== null
    }
    return false
  }
  if (id === CORE_KERNEL_ID) return row.ready !== false
  return Boolean(row.installed && row.ready && row.trustedBuiltin)
}

function canAutoSchedule(
  id: string,
  readiness: Map<string, SkillOrchestrationReadiness>
): boolean {
  const policy = getBuiltinSkillOrchestrationPolicy(id)
  if (!policy?.autoSchedulableDependency) return false
  return isSkillReady(id, readiness)
}

function inferMode(input: SkillOrchestrationInput, selected: string[]): SkillOrchestrationMode {
  if (input.mode) return input.mode

  const policies = selected
    .map((id) => getBuiltinSkillOrchestrationPolicy(id))
    .filter((p): p is BuiltinSkillOrchestrationEntry => p !== null)

  if (policies.some((p) => p.role === 'workflow_router')) return 'artifact_workflow'
  if (
    policies.some((p) =>
      ['artifact_producer', 'cross_cutting_enhancer', 'verifier', 'variant_producer', 'packager'].includes(
        p.role
      )
    )
  ) {
    return 'artifact_workflow'
  }
  if (input.preferArtifactProfile) return 'artifact_workflow'
  if (selected.length === 0) return 'instant_help'
  return 'teaching_turn'
}

function fnv1aHex(parts: string[]): string {
  let hash = 0x811c9dc5
  const payload = parts.join('\u001f')
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function computePlanId(input: {
  mode: SkillOrchestrationMode
  selected: string[]
  readiness: Map<string, SkillOrchestrationReadiness>
  contextIdentity: string
  nextStepAction: string
  nextStepReason: string
  resourceReadiness: string
  evidenceStatus: string
  availableArtifacts: string[]
  budgetConstrained: boolean
  preferArtifactProfile: boolean
  priorState?: SkillOrchestrationPriorState
}): string {
  const readinessKey = [...input.readiness.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, r]) => `${id}:${r.installed ? 1 : 0}${r.ready ? 1 : 0}${r.trustedBuiltin ? 1 : 0}`)
    .join(',')
  const digest = fnv1aHex([
    SKILL_ORCHESTRATION_POLICY_VERSION,
    String(SKILL_ORCHESTRATION_SCHEMA_VERSION),
    input.mode,
    input.selected.join(','),
    readinessKey,
    input.contextIdentity,
    input.nextStepAction,
    input.nextStepReason,
    input.resourceReadiness,
    input.evidenceStatus,
    input.availableArtifacts.join(','),
    input.budgetConstrained ? '1' : '0',
    input.preferArtifactProfile ? '1' : '0',
    input.priorState
      ? [
          input.priorState.planId,
          String(input.priorState.planRevision),
          input.priorState.stageCursor ?? '',
          input.priorState.completedStageKinds.join(','),
          input.priorState.artifactFacts.join(',')
        ].join('|')
      : ''
  ])
  return `sop1_${digest}`
}

type WorkItem = {
  skillId: string
  policy: BuiltinSkillOrchestrationEntry
  userSelected: boolean
  autoScheduled: boolean
  status: SkillOrchestrationDecision['status']
  reason: string
}

function decisionFromWork(item: WorkItem): SkillOrchestrationDecision {
  return {
    skillId: item.skillId,
    status: item.status,
    reason: item.reason,
    role: item.policy.role,
    teachingImpact: item.policy.teachingImpact
  }
}

/**
 * Pure deterministic planner.
 *
 * Mode notes:
 * - `instant_help`: kernel decision is `advisory_only` (lighter; no formal settlement implied).
 * - `teaching_turn`: kernel always `active_now` in plan.kernel + decisions.
 * - `artifact_workflow`: kernel artifact profile; teaching-site-style routers stage children.
 */
export function plan(input: SkillOrchestrationInput): SkillOrchestrationPlan {
  const selected = uniqueSorted(input.selectedSkillIds ?? [])
  const readiness = readinessMap(input.readiness)
  // ADR-0156: prior-turn continuity facts are ordinary allow-listed inputs —
  // merged deterministically, never a second state machine.
  const priorState = normalizePriorState(input.priorState)
  const completedStageKinds = new Set<SkillOrchestrationStageKind>(priorState?.completedStageKinds ?? [])
  const availableArtifacts = uniqueSortedArtifacts([
    ...(input.availableArtifacts ?? []),
    ...(priorState?.artifactFacts ?? [])
  ])
  const contextIdentity = String(input.contextIdentity ?? 'ctx:default').trim() || 'ctx:default'
  const nextStepAction = String(input.nextStepAction ?? '').trim()
  const objective =
    String(input.objective ?? '').trim() ||
    (selected.length ? `Use capabilities: ${selected.join(', ')}` : 'Default teaching assistance')
  const budgetConstrained = Boolean(input.budgetConstrained)
  const preferArtifactProfile = Boolean(input.preferArtifactProfile)
  const mode = inferMode(input, selected)
  const diagnostics: SkillOrchestrationDiagnostic[] = []
  const nextStepReason = String(input.nextStepReason ?? '').trim()
  const resourceReadiness = String(input.resourceReadiness ?? '').trim()
  const evidenceStatus = String(input.evidenceStatus ?? '').trim()

  const decisions = new Map<string, SkillOrchestrationDecision>()
  const work = new Map<string, WorkItem>()

  const putDecision = (d: SkillOrchestrationDecision): void => {
    decisions.set(d.skillId, d)
  }

  // 1) Every selection gets a slot (no silent drop).
  for (const id of selected) {
    putDecision({
      skillId: id,
      status: 'excluded',
      reason: 'Pending orchestration classification.',
      ...(getBuiltinSkillOrchestrationPolicy(id)
        ? {
            role: getBuiltinSkillOrchestrationPolicy(id)!.role,
            teachingImpact: getBuiltinSkillOrchestrationPolicy(id)!.teachingImpact
          }
        : {})
    })
  }

  // 2) Kernel decision by mode
  const kernelProfile =
    mode === 'artifact_workflow' || preferArtifactProfile ? 'artifact' : 'interactive'

  if (mode === 'instant_help') {
    putDecision({
      skillId: CORE_KERNEL_ID,
      status: 'advisory_only',
      reason:
        'Instant help: Teaching Kernel principles are advisory only; no formal teaching settlement implied.',
      role: 'kernel',
      teachingImpact: 'kernel_principles'
    })
  } else {
    putDecision({
      skillId: CORE_KERNEL_ID,
      status: 'active_now',
      reason:
        mode === 'teaching_turn'
          ? 'Teaching turn: app-shipped Teaching Kernel is always active for principles (not a settlement writer).'
          : 'Artifact workflow: Teaching Kernel artifact profile supplies product hard boundaries without learner outcome settlement.',
      role: 'kernel',
      teachingImpact: 'kernel_principles'
    })
  }

  // 3) Unknown / not ready
  for (const id of selected) {
    if (id === CORE_KERNEL_ID) continue
    const policy = getBuiltinSkillOrchestrationPolicy(id)
    if (!policy) {
      putDecision({
        skillId: id,
        status: 'excluded',
        reason: 'Unknown skill id is not in host-owned builtin orchestration registry.'
      })
      diagnostics.push({
        code: 'unknown_skill',
        severity: 'warning',
        message: `Skill "${id}" is not a registered builtin orchestration target.`
      })
      continue
    }
    if (!isSkillReady(id, readiness)) {
      putDecision({
        skillId: id,
        status: 'blocked',
        reason: 'Skill is not installed/ready/trusted for orchestration (fail-closed).',
        role: policy.role,
        teachingImpact: policy.teachingImpact
      })
      diagnostics.push({
        code: 'skill_not_ready',
        severity: 'blocking',
        message: `Skill "${id}" is not ready; cannot activate safely.`
      })
      continue
    }
    work.set(id, {
      skillId: id,
      policy,
      userSelected: true,
      autoScheduled: false,
      status: 'active_now',
      reason: 'Pending role classification.'
    })
  }

  // 4) Expand requires (auto-schedule trusted builtins only)
  const expandQueue = [...work.keys()]
  while (expandQueue.length > 0) {
    const id = expandQueue.shift()!
    const item = work.get(id)
    if (!item || item.status === 'blocked') continue
    for (const depRaw of item.policy.requires) {
      const depId = normalizeId(depRaw)
      if (!depId || work.has(depId) || depId === CORE_KERNEL_ID) continue
      if (canAutoSchedule(depId, readiness)) {
        const depPolicy = getBuiltinSkillOrchestrationPolicy(depId)!
        work.set(depId, {
          skillId: depId,
          policy: depPolicy,
          userSelected: selected.includes(depId),
          autoScheduled: !selected.includes(depId),
          status: 'scheduled_later',
          reason: `Auto-scheduled predeclared trusted builtin dependency of "${id}".`
        })
        putDecision(decisionFromWork(work.get(depId)!))
        expandQueue.push(depId)
      } else if (item.userSelected) {
        item.status = 'blocked'
        item.reason = `Missing required dependency "${depId}" that cannot be auto-scheduled (not ready, not trusted builtin, or not predeclared).`
        putDecision(decisionFromWork(item))
        if (!decisions.has(depId)) {
          putDecision({
            skillId: depId,
            status: 'blocked',
            reason: 'Required dependency is missing or not trusted for auto-schedule (fail-closed).',
            ...(getBuiltinSkillOrchestrationPolicy(depId)
              ? {
                  role: getBuiltinSkillOrchestrationPolicy(depId)!.role,
                  teachingImpact: getBuiltinSkillOrchestrationPolicy(depId)!.teachingImpact
                }
              : {})
          })
        }
        diagnostics.push({
          code: 'missing_dependency',
          severity: 'blocking',
          message: `Skill "${id}" requires "${depId}" which is not auto-schedulable.`
        })
      }
    }
  }

  // 5) Role / stage classification for each work item
  const hasWriter = [...work.values()].some(
    (w) =>
      w.status !== 'blocked' &&
      (w.policy.role === 'artifact_producer' ||
        w.policy.role === 'cross_cutting_enhancer' ||
        w.policy.role === 'variant_producer' ||
        w.policy.role === 'packager')
  )

  for (const item of work.values()) {
    if (item.status === 'blocked') {
      putDecision(decisionFromWork(item))
      continue
    }

    const { policy } = item

    // Budget: defer enhancer / packager / variant first (never cut kernel / teaching strategy here)
    if (
      budgetConstrained &&
      (policy.role === 'cross_cutting_enhancer' ||
        policy.role === 'packager' ||
        policy.role === 'variant_producer')
    ) {
      item.status = 'scheduled_later'
      item.reason =
        'Deferred under budget constraint before cutting Evidence/settlement-related teaching roles (planner deferral only).'
      putDecision(decisionFromWork(item))
      diagnostics.push({
        code: 'budget_defer',
        severity: 'info',
        message: `Deferred "${item.skillId}" (${policy.role}) due to budgetConstrained.`
      })
      continue
    }

    switch (policy.role) {
      case 'kernel':
        // handled above
        break
      case 'workflow_router':
        item.status = 'active_now'
        item.reason =
          'Workflow router active for stage planning only; child skills activate by stage.'
        break
      case 'teaching_strategy':
        if (mode === 'artifact_workflow') {
          item.status = 'advisory_only'
          item.reason =
            'Assessment/strategy skill is advisory in artifact workflow (does not write learner Evidence).'
        } else if (mode === 'instant_help') {
          item.status = 'advisory_only'
          item.reason = 'Instant help: strategy skill is advisory only.'
        } else {
          item.status = 'active_now'
          item.reason =
            'Teaching strategy active for diagnose/elicit; still not a settlement writer.'
        }
        break
      case 'artifact_producer': {
        const needsAccepts = policy.accepts.length > 0
        const hasAccepts = policy.accepts.some((a) => availableArtifacts.includes(a))
        const depsPending = policy.requires.some((dep) => {
          const d = work.get(normalizeId(dep))
          return d && d.status !== 'blocked' && !availableArtifacts.some((a) => policy.accepts.includes(a))
        })
        if (item.autoScheduled && !item.userSelected) {
          item.status = 'scheduled_later'
          item.reason = 'Auto-scheduled producer dependency (trusted builtin).'
        } else if (needsAccepts && !hasAccepts && depsPending) {
          item.status = 'scheduled_later'
          item.reason =
            'Producer scheduled after required dependency skills / artifacts are available.'
        } else if (needsAccepts && !hasAccepts && policy.requires.length > 0) {
          item.status = 'scheduled_later'
          item.reason =
            'Producer scheduled after required dependency skills / artifacts are available.'
        } else {
          item.status = 'active_now'
          item.reason =
            'Artifact producer active for current authoring stage (sequential writes; effect lattice still applies at execution).'
        }
        break
      }
      case 'cross_cutting_enhancer':
        if (completedStageKinds.has('artifact_authoring')) {
          item.status = 'active_now'
          item.reason =
            'Enhancer active: base artifact stage completed in prior turns (ADR-0156 continuity).'
        } else {
          item.status = 'scheduled_later'
          item.reason = 'Enhancer runs after base artifact stage.'
        }
        break
      case 'verifier':
        if (hasWriter && !completedStageKinds.has('artifact_authoring')) {
          item.status = 'scheduled_later'
          item.reason =
            'Verifier scheduled after producers (parallel_readonly); success is not learner Evidence.'
        } else if (hasWriter) {
          item.status = 'active_now'
          item.reason =
            'Verifier active: producer stage completed in prior turns (parallel_readonly); success is not learner Evidence.'
        } else {
          item.status = 'active_now'
          item.reason =
            'Verifier active for audit-only workflow; does not settle learner outcomes.'
        }
        break
      case 'variant_producer':
      case 'packager': {
        const missingAccepts = policy.accepts.filter((a) => !availableArtifacts.includes(a))
        const producersMayProvide = [...work.values()].some(
          (w) =>
            w.status !== 'blocked' &&
            w.policy.role === 'artifact_producer' &&
            w.policy.produces.some((p) => policy.accepts.includes(p))
        )
        if (
          item.userSelected &&
          missingAccepts.length === 0 &&
          completedStageKinds.has('artifact_authoring')
        ) {
          item.status = 'active_now'
          item.reason =
            'Variant/packager active: required canonical artifacts are available and prior stages completed (ADR-0156 continuity).'
        } else if (
          item.userSelected &&
          missingAccepts.length > 0 &&
          !producersMayProvide &&
          availableArtifacts.length === 0
        ) {
          item.status = 'blocked'
          item.reason = `Blocked: required artifacts (${missingAccepts.join(', ')}) are not available and no producer is scheduled to create them.`
          diagnostics.push({
            code: 'missing_artifacts',
            severity: 'blocking',
            message: `Skill "${item.skillId}" needs ${missingAccepts.join(', ')}.`
          })
        } else {
          item.status = 'scheduled_later'
          item.reason = 'Variant/packager runs after stable canonical artifacts.'
        }
        break
      }
      default:
        item.status = 'excluded'
        item.reason = 'Excluded: no applicable role under host policy.'
    }

    putDecision(decisionFromWork(item))
  }

  // 6) Host-owned exclusive slots. This is deliberately after hard
  // admission/mode/readiness classification and before artifact writer conflict:
  // no prompt instruction may replace typed cardinality policy.
  for (const exclusion of resolveActiveRoleCardinality({
    candidates: [...work.values()]
      .filter((item) => item.status === 'active_now')
      .map((item) => ({
        skillId: item.skillId,
        policy: item.policy,
        userSelected: item.userSelected
      })),
    mode,
    nextStepAction
  })) {
    const loser = work.get(exclusion.skillId)
    if (!loser || loser.status !== 'active_now') continue
    loser.status = 'excluded'
    loser.reason = exclusion.reason
    putDecision(decisionFromWork(loser))
    diagnostics.push({
      code: 'role_cardinality_conflict',
      severity: 'warning',
      message:
        `Stage "${exclusion.stage}": "${exclusion.winnerSkillId}" wins ` +
        `${exclusion.exclusiveGroup} over "${exclusion.skillId}".`
    })
  }

  // 7) Dual writer conflict: same artifact scope → one lead (highest priority, then skillId)
  const scopeBuckets = new Map<string, WorkItem[]>()
  for (const item of work.values()) {
    if (item.status === 'blocked' || item.status === 'excluded' || item.status === 'advisory_only') {
      continue
    }
    if (
      item.policy.role !== 'artifact_producer' &&
      item.policy.role !== 'cross_cutting_enhancer' &&
      item.policy.role !== 'variant_producer' &&
      item.policy.role !== 'packager'
    ) {
      continue
    }
    for (const scope of item.policy.artifactScopes) {
      const list = scopeBuckets.get(scope) ?? []
      list.push(item)
      scopeBuckets.set(scope, list)
    }
  }

  for (const [scope, items] of scopeBuckets) {
    if (items.length < 2) continue
    // Only conflict same primary stage class (producers vs producers; not producer vs later enhancer)
    const byStageKey = new Map<string, WorkItem[]>()
    for (const item of items) {
      const key = item.policy.stages[0] ?? item.policy.role
      const list = byStageKey.get(key) ?? []
      list.push(item)
      byStageKey.set(key, list)
    }
    for (const group of byStageKey.values()) {
      if (group.length < 2) continue
      const sorted = [...group].sort(
        (a, b) => b.policy.priority - a.policy.priority || a.skillId.localeCompare(b.skillId)
      )
      const winner = sorted[0]!
      for (const loser of sorted.slice(1)) {
        loser.status = 'excluded'
        loser.reason = `Excluded: conflict on artifact scope "${scope}"; lead writer is "${winner.skillId}" (higher host priority / deterministic order).`
        putDecision(decisionFromWork(loser))
        diagnostics.push({
          code: 'artifact_scope_conflict',
          severity: 'warning',
          message: `Scope "${scope}": "${winner.skillId}" wins over "${loser.skillId}".`
        })
      }
    }
  }

  // 7) Finalize: ensure every selected has status+reason
  for (const id of selected) {
    const d = decisions.get(id)
    if (!d || d.reason === 'Pending orchestration classification.' || d.reason === 'Pending role classification.') {
      putDecision({
        skillId: id,
        status: d?.status ?? 'excluded',
        reason: 'Excluded: no applicable stage under current mode and host policy.',
        ...(getBuiltinSkillOrchestrationPolicy(id)
          ? {
              role: getBuiltinSkillOrchestrationPolicy(id)!.role,
              teachingImpact: getBuiltinSkillOrchestrationPolicy(id)!.teachingImpact
            }
          : {})
      })
    }
  }

  const stages = buildStages(work, mode)
  // Continuity annotation (ADR-0156): only when prior state informed the plan,
  // so priorState-free planning keeps its original byte-identical shape.
  let currentStageId: string | undefined
  if (priorState) {
    let currentAssigned = false
    for (const stage of stages) {
      if (completedStageKinds.has(stage.kind)) {
        stage.status = 'completed'
        continue
      }
      if (!currentAssigned) {
        stage.status = 'current'
        currentStageId = stage.id
        currentAssigned = true
        continue
      }
      stage.status = 'pending'
    }
  }

  const decisionList = [...decisions.values()].sort((a, b) => a.skillId.localeCompare(b.skillId))

  const planId = computePlanId({
    mode,
    selected,
    readiness,
    contextIdentity,
    nextStepAction,
    nextStepReason,
    resourceReadiness,
    evidenceStatus,
    availableArtifacts,
    budgetConstrained,
    preferArtifactProfile,
    ...(priorState ? { priorState } : {})
  })

  const authorityEcho =
    nextStepAction || nextStepReason || resourceReadiness || evidenceStatus || availableArtifacts.length
      ? {
          ...(nextStepAction ? { nextStepAction } : {}),
          ...(nextStepReason ? { nextStepReason } : {}),
          ...(resourceReadiness ? { resourceReadiness } : {}),
          ...(evidenceStatus ? { evidenceStatus } : {}),
          ...(availableArtifacts.length ? { availableArtifacts: [...availableArtifacts] } : {})
        }
      : undefined

  return {
    schemaVersion: SKILL_ORCHESTRATION_SCHEMA_VERSION,
    planId,
    mode,
    objective,
    contextIdentity,
    kernel: {
      skillId: CORE_KERNEL_ID,
      profile: kernelProfile
    },
    stages,
    decisions: decisionList,
    diagnostics: diagnostics.sort(
      (a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message)
    ),
    ...(authorityEcho ? { authorityEcho } : {}),
    ...(currentStageId ? { currentStageId } : {})
  }
}

function buildStages(work: Map<string, WorkItem>, mode: SkillOrchestrationMode): SkillOrchestrationStage[] {
  const byKind = new Map<SkillOrchestrationStageKind, string[]>()

  const add = (kind: SkillOrchestrationStageKind, skillId: string): void => {
    const list = byKind.get(kind) ?? []
    if (!list.includes(skillId)) list.push(skillId)
    byKind.set(kind, list)
  }

  for (const item of work.values()) {
    if (item.status !== 'active_now' && item.status !== 'scheduled_later') continue
    const { policy, skillId } = item

    if (policy.role === 'workflow_router') {
      add('ground', skillId)
      continue
    }
    if (policy.role === 'teaching_strategy') {
      for (const k of policy.stages) add(k, skillId)
      continue
    }
    if (policy.role === 'verifier') {
      add('verify', skillId)
      continue
    }
    if (policy.role === 'cross_cutting_enhancer') {
      add('enhance', skillId)
      continue
    }
    if (policy.role === 'packager' || policy.role === 'variant_producer') {
      add('package', skillId)
      continue
    }
    if (policy.role === 'artifact_producer') {
      add('artifact_authoring', skillId)
      continue
    }
    for (const k of policy.stages) add(k, skillId)
  }

  void mode

  const stages: SkillOrchestrationStage[] = []
  for (const kind of STAGE_ORDER) {
    const unorderedSkillIds = uniqueSorted(byKind.get(kind) ?? [])
    const policyById = new Map<string, BuiltinSkillOrchestrationEntry>(
      unorderedSkillIds
        .map((id) => getBuiltinSkillOrchestrationPolicy(id))
        .filter((policy): policy is BuiltinSkillOrchestrationEntry => policy !== null)
        .map((policy) => [policy.skillId, policy] as const)
    )
    const remaining = new Set(policyById.keys())
    const skillIds: string[] = []
    while (remaining.size > 0) {
      const candidates = [...remaining]
        .map((id) => policyById.get(id)!)
        .filter((policy) => policy.requires.every((dependency) => !remaining.has(dependency)))
      // Registered dependencies are acyclic; retain a stable fallback for an invalid future policy.
      const next = (candidates.length ? candidates : [...remaining].map((id) => policyById.get(id)!)).sort(
        (a, b) => b.priority - a.priority || a.skillId.localeCompare(b.skillId)
      )[0]!
      skillIds.push(next.skillId)
      remaining.delete(next.skillId)
    }
    if (skillIds.length === 0) continue

    const policies = skillIds
      .map((id) => getBuiltinSkillOrchestrationPolicy(id))
      .filter((p): p is BuiltinSkillOrchestrationEntry => p !== null)

    let execution: SkillOrchestrationStage['execution'] = 'sequential'
    if (policies.length > 0 && policies.every((p) => p.role === 'verifier')) {
      execution = 'parallel_readonly'
    } else if (skillIds.length === 1) {
      execution = 'single'
    } else {
      execution = 'sequential'
    }

    // Artifact tokens keep their declared casing (see uniqueSortedArtifacts).
    const consumes = uniqueSortedArtifacts(policies.flatMap((p) => p.accepts))
    const produces = uniqueSortedArtifacts(policies.flatMap((p) => p.produces))
    const completionGates =
      kind === 'verify'
        ? [
            {
              id: 'verify-reports',
              description: 'Verifier reports complete; not learner Evidence or outcome settlement.'
            }
          ]
        : kind === 'artifact_authoring'
          ? [
              {
                id: 'artifact-lead-writer',
                description:
                  'Lead producer finished for declared artifact scopes (effect lattice still applies).'
              }
            ]
          : kind === 'package'
            ? [
                {
                  id: 'canonical-stable',
                  description: 'Canonical artifacts stable before packager/variant.'
                }
              ]
            : []

    stages.push({
      id: `stage_${kind}`,
      kind,
      execution,
      skillIds,
      consumes,
      produces,
      completionGates
    })
  }

  return stages
}

export function createSkillOrchestrationPlanner(): { plan: typeof plan } {
  return { plan }
}
