import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../src/main/ai/provider-adapter'
import {
  legacyRequestFromMessages,
  safeFallbackText
} from '../../src/main/ai/agent-loop-fallback'

describe('safeFallbackText', () => {
  const transcript: ChatMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' }
  ]

  it('returns empty string when fallback is undefined', () => {
    expect(safeFallbackText(undefined, transcript)).toBe('')
  })

  it('trims successful fallback text', () => {
    expect(safeFallbackText(() => '  answer  ', transcript)).toBe('answer')
  })

  it('maps null/undefined callback result to empty string', () => {
    expect(safeFallbackText(() => null, transcript)).toBe('')
    expect(safeFallbackText(() => undefined, transcript)).toBe('')
  })

  it('swallows thrown errors fail-closed', () => {
    expect(
      safeFallbackText(() => {
        throw new Error('boom')
      }, transcript)
    ).toBe('')
  })

  it('passes the transcript into the callback', () => {
    let seen: readonly ChatMessage[] | undefined
    safeFallbackText((messages) => {
      seen = messages
      return 'ok'
    }, transcript)
    expect(seen).toBe(transcript)
  })
})

describe('legacyRequestFromMessages', () => {
  it('joins system messages and uses sole user content as userPrompt', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'user', content: 'hello' }
    ]
    expect(legacyRequestFromMessages(messages)).toEqual({
      systemPrompt: 'A\n\nB',
      userPrompt: 'hello',
      jsonMode: false
    })
  })

  it('folds prior turns and labels the latest user message', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' }
    ]
    expect(legacyRequestFromMessages(messages)).toEqual({
      systemPrompt: 'sys',
      userPrompt: '用户：u1\n\n助手：a1\n\n最新用户消息：u2',
      jsonMode: false
    })
  })

  it('ignores tool messages when shaping prompts', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'tool', tool_call_id: 't1', content: 'tool-out' },
      { role: 'user', content: 'follow-up' }
    ]
    const shaped = legacyRequestFromMessages(messages)
    expect(shaped.systemPrompt).toBe('sys')
    expect(shaped.userPrompt).toContain('用户：q')
    expect(shaped.userPrompt).toContain('助手：')
    expect(shaped.userPrompt).toContain('最新用户消息：follow-up')
    expect(shaped.userPrompt).not.toContain('tool-out')
    expect(shaped.jsonMode).toBe(false)
  })

  it('returns empty prompts for empty transcript', () => {
    expect(legacyRequestFromMessages([])).toEqual({
      systemPrompt: '',
      userPrompt: '',
      jsonMode: false
    })
  })
})
