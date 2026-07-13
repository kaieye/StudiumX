import {
  buildMemoryConsentPrompt,
  classifyMemoryConsentResponse,
  extractPendingLearnerMemoryCandidate,
  isBareMemoryConsentResponse,
  type LearnerMemoryCandidate,
  type LearnerMemoryCapturePlan
} from '../shared/teaching-memory-capture'
import type { ChatMessage } from './ai/provider-adapter'
import type {
  CreateTeachingMemoryPayload,
  TeachingMemoryCaptureResult,
  TeachingMemoryRecord
} from '../shared/teaching-types'

export type DirectMemoryConsentResolution =
  | {
      handled: true
      finalText: string
      memoryCapture: TeachingMemoryCaptureResult
    }
  | {
      handled: false
      isBareConsentResponse: boolean
    }

/**
 * Resolves only a bare response to the consent question emitted in a prior
 * turn. Any substantive new user input remains a normal turn, preventing an
 * old consent request from swallowing fresh learner context.
 */
export async function resolveDirectMemoryConsent(options: {
  userInput: string
  previousAssistantContent: string
  workspaceRoot: string | undefined
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
}): Promise<DirectMemoryConsentResolution> {
  const pendingCandidate = extractPendingLearnerMemoryCandidate(options.previousAssistantContent)
  const isBareConsentResponse = Boolean(pendingCandidate && isBareMemoryConsentResponse(options.userInput))
  const decision = isBareConsentResponse ? classifyMemoryConsentResponse(options.userInput) : null

  if (!options.workspaceRoot || !pendingCandidate || !decision) {
    return { handled: false, isBareConsentResponse }
  }

  if (decision === 'approve') {
    const memory = await options.createMemory(toMemoryPayload(pendingCandidate, options.workspaceRoot))
    return {
      handled: true,
      finalText: '已记录到用户记忆。后续课程会把这条信息作为长期背景使用。',
      memoryCapture: {
        action: 'approved',
        candidateContent: pendingCandidate.content,
        memoryId: memory.id
      }
    }
  }

  return {
    handled: true,
    finalText: '好的，这条信息不会记录到用户记忆。',
    memoryCapture: {
      action: 'rejected',
      candidateContent: pendingCandidate.content
    }
  }
}

/** Keeps post-loop memory side effects and streamed consent wording together. */
export async function finalizeLearnerMemoryCapture(options: {
  workspaceRoot: string | undefined
  capturePlan: LearnerMemoryCapturePlan
  createMemory: (payload: CreateTeachingMemoryPayload) => Promise<TeachingMemoryRecord>
  finalText: string
  messages: ChatMessage[]
  appendToLastAssistantMessage: (messages: ChatMessage[], extra: string) => ChatMessage[]
  publishConsentPrompt: (prompt: string) => void
}): Promise<{
  finalText: string
  messages: ChatMessage[]
  memoryCapture: TeachingMemoryCaptureResult | undefined
}> {
  const { capturePlan } = options
  if (options.workspaceRoot && capturePlan.action === 'create') {
    const memory = await options.createMemory(toMemoryPayload(capturePlan.candidate, options.workspaceRoot))
    return {
      finalText: options.finalText,
      messages: options.messages,
      memoryCapture: {
        action: 'created',
        candidateContent: capturePlan.candidate.content,
        memoryId: memory.id
      }
    }
  }

  if (capturePlan.action === 'request_consent') {
    const consentPrompt = buildMemoryConsentPrompt(capturePlan.candidate)
    options.publishConsentPrompt(consentPrompt)
    return {
      finalText: `${options.finalText}${consentPrompt}`,
      messages: options.appendToLastAssistantMessage(options.messages, consentPrompt),
      memoryCapture: {
        action: 'requested_consent',
        candidateContent: capturePlan.candidate.content
      }
    }
  }

  return { finalText: options.finalText, messages: options.messages, memoryCapture: undefined }
}

function toMemoryPayload(candidate: LearnerMemoryCandidate, workspaceRoot: string): CreateTeachingMemoryPayload {
  return {
    content: candidate.content,
    scope: 'user',
    tags: candidate.tags,
    confidence: candidate.confidence,
    workspaceRoot
  }
}
