import type { AgentChatMessage } from './teaching-types'

/**
 * A structured description of the next lesson, authored by the teaching
 * conversation agent once it judges the learner's context is clear enough.
 * This replaces the old regex "signal extraction" (which mined fragments like
 * 背景:"工作" out of the assistant's own replies) — the judgment of readiness
 * now lives with the model, and this type is the contract it fills in.
 */
export type LessonBrief = {
  /** 学习主题，例如「RAG 检索增强生成」。必填。 */
  topic: string
  /** 这节课要完成的最小可观察动作，例如「用一张流程图讲清 RAG 五个步骤」。必填。 */
  firstLessonFocus: string
  /** 学习者背景/基础/身份，完整句子。 */
  learnerProfile?: string
  /** 学习动机与目标，例如「准备面试，概念为主不写代码」。 */
  goal?: string
  /** 时间、设备、范围等约束。 */
  constraints?: string
  /** 其他对课程设计有用的说明（语气、深度、引用偏好等）。 */
  extraNotes?: string
}

// Brief fields can carry real clarification nuance (running examples, prior
// context, tone preferences). 1500 chars leaves room for that without letting
// a single tool-call argument balloon the lesson prompt.
const BRIEF_TEXT_LIMIT = 1500

/**
 * Coerce untrusted tool-call arguments into a LessonBrief. Returns null when
 * the required fields are missing or trivially short — the caller should then
 * reject the tool call so the model retries with a proper brief instead of
 * generating a lesson from fragments.
 */
export function normalizeLessonBrief(raw: unknown): LessonBrief | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const topic = cleanBriefText(record.topic)
  const firstLessonFocus = cleanBriefText(record.firstLessonFocus)
  if (topic.length < 2 || firstLessonFocus.length < 4) return null
  const brief: LessonBrief = { topic, firstLessonFocus }
  const learnerProfile = cleanBriefText(record.learnerProfile)
  const goal = cleanBriefText(record.goal)
  const constraints = cleanBriefText(record.constraints)
  const extraNotes = cleanBriefText(record.extraNotes)
  if (learnerProfile) brief.learnerProfile = learnerProfile
  if (goal) brief.goal = goal
  if (constraints) brief.constraints = constraints
  if (extraNotes) brief.extraNotes = extraNotes
  return brief
}

/** Render a LessonBrief into the prompt handed to the lesson generator. */
export function buildLessonPromptFromBrief(brief: LessonBrief): string {
  const lines = [
    `- 主题：${brief.topic}`,
    brief.learnerProfile ? `- 学习者背景：${brief.learnerProfile}` : '',
    brief.goal ? `- 学习目标：${brief.goal}` : '',
    brief.constraints ? `- 约束：${brief.constraints}` : '',
    `- 本节课要完成的动作：${brief.firstLessonFocus}`,
    brief.extraNotes ? `- 额外说明：${brief.extraNotes}` : ''
  ].filter(Boolean)
  return `基于教学对话中已澄清的学习任务生成一节短小 lesson。\n${lines.join('\n')}`
}

/**
 * Fold recent conversation turns into a direct-generation prompt so the
 * pipeline sees honest context (verbatim user words) instead of extracted
 * "signals". Used by the non-conversational generation entry only.
 */
export function buildLessonPromptWithConversation(
  prompt: string,
  messages: Array<Pick<AgentChatMessage, 'role' | 'content'>> | undefined
): string {
  const userLines = (messages ?? [])
    .filter((message) => message.role === 'user')
    .map((message) => cleanBriefText(message.content))
    .filter(Boolean)
    .slice(-6)
  if (userLines.length === 0) return prompt
  return `${prompt}\n\n对话中用户的原话（供参考）：\n${userLines.map((line) => `- ${line}`).join('\n')}`
}

function cleanBriefText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, BRIEF_TEXT_LIMIT)
}
