/**
 * Convert Xmind theme JSON (from the app.asar `static/styles/themes/` directory)
 * into StudiumX's {@link MindMapTheme} shape.
 *
 * Xmind stores theme properties under `content.<element>.properties` with namespaced
 * keys like `fo:font-size`, `svg:fill`, `line-width`, etc. This converter maps the
 * ones we care about (centralTopic, mainTopic, subTopic, map, relationship) into our
 * flat `MindMapTheme` + `topicStyles` structure.
 *
 * Only style parameters (colours, font sizes, weights, line widths) are extracted —
 * these are non-copyrightable functional parameters, not Xmind's fonts or images.
 */

import type { MindMapTheme } from '../domain/types'
import type { MindMapTopicStyleOverride } from '../domain/types'

/** Raw shape of a single Xmind style element. */
interface XmindStyleElement {
  properties?: Record<string, string>
  type?: string
  styleId?: string
}

/** Raw shape of an Xmind theme JSON file. */
interface XmindThemeJson {
  name: string
  content: {
    id: string
    centralTopic?: XmindStyleElement
    mainTopic?: XmindStyleElement
    subTopic?: XmindStyleElement
    map?: XmindStyleElement
    relationship?: XmindStyleElement
    floatingTopic?: XmindStyleElement
    boundary?: XmindStyleElement
    calloutTopic?: XmindStyleElement
    summary?: XmindStyleElement
    summaryTopic?: XmindStyleElement
  }
}

/** Convert pt to px (Xmind uses pt; CSS/SVG uses px; 1pt = 4/3 px). */
function ptToPx(pt: string | undefined): number | undefined {
  if (!pt) return undefined
  const n = parseFloat(pt)
  if (!Number.isFinite(n)) return undefined
  return Math.round((n * 4) / 3)
}

/** Map Xmind font-weight to CSS font-weight string. */
function mapFontWeight(w: string | undefined): string | undefined {
  if (!w) return undefined
  if (w === 'normal') return '400'
  if (w === 'bold') return '700'
  return w
}

function mapTextDecoration(
  value: string | undefined
): MindMapTopicStyleOverride['textDecoration'] | undefined {
  if (!value) return undefined
  const tokens = new Set(value.trim().split(/\s+/).filter(Boolean))
  if (tokens.has('underline') && tokens.has('line-through')) return 'line-through underline'
  if (tokens.has('underline')) return 'underline'
  if (tokens.has('line-through')) return 'line-through'
  if (tokens.has('none')) return 'none'
  return undefined
}

/** XMind calls the no-transform token `manual`; the native model calls it `none`. */
function mapTextTransform(
  value: string | undefined
): MindMapTopicStyleOverride['textTransform'] | undefined {
  const normalized = value?.trim()
  switch (normalized) {
    case 'manual':
    case 'none':
      return 'none'
    case 'uppercase':
    case 'lowercase':
    case 'capitalize':
      return normalized
    default:
      return undefined
  }
}

/** Map Xmind shape-class to our internal shape names. */
function mapShape(shapeClass: string | undefined): string | undefined {
  if (!shapeClass) return undefined
  if (shapeClass.includes('roundedRect')) return 'roundedRect'
  if (shapeClass.includes('underline')) return 'underline'
  if (shapeClass.includes('fishbone')) return 'fishbone'
  return undefined
}

function parseBorderWidth(value: string | undefined): number | undefined {
  if (!value) return undefined
  const width = Number.parseFloat(value)
  return Number.isFinite(width) && width > 0 && width <= 32 ? width : undefined
}

function mapBorderStyle(properties: Record<string, string>): MindMapTopicStyleOverride['borderStyle'] | undefined {
  const width = Number.parseFloat(properties['border-line-width'] ?? '')
  const color = properties['border-line-color']
  if (width === 0 || color === 'none') return 'none'
  switch (properties['border-line-pattern']) {
    case 'dash':
    case 'dot':
    case 'dash-dot':
    case 'dash-dot-dot':
      return 'dash'
    case 'solid':
      return 'solid'
    default:
      return Number.isFinite(width) && width > 0 || Boolean(color) ? 'solid' : undefined
  }
}

/** Extract a MindMapTopicStyleOverride from an Xmind style element. */
function extractTopicStyle(el: XmindStyleElement | undefined): MindMapTopicStyleOverride | undefined {
  if (!el?.properties) return undefined
  const p = el.properties
  const style: MindMapTopicStyleOverride = {}
  if (p['svg:fill'] && p['svg:fill'] !== 'none') style.fill = p['svg:fill']
  if (p['border-line-color'] && p['border-line-color'] !== 'none') style.stroke = p['border-line-color']
  const borderStyle = mapBorderStyle(p)
  if (borderStyle !== undefined) style.borderStyle = borderStyle
  const borderWidth = parseBorderWidth(p['border-line-width'])
  if (borderWidth !== undefined) style.borderWidth = borderWidth
  if (p['fo:color']) style.textColor = p['fo:color']
  if (p['fo:font-family']) style.fontFamily = p['fo:font-family']
  const size = ptToPx(p['fo:font-size'])
  if (size !== undefined) style.fontSize = size
  const weight = mapFontWeight(p['fo:font-weight'])
  if (weight !== undefined) style.fontWeight = weight
  if (p['fo:font-style'] === 'italic' || p['fo:font-style'] === 'normal') {
    style.fontStyle = p['fo:font-style']
  }
  const textDecoration = mapTextDecoration(p['fo:text-decoration'])
  if (textDecoration !== undefined) style.textDecoration = textDecoration
  const textTransform = mapTextTransform(p['fo:text-transform'])
  if (textTransform !== undefined) style.textTransform = textTransform
  if (p['fo:text-align'] === 'left' || p['fo:text-align'] === 'center' || p['fo:text-align'] === 'right') {
    style.textAlign = p['fo:text-align']
  }
  const shape = mapShape(p['shape-class'])
  if (shape !== undefined) style.shape = shape
  return Object.keys(style).length > 0 ? style : undefined
}

/**
 * Convert an Xmind theme JSON object to a {@link MindMapTheme}.
 *
 * @param json - Parsed Xmind theme JSON (from `static/styles/themes/*.json`).
 * @param id - Theme id to assign (defaults to the Xmind name, e.g. "M01").
 * @returns A `MindMapTheme` with extracted style parameters.
 */
export function fromXmindTheme(json: XmindThemeJson, id?: string): MindMapTheme {
  const c = json.content
  const props = (el: XmindStyleElement | undefined) => el?.properties ?? {}

  const mapProps = props(c.map)
  const centralProps = props(c.centralTopic)

  const theme: MindMapTheme = {
    id: id ?? json.name,
    name: json.name
  }

  // Map fill -> background
  if (mapProps['svg:fill'] && mapProps['svg:fill'] !== 'none') {
    theme.background = mapProps['svg:fill']
  }

  // Central topic text color -> theme textColor (for root)
  if (centralProps['fo:color']) {
    theme.textColor = centralProps['fo:color']
  }

  // Line color from central topic
  if (centralProps['line-color']) {
    theme.lineColor = centralProps['line-color']
  }

  // Font family from central topic
  if (centralProps['fo:font-family']) {
    theme.fontFamily = centralProps['fo:font-family']
  }

  // Shape from subTopic if present
  const subShape = mapShape(props(c.subTopic)['shape-class'])
  if (subShape) theme.shape = subShape

  // topicStyles: layered per-depth defaults
  const topicStyles: MindMapTheme['topicStyles'] = {}
  const central = extractTopicStyle(c.centralTopic)
  const main = extractTopicStyle(c.mainTopic)
  const sub = extractTopicStyle(c.subTopic)
  if (central) topicStyles.central = central
  if (main) topicStyles.main = main
  if (sub) topicStyles.sub = sub
  if (Object.keys(topicStyles).length > 0) theme.topicStyles = topicStyles

  return theme
}

/** Load and convert an Xmind theme JSON by importing it at build time. */
export async function loadXmindTheme(name: string): Promise<MindMapTheme> {
  const mod = await import(`./xmind/${name}.json`)
  return fromXmindTheme(mod.default ?? mod, name)
}
