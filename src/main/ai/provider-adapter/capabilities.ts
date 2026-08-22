import type {
  ModelEndpointFormat,
  ModelReasoningEffort,
  TeachingModelProviderProfile,
  TeachingSettingsV1
} from '../../../shared/teaching-types'
import {
  modelReasoningProtocolForProviderModel
} from '../../../shared/model-provider-catalog'

function lowerHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return baseUrl.toLowerCase()
  }
}

function isDeepSeekReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  if (catalogReasoningProtocol(provider, model) === 'deepseek') return true
  const host = lowerHost(provider.baseUrl)
  return provider.id === 'deepseek' || host.includes('deepseek.com') || /^deepseek[-_.]/i.test(model)
}

function isVolcengineArkResponsesProvider(provider: TeachingModelProviderProfile): boolean {
  return lowerHost(provider.baseUrl) === 'ark.cn-beijing.volces.com'
}

function isGlmReasoningProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  if (catalogReasoningProtocol(provider, model) === 'glm') return true
  return /^glm-5(?:[.-]|$)/i.test(model)
}

function isMiniMaxOpenAiProvider(provider: TeachingModelProviderProfile): boolean {
  const host = lowerHost(provider.baseUrl)
  return host.includes('minimaxi.com') && !provider.baseUrl.toLowerCase().includes('/anthropic')
}

function supportsOpenAiReasoningEffort(provider: TeachingModelProviderProfile, model: string): boolean {
  if (catalogReasoningProtocol(provider, model) === 'openai') return true
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

export type StructuredOutputReasoningPolicy = 'allow' | 'omit' | 'disable'

function isAnthropicClaudeProvider(provider: TeachingModelProviderProfile, model: string): boolean {
  if (catalogReasoningProtocol(provider, model) === 'anthropic') return true
  return provider.id === 'anthropic' || /^claude-(opus|sonnet|haiku|fable|mythos)/i.test(model)
}

/**
 * Decide whether a strict JSON request may carry provider-specific reasoning
 * controls. Model ids and compatible gateways are open-ended, so unknown
 * combinations deliberately take the conservative path and omit extra
 * controls rather than guessing a parameter the gateway may reject.
 */
export function structuredOutputReasoningPolicy(
  provider: TeachingModelProviderProfile,
  model: string
): StructuredOutputReasoningPolicy {
  if (isDeepSeekReasoningProvider(provider, model)) return 'disable'
  if (isGlmReasoningProvider(provider, model)) return 'disable'
  if (isMiniMaxOpenAiProvider(provider)) return 'disable'
  if (isAnthropicClaudeProvider(provider, model)) return 'allow'

  const protocol = catalogReasoningProtocol(provider, model)
  if (protocol === 'openai') return 'allow'

  // These are explicit, documented OpenAI-compatible reasoning families. Do
  // not treat every custom provider as compatible: a custom gateway may use a
  // different parameter vocabulary even when its endpoint is OpenAI-shaped.
  const host = lowerHost(provider.baseUrl)
  if (
    provider.id === 'xiaomi' ||
    host.includes('openai.com') ||
    host.includes('xiaomimimo.com') ||
    /^mimo[-_.]/i.test(model) ||
    /^o\d/i.test(model) ||
    /^gpt-\d/i.test(model)
  ) {
    return 'allow'
  }

  return 'omit'
}

function catalogReasoningProtocol(provider: TeachingModelProviderProfile, model: string) {
  return modelReasoningProtocolForProviderModel({
    providerId: provider.id,
    providerBaseUrl: provider.baseUrl,
    modelId: model
  })
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
  generator: TeachingSettingsV1['generator'],
  options?: { reasoningPolicy?: StructuredOutputReasoningPolicy }
): Record<string, unknown> {
  if (isAnthropicClaudeProvider(provider, generator.model)) {
    const effort = generator.reasoningEffort ?? 'auto'
    if (effort === 'off' || options?.reasoningPolicy === 'omit') return {}
    const normalizedEffort = normalizeAnthropicReasoningEffort(effort)
    return {
      ...(options?.reasoningPolicy === 'disable' ? {} : { thinking: { type: 'adaptive' } }),
      ...(normalizedEffort && options?.reasoningPolicy !== 'disable'
        ? { output_config: { effort: normalizedEffort } }
        : {})
    }
  }
  return { temperature: generator.temperature }
}

export function reasoningRequestOptions(
  format: ModelEndpointFormat,
  provider: TeachingModelProviderProfile,
  generator: TeachingSettingsV1['generator'],
  options?: { jsonMode?: boolean; reasoningPolicy?: StructuredOutputReasoningPolicy }
): Record<string, unknown> {
  const effort = generator.reasoningEffort ?? 'auto'
  const policy = options?.reasoningPolicy ?? (
    options?.jsonMode && format === 'responses' &&
      isDeepSeekReasoningProvider(provider, generator.model) &&
      isVolcengineArkResponsesProvider(provider)
      ? 'disable'
      : options?.jsonMode
        ? structuredOutputReasoningPolicy(provider, generator.model)
        : 'allow'
  )

  if (format === 'messages') {
    return anthropicGenerationOptions(provider, generator, { reasoningPolicy: policy })
  }

  if (policy === 'omit') return {}

  if (format === 'responses' && policy === 'disable') {
    // DeepSeek enables thinking by default on Responses endpoints; a strict
    // JSON request can then exhaust max_output_tokens on reasoning and settle
    // with truncated or empty output_text. Explicitly disable thinking for
    // every DeepSeek provider here. If a specific OpenAI-compatible Responses
    // gateway rejects the `thinking` field, the invocation layer retries once
    // with policy='omit' — it never turns an output-shape risk into a hard
    // parse failure for the learner.
    if (isDeepSeekReasoningProvider(provider, generator.model)) {
      return { thinking: { type: 'disabled' } }
    }
    return {}
  }

  if (format === 'responses') {
    const openAiEffort = normalizeOpenAiReasoningEffort(effort)
    return openAiEffort ? { reasoning: { effort: openAiEffort } } : {}
  }
  if (isGlmReasoningProvider(provider, generator.model)) {
    // GLM-5.x enables thinking by default. Structured JSON generation should
    // explicitly disable it so reasoning tokens do not consume the lesson
    // output budget or delay the first usable content until the request timeout.
    return { thinking: { type: policy === 'disable' || effort === 'off' ? 'disabled' : 'enabled' } }
  }
  if (isDeepSeekReasoningProvider(provider, generator.model)) {
    // JSON 输出（response_format: json_object）与 thinking 推理模式在 OpenAI 兼容
    // 端点上互斥：推理模型会把全部输出放进 reasoning_content，导致 content 为空、
    // JSON 提取失败甚至请求超时。严格 JSON 场景显式关闭 thinking；普通对话仍保留
    // DeepSeek 的 reasoning 控制。若兼容网关不接受 thinking，调用层会进行一次
    // 有界的 omit 重试，而不会无限重放请求。
    if (policy === 'disable') return { thinking: { type: 'disabled' } }
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: normalizeDeepSeekReasoningEffort(effort)
    }
  }
  if (isMiniMaxOpenAiProvider(provider)) {
    return { thinking: { type: policy === 'disable' ? 'disabled' : normalizeMiniMaxThinkingType(effort) } }
  }
  if (!supportsOpenAiReasoningEffort(provider, generator.model)) return {}
  const openAiEffort = normalizeOpenAiReasoningEffort(effort)
  return openAiEffort ? { reasoning_effort: openAiEffort } : {}
}
