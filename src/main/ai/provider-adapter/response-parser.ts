import type { ModelEndpointFormat } from '../../../shared/teaching-types'
import type { ToolCall } from '../provider-adapter'
import { normalizeStopReason, type ProviderStopReason } from '../provider-hooks'
import { parseDsmlToolCalls, stripDsmlToolCallBlocks } from './dsml-tool-calls'
import { toolsSupportedForFormat } from './formats'

export type ProviderUsage = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' ? value as UnknownRecord : undefined
}

function textFromContentBlocks(content: unknown, allowedTypes: readonly string[]): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block === 'string') return block
      const record = asRecord(block)
      if (!record) return ''
      const type = typeof record.type === 'string' ? record.type : undefined
      if (type && !allowedTypes.includes(type)) return ''
      if (typeof record.text === 'string') return record.text
      return ''
    })
    .filter(Boolean)
    .join('')
}

function hasReasoningBlock(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return content.some((block) => {
    const record = asRecord(block)
    if (!record) return false
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
    return type === 'thinking' || type === 'redacted_thinking' || type === 'reasoning' ||
      type === 'summary_text' || type === 'reasoning_summary_text' ||
      typeof record.thinking === 'string' || typeof record.reasoning === 'string'
  })
}

export function extractUsage(format: ModelEndpointFormat, body: unknown): ProviderUsage | undefined {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  // OpenAI chat stream final chunk: top-level usage.
  // Anthropic stream: message_delta.usage / message_start.message.usage.
  // OpenAI responses stream: response.completed.response.usage.
  const nestedMessage = record.message && typeof record.message === 'object'
    ? (record.message as Record<string, unknown>).usage
    : undefined
  const nestedResponse = record.response && typeof record.response === 'object'
    ? (record.response as Record<string, unknown>).usage
    : undefined
  const raw = record.usage ?? nestedMessage ?? nestedResponse
  if (!raw || typeof raw !== 'object') return undefined
  const usage = raw as Record<string, unknown>
  // Accept both OpenAI and Anthropic field names — stream hosts vary by format.
  void format
  const promptTokens = finiteTokenCount(usage.prompt_tokens ?? usage.input_tokens)
  const completionTokens = finiteTokenCount(usage.completion_tokens ?? usage.output_tokens)
  // Keep an explicit provider total distinct from local arithmetic. Consumers
  // may estimate prompt + completion for observability, but host resource
  // governance must never charge that estimate as provider-reported quota.
  const totalTokens = finiteTokenCount(usage.total_tokens)
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) return undefined
  return {
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {})
  }
}

function finiteTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
}

/**
 * Normalize provider finish/stop signals into ProviderStopReason.
 * Returns undefined when the body carries no usable terminal signal (caller must not forge `stop`).
 */
export function extractFinishReason(format: ModelEndpointFormat, body: unknown): ProviderStopReason | undefined {
  if (!body || typeof body !== 'object') return undefined

  if (format === 'messages') {
    const stopReason = (body as { stop_reason?: unknown }).stop_reason
    if (typeof stopReason === 'string' && stopReason.trim()) return normalizeStopReason(stopReason)
    return undefined
  }

  if (format === 'responses') {
    const status = (body as { status?: unknown }).status
    if (typeof status === 'string' && status.trim()) {
      if (status === 'completed') return 'stop'
      if (status === 'incomplete') {
        const detail = (body as { incomplete_details?: { reason?: unknown } }).incomplete_details?.reason
        if (typeof detail === 'string' && detail.trim()) return normalizeStopReason(detail)
        return 'length'
      }
      if (status === 'failed') return 'error'
      if (status === 'cancelled' || status === 'canceled') return 'canceled'
      return normalizeStopReason(status)
    }
    return undefined
  }

  // chat_completions / custom_endpoint
  const choices = (body as { choices?: unknown }).choices
  if (Array.isArray(choices) && choices.length > 0) {
    const finishReason = (choices[0] as { finish_reason?: unknown })?.finish_reason
    if (typeof finishReason === 'string' && finishReason.trim()) return normalizeStopReason(finishReason)
  }
  return undefined
}

export function extractText(format: ModelEndpointFormat, body: unknown): string {
  if (format === 'messages') {
    const content = (body as { content?: unknown })?.content
    return textFromContentBlocks(content, ['text'])
  }
  if (format === 'responses') {
    const out = (body as { output_text?: string })?.output_text
    if (typeof out === 'string' && out) return out
    const output = (body as { output?: unknown })?.output
    if (Array.isArray(output)) {
      return output
        .flatMap((item) => {
          const record = asRecord(item)
          if (!record) return []
          // Responses can place reasoning summaries and function calls next to
          // the answer in `output`. Only message/output_text content is user
          // visible; never treat reasoning summaries as the answer body.
          if (typeof record.type === 'string' && record.type !== 'message' && record.type !== 'output_text') {
            return []
          }
          if (record.type === 'output_text' && typeof record.text === 'string') return [record.text]
          const content = record.content
          return textFromContentBlocks(content, ['output_text', 'text'])
            ? [textFromContentBlocks(content, ['output_text', 'text'])]
            : []
        })
        .filter(Boolean)
        .join('')
    }
    return ''
  }
  const choices = (body as { choices?: unknown })?.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as { message?: { content?: unknown } })?.message
    const content = message?.content
    if (typeof content === 'string') return stripDsmlToolCallBlocks(content)
    if (Array.isArray(content)) {
      return stripDsmlToolCallBlocks(content.map((block) => (block as { text?: string })?.text ?? '').join(''))
    }
  }
  return ''
}

/**
 * Responses streaming providers are allowed to put the complete answer only
 * on `response.completed.response`. This helper deliberately reuses the
 * non-stream parser so reasoning summaries and function calls stay hidden.
 */
export function extractCompletedResponseText(format: ModelEndpointFormat, event: unknown): string {
  if (format !== 'responses') return ''
  const response = asRecord(asRecord(event)?.response)
  return response ? extractText('responses', response) : ''
}

/**
 * Detect a response that contained provider reasoning/thinking but no answer.
 * The result is intentionally boolean: reasoning text must never be copied
 * into errors, logs, DTOs, or persistence.
 */
export function hasReasoningContent(format: ModelEndpointFormat, body: unknown): boolean {
  const record = asRecord(body)
  if (!record) return false

  if (format === 'messages') {
    return hasReasoningBlock(record.content) ||
      typeof record.thinking === 'string' || typeof record.reasoning === 'string'
  }

  if (format === 'responses') {
    if (typeof record.reasoning === 'string' || typeof record.reasoning_content === 'string') return true
    const output = record.output
    if (!Array.isArray(output)) return false
    return output.some((item) => {
      const itemRecord = asRecord(item)
      if (!itemRecord) return false
      const type = typeof itemRecord.type === 'string' ? itemRecord.type.toLowerCase() : ''
      return type === 'reasoning' || type === 'thinking' ||
        typeof itemRecord.reasoning === 'string' ||
        hasReasoningBlock(itemRecord.content)
    })
  }

  const choices = record.choices
  if (!Array.isArray(choices) || choices.length === 0) return false
  const first = asRecord(choices[0])
  const message = asRecord(first?.message) ?? asRecord(first?.delta)
  return Boolean(message && (
    typeof message.reasoning_content === 'string' ||
    typeof message.reasoning === 'string' ||
    typeof message.thinking === 'string' ||
    hasReasoningBlock(message.content)
  ))
}

/** Native Responses API tool calls: `output[].type === 'function_call'`. */
function extractResponsesToolCalls(body: unknown): ToolCall[] {
  const output = (body as { output?: unknown })?.output
  if (!Array.isArray(output)) return []
  const calls: ToolCall[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const record = item as {
      type?: string
      id?: string
      call_id?: string
      name?: string
      arguments?: unknown
    }
    if (record.type !== 'function_call') continue
    calls.push({
      // Responses uses `id` for the output item and `call_id` to correlate
      // the subsequent function_call_output input. Preserve the latter so a
      // streamed or non-streamed tool turn can continue correctly.
      id: record.call_id || record.id || `call_${calls.length}`,
      type: 'function',
      function: {
        name: record.name || '',
        arguments: typeof record.arguments === 'string'
          ? record.arguments
          : JSON.stringify(record.arguments ?? {})
      }
    })
  }
  return calls
}

/** Native Anthropic Messages tool calls: `content[].type === 'tool_use'`. */
function extractMessagesToolCalls(body: unknown): ToolCall[] {
  const content = (body as { content?: unknown })?.content
  if (!Array.isArray(content)) return []
  const calls: ToolCall[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const record = block as { type?: string; id?: string; name?: string; input?: unknown }
    if (record.type !== 'tool_use') continue
    calls.push({
      id: record.id || `tool_${calls.length}`,
      type: 'function',
      function: {
        name: record.name || '',
        arguments: typeof record.input === 'string'
          ? record.input
          : JSON.stringify(record.input ?? {})
      }
    })
  }
  return calls
}

export function extractToolCalls(format: ModelEndpointFormat, body: unknown): ToolCall[] {
  if (format === 'responses') return extractResponsesToolCalls(body)
  if (format === 'messages') return extractMessagesToolCalls(body)
  if (!toolsSupportedForFormat(format)) return []
  const choices = (body as { choices?: unknown })?.choices
  if (!Array.isArray(choices) || choices.length === 0) return []
  const msg = (choices[0] as { message?: { content?: unknown; tool_calls?: unknown } })?.message
  const calls = msg?.tool_calls
  const nativeCalls = Array.isArray(calls)
    ? calls
        .map((c): ToolCall | null => {
          const fn = (c as { function?: { name?: string; arguments?: string } })?.function
          const id = (c as { id?: string })?.id
          if (!fn || !fn.name || !id) return null
          return { id, type: 'function', function: { name: fn.name, arguments: fn.arguments ?? '{}' } }
        })
        .filter((c): c is ToolCall => c !== null)
    : []
  const content = msg?.content
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((block) => (block as { text?: string })?.text ?? '').join('')
        : ''
  return [...nativeCalls, ...parseDsmlToolCalls(text)]
}
