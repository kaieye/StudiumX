import { describe, expect, it } from 'vitest'
import type { MindMapClipboardData } from '../../src/shared/mindmap/commands'
import { buildPasteCommandForPayload } from '../../src/renderer/src/views/mindmap/mind-map-commands'

describe('buildPasteCommandForPayload', () => {
  it('keeps the target sheet and parent on the generated paste transaction', () => {
    const data: MindMapClipboardData = {
      documentId: 'source-document',
      sheetId: 'source-sheet',
      branches: [{ id: 'source-topic', title: 'Copied topic', children: [] }],
      elements: [],
      capturedAt: '2026-08-09T00:00:00.000Z'
    }

    const result = buildPasteCommandForPayload(
      {
        kind: 'paste',
        data,
        targetSheetId: 'target-sheet',
        targetParentId: 'target-parent'
      },
      'target-sheet',
      'target-parent'
    )

    expect(result.pastedRootId).not.toBe('source-topic')
    expect(result.command).toMatchObject({
      type: 'transaction',
      commands: [
        {
          type: 'topic.insert',
          sheetId: 'target-sheet',
          parentId: 'target-parent'
        }
      ]
    })
  })
})
