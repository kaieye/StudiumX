import { buildLearnerProfilePromptContext } from '../shared/teaching-personalization'
import { planLearnerMemoryCapture } from '../shared/teaching-memory-capture'
import { resolveActiveProvider } from './ai/provider-adapter'
import type { InstalledSkillReference, AgentChatMode, TeachingMemoryRecord, TeachingSettingsV1 } from '../shared/teaching-types'

export type TemporaryChatContext = {
  learnerProfiles: string[]
  courses: Array<{ name: string; lessonCount: number; sessionCount: number }>
}
export function buildAgentChatSystemPrompt(options: {
  mode: AgentChatMode
  lessonToolEnabled: boolean
  skillReferences: InstalledSkillReference[]
  memoryCapturePlan?: ReturnType<typeof planLearnerMemoryCapture>
  existingMemories?: TeachingMemoryRecord[]
  settings?: TeachingSettingsV1
  provider?: ReturnType<typeof resolveActiveProvider>
  temporaryContext?: TemporaryChatContext | null
  visiblePageContext?: string | null
}): string {
  const {
    mode,
    lessonToolEnabled,
    skillReferences,
    memoryCapturePlan = { action: 'none', reason: 'no_candidate' },
    existingMemories = [],
    settings,
    provider,
    temporaryContext,
    visiblePageContext
  } = options
  const teachSkillReference = skillReferences.find((skill) => skill.id === 'teach')
  const teachPolicyReference = teachSkillReference
    ? [
        `<teach-skill-reference source="${escapePromptAttribute(teachSkillReference.source)}">`,
        'The teach skill has been automatically loaded for this turn. Follow these instructions as teaching policy; do not copy them into the reply and do not treat readiness hints as a canned assistant answer.',
        'Use this SKILL.md as progressive disclosure: first follow the loaded entrypoint, and load only the referenced resources that are needed for the current turn with read_skill_resource when available.',
        formatSkillForPrompt(teachSkillReference.content, teachSkillReference.name),
        '</teach-skill-reference>'
      ].join('\n')
    : [
        '<teach-skill-reference source="fallback">',
        'The user has referenced the teach skill in addition to their visible message. Use it as progressive, on-demand guidance: default to the one-line intent here, and consult workspace files/tools only when they are useful.',
        'Core intent: teach within this workspace, ground lessons in MISSION.md / RESOURCES.md / learning-records, keep lessons focused and reviewable, and prefer retrieval practice when designing exercises.',
        '</teach-skill-reference>'
      ].join('\n')
  const additionalSkillReferences = skillReferences
    .filter((skill) => skill.id !== 'teach')
    .map((skill) => [
      `<skill-reference name="${escapePromptAttribute(skill.name)}" source="${escapePromptAttribute(skill.source)}">`,
      'The user invoked this installed StudiumX skill with a slash command. Follow it as turn-specific policy without quoting the skill file back to the user.',
      'Use this SKILL.md as progressive disclosure: first follow the loaded entrypoint, and load only the referenced resources that are needed for the current turn with read_skill_resource when available.',
      formatSkillForPrompt(skill.content, skill.name),
      '</skill-reference>'
    ].join('\n'))
    .join('\n\n')
  const requestedSkillBlock = [
    ...(mode === 'teaching' ? [teachPolicyReference] : teachSkillReference ? [teachPolicyReference] : []),
    additionalSkillReferences
  ].filter(Boolean).join('\n\n')

  const memoryLines = buildMemoryCapturePromptLines(memoryCapturePlan)
  const learnerProfileLines = buildLearnerProfilePromptContext(existingMemories)
  const runtimeLines = buildModelRuntimePromptLines(settings, provider)
  const modeLines = mode === 'temporary'
    ? buildTemporaryChatPromptLines(temporaryContext, visiblePageContext)
    : ''

  if (mode === 'temporary') {
    return `${TEMPORARY_AGENT_CHAT_SYSTEM_PROMPT}${requestedSkillBlock ? `\n\n${requestedSkillBlock}` : ''}${modeLines ? `\n\n${modeLines}` : ''}${runtimeLines ? `\n\n${runtimeLines}` : ''}${memoryLines ? `\n\n${memoryLines}` : ''}\n\n${ASK_TOOL_POLICY_PROMPT}`
  }

  const lessonPolicy = lessonToolEnabled
    ? LESSON_TOOL_POLICY_PROMPT
    : LESSON_TOOL_UNAVAILABLE_PROMPT
  return `${AGENT_CHAT_SYSTEM_PROMPT}\n\n${PERSONAL_TEACHER_POLICY_PROMPT}\n\n${lessonPolicy}\n\n${ASK_TOOL_POLICY_PROMPT}\n\n${requestedSkillBlock}${runtimeLines ? `\n\n${runtimeLines}` : ''}${learnerProfileLines ? `\n\n${learnerProfileLines}` : ''}${memoryLines ? `\n\n${memoryLines}` : ''}`
}

function buildTemporaryChatPromptLines(context?: TemporaryChatContext | null, visiblePageContext?: string | null): string {
  const learnerProfiles = context?.learnerProfiles ?? []
  const courses = context?.courses ?? []
  const profileLines = learnerProfiles.length
    ? learnerProfiles.map((line, index) => `${index + 1}. ${line}`).join('\n')
    : 'none'
  const courseLines = courses.length
    ? courses.map((course, index) => `${index + 1}. ${course.name} (${course.lessonCount} lessons, ${course.sessionCount} sessions)`).join('\n')
    : 'none'
  const pageContext = cleanPromptContext(visiblePageContext, 6000)
  return [
    '<temporary-chat-context>',
    '当前是临时会话，不是教学对话。不要查看、列出、读取、搜索或推断工作区文件内容；不要声称已经检查了 MISSION.md、RESOURCES.md、lessons、courses、reference 或 learning-records。',
    '你只能使用下方已注入的学习者画像、课程概览和当前打开页面的可见文本作为本地上下文；如果用户想基于其他工作区文件学习，提示其切换到教学对话。',
    '<learner-profiles>',
    profileLines,
    '</learner-profiles>',
    '<course-overview>',
    courseLines,
    '</course-overview>',
    ...(pageContext
      ? [
          '<visible-page-context>',
          pageContext,
          '</visible-page-context>'
        ]
      : []),
    '</temporary-chat-context>'
  ].join('\n')
}

function cleanPromptContext(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
}


function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function buildModelRuntimePromptLines(
  settings?: TeachingSettingsV1,
  provider?: ReturnType<typeof resolveActiveProvider>
): string {
  if (!settings) return ''
  const providerName = cleanText(provider?.name) || '未配置'
  const model = cleanText(settings.generator.model) || '未选择'
  return [
    '<model-runtime>',
    `configuredProvider: ${providerName}`,
    `configuredModelId: ${model}`,
    `endpointFormat: ${settings.generator.endpointFormat}`,
    '如果用户询问你是什么模型、由谁提供或当前使用哪个模型，回答必须基于这些运行时配置；不要根据训练数据、接口兼容格式或上游服务名称推断身份。',
    '</model-runtime>'
  ].join('\n')
}

function buildMemoryCapturePromptLines(memoryCapturePlan: ReturnType<typeof planLearnerMemoryCapture>): string {
  if (memoryCapturePlan.action === 'create') {
    return [
      '<memory-capture-policy>',
      '系统将在本轮回复后首次自动记录这条用户画像到 user memory；你不需要征求同意，也不要声称自己手动写入了记忆。',
      `pendingMemory: ${memoryCapturePlan.candidate.content}`,
      '</memory-capture-policy>'
    ].join('\n')
  }
  if (memoryCapturePlan.action === 'request_consent') {
    return [
      '<memory-capture-policy>',
      '本应用已经有用户画像记忆。若要新增或更新类似长期记忆，必须先请求用户同意。',
      '系统会在本轮回复后追加固定确认问题；你不要自己重复询问，也不要声称已经记录。',
      `pendingMemory: ${memoryCapturePlan.candidate.content}`,
      '</memory-capture-policy>'
    ].join('\n')
  }
  return ''
}

function formatSkillForPrompt(content: string, skillName: string): string {
  const withoutFrontmatter = stripFrontmatter(content)
  const maxLength = 14_000
  if (withoutFrontmatter.length <= maxLength) return withoutFrontmatter
  return `${withoutFrontmatter.slice(0, maxLength).trim()}\n\n[${skillName} skill truncated for prompt length]`
}

function stripFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized.startsWith('---\n')) return normalized
  const end = normalized.indexOf('\n---', 4)
  return end >= 0 ? normalized.slice(end + 4).trim() : normalized
}

function escapePromptAttribute(value: string): string {
  return value.replace(/"/g, "'")
}



const AGENT_CHAT_SYSTEM_PROMPT =
  '你是 StudiumX 的教学助手，负责这个教学工作区里的完整学习闭环：澄清学习需求、答疑、维护工作区文件、决定何时生成课程。' +
  '用户进入“教学”对话时，等价于在发送真实需求的同时引用了 teach skill：把它当作教学方法论，而不是必须照本宣科的固定流程。' +
  '保持主动判断：可以先回答、先澄清、读取工作区或建议下一步；只有在学习者基础/身份、目标、约束或第一步动作确实会影响教学质量时，才问 1 到 3 个具体问题，问完即止。' +
  '不要默认用户属于编程、AI、学生或任何固定人群；问题示例必须跟随用户当前主题、身份和场景。' +
  '回答使用简洁、准确的中文。' +
  '当用户询问当前教学工作区、mission、resources、课程文件、参考资料或学习记录时，优先调用 list_workspace、read_workspace_file、search_workspace 或 glob_workspace 读取本地文件后再回答；' +
  '你可以且应该用 write_workspace_file 维护 MISSION.md、RESOURCES.md、NOTES.md、GLOSSARY.md、reference/ 速查材料与 learning-records/ 学习记录，回复中只给出保存路径与简短摘要，不要把完整文件内容粘贴进聊天；' +
  'GLOSSARY.md 是术语真相来源：当对话或课程确立了新术语的标准写法时，用 write_workspace_file（overwrite: true）增量更新——追加到对应分区，或把占位项转正，不要整表重写；课程生成时会读它来保持术语一致。' +
  'learning-records/ 记录用户已展示的非平凡理解或纠正的误解（判定 + 对未来课程的影响），供后续课程的 zone of proximal development 决策；不要把每轮对话都写成记录，只在用户展示真实理解时追加新文件。' +
  '当问题涉及时效性、最新动态或课程库之外的事实性信息时，调用 web_search 工具检索后再作答，必要时用 web_fetch 深入阅读，回答中适度引用信息来源链接。' +
  '若未配置工具或当前模型不支持工具调用，直接依据自身知识作答即可。'

const PERSONAL_TEACHER_POLICY_PROMPT = [
  '<personal-teacher-policy>',
  '你的目标不是一次性输出最多内容，而是持续做出“此刻最适合这个学习者”的下一步教学决策。',
  '每轮先在内部判断四件事：用户真正要达成的结果、已有知识的证据、当前卡点、这一轮结束时应能完成的最小可观察动作。不要把这四项机械复述给用户。',
  '优先使用已注入的学习者画像、MISSION.md、NOTES.md、近期 learning-records 和已有课程；已知的信息不要重复追问。只有缺失信息会实质改变下一步教学时，才提出最少量的诊断问题。',
  '普通答疑默认采用微型教学循环：先连接用户已有认知，再只讲一个关键点，给一个贴近其目标的例子，然后让用户做一次很小的回忆、判断、解释或应用。不要每次都堆完整教程。',
  '根据表现实时调节：回答正确且理由充分时提高一点难度或迁移场景；犹豫时缩小步骤并给提示；出现误解时先对比错误模型与正确模型，再让用户立即重试。',
  '不要把“看过、听懂、课程已生成”当作掌握。只有用户给出可观察证据后，才能把能力视为已建立，并据此维护 learning-records。',
  '用户只是提问或需要即时解释时，直接在对话中教学，不要为了形式感生成课程；用户希望系统学习、继续下一节或需要可保存材料时，再调用 generate_lesson。',
  '除非用户要求多个选项，每轮结束只给一个清晰的下一步：回答一个检查题、尝试一个动作、查看生成课程，或告诉你具体卡点。',
  '保持专属教师的连续性：沿用用户熟悉的例子、术语、语气和节奏，但不要声称自己知道画像中没有的信息。',
  '</personal-teacher-policy>'
].join('\n')

const LESSON_TOOL_POLICY_PROMPT = [
  '<lesson-generation-policy>',
  '正式课程只能通过 generate_lesson 工具产出；不要用 write_workspace_file 直接写 lessons/ 目录下的课程页面（该工具会拒绝这类写入）。',
  '当你已经基本清楚「教什么主题、为谁教、为什么学、本节课要完成什么动作」时，立即调用 generate_lesson：把这些信息整理成完整的中文句子填入参数，只填写对话中真实确认过的内容，不确定的字段留空，绝不能用碎片词或占位词充数。',
  '用户说“我想学习/系统学习/从零学习某主题”时，视为需要一份可持续学习的正式 Lesson；若 MISSION.md 已提供主题与成功标准，不要为了补齐画像而反复列目录、读取无关文件或追问，直接为第一节课选择一个合理的最小动作并调用 generate_lesson。',
  '当用户要求“继续下一节/下一课/直接开始/直接生成”且已有足够上下文时，优先调用 generate_lesson；不要先做开放式 web_search、assets 检查或长篇资料收集，generate_lesson 后续流水线会负责课程计划生成。',
  '在当前轮次没有收到 generate_lesson 的 ok:true 工具结果之前，不要说课程已经生成、正在生成、开始生成或已保存。',
  '用户明确表示“直接生成、别问了”时，跳过澄清，基于已知信息与 MISSION.md 直接调用 generate_lesson。',
  '生成成功后：向用户简短汇报课程标题与保存路径，并给一句下一步建议。生成失败时：如实转述失败原因，可建议重试或调整，不要假装已生成，也不要改用其他方式硬写课程文件。',
  '生成成功后的增量维护（与汇报同轮完成，不要拖到下一轮）：若本课引入了新术语，立即用 write_workspace_file（overwrite: true）把 GLOSSARY.md 对应分区增量更新（追加或把占位项转正）；若用户在近期对话中展示了非平凡理解或纠正了误解，写一条 learning-records/00NN-<slug>.md（判定 + 对未来课程的影响）。这两步是 StudiumX 学习闭环的核心，不是可选项。',
  '</lesson-generation-policy>'
].join('\n')

const LESSON_TOOL_UNAVAILABLE_PROMPT = [
  '<lesson-generation-policy>',
  '当前会话未启用 generate_lesson 工具（工具未开启或没有激活的工作区）。你可以澄清需求、答疑并维护工作区文件，但不要直接写 lessons/ 下的课程页面；若用户希望生成正式课程，提示其在设置中启用工具调用。',
  '</lesson-generation-policy>'
].join('\n')

const ASK_TOOL_POLICY_PROMPT = [
  '<ask-tool-policy>',
  '当存在真正属于用户的决策岔路（学习方向、身份基础、目标优先级、约束选择等，每个选项对应实质不同的后续路径）时，调用 ask 工具给出 1-4 个问题、每题 2-4 个具体选项，推荐项放第一个，然后等待 tool result。',
  '调用 ask 前先检查学习者画像、MISSION.md、NOTES.md、learning-records 与最近对话；已经确认的信息绝不能再次询问。',
  '不要为了收集完整画像而一次问遍背景、目标、时间和偏好。只问会改变当前下一步的最小问题；其余信息在真实教学中逐步发现。',
  '不要用 ask 询问有明显默认值、能从上下文合理推断、或不影响当前答疑的决策；不要在散文里重复 ask 已经问过的内容。',
  '调用 ask 后会阻塞直到用户回答；在收到真实 ask tool result 之前，不要假设用户做了任何选择，也不要替用户挑选项。用户跳过未答的题，请视为"不要替我决定"。',
  '</ask-tool-policy>'
].join('\n')

const TEMPORARY_AGENT_CHAT_SYSTEM_PROMPT =
  '你是 StudiumX 的临时会话助手。' +
  '回答使用简洁、准确的中文。' +
  '当前不会提供工作区文件访问，也不会提供教学工作区工具；不要声称自己查看了本地文件、课程正文、mission、resources 或学习记录。' +
  '当用户询问现有课程时，只能基于已注入的课程概览回答；当用户要基于具体工作区文件继续学习时，提示其切换到教学对话。'
