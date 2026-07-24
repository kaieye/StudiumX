import { describe, expect, it } from 'vitest'
import {
  applyEditReplacements,
  findEditMatches,
  type EditMatchStrategy
} from '../../src/main/ai/tools/edit-match'

function applyFirst(
  text: string,
  oldString: string,
  newString: string
): { next: string; strategy: EditMatchStrategy; count: number } {
  const outcome = findEditMatches(text, oldString, newString)
  expect(outcome).not.toBeNull()
  const count = outcome!.replacements.length
  const next = applyEditReplacements(text, outcome!.replacements.slice(0, 1))
  return { next, strategy: outcome!.strategy, count }
}

function applyAll(
  text: string,
  oldString: string,
  newString: string
): { next: string; strategy: EditMatchStrategy; count: number } {
  const outcome = findEditMatches(text, oldString, newString)
  expect(outcome).not.toBeNull()
  const count = outcome!.replacements.length
  const next = applyEditReplacements(text, outcome!.replacements)
  return { next, strategy: outcome!.strategy, count }
}

describe('edit-match cascade', () => {
  it('exact match replaces a single occurrence', () => {
    const { next, strategy, count } = applyFirst('let x = 1;\nlet y = 2;\n', 'x = 1', 'x = 9')
    expect(strategy).toBe('exact')
    expect(count).toBe(1)
    expect(next).toBe('let x = 9;\nlet y = 2;\n')
  })

  it('exact match wins over fuzzier passes', () => {
    const text = 'a\nb \nb\n'
    const { next, strategy, count } = applyFirst(text, 'b\n', 'c\n')
    expect(strategy).toBe('exact')
    expect(count).toBe(1)
    expect(next).toBe('a\nb \nc\n')
  })

  it('line-endings: CRLF file matches LF old_string and keeps CRLF', () => {
    const text = 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n'
    const { next, strategy } = applyFirst(
      text,
      'const b = 2;\nconst c = 3;\n',
      'const b = 20;\nconst c = 30;\n'
    )
    expect(strategy).toBe('line-endings')
    expect(next).toBe('const a = 1;\r\nconst b = 20;\r\nconst c = 30;\r\n')
  })

  it('line-endings: BOM survives edit', () => {
    const text = '\u{feff}first\r\nsecond\r\n'
    const { next, strategy } = applyFirst(text, 'first\nsecond\n', 'FIRST\nSECOND\n')
    expect(strategy).toBe('line-endings')
    expect(next).toBe('\u{feff}FIRST\r\nSECOND\r\n')
  })

  it('trailing-whitespace tolerant whole-line match', () => {
    const text = 'fn main() {  \n    body();\t\n}\n'
    const { next, strategy } = applyFirst(
      text,
      'fn main() {\n    body();\n}\n',
      'fn main() {\n    other();\n}\n'
    )
    expect(strategy).toBe('trailing-whitespace')
    expect(next).toBe('fn main() {\n    other();\n}\n')
  })

  it('trailing-whitespace does not match mid-line fragments', () => {
    expect(findEditMatches('prefix core suffix\n', 'core extra', 'x')).toBeNull()
  })

  it('indentation shift add is applied to replacement using file indent', () => {
    const text = 'if ready {\n        launch();\n        wait();\n}\n'
    const { next, strategy } = applyFirst(
      text,
      '    launch();\n    wait();\n',
      '    launch();\n    hold();\n'
    )
    expect(strategy).toBe('indentation')
    expect(next).toBe('if ready {\n        launch();\n        hold();\n}\n')
  })

  it('indentation shift remove is applied to replacement', () => {
    const text = 'fn f() {\n    a();\n    b();\n}\n'
    const { next, strategy } = applyFirst(
      text,
      '        a();\n        b();\n',
      '        a();\n        c();\n'
    )
    expect(strategy).toBe('indentation')
    expect(next).toBe('fn f() {\n    a();\n    c();\n}\n')
  })

  it('non-uniform indentation shift is rejected (fail closed)', () => {
    const text = '    a();\n  b();\n'
    expect(findEditMatches(text, 'a();\nb();\n', 'x();\ny();\n')).toBeNull()
  })

  it('no match returns null (fail closed)', () => {
    expect(findEditMatches('hello', 'absent', 'x')).toBeNull()
    expect(findEditMatches('hello', '', 'x')).toBeNull()
  })

  it('replace_all applies non-overlapping exact matches', () => {
    const { next, strategy, count } = applyAll('foo bar foo', 'foo', 'baz')
    expect(strategy).toBe('exact')
    expect(count).toBe(2)
    expect(next).toBe('baz bar baz')
  })
})
