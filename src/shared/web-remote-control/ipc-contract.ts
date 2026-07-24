/** IPC channel names for web remote control (ADR-0143). Separate from TeachingSystemApi Phase 1. */

export const webRemoteControlInvokeChannels = {
  start: 'teach:web-remote-start',
  stop: 'teach:web-remote-stop',
  resetPairing: 'teach:web-remote-reset-pairing',
  getStatus: 'teach:web-remote-get-status'
} as const

export const webRemoteControlEventChannels = {
  statusChanged: 'teach:web-remote-status-changed'
} as const
