import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMORY_INJECTION_MAX_CHARS,
  sanitizeMemoryInjectionText,
  sanitizeMemoryRecordsForPrompt
} from '../../src/shared/memory-sanitize'

describe('sanitizeMemoryInjectionText', () => {
  it('returns empty for non-string / nullish / empty input without throwing', () => {
    expect(sanitizeMemoryInjectionText(null)).toBe('')
    expect(sanitizeMemoryInjectionText(undefined)).toBe('')
    expect(sanitizeMemoryInjectionText(42 as unknown as string)).toBe('')
    expect(sanitizeMemoryInjectionText('')).toBe('')
    expect(sanitizeMemoryInjectionText('   \n\t  ')).toBe('')
  })

  it('strips control chars but keeps newline and tab', () => {
    const raw = `line1\u0000\u0007\tkeep\nline2\u001Fend`
    const out = sanitizeMemoryInjectionText(raw)
    expect(out).toBe('line1\tkeep\nline2end')
    expect(out).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/)
  })

  it('collapses excessive whitespace and consecutive newlines', () => {
    const raw = 'a   b\t\t c\n\n\n\nd'
    const out = sanitizeMemoryInjectionText(raw)
    expect(out).toBe('a b\t\t c\n\nd')
  })

  it('caps length at default maxChars with ellipsis', () => {
    const raw = 'x'.repeat(DEFAULT_MEMORY_INJECTION_MAX_CHARS + 50)
    const out = sanitizeMemoryInjectionText(raw)
    expect(out.length).toBe(DEFAULT_MEMORY_INJECTION_MAX_CHARS)
    expect(out.endsWith('…')).toBe(true)
  })

  it('respects custom maxChars', () => {
    const out = sanitizeMemoryInjectionText('abcdefghij', { maxChars: 5 })
    expect(out).toBe('abcd…')
    expect(out.length).toBe(5)
  })

  it('redacts bearer tokens and api-key shaped secrets', () => {
    const raw =
      'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz012345 token=sk-proj-abcdefghijklmnopqrstuvwxyz0123'
    const out = sanitizeMemoryInjectionText(raw)
    expect(out).toContain('[redacted]')
    expect(out).not.toMatch(/sk-abcdefghijklmnopqrstuvwxyz012345/)
    expect(out).not.toMatch(/sk-proj-abcdefghijklmnopqrstuvwxyz0123/)
  })

  it('redacts absolute path prefixes to [path]', () => {
    const win = sanitizeMemoryInjectionText('notes at C:\\Users\\alice\\Documents\\secret.md end')
    expect(win).toContain('[path]')
    expect(win).not.toContain('C:\\Users\\alice')

    const posix = sanitizeMemoryInjectionText('file /Users/bob/project/notes.md and /home/bob/x')
    expect(posix).toContain('[path]')
    expect(posix).not.toContain('/Users/bob')
    expect(posix).not.toContain('/home/bob')
  })

  it('preserves ordinary teaching prose', () => {
    const prose = '学习者偏好：用表格对比概念，避免一次讲超过一个动作。'
    expect(sanitizeMemoryInjectionText(prose)).toBe(prose)
  })
})

describe('sanitizeMemoryRecordsForPrompt', () => {
  it('maps content, drops empty, preserves order', () => {
    const out = sanitizeMemoryRecordsForPrompt([
      { id: 'a', content: 'first memory' },
      { id: 'b', content: '   ' },
      { id: 'c', content: 'second\u0000 memory' },
      { content: 'third' }
    ])
    expect(out).toEqual([
      { id: 'a', content: 'first memory' },
      { id: 'c', content: 'second memory' },
      { content: 'third' }
    ])
  })

  it('never throws on bad records and returns empty for nullish', () => {
    expect(sanitizeMemoryRecordsForPrompt(null)).toEqual([])
    expect(sanitizeMemoryRecordsForPrompt(undefined)).toEqual([])
    expect(
      sanitizeMemoryRecordsForPrompt([
        null as unknown as { content: string },
        { content: 12 as unknown as string },
        { content: 'ok' }
      ])
    ).toEqual([{ content: 'ok' }])
  })

  it('enforces total budget across records', () => {
    const out = sanitizeMemoryRecordsForPrompt(
      [
        { id: '1', content: 'aaaa' },
        { id: '2', content: 'bbbb' },
        { id: '3', content: 'cccc' }
      ],
      { totalBudget: 6 }
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out.length).toBeLessThanOrEqual(2)
    const joined = out.map((r) => r.content).join('')
    expect(joined.length).toBeLessThanOrEqual(6)
    expect(out[0]?.id).toBe('1')
  })

  it('applies per-record maxChars while mapping', () => {
    const out = sanitizeMemoryRecordsForPrompt(
      [{ id: 'long', content: 'abcdefghijklmnop' }],
      { maxChars: 8 }
    )
    expect(out).toEqual([{ id: 'long', content: 'abcdefg…' }])
  })
})
