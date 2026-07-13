import type { SearchResult } from './types'

export const MAX_SNIPPET_CHARS = 200

export function normalizeSearchResults(data: unknown, maxResults: number): SearchResult[] {
  const root = asRecord(data)
  const dataNode = asRecord(root.data)
  const webNode = asRecord(root.web)
  const candidates = [
    asRecordArray(root.results),
    asRecordArray(root.data),
    asRecordArray(root.web),
    asRecordArray(webNode.results),
    asRecordArray(dataNode.web),
    asRecordArray(dataNode.results),
    asRecordArray(dataNode)
  ].find((items) => items.length > 0) ?? []

  return candidates
    .map(recordToSearchResult)
    .filter((item): item is SearchResult => Boolean(item && /^https?:\/\//i.test(item.url)))
    .slice(0, maxResults)
}

export function normalizeSearXngResults(data: unknown, maxResults: number): SearchResult[] {
  const rawResults = asRecordArray(asRecord(data).results)
  return [...rawResults]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, maxResults)
    .map((item) => ({
      title: stringField(item.title).slice(0, 200) || stringField(item.url),
      url: stringField(item.url),
      snippet: stripTags(stringField(item.content)).slice(0, MAX_SNIPPET_CHARS)
    }))
    .filter((item) => /^https?:\/\//i.test(item.url))
}

export function normalizeBraveResults(data: unknown, maxResults: number): SearchResult[] {
  const rawResults = asRecordArray(asRecord(asRecord(data).web).results)
  return rawResults
    .slice(0, maxResults)
    .map((item) => ({
      title: stripTags(stringField(item.title)).slice(0, 200) || stringField(item.url),
      url: stringField(item.url),
      snippet: stripTags(stringField(item.description)).slice(0, MAX_SNIPPET_CHARS)
    }))
    .filter((item) => /^https?:\/\//i.test(item.url))
}

export function parseXaiSearchResults(data: unknown, maxResults: number): SearchResult[] {
  const text = extractResponseText(data)
  const parsed = parseJsonFromText(text)
  const parsedResults = normalizeSearchResults(parsed, maxResults)
  if (parsedResults.length > 0) return parsedResults

  const citationResults = citationsToResults(data, text, maxResults)
  if (citationResults.length > 0) return citationResults

  return normalizeSearchResults(data, maxResults)
}

/**
 * Parse lite.duckduckgo.com/lite/ result rows. The layout uses a table where
 * each result has an anchor (class "result-link") and a snippet cell. We scan
 * anchor-by-anchor and grab the next text-heavy cell as the snippet.
 */
export function parseLiteResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  try {
    const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    let match: RegExpExecArray | null
    while ((match = anchorRe.exec(html)) !== null) {
      const attrs = parseHtmlAttributes(match[1])
      if (!/\bresult-link\b/i.test(attrs.class ?? '')) continue
      const rawHref = attrs.href ?? ''
      const title = stripTags(match[2]).trim()
      // DDG lite sometimes wraps the real URL in a redirect param; unwrap uddg=.
      const url = unwrapDuckDuckGoHref(rawHref)
      if (!url || !/^https?:\/\//i.test(url)) continue
      const snippet = extractSnippetAfter(html, match.index + match[0].length)
      results.push({
        title: title.slice(0, 200) || url,
        url,
        snippet: snippet.slice(0, MAX_SNIPPET_CHARS)
      })
      if (results.length >= 10) break
    }
  } catch {
    return []
  }
  return results
}

function recordToSearchResult(item: Record<string, unknown>): SearchResult | null {
  const url =
    stringField(item.url) ||
    stringField(item.link) ||
    stringField(item.href) ||
    stringField(item.sourceURL) ||
    stringField(item.sourceUrl)
  if (!url) return null
  const title = stripTags(stringField(item.title) || stringField(item.name) || url).slice(0, 200)
  const snippet = stripTags(
    stringField(item.description) ||
      stringField(item.content) ||
      stringField(item.snippet) ||
      stringField(item.body) ||
      joinTextList(item.highlights) ||
      joinTextList(item.excerpts)
  ).slice(0, MAX_SNIPPET_CHARS)
  return { title, url, snippet }
}

function extractResponseText(data: unknown): string {
  const root = asRecord(data)
  const outputText = stringField(root.output_text)
  if (outputText) return outputText

  const output = asRecordArray(root.output)
  const parts: string[] = []
  for (const item of output) {
    const content = asRecordArray(item.content)
    for (const piece of content) {
      const text = stringField(piece.text) || stringField(piece.output_text)
      if (text) parts.push(text)
    }
  }

  const choices = asRecordArray(root.choices)
  for (const choice of choices) {
    const message = asRecord(choice.message)
    const content = stringField(message.content)
    if (content) parts.push(content)
  }

  return parts.join('\n').trim()
}

function parseJsonFromText(text: string): unknown {
  if (!text) return {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return {}
      }
    }
    return {}
  }
}

function citationsToResults(data: unknown, snippet: string, maxResults: number): SearchResult[] {
  const root = asRecord(data)
  const citations = Array.isArray(root.citations) ? root.citations : []
  return citations
    .map((citation, index) => {
      if (typeof citation === 'string') {
        return /^https?:\/\//i.test(citation)
          ? { title: citation, url: citation, snippet: stripTags(snippet).slice(0, MAX_SNIPPET_CHARS) }
          : null
      }
      const record = asRecord(citation)
      const url = stringField(record.url)
      if (!url) return null
      return {
        title: stringField(record.title) || `xAI citation ${index + 1}`,
        url,
        snippet: stripTags(stringField(record.snippet) || snippet).slice(0, MAX_SNIPPET_CHARS)
      }
    })
    .filter((item): item is SearchResult => Boolean(item && /^https?:\/\//i.test(item.url)))
    .slice(0, maxResults)
}

function joinTextList(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map((item) => typeof item === 'string' ? item : stringField(asRecord(item).text)).filter(Boolean).join(' ')
}

function extractSnippetAfter(html: string, fromIndex: number): string {
  const rest = html.slice(fromIndex, fromIndex + 2000)
  const snippetMatch = rest.match(/<td\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bresult-snippet\b[^"']*\1)[^>]*>([\s\S]*?)<\/td>/i)
  if (snippetMatch) return stripTags(snippetMatch[2]).trim()
  const nextAnchor = rest.search(/<a\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\bresult-link\b[^"']*\1)[^>]*>/i)
  const region = nextAnchor > 0 ? rest.slice(0, nextAnchor) : rest
  const cellMatch = region.match(/<td[^>]*>([\s\S]*?)<\/td>/i)
  if (cellMatch) {
    const text = stripTags(cellMatch[1]).trim()
    if (text.length > 0) return text
  }
  return ''
}

function unwrapDuckDuckGoHref(href: string): string {
  try {
    const decoded = decodeURIComponent(decodeHtmlEntities(href))
    const u = new URL(decoded, 'https://duckduckgo.com')
    const uddg = u.searchParams.get('uddg')
    if (uddg) return uddg
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) return decoded
    return href
  } catch {
    return href
  }
}

function parseHtmlAttributes(input: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g
  let match: RegExpExecArray | null
  while ((match = attrRe.exec(input)) !== null) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attrs
}

export function stripTags(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)) : []
}
