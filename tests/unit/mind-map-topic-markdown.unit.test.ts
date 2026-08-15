import { describe, expect, it } from 'vitest'
import {
  appendFormulaMarkdown,
  appendLinkMarkdown,
  mindMapTopicDisplayTitle,
  removeLinkMarkdown
} from '../../src/renderer/src/views/mindmap/mind-map-topic-markdown'

describe('mind-map topic Markdown content', () => {
  it('writes formulas and links as Markdown in the topic title', () => {
    const withFormula = appendFormulaMarkdown('Pythagoras', 'a^2+b^2=c^2')
    const withLink = appendLinkMarkdown(withFormula, {
      url: 'https://example.com',
      title: 'Example'
    })

    expect(withLink).toBe(
      'Pythagoras\n$$\na^2+b^2=c^2\n$$\n[Example](https://example.com)'
    )
  })

  it('writes inline formulas with a single $…$ delimiter without a line break', () => {
    const withInline = appendFormulaMarkdown('E = m c^2', 'E=mc^2', true)
    expect(withInline).toBe('E = m c^2$E=mc^2$')
  })

  it('projects legacy formula/link fields into visible title Markdown without duplicating embedded content', () => {
    const title = mindMapTopicDisplayTitle({
      title: 'Topic\n[Docs](https://example.com)',
      formula: 'x^2',
      links: [{ id: 'link-1', url: 'https://example.com', title: 'Docs' }]
    })

    expect(title).toBe('Topic\n[Docs](https://example.com)\n$$\nx^2\n$$')
  })

  it('removes only Markdown generated for managed links', () => {
    const managed = { url: 'https://example.com', title: 'Docs' }
    const title = 'Topic\n[Keep](https://openai.com)\n[Docs](https://example.com)'

    expect(removeLinkMarkdown(title, [managed])).toBe('Topic\n[Keep](https://openai.com)')
  })
})
