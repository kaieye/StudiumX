/**
 * Shared composer image-attachment support.
 *
 * The main overview AI conversation and the mind-map AI panel both attach
 * images to a user turn. This module owns that single shared implementation:
 * draft state, file picking, clipboard paste, removal, preview revocation,
 * and the transport projection sent over IPC. It is deliberately UI-agnostic
 * about the surrounding composer layout — each surface renders the small
 * presentational pieces where they fit.
 */
import { ImagePlus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent, RefObject } from 'react'
import type { AgentChatImageAttachment } from '../../../shared/agent-chat-images'
import {
  createDraftAgentChatImageAttachments,
  imageFilesFromClipboardData,
  revokeDraftAgentChatImageAttachments,
  toAgentChatImageAttachments,
  type DraftAgentChatImageAttachment
} from '../agent-chat-image-attachments'

export const AGENT_CHAT_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export type AgentChatImageDrafts = {
  /** Renderer-only drafts (previewUrl must never cross IPC). */
  attachments: DraftAgentChatImageAttachment[]
  /** Last validation/read error message, cleared on the next successful pick. */
  error: string | null
  hasDrafts: boolean
  /** Hidden file input ref; call `inputRef.current?.click()` to open the picker. */
  inputRef: RefObject<HTMLInputElement | null>
  /** Add files from a picker/paste (validates and appends, capped like agent chat). */
  handleFiles: (files: FileList | readonly File[] | null) => Promise<void>
  /** Remove one draft by id (revokes its preview URL). */
  remove: (id: string) => void
  /** Revoke and clear all drafts. */
  clear: () => void
  /** Extract image files from a textarea paste event. */
  handlePaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void
  /** Transport projection (no previewUrl) for the IPC payload. */
  transportAttachments: () => AgentChatImageAttachment[] | undefined
}

/**
 * Own the draft image state for one composer. Pass a `resetKey` (for example
 * the active conversation/mode) so attachments never leak from one branch or
 * scope into another; the drafts are cleared whenever it changes and on unmount.
 */
export function useAgentChatImageDrafts(options: { resetKey?: unknown } = {}): AgentChatImageDrafts {
  const inputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<DraftAgentChatImageAttachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const attachmentsRef = useRef<DraftAgentChatImageAttachment[]>([])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  const clear = useCallback((): void => {
    const current = attachmentsRef.current
    if (current.length > 0) revokeDraftAgentChatImageAttachments(current)
    attachmentsRef.current = []
    setAttachments([])
    setError(null)
  }, [])

  // Drafts belong to the current conversation/scope. Never carry an attachment
  // selected for one branch into another branch or scope.
  useEffect(() => {
    clear()
  }, [options.resetKey, clear])

  useEffect(() => () => {
    revokeDraftAgentChatImageAttachments(attachmentsRef.current)
  }, [])

  const handleFiles = useCallback(async (files: FileList | readonly File[] | null): Promise<void> => {
    if (!files?.length) return
    setError(null)
    try {
      const drafts = await createDraftAgentChatImageAttachments(files, attachmentsRef.current)
      if (drafts.length === 0) return
      attachmentsRef.current = [...attachmentsRef.current, ...drafts]
      setAttachments((current) => [...current, ...drafts])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法添加图片。')
    }
  }, [])

  const remove = useCallback((id: string): void => {
    const current = attachmentsRef.current
    const removed = current.filter((attachment) => attachment.id === id)
    const retained = current.filter((attachment) => attachment.id !== id)
    if (removed.length > 0) revokeDraftAgentChatImageAttachments(removed)
    attachmentsRef.current = retained
    setAttachments(retained)
    setError(null)
  }, [])

  const handlePaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
    const imageFiles = imageFilesFromClipboardData(event.clipboardData)
    if (imageFiles.length === 0) return
    // Do not prevent the browser's default paste. If the clipboard also has
    // text, it should still land in the composer alongside the image attachment.
    void handleFiles(imageFiles)
  }, [handleFiles])

  const transportAttachments = useCallback(
    (): AgentChatImageAttachment[] | undefined => {
      const current = attachmentsRef.current
      return current.length > 0 ? toAgentChatImageAttachments(current) : undefined
    },
    []
  )

  return {
    attachments,
    error,
    hasDrafts: attachments.length > 0,
    inputRef,
    handleFiles,
    remove,
    clear,
    handlePaste,
    transportAttachments
  }
}

/**
 * Hidden file input that opens the native picker through its ref. Shared by
 * every composer so the picker always validates with the same bounded rules.
 */
export function AgentChatImageFileInput({
  inputRef,
  disabled,
  onFiles,
  accept = AGENT_CHAT_IMAGE_ACCEPT
}: {
  inputRef: RefObject<HTMLInputElement | null>
  disabled?: boolean
  onFiles: (files: FileList | readonly File[] | null) => void
  accept?: string
}) {
  return (
    <input
      ref={inputRef}
      className="agent-chat-image-file-input"
      type="file"
      multiple
      accept={accept}
      tabIndex={-1}
      aria-hidden="true"
      disabled={disabled}
      onChange={(event) => {
        const files = event.currentTarget.files
        onFiles(files)
        // Permit selecting the same image again after removing it.
        event.currentTarget.value = ''
      }}
    />
  )
}

/** Thumbnail rail shown inside a composer card once drafts exist. */
export function AgentChatImageAttachmentRail({
  attachments,
  onRemove
}: {
  attachments: readonly DraftAgentChatImageAttachment[]
  onRemove: (id: string) => void
}) {
  if (attachments.length === 0) return null
  return (
    <div className="agent-chat-image-attachment-rail" aria-label={`已添加 ${attachments.length} 张图片`}>
      {attachments.map((attachment) => (
        <div className="agent-chat-image-attachment" key={attachment.id}>
          <img src={attachment.previewUrl} alt={attachment.name} draggable={false} />
          <button
            type="button"
            className="agent-chat-image-remove"
            aria-label={`移除图片：${attachment.name}`}
            title="移除图片"
            onClick={() => onRemove(attachment.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Validation error line shown under the composer rail. */
export function AgentChatImageComposerError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p className="agent-chat-image-error" role="status" aria-live="polite">
      {error}
    </p>
  )
}

/** Toolbar button that opens the shared hidden image picker input. */
export function AgentChatImagePickerButton({
  onClick,
  disabled,
  ariaLabel = '添加图片',
  title = '添加图片'
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
  title?: string
}) {
  return (
    <button
      type="button"
      className="overview-dialog-icon agent-chat-image-picker"
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <ImagePlus size={17} aria-hidden="true" />
    </button>
  )
}
