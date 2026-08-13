/**
 * Pure XMind-style topic numbering.
 *
 * A topic's own `numbering` config applies to ITS CHILDREN: a topic is
 * numbered by the nearest ancestor (parent or above) that declares a
 * numbering rule, not by its own config. `pattern: 'none'` cancels inherited
 * numbering for all descendants until a deeper topic re-enables it.
 *
 * This module is deliberately dependency-free so it can be unit-tested in
 * isolation. It never mutates its inputs.
 */
import type {
  MindMapNumberingPattern,
  MindMapTopicNumbering,
  MindMapTopicV2
} from '../../../../shared/mindmap/domain/types'

/** A concrete pattern that actually numbers siblings (never `none`/undefined). */
type NumberingPattern = Exclude<MindMapNumberingPattern, 'none'>

const NUMBERING_RESTART_AT_MIN = 1
const NUMBERING_RESTART_AT_MAX = 9999

/** Format a single 1-based level index using the given pattern. */
export function formatNumberIndex(index: number, pattern: NumberingPattern): string {
  switch (pattern) {
    case 'arabic':
      return String(index)
    case 'uppercase':
      return toSpreadsheetLetters(index, true)
    case 'lowercase':
      return toSpreadsheetLetters(index, false)
    case 'roman':
      return toRoman(index)
  }
}

/** Column-style lettering: 1→A, 2→B, … 26→Z, 27→AA, 28→AB, … */
function toSpreadsheetLetters(index: number, uppercase: boolean): string {
  let n = index
  let out = ''
  while (n > 0) {
    n -= 1
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return uppercase ? out : out.toLowerCase()
}

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I']
]

function toRoman(index: number): string {
  let n = index
  let out = ''
  for (const [value, symbol] of ROMAN_TABLE) {
    while (n >= value) {
      out += symbol
      n -= value
    }
  }
  return out
}

/**
 * Compute the display number prefix for a single topic. Returns the prefix
 * string (e.g. `"2.3"`) or `null` when the topic has no number.
 */
export function computeTopicNumber(
  sheetRoot: MindMapTopicV2,
  topicId: string
): string | null {
  return computeAllTopicNumbers(sheetRoot).get(topicId) ?? null
}

/**
 * Compute the display number prefix for EVERY topic in the sheet.
 *
 * Semantics (XMind "Numbering"):
 * - A topic's own `numbering` applies to its children; the topic itself is
 *   numbered by its parent/ancestor rule.
 * - `pattern` formats each sibling level (arabic/uppercase/lowercase/roman).
 * - `tiered: true` prepends the ancestor chain (2.1.3).
 * - `restartAt` restarts this topic's children at that index instead of 1.
 * - `pattern: 'none'` cancels inherited numbering for descendants.
 * - A child with no config inherits the nearest ancestor's rule; the root and
 *   topics above any configured rule get no prefix.
 */
export function computeAllTopicNumbers(sheetRoot: MindMapTopicV2): Map<string, string> {
  const result = new Map<string, string>()
  const rootRule = numberingRuleForChildren(sheetRoot)
  for (const [childIndex, child] of sheetRoot.children.entries()) {
    visitNode(child, childIndex, rootRule, null, result)
  }
  return result
}

function visitNode(
  node: MindMapTopicV2,
  siblingIndex: number,
  governingRule: MindMapTopicNumbering | null,
  parentNumber: string | null,
  result: Map<string, string>
): void {
  const number = computeNumber(siblingIndex, governingRule, parentNumber)
  if (number !== null) result.set(node.id, number)

  const childRule = numberingRuleForChildren(node, governingRule)
  for (const [childIndex, child] of node.children.entries()) {
    visitNode(child, childIndex, childRule, number, result)
  }
}

/** Resolve the numbering rule that governs a topic's own number. */
function computeNumber(
  siblingIndex: number,
  governingRule: MindMapTopicNumbering | null,
  parentNumber: string | null
): string | null {
  if (governingRule === null) return null
  const pattern = governingRule.pattern
  if (pattern === undefined || pattern === 'none') return null

  const start = governingRule.restartAt ?? 1
  const index = start + siblingIndex
  const formatted = formatNumberIndex(index, pattern)
  if (governingRule.tiered === true && parentNumber !== null) {
    return `${parentNumber}.${formatted}`
  }
  return formatted
}

/**
 * The rule that applies to `node`'s children.
 *
 * - A node with its own concrete pattern establishes a new rule for its
 *   children.
 * - A node with `pattern: 'none'` cancels numbering for its descendants
 *   (returns null) until a deeper topic re-enables it.
 * - A node with no usable config inherits the rule that governs itself.
 */
function numberingRuleForChildren(
  node: MindMapTopicV2,
  inherited: MindMapTopicNumbering | null = null
): MindMapTopicNumbering | null {
  const own = node.numbering
  if (own === undefined) return inherited
  // Only an explicit `pattern: 'none'` cancels inherited numbering for
  // descendants. A config without a usable pattern neither establishes nor
  // cancels, so children inherit the ancestor's rule unchanged.
  if (own.pattern === 'none') return null
  if (own.pattern === undefined) return inherited
  return own
}

export { NUMBERING_RESTART_AT_MIN, NUMBERING_RESTART_AT_MAX }
