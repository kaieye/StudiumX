/**
 * App-layer payload parse (Zcode-compatible zcode_type shell).
 * Fail-closed: unknown / malformed → null.
 */

import type {
  WebRemoteControlFailureReason,
  WebRemoteControlMobileDeviceInfo,
  WebRemoteControlTaskDto,
  WebRemoteControlViewState,
  WebRemoteControlWorkspaceDto
} from './types'

export type WebRemoteControlAppPayloadType =
  | 'bootstrap-request'
  | 'bootstrap-response'
  | 'workspace-list-request'
  | 'workspace-list-response'
  | 'workspace-list-updated'
  | 'workspace-bridge-open'
  | 'workspace-bridge-ready'
  | 'workspace-bridge-error'
  | 'workspace-reconnect-request'
  | 'workspace-reconnect-response'
  | 'platform-request'
  | 'platform-response'
  | 'mobile-view-state-update'
  | 'rpc-frame'
  | 'bridge-degraded'
  | 'app-error'
  | 'mobile-diagnostic'
  | 'control-rpc-request'
  | 'control-rpc-response'

export type WebRemoteControlBootstrapResult = {
  windowControlSessionId: string
  workspaces: WebRemoteControlWorkspaceDto[]
  tasks: WebRemoteControlTaskDto[]
  initialViewState?: WebRemoteControlViewState
  mobileViewState?: WebRemoteControlViewState
}

export type WebRemoteControlWorkspaceListResult = {
  workspaces: WebRemoteControlWorkspaceDto[]
  tasks?: WebRemoteControlTaskDto[]
  activeWorkspaceKey?: string
  activeTaskId?: string
}

export type WebRemoteControlAppPayload = {
  zcode_type: WebRemoteControlAppPayloadType
  requestId?: string
  bridgeSessionId?: string
  bridgeGeneration?: number
  recoveryId?: string
  workspaceKey?: string
  taskId?: string
  success?: boolean
  result?: unknown
  bridge?: unknown
  reason?: WebRemoteControlFailureReason | string
  error?: string
  method?: string
  args?: unknown
  viewState?: WebRemoteControlViewState
  deviceInfo?: WebRemoteControlMobileDeviceInfo
  seq?: number
  expectedSeq?: number
  droppedCount?: number
  dataBase64?: string
  /** StudiumX control RPC method (Phase 2). */
  rpcMethod?: string
  rpcParams?: unknown
  event?: string
  timestamp?: number
  state?: string
  previousState?: string
  pairStatus?: 'waiting' | 'matched'
  [key: string]: unknown
}

const KNOWN_TYPES = new Set<string>([
  'bootstrap-request',
  'bootstrap-response',
  'workspace-list-request',
  'workspace-list-response',
  'workspace-list-updated',
  'workspace-bridge-open',
  'workspace-bridge-ready',
  'workspace-bridge-error',
  'workspace-reconnect-request',
  'workspace-reconnect-response',
  'platform-request',
  'platform-response',
  'mobile-view-state-update',
  'rpc-frame',
  'bridge-degraded',
  'app-error',
  'mobile-diagnostic',
  'control-rpc-request',
  'control-rpc-response'
])

export function parseWebRemoteControlAppPayload(input: unknown): WebRemoteControlAppPayload | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null
  const record = input as Record<string, unknown>
  const type = record.zcode_type
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null
  return record as WebRemoteControlAppPayload
}

export function isWebRemoteControlAppPayload(value: unknown): value is WebRemoteControlAppPayload {
  return parseWebRemoteControlAppPayload(value) !== null
}
