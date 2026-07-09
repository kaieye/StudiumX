import type {
  GenerateLessonResult,
  LessonStreamDone,
  LessonStreamStatus,
  LessonSummary,
  TeachingAppState,
  TeachingRuntimeState,
  TeachingWorkspaceSummary,
  WorkspaceView
} from '../../../shared/teaching-types'
import { lessonToCoursePreviewFile, type CoursePreviewFile } from './contextTransitions'

export type LessonGenerationPatch<TError = never> = {
  view?: WorkspaceView
  lessonReaderOpen?: boolean
  selectedCourseRelativePath?: string | null
  selectedCourseWorkspaceId?: string | null
  selectedCoursePreviewFile?: CoursePreviewFile | null
  appState?: TeachingAppState
  taskPrompt?: string
  generating?: boolean
  error?: TError | null
}

export type LessonGenerationNotificationIntent = {
  title: string
  path: string
  source: 'ai' | 'fallback'
  reason?: string
}

export type LessonGenerationEffects = {
  openPath?: string
  lessonGeneratedNotification?: LessonGenerationNotificationIntent
}

export type LessonGenerationEffectSettings = {
  autoOpenGeneratedLesson: boolean
  notificationsEnabled: boolean
  lessonGeneratedNotifications: boolean
}

export type StreamingPreviewLabels = {
  language: string
  hint: string
  placeholder: string
}

export const lessonGenerationDefaultRuntime: TeachingRuntimeState = {
  status: 'idle',
  currentStep: 'ready',
  queuedTasks: 0,
  providerLabel: 'Local structured generator'
}

export function suggestedCourseName(workspace: TeachingWorkspaceSummary, prompt: string): string {
  const topic = prompt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^我想(先)?学习/, '')
    .replace(/^学习/, '')
    .replace(/^如何/, '')
    .split(/[。.!?？\n]/)[0]
    ?.trim()

  if (topic) return topic.slice(0, 32)
  return workspace.courses[0]?.name ?? workspace.name
}

export function beginLessonGeneration(input: {
  appState: TeachingAppState
  providerLabel: string
}): LessonGenerationPatch {
  return {
    generating: true,
    error: null,
    appState: {
      ...input.appState,
      runtime: {
        status: 'working',
        currentStep: 'calling model',
        queuedTasks: 1,
        providerLabel: input.providerLabel
      }
    }
  }
}

export function completeLessonGeneration(input: {
  state: TeachingAppState
  lesson: LessonSummary
  workspaceId: string
  nextPrompt: string
}): LessonGenerationPatch {
  return {
    view: 'lessons',
    lessonReaderOpen: true,
    selectedCourseRelativePath: input.lesson.courseRelativePath,
    selectedCourseWorkspaceId: input.workspaceId,
    selectedCoursePreviewFile: lessonToCoursePreviewFile(input.lesson),
    appState: input.state,
    taskPrompt: input.nextPrompt,
    generating: false
  }
}

export function failLessonGeneration<TError>(input: {
  appState: TeachingAppState
  error: TError
}): LessonGenerationPatch<TError> {
  return {
    generating: false,
    error: input.error,
    appState: { ...input.appState, runtime: { ...lessonGenerationDefaultRuntime, status: 'error' } }
  }
}

export function failStreamingLessonGeneration<TError>(error: TError): LessonGenerationPatch<TError> {
  return {
    generating: false,
    error
  }
}

export function appendStreamingPreview(input: {
  appState: TeachingAppState
  liveText: string
  workspace: TeachingWorkspaceSummary
  labels: StreamingPreviewLabels
}): LessonGenerationPatch {
  return {
    appState: {
      ...input.appState,
      previewHtml: streamingPreviewHtml(input.liveText, input.workspace, input.labels),
      previewUrl: ''
    }
  }
}

export function updateStreamingStatus(input: {
  appState: TeachingAppState
  status: LessonStreamStatus
}): LessonGenerationPatch {
  return {
    appState: {
      ...input.appState,
      runtime: { ...input.appState.runtime, currentStep: stepLabel(input.status.step) }
    }
  }
}

export function effectsForGeneratedLesson(input: {
  lesson: LessonSummary
  source?: 'ai' | 'fallback'
  reason?: string
  settings: LessonGenerationEffectSettings
}): LessonGenerationEffects {
  return {
    ...(input.settings.autoOpenGeneratedLesson ? { openPath: input.lesson.absolutePath } : {}),
    ...(input.settings.notificationsEnabled && input.settings.lessonGeneratedNotifications
      ? {
          lessonGeneratedNotification: {
            title: input.lesson.title,
            path: input.lesson.relativePath,
            source: input.source ?? 'ai',
            reason: input.reason
          }
        }
      : {})
  }
}

export function effectsForAgentGeneratedLessons(input: {
  lessons: LessonSummary[]
  settings: LessonGenerationEffectSettings
}): LessonGenerationEffects {
  const latest = input.lessons[input.lessons.length - 1]
  if (!latest) return {}
  return effectsForGeneratedLesson({
    lesson: latest,
    source: 'ai',
    settings: input.settings
  })
}

export function directLessonDonePatch(input: {
  result: GenerateLessonResult
  workspaceId: string
  nextPrompt: string
}): LessonGenerationPatch {
  return completeLessonGeneration({
    state: input.result.state,
    lesson: input.result.lesson,
    workspaceId: input.workspaceId,
    nextPrompt: input.nextPrompt
  })
}

export function streamedLessonDonePatch(input: {
  done: LessonStreamDone
  workspaceId: string
  nextPrompt: string
}): LessonGenerationPatch | null {
  if ('error' in input.done || input.done.kind !== 'lesson') return null
  return completeLessonGeneration({
    state: input.done.state,
    lesson: input.done.lesson,
    workspaceId: input.workspaceId,
    nextPrompt: input.nextPrompt
  })
}

function stepLabel(step: LessonStreamStatus['step']): string {
  const labels: Record<LessonStreamStatus['step'], string> = {
    calling: 'calling model',
    streaming: 'streaming output',
    validating: 'validating JSON',
    rendering: 'rendering artifacts',
    done: 'done',
    error: 'error'
  }
  return labels[step]
}

function streamingPreviewHtml(
  liveText: string,
  workspace: TeachingWorkspaceSummary,
  labels: StreamingPreviewLabels
): string {
  return `<!doctype html><html lang="${labels.language}"><head><meta charset="utf-8" /><style>
body{margin:0;font-family:Inter,"Microsoft YaHei",sans-serif;color:#24324a;background:#fbfcff}
main{max-width:760px;margin:0 auto;padding:38px 30px}.badge{color:#4f7cf5;font-size:12px;font-weight:800;text-transform:uppercase}pre{white-space:pre-wrap;line-height:1.7;color:#40506a;background:#f4f7fb;border:1px solid #e8edf5;border-radius:16px;padding:18px;min-height:180px}
</style></head><body><main><div class="badge">StudiumX · Streaming</div><h1>${escapeHtml(workspace.missionTitle)}</h1><p>${escapeHtml(labels.hint)}</p><pre>${escapeHtml(liveText || labels.placeholder)}</pre></main></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
