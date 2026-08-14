/**
 * Pure SVG serialization boundary for an already-laid-out mind map.
 *
 * The renderer can pass `computeMindMapLayout(sheet)` into this module later
 * without exposing DOM/React or adding an IPC/file-save dependency here. The
 * serializer emits only static SVG primitives (no foreignObject, scripts, or
 * external styles), which keeps the export artifact safe to hand to a writer.
 */

export type MindMapSvgNode = {
  id: string
  title: string
  x: number
  y: number
  width: number
  height: number
  collapsed?: boolean
}

export type MindMapSvgEdge = {
  from: string
  to: string
  /** Optional label for a sheet-level relationship edge. */
  label?: string
}

export type MindMapSvgExportInput = {
  title: string
  nodes: readonly MindMapSvgNode[]
  edges: readonly MindMapSvgEdge[]
  /**
   * Optional resolved appearance carried on the input itself so a caller can
   * attach theme-derived colors without a separate transport field. Optional
   * and backward compatible: omitted inputs keep the serializer defaults.
   */
  options?: MindMapSvgExportOptions
}

export type MindMapSvgExportOptions = {
  padding?: number
  background?: string
  nodeFill?: string
  nodeStroke?: string
  edgeStroke?: string
  textColor?: string
  fontFamily?: string
}

/** Pixel dimensions used when a static SVG is rasterized for PNG export. */
export type MindMapSvgExportDimensions = {
  width: number
  height: number
}

/** Local technical bounds for a static export artifact. */
export const MIND_MAP_SVG_EXPORT_LIMITS = {
  maxNodes: 20_000,
  maxEdges: 40_000,
  maxCoordinate: 1_000_000,
  maxTextLength: 65_536
} as const

const DEFAULT_PADDING = 48
const DEFAULT_BACKGROUND = '#ffffff'
const DEFAULT_NODE_FILL = '#ffffff'
const DEFAULT_NODE_STROKE = '#64748b'
const DEFAULT_EDGE_STROKE = '#94a3b8'
const DEFAULT_TEXT_COLOR = '#0f172a'
const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif'
const EDGE_CONTROL_GAP = 40

/**
 * Serialize an already-laid-out map to a standalone static SVG document.
 *
 * Nodes are translated into a tight padded viewBox, so negative coordinates
 * from a left/balanced layout remain exportable without clipping. Invalid
 * geometry, duplicate ids, and dangling edges fail closed before serialization.
 */
export function serializeMindMapSvg(
  input: MindMapSvgExportInput,
  options: MindMapSvgExportOptions = {}
): string {
  validateMindMapSvgExportInput(input)
  // Explicit `options` override any options embedded on the input so callers
  // keep a deterministic escape hatch, while the input can carry resolved
  // appearance across a transport seam (PNG/SVG file export).
  const resolved: MindMapSvgExportOptions = { ...(input.options ?? {}), ...options }
  const padding = validatePadding(resolved.padding ?? DEFAULT_PADDING)
  const background = safePaint(resolved.background, DEFAULT_BACKGROUND)
  const nodeFill = safePaint(resolved.nodeFill, DEFAULT_NODE_FILL)
  const nodeStroke = safePaint(resolved.nodeStroke, DEFAULT_NODE_STROKE)
  const edgeStroke = safePaint(resolved.edgeStroke, DEFAULT_EDGE_STROKE)
  const textColor = safePaint(resolved.textColor, DEFAULT_TEXT_COLOR)
  const fontFamily = safeFontFamily(resolved.fontFamily, DEFAULT_FONT_FAMILY)

  const bounds = calculateBounds(input.nodes)
  const width = bounds.right - bounds.left + padding * 2
  const height = bounds.bottom - bounds.top + padding * 2
  const translateX = padding - bounds.left
  const translateY = padding - bounds.top
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const title = input.title.trim() || 'Mind map'
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}" role="img" aria-label="${escapeXmlAttribute(title)}">`,
    `  <title>${escapeXmlText(title)}</title>`,
    `  <rect x="0" y="0" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="${background}" />`,
    `  <g transform="translate(${formatNumber(translateX)} ${formatNumber(translateY)})">`
  ]

  for (const edge of input.edges) {
    const from = nodeById.get(edge.from)
    const to = nodeById.get(edge.to)
    // validateInput guarantees both references exist.
    if (!from || !to) continue
    lines.push(
      `    <path d="${edgePath(from, to)}" fill="none" stroke="${edgeStroke}" stroke-width="2" />`
    )
    if (edge.label !== undefined && edge.label.length > 0) {
      lines.push(
        `    <text data-edge-label="true" x="${formatNumber(edgeLabelX(from, to))}" y="${formatNumber(edgeLabelY(from, to))}" text-anchor="middle" dominant-baseline="central" fill="${textColor}" font-family="${fontFamily}">${escapeXmlText(flattenText(edge.label))}</text>`
      )
    }
  }

  for (const node of input.nodes) {
    const collapsed = node.collapsed === true ? ' data-collapsed="true"' : ''
    lines.push(
      `    <g data-node-id="${escapeXmlAttribute(node.id)}"${collapsed}>`,
      `      <rect x="${formatNumber(node.x)}" y="${formatNumber(node.y)}" width="${formatNumber(node.width)}" height="${formatNumber(node.height)}" rx="10" fill="${nodeFill}" stroke="${nodeStroke}" />`,
      `      <text x="${formatNumber(node.x + node.width / 2)}" y="${formatNumber(node.y + node.height / 2)}" text-anchor="middle" dominant-baseline="central" fill="${textColor}" font-family="${fontFamily}">${escapeXmlText(flattenText(node.title))}</text>`,
      '    </g>'
    )
  }

  lines.push('  </g>', '</svg>', '')
  return lines.join('\n')
}

/**
 * Return bounded integer pixel dimensions for rasterizing the same SVG.
 *
 * SVG viewBoxes may be fractional because layout coordinates can be fractional;
 * a canvas needs integer dimensions, so raster exports round up rather than
 * silently truncating the right/bottom edge.
 */
export function getMindMapSvgExportDimensions(
  input: MindMapSvgExportInput,
  options: Pick<MindMapSvgExportOptions, 'padding'> = {}
): MindMapSvgExportDimensions {
  validateMindMapSvgExportInput(input)
  const padding = validatePadding(options.padding ?? DEFAULT_PADDING)
  const bounds = calculateBounds(input.nodes)
  return {
    width: Math.max(1, Math.ceil(bounds.right - bounds.left + padding * 2)),
    height: Math.max(1, Math.ceil(bounds.bottom - bounds.top + padding * 2))
  }
}

/**
 * Validate an SVG export input before it crosses a serializer or file boundary.
 *
 * This is exported so IPC parsers can share the same geometry/count checks as
 * the pure serializer without ever handing malformed runtime data to it.
 */
export function validateMindMapSvgExportInput(input: MindMapSvgExportInput): void {
  if (!input || typeof input !== 'object' || typeof input.title !== 'string') {
    throw new Error('SVG export requires a title')
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
    throw new Error('SVG export requires node and edge arrays')
  }
  if (input.nodes.length > MIND_MAP_SVG_EXPORT_LIMITS.maxNodes) {
    throw new Error(
      `SVG export contains more than ${MIND_MAP_SVG_EXPORT_LIMITS.maxNodes} nodes`
    )
  }
  if (input.edges.length > MIND_MAP_SVG_EXPORT_LIMITS.maxEdges) {
    throw new Error(
      `SVG export contains more than ${MIND_MAP_SVG_EXPORT_LIMITS.maxEdges} edges`
    )
  }
  if (input.title.length > MIND_MAP_SVG_EXPORT_LIMITS.maxTextLength) {
    throw new Error('SVG export title exceeds the text safety limit')
  }
  validateMindMapSvgExportOptions(input.options)

  const ids = new Set<string>()
  for (const node of input.nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || typeof node.title !== 'string') {
      throw new Error('SVG export contains a malformed node')
    }
    if (!node.id || ids.has(node.id)) {
      throw new Error(`SVG export contains a duplicate or empty node id: ${node.id}`)
    }
    ids.add(node.id)
    if (node.title.length > MIND_MAP_SVG_EXPORT_LIMITS.maxTextLength) {
      throw new Error(`SVG node ${node.id} title exceeds the text safety limit`)
    }
    for (const value of [node.x, node.y, node.width, node.height]) {
      if (
        !Number.isFinite(value) ||
        Math.abs(value) > MIND_MAP_SVG_EXPORT_LIMITS.maxCoordinate
      ) {
        throw new Error(`SVG node ${node.id} has invalid geometry`)
      }
    }
    if (node.width <= 0 || node.height <= 0) {
      throw new Error(`SVG node ${node.id} must have positive dimensions`)
    }
    if (node.collapsed !== undefined && typeof node.collapsed !== 'boolean') {
      throw new Error(`SVG node ${node.id} has an invalid collapsed flag`)
    }
  }

  for (const edge of input.edges) {
    if (!edge || typeof edge !== 'object' || typeof edge.from !== 'string' || typeof edge.to !== 'string') {
      throw new Error('SVG export contains a malformed edge')
    }
    if (edge.label !== undefined) {
      if (typeof edge.label !== 'string') {
        throw new Error('SVG export edge label must be a string')
      }
      if (edge.label.length > MIND_MAP_SVG_EXPORT_LIMITS.maxTextLength) {
        throw new Error('SVG export edge label exceeds the text safety limit')
      }
    }
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error(`SVG export edge references a missing node: ${edge.from} -> ${edge.to}`)
    }
  }
}

function calculateBounds(nodes: readonly MindMapSvgNode[]): {
  left: number
  top: number
  right: number
  bottom: number
} {
  if (nodes.length === 0) {
    return { left: 0, top: 0, right: 1, bottom: 1 }
  }

  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const node of nodes) {
    left = Math.min(left, node.x)
    top = Math.min(top, node.y)
    right = Math.max(right, node.x + node.width)
    bottom = Math.max(bottom, node.y + node.height)
  }
  return { left, top, right, bottom }
}

function edgePath(from: MindMapSvgNode, to: MindMapSvgNode): string {
  const toRight = to.x >= from.x
  const x1 = toRight ? from.x + from.width : from.x
  const y1 = from.y + from.height / 2
  const x2 = toRight ? to.x : to.x + to.width
  const y2 = to.y + to.height / 2
  const direction = toRight ? 1 : -1
  const dx = Math.max(EDGE_CONTROL_GAP, Math.abs(x2 - x1) / 2)
  return `M ${formatNumber(x1)} ${formatNumber(y1)} C ${formatNumber(x1 + direction * dx)} ${formatNumber(y1)}, ${formatNumber(x2 - direction * dx)} ${formatNumber(y2)}, ${formatNumber(x2)} ${formatNumber(y2)}`
}

function edgeLabelX(from: MindMapSvgNode, to: MindMapSvgNode): number {
  return (from.x + from.width / 2 + to.x + to.width / 2) / 2
}

function edgeLabelY(from: MindMapSvgNode, to: MindMapSvgNode): number {
  return (from.y + from.height / 2 + to.y + to.height / 2) / 2
}

function flattenText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n+/g, ' ').replace(/[\t ]+/g, ' ').trim()
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function validatePadding(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 10_000) {
    throw new Error('SVG export padding must be a finite number between 0 and 10000')
  }
  return value
}

function safePaint(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  if (/^(?:rgb|hsl)a?\([0-9.% ,+-]+\)$/i.test(value)) return value
  if (/^[a-z]{1,32}$/i.test(value)) return value
  return fallback
}

function validateMindMapSvgExportOptions(options: MindMapSvgExportOptions | undefined): void {
  if (options === undefined) return
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('SVG export options must be a plain object')
  }
  for (const key of ['background', 'nodeFill', 'nodeStroke', 'edgeStroke', 'textColor', 'fontFamily']) {
    const value = (options as Record<string, unknown>)[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > MIND_MAP_SVG_EXPORT_LIMITS.maxTextLength) {
      throw new Error(`SVG export option ${key} must be a bounded string`)
    }
  }
  if (
    options.padding !== undefined &&
    (!Number.isFinite(options.padding) || options.padding < 0 || options.padding > 10_000)
  ) {
    throw new Error('SVG export option padding must be between 0 and 10000')
  }
}

function safeFontFamily(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback
  return /^[a-z0-9 ,_-]{1,120}$/i.test(value) ? value : fallback
}

function escapeXmlText(value: string): string {
  return escapeXml(value, false)
}

function escapeXmlAttribute(value: string): string {
  return escapeXml(value, true)
}

function escapeXml(value: string, preserveLineBreaks: boolean): string {
  let escaped = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined || !isXml10CodePoint(codePoint)) continue
    if (preserveLineBreaks && codePoint === 10) {
      escaped += '&#10;'
      continue
    }
    if (preserveLineBreaks && codePoint === 13) {
      escaped += '&#13;'
      continue
    }
    switch (character) {
      case '&':
        escaped += '&amp;'
        break
      case '<':
        escaped += '&lt;'
        break
      case '>':
        escaped += '&gt;'
        break
      case '"':
        escaped += '&quot;'
        break
      case "'":
        escaped += '&apos;'
        break
      default:
        escaped += character
    }
  }
  return escaped
}

function isXml10CodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  )
}
