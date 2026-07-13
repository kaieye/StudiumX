import { normalizeLessonBrief, type LessonBrief } from '../shared/teaching-workflow'
import type { LessonSummary } from '../shared/teaching-types'
import type { ToolDefinition } from './ai/provider-adapter'
import type { ToolEntry } from './ai/tools/registry'

export const MIN_DURABLE_LESSON_ITERATIONS = 4

export type LessonToolLifecycle = {
  readonly enabled: boolean
  registerInto: (registry: { register: (entry: ToolEntry) => void }) => void
  isGenerationRequested: (userInput: string) => boolean
  hasAttemptedGeneration: () => boolean
  generatedLessons: () => LessonSummary[]
  missingGenerationMessage: () => string
}

/**
 * Owns one turn's generate_lesson lifecycle: availability, validation, a
 * single failed attempt, and the renderer-facing successful lessons. The
 * conversation orchestrator only needs this small interface.
 */
export function createLessonToolLifecycle(options: {
  enabled: boolean
  generateLessonFromBrief?: (brief: LessonBrief) => Promise<LessonSummary>
}): LessonToolLifecycle {
  const generatedLessons: LessonSummary[] = []
  let failure: string | null = null
  let attempted = false
  const generateLessonFromBrief = options.generateLessonFromBrief
  const enabled = options.enabled && typeof generateLessonFromBrief === 'function'

  return {
    enabled,
    registerInto(registry) {
      if (!enabled || !generateLessonFromBrief) return
      registry.register({
        definition: GENERATE_LESSON_TOOL_DEFINITION,
        permission: {
          kind: 'workspace_write',
          describe: () => ({
            operation: '生成课程资产',
            targetPath: 'lessons/',
            reason: '模型请求生成并登记正式课程、参考材料或学习记录。',
            creates: true
          })
        },
        handler: async (args) => {
          const brief = normalizeLessonBrief(args)
          if (!brief) {
            throw new Error(
              'generate_lesson 参数不完整：topic 与 firstLessonFocus 必须是有实际内容的完整句子。请根据对话内容补全后重新调用。'
            )
          }
          if (failure) {
            throw new Error(
              `本轮对话已经尝试 generate_lesson 且失败：${failure}。不要继续重复调用 generate_lesson；请直接向用户说明失败原因、已确认的课程方向，以及下一步可重试的具体操作。`
            )
          }

          attempted = true
          try {
            const lesson = await generateLessonFromBrief(brief)
            generatedLessons.push(lesson)
            return JSON.stringify({
              ok: true,
              lessonId: lesson.id,
              title: lesson.title,
              path: lesson.relativePath,
              message: `课程已生成并登记：${lesson.title}（${lesson.relativePath}）`
            })
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error)
            throw new Error(
              `${failure}。本轮不要再次调用 generate_lesson；请向用户说明课程尚未生成，并保留已确认的主题、焦点和后续重试入口。`
            )
          }
        }
      })
    },
    isGenerationRequested: (userInput) => enabled && isLessonGenerationRequest(userInput),
    hasAttemptedGeneration: () => attempted,
    generatedLessons: () => [...generatedLessons],
    missingGenerationMessage: () => '课程尚未生成：本轮没有成功执行 generate_lesson。请重试；StudiumX 不会把“准备生成”当作已完成。'
  }
}

function isLessonGenerationRequest(input: string): boolean {
  const text = cleanText(input).toLowerCase()
  if (!text) return false
  if ([
    /(?:不要|不用|别|无需).*(?:生成|创建|产出|保存).*(?:课程|课件|lesson|session)/,
    /(?:不要|不用|别|无需).*(?:课程|课件|lesson|session)/
  ].some((pattern) => pattern.test(text))) return false
  return [
    /(?:生成|创建|产出|保存).*(?:课程|课|lesson|session)/,
    /(?:课程|课|lesson|session).*(?:生成|创建|产出|保存)/,
    /(?:继续|开始|进入|上|讲|学|直接).*(?:下一节|下一课|下节课|第二节|第二课|第[一二三四五六七八九十0-9]+节|第[一二三四五六七八九十0-9]+课)/,
    /(?:下一节|下一课|下节课|第二节|第二课)/,
    /(?:next|continue|start).*(?:lesson|session|course)/,
    /^(?:我)?(?:想|希望|准备|要)?(?:系统(?:地|性地)?|深入|认真|从零)?(?:学习|学会|掌握)\s*\S+/,
    /^(?:i\s+)?(?:want|hope|plan|need)\s+to\s+(?:systematically\s+)?(?:learn|master)\s+\S+/
  ].some((pattern) => pattern.test(text))
}


function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

const GENERATE_LESSON_TOOL_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_lesson',
    description:
      '生成一节正式课程并保存到当前教学工作区（统一编号、渲染课程模板、写入课程索引与复习卡）。当学习主题、学习者背景、目标和本节课要完成的动作已经基本清楚时调用。参数请用完整中文句子，只填对话中真实确认过的信息。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '学习主题，例如「RAG 检索增强生成」' },
        firstLessonFocus: { type: 'string', description: '本节课要完成的最小可观察动作，完整句子，例如「用一张流程图讲清 RAG 的五个核心步骤，并给出可直接使用的面试话术」' },
        learnerProfile: { type: 'string', description: '学习者背景/基础/身份，完整句子；对话中未确认可留空' },
        goal: { type: 'string', description: '学习动机与目标，例如「准备面试，概念为主不写代码」；未确认可留空' },
        constraints: { type: 'string', description: '时间、设备、范围等约束，例如「每节课 15-20 分钟，不涉及编码实现」；未确认可留空' },
        extraNotes: { type: 'string', description: '其他对课程设计有用的说明（语气、深度、引用偏好等）；可留空' }
      },
      required: ['topic', 'firstLessonFocus']
    }
  }
}
