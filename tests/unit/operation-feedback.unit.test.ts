import { describe, expect, it } from 'vitest'
import { operationFeedback } from '../../src/renderer/src/app-shell/operationFeedback'

const translate = (key: string): string => key

describe('operationFeedback', () => {
  it('classifies lesson-generation tool limits as a recoverable conversation error', () => {
    const feedback = operationFeedback({
      outcome: 'failure',
      error: new Error('工具调用上限已用完，generate_lesson 尚未执行，所以课程尚未生成。请重试，或在设置里提高工具调用上限。'),
      translate
    })

    expect(feedback.visibleError).toEqual({
      message: 'errors.agentToolLimit.message',
      severity: 'warning',
      detail: 'errors.agentToolLimit.detail'
    })
  })

  it('hides raw conversation revision conflict details behind safe refresh guidance', () => {
    const feedback = operationFeedback({
      outcome: 'failure',
      error: new Error('Conversation branch revision conflict: expected 7, current 8.'),
      translate
    })

    expect(feedback.visibleError).toEqual({
      message: '对话已在其他位置更新，请刷新后再继续。',
      severity: 'warning',
      detail: '已保留你的输入，应用不会自动重放这次操作。'
    })
    expect(JSON.stringify(feedback.visibleError)).not.toContain('expected 7')
  })

  it('maps quota exceeded to balance/quota UX, not rate_limit', () => {
    const feedback = operationFeedback({
      outcome: 'failure',
      error: new Error('Provider error: quota exceeded'),
      translate
    })
    expect(feedback.visibleError?.message).toBe('errors.providerInsufficientBalance.message')
    expect(feedback.visibleError?.detail).toContain('errors.providerInsufficientBalance.detail')
  })

  it('maps true rate limit to rate_limit UX', () => {
    const feedback = operationFeedback({
      outcome: 'failure',
      error: new Error('Provider 返回 429 Too Many Requests：rate limit exceeded'),
      translate
    })
    expect(feedback.visibleError?.message).toBe('errors.providerRateLimit.message')
  })

  it('separates platform capability degrade from empty-stream UX', () => {
    const platform = operationFeedback({
      outcome: 'failure',
      error: new Error('platform capability unavailable on this host'),
      translate
    })
    expect(platform.visibleError?.message).toBe('errors.platformCapabilityDegraded.message')

    const empty = operationFeedback({
      outcome: 'failure',
      error: new Error('empty stream: no chunks received'),
      translate
    })
    expect(empty.visibleError?.message).toBe('errors.emptyStream.message')
  })

})
