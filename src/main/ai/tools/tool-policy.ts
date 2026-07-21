/**
 * Declarative pure tool-policy evaluation (ADOPTION B-08 / ADR-0063).
 *
 * Layers on the effect lattice and path write-policy shape without shell argv
 * rules, prefix_rule DSL, or product YOLO / always-approve labels.
 *
 * Evaluation is pure: no filesystem I/O. Callers remain responsible for
 * interactive permission gates, containment, and journal settlement.
 */

import type { ToolEffectClass } from './tool-outcome'
import type { Decision as WritePolicyDecision } from './write-policy'
import { normalizeRelativePath } from './write-policy'

/** Codex-style ordinal decisions: allow < prompt < forbidden (strictest wins). */
export type ToolPolicyDecision = 'allow' | 'prompt' | 'forbidden'

/**
 * One declarative rule. Dimensions are optional; when present they AND together.
 * At least one of tools / effects / pathPrefixes must be non-empty for a rule
 * to be eligible (empty multi-match is rejected as non-matching).
 *
 * Intentionally NO argv / command-prefix / prefix_rule fields.
 */
export type ToolPolicyRule = Readonly<{
  tools?: readonly string[]
  effects?: readonly string[]
  pathPrefixes?: readonly string[]
  decision: ToolPolicyDecision
}>

export type ToolPolicyDocument = Readonly<{
  version: 1
  /**
   * Fallback when no rule matches.
   * When omitted: privileged → forbidden (fail closed); other effects → prompt.
   */
  defaultDecision?: ToolPolicyDecision
  rules: readonly ToolPolicyRule[]
}>

export type ToolPolicyEvaluationInput = Readonly<{
  toolName: string
  effectClass: ToolEffectClass | string
  /** Optional relative workspace path (write tools). Absolute/escaping paths never match path prefixes. */
  path?: string
  document: ToolPolicyDocument
}>

export type ToolPolicyEvaluationResult = Readonly<{
  decision: ToolPolicyDecision
  /** Index into document.rules of the winning (strictest) match; omitted on default. */
  matchedRuleIndex?: number
  reason: string
}>

/**
 * Registry permission gate action derived from evaluateToolPolicy.
 * - deny: forbidden short-circuits auto full_access / creates allow
 * - force_interactive: prompt blocks auto-allow; continue grants / UI
 * - defer_to_approval_mode: allow defers to existing approvalMode lattice (no YOLO)
 */
export type RegistryToolPolicyGateAction =
  | Readonly<{
      action: 'deny'
      policyDecision: 'forbidden'
      policyReason: string
      matchedRuleIndex?: number
    }>
  | Readonly<{
      action: 'force_interactive'
      policyDecision: 'prompt'
      policyReason: string
      matchedRuleIndex?: number
    }>
  | Readonly<{
      action: 'defer_to_approval_mode'
      policyDecision: 'allow'
      policyReason: string
      matchedRuleIndex?: number
    }>

/** Audit vocabulary for write-rewind journal association (policy + interactive deny). */
export type JournalPermissionDecision = ToolPolicyDecision | 'deny'

const DECISION_RANK: Readonly<Record<ToolPolicyDecision, number>> = {
  allow: 0,
  prompt: 1,
  forbidden: 2
}

/**
 * In-process default when no teacher/workspace policy document is loaded.
 * `defaultDecision: 'allow'` keeps the existing approvalMode lattice in charge
 * until declarative rules are supplied — tool-policy must not invent YOLO, and
 * must not silently replace full_access / request_approval with a global prompt.
 * Privileged tools still fail closed when a document omits defaultDecision
 * (see evaluateToolPolicy); this document is explicit allow for unloaded residual.
 */
export const DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT: ToolPolicyDocument = Object.freeze({
  version: 1 as const,
  defaultDecision: 'allow' as const,
  rules: Object.freeze([]) as readonly ToolPolicyRule[]
})

/** Map write-policy allow|ask|deny onto tool-policy allow|prompt|forbidden. */
export function mapWritePolicyDecision(decision: WritePolicyDecision): ToolPolicyDecision {
  switch (decision) {
    case 'allow':
      return 'allow'
    case 'ask':
      return 'prompt'
    case 'deny':
      return 'forbidden'
    default: {
      const _exhaustive: never = decision
      return _exhaustive
    }
  }
}

/** True when `a` is strictly stricter than `b` (forbidden > prompt > allow). */
export function isStricterDecision(a: ToolPolicyDecision, b: ToolPolicyDecision): boolean {
  return DECISION_RANK[a] > DECISION_RANK[b]
}

/** Pick the strictest decision among a non-empty list. */
export function strictestDecision(
  decisions: readonly ToolPolicyDecision[]
): ToolPolicyDecision {
  let best: ToolPolicyDecision = 'allow'
  for (const d of decisions) {
    if (isStricterDecision(d, best)) best = d
  }
  return best
}

/**
 * Pure multi-document merge with most-restrictive-wins semantics (ADR-0112 / B-08 residual).
 *
 * - Empty input → frozen copy equivalent of `DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT` (fail-soft product readiness).
 * - Null/undefined entries → throw (fail-closed).
 * - Any `version !== 1` → throw (fail-closed).
 * - `rules`: concatenate in input order (later docs append); evaluateToolPolicy already picks strictest among matches.
 * - `defaultDecision`: among documents that define it, pick strictest; if none define it, omit on result.
 * - Does not invent YOLO / always-approve / argv / prefix_rule surfaces.
 */
export function mergeToolPolicyDocuments(
  documents: readonly ToolPolicyDocument[]
): ToolPolicyDocument {
  if (!Array.isArray(documents) || documents.length === 0) {
    return {
      version: 1,
      defaultDecision: DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT.defaultDecision,
      rules: [...DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT.rules]
    }
  }

  const mergedRules: ToolPolicyRule[] = []
  let defaultDecision: ToolPolicyDecision | undefined

  for (let i = 0; i < documents.length; i += 1) {
    const doc = documents[i]
    if (doc == null || typeof doc !== 'object') {
      throw new Error(
        `mergeToolPolicyDocuments: document at index ${i} is null or undefined`
      )
    }
    if (doc.version !== 1) {
      throw new Error(
        `mergeToolPolicyDocuments: document at index ${i} has unsupported version ${String(
          (doc as { version?: unknown }).version
        )}; only version 1 is supported`
      )
    }
    if (!Array.isArray(doc.rules)) {
      throw new Error(
        `mergeToolPolicyDocuments: document at index ${i} has invalid rules (expected array)`
      )
    }

    for (const rule of doc.rules) {
      if (!rule || typeof rule !== 'object' || !isValidDecision(rule.decision)) {
        throw new Error(
          `mergeToolPolicyDocuments: document at index ${i} contains an invalid rule`
        )
      }
      // Reject argv / YOLO product surfaces if present on a rule object.
      const wire = rule as Record<string, unknown>
      if (
        'argv' in wire ||
        'prefix_rule' in wire ||
        'prefixRule' in wire ||
        'alwaysApprove' in wire ||
        'always_approve' in wire ||
        'yolo' in wire ||
        'YOLO' in wire
      ) {
        throw new Error(
          `mergeToolPolicyDocuments: document at index ${i} contains forbidden rule fields (argv/prefix_rule/YOLO)`
        )
      }
      const copied: {
        decision: ToolPolicyDecision
        tools?: string[]
        effects?: string[]
        pathPrefixes?: string[]
      } = { decision: rule.decision }
      if (rule.tools !== undefined) {
        copied.tools = [...rule.tools]
      }
      if (rule.effects !== undefined) {
        copied.effects = [...rule.effects]
      }
      if (rule.pathPrefixes !== undefined) {
        copied.pathPrefixes = [...rule.pathPrefixes]
      }
      mergedRules.push(copied)
    }

    if (doc.defaultDecision !== undefined) {
      if (!isValidDecision(doc.defaultDecision)) {
        throw new Error(
          `mergeToolPolicyDocuments: document at index ${i} has invalid defaultDecision`
        )
      }
      defaultDecision =
        defaultDecision === undefined
          ? doc.defaultDecision
          : strictestDecision([defaultDecision, doc.defaultDecision])
    }
  }

  return {
    version: 1,
    ...(defaultDecision !== undefined ? { defaultDecision } : {}),
    rules: mergedRules
  }
}

/**
 * Evaluate a declarative tool-policy document for one tool call.
 * Pure: no FS, no approval-mode auto-bypass, no YOLO labels.
 */
export function evaluateToolPolicy(input: ToolPolicyEvaluationInput): ToolPolicyEvaluationResult {
  const toolName = typeof input.toolName === 'string' ? input.toolName.trim() : ''
  const effectClass =
    typeof input.effectClass === 'string' && input.effectClass.trim()
      ? input.effectClass.trim()
      : 'privileged'
  const document = input.document
  const normalizedPath =
    typeof input.path === 'string' ? normalizeRelativePath(input.path) : null

  if (!toolName) {
    return {
      decision: 'forbidden',
      reason: 'missing_tool_name'
    }
  }

  if (!document || document.version !== 1 || !Array.isArray(document.rules)) {
    return {
      decision: resolveDefaultDecision(undefined, effectClass),
      reason: 'invalid_document'
    }
  }

  let bestDecision: ToolPolicyDecision | null = null
  let bestIndex: number | undefined

  for (let index = 0; index < document.rules.length; index += 1) {
    const rule = document.rules[index]
    if (!rule || !isValidDecision(rule.decision)) continue
    if (!ruleMatches(rule, toolName, effectClass, normalizedPath)) continue

    if (bestDecision === null || isStricterDecision(rule.decision, bestDecision)) {
      bestDecision = rule.decision
      bestIndex = index
    }
  }

  if (bestDecision !== null) {
    return {
      decision: bestDecision,
      matchedRuleIndex: bestIndex,
      reason: `matched_rule:${bestIndex}`
    }
  }

  const fallback = resolveDefaultDecision(document.defaultDecision, effectClass)
  return {
    decision: fallback,
    reason:
      document.defaultDecision !== undefined
        ? 'default_decision'
        : effectClass === 'privileged'
          ? 'default_fail_closed_privileged'
          : 'default_prompt'
  }
}

/**
 * Pure registry gate: map evaluateToolPolicy onto deny / force interactive / defer.
 * Forbidden always wins over approvalMode full_access auto-allow.
 */
export function evaluateRegistryToolPolicyGate(input: {
  toolName: string
  effectClass: ToolEffectClass | string
  path?: string
  document?: ToolPolicyDocument | null
}): RegistryToolPolicyGateAction {
  const document = input.document ?? DEFAULT_IN_PROCESS_TOOL_POLICY_DOCUMENT
  const result = evaluateToolPolicy({
    toolName: input.toolName,
    effectClass: input.effectClass,
    path: input.path,
    document
  })

  if (result.decision === 'forbidden') {
    return {
      action: 'deny',
      policyDecision: 'forbidden',
      policyReason: result.reason,
      ...(result.matchedRuleIndex !== undefined
        ? { matchedRuleIndex: result.matchedRuleIndex }
        : {})
    }
  }

  if (result.decision === 'prompt') {
    return {
      action: 'force_interactive',
      policyDecision: 'prompt',
      policyReason: result.reason,
      ...(result.matchedRuleIndex !== undefined
        ? { matchedRuleIndex: result.matchedRuleIndex }
        : {})
    }
  }

  return {
    action: 'defer_to_approval_mode',
    policyDecision: 'allow',
    policyReason: result.reason,
    ...(result.matchedRuleIndex !== undefined
      ? { matchedRuleIndex: result.matchedRuleIndex }
      : {})
  }
}

/**
 * Pure parse of an unknown JSON-shaped policy document.
 * No filesystem I/O. Returns null on invalid shape (fail closed at call site).
 */
export function loadToolPolicyDocument(raw: unknown): ToolPolicyDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record.version !== 1) return null
  if (!Array.isArray(record.rules)) return null

  const rules: ToolPolicyRule[] = []
  for (const item of record.rules) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const rule = item as Record<string, unknown>
    if (!isValidDecision(rule.decision)) return null
    const parsed: {
      decision: ToolPolicyDecision
      tools?: string[]
      effects?: string[]
      pathPrefixes?: string[]
    } = { decision: rule.decision }
    if (rule.tools !== undefined) {
      if (!Array.isArray(rule.tools) || !rule.tools.every((t) => typeof t === 'string')) return null
      parsed.tools = rule.tools.map((t) => t.trim()).filter(Boolean)
    }
    if (rule.effects !== undefined) {
      if (!Array.isArray(rule.effects) || !rule.effects.every((e) => typeof e === 'string')) return null
      parsed.effects = rule.effects.map((e) => e.trim()).filter(Boolean)
    }
    if (rule.pathPrefixes !== undefined) {
      if (
        !Array.isArray(rule.pathPrefixes) ||
        !rule.pathPrefixes.every((p) => typeof p === 'string')
      ) {
        return null
      }
      parsed.pathPrefixes = rule.pathPrefixes.map((p) => p.trim()).filter(Boolean)
    }
    // Reject argv / prefix_rule product surfaces if present on the wire shape.
    if ('argv' in rule || 'prefix_rule' in rule || 'prefixRule' in rule) return null
    if ('alwaysApprove' in rule || 'always_approve' in rule || 'yolo' in rule || 'YOLO' in rule) {
      return null
    }
    rules.push(parsed)
  }

  let defaultDecision: ToolPolicyDecision | undefined
  if (record.defaultDecision !== undefined) {
    if (!isValidDecision(record.defaultDecision)) return null
    defaultDecision = record.defaultDecision
  }

  return {
    version: 1,
    ...(defaultDecision !== undefined ? { defaultDecision } : {}),
    rules
  }
}

/**
 * Pure association helper: attach permission audit metadata to a journal entry shape
 * without owning checkpoint layout or permission settlement.
 */
export function associatePermissionDecision<T extends Record<string, unknown>>(
  entry: T,
  decision: JournalPermissionDecision | null | undefined
): T & { permissionDecision?: JournalPermissionDecision } {
  if (
    decision !== 'allow' &&
    decision !== 'prompt' &&
    decision !== 'forbidden' &&
    decision !== 'deny'
  ) {
    return entry
  }
  return { ...entry, permissionDecision: decision }
}

/**
 * Map registry policy gate + interactive resolution onto journal audit vocab.
 * Pure / fail-soft: unknown combinations return undefined (caller omits field).
 *
 * Stable rule (ADR-0108 / B-08 capture wire):
 * - gate `deny` → `forbidden` (policy short-circuit; capture path never runs)
 * - interactive `deny` → `deny` (handler not run; capture never runs)
 * - gate `force_interactive` + allow* → `prompt`
 * - gate `defer_to_approval_mode` / `allow` + allow* → `allow`
 * Never used to re-authorize writes; journal does not own permission settlement.
 */
export function journalPermissionDecisionFromGateAndResolution(input: {
  policyAction: 'allow' | 'force_interactive' | 'deny' | 'defer_to_approval_mode' | string
  interactiveDecision?:
    | 'allow'
    | 'allow_once'
    | 'allow_for_run'
    | 'allow_for_directory'
    | 'deny'
    | string
}): JournalPermissionDecision | undefined {
  const action = input.policyAction
  const interactive = input.interactiveDecision

  if (action === 'deny') return 'forbidden'
  if (interactive === 'deny') return 'deny'

  const granted =
    interactive === undefined ||
    interactive === 'allow' ||
    interactive === 'allow_once' ||
    interactive === 'allow_for_run' ||
    interactive === 'allow_for_directory'

  if (!granted) return undefined

  if (action === 'force_interactive') return 'prompt'
  if (action === 'defer_to_approval_mode' || action === 'allow') return 'allow'
  return undefined
}

function resolveDefaultDecision(
  explicit: ToolPolicyDecision | undefined,
  effectClass: string
): ToolPolicyDecision {
  if (explicit !== undefined && isValidDecision(explicit)) return explicit
  // Fail closed for privileged / unknown effect classes when document omits default.
  if (effectClass === 'privileged') return 'forbidden'
  return 'prompt'
}

function isValidDecision(value: unknown): value is ToolPolicyDecision {
  return value === 'allow' || value === 'prompt' || value === 'forbidden'
}

function ruleMatches(
  rule: ToolPolicyRule,
  toolName: string,
  effectClass: string,
  normalizedPath: string | null
): boolean {
  const hasTools = Array.isArray(rule.tools) && rule.tools.length > 0
  const hasEffects = Array.isArray(rule.effects) && rule.effects.length > 0
  const hasPaths = Array.isArray(rule.pathPrefixes) && rule.pathPrefixes.length > 0

  // Rules with no dimensions never match (avoid accidental global allow).
  if (!hasTools && !hasEffects && !hasPaths) return false

  if (hasTools) {
    const names = rule.tools!.map((n) => (typeof n === 'string' ? n.trim() : '')).filter(Boolean)
    if (!names.includes(toolName)) return false
  }

  if (hasEffects) {
    const effects = rule.effects!
      .map((e) => (typeof e === 'string' ? e.trim() : ''))
      .filter(Boolean)
    if (!effects.includes(effectClass)) return false
  }

  if (hasPaths) {
    // Path-constrained rules require a valid relative path.
    if (!normalizedPath) return false
    if (!pathMatchesAnyPrefix(normalizedPath, rule.pathPrefixes!)) return false
  }

  return true
}

/**
 * Prefix match on normalized relative paths.
 * Prefixes are normalized with the same helper as write-policy; trailing '/' is optional.
 */
function pathMatchesAnyPrefix(path: string, prefixes: readonly string[]): boolean {
  for (const raw of prefixes) {
    if (typeof raw !== 'string') continue
    const normalizedPrefix = normalizeRelativePath(raw.endsWith('/') ? raw.slice(0, -1) : raw)
    if (!normalizedPrefix) continue
    if (path === normalizedPrefix) return true
    if (path.startsWith(`${normalizedPrefix}/`)) return true
  }
  return false
}
