/** IPC channel names for web remote control (security boundary: SECURITY.md). Separate from TeachingSystemApi. */

export const webRemoteControlInvokeChannels = {
  start: 'teach:web-remote-start',
  stop: 'teach:web-remote-stop',
  resetPairing: 'teach:web-remote-reset-pairing',
  getStatus: 'teach:web-remote-get-status'
} as const

export const webRemoteControlEventChannels = {
  statusChanged: 'teach:web-remote-status-changed'
} as const
