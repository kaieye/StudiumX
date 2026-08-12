import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readRuleDeclarations(selector: string): string {
  const file = selector === '.mindmap-view-shell' ? 'src/renderer/src/views/mindmap/mindmap.css' : 'src/renderer/src/styles/main.css'
  const styles = readFileSync(resolve(process.cwd(), file), 'utf8')
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

function readMindMapRuleDeclarations(selector: string): string {
  const styles = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/views/mindmap/mindmap.css'),
    'utf8'
  )
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

describe('mind map page layout contract', () => {
  it('uses the available main-area height without a trailing page gutter', () => {
    const declarations = readRuleDeclarations(".main-area[data-view='mindmap']")

    expect(declarations).toMatch(/display:\s*flex/)
    expect(declarations).toMatch(/flex-direction:\s*column/)
    expect(declarations).toMatch(/overflow:\s*hidden/)
    expect(declarations).toMatch(/padding-bottom:\s*0/)
  })

  it('lets the map shell consume the space left by the topbar', () => {
    const declarations = readRuleDeclarations('.mindmap-view-shell')

    expect(declarations).toMatch(/flex:\s*1\s*1\s*auto/)
    expect(declarations).toMatch(/height:\s*auto/)
    expect(declarations).toMatch(/min-height:\s*0/)
  })

  it('marks the active sheet without a competing blue underline', () => {
    const declarations = readMindMapRuleDeclarations('.mindmap-sheet-tab.is-active')

    expect(declarations).toMatch(/background:\s*var\(--surface-muted\)/)
    expect(declarations).not.toMatch(/box-shadow\s*:/)
    expect(declarations).not.toMatch(/border-bottom\s*:/)
  })
})
