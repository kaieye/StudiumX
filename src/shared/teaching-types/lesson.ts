import type { ModelEndpointFormat } from './settings'
import type { TeachingWorkspaceChangeSummary } from './changes'
import type { GenerateLessonPayload, LessonSummary, TeachingAppState } from './workspace'

export type QuizType = 'single' | 'multi' | 'truefalse' | 'fill'

export type ProbeProviderPayload = {
  baseUrl: string
  apiKey: string
  endpointFormat: ModelEndpointFormat
}

export type ProbeProviderResult =
  | { ok: true; latencyMs: number; modelIds: string[] }
  | { ok: false; message: string }

export type ListUpstreamModelsResult =
  | { ok: true; modelIds: string[] }
  | { ok: false; message: string }

export type LessonStreamStep = 'calling' | 'streaming' | 'validating' | 'rendering' | 'done' | 'error'

export type LessonStreamChunk = {
  streamId: string
  delta: string
}

export type LessonStreamStatus = {
  streamId: string
  step: LessonStreamStep
  message?: string
}

export type LessonStreamDone =
  | ({ streamId: string } & import('./workspace').GenerateLessonSuccessResult)
  | ({ streamId: string } & import('./workspace').GenerateLessonFailureResult)
  | { streamId: string; error: true; message: string }

export type GenerateLessonStreamPayload = GenerateLessonPayload
