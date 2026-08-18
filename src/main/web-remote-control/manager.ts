/**
 * Web remote control manager (security boundary: SECURITY.md).
 * LAN server + pairing auth + secret-free status; Control RPC comes in Phase 2.
 */

import type { TeachingSettingsService } from '../teaching-settings'
import type { Logger } from '../logger'
import type { TeachingWorkspaceService } from '../teaching-workspace'
import {
  buildWebRemoteControlConnectUrl,
  createWebRemoteControlDeviceSid,
  createWebRemoteControlNonce,
  createWebRemoteControlPassHash,
  createWebRemoteControlPassword,
  parseWebRemoteControlAppPayload,
  verifyWebRemoteControlProof,
  type WebRemoteControlRuntimeStatus,
  type WebRemoteControlStartPayload,
  type WebRemoteControlStatus,
  type WebRemoteControlTaskDto,
  type WebRemoteControlWorkspaceDto
} from '../../shared/web-remote-control'
import { isFeatureEnabled } from '../../shared/features'
import { loadWebRemoteControlCatalog } from './control-surface'
import { startWebRemoteControlLanServer, type LanServerHandle } from './lan-server'

export type WebRemoteControlManager = {
  start: (windowId: number, payload?: WebRemoteControlStartPayload) => Promise<WebRemoteControlRuntimeStatus>
  stop: (windowId: number) => Promise<void>
  resetPairing: (windowId: number, payload?: WebRemoteControlStartPayload) => Promise<WebRemoteControlRuntimeStatus>
  getStatus: (windowId: number) => WebRemoteControlRuntimeStatus
  disposeWindow: (windowId: number) => Promise<void>
  disposeAll: () => Promise<void>
}

type Runtime = {
  windowId: number
  status: WebRemoteControlStatus
  deviceSid: string
  passHash: string
  mobileConnected: boolean
  qrUrl: string
  connectUrl: string
  bindHost?: string
  bindPort?: number
  error?: string
  workspacePath?: string
  workspaceId?: string
  initialTaskId?: string
  lan?: LanServerHandle
  pendingAuth: Map<string, { nonce: string; role: 'mobile' }>
  pairedClientId?: string
}

export type CreateWebRemoteControlManagerOptions = {
  settingsService: TeachingSettingsService
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  /** When set, bootstrap/workspace-list return real teaching catalog. */
  workspaceService?: TeachingWorkspaceService
  appVersion?: string
  deviceName?: string
  deviceMid?: string
  onStatusChanged?: (windowId: number, status: WebRemoteControlRuntimeStatus) => void
  /** When true, skip feature stage gate (tests). */
  forceEnable?: boolean
  allowUnderDevelopment?: boolean
}

export function createWebRemoteControlManager(
  options: CreateWebRemoteControlManagerOptions
): WebRemoteControlManager {
  const runtimes = new Map<number, Runtime>()

  const featureOn = (): boolean => {
    if (options.forceEnable) return true
    return isFeatureEnabled('web-remote-control', {
      allowUnderDevelopment: options.allowUnderDevelopment === true
    })
  }

  const emit = (runtime: Runtime): void => {
    options.onStatusChanged?.(runtime.windowId, toStatus(runtime))
  }

  const stopRuntime = async (runtime: Runtime, reason: string): Promise<void> => {
    if (runtime.pairedClientId && runtime.lan) {
      runtime.lan.send(runtime.pairedClientId, {
        zcode_type: 'app-error',
        reason: 'desktop-disconnected',
        error: 'Desktop disconnected this Web remote control session.'
      })
    }
    if (runtime.lan) {
      await runtime.lan.close()
      runtime.lan = undefined
    }
    runtime.mobileConnected = false
    runtime.pairedClientId = undefined
    runtime.pendingAuth.clear()
    runtime.status = 'idle'
    runtime.qrUrl = ''
    runtime.connectUrl = ''
    options.logger.info(`[web-remote-control] stopped window=${runtime.windowId} reason=${reason}`)
  }

  const ensureAuthMaterial = async (): Promise<{ deviceSid: string; passHash: string }> => {
    const settings = await options.settingsService.load()
    const current = settings.webRemoteControl
    if (current.deviceSid?.trim() && current.passHash?.trim()) {
      return { deviceSid: current.deviceSid.trim(), passHash: current.passHash.trim() }
    }
    const password = createWebRemoteControlPassword()
    const passHash = createWebRemoteControlPassHash(password)
    const deviceSid = createWebRemoteControlDeviceSid()
    await options.settingsService.patch({
      webRemoteControl: {
        ...current,
        deviceSid,
        passHash
      }
    })
    return { deviceSid, passHash }
  }

  const clearAuthMaterial = async (): Promise<void> => {
    const settings = await options.settingsService.load()
    await options.settingsService.patch({
      webRemoteControl: {
        ...settings.webRemoteControl,
        deviceSid: '',
        passHash: ''
      }
    })
  }

  const loadCatalog = async (): Promise<{
    workspaces: WebRemoteControlWorkspaceDto[]
    tasks: WebRemoteControlTaskDto[]
  }> => {
    if (!options.workspaceService) return { workspaces: [], tasks: [] }
    try {
      return await loadWebRemoteControlCatalog(options.workspaceService)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      options.logger.warn(`[web-remote-control] catalog load failed: ${message}`)
      return { workspaces: [], tasks: [] }
    }
  }

  const sendData = (runtime: Runtime, clientId: string, payload: unknown): void => {
    runtime.lan?.send(clientId, { type: 'data', payload, client_ts: Date.now() })
  }

  const handleClientMessage = (runtime: Runtime, clientId: string, data: unknown): void => {
    if (!data || typeof data !== 'object') return
    const msg = data as Record<string, unknown>
    const type = typeof msg.type === 'string' ? msg.type : undefined

    // Relay-shaped messages for LAN (device is server; mobile is peer).
    if (type === 'auth_init' && msg.role === 'mobile') {
      const nonce = createWebRemoteControlNonce()
      runtime.pendingAuth.set(clientId, { nonce, role: 'mobile' })
      runtime.lan?.send(clientId, { type: 'auth_challenge', nonce })
      return
    }

    if (type === 'auth_response') {
      const pending = runtime.pendingAuth.get(clientId)
      if (!pending) return
      const proof = typeof msg.proof === 'string' ? msg.proof : ''
      const deviceSid = typeof msg.device_sid === 'string' ? msg.device_sid : runtime.deviceSid
      const ok = verifyWebRemoteControlProof({
        passHash: runtime.passHash,
        nonce: pending.nonce,
        role: 'mobile',
        deviceSid,
        proof
      })
      runtime.pendingAuth.delete(clientId)
      if (!ok) {
        runtime.lan?.send(clientId, { type: 'error', code: 'AUTH_FAILED', message: 'Invalid proof' })
        return
      }
      // Kick previous pair
      if (runtime.pairedClientId && runtime.pairedClientId !== clientId) {
        runtime.lan?.send(runtime.pairedClientId, {
          type: 'error',
          code: 'KICKED',
          message: 'session-conflict'
        })
      }
      runtime.pairedClientId = clientId
      runtime.mobileConnected = true
      runtime.status = 'active'
      runtime.lan?.send(clientId, { type: 'auth_ack', pair_status: 'matched' })
      emit(runtime)
      return
    }

    if (type === 'pair_status_query') {
      const pair_status = runtime.pairedClientId === clientId ? 'matched' : 'waiting'
      runtime.lan?.send(clientId, { type: 'pair_status_ack', pair_status })
      return
    }

    if (type === 'data') {
      if (runtime.pairedClientId !== clientId) return
      const payload = parseWebRemoteControlAppPayload(msg.payload)
      if (!payload) return

      if (payload.zcode_type === 'bootstrap-request') {
        void loadCatalog().then((catalog) => {
          sendData(runtime, clientId, {
            zcode_type: 'bootstrap-response',
            requestId: payload.requestId,
            success: true,
            result: {
              windowControlSessionId: runtime.deviceSid,
              workspaces: catalog.workspaces,
              tasks: catalog.tasks,
              initialViewState: runtime.workspaceId
                ? {
                    activeWorkspaceKey: runtime.workspaceId,
                    activeTaskId: runtime.initialTaskId,
                    updatedAt: Date.now()
                  }
                : undefined
            }
          })
        })
        return
      }

      if (payload.zcode_type === 'workspace-list-request') {
        void loadCatalog().then((catalog) => {
          sendData(runtime, clientId, {
            zcode_type: 'workspace-list-response',
            requestId: payload.requestId,
            success: true,
            result: {
              workspaces: catalog.workspaces,
              tasks: catalog.tasks,
              activeWorkspaceKey: runtime.workspaceId,
              activeTaskId: runtime.initialTaskId
            }
          })
        })
        return
      }

      if (payload.zcode_type === 'mobile-view-state-update') {
        // Acknowledge silently; desktop status can surface later.
        return
      }

      if (payload.zcode_type === 'mobile-diagnostic') {
        options.logger.info(
          `[web-remote-control] mobile diagnostic event=${String(payload.event ?? '')} state=${String(payload.state ?? '')}`
        )
        return
      }

      // Unsupported app actions — fail closed with clear reason (no shell/platform surface).
      if (
        payload.zcode_type === 'workspace-bridge-open' ||
        payload.zcode_type === 'platform-request' ||
        payload.zcode_type === 'control-rpc-request'
      ) {
        sendData(runtime, clientId, {
          zcode_type: 'app-error',
          requestId: payload.requestId,
          reason: 'unsupported-action',
          error: 'This remote action is not available yet on StudiumX.'
        })
      }
    }
  }

  return {
    async start(windowId, payload = {}) {
      if (!featureOn()) {
        return {
          status: 'error',
          mobileConnected: false,
          failure: {
            reason: 'unsupported-action',
            message: 'Web remote control is under_development; enable allowUnderDevelopment or wait for experimental stage.'
          },
          error: 'Feature disabled'
        }
      }

      const settings = await options.settingsService.load()
      if (!settings.webRemoteControl.enabled && !options.forceEnable) {
        return {
          status: 'error',
          mobileConnected: false,
          failure: { reason: 'unsupported-action', message: 'Enable webRemoteControl in settings first.' },
          error: 'Not enabled in settings'
        }
      }

      const existing = runtimes.get(windowId)
      if (existing) await stopRuntime(existing, 'restart')

      const runtime: Runtime = {
        windowId,
        status: 'starting',
        deviceSid: '',
        passHash: '',
        mobileConnected: false,
        qrUrl: '',
        connectUrl: '',
        workspacePath: payload.workspacePath,
        workspaceId: payload.workspaceId,
        initialTaskId: payload.initialTaskId,
        pendingAuth: new Map()
      }
      runtimes.set(windowId, runtime)
      emit(runtime)

      try {
        const auth = await ensureAuthMaterial()
        runtime.deviceSid = auth.deviceSid
        runtime.passHash = auth.passHash

        const bindMode = settings.webRemoteControl.bindMode === 'lan' ? 'lan' : 'loopback'
        const lan = await startWebRemoteControlLanServer({
          bindMode,
          port: settings.webRemoteControl.port || 0,
          onMessage: (clientId, data) => handleClientMessage(runtime, clientId, data),
          onClientClose: (clientId) => {
            if (runtime.pairedClientId === clientId) {
              runtime.pairedClientId = undefined
              runtime.mobileConnected = false
              runtime.status = 'running'
              emit(runtime)
            }
          },
          logger: {
            info: (message, ...rest) => {
              options.logger.info(message)
              if (rest.length) options.logger.info(String(rest[0]))
            },
            warn: (message, ...rest) => {
              options.logger.warn(message)
              if (rest.length) options.logger.warn(String(rest[0]))
            }
          }
        })
        runtime.lan = lan
        runtime.bindHost = lan.host
        runtime.bindPort = lan.port

        const connectUrl = buildWebRemoteControlConnectUrl({
          baseUrl: lan.baseUrl,
          deviceSid: runtime.deviceSid,
          passHash: runtime.passHash,
          deviceMid: options.deviceMid,
          deviceName: options.deviceName ?? 'StudiumX',
          appVersion: options.appVersion
        })
        runtime.connectUrl = connectUrl
        runtime.qrUrl = connectUrl
        runtime.status = 'running'
        emit(runtime)
        options.logger.info(
          `[web-remote-control] start window=${windowId} bind=${lan.host}:${lan.port} mode=${bindMode}`
        )
        return toStatus(runtime)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        runtime.status = 'error'
        runtime.error = message
        emit(runtime)
        return toStatus(runtime)
      }
    },

    async stop(windowId) {
      const runtime = runtimes.get(windowId)
      if (!runtime) return
      await stopRuntime(runtime, 'manual-stop')
      runtimes.delete(windowId)
      options.onStatusChanged?.(windowId, { status: 'idle', mobileConnected: false })
    },

    async resetPairing(windowId, payload) {
      await this.stop(windowId)
      await clearAuthMaterial()
      return this.start(windowId, payload)
    },

    getStatus(windowId) {
      const runtime = runtimes.get(windowId)
      if (!runtime) return { status: 'idle', mobileConnected: false }
      return toStatus(runtime)
    },

    async disposeWindow(windowId) {
      await this.stop(windowId)
    },

    async disposeAll() {
      for (const id of [...runtimes.keys()]) {
        await this.stop(id)
      }
    }
  }
}

function toStatus(runtime: Runtime): WebRemoteControlRuntimeStatus {
  return {
    status: runtime.status,
    sessionId: runtime.deviceSid || undefined,
    windowControlSessionId: runtime.deviceSid || undefined,
    mobileConnected: runtime.mobileConnected,
    qrUrl: runtime.qrUrl || undefined,
    connectUrl: runtime.connectUrl || undefined,
    bindHost: runtime.bindHost,
    bindPort: runtime.bindPort,
    relayMode: 'lan',
    workspacePath: runtime.workspacePath,
    workspaceId: runtime.workspaceId,
    initialTaskId: runtime.initialTaskId,
    error: runtime.error
  }
}
