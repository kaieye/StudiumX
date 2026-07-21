/**
 * Main-only lexical (ngram) search over in-process text corpora.
 * Zero-LLM hot path. Not SQLite FTS and not a product search index.
 */
export type LexicalDocument = Readonly<{
  id: string
  text: string
  title?: string
  meta?: Readonly<Record<string, string | number | boolean | null | undefined>>
}>

export type LexicalSearchHit = Readonly<{
  id: string
  score: number
  title?: string
  snippet: string
  meta?: Readonly<Record<string, string | number | boolean | null | undefined>>
}>

export type LexicalSearchOptions = Readonly<{
  limit?: number
  minScore?: number
}>

/** Score documents with character n-gram overlap (ASCII 3-gram + CJK 2-gram). */
export function searchLexicalDocuments(
  query: string,
  documents: readonly LexicalDocument[],
  options: LexicalSearchOptions = {}
): LexicalSearchHit[] {
  const limit = Math.max(1, Math.min(options.limit ?? 8, 40))
  const minScore = options.minScore ?? 0.01
  const queryGrams = ngrams(query)
  if (queryGrams.size === 0) return []

  const hits: LexicalSearchHit[] = []
  for (const doc of documents) {
    const corpus = `${doc.title ?? ''} ${doc.text}`
    const textGrams = ngrams(corpus)
    let overlap = 0
    for (const gram of queryGrams) {
      if (textGrams.has(gram)) overlap += 1
    }
    if (overlap === 0) continue
    const coverage = overlap / queryGrams.size
    const score = overlap + coverage
    if (score < minScore) continue
    hits.push({
      id: doc.id,
      score,
      title: doc.title,
      snippet: buildSnippet(doc.text, query),
      meta: doc.meta
    })
  }

  return hits
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export function ngrams(input: string): Set<string> {
  const grams = new Set<string>()
  const normalized = input.toLowerCase()
  const asciiWords = normalized.match(/[a-z0-9_]{3,}/g) ?? []
  for (const word of asciiWords) {
    for (let index = 0; index + 3 <= word.length; index += 1) {
      grams.add(word.slice(index, index + 3))
    }
  }
  const cjkRuns = normalized.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) ?? []
  for (const run of cjkRuns) {
    for (let index = 0; index + 2 <= run.length; index += 1) {
      grams.add(run.slice(index, index + 2))
    }
    if (run.length < 2) grams.add(run)
  }
  return grams
}

function buildSnippet(text: string, query: string, radius = 80): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
  const lower = clean.toLowerCase()
  let index = 0
  for (const term of terms) {
    const found = lower.indexOf(term)
    if (found >= 0) {
      index = found
      break
    }
  }
  const start = Math.max(0, index - radius)
  const end = Math.min(clean.length, index + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < clean.length ? '…' : ''
  return `${prefix}${clean.slice(start, end)}${suffix}`
}
