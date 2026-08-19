import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent
} from 'react'
import { createPortal } from 'react-dom'
import { Bold, ChevronDown, Italic } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { MindMapTextSpanStyle } from '../../../../shared/mindmap/domain/types'
import { SAFE_FONTS, fontEntryLabel, type FontCatalogueEntry } from './mind-map-font-list'
import type { RichTextSelectionState } from './mind-map-rich-text-dom'
import { MindMapColorPickerBody } from './mind-map-color-picker'

/** Quick color presets shown in the floating toolbar's color popover. */
const TOOLBAR_COLOR_PRESETS: readonly string[] = [
  '#E53935', '#FB8C00', '#FDD835', '#43A047', '#1E88E5',
  '#8E24AA', '#00897B', '#5D4037', '#757575', '#212121'
]

const TOOLBAR_TEXT_COLOR_RECENT_KEY = 'mindmap.recentTextColors'

const TOOLBAR_FONT_SIZES: readonly number[] = [
  9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48
]

const TOOLBAR_GAP = 8
const VIEWPORT_PADDING = 8

export type MindMapTextFormatToolbarProps = {
  /** Selection state from the active rich text editor (null hides it). */
  selection: RichTextSelectionState | null
  /** Apply a style to the current text selection. */
  onApplyStyle: (style: MindMapTextSpanStyle) => void
  /** Toggle bold on the current text selection. */
  onToggleBold: () => void
  /** Toggle italic on the current text selection. */
  onToggleItalic: () => void
  /**
   * Real default font family label — the value the selected text falls back to
   * when it carries no span-level font override (shown instead of "App default").
   */
  defaultFontLabel?: string
  /**
   * Real default font size in px — the value the selected text falls back to
   * when it carries no span-level size override (shown instead of "App default").
   */
  defaultFontSize?: number
}

/**
 * Xmind-style floating text format toolbar. It appears above the selected
 * text inside a node or shape label and offers quick access to color, bold,
 * italic, font family and font size — applied only to the selected span.
 *
 * Every interactive control prevents the default `mousedown` so the inline
 * editor keeps focus and the text selection stays intact while formatting.
 * The colour popover shares the same preset + HEX + opacity + recent-colours
 * body as the canvas background-colour control.
 */
export function MindMapTextFormatToolbar({
  selection,
  onApplyStyle,
  onToggleBold,
  onToggleItalic,
  defaultFontLabel,
  defaultFontSize
}: MindMapTextFormatToolbarProps) {
  const { t } = useTranslation()
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const [openMenu, setOpenMenu] = useState<'color' | 'font' | 'size' | null>(null)

  const rect = selection?.active ? selection.rect : null

  const closeMenu = useCallback((): void => setOpenMenu(null), [])

  /** Place the toolbar above the selection, clamped to the viewport. */
  const placeToolbar = useCallback(
    (target: DOMRect, toolbarWidth: number, toolbarHeight: number): { left: number; top: number } => {
      const left = Math.min(
        Math.max(target.left + target.width / 2 - toolbarWidth / 2, VIEWPORT_PADDING),
        Math.max(VIEWPORT_PADDING, window.innerWidth - toolbarWidth - VIEWPORT_PADDING)
      )
      let top = target.top - toolbarHeight - TOOLBAR_GAP
      if (top < VIEWPORT_PADDING) top = target.bottom + TOOLBAR_GAP
      top = Math.max(VIEWPORT_PADDING, top)
      return { left, top }
    },
    []
  )

  // Render immediately with an estimated size so the toolbar exists for
  // measurement, then refine the position once the real size is known.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(() =>
    rect ? placeToolbar(rect, 320, 40) : null
  )

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!rect || !toolbar) {
      setPosition(rect ? placeToolbar(rect, 320, 40) : null)
      return
    }
    const toolbarWidth = toolbar.offsetWidth || 320
    const toolbarHeight = toolbar.offsetHeight || 36
    setPosition(placeToolbar(rect, toolbarWidth, toolbarHeight))
  }, [rect, openMenu, placeToolbar])

  // Close any open popover when the selection moves or collapses.
  useEffect(() => {
    if (!selection?.active) closeMenu()
  }, [selection, closeMenu])

  // Outside-click + Escape close the open popover.
  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!toolbarRef.current?.contains(target)) closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu, closeMenu])

  if (!selection?.active || !rect || !position) return null

  // Keep the editor focused and the selection intact while using the toolbar.
  const preventEditorBlur = (event: ReactMouseEvent): void => {
    event.preventDefault()
  }

  const fontLabelOf = (entry: FontCatalogueEntry): string =>
    fontEntryLabel(entry, (key) => (key ? t(key) : key))

  const currentFontStack = selection.fontFamily
  const currentFontEntry = SAFE_FONTS.find((entry) => entry.stack === currentFontStack)
  const currentFontLabel = currentFontEntry
    ? fontLabelOf(currentFontEntry)
    : currentFontStack || defaultFontLabel || t('mindmap.textFormat.fontDefault', { defaultValue: 'App default' })

  const currentSize = selection.fontSize
  const inheritedSizeLabel = defaultFontSize !== undefined
    ? `${defaultFontSize}${t('mindmap.textFormat.fontSizeUnit', { defaultValue: 'px' })}`
    : t('mindmap.textFormat.fontDefault', { defaultValue: 'App default' })

  const menuStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    zIndex: 1001
  }

  return createPortal(
    <div
      ref={toolbarRef}
      className="mindmap-text-format-toolbar"
      data-testid="mindmap-text-format-toolbar"
      role="toolbar"
      aria-label={t('mindmap.textFormat.title', { defaultValue: 'Text format' })}
      style={{ left: position.left, top: position.top, position: 'fixed', zIndex: 1000 }}
      onMouseDown={preventEditorBlur}
    >
      <button
        type="button"
        className={`mindmap-text-format-toolbar__btn${selection.bold ? ' is-active' : ''}`}
        aria-pressed={selection.bold}
        aria-label={t('mindmap.textFormat.bold', { defaultValue: 'Bold' })}
        title={t('mindmap.textFormat.bold', { defaultValue: 'Bold' })}
        onClick={onToggleBold}
      >
        <Bold size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`mindmap-text-format-toolbar__btn${selection.italic ? ' is-active' : ''}`}
        aria-pressed={selection.italic}
        aria-label={t('mindmap.textFormat.italic', { defaultValue: 'Italic' })}
        title={t('mindmap.textFormat.italic', { defaultValue: 'Italic' })}
        onClick={onToggleItalic}
      >
        <Italic size={15} aria-hidden="true" />
      </button>

      <div className="mindmap-text-format-toolbar__divider" aria-hidden="true" />

      <div className="mindmap-text-format-toolbar__menu-host">
        <button
          type="button"
          className={`mindmap-text-format-toolbar__btn mindmap-text-format-toolbar__color-btn${openMenu === 'color' ? ' is-active' : ''}`}
          aria-haspopup="true"
          aria-expanded={openMenu === 'color'}
          aria-label={t('mindmap.textFormat.color', { defaultValue: 'Text color' })}
          title={t('mindmap.textFormat.color', { defaultValue: 'Text color' })}
          onClick={() => setOpenMenu((current) => (current === 'color' ? null : 'color'))}
        >
          <span
            className="mindmap-text-format-toolbar__color-swatch"
            style={{ background: selection.color ?? '#000000' }}
            aria-hidden="true"
          />
        </button>
        {openMenu === 'color' ? (
          <div
            className="mindmap-text-format-toolbar__menu mindmap-text-format-toolbar__color-menu"
            style={menuStyle}
            role="dialog"
            aria-label={t('mindmap.textFormat.color', { defaultValue: 'Text color' })}
          >
            <MindMapColorPickerBody
              color={selection.color ?? '#000000'}
              presets={TOOLBAR_COLOR_PRESETS}
              nativeInputId="mindmap-toolbar-text-color-native"
              alphaInputId="mindmap-toolbar-text-color-alpha"
              recentStorageKey={TOOLBAR_TEXT_COLOR_RECENT_KEY}
              alphaLabel={t('mindmap.textFormat.colorAlphaLabel', { defaultValue: 'Text color opacity' })}
              alphaInputLabel={t('mindmap.textFormat.colorAlphaInputLabel', { defaultValue: 'Text color opacity percentage' })}
              nativeRowLabel={t('mindmap.textFormat.color', { defaultValue: 'Text color' })}
              hexInputLabel={t('mindmap.textFormat.colorHex', { defaultValue: 'Text color HEX' })}
              alphaStep={5}
              onColorChange={(color) => onApplyStyle({ color })}
            />
          </div>
        ) : null}
      </div>

      <div className="mindmap-text-format-toolbar__menu-host">
        <button
          type="button"
          className={`mindmap-text-format-toolbar__btn mindmap-text-format-toolbar__select-btn${openMenu === 'font' ? ' is-active' : ''}`}
          aria-haspopup="true"
          aria-expanded={openMenu === 'font'}
          aria-label={t('mindmap.textFormat.font', { defaultValue: 'Font' })}
          onClick={() => setOpenMenu((current) => (current === 'font' ? null : 'font'))}
        >
          <span className="mindmap-text-format-toolbar__select-label">{currentFontLabel}</span>
          <ChevronDown size={12} className="mindmap-text-format-toolbar__chevron" aria-hidden="true" />
        </button>
        {openMenu === 'font' ? (
          <div
            className="mindmap-text-format-toolbar__menu mindmap-text-format-toolbar__font-menu"
            style={menuStyle}
            role="menu"
            aria-label={t('mindmap.textFormat.font', { defaultValue: 'Font' })}
          >
            <button
              type="button"
              role="menuitem"
              className={`mindmap-text-format-toolbar__menu-item${!currentFontStack ? ' is-selected' : ''}`}
              onClick={() => {
                onApplyStyle({ fontFamily: undefined })
                closeMenu()
              }}
            >
              {defaultFontLabel || t('mindmap.textFormat.fontDefault', { defaultValue: 'App default' })}
            </button>
            {SAFE_FONTS.filter((entry) => entry.id !== 'app-default').map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                className={`mindmap-text-format-toolbar__menu-item${currentFontStack === entry.stack ? ' is-selected' : ''}`}
                style={{ fontFamily: entry.stack }}
                onClick={() => {
                  onApplyStyle({ fontFamily: entry.stack })
                  closeMenu()
                }}
              >
                {fontLabelOf(entry)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mindmap-text-format-toolbar__menu-host">
        <button
          type="button"
          className={`mindmap-text-format-toolbar__btn mindmap-text-format-toolbar__select-btn mindmap-text-format-toolbar__size-btn${openMenu === 'size' ? ' is-active' : ''}`}
          aria-haspopup="true"
          aria-expanded={openMenu === 'size'}
          aria-label={t('mindmap.textFormat.fontSize', { defaultValue: 'Font size' })}
          onClick={() => setOpenMenu((current) => (current === 'size' ? null : 'size'))}
        >
          <span className="mindmap-text-format-toolbar__select-label">
            {currentSize !== undefined
              ? `${currentSize}${t('mindmap.textFormat.fontSizeUnit', { defaultValue: 'px' })}`
              : inheritedSizeLabel}
          </span>
          <ChevronDown size={12} className="mindmap-text-format-toolbar__chevron" aria-hidden="true" />
        </button>
        {openMenu === 'size' ? (
          <div
            className="mindmap-text-format-toolbar__menu mindmap-text-format-toolbar__size-menu"
            style={menuStyle}
            role="menu"
            aria-label={t('mindmap.textFormat.fontSize', { defaultValue: 'Font size' })}
          >
            <button
              type="button"
              role="menuitem"
              className={`mindmap-text-format-toolbar__menu-item${currentSize === undefined ? ' is-selected' : ''}`}
              onClick={() => {
                onApplyStyle({ fontSize: undefined })
                closeMenu()
              }}
            >
              {inheritedSizeLabel}
            </button>
            {TOOLBAR_FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="menuitem"
                className={`mindmap-text-format-toolbar__menu-item${currentSize === size ? ' is-selected' : ''}`}
                onClick={() => {
                  onApplyStyle({ fontSize: size })
                  closeMenu()
                }}
              >
                {size}
                {t('mindmap.textFormat.fontSizeUnit', { defaultValue: 'px' })}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
