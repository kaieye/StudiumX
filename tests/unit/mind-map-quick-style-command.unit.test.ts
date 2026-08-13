import { describe, expect, it } from 'vitest'
import { buildApplyQuickStyleCommand } from '../../src/renderer/src/views/mindmap/mind-map-commands'
import { applyMindMapCommand } from '../../src/shared/mindmap/commands'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'

const document: MindMapDocumentV2 = {
  schemaVersion: 2,
  id: 'doc',
  revision: 1,
  title: 'Quick styles',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  theme: { id: 'studiumx-default' },
  sheets: [{
    id: 'sheet',
    title: 'Sheet',
    layout: { structureClass: 'org.xmind.ui.logic.right' },
    root: {
      id: 'root',
      title: 'Root',
      planning: { taskStatus: 'doing', priority: 4 },
      style: { fill: '#123456' },
      children: [{ id: 'child', title: 'Child', style: { textDecoration: 'underline' }, children: [] }]
    },
    elements: []
  }],
  assets: []
}

describe('quick style command builder', () => {
  it('applies a multi-selection as one transaction and keeps planning metadata intact', () => {
    const sheet = document.sheets[0]!
    const command = buildApplyQuickStyleCommand(sheet, ['root', 'child'], 'very-important')
    expect(command?.type).toBe('transaction')
    if (!command || command.type !== 'transaction') return
    const result = applyMindMapCommand(document, command)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.sheets[0]!.root.planning).toEqual({ taskStatus: 'doing', priority: 4 })
    expect(result.document.sheets[0]!.root.style).toMatchObject({ fill: '#FFD6D6', borderWidth: 2 })
    expect(result.document.sheets[0]!.root.children[0]!.style).toMatchObject({ textDecoration: 'underline' })
    expect(result.inverse.type).toBe('transaction')
  })

  it('default quick style resets only local style through a reversible command', () => {
    const sheet = document.sheets[0]!
    const command = buildApplyQuickStyleCommand(sheet, ['root'], 'default')
    expect(command).toMatchObject({
      type: 'topic.update',
      patch: { style: null }
    })
    if (!command) return
    const result = applyMindMapCommand(document, command)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.sheets[0]!.root.style).toBeUndefined()
    const restored = applyMindMapCommand(result.document, result.inverse)
    expect(restored.ok).toBe(true)
    if (restored.ok) expect(restored.document.sheets[0]!.root.style).toEqual({ fill: '#123456' })
  })
})
