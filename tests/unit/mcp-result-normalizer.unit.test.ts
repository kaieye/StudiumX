import { describe, expect, it, vi } from 'vitest'

import { normalizeMcpToolResult } from '../../src/main/mcp/result-normalizer'
import type { McpArtifactWriter } from '../../src/shared/mcp/result-types'

function artifactWriter(): { writer: McpArtifactWriter; calls: Array<Readonly<{ bytes: Uint8Array }>> } {
  const calls: Array<Readonly<{ bytes: Uint8Array }>> = []
  return {
    calls,
    writer: {
      writeArtifact: vi.fn(async (input) => {
        calls.push({ bytes: input.bytes })
        return {
          id: 'mcp-artifact:sha256:0123456789abcdef',
          kind: input.kind,
          byteLength: input.bytes.byteLength,
          ...(input.mediaType ? { mediaType: input.mediaType } : {}),
          digestPrefix: '0123456789abcdef',
          summary: `MCP ${input.kind} artifact (${input.bytes.byteLength} bytes)`
        }
      })
    }
  }
}

describe('normalizeMcpToolResult (ADR-0134)', () => {
  it('preserves bounded text and structuredContent independently', async () => {
    const result = await normalizeMcpToolResult(
      {
        content: [{ type: 'text', text: 'ordinary result' }],
        structuredContent: { ok: true, details: { count: 2 } }
      },
      { limits: { maxStructuredJsonChars: 128 } }
    )

    expect(result.status).toBe('succeeded')
    expect(result.content).toEqual([{ kind: 'text', text: 'ordinary result', truncated: false }])
    expect(result.structuredContent).toEqual({
      json: '{"ok":true,"details":{"count":2}}',
      truncated: false
    })
    expect(result.modelText).toContain('ordinary result')
    expect(result.modelText).toContain('[MCP structuredContent]')
  })

  it('uses a valid bounded JSON envelope for oversized structured content', async () => {
    const result = await normalizeMcpToolResult(
      { structuredContent: { value: 'x'.repeat(5_000) } },
      { limits: { maxStructuredJsonChars: 120 } }
    )

    expect(result.structuredContent?.truncated).toBe(true)
    expect(result.structuredContent?.json.length).toBeLessThanOrEqual(120)
    expect(JSON.parse(result.structuredContent!.json)).toMatchObject({ $truncated: true })
    expect(result.truncated).toBe(true)
  })

  it('spills image base64 through the injected artifact writer and never exposes encoded bytes', async () => {
    const { writer, calls } = artifactWriter()
    const encoded = Buffer.from('image bytes that must not enter the model', 'utf8').toString('base64')
    const result = await normalizeMcpToolResult(
      { content: [{ type: 'image', mimeType: 'image/png', data: encoded }] },
      { artifactWriter: writer }
    )

    expect(calls).toHaveLength(1)
    expect(Buffer.from(calls[0]!.bytes).toString('utf8')).toBe('image bytes that must not enter the model')
    expect(result.content[0]).toMatchObject({
      kind: 'image',
      omitted: false,
      artifact: { id: 'mcp-artifact:sha256:0123456789abcdef' }
    })
    expect(result.modelText).not.toContain(encoded)
    expect(result.modelText).not.toContain('image bytes that must not enter the model')
    expect(result.spilled).toBe(true)
  })

  it('does not fetch resource links and removes URI credentials before model presentation', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    try {
      const result = await normalizeMcpToolResult({
        content: [
          {
            type: 'resource_link',
            name: 'remote notes',
            uri: 'https://alice:password@example.test/notes?access_token=top-secret&view=full',
            mimeType: 'text/plain'
          }
        ]
      })

      expect(fetch).not.toHaveBeenCalled()
      expect(result.content[0]).toMatchObject({ kind: 'resource_link', fetched: false })
      expect(result.modelText).toContain('not fetched')
      expect(result.modelText).not.toContain('alice')
      expect(result.modelText).not.toContain('password')
      expect(result.modelText).not.toContain('top-secret')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('omits oversized data URLs without passing bytes to the model or writer', async () => {
    const { writer, calls } = artifactWriter()
    const dataUrl = `data:image/png;base64,${Buffer.alloc(256, 7).toString('base64')}`
    const result = await normalizeMcpToolResult(
      { content: [{ type: 'text', text: dataUrl }] },
      { artifactWriter: writer, limits: { maxArtifactBytes: 32 } }
    )

    expect(calls).toHaveLength(0)
    expect(result.content[0]).toMatchObject({ kind: 'binary', omitted: true })
    expect(result.modelText).not.toContain(dataUrl)
    expect(result.truncated).toBe(true)
  })

  it('maps MCP application errors to the failed branch rather than textual success', async () => {
    const result = await normalizeMcpToolResult({
      isError: true,
      content: [{ type: 'text', text: 'server declined this operation' }]
    })

    expect(result).toMatchObject({
      status: 'failed',
      isError: true,
      errorCode: 'mcp_application_error',
      modelText: 'server declined this operation'
    })
  })

  it('caps model text before the generic tool-result budget and does not echo unknown payloads', async () => {
    const secret = 'BASE64_OR_SECRET_SHOULD_NOT_APPEAR'
    const result = await normalizeMcpToolResult(
      {
        content: [
          { type: 'text', text: 'a'.repeat(400) },
          { type: 'unexpected', payload: secret },
          { type: 'text', text: 'b'.repeat(400) }
        ]
      },
      { limits: { maxTextCharsPerEntry: 300, maxModelTextChars: 100 } }
    )

    expect(result.modelText.length).toBeLessThanOrEqual(100)
    expect(result.modelText).not.toContain(secret)
    expect(result.truncated).toBe(true)
  })
})
