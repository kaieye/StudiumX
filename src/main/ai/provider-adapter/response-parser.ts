import type { ModelEndpointFormat } from '../../../shared/teaching-types'
import type { ToolCall } from '../provider-adapter'
import { parseDsmlToolCalls, stripDsmlToolCallBlocks } from './dsml-tool-calls'
import { toolsSupportedForFormat } from './capabilities'

export function extractText(format: ModelEndpointFormat, body: unknown): string {
  if (format === 'messages') {
    const content = (body as { content?: unknown })?.content
    if (Array.isArray(content)) {
      return content
        .map((block) => (block as { text?: string })?.text ?? '')
        .filter(Boolean)
        .join('')
    }
    return typeof content === 'string' ? content : ''
  }
  if (format === 'responses') {
    const out = (body as { output_text?: string })?.output_text
    if (typeof out === 'string') return out
    const output = (body as { output?: unknown })?.output
    if (Array.isArray(output)) {
      return output
        .flatMap((item) => {
          const content = (item as { content?: unknown })?.content
          return Array.isArray(content)
            ? content.map((block) => (block as { text?: string })?.text ?? '')
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

export function extractToolCalls(format: ModelEndpointFormat, body: unknown): ToolCall[] {
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
