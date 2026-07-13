import katex from 'katex'

/**
 * The lesson markup boundary. It accepts untrusted model text and emits only
 * the small HTML allowlist used by the static lesson assets. Raw HTML is never
 * carried through this compiler.
 */

export type LessonMarkupOptions = {
  compactListClass: string
}

type TableAlignment = 'left' | 'center' | 'right' | null

type MarkdownTable = {
  header: string[]
  alignments: TableAlignment[]
  rows: string[][]
  endIndex: number
}

type MarkdownMathBlock = {
  content: string
  endIndex: number
}

type ListMarker = {
  indent: number
  kind: 'ul' | 'ol'
  content: string
}

export function compileLessonMarkup(source: string, options: LessonMarkupOptions): string {
  const lines = source.split(/\r?\n/)
  const blocks: string[] = []
  let paragraph: string[] = []
  let code = false
  let codeBuffer: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (/^```/.test(line.trim())) {
      if (code) {
        blocks.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
        codeBuffer = []
        code = false
      } else {
        flushParagraph()
        code = true
      }
      continue
    }
    if (code) {
      codeBuffer.push(line)
      continue
    }

    const mathBlock = parseMathBlock(lines, index)
    if (mathBlock) {
      flushParagraph()
      blocks.push(renderMath(mathBlock.content, true))
      index = mathBlock.endIndex
      continue
    }

    const table = parseMarkdownTable(lines, index)
    if (table) {
      flushParagraph()
      blocks.push(renderMarkdownTable(table))
      index = table.endIndex
      continue
    }

    const marker = parseListMarker(line)
    if (marker && marker.indent === 0) {
      flushParagraph()
      const list = renderList(lines, index, marker.indent, marker.kind, options)
      blocks.push(list.html)
      index = list.endIndex
      continue
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line)
    if (headingMatch) {
      flushParagraph()
      // Section headings already occupy h2. Preserve the legacy one-level
      // offset for headings authored inside a section.
      const level = Math.min(6, headingMatch[1]!.length + 1)
      blocks.push(`<h${level}>${renderInline(headingMatch[2]!)}</h${level}>`)
      continue
    }

    if (/^>\s+/.test(line)) {
      flushParagraph()
      blocks.push(`<blockquote>${renderInline(line.replace(/^>\s+/, ''))}</blockquote>`)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    paragraph.push(line)
  }

  flushParagraph()
  if (code) blocks.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
  return blocks.join('\n')
}

function renderList(
  lines: string[],
  startIndex: number,
  baseIndent: number,
  kind: 'ul' | 'ol',
  options: LessonMarkupOptions
): { html: string; endIndex: number } {
  const items: string[] = []
  let index = startIndex
  let currentContent = ''
  let children: string[] = []
  let continuation: string[] = []

  const flushItem = (): void => {
    if (!currentContent) return
    const suffix = continuation.length ? `<br />${renderInline(continuation.join(' '))}` : ''
    items.push(`<li>${renderInline(currentContent)}${suffix}${children.join('')}</li>`)
    currentContent = ''
    children = []
    continuation = []
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      // A blank line ends this compact list unless a nested list follows.
      const next = parseListMarker(lines[index + 1] ?? '')
      if (!next || next.indent <= baseIndent) break
      index += 1
      continue
    }

    const marker = parseListMarker(line)
    if (!marker) {
      const indent = leadingIndent(line)
      if (indent <= baseIndent) break
      continuation.push(line.trim())
      index += 1
      continue
    }
    if (marker.indent < baseIndent) break
    if (marker.indent === baseIndent) {
      if (marker.kind !== kind) break
      flushItem()
      currentContent = marker.content
      index += 1
      continue
    }

    // A deeper marker belongs to the current list item. If it is malformed
    // before any item, leave it for the outer block parser rather than losing
    // text.
    if (!currentContent) break
    const nested = renderList(lines, index, marker.indent, marker.kind, options)
    children.push(nested.html)
    index = nested.endIndex + 1
  }

  flushItem()
  const className = kind === 'ul' ? ` class="${escapeAttr(options.compactListClass)}"` : ''
  return { html: `<${kind}${className}>${items.join('')}</${kind}>`, endIndex: index - 1 }
}

function parseListMarker(line: string): ListMarker | null {
  const match = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line)
  if (!match) return null
  return {
    indent: leadingIndent(match[1]!),
    kind: /\d+\.$/.test(match[2]!) ? 'ol' : 'ul',
    content: match[3] ?? ''
  }
}

function leadingIndent(value: string): number {
  let width = 0
  for (const character of value) width += character === '\t' ? 2 : 1
  return width
}

function parseMathBlock(lines: string[], startIndex: number): MarkdownMathBlock | null {
  const firstLine = lines[startIndex]?.trim() ?? ''
  const opener = firstLine.startsWith('$$') ? '$$' : firstLine.startsWith('\\[') ? '\\[' : null
  if (!opener) return null
  const closer = opener === '$$' ? '$$' : '\\]'
  const firstContent = firstLine.slice(opener.length)
  const sameLineEnd = firstContent.indexOf(closer)
  if (sameLineEnd >= 0) {
    const content = firstContent.slice(0, sameLineEnd).trim()
    return content ? { content, endIndex: startIndex } : null
  }

  const contentLines = [firstContent]
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const closeIndex = line.indexOf(closer)
    if (closeIndex >= 0) {
      contentLines.push(line.slice(0, closeIndex))
      const content = contentLines.join('\n').trim()
      return content ? { content, endIndex: index } : null
    }
    contentLines.push(line)
  }
  return null
}

function parseMarkdownTable(lines: string[], startIndex: number): MarkdownTable | null {
  const header = splitTableRow(lines[startIndex] ?? '')
  const separator = splitTableRow(lines[startIndex + 1] ?? '')
  if (!header || !separator || header.length === 0 || separator.length !== header.length) return null

  const alignments: TableAlignment[] = []
  for (const cell of separator) {
    const alignment = parseTableAlignment(cell)
    if (alignment === undefined) return null
    alignments.push(alignment)
  }

  const rows: string[][] = []
  let endIndex = startIndex + 1
  for (let index = startIndex + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') break
    const row = splitTableRow(line)
    if (!row) break
    rows.push(normalizeTableCells(row, header.length))
    endIndex = index
  }

  return { header: normalizeTableCells(header, header.length), alignments, rows, endIndex }
}

function splitTableRow(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return null

  const hasLeadingPipe = trimmed.startsWith('|')
  const hasTrailingPipe = endsWithUnescapedPipe(trimmed)
  let body = hasLeadingPipe ? trimmed.slice(1) : trimmed
  if (hasTrailingPipe) body = body.slice(0, -1)

  const cells: string[] = []
  let current = ''
  let escaped = false
  let inCode = false
  let sawSeparator = hasLeadingPipe || hasTrailingPipe
  for (const character of body) {
    if (character === '`' && !escaped) {
      inCode = !inCode
      current += character
      continue
    }
    if (character === '|' && !escaped && !inCode) {
      cells.push(current.trim())
      current = ''
      sawSeparator = true
      continue
    }
    current += character
    escaped = character === '\\' && !escaped
  }
  if (!sawSeparator) return null
  cells.push(current.trim())
  return cells
}

function endsWithUnescapedPipe(value: string): boolean {
  if (!value.endsWith('|')) return false
  let slashCount = 0
  for (let index = value.length - 2; index >= 0 && value[index] === '\\'; index -= 1) slashCount += 1
  return slashCount % 2 === 0
}

function parseTableAlignment(cell: string): TableAlignment | undefined {
  const marker = cell
    .replace(/[：:]/g, ':')
    .replace(/[—–\-―]/g, '-')
    .replace(/\s+/g, '')
  if (!/^:?-{2,}:?$/.test(marker)) return undefined
  if (marker.startsWith(':') && marker.endsWith(':')) return 'center'
  if (marker.endsWith(':')) return 'right'
  if (marker.startsWith(':')) return 'left'
  return null
}

function normalizeTableCells(cells: string[], expected: number): string[] {
  const normalized = cells.slice(0, expected)
  while (normalized.length < expected) normalized.push('')
  return normalized
}

function renderMarkdownTable(table: MarkdownTable): string {
  const header = table.header
    .map((cell, index) => `          <th scope="col"${alignmentClass(table.alignments[index])}>${renderInline(cell)}</th>`)
    .join('')
  const rows = table.rows
    .map((row) => `        <tr>${row.map((cell, index) => `<td${alignmentClass(table.alignments[index])}>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('\n')
  return `<div class="markdown-table-wrap">
      <table>
        <thead>
        <tr>${header}</tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>`
}

function alignmentClass(alignment: TableAlignment | undefined): string {
  return alignment ? ` class="align-${alignment}"` : ''
}

function renderInline(source: string): string {
  let output = ''
  let index = 0
  while (index < source.length) {
    const rest = source.slice(index)

    const code = /^`([^`\n]+)`/.exec(rest)
    if (code) {
      output += `<code>${escapeHtml(code[1]!)}</code>`
      index += code[0].length
      continue
    }

    const escapedMath = /^\\\((.+?)\\\)/.exec(rest)
    if (escapedMath && escapedMath[1]!.trim()) {
      output += renderMath(escapedMath[1]!, false)
      index += escapedMath[0].length
      continue
    }

    if (source[index] === '$' && !isEscaped(source, index)) {
      const end = source.indexOf('$', index + 1)
      if (end > index + 1) {
        const content = source.slice(index + 1, end)
        if (content.trim() && !/^\s|\s$/.test(content)) {
          output += renderMath(content, false)
          index = end + 1
          continue
        }
      }
    }

    const strong = /^\*\*([^*]+)\*\*/.exec(rest)
    if (strong) {
      output += `<strong>${renderInline(strong[1]!)}</strong>`
      index += strong[0].length
      continue
    }

    const link = parseInlineLink(source, index)
    if (link) {
      const safeHref = sanitizeHref(link.href)
      const label = renderInline(link.label)
      output += safeHref ? `<a href="${escapeAttr(safeHref)}">${label}</a>` : label
      index += link.length
      continue
    }

    if (source[index] === '\\' && index + 1 < source.length && /[\\`*\[\]()|$]/.test(source[index + 1]!)) {
      output += escapeHtml(source[index + 1]!)
      index += 2
      continue
    }

    output += escapeHtml(source[index]!)
    index += 1
  }
  return output
}

function parseInlineLink(source: string, startIndex: number): { label: string; href: string; length: number } | null {
  if (source[startIndex] !== '[') return null
  const labelEnd = source.indexOf('](', startIndex + 1)
  if (labelEnd <= startIndex + 1) return null

  let depth = 1
  let cursor = labelEnd + 2
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '\\' && cursor + 1 < source.length) {
      cursor += 1
      continue
    }
    if (/\s/.test(source[cursor]!)) return null
    if (source[cursor] === '(') depth += 1
    if (source[cursor] === ')') {
      depth -= 1
      if (depth === 0) {
        return {
          label: source.slice(startIndex + 1, labelEnd),
          href: source.slice(labelEnd + 2, cursor),
          length: cursor - startIndex + 1
        }
      }
    }
  }
  return null
}

function isEscaped(value: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function renderMath(content: string, displayMode: boolean): string {
  try {
    const math = katex.renderToString(content, {
      displayMode,
      output: 'mathml',
      strict: 'ignore',
      throwOnError: true,
      trust: false
    })
    const className = displayMode ? 'lesson-math lesson-math--block' : 'lesson-math lesson-math--inline'
    return displayMode ? `<div class="${className}">${math}</div>` : `<span class="${className}">${math}</span>`
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid math expression'
    return `<code class="lesson-math-fallback" title="${escapeAttr(message)}">${escapeHtml(content)}</code>`
  }
}

/** Escape text for an HTML text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape text for an HTML attribute. */
export function escapeAttr(value: string): string {
  return escapeHtml(value)
}

/** Allow only local references, fragments, and http(s) URLs in authored links. */
export function sanitizeHref(href: string): string {
  const trimmed = href.trim()
  if (!trimmed) return ''
  if (/^(https?:\/\/|\/|\.\.\/|\.\/|#)/i.test(trimmed)) return trimmed
  if (!/[a-z0-9+.-]+:/i.test(trimmed)) return trimmed
  return ''
}
