import type { TeachingMemoryRecord, TeachingSettingsV1 } from '../../shared/teaching-types'
import {
  DEFAULT_LESSON_PREVIEW_CAPABILITIES,
  type LessonPreviewCapabilities
} from '../../shared/lesson-preview-capabilities'
import { sanitizeMemoryInjectionText } from '../../shared/memory-sanitize'

/**
 * A workspace file (NOTES.md / GLOSSARY.md / RESOURCES.md) excerpt injected
 * into the lesson system prompt so the second brain sees what the first brain
 * has already established — terminology, learner preferences, trusted sources.
 */
export type LessonWorkspaceContext = {
  notes: string
  glossary: string
  resources: string
}

/**
 * A prior lesson surfaced in the prompt so the generator can link to it,
 * carry its running example forward, and avoid re-teaching established definitions.
 */
export type LessonPriorLesson = {
  id: string
  title: string
  objective: string
  relativePath: string
}

/**
 * System prompt — instructs the model to return ONLY a JSON object matching
 * the LessonPlan schema. The model is forbidden from emitting HTML; markdown
 * is allowed only inside section bodies / interviewAnswer / callout.body.
 * Zod validates downstream, and any failure falls back to the local template
 * generator.
 */
export function buildLessonSystemPrompt(opts: {
  missionTitle: string
  missionExcerpt: string
  durationMinutes: number
  includeRetrievalPractice: boolean
  generateReference: boolean
  memories: TeachingMemoryRecord[]
  generator: TeachingSettingsV1['generator']
  priorLessons?: LessonPriorLesson[]
  conversationExcerpt?: string
  workspaceContext?: LessonWorkspaceContext
  previewCapabilities?: LessonPreviewCapabilities
}): string {
  const includeQuiz = opts.includeRetrievalPractice
  const includeReference = opts.generateReference
  const previewCapabilities = opts.previewCapabilities ?? DEFAULT_LESSON_PREVIEW_CAPABILITIES
  const previewSyntaxContract = renderPreviewSyntaxContract(previewCapabilities)
  const previewCapabilityRules = renderPreviewCapabilityRules(previewCapabilities)
  const priorLessonsBlock = opts.priorLessons && opts.priorLessons.length > 0
    ? `\n# 已完成课程\n${opts.priorLessons
        .map((lesson) => `- Lesson ${lesson.id}：${lesson.title} — ${lesson.objective}（文件：${lesson.relativePath}）`)
        .join('\n')}\n\n- 若存在上一课，本课应**承接**其例子或概念，不要重复已建立的定义；可在正文用相对链接引用，例如 \`[上一课](0001-xxx.html)\`。\n- 跨课导航由模板自动生成，你无需在正文里写"上一课/下一课"按钮。`
    : ''
  const conversationBlock = opts.conversationExcerpt && opts.conversationExcerpt.trim()
    ? `\n# 对话澄清摘要\n以下是用户在教学对话中的原话，本课内容应贴合这些真实表述与已确认的背景，不要凭空假设学习者身份或目标：\n${opts.conversationExcerpt.trim()}`
    : ''
  const ctx = opts.workspaceContext
  const ctxBlock = ctx && (ctx.notes || ctx.glossary || ctx.resources)
    ? `\n# 工作区状态\n${[
        ctx.notes ? `- NOTES.md（用户偏好/工作备忘）：\n${truncate(ctx.notes, 800)}` : '',
        ctx.glossary ? `- GLOSSARY.md（已确立术语表，本课必须沿用其中的写法，不要重新定义已收录术语；正文里不需要再列术语表）：\n${truncate(ctx.glossary, 1000)}` : '',
        ctx.resources ? `- RESOURCES.md（可信来源，引用时优先从这里选，并在推荐阅读/正文标注）：\n${truncate(ctx.resources, 800)}` : ''
      ].filter(Boolean).join('\n')}`
    : ''
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
      "body": string }                  // 小节正文，使用 markdown：支持 #/##/###、段落、- 列表、1. 有序列表、\`行内代码\`、\`\`\`代码块\`\`\`、> 引用、**粗体**、GFM 表格${previewSyntaxContract}。禁止任何 HTML 标签。
    }],
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
  "referenceNotes": string              // 速查材料，markdown，≤300字` : ''},
  "learningRecordNote": string,         // 可选：本课的待验证证据或评分标准，描述学习者需要展示什么；不得声称已经掌握。该字段不会创建或更新 learning record。
  "primarySource": {                    // 可选但强烈建议填写：本课最该读的一个高可信来源
    "title": string,                    // 来源标题
    "url": string,                      // http(s) 链接；无则省略该字段
    "note": string                      // 一句话：为什么读 / 读哪段；可选
  },
  "followupPrompt": string,             // 可选：课尾给学习者的一句追问提醒，替代通用 footer
  "interviewAnswer": string,            // 可选：若主题面向面试，给一段可直接背诵的结构化答案（markdown）
  "callouts": [                          // 可选：在关键决策点/易错点/非平凡洞察处插入的卡片
    { "kind": "criteria" | "pitfall" | "insight", "title": string, "body": string }
  ],
  "flowDiagram": string                 // 可选：多步流程的 ASCII 框图，纯文本（不要 markdown 代码围栏），模板会以 <pre class="flow"> 渲染
}

# 当前 Mission
- 标题：${opts.missionTitle}
- 说明：${opts.missionExcerpt}
${priorLessonsBlock}${conversationBlock}${ctxBlock}

${opts.memories.length > 0 ? `# 可用长期记忆
${opts.memories.map((memory, index) => `- [${index + 1}] (${memory.scope}) ${sanitizeMemoryInjectionText(memory.content)}`).join('\n')}

` : ''}# 要求
- 全部用中文，内容贴合 Mission 和用户输入。
- 课程内容必须紧扣用户请求中的学习主题本身；禁止把课程写成关于学习方法、工作区文件组织或本教学系统的元课程，除非用户明确要求学习这些。
- 时长目标：${opts.durationMinutes} 分钟，只教一个足够小的可观察动作。
- 如果长期记忆与本次课程相关，必须据此调整难度、例子、节奏、表达方式和练习形式，而不只是复述画像；同时保持术语、偏好和上下文连续。
- 默认采用“激活已有知识 → 一个关键解释 → 一个贴近目标的示例 → 学习者亲自尝试 → 检索练习”的短链路；不要把课程写成连续长文。
- 练习要检验本课最可能出现的误解或迁移能力，不要只考原句记忆。若已有课程或学习记录显示某项能力已建立，不要重新从零讲解。
- 不得因为生成、打开或阅读课程就宣称学习者已经掌握；learningRecordNote 只能写待验证证据或评分标准，不能当作 learning record，也不会创建或更新它。
- followupPrompt 应邀请学习者提交答案、解释思路或报告具体卡点，使下一轮对话能据此调节难度；避免“有问题随时问我”之类泛化收尾。
- sections 的 body 用 markdown，不要输出 HTML。
- 当内容涉及比较、分类、步骤矩阵、参数对照或取舍判断时，优先用 markdown 表格表达；表格必须包含表头和分隔行，例如两行：\`| 项 | 说明 |\` 和 \`| --- | --- |\`。
- 只有当系统明确说明预览支持时，才使用数学公式或 Mermaid 图表；否则用普通段落、表格或 flowDiagram。
${previewCapabilityRules}
- 题目答案必须与 choices 对应，索引从 0 开始。
- 推荐阅读 \`primarySource\` 优先填一个权威原始来源（论文/官方文档/权威博客）；无 URL 时只填 title + note。
- 若存在多步流程（如 RAG 的检索→增强→生成），用 \`flowDiagram\` 画 ASCII 框图，比文字列表更直观。
- 不要输出 JSON 以外的任何字符。`
}

function truncate(text: string, limit: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}

function renderPreviewSyntaxContract(capabilities: LessonPreviewCapabilities): string {
  const syntax: string[] = []
  if (capabilities.math) syntax.push('KaTeX 数学公式（$...$ 和 $$...$$）')
  if (capabilities.mermaid) syntax.push('Mermaid 代码围栏（```mermaid）')
  return syntax.length ? `、${syntax.join('、')}` : ''
}

function renderPreviewCapabilityRules(capabilities: LessonPreviewCapabilities): string {
  const rules: string[] = []
  if (capabilities.math) {
    rules.push('- 当前预览支持 KaTeX：短公式用 `$...$`，独立推导用 `$$...$$`；公式必须是 LaTeX，不要用 HTML。')
  }
  if (capabilities.mermaid) {
    rules.push('- 当前预览支持 Mermaid：仅在流程、时序、时间线、概念关系或检索练习路径明显更清楚时，在 sections.body 中使用 ```mermaid 代码围栏；语法错误会退回源码显示。')
  }
  return rules.join('\n')
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
${opts.memories.map((memory, index) => `${index + 1}. ${sanitizeMemoryInjectionText(memory.content)}`).join('\n')}

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

/** Compact third attempt after the full repair request still cannot validate. */
export function buildCompactLessonRegenerationPrompt(opts: {
  userPrompt: string
  validationError: string
}): string {
  return `${opts.userPrompt}

---

前两次课程计划输出仍未通过 JSON 校验。

最近一次校验错误：
${opts.validationError}

请紧凑重试：不要复述分析，不要引用上一次原文，不要使用 markdown 围栏，只输出一个完整且符合系统结构的 JSON 对象。内容可以更短，但必须包含所有必填字段。`
}
