import { describe, expect, it } from 'vitest'
import { lessonGenerationSuccessFallback } from '../../src/main/teaching-conversation-lesson-tool'

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
