import { classifyProviderError } from '../../../shared/provider-error'

export type OperationFeedbackSeverity = 'error' | 'warning' | 'info'

export type OperationFeedbackError = {
  message: string
  severity: OperationFeedbackSeverity
  detail?: string
}

export type OperationFeedbackTranslator = (
  key: string,
  interpolation?: Record<string, unknown>
) => string

export type OperationFeedbackNotificationSettings = {
  enabled: boolean
  errors: boolean
  lessonGenerated: boolean
  workspaceImported: boolean
}

export type OperationNotificationIntent =
  | {
      kind: 'workspace-imported'
      workspaceName: string
    }
  | {
      kind: 'workspace-import-failed'
      message: string
    }
  | {
      kind: 'lesson-generated'
      title: string
      path: string
      source: 'ai' | 'fallback'
      reason?: string
    }
  | {
      kind: 'lesson-generation-failed'
      message: string
    }

export type OperationFeedback = {
  visibleError?: OperationFeedbackError
  notification?: OperationNotificationIntent
}

type OperationFeedbackFailure = {
  outcome: 'failure'
  error: unknown
  operation?: 'workspace-import' | 'lesson-generation'
  notifications?: OperationFeedbackNotificationSettings
  translate: OperationFeedbackTranslator
}

type OperationFeedbackWorkspaceImported = {
  outcome: 'workspace-imported'
  workspaceName: string
  notifications: OperationFeedbackNotificationSettings
}

type OperationFeedbackLessonGenerated = {
  outcome: 'lesson-generated'
  lesson: {
    title: string
    path: string
    source?: 'ai' | 'fallback'
    reason?: string
  }
  notifications: OperationFeedbackNotificationSettings
}

export type OperationFeedbackInput =
  | OperationFeedbackFailure
  | OperationFeedbackWorkspaceImported
  | OperationFeedbackLessonGenerated

/**
 * Classifies a learner-visible operation outcome and, when preferences allow it,
 * declares the notification that the caller should deliver. Callers retain their
 * own state transitions and notification transport.
 */
export function operationFeedback(input: OperationFeedbackInput): OperationFeedback {
  if (input.outcome === 'workspace-imported') {
    return notificationEnabled(input.notifications, 'workspaceImported')
      ? { notification: { kind: 'workspace-imported', workspaceName: input.workspaceName } }
      : {}
  }

  if (input.outcome === 'lesson-generated') {
    return notificationEnabled(input.notifications, 'lessonGenerated')
      ? {
          notification: {
            kind: 'lesson-generated',
            title: input.lesson.title,
            path: input.lesson.path,
            source: input.lesson.source ?? 'ai',
            reason: input.lesson.reason
          }
        }
      : {}
  }

  const visibleError = classifyVisibleError(input.error, input.translate)
  const notification = failureNotification(input.operation, visibleError, input.notifications)
  return { visibleError, ...(notification ? { notification } : {}) }
}

function notificationEnabled(
  settings: OperationFeedbackNotificationSettings,
  preference: 'lessonGenerated' | 'workspaceImported'
): boolean {
  return settings.enabled && settings[preference]
}

function failureNotification(
  operation: OperationFeedbackFailure['operation'],
  visibleError: OperationFeedbackError,
  settings: OperationFeedbackNotificationSettings | undefined
): OperationNotificationIntent | undefined {
  if (!settings?.enabled || !settings.errors) return undefined
  if (operation === 'workspace-import') {
    return { kind: 'workspace-import-failed', message: visibleError.message }
  }
  if (operation === 'lesson-generation') {
    return { kind: 'lesson-generation-failed', message: visibleError.message }
  }
  return undefined
}

function classifyVisibleError(error: unknown, translate: OperationFeedbackTranslator): OperationFeedbackError {
  const raw = error instanceof Error ? error.message : String(error)

  // ADR-0004: branch CAS details are an implementation concern. Keep the learner
  // on a safe refresh path without exposing expected/current revisions.
  if (raw.toLowerCase().includes('conversation branch revision conflict')) {
    return {
      message: '对话已在其他位置更新，请刷新后再继续。',
      severity: 'warning',
      detail: '已保留你的输入，应用不会自动重放这次操作。'
    }
  }
  if (
    raw.includes('generate_lesson 尚未执行') ||
    raw.includes('本轮没有成功执行 generate_lesson') ||
    (raw.includes('操作次数已达到上限') && raw.includes('课程尚未生成'))
  ) {
    return {
      message: translate('errors.agentToolLimit.message'),
      severity: 'warning',
      detail: translate('errors.agentToolLimit.detail')
    }
  }

  if (raw.includes('No handler registered for')) {
    return {
      message: translate('errors.ipcHandlerMissing.message'),
      severity: 'warning',
      detail: translate('errors.ipcHandlerMissing.detail')
    }
  }

  if (raw.includes('未配置 API Key') || raw.includes('No API key') || raw.includes('API Key is required')) {
    return {
      message: translate('errors.noApiKey.message'),
      severity: 'warning',
      detail: translate('errors.noApiKey.detail')
    }
  }

  const providerError = classifyProviderError(raw)
  if (providerError) {
    const suffix = providerError.providerMessage ? ` ${providerError.providerMessage}` : ''
    if (providerError.kind === 'insufficient_balance') {
      return {
        message: translate('errors.providerInsufficientBalance.message'),
        severity: 'warning',
        detail: `${translate('errors.providerInsufficientBalance.detail')}${suffix}`
      }
    }
    if (providerError.kind === 'authentication') {
      return {
        message: translate('errors.providerAuth.message'),
        severity: 'warning',
        detail: `${translate('errors.providerAuth.detail')}${suffix}`
      }
    }
    if (providerError.kind === 'rate_limit') {
      return {
        message: translate('errors.providerRateLimit.message'),
        severity: 'warning',
        detail: `${translate('errors.providerRateLimit.detail')}${suffix}`
      }
    }
    return {
      message: translate('errors.providerHttp.message'),
      severity: 'warning',
      detail: `${translate('errors.providerHttp.detail', { status: providerError.status ?? '-' })}${suffix}`
    }
  }

  if (raw.includes('IPC payload field')) {
    const field = raw.match(/"([^"]+)"/)?.[1] ?? translate('errors.missingField.fallbackField')
    return {
      message: translate('errors.missingField.message'),
      severity: 'warning',
      detail: translate('errors.missingField.detail', { field })
    }
  }

  if (raw.includes('IPC payload must be an object')) {
    return {
      message: translate('errors.badPayload.message'),
      severity: 'warning',
      detail: translate('errors.badPayload.detail')
    }
  }

  if (raw.includes('Unsupported window control action')) {
    return {
      message: translate('errors.windowControl.message'),
      severity: 'info',
      detail: translate('errors.windowControl.detail')
    }
  }

  if (raw.includes('Workspace not found')) {
    return {
      message: translate('errors.workspaceNotFound.message'),
      severity: 'warning',
      detail: translate('errors.workspaceNotFound.detail')
    }
  }

  if (raw.includes('not a directory') || raw.includes('Selected path')) {
    return {
      message: translate('errors.invalidPath.message'),
      severity: 'warning',
      detail: translate('errors.invalidPath.detail')
    }
  }

  if (raw.includes('Mission prompt is required')) {
    return {
      message: translate('errors.emptyMission.message'),
      severity: 'info',
      detail: translate('errors.emptyMission.detail')
    }
  }

  if (raw.includes('Lesson prompt is required')) {
    return {
      message: translate('errors.emptyTask.message'),
      severity: 'info',
      detail: translate('errors.emptyTask.detail')
    }
  }

  if (raw.includes('outside the workspace lessons directory') || raw.includes('Path is outside')) {
    return {
      message: translate('errors.pathRestricted.message'),
      severity: 'warning',
      detail: translate('errors.pathRestricted.detail')
    }
  }

  // ADR-0012: platform capability degrade is not a provider / empty-stream error.
  if (
    raw.includes('Descriptor-relative contained directory access is unavailable') ||
    raw.includes('direct-path memory write') ||
    raw.includes('Teaching-memory direct-path') ||
    raw.includes('platform capability') ||
    raw.includes('windows_direct_path_non_cas') ||
    raw.includes('pathname_default') ||
    raw.includes('write_unavailable')
  ) {
    return {
      message: translate('errors.platformCapabilityDegraded.message'),
      severity: 'warning',
      detail: translate('errors.platformCapabilityDegraded.detail')
    }
  }

  if (
    raw.toLowerCase().includes('empty stream') ||
    raw.toLowerCase().includes('empty_stream') ||
    raw.includes('EmptyStream')
  ) {
    return {
      message: translate('errors.emptyStream.message'),
      severity: 'warning',
      detail: translate('errors.emptyStream.detail')
    }
  }

  if (raw.includes('ENOENT') || raw.includes('no such file')) {
    return {
      message: translate('errors.fileNotFound.message'),
      severity: 'warning',
      detail: translate('errors.fileNotFound.detail')
    }
  }

  if (raw.includes('EACCES') || raw.includes('permission denied')) {
    return {
      message: translate('errors.accessDenied.message'),
      severity: 'error',
      detail: translate('errors.accessDenied.detail')
    }
  }

  if (raw.includes('Error:') || raw.includes('TypeError:') || raw.includes('at ')) {
    return {
      message: translate('errors.generic.message'),
      severity: 'error',
      detail: translate('errors.generic.stackDetail')
    }
  }

  return {
    message: raw || translate('errors.generic.message'),
    severity: 'error',
    detail: translate('errors.generic.detail')
  }
}
