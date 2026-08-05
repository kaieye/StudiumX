import { basename } from 'node:path'
import type { AdapterCallbacks } from './ai/provider-adapter'
import { buildLessonSystemPrompt, buildLessonUserPrompt } from './ai/lesson-prompts'
import { produce, type PreparedLessonPlanRequest } from './lesson-plan-production'
import { readMissionSummary } from './teaching-workspace-catalog'
import { clampTitle, cleanText, collectTeachingFiles } from './teaching-workspace-paths'
import type { LessonPlanSource } from '../shared/lesson-schema'
import { STATIC_LESSON_RENDERER_CAPABILITIES } from '../shared/lesson-preview-capabilities'
import {
  buildLessonPromptFromBrief,
  buildLessonPromptWithConversation,
  type LessonBrief
} from '../shared/teaching-workflow'
import type {
  AgentChatMessage,
  LessonSummary,
  AgentRunResourceGovernance,
  TeachingMemoryRecord,
  TeachingSettingsV1
} from '../shared/teaching-types'
import { publishLessonArtifacts, type LessonArtifactPublication } from './teaching-lesson-artifacts'

export { LessonGenerationError } from './lesson-plan-production'

export type LessonGenerationWorkspace = {
  id: string
  name: string
  rootPath: string
}

export type LessonGenerationCallbacks = AdapterCallbacks

export type LessonGenerationMemoryRetriever = (options: {
  query: string
  workspaceRoot: string
  limit: number
}) => Promise<TeachingMemoryRecord[]>

export type LessonGenerationResult = {
  kind: 'lesson'
  lesson: LessonSummary
  assessment: { relativePath: string; contentSha256: string }
  /** Durable publisher journal acknowledged only after filesystem projections persist. */
  transactionId: string
  source: LessonPlanSource
  reason?: string
  eventPrompt: string
  eventPaths: string[]
  eventMeta: { source: LessonPlanSource; reason?: string; model?: string }
}

/**
 * Prepares mission/context/prompts, delegates the provider policy to the
 * LessonPlan production seam, then publishes only the returned durable plan.
 */
export async function runLessonGenerationPipeline(options: {
  workspace: LessonGenerationWorkspace
  settings: TeachingSettingsV1
  lessons: LessonSummary[]
  prompt: string
  /** Structured brief authored by the teaching conversation agent, if any. */
  brief?: LessonBrief
  requestedCourseName?: string
  messages: AgentChatMessage[]
  now: string
  retrieveMemories: LessonGenerationMemoryRetriever
  callbacks?: LessonGenerationCallbacks
  bindCanonicalSession?: (publication: Pick<LessonArtifactPublication, 'lesson' | 'assessment'>) => Promise<void | (() => Promise<void>)>
  /** Direct-UI reserved publisher journal id; agent path omits this. */
  reservedTransactionId?: string
  /** Host-owned policy resolved once for this direct lesson action. */
  resourceGovernance?: AgentRunResourceGovernance
}): Promise<LessonGenerationResult> {
  const {
    workspace,
    settings,
    lessons,
    prompt,
    brief,
    requestedCourseName,
    messages,
    now,
    retrieveMemories,
    callbacks,
    bindCanonicalSession,
    reservedTransactionId,
    resourceGovernance
  } = options

  const mission = await readMissionSummary(workspace.rootPath, workspace.name)
  const lessonPrompt = brief
    ? buildLessonPromptFromBrief(brief)
    : buildLessonPromptWithConversation(prompt, messages)
  const sequence = await nextLessonNumber(workspace.rootPath, lessons)
  const recalledMemories = await retrieveMemories({
    query: `${mission.title}\n${mission.excerpt}\n${lessonPrompt}`,
    workspaceRoot: workspace.rootPath,
    limit: settings.memory.maxInjected
  })
  const prepared: PreparedLessonPlanRequest = {
    workspace,
    mission,
    prompt: lessonPrompt,
    sequence,
    settings,
    systemPrompt: buildLessonSystemPrompt({
      missionTitle: mission.title,
      missionExcerpt: mission.excerpt,
      durationMinutes: settings.generator.lessonDurationMinutes,
      includeRetrievalPractice: settings.generator.includeRetrievalPractice,
      generateReference: settings.generator.generateReference,
      memories: recalledMemories,
      generator: settings.generator,
      previewCapabilities: STATIC_LESSON_RENDERER_CAPABILITIES
    }),
    userPrompt: buildLessonUserPrompt({
      prompt: lessonPrompt,
      sequence,
      missionTitle: mission.title,
      memories: recalledMemories
    }),
    callbacks: callbacks ?? {},
    resourceGovernance
  }
  const { plan, source, reason } = await produce(prepared)

  const title = clampTitle(plan.title)
  const objective = cleanText(plan.objective) || `把「${deriveTopic(lessonPrompt, mission.title)}」压缩成一次可保存、可复习的学习动作。`

  callbacks?.onStatus?.('rendering')
  const publication = await publishLessonArtifacts({
    workspace,
    plan,
    sequence,
    title,
    objective,
    prompt: lessonPrompt,
    createdAt: now,
    durationMinutes: plan.durationMinutes || settings.generator.lessonDurationMinutes,
    requestedCourseName,
    mission,
    generator: settings.generator,
    includeReference: settings.generator.generateReference
  }, { bindCanonicalSession, reservedTransactionId })

  return {
    kind: 'lesson',
    lesson: publication.lesson,
    assessment: publication.assessment,
    transactionId: publication.transactionId,
    source,
    reason,
    eventPrompt: lessonPrompt,
    eventPaths: publication.eventPaths,
    eventMeta: { source, reason, model: settings.generator.model || undefined }
  }
}

async function nextLessonNumber(rootPath: string, lessons: LessonSummary[]): Promise<number> {
  const fromIndex = lessons.map((lesson) => Number.parseInt(lesson.id, 10)).filter(Number.isFinite)
  const files = await collectTeachingFiles(rootPath, (file) => file.toLowerCase().endsWith('.html'))
  const fromDisk = files
    .map((file) => Number.parseInt(basename(file).slice(0, 4), 10))
    .filter(Number.isFinite)
  return Math.max(0, ...fromIndex, ...fromDisk) + 1
}

function deriveTopic(prompt: string, fallback: string): string {
  const cleaned = cleanText(prompt)
    .replace(/^我想(先)?学习/, '')
    .replace(/^学习/, '')
    .replace(/^如何/, '')
  const firstSentence = cleaned.split(/[。.!?？\n]/)[0]?.trim()
  const topic = firstSentence && firstSentence.length <= 34 ? firstSentence : firstSentence?.slice(0, 34)
  return topic || cleanText(fallback) || '学习任务'
}
