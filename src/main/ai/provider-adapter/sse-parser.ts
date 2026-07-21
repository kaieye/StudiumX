import type { ModelEndpointFormat } from '../../../shared/teaching-types'
import type { ToolCall } from '../provider-adapter'
import { normalizeStopReason, type ProviderStopReason } from '../provider-hooks'
import { parseDsmlToolCalls, stripDsmlToolCallBlocks } from './dsml-tool-calls'
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

function extractStreamDelta(format: ModelEndpointFormat, event: unknown): { content?: string; reasoning?: string } {
  if (!event || typeof event !== 'object') return {}
  if (format === 'messages') {
    const type = (event as { type?: string }).type
    if (type === 'content_block_delta') {
      const delta = (event as { delta?: { type?: string; text?: string; thinking?: string } }).delta
      if (delta?.type === 'thinking_delta' || typeof delta?.thinking === 'string') {
        return delta.thinking ? { reasoning: delta.thinking } : {}
      }
      return delta?.text ? { content: delta.text } : {}
    }
    return {}
  }
  if (format === 'responses') {
    const type = (event as { type?: string }).type
    if (type === 'response.output_text.delta') {
      const delta = (event as { delta?: string }).delta
      return delta ? { content: delta } : {}
    }
    if (type === 'response.reasoning_summary_text.delta' ||
        type === 'response.reasoning_summary.delta' ||
        type === 'response.reasoning_text.delta') {
      const delta = (event as { delta?: string }).delta
      return delta ? { reasoning: delta } : {}
    }
    return {}
  }
  const choices = (event as { choices?: unknown }).choices
  if (Array.isArray(choices) && choices.length > 0) {
    const delta = (choices[0] as { delta?: { content?: string; reasoning_content?: string; reasoning?: string } })?.delta
    const reasoning = delta?.reasoning_content ?? delta?.reasoning
    return {
      ...(delta?.content ? { content: delta.content } : {}),
      ...(reasoning ? { reasoning } : {})
    }
  }
  return {}
}


export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken: (delta: string) => void,
  onReasoning?: (delta: string) => void
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
      const delta = extractStreamDelta(format, safeJsonParse(data))
      if (delta.reasoning) onReasoning?.(delta.reasoning)
      if (delta.content) {
        acc += delta.content
        onToken(delta.content)
      }
    }
  }
  return acc
}

function extractChatDelta(format: ModelEndpointFormat, event: unknown): {
  content?: string
  reasoning?: string
  toolCalls?: ToolCallFragment[]
  finishReason?: ProviderStopReason
} {
  if (!event || typeof event !== 'object') return {}
  if (!toolsSupportedForFormat(format)) {
    return extractStreamDelta(format, event)
  }
  const choices = (event as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return {}
  const choice = choices[0] as {
    finish_reason?: unknown
    delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: unknown }
  }
  const delta = choice?.delta
  if (!delta && (typeof choice?.finish_reason !== 'string' || !choice.finish_reason.trim())) return {}
  const out: {
    content?: string
    reasoning?: string
    toolCalls?: ToolCallFragment[]
    finishReason?: ProviderStopReason
  } = {}
  if (typeof choice.finish_reason === 'string' && choice.finish_reason.trim()) {
    out.finishReason = normalizeStopReason(choice.finish_reason)
  }
  if (!delta) return out
  if (typeof delta.content === 'string') out.content = delta.content
  const reasoning = delta.reasoning_content ?? delta.reasoning
  if (typeof reasoning === 'string') out.reasoning = reasoning
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
  toolAcc: Map<number, { index: number; id?: string; name?: string; arguments: string }>,
  finishReason?: ProviderStopReason
): { text: string; toolCalls: ToolCall[]; finishReason?: ProviderStopReason } {
  const nativeToolCalls: ToolCall[] = []
  for (const slot of toolAcc.values()) {
    if (!slot.id || !slot.name) continue
    nativeToolCalls.push({
      id: slot.id,
      type: 'function',
      function: { name: slot.name, arguments: slot.arguments || '{}' }
    })
  }
  // Match the non-stream JSON path: DSML tool markup in text deltas must be
  // parsed into structured tool calls and stripped from the visible answer.
  const dsmlToolCalls = parseDsmlToolCalls(textAcc)
  const toolCalls = [...nativeToolCalls, ...dsmlToolCalls]
  return {
    text: stripDsmlToolCallBlocks(textAcc),
    toolCalls,
    ...(finishReason ? { finishReason } : {})
  }
}

export async function readChatSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken?: (delta: string) => void,
  onReasoning?: (delta: string) => void
): Promise<{ text: string; toolCalls: ToolCall[]; finishReason?: ProviderStopReason }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let textAcc = ''
  let finishReason: ProviderStopReason | undefined
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
      if (data === '[DONE]') return assembleStream(textAcc, toolAcc, finishReason)
      if (!data) continue
      const delta = extractChatDelta(format, safeJsonParse(data))
      if (delta.reasoning) onReasoning?.(delta.reasoning)
      if (delta.content) {
        textAcc += delta.content
        onToken?.(delta.content)
      }
      if (delta.finishReason) finishReason = delta.finishReason
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
  return assembleStream(textAcc, toolAcc, finishReason)
}

