import type {
  ModelEndpointFormat,
  ModelReasoningEffort,
  TeachingModelProviderProfile,
  TeachingSettingsV1
} from '../../../shared/teaching-types'

function lowerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return baseUrl.toLowerCase()
  }
}

function isDeepSeekReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = lowerHost(provider.baseUrl)
  return provider.id === 'deepseek' || host.includes('deepseek.com') || /^deepseek[-_.]/i.test(model)
}

function isMiniMaxOpenAiProvider(provider: TeachingModelProviderProfile): boolean {
  const host = lowerHost(provider.baseUrl)
  return host.includes('minimaxi.com') && !provider.baseUrl.toLowerCase().includes('/anthropic')
}

function supportsOpenAiReasoningEffort(provider: TeachingModelProviderProfile, model: string): boolean {
  const host = lowerHost(provider.baseUrl)
  return (
    provider.id === 'custom' ||
    provider.id === 'xiaomi' ||
    host.includes('openai.com') ||
    host.includes('xiaomimimo.com') ||
    /^mimo[-_.]/i.test(model) ||
    /^o\d/i.test(model) ||
    /^gpt-\d/i.test(model)
  )
}

function isAnthropicClaudeProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  return provider.id === 'anthropic' || /^claude-(opus|sonnet|haiku|fable|mythos)/i.test(model)
}

function normalizeDeepSeekReasoningEffort(effort: ModelReasoningEffort): 'high' | 'max' {
  return effort === 'max' || effort === 'xhigh' ? 'max' : 'high'
}

function normalizeOpenAiReasoningEffort(effort: ModelReasoningEffort): 'low' | 'medium' | 'high' | '' {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
      return effort
    case 'xhigh':
    case 'max':
      return 'high'
    default:
      return ''
  }
}

function normalizeAnthropicReasoningEffort(
  effort: ModelReasoningEffort
): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | '' {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return effort
    case 'auto':
      return 'high'
    default:
      return ''
  }
}

function normalizeMiniMaxThinkingType(effort: ModelReasoningEffort): 'adaptive' | 'disabled' {
  switch (effort) {
    case 'off':
    case 'xhigh':
    case 'max':
      return 'disabled'
    default:
      return 'adaptive'
  }
}

export function anthropicGenerationOptions(
  provider: TeachingModelProviderProfile,
  generator: TeachingSettingsV1['generator']
): Record<string, unknown> {
  if (isAnthropicClaudeProvider(provider, generator.model)) {
    const effort = generator.reasoningEffort ?? 'auto'
    if (effort === 'off') return {}
    const normalizedEffort = normalizeAnthropicReasoningEffort(effort)
    return {
      thinking: { type: 'adaptive' },
      ...(normalizedEffort ? { output_config: { effort: normalizedEffort } } : {})
    }
  }
  return { temperature: generator.temperature }
}

export function reasoningRequestOptions(
  format: ModelEndpointFormat,
  provider: TeachingModelProviderProfile,
  generator: TeachingSettingsV1['generator']
): Record<string, unknown> {
  const effort = generator.reasoningEffort ?? 'auto'
  if (format === 'messages') return anthropicGenerationOptions(provider, generator)
  if (format === 'responses') {
    const openAiEffort = normalizeOpenAiReasoningEffort(effort)
    return openAiEffort ? { reasoning: { effort: openAiEffort } } : {}
  }
  if (isDeepSeekReasoningProvider(provider, generator.model)) {
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: normalizeDeepSeekReasoningEffort(effort)
    }
  }
  if (isMiniMaxOpenAiProvider(provider)) {
    return { thinking: { type: normalizeMiniMaxThinkingType(effort) } }
  }
  if (!supportsOpenAiReasoningEffort(provider, generator.model)) return {}
  const openAiEffort = normalizeOpenAiReasoningEffort(effort)
  return openAiEffort ? { reasoning_effort: openAiEffort } : {}
}

export function toolsSupportedForFormat(format: ModelEndpointFormat): boolean {
  return format === 'chat_completions' || format === 'custom_endpoint'
}
