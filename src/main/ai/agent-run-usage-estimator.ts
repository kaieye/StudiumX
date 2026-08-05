/**
 * Bounded local arithmetic for usage observations that lack a provider-supplied
 * total. This is an audit estimate only: callers must never treat it as a
 * provider quota/billing reading or charge it to a measured resource meter.
 */
export const MAX_LOCAL_TOKEN_USAGE_ESTIMATE = 1_000_000

export type AgentRunUsageEstimateInput = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type AgentRunUsageEstimate = {
  totalTokens: number
}

/**
 * Return one deterministic local total only when the caller supplied either an
 * explicit local total or both components. Missing, malformed, or over-bound
 * inputs deliberately remain unknown rather than being padded with a guess.
 */
export function estimateAgentRunUsage(input: AgentRunUsageEstimateInput): AgentRunUsageEstimate | undefined {
  const explicitTotal = boundedTokenCount(input.totalTokens)
  if (explicitTotal !== undefined) return { totalTokens: explicitTotal }

  const promptTokens = boundedTokenCount(input.promptTokens)
  const completionTokens = boundedTokenCount(input.completionTokens)
  if (promptTokens === undefined || completionTokens === undefined) return undefined

  const totalTokens = promptTokens + completionTokens
  return totalTokens <= MAX_LOCAL_TOKEN_USAGE_ESTIMATE ? { totalTokens } : undefined
}

function boundedTokenCount(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_LOCAL_TOKEN_USAGE_ESTIMATE) return undefined
  return value
}