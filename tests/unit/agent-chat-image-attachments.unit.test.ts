import { describe, expect, it } from 'vitest'

import {
  createDraftAgentChatImageAttachments,
  imageFilesFromClipboardData,
  revokeDraftAgentChatImageAttachments
} from '../../src/renderer/src/agent-chat-image-attachments'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function clipboardData(input: {
  items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>
  files?: File[]
}): Pick<DataTransfer, 'items' | 'files'> {
  return {
    items: (input.items ?? []) as unknown as DataTransferItemList,
    files: (input.files ?? []) as unknown as FileList
  }
}

describe('agent chat clipboard image attachments', () => {
  it('extracts pasted image items and does not inspect clipboard text', () => {
    const image = new File([PNG_BYTES], '', { type: 'image/png' })
    const textItem = { kind: 'string', type: 'text/plain', getAsFile: () => null }
    const imageItem = { kind: 'file', type: 'image/png', getAsFile: () => image }

    expect(imageFilesFromClipboardData(clipboardData({ items: [textItem, imageItem] }))).toEqual([image])
  })

  it('falls back to clipboard files when no image item is exposed', () => {
    const image = new File([PNG_BYTES], 'clipboard.png', { type: 'image/png' })
    const text = new File(['not an image'], 'note.txt', { type: 'text/plain' })

    expect(imageFilesFromClipboardData(clipboardData({ files: [text, image] }))).toEqual([image])
  })

  it('gives unnamed pasted images a safe display filename', async () => {
    const image = new File([PNG_BYTES], '', { type: 'image/png' })
    const attachments = await createDraftAgentChatImageAttachments([image])
    try {
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        name: 'pasted-image.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.byteLength
      })
    } finally {
      revokeDraftAgentChatImageAttachments(attachments)
    }
  })
})
