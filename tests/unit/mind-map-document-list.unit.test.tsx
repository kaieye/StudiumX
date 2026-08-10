import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { MindMapDocumentList } from '../../src/renderer/src/views/mindmap/MindMapDocumentList'
import type { MindMapSummary } from '../../src/shared/mindmap/mind-map-types'

const documents: MindMapSummary[] = [
  { id: 'doc-1', title: 'Alpha', updatedAt: '2026-08-09T00:00:00.000Z', sheetCount: 1 },
  { id: 'doc-2', title: 'Beta', updatedAt: '2026-08-09T00:01:00.000Z', sheetCount: 2 },
  { id: 'doc-3', title: 'Gamma', updatedAt: '2026-08-09T00:02:00.000Z', sheetCount: 3 }
]

function renderList(currentDocumentId: string | null = 'doc-1') {
  const callbacks = {
    onOpenDocument: vi.fn(),
    onDeleteDocument: vi.fn()
  }
  render(
    <MindMapDocumentList
      documents={documents}
      currentDocumentId={currentDocumentId}
      {...callbacks}
    />
  )
  return callbacks
}

describe('MindMapDocumentList', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('exposes a labelled list with one roving document tab stop', () => {
    renderList('doc-2')

    expect(screen.getByRole('list', { name: 'Mind map documents' })).toBeInTheDocument()
    const items = screen.getAllByRole('button', { name: /(?:Alpha|Beta|Gamma), \d Layout/ })
    expect(items.map((item) => item.tabIndex)).toEqual([-1, 0, -1])
    expect(items.map((item) => item.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
  })

  it('opens adjacent documents with arrow keys and wraps at the ends', async () => {
    const user = userEvent.setup()
    const callbacks = renderList()
    const items = screen.getAllByRole('button', { name: /(?:Alpha|Beta|Gamma), \d Layout/ })

    await user.click(items[0]!)
    await user.keyboard('{ArrowDown}')
    expect(callbacks.onOpenDocument).toHaveBeenLastCalledWith('doc-2')
    expect(document.activeElement).toBe(items[1])

    await user.keyboard('{End}')
    expect(callbacks.onOpenDocument).toHaveBeenLastCalledWith('doc-3')
    expect(document.activeElement).toBe(items[2])

    await user.keyboard('{ArrowDown}')
    expect(callbacks.onOpenDocument).toHaveBeenLastCalledWith('doc-1')
    expect(document.activeElement).toBe(items[0])

    await user.keyboard('{Home}')
    expect(callbacks.onOpenDocument).toHaveBeenLastCalledWith('doc-1')
    expect(document.activeElement).toBe(items[0])
  })

  it('keeps native Enter/Space activation and isolates delete actions', async () => {
    const user = userEvent.setup()
    const callbacks = renderList()
    const beta = screen.getByRole('button', { name: /Beta, 2 Layout/ })

    beta.focus()
    await user.keyboard('{Enter}')
    expect(callbacks.onOpenDocument).toHaveBeenLastCalledWith('doc-2')
    await user.keyboard(' ')
    expect(callbacks.onOpenDocument).toHaveBeenLastCalledWith('doc-2')

    await user.click(screen.getByRole('button', { name: 'Delete mind map: Alpha' }))
    expect(callbacks.onDeleteDocument).toHaveBeenCalledWith('doc-1')
    expect(callbacks.onOpenDocument).toHaveBeenCalledTimes(2)
  })

  it('renders an empty state without adding a phantom tab stop', () => {
    render(
      <MindMapDocumentList
        documents={[]}
        currentDocumentId={null}
        onOpenDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
      />
    )

    expect(screen.getByText('No mind maps yet')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
