import type { ModelEndpointFormat } from '../../../shared/teaching-types'
import type { ToolCall } from '../provider-adapter'
import { normalizeStopReason, type ProviderStopReason } from '../provider-hooks'
import { parseDsmlToolCalls, stripDsmlToolCallBlocks } from './dsml-tool-calls'
import { toolsSupportedForFormat } from './formats'
import { extractUsage, type ProviderUsage } from './response-parser'

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

function normalizeStreamText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const joined = value
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const record = part as { text?: unknown; content?: unknown }
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
        return ''
      })
      .join('')
    return joined
  }
  return undefined
}

/** Shared content/reasoning extraction from OpenAI-compatible delta objects. */
function textAndReasoningFromOpenAiDelta(delta: {
  content?: unknown
  text?: unknown
  reasoning_content?: unknown
  reasoning?: unknown
}): { content?: string; reasoning?: string } {
  const content = normalizeStreamText(delta.content) ?? normalizeStreamText(delta.text)
  const reasoning =
    normalizeStreamText(delta.reasoning_content) ?? normalizeStreamText(delta.reasoning)
  return {
    ...(content ? { content } : {}),
    ...(reasoning ? { reasoning } : {})
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
    const delta = (choices[0] as {
      delta?: { content?: unknown; text?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    })?.delta
    if (!delta) return {}
    return textAndReasoningFromOpenAiDelta(delta)
  }
  return {}
}

/**
 * Shared SSE framing loop (sole place for decode / data: / [DONE] / line split).
 * onPayload receives each non-empty `data:` payload string (including the
 * literal `[DONE]`). Return `'stop'` to end early (callers always stop on [DONE]).
 */
async function consumeSsePayloads(
  body: ReadableStream<Uint8Array>,
  onPayload: (payload: string) => 'continue' | 'stop'
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
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
      if (!data) continue
      if (onPayload(data) === 'stop') return
    }
  }
}

export type TextSseStreamResult = {
  text: string
  usage?: ProviderUsage
}

/**
 * Text-only SSE stream. Accumulates answer text and last-seen usage
 * (when hosts honor stream_options.include_usage).
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken: (delta: string) => void,
  onReasoning?: (delta: string) => void
): Promise<TextSseStreamResult> {
  let acc = ''
  let usage: ProviderUsage | undefined
  await consumeSsePayloads(body, (data) => {
    if (data === '[DONE]') return 'stop'
    const parsed = safeJsonParse(data)
    const chunkUsage = extractUsage(format, parsed)
    if (chunkUsage) usage = chunkUsage
    const delta = extractStreamDelta(format, parsed)
    if (delta.reasoning) onReasoning?.(delta.reasoning)
    if (delta.content) {
      acc += delta.content
      onToken(delta.content)
    }
    return 'continue'
  })
  return {
    text: acc,
    ...(usage ? { usage } : {})
  }
}

/** Native Anthropic Messages stream tool-call / text deltas. */
function extractAnthropicChatDelta(event: unknown): {
  content?: string
  reasoning?: string
  toolCalls?: ToolCallFragment[]
  finishReason?: ProviderStopReason
} {
  const record = event as { type?: string; index?: number; content_block?: unknown; delta?: unknown }
  const index = typeof record.index === 'number' ? record.index : 0
  switch (record.type) {
    case 'content_block_start': {
      const cb = record.content_block && typeof record.content_block === 'object'
        ? (record.content_block as { type?: string; id?: string; name?: string })
        : undefined
      if (cb?.type === 'tool_use' && cb.name) {
        return { toolCalls: [{ index, id: cb.id, name: cb.name }] }
      }
      return {}
    }
    case 'content_block_delta': {
      const delta = record.delta && typeof record.delta === 'object'
        ? (record.delta as { type?: string; text?: string; thinking?: string; partial_json?: string })
        : undefined
      if (delta?.type === 'text_delta' && delta.text) return { content: delta.text }
      if (delta?.type === 'thinking_delta' && delta.thinking) return { reasoning: delta.thinking }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        return { toolCalls: [{ index, arguments: delta.partial_json }] }
      }
      return {}
    }
    case 'message_delta': {
      const md = record.delta && typeof record.delta === 'object'
        ? (record.delta as { stop_reason?: string })
        : undefined
      if (typeof md?.stop_reason === 'string' && md.stop_reason.trim()) {
        return { finishReason: normalizeStopReason(md.stop_reason) }
      }
      return {}
    }
    default:
      return {}
  }
}

/** Native OpenAI Responses stream tool-call / text deltas. */
function extractResponsesChatDelta(event: unknown): {
  content?: string
  reasoning?: string
  toolCalls?: ToolCallFragment[]
  finishReason?: ProviderStopReason
} {
  const record = event as {
    type?: string
    output_index?: number
    delta?: unknown
    item?: unknown
    response?: unknown
  }
  const index = typeof record.output_index === 'number' ? record.output_index : 0
  switch (record.type) {
    case 'response.output_text.delta':
      return typeof record.delta === 'string' ? { content: record.delta } : {}
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_summary.delta':
    case 'response.reasoning_text.delta':
      return typeof record.delta === 'string' ? { reasoning: record.delta } : {}
    case 'response.output_item.added': {
      const item = record.item && typeof record.item === 'object'
        ? (record.item as { type?: string; id?: string; call_id?: string; name?: string })
        : undefined
      if (item?.type === 'function_call' && item.name) {
        // `call_id`, not the output item's `id`, is required when sending a
        // matching function_call_output in the next Responses request.
        return { toolCalls: [{ index, id: item.call_id || item.id, name: item.name }] }
      }
      return {}
    }
    case 'response.function_call_arguments.delta':
      return typeof record.delta === 'string'
        ? { toolCalls: [{ index, arguments: record.delta }] }
        : {}
    case 'response.completed': {
      const resp = record.response && typeof record.response === 'object'
        ? (record.response as { status?: string; incomplete_details?: { reason?: string } })
        : undefined
      if (resp?.status === 'incomplete') {
        const detail = resp.incomplete_details?.reason
        return { finishReason: detail ? normalizeStopReason(detail) : 'length' }
      }
      return { finishReason: 'stop' }
    }
    default:
      return {}
  }
}

function extractChatDelta(format: ModelEndpointFormat, event: unknown): {
  content?: string
  reasoning?: string
  toolCalls?: ToolCallFragment[]
  finishReason?: ProviderStopReason
} {
  if (!event || typeof event !== 'object') return {}
  if (format === 'responses') return extractResponsesChatDelta(event)
  if (format === 'messages') return extractAnthropicChatDelta(event)
  if (!toolsSupportedForFormat(format)) {
    return extractStreamDelta(format, event)
  }
  const choices = (event as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return {}
  const choice = choices[0] as {
    finish_reason?: unknown
    delta?: { content?: unknown; text?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: unknown }
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
  const textParts = textAndReasoningFromOpenAiDelta(delta)
  if (textParts.content) out.content = textParts.content
  if (textParts.reasoning) out.reasoning = textParts.reasoning
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
  finishReason?: ProviderStopReason,
  usage?: ProviderUsage
): { text: string; toolCalls: ToolCall[]; finishReason?: ProviderStopReason; usage?: ProviderUsage } {
  const nativeToolCalls: ToolCall[] = []
  for (const slot of toolAcc.values()) {
    // Some OpenAI-compatible hosts stream name/args without a durable id.
    // Dropping those fragments previously produced false "empty stream" failures.
    if (!slot.name) continue
    nativeToolCalls.push({
      id: slot.id || `call_${slot.index}`,
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
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage } : {})
  }
}

export async function readChatSseStream(
  body: ReadableStream<Uint8Array>,
  format: ModelEndpointFormat,
  onToken?: (delta: string) => void,
  onReasoning?: (delta: string) => void
): Promise<{ text: string; toolCalls: ToolCall[]; finishReason?: ProviderStopReason; usage?: ProviderUsage }> {
  let textAcc = ''
  let finishReason: ProviderStopReason | undefined
  let usage: ProviderUsage | undefined
  const toolAcc = new Map<number, { index: number; id?: string; name?: string; arguments: string }>()

  await consumeSsePayloads(body, (data) => {
    if (data === '[DONE]') return 'stop'
    const parsed = safeJsonParse(data)
    // Final OpenAI-compatible chunks may carry usage with empty choices.
    const chunkUsage = extractUsage(format, parsed)
    if (chunkUsage) usage = chunkUsage
    const delta = extractChatDelta(format, parsed)
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
    return 'continue'
  })

  return assembleStream(textAcc, toolAcc, finishReason, usage)
}
