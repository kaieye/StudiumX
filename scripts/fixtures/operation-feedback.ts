import assert from 'node:assert/strict'

import { operationFeedback, type OperationFeedbackTranslator } from '../../src/renderer/src/app-shell/operationFeedback'

const labels: Record<string, string> = {
  'errors.ipcHandlerMissing.message': 'Restart required',
  'errors.ipcHandlerMissing.detail': 'Restart the app.',
  'errors.noApiKey.message': 'API key required',
  'errors.noApiKey.detail': 'Add an API key.',
  'errors.providerInsufficientBalance.message': 'Provider balance is insufficient',
  'errors.providerInsufficientBalance.detail': 'Add credits.',
  'errors.providerAuth.message': 'Provider authentication failed',
  'errors.providerAuth.detail': 'Check credentials.',
  'errors.providerRateLimit.message': 'Provider rate limit reached',
  'errors.providerRateLimit.detail': 'Try later.',
  'errors.providerHttp.message': 'Provider request failed',
  'errors.providerHttp.detail': 'HTTP {{status}}.',
  'errors.missingField.message': 'Incomplete parameters',
  'errors.missingField.detail': 'Missing {{field}}.',
  'errors.missingField.fallbackField': 'parameter',
  'errors.badPayload.message': 'Bad request format',
  'errors.badPayload.detail': 'Refresh and retry.',
  'errors.windowControl.message': 'Window action unsupported',
  'errors.windowControl.detail': 'Unavailable here.',
  'errors.workspaceNotFound.message': 'Workspace not found',
  'errors.workspaceNotFound.detail': 'Re-import it.',
  'errors.invalidPath.message': 'Invalid path',
  'errors.invalidPath.detail': 'Choose a valid workspace.',
  'errors.emptyMission.message': 'Please enter a learning mission',
  'errors.emptyMission.detail': 'Describe what to learn.',
  'errors.emptyTask.message': 'Please enter a teaching task',
  'errors.emptyTask.detail': 'Describe the lesson.',
  'errors.pathRestricted.message': 'Path access restricted',
  'errors.pathRestricted.detail': 'Workspace files only.',
  'errors.fileNotFound.message': 'File not found',
  'errors.fileNotFound.detail': 'The file moved.',
  'errors.accessDenied.message': 'File access denied',
  'errors.accessDenied.detail': 'Check permissions.',
  'errors.generic.message': 'Operation failed',
  'errors.generic.detail': 'Try again.',
  'errors.generic.stackDetail': 'Restart the app.'
}

const translate: OperationFeedbackTranslator = (key, interpolation) => {
  const template = labels[key]
  if (!template) throw new Error(`Unexpected translation key: ${key}`)
  return Object.entries(interpolation ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
    template
  )
}

const allNotifications = {
  enabled: true,
  errors: true,
  lessonGenerated: true,
  workspaceImported: true
}

const providerFailure = operationFeedback({
  outcome: 'failure',
  error: 'Provider returned 402 {"error":{"message":"credits exhausted"}}',
  translate
})
assert.deepEqual(providerFailure.visibleError, {
  message: 'Provider balance is insufficient',
  severity: 'warning',
  detail: 'Add credits. credits exhausted'
})
assert.equal(providerFailure.notification, undefined)

const missingFieldFailure = operationFeedback({
  outcome: 'failure',
  error: 'IPC payload field "workspaceId" is required',
  translate
})
assert.deepEqual(missingFieldFailure.visibleError, {
  message: 'Incomplete parameters',
  severity: 'warning',
  detail: 'Missing workspaceId.'
})

const stackFailure = operationFeedback({
  outcome: 'failure',
  error: 'TypeError: bad state',
  translate
})
assert.deepEqual(stackFailure.visibleError, {
  message: 'Operation failed',
  severity: 'error',
  detail: 'Restart the app.'
})

const importFailure = operationFeedback({
  outcome: 'failure',
  error: 'Selected path is not a directory',
  operation: 'workspace-import',
  notifications: allNotifications,
  translate
})
assert.deepEqual(importFailure.visibleError, {
  message: 'Invalid path',
  severity: 'warning',
  detail: 'Choose a valid workspace.'
})
assert.deepEqual(importFailure.notification, {
  kind: 'workspace-import-failed',
  message: 'Invalid path'
})

assert.equal(operationFeedback({
  outcome: 'failure',
  error: 'Selected path is not a directory',
  operation: 'workspace-import',
  notifications: { ...allNotifications, errors: false },
  translate
}).notification, undefined)

assert.deepEqual(operationFeedback({
  outcome: 'workspace-imported',
  workspaceName: 'Math foundations',
  notifications: allNotifications
}).notification, {
  kind: 'workspace-imported',
  workspaceName: 'Math foundations'
})

assert.equal(operationFeedback({
  outcome: 'workspace-imported',
  workspaceName: 'Math foundations',
  notifications: { ...allNotifications, workspaceImported: false }
}).notification, undefined)

assert.deepEqual(operationFeedback({
  outcome: 'lesson-generated',
  lesson: {
    title: 'RAG Basics',
    path: 'courses/rag/001/index.html',
    source: 'fallback',
    reason: 'invalid model JSON'
  },
  notifications: allNotifications
}).notification, {
  kind: 'lesson-generated',
  title: 'RAG Basics',
  path: 'courses/rag/001/index.html',
  source: 'fallback',
  reason: 'invalid model JSON'
})

assert.deepEqual(operationFeedback({
  outcome: 'failure',
  error: 'timeout while saving',
  operation: 'lesson-generation',
  notifications: allNotifications,
  translate
}).notification, {
  kind: 'lesson-generation-failed',
  message: 'timeout while saving'
})

console.log('operation feedback contract ok')
