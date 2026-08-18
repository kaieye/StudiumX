/**
 * Web remote control shared types (security boundary: SECURITY.md).
 * Public DTOs are secret-free: never include passHash / password / raw pairing secrets.
 */

export type WebRemoteControlStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'connecting'
  | 'active'
  | 'error'

export type WebRemoteControlBindMode = 'loopback' | 'lan'
export type WebRemoteControlRelayMode = 'lan' | 'external'

export type WebRemoteControlFailureReason =
  | 'session-not-found'
  | 'session-expired'
  | 'session-conflict'
  | 'workspace-closed'
  | 'desktop-disconnected'
  | 'invalid-mobile-connection'
  | 'desktop-bootstrap-timeout'
  | 'connection-recovery-timeout'
  | 'relay-unavailable'
  | 'unsupported-action'
  | 'unexpected-error'

export type WebRemoteControlFailure = {
  reason: WebRemoteControlFailureReason
  message?: string
}

/** Settings slice (passHash is secret-storage protected in main). */
export type WebRemoteControlSettings = {
  /** Product opt-in; still gated by feature stage under_development. */
  enabled: boolean
  bindMode: WebRemoteControlBindMode
  /** 0 = ephemeral free port. */
  port: number
  relayMode: WebRemoteControlRelayMode
  /** User-configured only; empty default (no Zcode cloud). */
  externalRelayWsUrl: string
  /** Mobile page base for external QR; empty default. */
  externalMobileBaseUrl: string
  /** Non-secret device session id suffix/metadata. */
  deviceSid: string
  /**
   * Pairing pass hash (Zcode-compatible base64 sha256).
   * Encrypted at rest via safeStorage when available; never expose in status DTO.
   */
  passHash: string
}

export type WebRemoteControlWorkspaceDto = {
  workspaceKey: string
  workspacePath: string
  workspaceId?: string
  label: string
  kind: 'local'
  connectionState?: 'connected' | 'disconnected' | 'reconnecting'
}

export type WebRemoteControlTaskDto = {
  taskId: string
  title: string
  workspaceKey: string
  workspacePath: string
  workspaceId?: string
  workspaceLabel: string
  workspaceKind: 'local'
  createdAt: number
  updatedAt: number
  displayStatus?: 'idle' | 'running' | 'completed' | 'error'
  pinned?: boolean
  archived?: boolean
}

export type WebRemoteControlViewState = {
  activeWorkspaceKey?: string
  activeTaskId?: string
  updatedAt?: number
}

export type WebRemoteControlMobileDeviceInfo = {
  platform?: string
  version?: string
  name?: string
  userAgent?: string
  browserPlatform?: string
  viewport?: { width: number; height: number; devicePixelRatio?: number }
  online?: boolean
  updatedAt?: number
}

/** Secret-free snapshot for desktop UI / mobile status. */
export type WebRemoteControlRuntimeStatus = {
  status: WebRemoteControlStatus
  sessionId?: string
  windowControlSessionId?: string
  mobileConnected: boolean
  mobileViewState?: WebRemoteControlViewState
  mobileDeviceInfo?: WebRemoteControlMobileDeviceInfo
  qrUrl?: string
  connectUrl?: string
  bindHost?: string
  bindPort?: number
  relayMode?: WebRemoteControlRelayMode
  workspacePath?: string
  workspaceId?: string
  initialTaskId?: string
  error?: string
  failure?: WebRemoteControlFailure
}

export type WebRemoteControlStartPayload = {
  workspacePath?: string
  workspaceId?: string
  initialTaskId?: string
  theme?: string
}

export const DEFAULT_WEB_REMOTE_CONTROL_SETTINGS: WebRemoteControlSettings = {
  enabled: false,
  bindMode: 'loopback',
  port: 0,
  relayMode: 'lan',
  externalRelayWsUrl: '',
  externalMobileBaseUrl: '',
  deviceSid: '',
  passHash: ''
}
