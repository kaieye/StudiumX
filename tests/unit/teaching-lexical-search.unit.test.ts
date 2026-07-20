import { describe, expect, it } from 'vitest'
import { ngrams, searchLexicalDocuments } from '../../src/main/ai/teaching-lexical-search'

describe('teaching lexical search', () => {
  it('ranks ngram overlap and returns snippets without requiring FTS', () => {
    const hits = searchLexicalDocuments(
      '二次导数 易混',
      [
        { id: 'a', title: '二次导数', text: '二次导数描述加速度，和一阶导数易混。' },
        { id: 'b', title: '无关条目', text: '今天天气不错。' },
        { id: 'c', title: '一阶导数', text: '一阶导数是斜率。' }
      ],
      { limit: 5 }
    )
    expect(hits[0]?.id).toBe('a')
    expect(hits[0]?.snippet.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.id !== 'b')).toBe(true)
  })

  it('builds ascii 3-grams and cjk 2-grams', () => {
    const grams = ngrams('ABC derivative 易混概念')
    expect(grams.has('der')).toBe(true)
    expect(grams.has('易混')).toBe(true)
  })
})
