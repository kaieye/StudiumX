import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import { useMindMapViewStore } from '../../src/renderer/src/views/mindmap/mind-map-view-store'
import { MindMapView } from '../../src/renderer/src/views/mindmap/MindMapView'

const appStoreState = vi.hoisted(() => ({
  appState: {
    activeWorkspace: {
      id: 'workspace-1',
      name: 'Workspace',
      rootPath: '/tmp/workspace',
      lessons: []
    }
  }
}))

vi.mock('../../src/renderer/src/app-shell/appStore', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof appStoreState) => unknown) => selector(appStoreState),
    { getState: () => appStoreState }
  )
  return { useAppStore }
})

const NOW = '2026-08-15T00:00:00.000Z'
const documentFixture: MindMapDocumentV2 = {
  schemaVersion: 2,
  id: 'mind-map-note-trigger',
  revision: 1,
  title: 'Study map',
  createdAt: NOW,
  updatedAt: NOW,
  theme: { id: 'default' },
  sheets: [{
    id: 'sheet-1',
    title: 'Overview',
    root: {
      id: 'root',
      title: 'Root topic',
      note: 'Review this topic',
      formula: 'a^2+b^2=c^2',
      links: [{ id: 'link-1', url: 'https://example.com', title: 'Example' }],
      children: [{ id: 'child', title: 'Other topic', children: [] }]
    },
    elements: [],
    layout: { structureClass: 'studiumx.layout.logic.right' }
  }],
  assets: []
}

const originalState = useMindMapViewStore.getState()

describe('MindMapView note trigger', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useMindMapViewStore.setState({
      ...originalState,
      current: structuredClone(documentFixture),
      activeSheetId: 'sheet-1',
      selection: { kind: 'topic', topicIds: ['root'] },
      selectedNodeId: 'root',
      loadDocuments: vi.fn(async () => undefined)
    })
  })

  afterEach(() => {
    useMindMapViewStore.setState(originalState)
  })

  it('opens the floating note dialog from the add-to-topic menu', async () => {
    const user = userEvent.setup()
    render(<MindMapView />)

    await user.click(screen.getByRole('button', { name: '添加内容' }))
    await user.click(screen.getByRole('menuitem', { name: '备注' }))

    expect(screen.getByRole('dialog', { name: '备注' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '节点备注' })).toBeInTheDocument()
  })

  it('renders legacy formulas and links directly in the node instead of action icons', async () => {
    render(<MindMapView />)

    const node = document.querySelector('[data-node-id="root"]')
    expect(node).not.toBeNull()
    expect(node).toHaveAttribute('aria-label', expect.stringContaining('$$'))
    expect(node).toHaveAttribute('aria-label', expect.stringContaining('[Example](https://example.com)'))
    expect(screen.queryByRole('button', { name: '公式（LaTeX）: Root topic' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '链接: Root topic' })).not.toBeInTheDocument()
  })

  it('opens formula and link editors from the add-content menu', async () => {
    const user = userEvent.setup()
    render(<MindMapView />)

    await user.click(screen.getByRole('button', { name: '添加内容' }))
    await user.click(screen.getByRole('menuitem', { name: '公式（LaTeX）' }))
    const formulaDialog = screen.getByRole('dialog', { name: '公式（LaTeX）' })
    expect(formulaDialog.querySelector('textarea')).toHaveValue('a^2+b^2=c^2')
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: '添加内容' }))
    await user.click(screen.getByRole('menuitem', { name: '链接' }))
    const linkDialog = screen.getByRole('dialog', { name: '链接' })
    expect(Array.from(linkDialog.querySelectorAll('input')).some(
      (input) => input.value === 'https://example.com'
    )).toBe(true)
  })

})
