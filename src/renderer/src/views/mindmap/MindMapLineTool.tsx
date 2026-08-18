import { ArrowUpRight, ChevronDown } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  MindMapCanvasLineTool,
  MindMapCanvasLineStyle
} from './mind-map-line-tool'

export type MindMapLineToolOption = Readonly<{
  id: string
  labelKey: string
  tool: MindMapCanvasLineStyle
}>

/** Presets exposed by the compact line toolbar. More styles can be added here
 * without changing the canvas gesture or persistence layer. */
export const MIND_MAP_LINE_TOOL_OPTIONS: readonly MindMapLineToolOption[] = [
  {
    id: 'curved-arrow',
    labelKey: 'lineCurvedArrow',
    tool: { lineShape: 'curved', endArrow: 'triangle' }
  },
  {
    id: 'straight-arrow',
    labelKey: 'lineStraightArrow',
    tool: { lineShape: 'straight', endArrow: 'triangle' }
  },
  {
    id: 'curved-line',
    labelKey: 'lineCurved',
    tool: { lineShape: 'curved', endArrow: 'none' }
  },
  {
    id: 'straight-line',
    labelKey: 'lineStraight',
    tool: { lineShape: 'straight', endArrow: 'none' }
  },
  {
    id: 'angled-arrow',
    labelKey: 'lineAngledArrow',
    tool: { lineShape: 'angled', endArrow: 'triangle' }
  },
  {
    id: 'zigzag-arrow',
    labelKey: 'lineZigzagArrow',
    tool: { lineShape: 'zigzag', endArrow: 'triangle' }
  }
]

const LONG_PRESS_DELAY_MS = 450
const DEFAULT_LINE_TOOL: MindMapCanvasLineStyle = {
  lineShape: 'straight',
  endArrow: 'triangle'
}

type MindMapLineToolProps = Readonly<{
  disabled?: boolean
  activeTool?: MindMapCanvasLineTool | null
  onToolChange?: (tool: MindMapCanvasLineTool | null) => void
}>

function sameTool(a: MindMapCanvasLineTool | null | undefined, b: MindMapCanvasLineStyle): boolean {
  if (!a?.active) return false
  return a.lineShape === b.lineShape
    && (a.beginArrow ?? 'none') === (b.beginArrow ?? 'none')
    && (a.endArrow ?? 'none') === (b.endArrow ?? 'none')
    && (a.linePattern ?? 'solid') === (b.linePattern ?? 'solid')
}

/** Toolbar control for free-form curves, arrows and connector lines. A short
 * click arms the default straight arrow; holding it opens the style palette. */
export function MindMapLineTool({
  disabled = false,
  activeTool,
  onToolChange
}: MindMapLineToolProps) {
  const { t } = useTranslation()
  const [uncontrolledTool, setUncontrolledTool] = useState<MindMapCanvasLineTool | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const longPressRef = useRef(false)
  const suppressClickRef = useRef(false)

  const selectedTool = activeTool === undefined ? uncontrolledTool : activeTool

  const updateTool = (tool: MindMapCanvasLineTool | null): void => {
    if (activeTool === undefined) setUncontrolledTool(tool)
    onToolChange?.(tool)
    setMenuOpen(false)
    triggerRef.current?.focus()
  }

  const choosePreset = (preset: MindMapLineToolOption): void => {
    updateTool({ active: true, ...preset.tool })
  }

  const openMenu = (): void => {
    if (!disabled) setMenuOpen(true)
  }

  const clearTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const beginLongPress = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (disabled || (event.button !== 0 && event.button !== undefined)) return
    clearTimer()
    longPressRef.current = false
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      longPressRef.current = true
      suppressClickRef.current = true
      openMenu()
    }, LONG_PRESS_DELAY_MS)
  }

  const endLongPress = (): void => {
    clearTimer()
    if (longPressRef.current) {
      // Prevent the synthetic click generated after pointerup from arming the
      // default preset. Clear the guard on the next task as a fallback for
      // platforms that do not synthesize a click.
      window.setTimeout(() => {
        longPressRef.current = false
        suppressClickRef.current = false
      }, 0)
    }
  }

  const cancelLongPress = (): void => {
    clearTimer()
    longPressRef.current = false
  }

  const handleClick = (): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    updateTool({ active: true, ...DEFAULT_LINE_TOOL })
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' && event.altKey) {
      event.preventDefault()
      openMenu()
    } else if (event.key === 'Escape') {
      setMenuOpen(false)
    }
  }

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  useEffect(() => {
    if (disabled) setMenuOpen(false)
  }, [disabled])

  const activeLabel = t('mindmap.toolbar.line', { defaultValue: 'Line' })
  const selectedPreset = MIND_MAP_LINE_TOOL_OPTIONS.find((preset) => sameTool(selectedTool, preset.tool))
  const triggerLabel = selectedPreset
    ? `${activeLabel}: ${t(`mindmap.toolbar.${selectedPreset.labelKey}`, { defaultValue: selectedPreset.id })}`
    : activeLabel

  return (
    <div ref={rootRef} className="mindmap-line-tool">
      <button
        ref={triggerRef}
        type="button"
        className={`mindmap-floating-toolbar__btn${selectedTool?.active ? ' is-active' : ''}`}
        disabled={disabled}
        onClick={handleClick}
        onPointerDown={beginLongPress}
        onPointerUp={endLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onContextMenu={(event) => {
          event.preventDefault()
          cancelLongPress()
          openMenu()
        }}
        onKeyDown={handleKeyDown}
        data-tooltip={activeLabel}
        aria-label={triggerLabel}
        aria-pressed={Boolean(selectedTool?.active)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <ArrowUpRight size={16} aria-hidden="true" />
        <ChevronDown size={8} className="mindmap-floating-toolbar__submenu-chevron" aria-hidden="true" />
      </button>

      {menuOpen ? (
        <div className="mindmap-line-tool__menu" role="menu" aria-label={t('mindmap.toolbar.lineMenu', { defaultValue: 'Line styles' })}>
          {MIND_MAP_LINE_TOOL_OPTIONS.map((preset) => {
            const selected = sameTool(selectedTool, preset.tool)
            return (
              <button
                key={preset.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`mindmap-line-tool__option${selected ? ' is-selected' : ''}`}
                onClick={() => choosePreset(preset)}
              >
                <span className={`mindmap-line-tool__glyph mindmap-line-tool__glyph--${preset.tool.lineShape}`} aria-hidden="true">
                  {preset.tool.lineShape === 'straight' ? '↗' : preset.tool.lineShape === 'angled' ? '⌁' : preset.tool.lineShape === 'zigzag' ? '↝' : '〰'}
                  {preset.tool.endArrow && preset.tool.endArrow !== 'none' ? '›' : ''}
                </span>
                <span>{t(`mindmap.toolbar.${preset.labelKey}`, { defaultValue: preset.id })}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
