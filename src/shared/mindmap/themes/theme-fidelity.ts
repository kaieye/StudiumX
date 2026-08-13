/**
 * XMind built-in-theme fidelity audit.
 *
 * Theme JSON contains resolved style properties for many XMind-only element
 * kinds. `fromXmindTheme` deliberately imports only the part of that model
 * which the StudiumX theme contract can render. Keep an explicit, value-free
 * record of that boundary so a large preset catalogue is never mistaken for
 * full XMind visual parity.
 */

import {
  emptyXmindCompatibilityReport,
  type XmindCompatibilityReport
} from '../xmind-compatibility'

type FidelityCategory = 'preserved' | 'approximated' | 'dropped' | 'warnings'
type ObjectRecord = Record<string, unknown>
type StylePropertyRecord = Record<string, unknown>

const TOPIC_STYLE_ELEMENTS = new Set(['centralTopic', 'mainTopic', 'subTopic'])
const KNOWN_STYLE_ELEMENTS = new Set([
  'centralTopic',
  'mainTopic',
  'subTopic',
  'floatingTopic',
  'boundary',
  'calloutTopic',
  'relationship',
  'summary',
  'summaryTopic',
  'minorTopic',
  'importantTopic',
  'expiredTopic'
])

/**
 * Audit one source XMind theme. Findings identify stable theme-property paths
 * and conversion outcomes, but never include source values (fonts, colours,
 * or foreign payloads). A report is produced independently for every preset.
 */
export function buildXmindThemeFidelityReport(source: unknown): XmindCompatibilityReport {
  const report = emptyXmindCompatibilityReport()
  const json = asObject(source)
  if (!json) {
    add(report, 'warnings', 'theme', 'Theme JSON is not an object')
    return report
  }

  const content = asObject(json.content)
  if (!content) {
    add(report, 'warnings', 'theme.content', 'Theme content is not an object')
    return report
  }

  if (typeof content.id === 'string' && content.id.length > 0) {
    add(
      report,
      'approximated',
      'content.id',
      'XMind theme id is represented by the built-in preset id rather than retained verbatim'
    )
  } else if (content.id !== undefined) {
    add(report, 'dropped', 'content.id', 'Malformed XMind theme id is not retained')
  }

  for (const [elementName, rawElement] of Object.entries(content)) {
    if (elementName === 'id') continue
    inspectStyleElement(report, elementName, rawElement)
  }

  return report
}

function inspectStyleElement(
  report: XmindCompatibilityReport,
  elementName: string,
  rawElement: unknown
): void {
  const element = asObject(rawElement)
  const path = knownElementPath(elementName)
  if (!element) {
    add(report, 'dropped', path, 'Malformed XMind theme element is not retained')
    add(report, 'warnings', path, 'Theme element could not be inspected')
    return
  }

  if (element.type !== undefined) {
    add(
      report,
      'dropped',
      `${path}.type`,
      'XMind theme element type metadata is not retained after resolved properties are converted'
    )
  }
  if (element.styleId !== undefined) {
    add(
      report,
      'dropped',
      `${path}.styleId`,
      'XMind theme style reference metadata is not retained after resolved properties are converted'
    )
  }

  if (element.properties === undefined) return
  const properties = asObject(element.properties)
  if (!properties) {
    add(report, 'dropped', `${path}.properties`, 'Malformed XMind theme property bag is not retained')
    add(report, 'warnings', `${path}.properties`, 'Theme property bag could not be inspected')
    return
  }

  for (const property of Object.keys(properties)) {
    inspectProperty(report, elementName, property, properties)
  }
}

function inspectProperty(
  report: XmindCompatibilityReport,
  elementName: string,
  property: string,
  properties: StylePropertyRecord
): void {
  const path = `${knownElementPath(elementName)}.properties.${knownPropertyPath(property)}`

  if (elementName === 'map') {
    inspectMapProperty(report, path, property, properties[property])
    return
  }

  if (TOPIC_STYLE_ELEMENTS.has(elementName)) {
    inspectTopicStyleProperty(report, path, property, properties[property])
    return
  }

  if (KNOWN_STYLE_ELEMENTS.has(elementName)) {
    add(
      report,
      'dropped',
      path,
      'This XMind theme element has no mapped StudiumX theme layer'
    )
    return
  }

  add(report, 'dropped', path, 'Unknown XMind theme property is not retained')
}

function inspectMapProperty(
  report: XmindCompatibilityReport,
  path: string,
  property: string,
  value: unknown
): void {
  if (property === 'svg:fill') {
    if (typeof value === 'string' && value !== 'none') {
      add(report, 'preserved', path, 'Map background fill maps to the document theme background')
    } else if (value === 'none') {
      add(report, 'dropped', path, 'Explicit XMind no-fill token is not retained by the document theme')
    } else {
      add(report, 'dropped', path, 'Malformed map background fill is not retained')
    }
    return
  }

  add(report, 'dropped', path, 'Map-level XMind style property has no native theme mapping')
}

function inspectTopicStyleProperty(
  report: XmindCompatibilityReport,
  path: string,
  property: string,
  value: unknown
): void {
  switch (property) {
    case 'svg:fill':
      addFill(report, path, value)
      return
    case 'border-line-color':
      if (typeof value === 'string' && value !== 'none') {
        add(report, 'preserved', path, 'Topic border color maps to the native topic stroke')
      } else if (value === 'none') {
        add(report, 'approximated', path, 'XMind no-border color token is represented by the native border style')
      } else {
        add(report, 'dropped', path, 'Malformed topic border color is not retained')
      }
      return
    case 'border-line-width':
      addBorderWidth(report, path, value)
      return
    case 'border-line-pattern':
      addBorderPattern(report, path, value)
      return
    case 'fo:color':
      addStringProperty(report, path, value, 'Topic text color maps to the native topic text color')
      return
    case 'fo:font-family':
      addStringProperty(report, path, value, 'Topic font family maps to the native topic font family')
      return
    case 'fo:font-size':
      if (isFiniteNumberToken(value)) {
        add(report, 'approximated', path, 'XMind point font size is converted to CSS pixels')
      } else {
        add(report, 'dropped', path, 'Malformed topic font size is not retained')
      }
      return
    case 'fo:font-weight':
      if (typeof value === 'string' && value.length > 0) {
        const category: FidelityCategory = value === 'normal' || value === 'bold' ? 'approximated' : 'preserved'
        add(
          report,
          category,
          path,
          category === 'preserved'
            ? 'Topic font weight maps to the native topic font weight'
            : 'Named XMind font weight is normalized to a CSS numeric weight'
        )
      } else {
        add(report, 'dropped', path, 'Malformed topic font weight is not retained')
      }
      return
    case 'fo:font-style':
      if (value === 'normal' || value === 'italic') {
        add(report, 'preserved', path, 'Topic font style maps to the native topic font style')
      } else {
        add(report, 'dropped', path, 'Unsupported topic font style is not retained')
      }
      return
    case 'fo:text-decoration':
      addTextDecoration(report, path, value)
      return
    case 'fo:text-transform':
      addTextTransform(report, path, value)
      return
    case 'fo:text-align':
      if (value === 'left' || value === 'center' || value === 'right') {
        add(report, 'preserved', path, 'Topic text alignment maps to the native topic text alignment')
      } else {
        add(report, 'dropped', path, 'Unsupported topic text alignment is not retained')
      }
      return
    case 'shape-class':
      if (typeof value === 'string' && (value.includes('roundedRect') || value.includes('underline') || value.includes('fishbone'))) {
        add(report, 'approximated', path, 'XMind shape class is mapped to the closest native topic shape')
      } else {
        add(report, 'dropped', path, 'XMind topic shape class has no native topic-shape mapping')
      }
      return
    case 'line-color':
      if (typeof value === 'string' && value.length > 0 && path.startsWith('content.centralTopic.')) {
        add(report, 'approximated', path, 'Central-topic line color is retained only as a global fallback line token')
      } else {
        add(report, 'dropped', path, 'Topic connector color has no depth-specific native theme mapping')
      }
      return
    default:
      add(report, 'dropped', path, 'XMind topic style property has no native theme mapping')
  }
}

function addFill(report: XmindCompatibilityReport, path: string, value: unknown): void {
  if (typeof value === 'string' && value !== 'none') {
    add(report, 'preserved', path, 'Topic fill maps to the native topic fill')
  } else if (value === 'none') {
    add(report, 'dropped', path, 'Explicit XMind no-fill token is not retained by the native topic style')
  } else {
    add(report, 'dropped', path, 'Malformed topic fill is not retained')
  }
}

function addBorderWidth(report: XmindCompatibilityReport, path: string, value: unknown): void {
  const width = typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  if (width === 0) {
    add(report, 'approximated', path, 'Zero XMind border width is represented by the native no-border style')
  } else if (Number.isFinite(width) && width > 0 && width <= 32) {
    add(report, 'preserved', path, 'Topic border width maps to the native topic border width')
  } else {
    add(report, 'dropped', path, 'Topic border width falls outside the native supported range')
  }
}

function addBorderPattern(report: XmindCompatibilityReport, path: string, value: unknown): void {
  if (value === 'solid') {
    add(report, 'preserved', path, 'Solid XMind border pattern maps to the native solid border')
  } else if (value === 'dash') {
    add(report, 'preserved', path, 'Dashed XMind border pattern maps to the native dashed border')
  } else if (value === 'dot' || value === 'dash-dot' || value === 'dash-dot-dot') {
    add(report, 'approximated', path, 'XMind border pattern is collapsed to the native dashed border')
  } else {
    add(report, 'dropped', path, 'XMind border pattern has no native border-pattern mapping')
  }
}

function addTextDecoration(report: XmindCompatibilityReport, path: string, value: unknown): void {
  if (typeof value !== 'string') {
    add(report, 'dropped', path, 'Malformed topic text decoration is not retained')
    return
  }
  const tokens = new Set(value.trim().split(/\s+/).filter(Boolean))
  const supported = tokens.has('none') || tokens.has('underline') || tokens.has('line-through')
  if (supported) {
    add(report, 'preserved', path, 'Topic text decoration maps to the native topic text decoration')
  } else {
    add(report, 'dropped', path, 'XMind text decoration has no native topic-style mapping')
  }
}

function addTextTransform(report: XmindCompatibilityReport, path: string, value: unknown): void {
  if (value === 'manual') {
    add(report, 'approximated', path, 'XMind manual text transform is represented by the native no-transform token')
  } else if (value === 'none' || value === 'uppercase' || value === 'lowercase' || value === 'capitalize') {
    add(report, 'preserved', path, 'Topic text transform maps to the native topic text transform')
  } else {
    add(report, 'dropped', path, 'XMind text transform has no native topic-style mapping')
  }
}

function addStringProperty(
  report: XmindCompatibilityReport,
  path: string,
  value: unknown,
  reason: string
): void {
  if (typeof value === 'string' && value.length > 0) {
    add(report, 'preserved', path, reason)
  } else {
    add(report, 'dropped', path, 'Malformed XMind topic style value is not retained')
  }
}

function add(
  report: XmindCompatibilityReport,
  category: FidelityCategory,
  path: string,
  reason: string
): void {
  const existing = report[category].find((finding) => finding.path === path && finding.reason === reason)
  if (existing) {
    existing.count += 1
    return
  }
  report[category].push({ path, count: 1, reason })
}

function knownElementPath(name: string): string {
  return KNOWN_STYLE_ELEMENTS.has(name) || name === 'map'
    ? `content.${name}`
    : 'content.<unknown-element>'
}

function knownPropertyPath(name: string): string {
  return /^[a-z]+(?::[a-z-]+)?(?:-[a-z]+)*$/.test(name)
    ? name
    : '<unknown-property>'
}

function isFiniteNumberToken(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Number.parseFloat(value))
}

function asObject(value: unknown): ObjectRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as ObjectRecord
    : null
}
