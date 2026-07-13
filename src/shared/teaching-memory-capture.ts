import { learnerProfileRecordPolicy } from './learner-profile-record-policy'

export type {
  LearnerProfileCandidate as LearnerMemoryCandidate,
  LearnerProfileCapturePlan as LearnerMemoryCapturePlan,
  LearnerProfileCategory as LearnerMemoryCategory,
  MemoryConsentDecision
} from './learner-profile-record-policy'

/** @deprecated Compatibility facade; learner-profile policy lives in learner-profile-record-policy. */
export const buildLearnerMemoryCandidate = learnerProfileRecordPolicy.createCandidate
/** @deprecated Compatibility facade; learner-profile policy lives in learner-profile-record-policy. */
export const planLearnerMemoryCapture = learnerProfileRecordPolicy.planCapture
/** @deprecated Compatibility facade; learner-profile policy lives in learner-profile-record-policy. */
export const classifyMemoryConsentResponse = learnerProfileRecordPolicy.classifyConsentResponse
/** @deprecated Compatibility facade; learner-profile policy lives in learner-profile-record-policy. */
export const isBareMemoryConsentResponse = learnerProfileRecordPolicy.isBareConsentResponse
/** @deprecated Compatibility facade; learner-profile policy lives in learner-profile-record-policy. */
export const buildMemoryConsentPrompt = learnerProfileRecordPolicy.buildConsentPrompt
/** @deprecated Compatibility facade; learner-profile policy lives in learner-profile-record-policy. */
export const extractPendingLearnerMemoryCandidate = learnerProfileRecordPolicy.readPendingConsent
/** @deprecated Compatibility facade; learner-profile policy lives in learner-profile-record-policy. */
export const formatLearnerMemoryPromptLine = learnerProfileRecordPolicy.formatPromptLine