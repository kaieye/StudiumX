/**
 * Teaching-safe post-turn review candidates (ADOPTION S-09 / ADR-0077).
 *
 * Pure, deterministic, conservative. Emits **candidates only** for human approval.
 * Never auto-creates skills, never rewrites learner-profile, never starts memory/dream phases.
 * Settlement / coordinator writes remain outside this module.
 */

export type TeachingTurnReviewMode = 'visible' | 'synthetic'

export type TeachingTurnReviewCandidateKind =
  | 'memory_candidate'
  | 'skill_pack_hint'
  | 'lesson_gap'
  | 'other'

/**
 * Soft review suggestion. `requiresHumanApproval` is always true by construction.
 * `payload` is display/diagnostic only — never an executable apply plan.
 */
export type TeachingTurnReviewCandidate = {
  id: string
  kind: TeachingTurnReviewCandidateKind
  title: string
  summary: string
  requiresHumanApproval: true
  payload?: Record<string, unknown>
}

export type TeachingTurnReviewBundle = {
  turnId?: string
  candidates: TeachingTurnReviewCandidate[]
  generatedAt: string
}

export type BuildTeachingTurnReviewCandidatesInput = {
  assistantText?: string
  userText?: string
  toolNames?: string[]
  mode?: TeachingTurnReviewMode
}

/**
 * Optional finalize-side hook shape for residual integration.
 * Not wired by this module. Callers may ignore. Must never auto-apply candidates.
 */
export type TeachingTurnReviewFinalizeHook = (input: {
  mode: TeachingTurnReviewMode
  bundle: TeachingTurnReviewBundle
}) => void | Promise<void>

/** Hard cap: at most two soft candidates per turn (conservative). */
export const MAX_TEACHING_TURN_REVIEW_CANDIDATES = 2 as const

/** Payload keys that must never appear (look like auto-apply / executable plans). */
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'autoApply',
  'auto_apply',
  'skillFileContent',
  'skill_file_content',
  'skillContent',
  'profilePatch',
  'profile_patch',
  'learnerProfilePatch',
  'writePath',
  'write_path',
  'executable',
  'applyPlan',
  'apply_plan',
  'mutations',
  'fsWrite',
  'fs_write'
])

const MEMORY_CONSENT_ALREADY_HANDLED =
  /learner-profile-consent|长期记忆|用户记忆|要记录到|记录到用户记忆|memory consent/i

const TOOL_ERROR_NAME = /error|fail|invalid|denied|reject|timeout|unavailable/i
const ASSISTANT_TOOL_FAILURE =
  /tool\s*(?:call\s*)?(?:failed|error|timed?\s*out)|工具(?:调用)?(?:失败|出错|超时)|permission denied|access denied|request_rejected|path_rejected/i

const SKILL_HINT_SIGNAL =
  /(?:下次|以后|以后都|每次都).{0,12}(?:用|按|照|流程|步骤)|可复用|做成 skill|skill pack|技能包|固定流程|标准步骤|checklist|检查清单/i

const LESSON_GAP_SIGNAL =
  /(?:还没讲清|没有讲清|未覆盖|遗漏|缺口|没讲到|需要补充|补充练习|巩固一下|再练|lesson gap|concept gap)/i

/**
 * Build zero-or-few soft post-turn review candidates.
 *
 * Rules:
 * - `synthetic` mode → always empty (no learner-facing review noise).
 * - Do not re-emit memory-consent capture already handled by learner-profile policy.
 * - At most {@link MAX_TEACHING_TURN_REVIEW_CANDIDATES} candidates.
 * - Every candidate has `requiresHumanApproval: true`.
 * - Payload is diagnostic/display only (no skill file bodies, no profile patches).
 */
export function buildTeachingTurnReviewCandidates(
  input: BuildTeachingTurnReviewCandidatesInput
): TeachingTurnReviewCandidate[] {
  const mode = input.mode ?? 'visible'
  if (mode === 'synthetic') return []

  const assistantText = typeof input.assistantText === 'string' ? input.assistantText : ''
  const userText = typeof input.userText === 'string' ? input.userText : ''
  const toolNames = Array.isArray(input.toolNames)
    ? input.toolNames.filter((name): name is string => typeof name === 'string' && name.length > 0)
    : []

  const combined = `${userText}\n${assistantText}`

  // Memory consent flows are owned by learner-profile-record-policy; never duplicate auto-capture.
  if (MEMORY_CONSENT_ALREADY_HANDLED.test(combined)) {
    // Still allow non-memory kinds below, but skip memory_candidate entirely in this branch.
  }

  const candidates: TeachingTurnReviewCandidate[] = []

  const lessonGap = maybeLessonGapCandidate({ assistantText, toolNames, combined })
  if (lessonGap) candidates.push(lessonGap)

  if (candidates.length < MAX_TEACHING_TURN_REVIEW_CANDIDATES) {
    const skillHint = maybeSkillPackHintCandidate({ userText, assistantText, combined })
    if (skillHint) candidates.push(skillHint)
  }

  // Soft memory candidate only when no consent marker is already in flight and text is thin diagnostic.
  if (
    candidates.length < MAX_TEACHING_TURN_REVIEW_CANDIDATES &&
    !MEMORY_CONSENT_ALREADY_HANDLED.test(combined)
  ) {
    const memory = maybeMemoryCandidate({ userText })
    if (memory) candidates.push(memory)
  }

  return candidates.slice(0, MAX_TEACHING_TURN_REVIEW_CANDIDATES).map(freezeCandidate)
}

/**
 * Wrap candidates into a bundle with ISO `generatedAt`. Pure aside from clock (injectable).
 */
export function buildTeachingTurnReviewBundle(input: {
  candidates?: TeachingTurnReviewCandidate[]
  turnId?: string
  generatedAt?: string
  reviewInput?: BuildTeachingTurnReviewCandidatesInput
}): TeachingTurnReviewBundle {
  const candidates =
    input.candidates ??
    (input.reviewInput ? buildTeachingTurnReviewCandidates(input.reviewInput) : [])
  return {
    ...(input.turnId ? { turnId: input.turnId } : {}),
    candidates: candidates.map(freezeCandidate),
    generatedAt: input.generatedAt ?? new Date().toISOString()
  }
}

/**
 * Pure guard documenting that apply must stay human-gated.
 * Throws if any candidate lacks `requiresHumanApproval: true` or carries forbidden auto-apply payload keys.
 * Safe to call from tests and future human-approval UI preflight.
 */
export function assertReviewNotAutoApplied(bundle: TeachingTurnReviewBundle): void {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('TeachingTurnReviewBundle is required')
  }
  if (!Array.isArray(bundle.candidates)) {
    throw new Error('TeachingTurnReviewBundle.candidates must be an array')
  }
  for (const candidate of bundle.candidates) {
    if (candidate.requiresHumanApproval !== true) {
      throw new Error(
        `Review candidate ${candidate.id ?? '(missing id)'} must set requiresHumanApproval: true (no auto apply)`
      )
    }
    assertPayloadNotExecutable(candidate.payload, candidate.id)
  }
}

function freezeCandidate(candidate: TeachingTurnReviewCandidate): TeachingTurnReviewCandidate {
  const next: TeachingTurnReviewCandidate = {
    id: candidate.id,
    kind: candidate.kind,
    title: candidate.title,
    summary: candidate.summary,
    requiresHumanApproval: true
  }
  if (candidate.payload && typeof candidate.payload === 'object') {
    next.payload = { ...candidate.payload, requiresHumanApproval: true }
  }
  return next
}

function maybeLessonGapCandidate(args: {
  assistantText: string
  toolNames: string[]
  combined: string
}): TeachingTurnReviewCandidate | null {
  const errorishTools = args.toolNames.filter((name) => TOOL_ERROR_NAME.test(name))
  const failureInText = ASSISTANT_TOOL_FAILURE.test(args.assistantText)
  const gapPhrase = LESSON_GAP_SIGNAL.test(args.combined)
  // Conservative: need a concrete signal, not merely "tools were used".
  if (errorishTools.length === 0 && !failureInText && !gapPhrase) return null
  if (args.toolNames.length === 0 && !gapPhrase && !failureInText) return null

  const signals: string[] = []
  if (errorishTools.length > 0) signals.push(`errorish_tools:${errorishTools.slice(0, 3).join(',')}`)
  if (failureInText) signals.push('assistant_tool_failure_text')
  if (gapPhrase) signals.push('lesson_gap_phrase')

  return {
    id: 'review:lesson_gap:v1',
    kind: 'lesson_gap',
    title: 'Possible lesson gap',
    summary:
      'This turn showed tool failures or an explicit teaching gap signal. Consider a human-approved follow-up practice step — do not auto-write records.',
    requiresHumanApproval: true,
    payload: {
      signal: signals.join('|'),
      toolCount: args.toolNames.length,
      // Diagnostic names only; not an execution plan.
      sampleToolNames: args.toolNames.slice(0, 5)
    }
  }
}

function maybeSkillPackHintCandidate(args: {
  userText: string
  assistantText: string
  combined: string
}): TeachingTurnReviewCandidate | null {
  if (!SKILL_HINT_SIGNAL.test(args.combined)) return null
  return {
    id: 'review:skill_pack_hint:v1',
    kind: 'skill_pack_hint',
    title: 'Skill-pack hint (human approve only)',
    summary:
      'Conversation mentions a reusable procedure. A human may later author a skill-pack — this candidate must not create skill files automatically.',
    requiresHumanApproval: true,
    payload: {
      signal: 'reusable_procedure_phrase',
      // Snippet for UI only; never a file body or path to write.
      userSnippet: clip(args.userText, 120),
      assistantSnippet: clip(args.assistantText, 120)
    }
  }
}

function maybeMemoryCandidate(args: { userText: string }): TeachingTurnReviewCandidate | null {
  // Extremely conservative: only when user explicitly asks to remember something stable,
  // and consent flow is NOT already active (caller filtered). Does not plan a write.
  const explicit =
    /(?:请记住|帮我记住|记一下|记住我|please remember|remember that)\s*.{4,}/i.test(args.userText)
  if (!explicit) return null
  return {
    id: 'review:memory_candidate:v1',
    kind: 'memory_candidate',
    title: 'Memory candidate (consent required)',
    summary:
      'User asked to remember something. Surface for human/consent approval only — never silent learner-profile rewrite.',
    requiresHumanApproval: true,
    payload: {
      signal: 'explicit_remember_request',
      userSnippet: clip(args.userText, 160)
    }
  }
}

function assertPayloadNotExecutable(payload: Record<string, unknown> | undefined, id: string): void {
  if (payload == null) return
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Review candidate ${id} payload must be a plain object when present`)
  }
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      throw new Error(
        `Review candidate ${id} payload key "${key}" looks like auto-apply / executable plan; forbidden`
      )
    }
  }
  // Nested objects: shallow scan one level for the same keys.
  for (const value of Object.values(payload)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value as Record<string, unknown>)) {
        if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
          throw new Error(
            `Review candidate ${id} nested payload key "${key}" looks like auto-apply; forbidden`
          )
        }
      }
    }
  }
}

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`
}

// ---------------------------------------------------------------------------
// Human decision + approval projection (ADR-0085) — re-export pure seam.
// Prefer importing from this module or teaching-turn-review-approve.ts.
// ---------------------------------------------------------------------------
export {
  MAX_TEACHING_TURN_REVIEW_DECISION_NOTE_LENGTH,
  assertTeachingTurnReviewDecision,
  projectTeachingTurnReviewForHuman,
  sanitizeDecisionNote,
  type TeachingTurnReviewApprovalProjection,
  type TeachingTurnReviewCandidateDecision,
  type TeachingTurnReviewDecisionAction,
  type TeachingTurnReviewHumanDecision
} from './teaching-turn-review-approve'

// ---------------------------------------------------------------------------
// Post-approve handoff intents (ADR-0109) — re-export pure seam.
// Prefer importing from this module or teaching-turn-review-handoff.ts.
// ---------------------------------------------------------------------------
export {
  MAX_TEACHING_TURN_REVIEW_HANDOFF_REASON_LENGTH,
  projectTeachingTurnReviewHandoff,
  projectTeachingTurnReviewHandoffFromBundle,
  type TeachingTurnReviewHandoffIntent,
  type TeachingTurnReviewHandoffProjection,
  type TeachingTurnReviewHandoffTarget
} from './teaching-turn-review-handoff'

// ---------------------------------------------------------------------------
// Durable last-bundle snapshot (ADR-0113) — re-export pure seam.
// Prefer importing from this module or teaching-turn-review-last-bundle.ts.
// ---------------------------------------------------------------------------
export {
  MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_CANDIDATES,
  MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_DECISIONS,
  MAX_TEACHING_TURN_REVIEW_LAST_BUNDLE_JSON_CHARS,
  parseTeachingTurnReviewLastBundleSnapshot,
  toTeachingTurnReviewLastBundleSnapshot,
  type TeachingTurnReviewLastBundleSnapshot,
  type TeachingTurnReviewLastBundleSource
} from './teaching-turn-review-last-bundle'
