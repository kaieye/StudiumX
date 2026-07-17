import { describe, expect, it } from 'vitest'
import {
  lessonGenerationBudgetFallback,
  lessonGenerationMaxIterations,
  lessonGenerationRunBudget,
  lessonGenerationSuccessFallback
} from '../../src/main/teaching-conversation-lesson-tool'

describe('lessonGenerationMaxIterations', () => {
  it('reserves durable generation iterations beyond the configured planning allowance', () => {
    expect(lessonGenerationMaxIterations(4)).toBe(8)
    expect(lessonGenerationMaxIterations(8)).toBe(12)
  })

  it('keeps unlimited mode unlimited and normalizes invalid configuration', () => {
    expect(lessonGenerationMaxIterations(0)).toBe(0)
    expect(lessonGenerationMaxIterations(Number.NaN)).toBe(0)
  })
})

describe('lessonGenerationRunBudget', () => {
  const configured = {
    maxDurationMs: 120_000,
    maxProviderCalls: 16,
    maxToolCalls: 32,
    maxTotalTokens: 200_000,
    warningThreshold: 0.8
  }

  it('reserves duration, provider calls, and tool calls for courseware generation and finalization', () => {
    expect(lessonGenerationRunBudget(configured)).toEqual({
      ...configured,
      maxDurationMs: 20 * 60_000,
      maxProviderCalls: 64,
      maxToolCalls: 128
    })
  })

  it('does not reduce deliberately larger safety ceilings', () => {
    expect(lessonGenerationRunBudget({
      ...configured,
      maxDurationMs: 30 * 60_000,
      maxProviderCalls: 80,
      maxToolCalls: 160
    })).toMatchObject({
      maxDurationMs: 30 * 60_000,
      maxProviderCalls: 80,
      maxToolCalls: 160
    })
  })
})


describe('lessonGenerationSuccessFallback', () => {
  it('preserves a durable generated lesson when finalization is unusable', () => {
    expect(lessonGenerationSuccessFallback([{
      id: '0001',
      title: 'Claude Code 记忆系统架构总览',
      relativePath: 'lessons/0001-claude-code.html'
    }])).toBe(
      '课程已成功生成并保存：《Claude Code 记忆系统架构总览》（lessons/0001-claude-code.html）。最终答复阶段模型未返回可用文本，系统已保留生成结果。'
    )
  })

  it('does not claim success before any lesson was generated', () => {
    expect(lessonGenerationSuccessFallback([])).toBeNull()
  })
})

describe('lessonGenerationBudgetFallback', () => {
  it('preserves a durable generated lesson as a successful degraded answer', () => {
    expect(lessonGenerationBudgetFallback([{
      id: '0001',
      title: 'Claude Code 记忆系统架构总览',
      relativePath: 'lessons/0001-claude-code.html'
    }], 'provider_calls')).toBe(
      '课程已成功生成并保存：《Claude Code 记忆系统架构总览》（lessons/0001-claude-code.html）。后续整理因本轮模型调用预算到达上限而停止，但不影响已生成课件。'
    )
  })

  it('does not mask budget exhaustion before any lesson was generated', () => {
    expect(lessonGenerationBudgetFallback([], 'provider_calls')).toBeNull()
  })
})
