import type { TeachingMemoryRecord } from './teaching-types'

/**
 * The only policy surface for learner-profile records. The filesystem-backed
 * TeachingMemoryStore remains the durable-record adapter; this module decides
 * which records are learner profiles and how they may enter prompts or consent
 * flows.
 */
export type LearnerProfileCategory = 'background' | 'goals' | 'constraints' | 'preferences'

export type LearnerProfileCandidate = {
  content: string
  tags: string[]
  confidence: number
  categories: LearnerProfileCategory[]
}

export type LearnerProfileCapturePlan =
  | { action: 'none'; reason: 'no_candidate' | 'duplicate'; candidate?: LearnerProfileCandidate }
  | { action: 'create'; candidate: LearnerProfileCandidate }
  | { action: 'request_consent'; candidate: LearnerProfileCandidate }

export type MemoryConsentDecision = 'approve' | 'reject'

const LEARNER_PROFILE_TAG = 'learner-profile'
const AUTO_CAPTURED_TAG = 'auto-captured'
const USER_APPROVED_TAG = 'user-approved'
const MAX_CANDIDATE_CONTENT_LENGTH = 280
const PENDING_CONSENT_MARKER_PREFIX = '<!-- studiumx:learner-profile-consent:v1:'
const PENDING_CONSENT_MARKER_RE = /<!--\s*studiumx:learner-profile-consent:v1:([A-Za-z0-9_-]+)\s*-->/g
const LEGACY_CONSENT_PROMPT_RE = /我还捕捉到一条可能适合长期记忆的信息：(.+?)。要记录到用户记忆吗？/gs

const CATEGORY_LABELS: Record<LearnerProfileCategory, string> = {
  background: '背景/场景',
  goals: '目标',
  constraints: '约束',
  preferences: '偏好'
}

const PROFILE_CATEGORIES: LearnerProfileCategory[] = ['background', 'goals', 'constraints', 'preferences']
const PROFILE_CATEGORY_TAGS = new Set<string>(PROFILE_CATEGORIES)

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
const BARE_APPROVAL_RESPONSES = [
  /^(?:可以|同意|好|好的|行|确认|yes|ok|okay|sure)[\s，。,.!！?？]*$/i,
  /^(?:(?:可以|同意|好|好的|行|确认|帮我|请)[\s，。,.!！?？]*)?(?:记录|保存|记住)(?:到(?:长期记忆|用户记忆))?(?:吧|一下|起来)?[\s，。,.!！?？]*$/i
]
const BARE_REJECTION_RESPONSES = [
  /^(?:不可以|不同意|不要|别|不用|不需要|暂时不|先不|否|no|never)(?:[\s，。,.!！?？]*(?:记录|保存|记住|长期记忆|用户记忆|memory))?[\s，。,.!！?？]*$/i,
  /^(?:不(?:记录|保存|记住))(?:了|吧)?[\s，。,.!！?？]*$/i
]

export const learnerProfileRecordPolicy = {
  createCandidate(userInput: string): LearnerProfileCandidate | null {
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

    return createCandidate(text, categories)
  },

  planCapture(
    candidate: LearnerProfileCandidate | null,
    records: TeachingMemoryRecord[]
  ): LearnerProfileCapturePlan {
    if (!candidate) return { action: 'none', reason: 'no_candidate' }
    const eligibleProfiles = records.filter(isEligibleLearnerProfileRecord)
    if (eligibleProfiles.some((record) => hasDuplicateIdentity(candidate, record))) {
      return { action: 'none', reason: 'duplicate', candidate }
    }
    if (eligibleProfiles.length === 0) return { action: 'create', candidate }
    return { action: 'request_consent', candidate }
  },

  classifyConsentResponse: classifyMemoryConsentResponse,

  isBareConsentResponse,

  buildConsentPrompt(candidate: LearnerProfileCandidate): string {
    const visiblePrompt = `\n\n我还捕捉到一条可能适合长期记忆的信息：${candidate.content}。要记录到用户记忆吗？`
    return `${visiblePrompt}\n${buildPendingConsentMarker(candidate)}`
  },

  readPendingConsent(assistantText: string): LearnerProfileCandidate | null {
    const markedConsent = readMarkedCandidate(assistantText)
    if (markedConsent.found) return markedConsent.candidate

    // Durable archives written before the v1 marker contain only this visible
    // Chinese wording. Keep that migration path, but never use the extracted
    // text as prompt syntax: prompt formatting always escapes it below.
    const legacyContent = readLegacyCandidateContent(assistantText)
    if (!legacyContent) return null
    return pendingCandidateFromLegacyContent(legacyContent)
  },

  promptLines(records: TeachingMemoryRecord[], limit = 6): string[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
    return records
      .filter(isEligibleLearnerProfileRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((record) => formatPromptLine(record.content))
      .filter(Boolean)
      .slice(0, normalizedLimit)
  },

  formatPromptLine(value: unknown): string {
    return formatPromptLine(value)
  }
} as const

function classifyMemoryConsentResponse(userInput: string): MemoryConsentDecision | null {
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

function isBareConsentResponse(userInput: string): boolean {
  const text = cleanText(userInput)
  if (!classifyMemoryConsentResponse(text)) return false
  return [...BARE_APPROVAL_RESPONSES, ...BARE_REJECTION_RESPONSES].some((pattern) => pattern.test(text))
}

function createCandidate(text: string, categories: LearnerProfileCategory[]): LearnerProfileCandidate {
  const label = categories.map((category) => CATEGORY_LABELS[category]).join('、')
  return {
    content: `学习者画像（${label}）：${trimForMemory(text)}`,
    tags: [LEARNER_PROFILE_TAG, AUTO_CAPTURED_TAG, ...categories],
    confidence: 0.82,
    categories
  }
}

function isEligibleLearnerProfileRecord(record: TeachingMemoryRecord): boolean {
  return record.scope === 'user' && !record.disabledAt && !record.deletedAt && isLearnerProfileRecord(record)
}

function isLearnerProfileRecord(record: TeachingMemoryRecord): boolean {
  return (
    record.tags.includes(LEARNER_PROFILE_TAG) ||
    record.tags.some((tag) => PROFILE_CATEGORY_TAGS.has(tag)) ||
    record.content.startsWith('学习者画像')
  )
}

function hasDuplicateIdentity(candidate: LearnerProfileCandidate, record: TeachingMemoryRecord): boolean {
  const candidateKey = learnerProfileIdentity(candidate.content)
  const recordKey = learnerProfileIdentity(record.content)
  if (!candidateKey || !recordKey) return false
  if (candidateKey === recordKey || candidateKey.includes(recordKey) || recordKey.includes(candidateKey)) return true

  const candidateGrams = grams(candidateKey)
  const recordGrams = grams(recordKey)
  if (candidateGrams.size === 0 || recordGrams.size === 0) return false
  let overlap = 0
  for (const gram of candidateGrams) {
    if (recordGrams.has(gram)) overlap += 1
  }
  return overlap / Math.min(candidateGrams.size, recordGrams.size) >= 0.88
}

function learnerProfileIdentity(value: string): string {
  return cleanText(value)
    .replace(/^学习者画像（[^）]+）：/, '')
    .replace(/[，。！？；：、,.!?;:\s"'“”‘’（）()【】\[\]{}<>《》]/g, '')
    .toLowerCase()
}

function readMarkedCandidate(assistantText: string): { found: boolean; candidate: LearnerProfileCandidate | null } {
  const matches = [...String(assistantText ?? '').matchAll(PENDING_CONSENT_MARKER_RE)]
  if (matches.length === 0) return { found: false, candidate: null }
  for (const match of matches.reverse()) {
    const decoded = decodeMarkerPayload(match[1])
    const candidate = validateMarkedCandidate(decoded)
    if (candidate) return { found: true, candidate }
  }
  // A marker identifies a v1 conversation. Do not downgrade malformed marker
  // data into legacy visible-text parsing, which would bypass schema validation.
  return { found: true, candidate: null }
}

function buildPendingConsentMarker(candidate: LearnerProfileCandidate): string {
  const categories = markerCategories(candidate)
  const payload = JSON.stringify({
    version: 1,
    candidate: {
      content: candidate.content,
      categories
    }
  })
  return `${PENDING_CONSENT_MARKER_PREFIX}${encodeBase64Url(payload)} -->`
}

function markerCategories(candidate: LearnerProfileCandidate): LearnerProfileCategory[] {
  const declared = Array.isArray(candidate.categories) && candidate.categories.every(isLearnerProfileCategory)
    ? candidate.categories
    : []
  const fromContent = categoriesFromProfileContent(candidate.content)
  const declaredLabel = declared.map((category) => CATEGORY_LABELS[category]).join('、')
  const contentLabel = fromContent.map((category) => CATEGORY_LABELS[category]).join('、')
  return declared.length > 0 && declaredLabel === contentLabel ? declared : fromContent
}

function categoriesFromProfileContent(content: string): LearnerProfileCategory[] {
  const label = /^学习者画像（([^）]+)）：/.exec(content)?.[1]
  if (!label) return []
  const categories = label.split('、').map((part) => PROFILE_CATEGORIES.find((category) => CATEGORY_LABELS[category] === part))
  return categories.every((category): category is LearnerProfileCategory => Boolean(category))
    ? categories
    : []
}

function decodeMarkerPayload(value: string): unknown {
  try {
    return JSON.parse(decodeBase64Url(value)) as unknown
  } catch {
    return null
  }
}

function validateMarkedCandidate(value: unknown): LearnerProfileCandidate | null {
  if (!isPlainObject(value) || value.version !== 1 || !isPlainObject(value.candidate)) return null
  const { content, categories } = value.candidate
  if (typeof content !== 'string' || !Array.isArray(categories)) return null
  if (!categories.every(isLearnerProfileCategory)) return null
  if (new Set(categories).size !== categories.length || categories.length === 0) return null

  const normalizedContent = cleanText(content)
  if (normalizedContent !== content || content.length > MAX_CANDIDATE_CONTENT_LENGTH) return null
  const label = categories.map((category) => CATEGORY_LABELS[category]).join('、')
  const prefix = `学习者画像（${label}）：`
  if (!content.startsWith(prefix) || content.slice(prefix.length).length < 4) return null

  return pendingCandidate(content, categories)
}

function readLegacyCandidateContent(assistantText: string): string {
  const matches = [...String(assistantText ?? '').matchAll(LEGACY_CONSENT_PROMPT_RE)]
  return cleanText(matches.at(-1)?.[1])
}

function pendingCandidateFromLegacyContent(content: string): LearnerProfileCandidate {
  return pendingCandidate(content, detectCategories(content))
}

function pendingCandidate(content: string, categories: LearnerProfileCategory[]): LearnerProfileCandidate {
  return {
    content,
    tags: [LEARNER_PROFILE_TAG, AUTO_CAPTURED_TAG, USER_APPROVED_TAG, ...categories],
    confidence: 0.9,
    categories
  }
}

function detectCategories(text: string): LearnerProfileCategory[] {
  const categories: LearnerProfileCategory[] = []
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

function formatPromptLine(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim()
}

function trimForMemory(text: string): string {
  const maxLength = 220
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
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

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLearnerProfileCategory(value: unknown): value is LearnerProfileCategory {
  return typeof value === 'string' && PROFILE_CATEGORY_TAGS.has(value)
}