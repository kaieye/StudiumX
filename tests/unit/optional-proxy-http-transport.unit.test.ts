import { once } from 'node:events'
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { fetchWithOptionalProxy } from '../../src/main/proxy-fetch'

type CapturedRequest = {
  method: string
  headers: IncomingMessage['headers']
  body: string
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('optional-proxy HTTP transport', () => {
  it('uses native fetch when the configured proxy is blank', async () => {
    const targetRequests: CapturedRequest[] = []
    const targetUrl = await listen(
      createServer(async (request, response) => {
        targetRequests.push(await captureRequest(request))
        response.end('direct response')
      })
    )
    let proxyRequests = 0
    await listen(
      createServer((_request, response) => {
        proxyRequests += 1
        response.statusCode = 502
        response.end('proxy should not be selected')
      })
    )

    const response = await fetchWithOptionalProxy(
      targetUrl,
      {
        method: 'POST',
        headers: new Headers([['X-Transport-Mode', 'direct']]),
        body: new URLSearchParams({ course: 'math', session: '14' })
      },
      '   '
    )

    expect(await response.text()).toBe('direct response')
    expect(proxyRequests).toBe(0)
    expect(targetRequests).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: 'course=math&session=14',
        headers: expect.objectContaining({
          'x-transport-mode': 'direct',
          'content-type': expect.stringMatching(/^application\/x-www-form-urlencoded/)
        })
      })
    ])
  })

  it('forwards normalized request data through the proxy and reconstructs the upstream response', async () => {
    const targetRequests: CapturedRequest[] = []
    const targetUrl = await listen(
      createServer(async (request, response) => {
        targetRequests.push(await captureRequest(request))
        response.statusCode = 201
        response.statusMessage = 'Created by fixture'
        response.setHeader('x-transport-response', 'reconstructed')
        response.setHeader('set-cookie', ['first=1; Path=/', 'second=2; Path=/'])
        response.end('proxied response body')
      })
    )
    let proxyRequests = 0
    const proxyUrl = await listen(
      createForwardingProxy(() => {
        proxyRequests += 1
      })
    )

    const response = await fetchWithOptionalProxy(
      targetUrl,
      {
        method: 'POST',
        headers: new Headers([['X-Transport-Mode', 'proxied']]),
        body: new URLSearchParams({ course: 'math', session: '14' })
      },
      proxyUrl
    )

    expect(proxyRequests).toBe(1)
    expect(targetRequests).toEqual([
      expect.objectContaining({
        method: 'POST',
        body: 'course=math&session=14',
        headers: expect.objectContaining({
          'x-transport-mode': 'proxied',
          'content-type': expect.stringMatching(/^application\/x-www-form-urlencoded/),
          'content-length': String(Buffer.byteLength('course=math&session=14'))
        })
      })
    ])
    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created by fixture')
    expect(response.headers.get('x-transport-response')).toBe('reconstructed')
    expect(response.headers.getSetCookie()).toEqual(['first=1; Path=/', 'second=2; Path=/'])
    expect(await response.text()).toBe('proxied response body')
  })

  it('reconstructs a proxied null-body response without creating an invalid Response', async () => {
    const proxyUrl = await listen(
      createServer((request, response) => {
        request.resume()
        response.writeHead(204, { 'x-transport-response': 'empty' })
        response.end()
      })
    )

    const response = await fetchWithOptionalProxy('http://fixture.invalid/empty', undefined, proxyUrl)

    expect(response.status).toBe(204)
    expect(response.headers.get('x-transport-response')).toBe('empty')
    await expect(response.text()).resolves.toBe('')
  })
  it('cancels a proxied response body when its signal aborts after headers', async () => {
    let resolveResponding!: () => void
    const responding = new Promise<void>((resolve) => {
      resolveResponding = resolve
    })
    const proxyUrl = await listen(
      createServer((request, response) => {
        request.resume()
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.write('partial response')
        resolveResponding()
      })
    )
    const controller = new AbortController()

    const response = await fetchWithOptionalProxy('http://fixture.invalid/stream', { signal: controller.signal }, proxyUrl)
    await responding
    controller.abort('stop response body')

    await expect(response.text()).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects aborted proxied requests without opening a request for an already-aborted signal', async () => {
    let resolveReceived!: () => void
    const received = new Promise<void>((resolve) => {
      resolveReceived = resolve
    })
    let proxyRequests = 0
    const proxyUrl = await listen(
      createServer((request) => {
        proxyRequests += 1
        resolveReceived()
        request.resume()
      })
    )
    const controller = new AbortController()

    const pending = fetchWithOptionalProxy('http://fixture.invalid/slow', { signal: controller.signal }, proxyUrl)
    await received
    controller.abort('stop transport')

    await expect(pending).rejects.toBe('stop transport')

    const preAborted = new AbortController()
    preAborted.abort('do not send')
    await expect(
      fetchWithOptionalProxy('http://fixture.invalid/not-sent', { signal: preAborted.signal }, proxyUrl)
    ).rejects.toBe('do not send')
    expect(proxyRequests).toBe(1)
  })
})

function createForwardingProxy(onRequest: () => void): Server {
  return createServer((request, response) => {
    onRequest()
    const target = new URL(request.url ?? '')
    const upstream = httpRequest(
      target,
      { method: request.method, headers: request.headers },
      (upstreamResponse) => forwardResponse(upstreamResponse, response)
    )
    request.once('aborted', () => upstream.destroy())
    request.once('error', (error) => upstream.destroy(error))
    upstream.once('error', () => {
      if (!response.headersSent) response.writeHead(502)
      response.end()
    })
    request.pipe(upstream)
  })
}

function forwardResponse(upstream: IncomingMessage, response: ServerResponse): void {
  response.writeHead(upstream.statusCode ?? 502, upstream.statusMessage, upstream.headers)
  upstream.pipe(response)
}

async function captureRequest(request: IncomingMessage): Promise<CapturedRequest> {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
  await once(request, 'end')
  return {
    method: request.method ?? 'GET',
    headers: request.headers,
    body: Buffer.concat(chunks).toString('utf8')
  }
}

async function listen(server: Server): Promise<string> {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}