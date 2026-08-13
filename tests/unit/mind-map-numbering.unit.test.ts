import { describe, expect, it } from 'vitest'
import type {
  MindMapTopicNumbering,
  MindMapTopicV2
} from '../../src/shared/mindmap/domain/types'
import {
  computeAllTopicNumbers,
  computeTopicNumber,
  formatNumberIndex
} from '../../src/renderer/src/views/mindmap/mind-map-numbering'

function topic(
  id: string,
  numbering?: MindMapTopicNumbering,
  children: MindMapTopicV2[] = []
): MindMapTopicV2 {
  return numbering === undefined
    ? { id, title: id, children }
    : { id, title: id, children, numbering }
}

/** Returns the prefix for a topic id (undefined when the topic has no number). */
function numberFor(root: MindMapTopicV2, id: string): string | undefined {
  return computeAllTopicNumbers(root).get(id)
}

describe('formatNumberIndex', () => {
  it('formats arabic indices as integers', () => {
    expect(formatNumberIndex(1, 'arabic')).toBe('1')
    expect(formatNumberIndex(7, 'arabic')).toBe('7')
  })

  it('formats uppercase and lowercase letters column-style', () => {
    expect(formatNumberIndex(1, 'uppercase')).toBe('A')
    expect(formatNumberIndex(2, 'uppercase')).toBe('B')
    expect(formatNumberIndex(26, 'uppercase')).toBe('Z')
    expect(formatNumberIndex(27, 'uppercase')).toBe('AA')
    expect(formatNumberIndex(1, 'lowercase')).toBe('a')
    expect(formatNumberIndex(3, 'lowercase')).toBe('c')
    expect(formatNumberIndex(28, 'lowercase')).toBe('ab')
  })

  it('formats roman numerals', () => {
    expect(formatNumberIndex(1, 'roman')).toBe('I')
    expect(formatNumberIndex(2, 'roman')).toBe('II')
    expect(formatNumberIndex(3, 'roman')).toBe('III')
    expect(formatNumberIndex(4, 'roman')).toBe('IV')
    expect(formatNumberIndex(5, 'roman')).toBe('V')
    expect(formatNumberIndex(9, 'roman')).toBe('IX')
    expect(formatNumberIndex(10, 'roman')).toBe('X')
    expect(formatNumberIndex(14, 'roman')).toBe('XIV')
    expect(formatNumberIndex(20, 'roman')).toBe('XX')
  })
})

describe('computeAllTopicNumbers', () => {
  it('gives the root and topics above any rule no prefix', () => {
    const root = topic('r', undefined, [topic('a'), topic('b')])
    expect(numberFor(root, 'r')).toBeUndefined()
    expect(numberFor(root, 'a')).toBeUndefined()
    expect(numberFor(root, 'b')).toBeUndefined()
    expect(computeTopicNumber(root, 'a')).toBeNull()
  })

  it('numbers children with arabic pattern starting at 1', () => {
    const root = topic('r', { pattern: 'arabic' }, [topic('a'), topic('b'), topic('c')])
    expect(numberFor(root, 'a')).toBe('1')
    expect(numberFor(root, 'b')).toBe('2')
    expect(numberFor(root, 'c')).toBe('3')
    expect(numberFor(root, 'r')).toBeUndefined()
  })

  it('numbers children with uppercase, lowercase, and roman patterns', () => {
    const upper = topic('r', { pattern: 'uppercase' }, [topic('a'), topic('b')])
    expect(numberFor(upper, 'a')).toBe('A')
    expect(numberFor(upper, 'b')).toBe('B')

    const lower = topic('r', { pattern: 'lowercase' }, [topic('a'), topic('b')])
    expect(numberFor(lower, 'a')).toBe('a')
    expect(numberFor(lower, 'b')).toBe('b')

    const roman = topic('r', { pattern: 'roman' }, [topic('a'), topic('b'), topic('c'), topic('d')])
    expect(numberFor(roman, 'a')).toBe('I')
    expect(numberFor(roman, 'b')).toBe('II')
    expect(numberFor(roman, 'c')).toBe('III')
    expect(numberFor(roman, 'd')).toBe('IV')
  })

  it('inherits the nearest ancestor rule through unconfigured topics', () => {
    const root = topic(
      'r',
      { pattern: 'arabic' },
      [topic('a', undefined, [topic('a1'), topic('a2')])]
    )
    // `a` has no numbering so its children inherit the root's arabic rule.
    expect(numberFor(root, 'a')).toBe('1')
    expect(numberFor(root, 'a1')).toBe('1')
    expect(numberFor(root, 'a2')).toBe('2')
  })

  it('builds tiered chains (2.1.3)', () => {
    const root = topic(
      'r',
      { pattern: 'arabic' },
      [
        topic('t1'),
        topic('t2', { pattern: 'arabic', tiered: true }, [
          topic('x1'),
          topic('x2', { pattern: 'arabic', tiered: true }, [
            topic('g1'),
            topic('g2'),
            topic('g3')
          ])
        ])
      ]
    )
    expect(numberFor(root, 't2')).toBe('2')
    expect(numberFor(root, 'x2')).toBe('2.2')
    expect(numberFor(root, 'g1')).toBe('2.2.1')
    expect(numberFor(root, 'g2')).toBe('2.2.2')
    expect(numberFor(root, 'g3')).toBe('2.2.3')
  })

  it('does not prepend an ancestor when tiered is off', () => {
    const root = topic(
      'r',
      { pattern: 'arabic' },
      [topic('t1', { pattern: 'arabic', tiered: false }, [topic('x1'), topic('x2')])]
    )
    expect(numberFor(root, 't1')).toBe('1')
    expect(numberFor(root, 'x1')).toBe('1')
    expect(numberFor(root, 'x2')).toBe('2')
  })

  it('restarts children at a custom index', () => {
    const root = topic(
      'r',
      { pattern: 'arabic', restartAt: 5 },
      [topic('a'), topic('b'), topic('c')]
    )
    expect(numberFor(root, 'a')).toBe('5')
    expect(numberFor(root, 'b')).toBe('6')
    expect(numberFor(root, 'c')).toBe('7')
  })

  it('combines restartAt with tiered chains', () => {
    const root = topic(
      'r',
      { pattern: 'arabic' },
      [
        topic('t1', { pattern: 'arabic', tiered: true, restartAt: 3 }, [
          topic('x1'),
          topic('x2')
        ])
      ]
    )
    // t1's own number comes from the root rule; its children restart at 3.
    expect(numberFor(root, 't1')).toBe('1')
    expect(numberFor(root, 'x1')).toBe('1.3')
    expect(numberFor(root, 'x2')).toBe('1.4')
  })

  it('cancels inherited numbering for descendants with pattern none', () => {
    const root = topic(
      'r',
      { pattern: 'arabic' },
      [
        topic('a', { pattern: 'none' }, [topic('a1', undefined, [topic('a1x')])]),
        topic('b')
      ]
    )
    // `a` itself is still numbered by the root rule.
    expect(numberFor(root, 'a')).toBe('1')
    // `a`'s children and deeper descendants get no number.
    expect(numberFor(root, 'a1')).toBeUndefined()
    expect(numberFor(root, 'a1x')).toBeUndefined()
    // `b` (sibling) is unaffected.
    expect(numberFor(root, 'b')).toBe('2')
  })

  it('re-enables numbering below a cancelling topic when a deeper rule exists', () => {
    const root = topic(
      'r',
      { pattern: 'arabic' },
      [
        topic('a', { pattern: 'none' }, [
          topic('a1', { pattern: 'uppercase' }, [topic('z1'), topic('z2')])
        ])
      ]
    )
    // a1 re-enables numbering for its own children with a new rule.
    expect(numberFor(root, 'a1')).toBeUndefined()
    expect(numberFor(root, 'z1')).toBe('A')
    expect(numberFor(root, 'z2')).toBe('B')
  })

  it('computeTopicNumber returns the prefix or null', () => {
    const root = topic('r', { pattern: 'arabic' }, [topic('a')])
    expect(computeTopicNumber(root, 'a')).toBe('1')
    expect(computeTopicNumber(root, 'r')).toBeNull()
    expect(computeTopicNumber(root, 'missing')).toBeNull()
  })
})
