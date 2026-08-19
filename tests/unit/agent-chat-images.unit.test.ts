import { describe, expect, it } from 'vitest'

import {
  MAX_IMAGES_PER_TURN,
  decodedBase64ByteLength,
  hasExpectedImageMagicBytes,
  validateAgentChatImageAttachment,
  validateAgentChatImageAttachments,
  type AgentChatImageAttachment,
  type AgentChatImageMimeType
} from '../../src/shared/agent-chat-images'

function encoded(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64')
}

const imageSamples: Array<{ mimeType: AgentChatImageMimeType; dataBase64: string }> = [
  { mimeType: 'image/png', dataBase64: encoded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: 'image/jpeg', dataBase64: encoded([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]) },
  { mimeType: 'image/gif', dataBase64: encoded([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) },
  { mimeType: 'image/webp', dataBase64: encoded([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]) }
]

function attachment(
  sample = imageSamples[0]!,
  overrides: Partial<AgentChatImageAttachment> = {}
): AgentChatImageAttachment {
  return {
    id: 'image-1',
    name: 'diagram.png',
    mimeType: sample.mimeType,
    dataBase64: sample.dataBase64,
    sizeBytes: decodedBase64ByteLength(sample.dataBase64),
    ...overrides
  }
}

describe('agent chat image attachment validation', () => {
  it('accepts each supported image signature and normalizes bounded metadata', () => {
    for (const sample of imageSamples) {
      expect(hasExpectedImageMagicBytes(sample.mimeType, sample.dataBase64)).toBe(true)
      expect(validateAgentChatImageAttachment(attachment(sample, {
        id: ' image-1 ', name: ' diagram.png '
      }))).toMatchObject({
        id: 'image-1',
        name: 'diagram.png',
        mimeType: sample.mimeType,
        dataBase64: sample.dataBase64
      })
    }
  })

  it('rejects malformed base64, forged byte counts, and MIME/signature mismatches', () => {
    expect(() => validateAgentChatImageAttachment(attachment(undefined, { dataBase64: 'not base64', sizeBytes: 10 })))
      .toThrow('图片大小')
    expect(() => validateAgentChatImageAttachment(attachment(undefined, { sizeBytes: 999 })))
      .toThrow('大小校验')
    expect(() => validateAgentChatImageAttachment(attachment(undefined, { mimeType: 'image/jpeg' })))
      .toThrow('内容与声明的类型不匹配')
  })

  it('rejects local-path and renderer URL metadata at the boundary', () => {
    for (const value of ['file:///Users/learner/private.png', 'blob:https://app/image', '/tmp/private.png', 'C:\\Users\\learner\\private.png']) {
      expect(() => validateAgentChatImageAttachment(attachment(undefined, { name: value })))
        .toThrow('本地路径')
    }
    expect(() => validateAgentChatImageAttachment(attachment(undefined, { id: '../image-1' })))
      .toThrow('本地路径')
  })

  it('rejects renderer-only and other unexpected fields instead of silently stripping them', () => {
    expect(() => validateAgentChatImageAttachment({
      ...attachment(),
      previewUrl: 'blob:https://renderer.invalid/preview'
    })).toThrow('不允许的字段')
  })

  it('enforces the per-turn attachment count and drops an explicit empty array', () => {
    const attachments = Array.from({ length: MAX_IMAGES_PER_TURN + 1 }, (_, index) => attachment(undefined, {
      id: `image-${index + 1}`
    }))
    expect(() => validateAgentChatImageAttachments(attachments)).toThrow(`最多添加 ${MAX_IMAGES_PER_TURN}`)
    expect(validateAgentChatImageAttachments([])).toBeUndefined()
  })
})
