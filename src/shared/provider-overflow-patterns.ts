/**
 * Provider context-overflow pattern library (ADAPT-P1 / ADR-0125).
 *
 * Pure text + usage heuristics adapted from Pi's overflow pattern catalog.
 * Does NOT import AssistantMessage / monorepo pi-ai types.
 *
 * Policy (unchanged from ADR-0052/0057):
 * - overflow is never auto-retried
 * - recovery still sets shouldCompress:true when classified as context_overflow
 */

/** Provider-specific overflow error text patterns (case-insensitive where applicable). */
export const OVERFLOW_PATTERNS: readonly RegExp[] = [
  /prompt is too long/i, // Anthropic token overflow
  /request_too_large/i, // Anthropic request byte-size overflow (HTTP 413)
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions & Responses API)
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i, // OpenAI-compatible / LiteLLM
  /input length\s*\([\d,]+\)\s*exceeds model'?s? maximum context length/i, // OpenAI-compatible alt phrasing
  /input token count.*exceeds the maximum/i, // Google Gemini
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter (most backends)
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i, // OpenRouter/Poolside
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i, // Together AI
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding
  /too large for model with \d+ maximum context length/i, // Mistral
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i, // DS4 server
  /model_context_window_exceeded/i, // z.ai non-standard finish_reason as error text
  /prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow
  /context[_ ]length[_ ]exceeded/i, // Generic fallback (OpenAI code-style)
  /context[_\s-]*(?:length|window)?[_\s-]*(?:exceeded|overflow|too large|too long)/i, // Generic context window phrasing
  /too many tokens/i, // Generic fallback (needs NON_OVERFLOW exclusion)
  /token limit exceeded/i, // Generic fallback
  /input is too long/i, // Generic short form
  /tokens? exceed(?:s|ed)?.*(?:context|limit|window)/i, // Generic "tokens exceed …"
  /requested token count exceeds/i, // OpenAI/LiteLLM alt
  /this endpoint's maximum context length/i, // OpenRouter alt
  /上下文超限|上下文长度超限|超出上下文|上下文窗口不足|超过最大上下文|上下文长度超过/i, // Chinese gateway phrasing
  /\b4(?:00|13)\s*(?:status code)?\s*\(no body\)/i // Cerebras: 400/413 with no body
]

/**
 * Non-overflow exclusions (e.g. throttling that mentions "Too many tokens").
 * Matched messages must NOT be classified as context overflow even if an
 * OVERFLOW_PATTERN also matches.
 */
export const NON_OVERFLOW_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s;:])(?:Throttling error|Service unavailable):/i, // AWS Bedrock human-readable prefixes
  /ThrottlingException/i, // AWS Bedrock exception type
  /rate[_\s-]*limit/i, // Generic rate limiting
  /too many requests/i, // Generic HTTP 429 style
  /please wait before trying again/i, // Bedrock throttling suffix
  /请求过于频繁|速率限制/i // Chinese rate-limit phrasing
]

export type OverflowUsageSnapshot = {
  input: number
  output: number
  cacheRead?: number
}

/**
 * Match provider error text against the overflow pattern library,
 * applying NON_OVERFLOW exclusions first.
 */
export function matchOverflowErrorText(text: string): boolean {
  if (!text) return false
  const haystack = text
  if (NON_OVERFLOW_PATTERNS.some((p) => p.test(haystack))) {
    return false
  }
  return OVERFLOW_PATTERNS.some((p) => p.test(haystack))
}

/**
 * Silent / length-stop overflow heuristics (z.ai + Xiaomi MiMo style).
 *
 * - stop + (input + cacheRead) > contextWindow → overflow
 * - length + output === 0 + (input + cacheRead) >= 0.99 * contextWindow → overflow
 */
export function isSilentContextOverflow(
  usage: OverflowUsageSnapshot,
  stopReason: string | undefined,
  contextWindow: number | undefined
): boolean {
  if (contextWindow == null || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return false
  }
  const input = Number.isFinite(usage.input) ? usage.input : 0
  const cacheRead = Number.isFinite(usage.cacheRead) ? (usage.cacheRead ?? 0) : 0
  const output = Number.isFinite(usage.output) ? usage.output : 0
  const inputTokens = input + cacheRead
  const stop = (stopReason ?? '').toLowerCase()

  // z.ai style: accepted "successfully" but usage exceeds context
  if (stop === 'stop' && inputTokens > contextWindow) {
    return true
  }

  // Xiaomi MiMo style: truncated input fills window, no room for output
  if (stop === 'length' && output === 0 && inputTokens >= contextWindow * 0.99) {
    return true
  }

  return false
}

/** Test helper: shallow copy of overflow patterns. */
export function getOverflowPatterns(): RegExp[] {
  return [...OVERFLOW_PATTERNS]
}

/** Test helper: shallow copy of non-overflow exclusion patterns. */
export function getNonOverflowPatterns(): RegExp[] {
  return [...NON_OVERFLOW_PATTERNS]
}
