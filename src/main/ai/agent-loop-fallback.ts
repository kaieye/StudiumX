import type { ChatMessage } from './provider-adapter'

/**
 * Safely invoke an optional transcript → text fallback.
 * Throws from the callback are swallowed; empty string is the fail-closed default.
 */
export function safeFallbackText(
  fallback: ((transcript: readonly ChatMessage[]) => string | null | undefined) | undefined,
  transcript: readonly ChatMessage[]
): string {
  if (!fallback) return ''
  try {
    return fallback(transcript)?.trim() ?? ''
  } catch {
    return ''
  }
}

/**
 * Shape chat messages into the legacy single-shot provider request form
 * (system + folded user/assistant turns). Pure; no I/O.
 */
export function legacyRequestFromMessages(messages: ChatMessage[]): {
  systemPrompt: string
  userPrompt: string
  jsonMode: boolean
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .filter(Boolean)
    .join('\n\n')
  // Fold prior turns into the user prompt so the degraded path retains context.
  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const role = m.role === 'user' ? '用户' : '助手'
      return `${role}：${m.content ?? ''}`
    })
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const userPrompt = turns.length > 1 ? `${turns.slice(0, -1).join('\n\n')}\n\n最新用户消息：${lastUser}` : lastUser
  return { systemPrompt: system, userPrompt, jsonMode: false }
}
