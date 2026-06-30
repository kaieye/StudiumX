import type { AgentChatMessage, TeachingClarificationResult } from './teaching-types'

type SignalKey = TeachingClarificationResult['missingSignals'][number]

type TeachingWorkflowInput = {
  userInput: string
  messages?: Array<Pick<AgentChatMessage, 'role' | 'content'>>
  missionTitle?: string
  missionExcerpt?: string
}

type SignalEvidence = {
  present: boolean
  evidence: string[]
}

type TeachingSignals = Record<SignalKey, SignalEvidence>

const TOPIC_PATTERNS = [
  /(?:学习|了解|掌握|入门|精通|研究|搞懂|学会)\s*([A-Za-z0-9\u4e00-\u9fa5][^，。！？!?；;\n]{0,40})/i,
  /\b(RAG|AI|LLM|Agent|React|Vue|TypeScript|Python|JavaScript)\b/i
]

const BACKGROUND_PATTERNS = [
  /(?:我是|我现在是|目前是|背景|基础|经验|水平|新手|零基础|初学|入门|熟悉|做过|用过|会\s*写|写过|从事|工作|岗位|学生|工程师)/,
  /(?:没有|有)\s*(?:编程|机器学习|深度学习|后端|前端|算法|产品|业务)\s*(?:经验|基础)?/
]

const GOAL_PATTERNS = [
  /(?:为了|想要|希望|目标|用来|拿来|解决|落地|做出|做一个|实现|完成|产出|面试|工作|项目|论文|业务|产品)/,
  /(?:能|会)\s*(?:搭|做|讲|设计|实现|调试|评估|上线)/
]

const CONSTRAINT_PATTERNS = [
  /(?:时间|每天|每周|多久|预算|限制|约束|环境|工具|语言|框架|电脑|系统|数据|公司|不能|只能|需要|希望用|准备用|已有)/,
  /(?:Python|JavaScript|TypeScript|LangChain|LlamaIndex|OpenAI|DeepSeek|本地|云端|Windows|Mac|Linux)/i
]

const FIRST_ACTION_PATTERNS = [
  /(?:第一节|先|首先|第一步|最小|小目标|练习|实操|动手|案例|demo|原型|任务|动作|产出|交付|今天|这节课)/,
  /(?:搭建|写出|画出|实现|跑通|复现|配置|评估|对比|总结)/
]

const LEARNING_SETUP_PATTERNS = [
  /(?:我想|想要|希望|准备|打算|计划).{0,12}(?:学习|学|掌握|了解|入门|搞懂|研究)/,
  /(?:教我|带我学|帮我学|给我讲|生成.{0,8}(?:课程|lesson|学习计划)|设计.{0,8}(?:课程|lesson|学习路径))/i,
  /^(?:学习|学|入门|掌握|了解)\s*[A-Za-z0-9\u4e00-\u9fa5]/i
]

const CONTINUATION_PATTERNS = [
  /(?:下一节|下一课|继续|接着|复习|巩固|基于当前\s*mission|基于当前|按当前|沿着当前)/i,
  /(?:生成|设计).{0,12}(?:下一节|下一课|后续|复习|练习|lesson)/i
]

const QUESTION_COPY: Record<SignalKey, string> = {
  topic: '你说的主题具体指什么范围？例如 RAG 是想学概念、工程实现、评估，还是和现有项目结合？',
  background: '你现在的背景是什么？比如编程、机器学习、LLM 应用、向量数据库分别到什么程度？',
  goal: '你学这个是为了解决什么真实问题，或者最终要做出什么东西？',
  constraints: '你的时间、工具和环境有什么限制？例如每天可投入多久、准备用 Python 还是 TypeScript、是否已有数据。',
  firstAction: '你希望第一节课先完成什么可观察动作？例如跑通一个最小 RAG demo、画清检索链路，或设计数据切分方案。'
}

const SUMMARY_LABELS: Record<SignalKey, string> = {
  topic: '主题',
  background: '背景',
  goal: '目标',
  constraints: '约束',
  firstAction: '第一节动作'
}

export function assessTeachingReadiness(input: TeachingWorkflowInput): TeachingClarificationResult {
  const userInput = cleanText(input.userInput)
  const transcript = buildTranscript(input.messages, userInput)
  const signals = collectSignals(transcript, input.missionTitle, input.missionExcerpt)
  const missingSignals = (Object.keys(signals) as SignalKey[]).filter((key) => !signals[key].present)
  const knownEvidence = (Object.keys(signals) as SignalKey[])
    .filter((key) => signals[key].present)
    .map((key) => `${SUMMARY_LABELS[key]}：${signals[key].evidence[0]}`)

  if (missingSignals.length === 0) {
    const summary = knownEvidence.join('；')
    return {
      stage: 'ready',
      assistantMessage: `信息已经足够生成第一节课。\n\n我会按这个理解来设计：${summary}。`,
      summary,
      learnerProfile: evidenceFor(signals, ['background', 'constraints']),
      learningGoals: evidenceFor(signals, ['topic', 'goal', 'firstAction']),
      openQuestions: [],
      lessonPrompt: buildReadyLessonPrompt(signals, userInput),
      missingSignals
    }
  }

  const questions = missingSignals.slice(0, 3).map((key) => QUESTION_COPY[key])
  const summary = knownEvidence.length ? knownEvidence.join('；') : inferTopicSummary(userInput, input.missionTitle)
  return {
    stage: 'clarifying',
    assistantMessage: buildClarifyingMessage(summary, questions),
    summary,
    learnerProfile: evidenceFor(signals, ['background', 'constraints']),
    learningGoals: evidenceFor(signals, ['topic', 'goal', 'firstAction']),
    openQuestions: missingSignals.map((key) => QUESTION_COPY[key]),
    lessonPrompt: '',
    missingSignals
  }
}

export function shouldAutoGenerateLessonFromPrompt(input: TeachingWorkflowInput): boolean {
  return assessTeachingReadiness(input).stage === 'ready'
}

export function isLearningSetupRequest(value: string): boolean {
  const text = cleanText(value)
  if (!text) return false
  return LEARNING_SETUP_PATTERNS.some((pattern) => pattern.test(text))
}

export function isContinuationLessonRequest(value: string): boolean {
  const text = cleanText(value)
  if (!text) return false
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(text))
}

function buildTranscript(
  messages: Array<Pick<AgentChatMessage, 'role' | 'content'>> | undefined,
  userInput: string
): string[] {
  const prior = (messages ?? [])
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => cleanText(message.content))
    .filter(Boolean)
  return [...prior, userInput].filter(Boolean)
}

function collectSignals(
  transcript: string[],
  missionTitle?: string,
  missionExcerpt?: string
): TeachingSignals {
  const text = transcript.join('\n')
  const missionText = `${missionTitle ?? ''}\n${missionExcerpt ?? ''}`
  return {
    topic: detectSignal(`${text}\n${missionText}`, TOPIC_PATTERNS, () => inferTopicEvidence(text, missionTitle)),
    background: detectSignal(text, BACKGROUND_PATTERNS),
    goal: detectSignal(text, GOAL_PATTERNS),
    constraints: detectSignal(text, CONSTRAINT_PATTERNS),
    firstAction: detectSignal(text, FIRST_ACTION_PATTERNS)
  }
}

function detectSignal(
  text: string,
  patterns: RegExp[],
  fallbackEvidence?: () => string
): SignalEvidence {
  const normalized = cleanText(text)
  for (const pattern of patterns) {
    const match = pattern.exec(normalized)
    if (!match) continue
    const evidence = cleanText(match[0])
    return { present: true, evidence: [evidence] }
  }
  const fallback = cleanText(fallbackEvidence?.())
  return fallback ? { present: true, evidence: [fallback] } : { present: false, evidence: [] }
}

function inferTopicEvidence(text: string, missionTitle?: string): string {
  const cleaned = cleanText(text)
  const topicMatch = TOPIC_PATTERNS[0]!.exec(cleaned)
  if (topicMatch?.[1]) return topicMatch[1]
  const shortInput = cleaned.split(/[。.!?？\n]/)[0]?.trim()
  if (shortInput && shortInput.length <= 32 && !/^(好|可以|继续|生成|开始)$/.test(shortInput)) return shortInput
  return cleanText(missionTitle)
}

function evidenceFor(signals: TeachingSignals, keys: SignalKey[]): string[] {
  return keys.flatMap((key) => signals[key].evidence).filter(Boolean).slice(0, 6)
}

function buildClarifyingMessage(summary: string, questions: string[]): string {
  const lead = summary
    ? `我先不生成 lesson。现在只确认到：${summary}。`
    : '我先不生成 lesson。现在还缺少足够的学习背景和目标。'
  return `${lead}\n\n请先回答这 ${questions.length} 个问题：\n${questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}`
}

function buildReadyLessonPrompt(signals: TeachingSignals, userInput: string): string {
  const lines = (Object.keys(signals) as SignalKey[])
    .filter((key) => signals[key].present)
    .map((key) => `- ${SUMMARY_LABELS[key]}：${signals[key].evidence.join('；')}`)
  return `基于已澄清的学习任务生成第一节短小 lesson。\n${lines.join('\n')}\n\n用户原始输入：${userInput}`
}

function inferTopicSummary(userInput: string, missionTitle?: string): string {
  const topic = inferTopicEvidence(userInput, missionTitle)
  return topic ? `主题：${topic}` : ''
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
