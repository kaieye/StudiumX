import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import type { MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'
import { MindMapFormulaEditor } from '../../src/renderer/src/views/mindmap/MindMapFormulaEditor'
import { MindMapLinkEditor } from '../../src/renderer/src/views/mindmap/MindMapLinkEditor'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'

const topic: MindMapTopicV2 = {
  id: 'topic-1',
  title: 'Topic',
  children: []
}

const originalState = useMindMapViewStore.getState()

describe('mind-map content editors write visible Markdown', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  afterEach(() => {
    useMindMapViewStore.setState(originalState)
  })

  it('writes the formula into the topic title as Markdown', async () => {
    const updateNode = vi.fn()
    useMindMapViewStore.setState({ updateNode })
    const user = userEvent.setup()
    render(<MindMapFormulaEditor topic={topic} />)

    await user.type(screen.getByRole('textbox'), 'x^2')

    expect(updateNode).toHaveBeenLastCalledWith('topic-1', {
      title: 'Topic\n$$\nx^2\n$$',
      formula: null
    })
  })

  it('writes the formula inline when the inline option is enabled', async () => {
    const updateNode = vi.fn()
    useMindMapViewStore.setState({ updateNode })
    const user = userEvent.setup()
    render(<MindMapFormulaEditor topic={topic} />)

    await user.click(screen.getByRole('checkbox'))
    await user.type(screen.getByRole('textbox'), 'x^2')

    expect(updateNode).toHaveBeenLastCalledWith('topic-1', {
      title: 'Topic$x^2$',
      formula: null
    })
  })

  it('writes an added link into the topic title as Markdown', async () => {
    const updateNode = vi.fn()
    useMindMapViewStore.setState({ updateNode })
    const user = userEvent.setup()
    render(<MindMapLinkEditor topic={topic} />)

    await user.type(screen.getByPlaceholderText('网址'), 'https://example.com')
    await user.type(screen.getByPlaceholderText('标题（可选）'), 'Example')
    await user.click(screen.getByRole('button', { name: /插入到节点/ }))

    expect(updateNode).toHaveBeenCalledWith('topic-1', expect.objectContaining({
      title: 'Topic\n[Example](https://example.com/)',
      links: [expect.objectContaining({
        url: 'https://example.com/',
        title: 'Example'
      })]
    }))
  })
})
