import {
  isAgentChatImageMimeType,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_TURN,
  MAX_TOTAL_IMAGE_BYTES,
  validateAgentChatImageAttachment,
  validateAgentChatImageAttachments,
  type AgentChatImageAttachment
} from '../../shared/agent-chat-images'

/**
 * Renderer-only projection of a user-selected image. `previewUrl` is never
 * sent over IPC; the host receives only the bounded base64 attachment.
 */
export type DraftAgentChatImageAttachment = AgentChatImageAttachment & {
  previewUrl: string
}

/**
 * Converts files selected through the picker or pasted from the clipboard into
 * the opaque image payload accepted by the main-process IPC boundary.
 *
 * We validate before creating an object URL and validate the resulting base64
 * again with the shared validator. This keeps renderer feedback aligned with
 * the host's fail-closed checks while ensuring local paths and blob URLs never
 * become conversation data.
 */
export async function createDraftAgentChatImageAttachments(
  files: FileList | readonly File[],
  existingAttachments: readonly DraftAgentChatImageAttachment[] = []
): Promise<DraftAgentChatImageAttachment[]> {
  const selectedFiles = Array.from(files)
  // `previewUrl` is deliberately renderer-only and the shared transport
  // validator rejects unknown fields. Validate the IPC-safe projection here so
  // draft previews never weaken the host boundary.
  const existing = validateAgentChatImageAttachments(toAgentChatImageAttachments(existingAttachments)) ?? []

  if (existing.length + selectedFiles.length > MAX_IMAGES_PER_TURN) {
    throw new Error(`每条消息最多添加 ${MAX_IMAGES_PER_TURN} 张图片。`)
  }

  let totalBytes = existing.reduce((total, attachment) => total + attachment.sizeBytes, 0)
  for (const file of selectedFiles) {
    assertSelectableImageFile(file)
    totalBytes += file.size
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error(`每条消息图片总大小不能超过 ${MAX_TOTAL_IMAGE_BYTES} 字节。`)
    }
  }

  const drafts: DraftAgentChatImageAttachment[] = []
  try {
    for (const file of selectedFiles) {
      const dataBase64 = dataUrlBase64(await readFileAsDataUrl(file))
      const attachment = validateAgentChatImageAttachment({
        id: createAttachmentId(),
        name: imageFileName(file),
        mimeType: file.type,
        dataBase64,
        sizeBytes: file.size
      })
      drafts.push({
        ...attachment,
        // Object URLs stay in this renderer-only draft state. They are useful
        // for responsive previews without duplicating a large base64 string in
        // the DOM and are revoked as soon as the draft is removed or sent.
        previewUrl: createPreviewUrl(file, dataBase64, attachment.mimeType)
      })
    }
    return drafts
  } catch (error) {
    revokeDraftAgentChatImageAttachments(drafts)
    throw error
  }
}

/**
 * Extracts image files from a clipboard paste event without reading or exposing
 * clipboard text. The textarea keeps its normal text-paste behavior; callers
 * add only these binary files as image attachments.
 *
 * Browser clipboard implementations differ: Chromium commonly exposes files
 * through `items`, while some adapters expose only `files`, so use the latter
 * as a fallback. Unsupported image formats are retained here so the normal
 * picker validation can show the same clear error message to the learner.
 */
export function imageFilesFromClipboardData(
  clipboardData: Pick<DataTransfer, 'items' | 'files'> | null | undefined
): File[] {
  if (!clipboardData) return []

  const fromItems = Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.toLowerCase().startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (fromItems.length > 0) return fromItems

  return Array.from(clipboardData.files ?? [])
    .filter((file) => file.type.toLowerCase().startsWith('image/'))
}


/** Releases renderer-only object URLs for removed, sent, or abandoned drafts. */
export function revokeDraftAgentChatImageAttachments(
  attachments: readonly Pick<DraftAgentChatImageAttachment, 'previewUrl'>[]
): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  for (const attachment of attachments) {
    if (attachment.previewUrl.startsWith('blob:')) URL.revokeObjectURL(attachment.previewUrl)
  }
}

/** Removes the renderer-only preview field before an attachment leaves the UI. */
export function toAgentChatImageAttachments(
  attachments: readonly DraftAgentChatImageAttachment[]
): AgentChatImageAttachment[] {
  return attachments.map(({ previewUrl: _previewUrl, ...attachment }) => attachment)
}

function imageFileName(file: File): string {
  const name = file.name.trim()
  if (name) return name
  switch (file.type) {
    case 'image/jpeg': return 'pasted-image.jpg'
    case 'image/webp': return 'pasted-image.webp'
    case 'image/gif': return 'pasted-image.gif'
    default: return 'pasted-image.png'
  }
}


function assertSelectableImageFile(file: File): void {
  if (!isAgentChatImageMimeType(file.type)) {
    throw new Error('仅支持 PNG、JPEG、WebP 或 GIF 图片。')
  }
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error(`单张图片大小必须在 1 字节到 ${MAX_IMAGE_BYTES} 字节之间。`)
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败。'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('读取图片失败。'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function dataUrlBase64(dataUrl: string): string {
  const separator = dataUrl.indexOf(',')
  const header = separator >= 0 ? dataUrl.slice(0, separator) : ''
  const dataBase64 = separator >= 0 ? dataUrl.slice(separator + 1) : ''
  if (!/^data:[^,;]+;base64$/i.test(header) || !dataBase64) {
    throw new Error('图片编码无效。')
  }
  return dataBase64
}

function createAttachmentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `image-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function createPreviewUrl(file: File, dataBase64: string, mimeType: AgentChatImageAttachment['mimeType']): string {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    return URL.createObjectURL(file)
  }
  // Electron's renderer normally supports object URLs. The data URL fallback
  // keeps previews usable in constrained test/browser adapters without ever
  // sending it outside the renderer.
  return `data:${mimeType};base64,${dataBase64}`
}
