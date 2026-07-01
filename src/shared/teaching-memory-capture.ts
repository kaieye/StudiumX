import type { TeachingMemoryRecord } from './teaching-types'

export type LearnerMemoryCategory = 'background' | 'goals' | 'constraints' | 'preferences'

export type LearnerMemoryCandidate = {
  content: string
  tags: string[]
  confidence: number
  categories: LearnerMemoryCategory[]
}

export type LearnerMemoryCapturePlan =
  | { action: 'none'; reason: 'no_candidate' | 'duplicate'; candidate?: LearnerMemoryCandidate }
  | { action: 'create'; candidate: LearnerMemoryCandidate }
  | { action: 'request_consent'; candidate: LearnerMemoryCandidate }

export type MemoryConsentDecision = 'approve' | 'reject'

const LEARNER_MEMORY_TAG = 'learner-profile'
const AUTO_CAPTURED_TAG = 'auto-captured'

const CATEGORY_LABELS: Record<LearnerMemoryCategory, string> = {
  background: '背景/场景',
  goals: '目标',
  constraints: '约束',
  preferences: '偏好'
}

const MEMORY_CONSENT_PROMPT_RE = /我还捕捉到一条可能适合长期记忆的信息：(.+?)。要记录到用户记忆吗？/s

const BACKGROUND_PATTERNS = [
  /(?:我是|我是一名|我现在是|目前是|身份|职业|岗位|工作|从事|负责|学生|老师|教师|家长|管理者|设计师|运营|销售|医生|律师|会计|研究生|本科|初中|高中|小学|零基础|新手|初学|基础|经验|学过|做过|用过|熟悉|不熟悉)/
]

const GOAL_PATTERNS = [
  /(?:目标|为了|想要|希望|打算|计划|准备用来|用来|拿来|解决|完成|做出|产出|通过|备考|考试|面试|项目|作品|课堂|课程|报告|论文|证书|工作|业务|生活)/
]

const CONSTRAINT_PATTERNS = [
  /(?:时间|每天|每周|周末|小时|分钟|预算|设备|电脑|手机|平板|工具|软件|语言|材料|数据|环境|限制|约束|只能|不能|没有|需要|可投入|截止|deadline)/i
]

const PREFERENCE_PATTERNS = [
  /(?:喜欢|偏好|希望|不想|不要|先|更适合|用中文|英文|案例|实操|实践|理论|一步步|图示|视频|文字|练习|输出|形式|风格|节奏|慢一点|快一点)/
]

const CONSENT_KEYWORDS = /(?:记录|保存|记住|长期记忆|用户记忆|memory)/i

export function buildLearnerMemoryCandidate(userInput: string): LearnerMemoryCandidate | null {
  const text = cleanText(userInput)
  if (!text || text.length < 4) return null
  if (looksLikeMemoryConsentOnly(text)) return null
  if (/(?:不要|别|不用|不需要|暂时不).{0,8}(?:记录|保存|记住|长期记忆|用户记忆|memory)/i.test(text)) {
    return null
  }

  const categories = detectCategories(text)
  const hasStableUserContext = categories.some((category) => category !== 'goals')
  if (!hasStableUserContext && categories.length < 2) return null
  if (categories.length === 0) return null

  const label = categories.map((category) => CATEGORY_LABELS[category]).join('、')
  return {
    content: `学习者画像（${label}）：${trimForMemory(text)}`,
    tags: [LEARNER_MEMORY_TAG, AUTO_CAPTURED_TAG, ...categories],
    confidence: 0.82,
    categories
  }
}

export function planLearnerMemoryCapture(
  candidate: LearnerMemoryCandidate | null,
  existingMemories: TeachingMemoryRecord[]
): LearnerMemoryCapturePlan {
  if (!candidate) return { action: 'none', reason: 'no_candidate' }
  const activeUserMemories = existingMemories.filter((memory) => memory.scope === 'user' && !memory.disabledAt && !memory.deletedAt)
  const relevantUserMemories = activeUserMemories.filter(isLearnerProfileMemory)
  if (relevantUserMemories.some((memory) => isDuplicateLearnerMemory(candidate, memory))) {
    return { action: 'none', reason: 'duplicate', candidate }
  }
  if (relevantUserMemories.length === 0) return { action: 'create', candidate }
  return { action: 'request_consent', candidate }
}

export function classifyMemoryConsentResponse(userInput: string): MemoryConsentDecision | null {
  const text = cleanText(userInput).toLowerCase()
  if (!text) return null
  if (/(?:不可以|不同意|不要|别|不用|不需要|暂时不|先不|否|no|never)/i.test(text)) return 'reject'
  if (
    /^(?:可以|同意|好|好的|行|确认|记住|保存|记录|yes|ok|okay|sure)(?:$|[\s，。,.!！?？])/i.test(text) ||
    /(?:可以|同意|确认|帮我|请).{0,8}(?:记录|保存|记住)/i.test(text) ||
    /(?:记录|保存|记住).{0,8}(?:吧|一下|起来|到长期记忆|到用户记忆)/i.test(text)
  ) {
    return 'approve'
  }
  return null
}

export function isBareMemoryConsentResponse(userInput: string): boolean {
  const text = cleanText(userInput)
  if (!classifyMemoryConsentResponse(text)) return false
  if (detectCategories(text).length > 0) return false
  if (text.length <= 24) return true
  return text.length <= 40 && CONSENT_KEYWORDS.test(text)
}

export function buildMemoryConsentPrompt(candidate: LearnerMemoryCandidate): string {
  return `\n\n我还捕捉到一条可能适合长期记忆的信息：${candidate.content}。要记录到用户记忆吗？`
}

export function extractPendingLearnerMemoryCandidate(assistantText: string): LearnerMemoryCandidate | null {
  const content = cleanText(MEMORY_CONSENT_PROMPT_RE.exec(assistantText)?.[1])
  if (!content) return null
  const categories = detectCategories(content)
  return {
    content,
    tags: [LEARNER_MEMORY_TAG, AUTO_CAPTURED_TAG, 'user-approved', ...categories],
    confidence: 0.9,
    categories
  }
}

export function isLearnerProfileMemory(memory: TeachingMemoryRecord): boolean {
  return (
    memory.tags.includes(LEARNER_MEMORY_TAG) ||
    memory.tags.includes('background') ||
    memory.content.startsWith('学习者画像')
  )
}

function detectCategories(text: string): LearnerMemoryCategory[] {
  const categories: LearnerMemoryCategory[] = []
  if (BACKGROUND_PATTERNS.some((pattern) => pattern.test(text))) categories.push('background')
  if (GOAL_PATTERNS.some((pattern) => pattern.test(text))) categories.push('goals')
  if (CONSTRAINT_PATTERNS.some((pattern) => pattern.test(text))) categories.push('constraints')
  if (PREFERENCE_PATTERNS.some((pattern) => pattern.test(text))) categories.push('preferences')
  return categories
}

function looksLikeMemoryConsentOnly(text: string): boolean {
  if (!CONSENT_KEYWORDS.test(text) && text.length > 12) return false
  return classifyMemoryConsentResponse(text) !== null
}

function isDuplicateLearnerMemory(candidate: LearnerMemoryCandidate, memory: TeachingMemoryRecord): boolean {
  const candidateKey = normalizeMemoryComparable(candidate.content)
  const memoryKey = normalizeMemoryComparable(memory.content)
  if (!candidateKey || !memoryKey) return false
  if (candidateKey === memoryKey || candidateKey.includes(memoryKey) || memoryKey.includes(candidateKey)) return true

  const candidateGrams = grams(candidateKey)
  const memoryGrams = grams(memoryKey)
  if (candidateGrams.size === 0 || memoryGrams.size === 0) return false
  let overlap = 0
  for (const gram of candidateGrams) {
    if (memoryGrams.has(gram)) overlap += 1
  }
  return overlap / Math.min(candidateGrams.size, memoryGrams.size) >= 0.88
}

function normalizeMemoryComparable(value: string): string {
  return cleanText(value)
    .replace(/^学习者画像（[^）]+）：/, '')
    .replace(/[，。！？；：、,.!?;:\s"'“”‘’（）()【】\[\]{}<>《》]/g, '')
    .toLowerCase()
}

function grams(value: string): Set<string> {
  const result = new Set<string>()
  const asciiWords = value.match(/[a-z0-9_]{3,}/g) ?? []
  for (const word of asciiWords) {
    for (let index = 0; index + 3 <= word.length; index += 1) result.add(word.slice(index, index + 3))
  }
  const cjkRuns = value.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  for (const run of cjkRuns) {
    for (let index = 0; index + 2 <= run.length; index += 1) result.add(run.slice(index, index + 2))
    if (run.length < 2) result.add(run)
  }
  return result
}

function trimForMemory(text: string): string {
  const maxLength = 220
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
