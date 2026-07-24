/**
 * Minimal LAN HTTP + WebSocket server for web remote control pairing (ADR-0143).
 * Uses Node http + optional `ws` package when available; falls back to upgrade-only
 * handshake for tests when `ws` is not installed (pair messages still over WS API inject).
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { AddressInfo } from 'node:net'
import type { WebRemoteControlBindMode } from '../../shared/web-remote-control'
import { buildWebRemoteControlMobileShellHtml } from './mobile-shell-html'

export type LanServerMessageHandler = (clientId: string, data: unknown) => void

export type LanServerOptions = {
  bindMode: WebRemoteControlBindMode
  port: number
  /** Static HTML for mobile shell (Phase 2 replaces). */
  indexHtml?: string
  onMessage: LanServerMessageHandler
  onClientClose?: (clientId: string) => void
  logger?: { info: (message: string, ...rest: unknown[]) => void; warn: (message: string, ...rest: unknown[]) => void }
}

export type LanServerHandle = {
  host: string
  port: number
  baseUrl: string
  wsUrl: string
  broadcast: (data: unknown) => void
  send: (clientId: string, data: unknown) => boolean
  close: () => Promise<void>
  clientCount: () => number
}

type WsLikeSocket = {
  readyState: number
  send: (data: string) => void
  close: () => void
  on: (event: string, cb: (...args: any[]) => void) => void
}

const OPEN = 1

export async function startWebRemoteControlLanServer(options: LanServerOptions): Promise<LanServerHandle> {
  const host = options.bindMode === 'lan' ? '0.0.0.0' : '127.0.0.1'
  const indexHtml = options.indexHtml ?? buildWebRemoteControlMobileShellHtml()
  const clients = new Map<string, WsLikeSocket>()
  let clientSeq = 0

  const httpServer: HttpServer = createServer((req, res) => {
    handleHttp(req, res, indexHtml)
  })

  const WsServerCtor = await loadWsServer()
  let wss: { handleUpgrade: Function; on: Function; clients?: Set<unknown>; close: Function } | null = null

  if (WsServerCtor) {
    wss = new WsServerCtor({ noServer: true })
    httpServer.on('upgrade', (request, socket, head) => {
      const url = request.url ?? ''
      if (!url.startsWith('/ws')) {
        socket.destroy()
        return
      }
      wss!.handleUpgrade(request, socket, head, (ws: WsLikeSocket) => {
        const id = `c${++clientSeq}`
        clients.set(id, ws)
        options.logger?.info('[web-remote-control] lan client connected', id)
        ws.on('message', (raw: Buffer | string) => {
          let parsed: unknown
          try {
            parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
          } catch {
            options.logger?.warn('[web-remote-control] invalid json from client', id)
            return
          }
          options.onMessage(id, parsed)
        })
        ws.on('close', () => {
          clients.delete(id)
          options.onClientClose?.(id)
        })
      })
    })
  } else {
    options.logger?.warn(
      '[web-remote-control] package "ws" not installed; LAN /ws upgrade disabled. pnpm add ws'
    )
  }

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port, host, () => resolve())
  })

  const address = httpServer.address() as AddressInfo
  const port = address.port
  const advertiseHost =
    options.bindMode === 'lan' ? pickLanIPv4() ?? '127.0.0.1' : '127.0.0.1'
  const baseUrl = `http://${advertiseHost}:${port}/`
  const wsUrl = `ws://${advertiseHost}:${port}/ws`

  return {
    host: advertiseHost,
    port,
    baseUrl,
    wsUrl,
    broadcast(data) {
      const payload = JSON.stringify(data)
      for (const socket of clients.values()) {
        if (socket.readyState === OPEN) socket.send(payload)
      }
    },
    send(clientId, data) {
      const socket = clients.get(clientId)
      if (!socket || socket.readyState !== OPEN) return false
      socket.send(JSON.stringify(data))
      return true
    },
    clientCount: () => clients.size,
    async close() {
      for (const socket of clients.values()) {
        try {
          socket.close()
        } catch {
          /* ignore */
        }
      }
      clients.clear()
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    }
  }
}

function handleHttp(req: IncomingMessage, res: ServerResponse, indexHtml: string): void {
  const url = req.url ?? '/'
  if (url.startsWith('/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, service: 'studiumx-web-remote-control' }))
    return
  }
  if (url === '/' || url.startsWith('/?') || url.startsWith('/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(indexHtml)
    return
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}

function pickLanIPv4(): string | null {
  const nets = networkInterfaces()
  for (const entries of Object.values(nets)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return null
}

async function loadWsServer(): Promise<(new (opts: { noServer: boolean }) => any) | null> {
  try {
    const mod = await import('ws')
    return (
      (mod as { WebSocketServer?: new (opts: { noServer: boolean }) => any }).WebSocketServer ??
      (mod as { default?: { Server?: new (opts: { noServer: boolean }) => any } }).default?.Server ??
      null
    )
  } catch {
    return null
  }
}
