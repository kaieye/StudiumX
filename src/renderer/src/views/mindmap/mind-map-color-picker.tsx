import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

/**
 * Shared colour-editing primitives for the mind map. The document-theme
 * controls (canvas background, branch-line colour), the topic/element style
 * inspectors and the floating text-format toolbar all open the *same* colour
 * picker body (preset palette + native colour well + hex input + opacity
 * slider + recent colours), so every colour adjustment in the app looks and
 * behaves like the background-colour control.
 */

export const MIND_MAP_HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

export const MAX_RECENT_COLORS = 8

export function expandHexDigits(digits: string): string {
  return digits.length === 3
    ? digits.split('').map((part) => `${part}${part}`).join('')
    : digits
}

/** The native colour well needs an opaque 6-digit value; strip any alpha. */
export function hexColorWellValue(color: string): string {
  const match = MIND_MAP_HEX_COLOR_PATTERN.exec(color)
  if (!match) return '#ffffff'
  return `#${expandHexDigits(match[1]!).slice(0, 6).toLowerCase()}`
}

/** Current alpha of a hex colour as a percentage; defaults to 100%. */
export function colorAlphaPercent(color: string): number {
  const match = MIND_MAP_HEX_COLOR_PATTERN.exec(color)
  if (!match) return 100
  const digits = expandHexDigits(match[1]!)
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1
  return Math.round(alpha * 100)
}

/** Rewrite a hex colour as 8-digit #RRGGBBAA with the given percentage alpha. */
export function colorWithAlpha(color: string, percent: number): string | null {
  const match = MIND_MAP_HEX_COLOR_PATTERN.exec(color)
  if (!match) return null
  const digits = expandHexDigits(match[1]!).slice(0, 6).toUpperCase()
  const alpha = Math.max(0, Math.min(255, Math.round((percent / 100) * 255)))
  return `#${digits}${alpha.toString(16).padStart(2, '0').toUpperCase()}`
}

export function normalizeRecentColor(value: string): string | null {
  if (!MIND_MAP_HEX_COLOR_PATTERN.test(value)) return null
  const digits = expandHexDigits(MIND_MAP_HEX_COLOR_PATTERN.exec(value)![1]!)
  const rgb = digits.slice(0, 6).toUpperCase()
  const alpha = digits.length === 8 ? digits.slice(6, 8).toUpperCase() : 'FF'
  // Collapse fully-opaque colours to the familiar 6-digit form; keep any real
  // transparency so opacity-adjusted swatches stay visually distinct.
  return alpha === 'FF' ? `#${rgb}` : `#${rgb}${alpha}`
}

export function loadRecentColors(storageKey: string): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const colors = parsed
      .map((value) => typeof value === 'string' ? normalizeRecentColor(value) : null)
      .filter((value): value is string => value !== null)
    return [...new Set(colors)].slice(0, MAX_RECENT_COLORS)
  } catch {
    return []
  }
}

export function recordRecentColor(colors: readonly string[], value: string): string[] {
  const normalized = normalizeRecentColor(value)
  if (!normalized) return [...colors]
  return [
    normalized,
    ...colors.filter((color) => color !== normalized)
  ].slice(0, MAX_RECENT_COLORS)
}

export function persistRecentColors(storageKey: string, colors: readonly string[]): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(colors))
  } catch {
    // localStorage may be unavailable; keep the in-memory list usable.
  }
}

export function clearStoredRecentColors(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // localStorage may be unavailable; the visible list is cleared regardless.
  }
}

export type MindMapColorPickerBodyProps = {
  /** Current effective colour (hex, 8-digit hex or 'transparent'). */
  color: string
  presets: readonly string[]
  nativeInputId: string
  alphaInputId: string
  recentStorageKey: string
  /** Accessible label / title of the opacity slider. */
  alphaLabel: string
  /** Accessible label of the opacity percentage number input. */
  alphaInputLabel: string
  /** Shown as aria-description when opacity is unavailable (transparent). */
  alphaUnavailableLabel?: string
  /** Row label + native input aria-label. */
  nativeRowLabel: string
  /** When set, an editable HEX field with this aria-label is shown. */
  hexInputLabel?: string
  /** Slider step; the theme picker uses 1, topic/text pickers use 5. */
  alphaStep?: number
  /** Called for every committed/previewed colour change (records recent). */
  onColorChange: (color: string) => void
}

/**
 * The portaled popover *body* shared by every mind-map colour control: preset
 * palette, native colour well, optional HEX field, opacity slider and recent
 * colours. Callers wrap it in their own positioned/portaled popover so each
 * trigger keeps its own open state, focus and viewport clamping.
 */
export function MindMapColorPickerBody({
  color,
  presets,
  nativeInputId,
  alphaInputId,
  recentStorageKey,
  alphaLabel,
  alphaInputLabel,
  alphaUnavailableLabel,
  nativeRowLabel,
  hexInputLabel,
  alphaStep = 1,
  onColorChange
}: MindMapColorPickerBodyProps) {
  const { t } = useTranslation()
  const nativeColorDraftRef = useRef<string | null>(null)
  const committedHexRef = useRef<string | null>(null)
  const [hexDraft, setHexDraft] = useState(() => hexColorWellValue(color))
  const [recentColors, setRecentColors] = useState<string[]>(() => loadRecentColors(recentStorageKey))

  // Keep the hex editor in sync with the committed colour (preset / native
  // well / recent swatch). Typing drives `hexDraft` locally, so it is only
  // reset here on external colour changes.
  useEffect(() => {
    setHexDraft(hexColorWellValue(color))
  }, [color])

  // Reload the recent list each time the popover opens. A reorder persisted for
  // the next session (recent-swatch switch) should only take effect on the next
  // open, never reshuffling the list while it is open.
  useEffect(() => {
    setRecentColors(loadRecentColors(recentStorageKey))
    // `recentStorageKey` is stable per control; the open/close transition is
    // what should re-read storage, and that is driven by remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentStorageKey])

  const selectedColor = normalizeRecentColor(color)
  const alphaPercent = colorAlphaPercent(color)
  const alphaUnavailable = color === 'transparent'
  const alphaStepClamped = Math.max(1, Math.floor(alphaStep))

  const rememberRecentColor = (value: string): void => {
    setRecentColors((previous) => {
      const next = recordRecentColor(previous, value)
      if (next.length === previous.length && next.every((candidate, index) => candidate === previous[index])) {
        return previous
      }
      persistRecentColors(recentStorageKey, next)
      return next
    })
  }

  const commitColor = (value: string): void => {
    onColorChange(value)
    rememberRecentColor(value)
  }

  const selectRecentColor = (value: string): void => {
    onColorChange(value)
    // Switching among recent swatches should not reshuffle the visible list
    // while the popover stays open; persist the reorder so the next open shows
    // this swatch at the front.
    persistRecentColors(recentStorageKey, recordRecentColor(recentColors, value))
  }

  const previewNativeColor = (value: string): void => {
    const normalized = value.toUpperCase()
    nativeColorDraftRef.current = normalized
    onColorChange(normalized)
  }

  const commitNativeColor = (value: string): void => {
    const normalized = value.toUpperCase()
    const pending = nativeColorDraftRef.current
    nativeColorDraftRef.current = null
    if (pending || normalized !== hexColorWellValue(color).toUpperCase()) {
      rememberRecentColor(pending ?? normalized)
    }
  }

  const commitHexDraft = (): void => {
    if (MIND_MAP_HEX_COLOR_PATTERN.test(hexDraft)) {
      const normalized = hexDraft.toUpperCase()
      committedHexRef.current = normalized
      commitColor(normalized)
      return
    }
    setHexDraft(hexColorWellValue(color))
  }

  const applyAlpha = (percent: number): void => {
    const next = colorWithAlpha(color, Math.max(0, Math.min(100, percent)))
    // Opacity is a refinement of the current colour, not a new colour choice.
    // Keep the recent row stable while the slider is being adjusted.
    if (next) onColorChange(next)
  }

  const commitAlpha = (): void => {
    // A finished opacity adjustment is a distinct colour choice: once the
    // slider is released (or the input loses focus), record the resulting
    // 8-digit colour as a recent swatch instead of only previewing it.
    rememberRecentColor(color)
  }

  const clearRecentColors = (): void => {
    setRecentColors([])
    clearStoredRecentColors(recentStorageKey)
  }

  return (
    <>
      <div
        className="mindmap-theme-bg-picker__presets"
        role="group"
        aria-label={t('mindmap.themePanel.presetColors')}
      >
        {presets.map((preset) => {
          const selected = selectedColor === preset
          return (
            <button
              key={preset}
              type="button"
              className={selected ? 'is-selected' : undefined}
              aria-label={`${t('mindmap.themePanel.presetColor')} ${preset}`}
              aria-pressed={selected}
              title={preset}
              style={{ background: preset }}
              onClick={() => commitColor(preset)}
            />
          )
        })}
      </div>
      <div className="mindmap-theme-bg-picker__controls">
        <div className="mindmap-theme-bg-picker__row">
          <label className="mm-row__label" htmlFor={nativeInputId}>
            {nativeRowLabel}
          </label>
          <span className="mindmap-theme-bg-picker__row-controls">
            <input
              id={nativeInputId}
              type="color"
              aria-label={nativeRowLabel}
              value={hexColorWellValue(color)}
              onChange={(event) => previewNativeColor(event.currentTarget.value)}
              onBlur={(event) => commitNativeColor(event.currentTarget.value)}
            />
            {hexInputLabel ? (
              <input
                className="mindmap-theme-color-editor__hex"
                aria-label={hexInputLabel}
                value={hexDraft}
                spellCheck={false}
                onChange={(event) => setHexDraft(event.currentTarget.value)}
                onBlur={() => {
                  const normalized = MIND_MAP_HEX_COLOR_PATTERN.test(hexDraft)
                    ? hexDraft.toUpperCase()
                    : null
                  if (normalized && committedHexRef.current === normalized) {
                    committedHexRef.current = null
                    setHexDraft(normalized)
                    return
                  }
                  committedHexRef.current = null
                  commitHexDraft()
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  commitHexDraft()
                  event.currentTarget.blur()
                }}
              />
            ) : null}
          </span>
        </div>
        <div className="mindmap-theme-bg-picker__alpha">
          <label className="mindmap-theme-bg-picker__alpha-label" htmlFor={alphaInputId}>
            {t('mindmap.themePanel.alpha')}
          </label>
          <span className="mindmap-theme-alpha-row__control">
            <input
              id={alphaInputId}
              type="range"
              min={0}
              max={100}
              step={alphaStepClamped}
              disabled={alphaUnavailable}
              aria-label={alphaLabel}
              aria-description={alphaUnavailable ? alphaUnavailableLabel : undefined}
              title={alphaLabel}
              value={alphaPercent}
              style={{
                background: `linear-gradient(to right, var(--accent, #438eff) 0 ${alphaPercent}%, color-mix(in srgb, var(--text) 14%, transparent) ${alphaPercent}% 100%)`
              }}
              onChange={(event) => applyAlpha(Number(event.currentTarget.value))}
              onPointerUp={commitAlpha}
              onBlur={commitAlpha}
            />
            <label
              className="mindmap-theme-alpha-row__value"
              aria-label={alphaInputLabel}
            >
              <input
                type="number"
                min={0}
                max={100}
                step={alphaStepClamped}
                disabled={alphaUnavailable}
                aria-label={alphaInputLabel}
                value={alphaPercent}
                onChange={(event) => {
                  if (!Number.isNaN(event.currentTarget.valueAsNumber)) {
                    applyAlpha(event.currentTarget.valueAsNumber)
                  }
                }}
                onBlur={commitAlpha}
              />
              <span aria-hidden="true">%</span>
            </label>
          </span>
        </div>
      </div>
      <div className="mindmap-theme-bg-picker__recent">
        <div className="mindmap-theme-bg-picker__recent-head">
          <span>{t('mindmap.themePanel.recentColors')}</span>
          {recentColors.length > 0 ? (
            <button
              type="button"
              className="mindmap-theme-bg-picker__recent-clear"
              aria-label={t('mindmap.themePanel.clearRecent')}
              title={t('mindmap.themePanel.clearRecent')}
              onClick={clearRecentColors}
            >
              <X size={12} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {recentColors.length > 0 ? (
          <div
            className="mindmap-theme-bg-picker__recent-colors"
            role="group"
            aria-label={t('mindmap.themePanel.recentColors')}
          >
            {recentColors.map((recent) => {
              const selected = selectedColor === recent
              return (
                <button
                  key={recent}
                  type="button"
                  className={selected ? 'is-selected' : undefined}
                  aria-label={`${t('mindmap.themePanel.recentColorLabel')} ${recent}`}
                  aria-pressed={selected}
                  title={recent}
                  style={{ background: recent }}
                  onClick={() => selectRecentColor(recent)}
                />
              )
            })}
          </div>
        ) : (
          <span className="mindmap-theme-bg-picker__recent-empty">
            {t('mindmap.themePanel.noRecentColors')}
          </span>
        )}
      </div>
    </>
  )
}
