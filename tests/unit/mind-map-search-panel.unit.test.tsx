import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapSearchPanel } from '../../src/renderer/src/views/mindmap/MindMapSearchPanel'
import type { MindMapTopicV2 } from '../../src/shared/mindmap/domain/types'

function makeRoot(): MindMapTopicV2 {
  return {
    id: 'root',
    title: 'Course',
    note: 'Lesson notes',
    children: [
      {
        id: 'lesson',
        title: 'Lesson plan',
        labels: ['lesson'],
        children: []
      },
      {
        id: 'review',
        title: 'Review',
        links: [{ id: 'review-link', url: 'https://example.test/lesson' }],
        children: []
      }
    ]
  }
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof MindMapSearchPanel>> = {}) {
  const props: React.ComponentProps<typeof MindMapSearchPanel> = {
    root: makeRoot(),
    selectedNodeId: null,
    onSelect: vi.fn(),
    onReplace: vi.fn(),
    onReplaceAll: vi.fn(),
    ...overrides
  }
  render(<MindMapSearchPanel {...props} />)
  return props
}

describe('MindMapSearchPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })
  it('searches the active tree and exposes result count and matching fields', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.type(screen.getByRole('searchbox', { name: 'Find' }), 'lesson')

    expect(screen.getByText('3 matches')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Course.*note/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Lesson plan.*title · label/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Review.*link/ })).toBeInTheDocument()
  })

  it('selects results and wraps with previous/next navigation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderPanel({ onSelect })
    await user.type(screen.getByRole('searchbox', { name: 'Find' }), 'lesson')

    await user.click(screen.getByRole('button', { name: 'Next match' }))
    expect(onSelect).toHaveBeenLastCalledWith('lesson')
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false'
    ])

    await user.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(onSelect).toHaveBeenLastCalledWith('root')
  })

  it('dispatches replace for the selected result and replace all for every match', async () => {
    const user = userEvent.setup()
    const onReplace = vi.fn()
    const onReplaceAll = vi.fn()
    renderPanel({ onReplace, onReplaceAll })

    await user.type(screen.getByRole('searchbox', { name: 'Find' }), 'lesson')
    await user.type(screen.getByRole('textbox', { name: 'Replace with' }), 'unit')
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    expect(onReplace).toHaveBeenCalledWith('root', 'lesson', 'unit')

    await user.click(screen.getByRole('button', { name: 'Replace all' }))
    expect(onReplaceAll).toHaveBeenCalledWith(['root', 'lesson', 'review'], 'lesson', 'unit')
  })
})
