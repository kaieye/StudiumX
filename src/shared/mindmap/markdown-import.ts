/**
 * Pure Markdown import for the deliberately small tree/notes subset emitted by
 * `mindMapDocumentToMarkdown`.
 *
 * This is not a general Markdown renderer. Unsupported prose, headings,
 * indentation and list forms fail closed instead of being silently converted
 * into topics. Topic ids are deterministic when Markdown has no id metadata.
 */
import type { MindMapSheetV2, MindMapTopicV2 } from './domain/types'
import {
  buildImportedMindMapDocument,
  defaultImportStructureClass,
  importFailure,
  isNonEmptyImportId,
  type MindMapImportOptions,
  type MindMapImportResult
} from './import-types'

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024
const MAX_MARKDOWN_LINES = 100_000
const MAX_MARKDOWN_LINE_LENGTH = 16_384

export type MindMapMarkdownImportOptions = MindMapImportOptions

type TopicFrame = {
  depth: number
  topic: MindMapTopicV2
}

type SheetBuilder = {
  id: string
  title: string
  root: MindMapTopicV2 | null
  topicCount: number
}

/** Parse the Markdown subset produced by `mindMapDocumentToMarkdown`. */
export function mindMapMarkdownToDocument(
  markdown: string,
  options: MindMapMarkdownImportOptions = {}
): MindMapImportResult {
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    return importFailure('EMPTY_INPUT', 'Markdown input must not be empty')
  }
  if (new TextEncoder().encode(markdown).byteLength > MAX_MARKDOWN_BYTES) {
    return importFailure('INVALID_FORMAT', `Markdown input exceeds ${MAX_MARKDOWN_BYTES} bytes`)
  }

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > MAX_MARKDOWN_LINES) {
    return importFailure('INVALID_FORMAT', `Markdown input exceeds ${MAX_MARKDOWN_LINES} lines`)
  }

  let documentTitle: string | null = null
  let currentSheet: SheetBuilder | null = null
  let stack: TopicFrame[] = []
  const sheets: MindMapSheetV2[] = []
  const usedIds = new Set<string>()

  const finishSheet = (line: number): MindMapImportResult | null => {
    if (!currentSheet) return null
    if (!currentSheet.root) {
      return importFailure('INVALID_STRUCTURE', 'Each Markdown sheet must contain exactly one root topic', {
        line
      })
    }
    sheets.push({
      id: currentSheet.id,
      title: currentSheet.title,
      root: currentSheet.root,
      elements: [],
      layout: { structureClass: defaultImportStructureClass(options) }
    })
    currentSheet = null
    stack = []
    return null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const line = lines[index] ?? ''
    if (line.length > MAX_MARKDOWN_LINE_LENGTH) {
      return importFailure(
        'INVALID_FORMAT',
        `Markdown line exceeds ${MAX_MARKDOWN_LINE_LENGTH} characters`,
        { line: lineNumber }
      )
    }
    if (line.trim().length === 0) continue

    // Image links are an interoperable presentation detail. Exact image
    // placement and bytes are restored from the neighbouring StudiumX
    // sidecar manifest; the tree parser intentionally ignores these lines.
    if (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line)) continue

    if (documentTitle === null) {
      const heading = /^#(?!#)\s+(.+?)\s*$/.exec(line)
      if (!heading) {
        return importFailure(
          'INVALID_FORMAT',
          'Markdown must start with a level-one document heading',
          { line: lineNumber }
        )
      }
      documentTitle = normalizeMarkdownText(heading[1] ?? '')
      if (documentTitle.length === 0) {
        return importFailure('INVALID_FORMAT', 'Document heading must not be empty', {
          line: lineNumber
        })
      }
      continue
    }

    const sheetHeading = /^##(?!#)\s+(.+?)\s*$/.exec(line)
    if (sheetHeading) {
      const finished = finishSheet(lineNumber)
      if (finished) return finished

      const title = normalizeMarkdownText(sheetHeading[1] ?? '')
      if (title.length === 0) {
        return importFailure('INVALID_FORMAT', 'Sheet heading must not be empty', {
          line: lineNumber
        })
      }
      const sheetIndex = sheets.length + 1
      const sheetId = allocateId(`sheet-${sheetIndex}`, usedIds)
      currentSheet = { id: sheetId, title, root: null, topicCount: 0 }
      continue
    }

    if (/^#{1,6}\s/.test(line)) {
      return importFailure(
        'UNSUPPORTED_FEATURE',
        'Only one document heading and level-two sheet headings are supported',
        { line: lineNumber }
      )
    }

    const note = /^(\s*)>\s?(.*?)\s*$/.exec(line)
    if (note) {
      if (!currentSheet) {
        return importFailure('INVALID_STRUCTURE', 'A note must belong to a Markdown sheet', {
          line: lineNumber
        })
      }
      const indent = parseIndent(note[1] ?? '', lineNumber)
      if (typeof indent !== 'number') return indent
      const targetDepth = indent / 2 - 1
      const target = stack[targetDepth]
      if (targetDepth < 0 || !target || target.depth !== targetDepth) {
        return importFailure(
          'INVALID_STRUCTURE',
          'A note must be indented exactly one level below its topic',
          { line: lineNumber }
        )
      }
      const text = normalizeMarkdownText(note[2] ?? '')
      if (text.length > 0) {
        target.topic.note = target.topic.note ? `${target.topic.note}\n${text}` : text
      }
      continue
    }

    const bullet = /^(\s*)-\s+(.+?)\s*$/.exec(line)
    if (bullet) {
      if (!currentSheet) {
        return importFailure('INVALID_STRUCTURE', 'A topic must belong to a Markdown sheet', {
          line: lineNumber
        })
      }
      const indent = parseIndent(bullet[1] ?? '', lineNumber)
      if (typeof indent !== 'number') return indent
      const depth = indent / 2
      while (stack.length > depth) stack.pop()
      if (depth > stack.length) {
        return importFailure(
          'INVALID_STRUCTURE',
          'Topic indentation skipped a parent level',
          { line: lineNumber }
        )
      }

      const title = normalizeMarkdownText(bullet[2] ?? '')
      if (title.length === 0) {
        return importFailure('INVALID_FORMAT', 'Topic title must not be empty', {
          line: lineNumber
        })
      }
      if (depth === 0 && currentSheet.root) {
        return importFailure(
          'INVALID_STRUCTURE',
          'Each Markdown sheet must contain exactly one root topic',
          { line: lineNumber }
        )
      }

      currentSheet.topicCount += 1
      const id = allocateId(`${currentSheet.id}-topic-${currentSheet.topicCount}`, usedIds)
      const topic: MindMapTopicV2 = { id, title, children: [] }
      const parent = depth === 0 ? null : stack[depth - 1]
      if (depth > 0 && !parent) {
        return importFailure('INVALID_STRUCTURE', 'Topic has no parent at its indentation depth', {
          line: lineNumber
        })
      }
      if (parent) parent.topic.children.push(topic)
      else currentSheet.root = topic
      stack[depth] = { depth, topic }
      continue
    }

    return importFailure(
      'UNSUPPORTED_FEATURE',
      'Markdown contains a construct outside the supported heading/list/note subset',
      { line: lineNumber }
    )
  }

  const finished = finishSheet(lines.length)
  if (finished) return finished
  if (documentTitle === null) {
    return importFailure('INVALID_FORMAT', 'Markdown document heading is missing')
  }
  if (sheets.length === 0) {
    return importFailure('INVALID_STRUCTURE', 'Markdown must contain at least one sheet')
  }

  return buildImportedMindMapDocument(documentTitle, sheets, options)
}

function parseIndent(value: string, line: number): number | MindMapImportResult {
  if (value.includes('\t')) {
    return importFailure('INVALID_FORMAT', 'Tabs are not supported for Markdown indentation', {
      line
    })
  }
  if (value.length % 2 !== 0) {
    return importFailure('INVALID_STRUCTURE', 'Markdown indentation must use two-space levels', {
      line
    })
  }
  return value.length
}

function normalizeMarkdownText(value: string): string {
  return value.replace(/[\t ]+/g, ' ').trim()
}

function allocateId(candidate: string, usedIds: Set<string>): string {
  if (!isNonEmptyImportId(candidate) || usedIds.has(candidate)) {
    throw new Error(`Unable to allocate unique imported id "${candidate}"`)
  }
  usedIds.add(candidate)
  return candidate
}
