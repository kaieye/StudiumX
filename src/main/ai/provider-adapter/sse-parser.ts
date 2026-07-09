import type { ModelEndpointFormat } from '../../../shared/teaching-types'
import type { ToolCall } from '../provider-adapter'
import { toolsSupportedForFormat } from './formats'

type ToolCallFragment = {
  index: number
  id?: string
  name?: string
  arguments?: string
}

function safeJsonParse(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

function extractDelta(format: ModelEndpointFormat, event: unknown): string {
  if (!event || typeof event !== 'object') return ''
  if (format === 'messages') {
    const type = (event as { type?: string }).type
    if (type === 'content_block_delta') {
      const delta = (event as { delta?: { text?: string } }).delta
      return delta?.text ?? ''
    }
    return ''
  }
  if (format === 'responses') {
    const type = (event as { type?: string }).type
    if (type === 'response.output_text.delta') {
      return (event as { delta?: string }).delta ?? ''
    }
    return ''
  }
  const choices = (event as { choices?: unknown }).choices
  if (Array.isArray(choices) && choices.length > 0) {
    const delta = (choices[0] as { delta?: { content?: string } })?.delta
    return delta?.content ?? ''
  }
  return ''
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken: (delta: string) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let acc = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return acc
      if (!data) continue
      const delta = extractDelta(format, safeJsonParse(data))
      if (delta) {
        acc += delta
        onToken(delta)
      }
    }
  }
  return acc
}

function extractChatDelta(format: ModelEndpointFormat, event: unknown): {
  content?: string
  toolCalls?: ToolCallFragment[]
} {
  if (!event || typeof event !== 'object') return {}
  if (!toolsSupportedForFormat(format)) {
    const content = extractDelta(format, event)
    return content ? { content } : {}
  }
  const choices = (event as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return {}
  const delta = (choices[0] as { delta?: { content?: string; tool_calls?: unknown } })?.delta
  if (!delta) return {}
  const out: { content?: string; toolCalls?: ToolCallFragment[] } = {}
  if (typeof delta.content === 'string') out.content = delta.content
  if (Array.isArray(delta.tool_calls)) {
    out.toolCalls = delta.tool_calls.map((f) => {
      const fn = (f as { function?: { name?: string; arguments?: string } }).function ?? {}
      return {
        index: typeof (f as { index?: number }).index === 'number' ? (f as { index: number }).index : 0,
        id: (f as { id?: string }).id,
        name: fn.name,
        arguments: fn.arguments
      }
    })
  }
  return out
}

function assembleStream(
  textAcc: string,
  toolAcc: Map<number, { index: number; id?: string; name?: string; arguments: string }>
): { text: string; toolCalls: ToolCall[] } {
  const toolCalls: ToolCall[] = []
  for (const slot of toolAcc.values()) {
    if (!slot.id || !slot.name) continue
    toolCalls.push({
      id: slot.id,
      type: 'function',
      function: { name: slot.name, arguments: slot.arguments || '{}' }
    })
  }
  return { text: textAcc, toolCalls }
}

export async function readChatSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken?: (delta: string) => void
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let textAcc = ''
  const toolAcc = new Map<number, { index: number; id?: string; name?: string; arguments: string }>()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') return assembleStream(textAcc, toolAcc)
      if (!data) continue
      const delta = extractChatDelta(format, safeJsonParse(data))
      if (delta.content) {
        textAcc += delta.content
        onToken?.(delta.content)
      }
      if (delta.toolCalls) {
        for (const f of delta.toolCalls) {
          const slot = toolAcc.get(f.index) ?? { index: f.index, arguments: '' }
          if (f.id) slot.id = f.id
          if (f.name) slot.name = f.name
          if (typeof f.arguments === 'string') slot.arguments += f.arguments
          toolAcc.set(f.index, slot)
        }
      }
    }
  }
  return assembleStream(textAcc, toolAcc)
}
