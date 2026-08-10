/**
 * Pure OPML 2.0 tree import for the subset emitted by
 * `mindMapDocumentToOpml`.
 *
 * A small namespace-free XML reader is used instead of a DOM dependency. It
 * rejects DTD/CDATA and unknown entities, never executes markup, and accepts
 * only outline attributes needed for title, notes and stable ids.
 */
import type { MindMapSheetV2, MindMapTopicV2 } from './domain/types'
import {
  buildImportedMindMapDocument,
  defaultImportStructureClass,
  importFailure,
  isNonEmptyImportId,
  type MindMapImportError,
  type MindMapImportOptions,
  type MindMapImportResult
} from './import-types'

const MAX_OPML_BYTES = 2 * 1024 * 1024
const MAX_XML_NODES = 100_000
const MAX_XML_DEPTH = 256
const MAX_XML_ATTRIBUTE_LENGTH = 16_384

export type MindMapOpmlImportOptions = MindMapImportOptions

type XmlNode = {
  name: string
  attributes: Record<string, string>
  children: XmlNode[]
  text: string
}

type XmlParseResult =
  | { ok: true; root: XmlNode }
  | { ok: false; message: string }

type ImportContext = {
  usedIds: Set<string>
  sheetIndex: number
  topicCount: number
}

type ImportValueResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MindMapImportError }

/** Parse OPML 2.0 into a tree-only v2 document. */
export function mindMapOpmlToDocument(
  opml: string,
  options: MindMapOpmlImportOptions = {}
): MindMapImportResult {
  if (typeof opml !== 'string' || opml.trim().length === 0) {
    return importFailure('EMPTY_INPUT', 'OPML input must not be empty')
  }
  if (new TextEncoder().encode(opml).byteLength > MAX_OPML_BYTES) {
    return importFailure('INVALID_FORMAT', `OPML input exceeds ${MAX_OPML_BYTES} bytes`)
  }

  const parsed = parseXml(opml)
  if (!parsed.ok) return importFailure('INVALID_FORMAT', parsed.message)
  if (parsed.root.name !== 'opml') {
    return importFailure('INVALID_FORMAT', 'OPML root element must be <opml>')
  }
  if (parsed.root.attributes.version !== undefined && parsed.root.attributes.version !== '2.0') {
    return importFailure(
      'UNSUPPORTED_FEATURE',
      `Only OPML version 2.0 is supported (received ${parsed.root.attributes.version})`
    )
  }

  const head = parsed.root.children.find((child) => child.name === 'head')
  const body = parsed.root.children.find((child) => child.name === 'body')
  if (!body) return importFailure('INVALID_STRUCTURE', 'OPML must contain a <body> element')

  const topOutlines = body.children.filter((child) => child.name === 'outline')
  if (topOutlines.length === 0) {
    return importFailure('INVALID_STRUCTURE', 'OPML body must contain at least one outline')
  }
  if (body.children.some((child) => child.name !== 'outline')) {
    return importFailure('UNSUPPORTED_FEATURE', 'Only outline elements are supported in OPML body')
  }

  const context: ImportContext = { usedIds: new Set<string>(), sheetIndex: 0, topicCount: 0 }
  const sheets: MindMapSheetV2[] = []
  for (const outline of topOutlines) {
    context.sheetIndex += 1
    context.topicCount = 0
    const sheet = importSheet(outline, context, options)
    if (!sheet.ok) return sheet
    sheets.push(sheet.value)
  }

  const titleNode = head?.children.find((child) => child.name === 'title')
  const title = (titleNode?.text ?? '').trim() || sheets[0]?.title || 'Imported mind map'
  return buildImportedMindMapDocument(title, sheets, options)
}

function importSheet(
  outline: XmlNode,
  context: ImportContext,
  options: MindMapOpmlImportOptions
): ImportValueResult<MindMapSheetV2> {
  const sheetTitle = outline.attributes.text?.trim()
  if (!sheetTitle) {
    return importFailure('INVALID_STRUCTURE', 'Every top-level outline needs a non-empty text attribute')
  }

  const explicitSheetId = outline.attributes._studiumx_sheet_id
  if (explicitSheetId !== undefined && !isNonEmptyImportId(explicitSheetId)) {
    return importFailure('INVALID_STRUCTURE', 'A sheet id attribute must not be empty')
  }
  const sheetId = takeId(
    explicitSheetId,
    `sheet-${context.sheetIndex}`,
    context.usedIds
  )
  if (!sheetId.ok) return sheetId

  const childOutlines = outline.children.filter((child) => child.name === 'outline')
  if (outline.children.some((child) => child.name !== 'outline')) {
    return importFailure('UNSUPPORTED_FEATURE', 'Only nested outline elements are supported')
  }

  // The StudiumX exporter wraps each sheet in one outline. With private ids the
  // wrapper is unambiguous; without them, one child and no topic id is the
  // compatible fallback for the `includeIds: false` export shape.
  const isSheetWrapper =
    explicitSheetId !== undefined ||
    (outline.attributes._studiumx_topic_id === undefined && childOutlines.length === 1)
  const rootOutline = isSheetWrapper ? childOutlines[0] : outline
  if (!rootOutline) {
    return importFailure('INVALID_STRUCTURE', 'A sheet wrapper must contain one root outline')
  }

  const root = importTopic(rootOutline, context)
  if (!root.ok) return root
  return {
    ok: true,
    value: {
      id: sheetId.value,
      title: sheetTitle,
      root: root.value,
      elements: [],
      layout: { structureClass: defaultImportStructureClass(options) }
    }
  }
}

function importTopic(
  outline: XmlNode,
  context: ImportContext
): ImportValueResult<MindMapTopicV2> {
  const title = outline.attributes.text?.trim()
  if (!title) {
    return importFailure('INVALID_STRUCTURE', 'Every topic outline needs a non-empty text attribute')
  }
  if (outline.children.some((child) => child.name !== 'outline')) {
    return importFailure('UNSUPPORTED_FEATURE', 'Only nested outline elements are supported')
  }

  const explicitTopicId = outline.attributes._studiumx_topic_id
  if (explicitTopicId !== undefined && !isNonEmptyImportId(explicitTopicId)) {
    return importFailure('INVALID_STRUCTURE', 'A topic id attribute must not be empty')
  }
  context.topicCount += 1
  const id = takeId(
    explicitTopicId,
    `sheet-${context.sheetIndex}-topic-${context.topicCount}`,
    context.usedIds
  )
  if (!id.ok) return id

  const note = outline.attributes.description?.trim()
  const children: MindMapTopicV2[] = []
  for (const child of outline.children) {
    const imported = importTopic(child, context)
    if (!imported.ok) return imported
    children.push(imported.value)
  }

  return {
    ok: true,
    value: {
      id: id.value,
      title,
      ...(note ? { note } : {}),
      children
    }
  }
}

function takeId(
  candidate: string | undefined,
  fallback: string,
  usedIds: Set<string>
): ImportValueResult<string> {
  const id = candidate ?? fallback
  if (!isNonEmptyImportId(id)) {
    return importFailure('INVALID_FORMAT', 'Imported ids must be non-empty strings')
  }
  if (usedIds.has(id)) {
    return importFailure('DUPLICATE_ID', `Duplicate imported id "${id}"`)
  }
  usedIds.add(id)
  return { ok: true, value: id }
}

function parseXml(source: string): XmlParseResult {
  let position = 0
  let nodeCount = 0
  let root: XmlNode | null = null
  const stack: XmlNode[] = []

  while (position < source.length) {
    if (source[position] !== '<') {
      const next = source.indexOf('<', position)
      const end = next < 0 ? source.length : next
      const text = decodeXmlEntities(source.slice(position, end))
      if (text === null) return { ok: false, message: 'OPML contains an unknown or invalid XML entity' }
      if (stack.length === 0) {
        if (text.trim().length > 0) return { ok: false, message: 'Non-whitespace text is outside the OPML root' }
      } else {
        stack[stack.length - 1]!.text += text
      }
      position = end
      continue
    }

    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4)
      if (end < 0) return { ok: false, message: 'Unterminated XML comment' }
      position = end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', position) || source.slice(position, position + 9).toUpperCase() === '<!DOCTYPE') {
      return { ok: false, message: 'OPML does not accept CDATA or DTD declarations' }
    }
    if (source.startsWith('<?', position)) {
      const end = source.indexOf('?>', position + 2)
      if (end < 0) return { ok: false, message: 'Unterminated XML processing instruction' }
      position = end + 2
      continue
    }

    const tagEnd = findTagEnd(source, position + 1)
    if (tagEnd < 0) return { ok: false, message: 'Unterminated XML tag' }
    const rawTag = source.slice(position + 1, tagEnd)
    const closing = rawTag.startsWith('/')
    if (closing) {
      const name = rawTag.slice(1).trim()
      if (!isXmlName(name) || stack.length === 0 || stack[stack.length - 1]!.name !== name) {
        return { ok: false, message: `Mismatched XML closing tag "${name}"` }
      }
      stack.pop()
      position = tagEnd + 1
      continue
    }

    const selfClosing = /\/\s*$/.test(rawTag)
    const tagContent = selfClosing ? rawTag.replace(/\/\s*$/, '') : rawTag
    const parsedTag = parseTag(tagContent)
    if (!parsedTag.ok) return parsedTag
    nodeCount += 1
    if (nodeCount > MAX_XML_NODES) return { ok: false, message: `OPML exceeds ${MAX_XML_NODES} XML nodes` }
    if (stack.length >= MAX_XML_DEPTH) return { ok: false, message: `OPML exceeds XML depth ${MAX_XML_DEPTH}` }
    if (root && stack.length === 0) return { ok: false, message: 'OPML contains multiple root elements' }

    const node: XmlNode = {
      name: parsedTag.name,
      attributes: parsedTag.attributes,
      children: [],
      text: ''
    }
    if (stack.length > 0) stack[stack.length - 1]!.children.push(node)
    else root = node
    if (!selfClosing) stack.push(node)
    position = tagEnd + 1
  }

  if (stack.length > 0) return { ok: false, message: 'OPML contains an unclosed XML element' }
  if (!root) return { ok: false, message: 'OPML XML document is empty' }
  return { ok: true, root }
}

type ParsedTag =
  | { ok: true; name: string; attributes: Record<string, string> }
  | { ok: false; message: string }

function parseTag(source: string): ParsedTag {
  let index = 0
  while (index < source.length && /\s/.test(source[index]!)) index += 1
  const nameStart = index
  while (index < source.length && !/[\s=]/.test(source[index]!)) index += 1
  const name = source.slice(nameStart, index)
  if (!isXmlName(name)) return { ok: false, message: `Invalid XML element name "${name}"` }

  const attributes: Record<string, string> = {}
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index]!)) index += 1
    if (index >= source.length) break
    const attrStart = index
    while (index < source.length && !/[\s=]/.test(source[index]!)) index += 1
    const attrName = source.slice(attrStart, index)
    if (!isXmlName(attrName) || attrName in attributes) {
      return { ok: false, message: `Invalid or duplicate XML attribute "${attrName}"` }
    }
    while (index < source.length && /\s/.test(source[index]!)) index += 1
    if (source[index] !== '=') return { ok: false, message: `XML attribute "${attrName}" needs a value` }
    index += 1
    while (index < source.length && /\s/.test(source[index]!)) index += 1
    const quote = source[index]
    if (quote !== '"' && quote !== "'") {
      return { ok: false, message: `XML attribute "${attrName}" must be quoted` }
    }
    index += 1
    const valueStart = index
    while (index < source.length && source[index] !== quote) index += 1
    if (index >= source.length) return { ok: false, message: `Unterminated XML attribute "${attrName}"` }
    const rawValue = source.slice(valueStart, index)
    if (rawValue.length > MAX_XML_ATTRIBUTE_LENGTH) {
      return { ok: false, message: `XML attribute "${attrName}" is too long` }
    }
    const value = decodeXmlEntities(rawValue)
    if (value === null) return { ok: false, message: `XML attribute "${attrName}" has an invalid entity` }
    attributes[attrName] = value
    index += 1
  }
  return { ok: true, name, attributes }
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '>') {
      return index
    }
  }
  return -1
}

function isXmlName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value)
}

function decodeXmlEntities(value: string): string | null {
  let invalid = false
  const decoded = value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (entity, body: string) => {
    if (body === 'amp') return '&'
    if (body === 'lt') return '<'
    if (body === 'gt') return '>'
    if (body === 'quot') return '"'
    if (body === 'apos') return "'"
    const codePoint = body.startsWith('#x')
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10)
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      invalid = true
      return entity
    }
    return String.fromCodePoint(codePoint)
  })
  if (invalid || /&[^;\s]+;/.test(decoded) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded)) {
    return null
  }
  return decoded
}
