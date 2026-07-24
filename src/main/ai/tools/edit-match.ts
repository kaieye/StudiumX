/**
 * Fuzzy local-replace match engine for `edit_workspace_file` (worth-learning §3.1).
 *
 * Cascade (strictest first; first pass with ≥1 match wins):
 * 1. Exact — byte-for-byte substring
 * 2. Line endings / BOM — CRLF↔LF normalize + strip leading UTF-8 BOM
 * 3. Trailing whitespace — whole-line windows, per-line trim_end
 * 4. Indentation — whole-line windows with uniform leading-whitespace shift;
 *    replacement is re-rendered using the file's real indent
 *
 * Wrong / missing / non-uniform matches return null — callers must not write.
 * Patterns adapted from LiveAgent edit_match.rs (product identity not copied).
 */

const UTF8_BOM = '\u{feff}'

export type EditMatchStrategy =
  | 'exact'
  | 'line-endings'
  | 'trailing-whitespace'
  | 'indentation'

export type EditReplacement = {
  start: number
  end: number
  text: string
}

export type EditMatchOutcome = {
  strategy: EditMatchStrategy
  replacements: EditReplacement[]
}

/**
 * Run the pass cascade. Returns `null` when no pass finds a match.
 * Replacements are sorted, non-overlapping ranges into `text`.
 */
export function findEditMatches(
  text: string,
  oldString: string,
  newString: string
): EditMatchOutcome | null {
  if (!oldString) return null

  const exact = findExactRanges(text, oldString)
  if (exact.length > 0) {
    return {
      strategy: 'exact',
      replacements: exact.map(([start, end]) => ({
        start,
        end,
        text: newString
      }))
    }
  }

  const crlf = usesCrlfDominantly(text)

  const lineEnding = findLineEndingMatches(text, oldString, newString, crlf)
  if (lineEnding && lineEnding.length > 0) {
    return { strategy: 'line-endings', replacements: lineEnding }
  }

  const spans = indexLineSpans(text)
  const pattern = splitPatternLines(oldString)
  if (!pattern) return null

  const trailingWindows = findLineWindows(text, spans, pattern, (fileLine, patternLine) => {
    return trimEnd(fileLine) === trimEnd(patternLine)
  })
  if (trailingWindows.length > 0) {
    const rendered = renderLineEndings(newString, crlf)
    return {
      strategy: 'trailing-whitespace',
      replacements: trailingWindows.map((window) => {
        const [start, end] = windowRange(spans, window, pattern.endsWithNewline)
        return { start, end, text: rendered }
      })
    }
  }

  const indentCandidates = findLineWindows(text, spans, pattern, (fileLine, patternLine) => {
    return fileLine.trim() === patternLine.trim()
  })
  const replacements: EditReplacement[] = []
  for (const window of indentCandidates) {
    const shift = detectUniformShift(text, spans, pattern, window[0])
    if (!shift) continue
    const rendered = applyShiftToReplacement(newString, shift, crlf)
    if (rendered === null) continue
    const [start, end] = windowRange(spans, window, pattern.endsWithNewline)
    replacements.push({ start, end, text: rendered })
  }
  if (replacements.length > 0) {
    return { strategy: 'indentation', replacements }
  }

  return null
}

/** Splice sorted, non-overlapping replacements into `text`. */
export function applyEditReplacements(text: string, replacements: readonly EditReplacement[]): string {
  let out = ''
  let cursor = 0
  for (const replacement of replacements) {
    if (replacement.start < cursor || replacement.end < replacement.start) {
      throw new Error('edit replacements must be sorted and non-overlapping')
    }
    out += text.slice(cursor, replacement.start)
    out += replacement.text
    cursor = replacement.end
  }
  out += text.slice(cursor)
  return out
}

function findExactRanges(haystack: string, needle: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  if (!needle) return ranges
  let from = 0
  while (from <= haystack.length) {
    const offset = haystack.indexOf(needle, from)
    if (offset < 0) break
    ranges.push([offset, offset + needle.length])
    from = offset + needle.length
  }
  return ranges
}

type NormalizedView = {
  text: string
  /** Byte/code-unit offset in the original text for every normalized unit. */
  map: number[]
}

function normalizeWithMap(original: string): NormalizedView {
  const map: number[] = []
  let out = ''
  let i = original.startsWith(UTF8_BOM) ? UTF8_BOM.length : 0
  while (i < original.length) {
    if (original[i] === '\r' && original[i + 1] === '\n') {
      i += 1
      continue
    }
    map.push(i)
    out += original[i]
    i += 1
  }
  return { text: out, map }
}

function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

function usesCrlfDominantly(text: string): boolean {
  const crlf = (text.match(/\r\n/g) ?? []).length
  if (crlf === 0) return false
  const totalLf = (text.match(/\n/g) ?? []).length
  const loneLf = totalLf - crlf
  return crlf >= loneLf
}

function renderLineEndings(text: string, crlf: boolean): string {
  const normalized = normalizeLineEndings(text)
  return crlf ? normalized.replace(/\n/g, '\r\n') : normalized
}

function findLineEndingMatches(
  text: string,
  oldString: string,
  newString: string,
  crlf: boolean
): EditReplacement[] | null {
  const view = normalizeWithMap(text)
  const needle = normalizeLineEndings(stripBom(oldString))
  if (!needle) return null
  const ranges = findExactRanges(view.text, needle)
  if (ranges.length === 0) return null
  const rendered = renderLineEndings(newString, crlf)
  return ranges.map(([start, end]) => {
    let origStart = view.map[start]!
    const origEnd = view.map[end - 1]! + 1
    if (text[origStart] === '\n' && origStart > 0 && text[origStart - 1] === '\r') {
      origStart -= 1
    }
    return { start: origStart, end: origEnd, text: rendered }
  })
}

type LineSpan = {
  contentStart: number
  contentEnd: number
  lineEnd: number
}

function indexLineSpans(text: string): LineSpan[] {
  const bomLen = text.startsWith(UTF8_BOM) ? UTF8_BOM.length : 0
  const spans: LineSpan[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\n') continue
    const contentEnd = i > start && text[i - 1] === '\r' ? i - 1 : i
    spans.push({
      contentStart: start === 0 ? bomLen : start,
      contentEnd,
      lineEnd: i + 1
    })
    start = i + 1
  }
  if (start < text.length) {
    spans.push({
      contentStart: start === 0 ? bomLen : start,
      contentEnd: text.length,
      lineEnd: text.length
    })
  }
  return spans
}

function lineContent(text: string, span: LineSpan): string {
  return text.slice(span.contentStart, span.contentEnd)
}

type PatternLines = {
  lines: string[]
  endsWithNewline: boolean
}

function splitPatternLines(oldString: string): PatternLines | null {
  const stripped = stripBom(oldString)
  if (!stripped) return null
  const endsWithNewline = stripped.endsWith('\n')
  let lines = stripped.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
  if (endsWithNewline) lines = lines.slice(0, -1)
  if (lines.length === 0) return null
  return { lines, endsWithNewline }
}

function findLineWindows(
  text: string,
  spans: LineSpan[],
  pattern: PatternLines,
  lineMatches: (fileLine: string, patternLine: string) => boolean
): Array<[number, number]> {
  const windowLen = pattern.lines.length
  const windows: Array<[number, number]> = []
  if (windowLen === 0 || spans.length < windowLen) return windows
  let i = 0
  while (i + windowLen <= spans.length) {
    let matched = true
    for (let j = 0; j < windowLen; j++) {
      if (!lineMatches(lineContent(text, spans[i + j]!), pattern.lines[j]!)) {
        matched = false
        break
      }
    }
    if (matched) {
      windows.push([i, i + windowLen - 1])
      i += windowLen
    } else {
      i += 1
    }
  }
  return windows
}

function windowRange(
  spans: LineSpan[],
  [first, last]: [number, number],
  includeFinalEol: boolean
): [number, number] {
  const start = spans[first]!.contentStart
  const end = includeFinalEol ? spans[last]!.lineEnd : spans[last]!.contentEnd
  return [start, end]
}

type IndentShift =
  | { kind: 'add'; prefix: string }
  | { kind: 'remove'; prefix: string }

function leadingWhitespace(line: string): string {
  const trimmed = line.trimStart()
  return line.slice(0, line.length - trimmed.length)
}

function trimEnd(line: string): string {
  return line.trimEnd()
}

function detectUniformShift(
  text: string,
  spans: LineSpan[],
  pattern: PatternLines,
  firstLine: number
): IndentShift | null {
  let shift: IndentShift | null = null
  for (let j = 0; j < pattern.lines.length; j++) {
    const fileLine = trimEnd(lineContent(text, spans[firstLine + j]!))
    const patternLine = trimEnd(pattern.lines[j]!)
    if (fileLine.trimStart() === '' && patternLine.trimStart() === '') continue

    const fileIndent = leadingWhitespace(fileLine)
    const patternIndent = leadingWhitespace(patternLine)
    let lineShift: IndentShift
    if (fileIndent.endsWith(patternIndent)) {
      lineShift = { kind: 'add', prefix: fileIndent.slice(0, fileIndent.length - patternIndent.length) }
    } else if (patternIndent.endsWith(fileIndent)) {
      lineShift = {
        kind: 'remove',
        prefix: patternIndent.slice(0, patternIndent.length - fileIndent.length)
      }
    } else {
      return null
    }

    if (!shift) {
      shift = lineShift
    } else if (shift.kind === lineShift.kind && shift.prefix === lineShift.prefix) {
      // ok
    } else {
      return null
    }
  }
  return shift ?? { kind: 'add', prefix: '' }
}

function applyShiftToReplacement(
  newString: string,
  shift: IndentShift,
  crlf: boolean
): string | null {
  const normalized = normalizeLineEndings(newString)
  const shiftedLines: string[] = []
  for (const line of normalized.split('\n')) {
    if (line.trim() === '') {
      shiftedLines.push(line)
      continue
    }
    if (shift.kind === 'add') {
      shiftedLines.push(shift.prefix + line)
    } else {
      if (!line.startsWith(shift.prefix)) return null
      shiftedLines.push(line.slice(shift.prefix.length))
    }
  }
  const joined = shiftedLines.join('\n')
  return crlf ? joined.replace(/\n/g, '\r\n') : joined
}
