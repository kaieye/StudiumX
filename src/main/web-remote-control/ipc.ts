import { BrowserWindow, ipcMain } from 'electron'
import {
  webRemoteControlEventChannels,
  webRemoteControlInvokeChannels
} from '../../shared/web-remote-control/ipc-contract'
import type {
  WebRemoteControlRuntimeStatus,
  WebRemoteControlStartPayload
} from '../../shared/web-remote-control'
import type { WebRemoteControlManager } from './manager'

function windowIdFromEvent(event: Electron.IpcMainInvokeEvent): number {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed()) throw new Error('No BrowserWindow for web remote control')
  return win.id
}

export function registerWebRemoteControlIpc(manager: WebRemoteControlManager): void {
  for (const channel of Object.values(webRemoteControlInvokeChannels)) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle(
    webRemoteControlInvokeChannels.start,
    async (event, payload?: WebRemoteControlStartPayload) =>
      manager.start(windowIdFromEvent(event), payload ?? {})
  )

  ipcMain.handle(webRemoteControlInvokeChannels.stop, async (event) => {
    await manager.stop(windowIdFromEvent(event))
  })

  ipcMain.handle(
    webRemoteControlInvokeChannels.resetPairing,
    async (event, payload?: WebRemoteControlStartPayload) =>
      manager.resetPairing(windowIdFromEvent(event), payload ?? {})
  )

  ipcMain.handle(webRemoteControlInvokeChannels.getStatus, async (event) =>
    manager.getStatus(windowIdFromEvent(event))
  )
}

export function sendWebRemoteControlStatusChanged(
  windowId: number,
  status: WebRemoteControlRuntimeStatus
): void {
  const win = BrowserWindow.fromId(windowId)
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(webRemoteControlEventChannels.statusChanged, status)
}
