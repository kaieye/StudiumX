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

function readAllMindMapRuleDeclarations(selector: string): string {
  const styles = readFileSync(
    resolve(process.cwd(), 'src/renderer/src/views/mindmap/mindmap.css'),
    'utf8'
  )
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...styles.matchAll(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g'))]
  return matches.map((match) => match[1]).join('\n')
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

  it('keeps long inspector content vertically scrollable within the right panel', () => {
    const panel = readMindMapRuleDeclarations('.mindmap-ai-panel')
    const content = readMindMapRuleDeclarations('.mindmap-inspector-tab-content')

    // The panel must be a constrained flex column: otherwise the content
    // section expands to its natural height and is clipped by the panel.
    expect(panel).toMatch(/display:\s*flex/)
    expect(panel).toMatch(/flex-direction:\s*column/)
    expect(panel).toMatch(/min-height:\s*0/)
    expect(panel).toMatch(/overflow:\s*hidden/)
    expect(content).toMatch(/flex:\s*1\s+1\s+auto/)
    expect(content).toMatch(/min-height:\s*0/)
    expect(content).toMatch(/overflow-y:\s*auto/)
    expect(content).toMatch(/overscroll-behavior:\s*contain/)
  })

  it('keeps the AI composer below a separately scrollable conversation thread', () => {
    const aiContent = readAllMindMapRuleDeclarations('.mindmap-inspector-tab-content--ai')
    const conversation = readAllMindMapRuleDeclarations('.mindmap-ai-panel__conversation')
    const thread = readMindMapRuleDeclarations('.mindmap-ai-panel__thread')
    const composer = readMindMapRuleDeclarations('.mindmap-ai-panel__composer')

    expect(aiContent).toMatch(/min-height:\s*0/)
    expect(aiContent).toMatch(/overflow:\s*hidden/)
    expect(readMindMapRuleDeclarations('.mindmap-inspector-tab-content--ai > .mindmap-ai-panel__conversation')).toMatch(/flex-shrink:\s*1/)
    expect(conversation).toMatch(/display:\s*flex/)
    expect(conversation).toMatch(/flex-direction:\s*column/)
    expect(conversation).toMatch(/min-height:\s*0/)
    expect(thread).toMatch(/flex:\s*1\s+1\s+auto/)
    expect(thread).toMatch(/min-height:\s*0/)
    expect(thread).toMatch(/overflow-y:\s*auto/)
    expect(composer).toMatch(/flex:\s*0\s+0\s+auto/)
    // The card-based composer keeps the surface pinned below the thread; the
    // separator moved inside the card surface (rounded card + status strip).
    expect(composer).toMatch(/padding:\s*0\s+10px\s+10px/)
  })

  it('uses a translucent, blurred popover for compact topic-style menus', () => {
    const declarations = readMindMapRuleDeclarations('.mindmap-topic-style-menu__popover')

    expect(declarations).toMatch(/background:\s*[\s\S]*transparent/)
    expect(declarations).toMatch(/backdrop-filter:\s*blur/)
    expect(declarations).toMatch(/-webkit-backdrop-filter:\s*blur/)
    expect(declarations).toMatch(/z-index:\s*40/)
    expect(declarations).toMatch(/box-sizing:\s*border-box/)
    expect(readMindMapRuleDeclarations('.mindmap-topic-style-menu.is-open')).toMatch(/z-index:\s*140/)
  })

  it('marks the active sheet without a competing blue underline', () => {
    const declarations = readMindMapRuleDeclarations('.mindmap-sheet-tab.is-active')

    expect(declarations).toMatch(/background:\s*var\(--surface-muted\)/)
    expect(declarations).not.toMatch(/box-shadow\s*:/)
    expect(declarations).not.toMatch(/border-bottom\s*:/)
  })

  it('keeps inline topic editing on the same transparent text plane as the SVG label', () => {
    const wrapper = readMindMapRuleDeclarations('.mindmap-node-input-wrap')
    const input = readMindMapRuleDeclarations('.mindmap-node-input')
    const focus = readAllMindMapRuleDeclarations('.mindmap-node-input:focus-visible')

    expect(wrapper).toMatch(/box-sizing:\s*border-box/)
    expect(wrapper).toMatch(/width:\s*100%/)
    expect(wrapper).toMatch(/height:\s*100%/)
    expect(wrapper).toMatch(/padding:\s*0\s+10px/)
    expect(input).toMatch(/height:\s*1em/)
    expect(input).toMatch(/padding:\s*0/)
    expect(input).toMatch(/background:\s*transparent/)
    expect(input).toMatch(/border:\s*0/)
    expect(focus).toMatch(/box-shadow:\s*none/)
  })
})
