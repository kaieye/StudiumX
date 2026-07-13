import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { ProxyAgent } from 'proxy-agent'

/** Internal adapter that sends HTTP(S) requests through a configured proxy. */
export async function fetchThroughProxy(
  input: string | URL,
  init: RequestInit | undefined,
  proxyUrl: string
): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported proxied request protocol: ${url.protocol}`)
  }
  if (request.signal.aborted) throw abortReason(request.signal)

  const body = await requestBodyToBuffer(request)
  if (request.signal.aborted) throw abortReason(request.signal)

  const headers = headersToRecord(request.headers)
  if (body !== null && !headers['content-length']) {
    headers['content-length'] = String(body.byteLength)
  }

  return requestThroughProxy({ url, method: request.method, headers, body, signal: request.signal, proxyUrl })
}

type ProxiedRequest = {
  url: URL
  method: string
  headers: Record<string, string>
  body: Buffer | null
  signal: AbortSignal
  proxyUrl: string
}

function requestThroughProxy({ url, method, headers, body, signal, proxyUrl }: ProxiedRequest): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const agent = new ProxyAgent({ getProxyForUrl: () => proxyUrl })
    let settled = false
    let responseStarted = false
    let activeResponse: IncomingMessage | undefined

    const cleanup = (): void => {
      signal.removeEventListener('abort', abort)
    }
    const rejectOnce = (error: unknown): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = (): void => {
      const error = abortError(signal)
      activeResponse?.destroy(error)
      request.destroy(error)
      rejectOnce(abortReason(signal))
    }
    const onResponse = (response: IncomingMessage): void => {
      responseStarted = true
      activeResponse = response
      try {
        const webResponse = responseFromIncomingMessage(response)
        settled = true
        resolve(webResponse)
        response.once('end', cleanup)
        response.once('close', cleanup)
        response.once('error', cleanup)
      } catch (error) {
        rejectOnce(error)
      }
    }
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method, headers, agent }, onResponse)

    request.once('error', (error) => {
      if (!responseStarted) rejectOnce(error)
    })

    if (signal.aborted) {
      abort()
      return
    }

    signal.addEventListener('abort', abort, { once: true })
    if (body !== null) request.write(body)
    request.end()
  })
}

async function requestBodyToBuffer(request: Request): Promise<Buffer | null> {
  if (request.body === null) return null
  return Buffer.from(await request.arrayBuffer())
}

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

function responseFromIncomingMessage(response: IncomingMessage): Response {
  const status = response.statusCode
  if (status === undefined || status < 200 || status > 599) {
    throw new Error(`Invalid proxied response status: ${status ?? 'missing'}`)
  }

  const headers = new Headers()
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index]
    const value = response.rawHeaders[index + 1]
    if (name !== undefined && value !== undefined) headers.append(name, value)
  }

  const body = responseHasNullBody(status) ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>)
  return new Response(body, { status, statusText: response.statusMessage ?? '', headers })
}

function responseHasNullBody(status: number): boolean {
  return status === 204 || status === 205 || status === 304
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason !== undefined ? signal.reason : abortError(signal)
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}