import type { TeachingMemoryRecord, TeachingSettingsV1 } from '../../shared/teaching-types'

/**
 * System prompt — instructs the model to return ONLY a JSON object matching
 * the LessonPlan schema. The model is forbidden from emitting HTML; markdown
 * is allowed only inside section bodies. Zod validates downstream, and any
 * failure falls back to the local template generator.
 */
export function buildLessonSystemPrompt(opts: {
  missionTitle: string
  missionExcerpt: string
  durationMinutes: number
  includeRetrievalPractice: boolean
  generateReference: boolean
  generateLearningRecord: boolean
  memories: TeachingMemoryRecord[]
  generator: TeachingSettingsV1['generator']
}): string {
  const includeQuiz = opts.includeRetrievalPractice
  const includeReference = opts.generateReference
  const includeRecord = opts.generateLearningRecord
  return `你是一个本地教学系统的课程设计助手。根据用户的学习目标和当前 Mission，设计一节短小、可复习、可保存的静态 HTML 课程内容。

# 严格输出契约
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏、不要 HTML。
- JSON 必须符合下面的 TypeScript 结构：

{
  "title": string,                      // 课程标题，≤24字
  "objective": string,                  // 一句话学习目标，≤60字
  "durationMinutes": number,            // 建议学习时长（分钟），与请求一致
  "sections": [                          // 1~6 节正文
    { "heading": string,                // 小节标题 ≤20字
      "body": string }                  // 小节正文，使用 markdown：支持 #/##/###、段落、- 列表、1. 有序列表、\`行内代码\`、\`\`\`代码块\`\`\`、> 引用、**粗体**。禁止任何 HTML 标签。
    ],
  "keyPoints": string[],                // 3~6 个要点，每个 ≤30字
  "quiz": [                              // ${includeQuiz ? '2~4 道检索练习题' : '留空数组'},
    {
      "type": "single" | "multi" | "truefalse" | "fill",
      "question": string,
      "choices": string[],              // single/multi 必填，2~4 个选项；truefalse/fill 留空数组
      "answer": number | string,        // single: 选项索引(0-based number)；multi: "0,2" 形式字符串；truefalse: 1 表示对、0 表示错；fill: 标准答案文本
      "explanation": string             // 简短解析 ≤80字
    }
  ],
  "flashcards": [                        // 2~6 张间隔复习卡
    { "front": string, "back": string }
  ]${includeReference ? `,
  "referenceNotes": string              // 速查材料，markdown，≤300字` : ''}${includeRecord ? `,
  "learningRecordNote": string          // 学习记录摘要，≤200字` : ''}
}

# 当前 Mission
- 标题：${opts.missionTitle}
- 说明：${opts.missionExcerpt}

${opts.memories.length > 0 ? `# 可用长期记忆
${opts.memories.map((memory, index) => `- [${index + 1}] (${memory.scope}) ${memory.content}`).join('\n')}

` : ''}# 要求
- 全部用中文，内容贴合 Mission 和用户输入。
- 课程内容必须紧扣用户请求中的学习主题本身；禁止把课程写成关于学习方法、工作区文件组织或本教学系统的元课程，除非用户明确要求学习这些。
- 时长目标：${opts.durationMinutes} 分钟，只教一个足够小的可观察动作。
- 如果长期记忆与本次课程相关，优先保持术语、偏好和上下文连续。
- sections 的 body 用 markdown，不要输出 HTML。
- 题目答案必须与 choices 对应，索引从 0 开始。
- 不要输出 JSON 以外的任何字符。`
}

export function buildLessonUserPrompt(opts: {
  prompt: string
  sequence: number
  missionTitle: string
  memories: TeachingMemoryRecord[]
}): string {
  return `当前是第 ${opts.sequence} 节课程。Mission：${opts.missionTitle}。

用户的学习请求：
${opts.prompt}

${opts.memories.length > 0 ? `相关长期记忆：
${opts.memories.map((memory, index) => `${index + 1}. ${memory.content}`).join('\n')}

` : ''}请按系统约定的 JSON 结构输出本节课程。`
}

/**
 * Repair prompt — used once when the model's first output fails schema
 * validation. Feeding the raw output plus the validation error back lets the
 * model fix its own JSON instead of the pipeline silently discarding the
 * lesson (the old behavior wrote an off-topic fallback lesson to disk).
 */
export function buildLessonRepairPrompt(opts: {
  rawOutput: string
  validationError: string
}): string {
  const clipped = opts.rawOutput.length > 24_000
    ? `${opts.rawOutput.slice(0, 24_000)}\n…[已截断]`
    : opts.rawOutput
  return `你上一次的输出未通过课程计划 JSON 校验。

校验错误：
${opts.validationError}

你上一次的输出：
${clipped}

请修复以上问题，重新输出完整的课程计划。只输出一个符合系统约定结构的 JSON 对象，不要解释、不要 markdown 围栏、不要输出 JSON 以外的任何字符。`
}
