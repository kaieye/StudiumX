import { describe, expect, it, vi } from 'vitest'
import { createLessonToolLifecycle } from '../../src/main/teaching-conversation-lesson-tool'
import type { ToolEntry } from '../../src/main/ai/tools/registry'
import type { LessonSummary } from '../../src/shared/teaching-types'

const lesson: LessonSummary = {
  id: 'lesson-1',
  title: 'LangChain Agent 核心机制：ReAct 循环原理',
  objective: '讲清 ReAct 循环',
  prompt: 'fixture',
  createdAt: '2026-07-16T00:00:00.000Z',
  durationMinutes: 15,
  courseId: 'course-1',
  courseName: 'Agent Skills',
  courseRelativePath: 'courses/agent-skills',
  courseAbsolutePath: 'C:/workspace/courses/agent-skills',
  sessionId: 'session-1',
  sessionName: 'ReAct',
  sessionRelativePath: 'courses/agent-skills/sessions/react',
  sessionAbsolutePath: 'C:/workspace/courses/agent-skills/sessions/react',
  relativePath: 'lessons/react.html',
  absolutePath: 'C:/workspace/lessons/react.html'
}

describe('generate_lesson provider argument compatibility', () => {
  it('accepts the snake_case aliases emitted by the real provider run', async () => {
    const generateLessonFromBrief = vi.fn(async () => lesson)
    const lifecycle = createLessonToolLifecycle({ enabled: true, generateLessonFromBrief })
    let entry: ToolEntry | undefined
    lifecycle.registerInto({ register: (candidate) => { entry = candidate } })

    await entry!.handler({
      topic: 'LangChain Agent 核心机制：ReAct 循环原理',
      learner: '为 LangChain Agent 面试做准备的开发者，已经了解 Tool Calling 的基本流程。',
      goal: '用面试可用的语言讲清楚 ReAct 循环的完整流程。',
      first_action: '用一张流程图解释推理、工具调用、观察结果和继续推理的完整闭环。'
    }, {} as never)

    expect(generateLessonFromBrief).toHaveBeenCalledWith({
      topic: 'LangChain Agent 核心机制：ReAct 循环原理',
      learnerProfile: '为 LangChain Agent 面试做准备的开发者，已经了解 Tool Calling 的基本流程。',
      goal: '用面试可用的语言讲清楚 ReAct 循环的完整流程。',
      firstLessonFocus: '用一张流程图解释推理、工具调用、观察结果和继续推理的完整闭环。'
    })
    expect(lifecycle.hasAttemptedGeneration()).toBe(true)
  })
})
