/**
 * Read-only skill orchestration preview (ADR-0014).
 *
 * Reuses the SAME host assembly and the SAME pure `plan(...)` as a real
 * teaching turn, so what the user previews is what the turn will execute for
 * identical canonical facts.
 *
 * Hard boundaries — this module:
 * - only READS the ADR-0014 continuity state; it never calls
 *   `advanceConversationOrchestrationState` and never writes the state file,
 *   so opening a preview can never move the stage cursor;
 * - never writes the ledger, creates/commits an outcome, produces Evidence,
 *   executes a tool, or loads skill bodies;
 * - fails soft: any failure degrades to "no preview" and never blocks a turn.
 */

import { getSkillOrchestrationPreset } from '../shared/skill-orchestration-presets'
import { plan as planSkillOrchestration } from './skill-orchestration-planner'
import {
  buildSkillOrchestrationContextIdentity,
  buildSkillOrchestrationPlanInput,
  buildSkillOrchestrationReadinessFromCatalog,
  mergeSelectedSkillIds,
  priorStateFromConversationOrchestrationState,
  resolveHostSkillOrchestrationMode
} from './skill-orchestration-host'
import type { SkillSummary } from '../shared/teaching-types'
import type {
  ConversationOrchestrationState,
  SkillOrchestrationPreviewRequest,
  SkillOrchestrationPreviewResult
} from '../shared/teaching-types/skill-orchestration'

export type SkillOrchestrationPreviewAuthorityFacts = {
  nextStepAction?: string
  nextStepReason?: string
  resourceReadiness?: string
  evidenceStatus?: string
  availableArtifacts?: string[]
  budgetConstrained?: boolean
  preferArtifactProfile?: boolean
}

export type SkillOrchestrationPreviewDeps = {
  /** Workspace root for allow-listed Authority Plane echoes (read-only). */
  workspaceRoot?: string | null
  /** Catalog readiness source. */
  listSkillCatalog?: () => Promise<readonly Pick<SkillSummary, 'id' | 'installed' | 'source'>[]>
  /** READ-ONLY continuity loader. A writer must never be passed here. */
  loadOrchestrationState?: (
    conversationId: string
  ) => Promise<ConversationOrchestrationState | null>
  /** Allow-listed authority facts loader (mission / resources / artifacts). */
  loadAuthorityFacts?: (workspaceRoot: string) => Promise<SkillOrchestrationPreviewAuthorityFacts>
  conversationMode?: string
}

/** Selection cap mirrors the IPC payload contract; over-cap truncates explicitly. */
const MAX_SELECTED_SKILLS = 8

function expandSelection(request: SkillOrchestrationPreviewRequest): {
  selected: string[]
  presetSkillIds: string[]
  preferArtifactProfile: boolean
} {
  const preset = request.presetId ? getSkillOrchestrationPreset(request.presetId) : null
  const presetSkillIds = preset ? [...preset.skillIds] : []
  const explicit = Array.isArray(request.selectedSkillIds) ? request.selectedSkillIds : []
  const selected = [
    ...new Set(
      [...explicit, ...presetSkillIds]
        .map((id) => String(id ?? '').trim().toLocaleLowerCase())
        .filter(Boolean)
    )
  ].slice(0, MAX_SELECTED_SKILLS)
  return {
    selected,
    presetSkillIds,
    preferArtifactProfile: Boolean(preset?.preferArtifactProfile)
  }
}

export async function previewSkillOrchestration(
  request: SkillOrchestrationPreviewRequest,
  deps: SkillOrchestrationPreviewDeps
): Promise<SkillOrchestrationPreviewResult> {
  try {
    const { selected, preferArtifactProfile } = expandSelection(request)
    const userInput = String(request.userInput ?? '')

    const catalogSkills = deps.listSkillCatalog
      ? await deps.listSkillCatalog().catch(() => undefined)
      : undefined

    const requestedSkillIds = mergeSelectedSkillIds({
      explicitSkillIds: selected,
      userInput,
      catalogSkills
    })

    const workspaceRoot = String(deps.workspaceRoot ?? '').trim()
    const authorityFacts: SkillOrchestrationPreviewAuthorityFacts =
      workspaceRoot && deps.loadAuthorityFacts
        ? await deps.loadAuthorityFacts(workspaceRoot).catch(() => ({}))
        : {}

    const isTeachingConversation = Boolean(request.isTeachingConversation)
    const mode = resolveHostSkillOrchestrationMode({
      isTeachingConversation,
      conversationMode: deps.conversationMode ?? (isTeachingConversation ? 'teaching' : 'temporary'),
      selectedSkillIds: requestedSkillIds,
      preferArtifactProfile: preferArtifactProfile || authorityFacts.preferArtifactProfile
    })

    const contextIdentity = buildSkillOrchestrationContextIdentity({
      conversationId: request.conversationId ?? '',
      workspaceId: request.workspaceId ?? '',
      mode: deps.conversationMode ?? (isTeachingConversation ? 'teaching' : 'temporary')
    })

    const readiness = buildSkillOrchestrationReadinessFromCatalog({
      selectedSkillIds: requestedSkillIds,
      catalogSkills
    })

    // READ-ONLY continuity: preview must never advance or persist the cursor.
    const conversationId = String(request.conversationId ?? '').trim()
    const priorState = conversationId && deps.loadOrchestrationState
      ? priorStateFromConversationOrchestrationState(
          await deps.loadOrchestrationState(conversationId).catch(() => null)
        )
      : null

    const plan = planSkillOrchestration(
      buildSkillOrchestrationPlanInput({
        selectedSkillIds: requestedSkillIds,
        mode,
        objective: userInput,
        contextIdentity,
        readiness,
        ...authorityFacts,
        ...(preferArtifactProfile ? { preferArtifactProfile: true } : {}),
        ...(priorState ? { priorState } : {})
      })
    )

    // Anything the planner scheduled that the user did not pick is an
    // auto-filled predeclared builtin dependency — surfaced, never disguised.
    const requested = new Set(requestedSkillIds)
    const autoAddedSkillIds = [
      ...new Set(
        plan.decisions
          .map((decision) => decision.skillId)
          .filter((skillId) => skillId !== 'teach' && !requested.has(skillId))
      )
    ].sort((a, b) => a.localeCompare(b))

    return { ok: true, plan, autoAddedSkillIds }
  } catch {
    // Fail-soft: preview is an explanation surface, never load-bearing.
    return { ok: false, plan: null, autoAddedSkillIds: [], reason: 'preview_unavailable' }
  }
}
