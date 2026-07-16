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
})
