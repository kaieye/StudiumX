import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AgentChatImageAttachment } from '../../../shared/agent-chat-images'

export function AgentChatImageGallery({
  attachments
}: {
  attachments: readonly AgentChatImageAttachment[]
}) {
  const [openAttachment, setOpenAttachment] = useState<AgentChatImageAttachment | null>(null)
  const closeLightbox = useCallback(() => setOpenAttachment(null), [])

  useEffect(() => {
    if (openAttachment && !attachments.some((attachment) => attachment.id === openAttachment.id)) {
      closeLightbox()
    }
  }, [attachments, closeLightbox, openAttachment])

  if (attachments.length === 0) return null
  const layoutClass = attachments.length === 1 ? 'is-single' : 'is-grid'
  return (
    <>
      <div className={`agent-chat-message-images ${layoutClass}`} aria-label={`已附加 ${attachments.length} 张图片`}>
        {attachments.map((attachment, index) => {
          const src = imageDataUrl(attachment)
          return (
            <button
              key={`${attachment.id}-${index}`}
              type="button"
              className="agent-chat-image-thumb"
              aria-label={`查看图片：${attachment.name}`}
              title="查看图片"
              onClick={() => setOpenAttachment(attachment)}
            >
              <img src={src} alt={attachment.name} draggable={false} />
            </button>
          )
        })}
      </div>
      {openAttachment ? (
        <AgentChatImageLightbox attachment={openAttachment} onClose={closeLightbox} />
      ) : null}
    </>
  )
}

function AgentChatImageLightbox({
  attachment,
  onClose
}: {
  attachment: AgentChatImageAttachment
  onClose: () => void
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const src = imageDataUrl(attachment)

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreFocusRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    <div className="agent-chat-image-lightbox" role="dialog" aria-modal="true" aria-label="图片预览">
      <div className="agent-chat-image-lightbox-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <div className="agent-chat-image-lightbox-content">
        <img src={src} alt={attachment.name} />
        <button
          ref={closeButtonRef}
          type="button"
          className="agent-chat-image-lightbox-close"
          aria-label="关闭图片预览"
          title="关闭"
          onClick={onClose}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body
  )
}

function imageDataUrl(attachment: AgentChatImageAttachment): string {
  return `data:${attachment.mimeType};base64,${attachment.dataBase64}`
}
