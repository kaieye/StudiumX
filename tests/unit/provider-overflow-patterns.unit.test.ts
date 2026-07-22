import { describe, expect, it } from 'vitest'
import {
  getNonOverflowPatterns,
  getOverflowPatterns,
  isSilentContextOverflow,
  matchOverflowErrorText
} from '../../src/shared/provider-overflow-patterns'

describe('matchOverflowErrorText (ADAPT-P1)', () => {
  const positiveFixtures: Array<{ family: string; text: string }> = [
    { family: 'Anthropic', text: 'prompt is too long: 213462 tokens > 200000 maximum' },
    { family: 'Anthropic 413', text: '413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}}' },
    { family: 'OpenAI', text: 'Your input exceeds the context window of this model' },
    { family: 'OpenAI/LiteLLM', text: "Requested token count exceeds the model's maximum context length of 131072 tokens" },
    {
      family: 'OpenAI-compatible',
      text: "Input length (265330) exceeds model's maximum context length (262144)."
    },
    {
      family: 'Gemini',
      text: 'The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)'
    },
    {
      family: 'xAI',
      text: "This model's maximum prompt length is 131072 but the request contains 537812 tokens"
    },
    { family: 'Groq', text: 'Please reduce the length of the messages or completion' },
    {
      family: 'OpenRouter',
      text: "This endpoint's maximum context length is 128000 tokens. However, you requested about 200000 tokens"
    },
    {
      family: 'OpenRouter/Poolside',
      text: 'Input length 90000 exceeds the maximum allowed input length of 80000 tokens.'
    },
    {
      family: 'Together',
      text: "The input (90000 tokens) is longer than the model's context length (8192 tokens)."
    },
    {
      family: 'llama.cpp',
      text: 'the request exceeds the available context size, try increasing it'
    },
    {
      family: 'LM Studio',
      text: 'tokens to keep from the initial prompt is greater than the context length'
    },
    { family: 'Copilot', text: 'prompt token count of 120000 exceeds the limit of 100000' },
    { family: 'MiniMax', text: 'invalid params, context window exceeds limit' },
    {
      family: 'Kimi',
      text: 'Your request exceeded model token limit: 128000 (requested: 200000)'
    },
    {
      family: 'DS4',
      text: 'Prompt has 90000 tokens, but the configured context size is 32000 tokens'
    },
    { family: 'Cerebras 400', text: '400 status code (no body)' },
    { family: 'Cerebras 413', text: '413 (no body)' },
    {
      family: 'Mistral',
      text: 'Prompt contains 90000 tokens and is too large for model with 32000 maximum context length'
    },
    { family: 'z.ai code', text: 'model_context_window_exceeded' },
    {
      family: 'Ollama',
      text: 'prompt too long; exceeded max context length by 1200 tokens'
    },
    { family: 'Bedrock', text: 'input is too long for requested model' },
    { family: 'generic code', text: 'context_length_exceeded' },
    { family: 'Chinese gateway', text: '请求失败：上下文超限，请缩短历史消息' }
  ]

  for (const fixture of positiveFixtures) {
    it(`matches ${fixture.family}`, () => {
      expect(matchOverflowErrorText(fixture.text)).toBe(true)
    })
  }

  it('excludes Bedrock ThrottlingException "Too many tokens" (NON_OVERFLOW)', () => {
    const text = 'ThrottlingException: Too many tokens, please wait before trying again.'
    expect(matchOverflowErrorText(text)).toBe(false)
  })

  it('excludes rate limit phrasing that would otherwise match too-many-tokens', () => {
    expect(matchOverflowErrorText('rate limit: too many tokens')).toBe(false)
    expect(matchOverflowErrorText('Too many requests: please slow down')).toBe(false)
  })

  it('does not match unrelated errors', () => {
    expect(matchOverflowErrorText('internal server error')).toBe(false)
    expect(matchOverflowErrorText('invalid api key')).toBe(false)
  })

  it('exports pattern lists for inspection', () => {
    expect(getOverflowPatterns().length).toBeGreaterThan(10)
    expect(getNonOverflowPatterns().length).toBeGreaterThan(2)
  })
})

describe('isSilentContextOverflow (ADAPT-P1)', () => {
  it('detects z.ai style: stop + input+cacheRead > contextWindow', () => {
    expect(
      isSilentContextOverflow({ input: 90_000, output: 12, cacheRead: 20_000 }, 'stop', 100_000)
    ).toBe(true)
  })

  it('does not flag stop when under window', () => {
    expect(
      isSilentContextOverflow({ input: 10_000, output: 50, cacheRead: 1_000 }, 'stop', 100_000)
    ).toBe(false)
  })

  it('detects length-stop filled window with zero output (Xiaomi MiMo style)', () => {
    expect(
      isSilentContextOverflow({ input: 99_500, output: 0, cacheRead: 0 }, 'length', 100_000)
    ).toBe(true)
  })

  it('requires near-full window for length+zero-output', () => {
    expect(
      isSilentContextOverflow({ input: 50_000, output: 0, cacheRead: 0 }, 'length', 100_000)
    ).toBe(false)
  })

  it('does not flag length when there is output', () => {
    expect(
      isSilentContextOverflow({ input: 100_000, output: 8, cacheRead: 0 }, 'length', 100_000)
    ).toBe(false)
  })

  it('returns false without a finite positive contextWindow', () => {
    expect(isSilentContextOverflow({ input: 200_000, output: 0 }, 'stop', undefined)).toBe(false)
    expect(isSilentContextOverflow({ input: 200_000, output: 0 }, 'stop', 0)).toBe(false)
  })
})
