import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  FILL_OPTION_ID_PATTERN,
  fillAcceptedOptionIds,
  fillAnswerOptionId,
  isFillOptionId,
  normalizeFillAnswer,
  sha256HexUtf8
} from '../../src/shared/fill-answer'

describe('fill-answer identity (ADR-0155)', () => {
  it('matches node:crypto SHA-256 across padding boundaries and CJK input', () => {
    const vectors = [
      '', 'a', 'abc', 'hello world', '事件循环', '混合 mixed 123 ！',
      'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(63), 'd'.repeat(64), 'e'.repeat(65), 'x'.repeat(1000)
    ]
    for (const vector of vectors) {
      const expected = createHash('sha256').update(Buffer.from(vector, 'utf8')).digest('hex')
      expect(sha256HexUtf8(vector), JSON.stringify(vector.slice(0, 24))).toBe(expected)
    }
  })

  it('normalizes exactly like the published quiz.js grading path', () => {
    expect(normalizeFillAnswer('  Event   Loop。 ')).toBe('event loop')
    expect(normalizeFillAnswer('宏任务！')).toBe('宏任务')
    // Frozen contract quirk: punctuation strips after whitespace collapsing.
    expect(normalizeFillAnswer('A . B')).toBe('a  b')
    expect(normalizeFillAnswer('')).toBe('')
  })

  it('builds fill option ids only for non-empty normalized answers', () => {
    const id = fillAnswerOptionId('Event Loop')
    expect(id).toMatch(FILL_OPTION_ID_PATTERN)
    expect(isFillOptionId(id!)).toBe(true)
    expect(fillAnswerOptionId('。')).toBeNull()
    // Same normalized form → same identity regardless of surface spelling.
    expect(fillAnswerOptionId('event   loop。')).toBe(id)
  })

  it('deduplicates accepted answers by normalized identity', () => {
    const ids = fillAcceptedOptionIds('事件循环', ['Event Loop', 'event  loop', '事件循环。'])
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(fillAnswerOptionId('事件循环'))
  })
})
