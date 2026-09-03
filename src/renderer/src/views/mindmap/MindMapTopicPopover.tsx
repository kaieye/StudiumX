import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CSSProperties } from 'react'
import type { MindMapTopicV2 } from '../../../../shared/mindmap/domain/types'
import { useMindMapViewStore } from './mind-map-view-store'
import { MindMapMarkersPanel } from './MindMapMarkersPanel'
import { MindMapFormulaEditor } from './MindMapFormulaEditor'
import { MindMapLinkEditor } from './MindMapLinkEditor'
import { MindMapImageEditor } from './MindMapImageEditor'

export type MindMapTopicPopoverSection = 'note' | 'markers' | 'formula' | 'link' | 'image'

type MindMapTopicPopoverProps = {
  nodeId: string | null
  section: MindMapTopicPopoverSection
  /** Incremented by the canvas when pan/zoom changes so the anchor follows the node. */
  positionRevision?: number
  /**
   * Open the card as a read-only viewer (AI generation previews). Note content
   * is still resolved from the preview document so it is actually visible.
   */
  readOnly?: boolean
  onClose: () => void
}

type PopoverPosition = {
  top: number
  left: number
  placement: 'below' | 'above'
  caretLeft: number
}

const VIEWPORT_PADDING = 16
const NODE_GAP = 28
const FALLBACK_WIDTH = 360
const FALLBACK_HEIGHT = 200

/**
 * A canvas-adjacent floating editor for a single topic's contextual fields.
 *
 * The insert (add to topic) menu routes markers, notes, formulas and links
 * here so each opens a focused card next to the selected node instead of
 * sending the user to the side inspector. Notes are still written through the
 * normal topic.update command path; this component only changes where the
 * editor appears. The portal keeps the card above the SVG and outside the
 * stage's clipping/stacking contexts while the anchor is recalculated whenever
 * the map viewport moves.
 */
export function MindMapTopicPopover({
  nodeId,
  section,
  positionRevision = 0,
  readOnly = false,
  onClose
}: MindMapTopicPopoverProps) {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const generationPreview = useMindMapViewStore((state) => state.generationPreview)
  const activeSheetId = useMindMapViewStore((state) => state.activeSheetId)
  const updateNode = useMindMapViewStore((state) => state.updateNode)
  const noteInputRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const outsideClickArmedRef = useRef(false)
  const allowImmediateOutsideClickRef = useRef(false)

  // During an AI generation preview the canvas renders the preview document,
  // so the note card must resolve topics from that same document (the
  // canonical `current` does not contain proposal notes until applied).
  const selectedTopic = findTopicForSheet(
    generationPreview?.document ?? current,
    activeSheetId,
    nodeId
  )

  const positionPopover = useCallback((): void => {
    const popover = popoverRef.current
    if (!popover || !nodeId) return
    const anchor = Array.from(document.querySelectorAll<SVGGElement>('.mindmap-node-group'))
      .find((candidate) => candidate.dataset.nodeId === nodeId)
    if (!anchor) return

    const anchorRect = anchor.getBoundingClientRect()
    const popoverRect = popover.getBoundingClientRect()
    const width = popoverRect.width || FALLBACK_WIDTH
    const height = popoverRect.height || FALLBACK_HEIGHT
    const anchorCenter = anchorRect.left + anchorRect.width / 2
    const minLeft = VIEWPORT_PADDING
    const maxLeft = Math.max(minLeft, window.innerWidth - width - VIEWPORT_PADDING)
    const left = Math.min(Math.max(anchorCenter - width / 2, minLeft), maxLeft)
    const spaceBelow = window.innerHeight - anchorRect.bottom - NODE_GAP - VIEWPORT_PADDING
    const canOpenBelow = spaceBelow >= height || anchorRect.top < height + NODE_GAP + VIEWPORT_PADDING
    const placement: PopoverPosition['placement'] = canOpenBelow ? 'below' : 'above'
    const unclampedTop = placement === 'below'
      ? anchorRect.bottom + NODE_GAP
      : anchorRect.top - height - NODE_GAP
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING)
    const top = Math.min(Math.max(unclampedTop, VIEWPORT_PADDING), maxTop)
    const caretLeft = Math.min(Math.max(anchorCenter - left, 28), Math.max(28, width - 28))

    setPosition((previous) => {
      if (
        previous &&
        previous.top === top &&
        previous.left === left &&
        previous.placement === placement &&
        previous.caretLeft === caretLeft
      ) {
        return previous
      }
      return { top, left, placement, caretLeft }
    })
  }, [nodeId])

  useLayoutEffect(() => {
    if (!nodeId || !selectedTopic) return
    const frame = window.requestAnimationFrame(positionPopover)
    return () => window.cancelAnimationFrame(frame)
  }, [nodeId, positionRevision, positionPopover, selectedTopic])

  useLayoutEffect(() => {
    if (!nodeId || !selectedTopic) return
    positionPopover()
    const handleResize = (): void => positionPopover()
    const handleScroll = (event: Event): void => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return
      positionPopover()
    }
    window.addEventListener('resize', handleResize)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [nodeId, positionPopover, selectedTopic])

  useEffect(() => {
    if (!nodeId || !selectedTopic) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (!outsideClickArmedRef.current && !allowImmediateOutsideClickRef.current) return
      allowImmediateOutsideClickRef.current = false
      const target = event.target as Node
      if (!popoverRef.current?.contains(target)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      allowImmediateOutsideClickRef.current = true
      onClose()
    }

    outsideClickArmedRef.current = false
    allowImmediateOutsideClickRef.current = false
    document.addEventListener('pointerdown', handlePointerDown)
    const activationFrame = window.requestAnimationFrame(() => {
      outsideClickArmedRef.current = true
    })
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(activationFrame)
      outsideClickArmedRef.current = false
      allowImmediateOutsideClickRef.current = false
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [nodeId, onClose, selectedTopic])

  useEffect(() => {
    if (!nodeId || !selectedTopic) return
    if (section === 'note') noteInputRef.current?.focus()
  }, [nodeId, section, selectedTopic])

  if (!nodeId || !selectedTopic) return null

  const ariaLabel = sectionAriaLabel(section, t)
  const style: CSSProperties | undefined = position
    ? {
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 1100,
        '--mindmap-note-caret-left': `${position.caretLeft}px`
      } as CSSProperties
    : {
        position: 'fixed',
        top: '50%',
        left: '50%',
        zIndex: 1100,
        transform: 'translate(-50%, -50%)'
      }

  return createPortal(
    <section
      ref={popoverRef}
      className={`mindmap-note-popover${section === 'note' ? '' : ' mindmap-note-popover--section'}${position?.placement === 'above' ? ' is-above' : ''}`}
      style={style}
      role="dialog"
      aria-label={ariaLabel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="mindmap-note-popover__sr-only">
        {selectedTopic.title || t('mindmap.untitledTopic')}
      </span>
      {section === 'note' ? (
        <textarea
          ref={noteInputRef}
          className="mindmap-note-popover__input"
          value={selectedTopic.note ?? ''}
          placeholder={t('mindmap.notesPopover.placeholder')}
          aria-label={t('mindmap.notesPopover.inputLabel')}
          readOnly={readOnly}
          onChange={(event) => {
            if (readOnly) return
            updateNode(selectedTopic.id, { note: event.currentTarget.value || null })
          }}
        />
      ) : section === 'markers' ? (
        <MindMapMarkersPanel />
      ) : section === 'formula' ? (
        <MindMapFormulaEditor topic={selectedTopic} />
      ) : section === 'link' ? (
        <MindMapLinkEditor topic={selectedTopic} />
      ) : (
        <MindMapImageEditor />
      )}
    </section>,
    document.body
  )
}

function sectionAriaLabel(
  section: MindMapTopicPopoverSection,
  t: (key: string) => string
): string {
  switch (section) {
    case 'markers':
      return t('mindmap.markersPanel.title')
    case 'formula':
      return t('mindmap.contentPanel.formula')
    case 'link':
      return t('mindmap.contentPanel.links')
    case 'image':
      return t('mindmap.contentPanel.images')
    case 'note':
    default:
      return t('mindmap.notesPopover.title')
  }
}

function findTopicForSheet(
  current: { sheets: Array<{ id: string; root: MindMapTopicV2 }> } | null,
  activeSheetId: string | null,
  nodeId: string | null
): MindMapTopicV2 | null {
  if (!current || !nodeId) return null
  const sheet = current.sheets.find((candidate) => candidate.id === activeSheetId) ?? current.sheets[0]
  return sheet ? findTopic(sheet.root, nodeId) : null
}

function findTopic(node: MindMapTopicV2, id: string): MindMapTopicV2 | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findTopic(child, id)
    if (found) return found
  }
  return null
}
