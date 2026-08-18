/**
 * Child capability subset proof (ADOPTION B-10 / ADR-0005).
 *
 * Pure fail-closed helpers: a child agent must never receive tools outside
 * the parent's allow-list when that parent list is provided for enforcement.
 * Profile proposals still come from delegation-runtime; this module only
 * proves subset / intersects proposed tools with the parent grant.
 */

export const CHILD_CAPABILITY_AMPLIFICATION = 'child_capability_amplification' as const

export type ChildCapabilitySubsetOk = { ok: true }

export type ChildCapabilitySubsetDenied = {
  ok: false
  code: typeof CHILD_CAPABILITY_AMPLIFICATION
  amplified: string[]
  reason: string
}

export type ChildCapabilitySubsetResult = ChildCapabilitySubsetOk | ChildCapabilitySubsetDenied

export type AssertChildCapabilitiesSubsetInput = {
  parentAllowedToolNames: readonly string[]
  childAllowedToolNames: readonly string[]
  parentProfile?: string
  childProfile?: string
}

/**
 * Proves that every child-allowed tool name is present in the parent allow-list.
 * Does not invent tools; empty parent yields denial for any non-empty child list.
 */
export function assertChildCapabilitiesSubset(
  input: AssertChildCapabilitiesSubsetInput
): ChildCapabilitySubsetResult {
  const parent = new Set(input.parentAllowedToolNames)
  const amplified = uniqueSorted(
    input.childAllowedToolNames.filter((toolName) => !parent.has(toolName))
  )
  if (amplified.length === 0) return { ok: true }

  const profileBits = [
    input.parentProfile ? `parentProfile=${input.parentProfile}` : null,
    input.childProfile ? `childProfile=${input.childProfile}` : null
  ].filter(Boolean)
  const profileSuffix = profileBits.length > 0 ? ` (${profileBits.join(', ')})` : ''
  return {
    ok: false,
    code: CHILD_CAPABILITY_AMPLIFICATION,
    amplified,
    reason: `child capability amplification denied: ${amplified.join(', ')}${profileSuffix}`
  }
}

/**
 * Fail-closed intersection: only tools present in both parent grant and child
 * proposal survive. Empty parent → empty child. Order follows child proposal.
 */
export function intersectChildToolsWithParent(input: {
  parentAllowedToolNames: readonly string[]
  childProposedToolNames: readonly string[]
}): string[] {
  const parent = new Set(input.parentAllowedToolNames)
  const out: string[] = []
  const seen = new Set<string>()
  for (const toolName of input.childProposedToolNames) {
    if (!parent.has(toolName) || seen.has(toolName)) continue
    seen.add(toolName)
    out.push(toolName)
  }
  return out
}

/**
 * Throws when childAllowed is not a subset of parentAllowed.
 * Stable error code: child_capability_amplification.
 */
export function assertChildCapabilitiesSubsetOrThrow(
  input: AssertChildCapabilitiesSubsetInput
): asserts input is AssertChildCapabilitiesSubsetInput {
  const result = assertChildCapabilitiesSubset(input)
  if (!result.ok) {
    throw new ChildCapabilityAmplificationError(result)
  }
}

export class ChildCapabilityAmplificationError extends Error {
  readonly code = CHILD_CAPABILITY_AMPLIFICATION
  readonly amplified: string[]

  constructor(result: ChildCapabilitySubsetDenied) {
    super(result.reason)
    this.name = 'ChildCapabilityAmplificationError'
    this.amplified = result.amplified
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}
