import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { MindMapTheme } from '../../../../shared/mindmap/domain/types'
import {
  BUILT_IN_THEMES,
  getBuiltInThemeFidelityReport
} from '../../../../shared/mindmap/themes/built-in-themes'
import { COLOR_SCHEMES } from '../../../../shared/mindmap/themes/color-schemes'
import { useMindMapViewStore } from './mind-map-view-store'

/** Render a compact map preview using the real colours from a style preset. */
function renderThemeThumb(theme: MindMapTheme): ReactNode {
  const bg = theme.background && theme.background !== 'transparent' ? theme.background : '#FFFFFF'
  const centerFill = theme.topicStyles?.central?.fill ?? '#333333'
  const centerText = theme.topicStyles?.central?.textColor ?? '#FFFFFF'
  const subFill = theme.topicStyles?.sub?.fill ?? '#F8F7F7'
  const colors = theme.branchColors ?? COLOR_SCHEMES[0]!.colors

  return (
    <svg width="96" height="64" viewBox="0 0 96 64" className="mindmap-theme-gallery__thumb" aria-hidden="true">
      <rect x="0" y="0" width="96" height="64" fill={bg} rx="6" />
      <rect x="8" y="24" width="28" height="16" rx="4" fill={centerFill} />
      {colors.slice(0, 4).map((color, index) => {
        const x = 46
        const y = 6 + index * 14
        return (
          <g key={color}>
            <path
              d={`M 36 32 C 42 32, 42 ${y + 6}, ${x} ${y + 6}`}
              fill="none"
              stroke={color}
              strokeWidth={index === 0 ? 2.5 : 1.5}
            />
            <rect x={x} y={y} width="42" height="12" rx="3" fill={subFill} stroke={color} strokeWidth="0.8" />
          </g>
        )
      })}
      <text x="22" y="35" textAnchor="middle" fill={centerText} fontSize="7" fontWeight="600">A</text>
    </svg>
  )
}

type CompactPickerProps = {
  id: string
  label: string
  valueLabel: string
  preview: ReactNode
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Compact inspector row whose options stay out of the panel until requested. */
function CompactPicker({ id, label, valueLabel, preview, children, open, onOpenChange }: CompactPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const selected = rootRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    const first = rootRef.current?.querySelector<HTMLElement>('[role="option"]')
    ;(selected ?? first)?.focus()

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, onOpenChange])

  const onOptionClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (!target.closest('[role="option"]')) return
    queueMicrotask(() => triggerRef.current?.focus())
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onOpenChange(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft') return

    const options = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const currentIndex = options.indexOf(document.activeElement as HTMLElement)
    if (options.length === 0) return
    event.preventDefault()
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
    options[(currentIndex + step + options.length) % options.length]?.focus()
  }

  return (
    <div ref={rootRef} className="mindmap-theme-picker" onClick={onOptionClick} onKeyDown={onKeyDown}>
      <span className="mm-row__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="mindmap-theme-picker__trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-options`}
        aria-label={`${label} ${valueLabel}`}
        onClick={() => onOpenChange(!open)}
      >
        {preview}
        <span className="mindmap-theme-picker__value">{valueLabel}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div id={`${id}-options`} className="mindmap-theme-picker__popover" role="listbox" aria-label={label}>
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function MindMapThemeGallery() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const [openPicker, setOpenPicker] = useState<'scheme' | 'preset' | null>(null)

  if (!current) return null

  const activeScheme = COLOR_SCHEMES.find((scheme) => scheme.id === current.theme.colorSchemeId) ?? COLOR_SCHEMES[0]!
  const activePreset = BUILT_IN_THEMES.find((theme) => theme.id === current.theme.id)
  const activePresetName = activePreset
    ? t(`mindmap.themeGallery.${activePreset.id}`, activePreset.name ?? activePreset.id)
    : t('mindmap.themeGallery.custom')
  const rainbowBranches = current.theme.rainbowBranches !== false
  const branchPreviewColors = rainbowBranches
    ? current.theme.branchColors ?? activeScheme.colors
    : [current.theme.lineColor ?? '#8E8E93']
  const activeSchemeLabel = [
    t(`mindmap.colorScheme.${activeScheme.nameKey}`, activeScheme.id),
    t(rainbowBranches ? 'mindmap.themeGallery.rainbowPalette' : 'mindmap.themeGallery.singleColor')
  ].join(' · ')

  const applyTheme = (theme: MindMapTheme): void => {
    // Style presets and colour schemes are independent: applying a preset keeps the palette.
    dispatchCommand(
      {
        type: 'document.apply-theme',
        theme: {
          ...theme,
          branchColors: current.theme.branchColors ?? theme.branchColors,
          colorSchemeId: current.theme.colorSchemeId ?? theme.colorSchemeId
        }
      },
      { label: t('mindmap.themeGallery.applyPreset') }
    )
    setOpenPicker(null)
  }

  const applyColorScheme = (schemeId: string, colors: readonly string[]): void => {
    dispatchCommand(
      {
        type: 'document.apply-theme',
        theme: { ...current.theme, branchColors: [...colors], colorSchemeId: schemeId }
      },
      { label: t('mindmap.themeGallery.applyColorScheme') }
    )
    setOpenPicker(null)
  }

  return (
    <section className="mindmap-theme-gallery mm-section" aria-labelledby="mindmap-theme-gallery-title">
      <div className="mm-section__head">
        <strong id="mindmap-theme-gallery-title">{t('mindmap.themeGallery.mapAppearance')}</strong>
      </div>

      <CompactPicker
        id="mindmap-color-scheme"
        label={t('mindmap.colorSchemeTitle')}
        valueLabel={activeSchemeLabel}
        preview={(
          <span
            className="mindmap-theme-picker__palette"
            data-branch-mode={rainbowBranches ? 'rainbow' : 'single'}
            aria-hidden="true"
          >
            {branchPreviewColors.map((color) => <span key={color} style={{ background: color }} />)}
          </span>
        )}
        open={openPicker === 'scheme'}
        onOpenChange={(open) => setOpenPicker(open ? 'scheme' : null)}
      >
        <div className="mindmap-theme-picker__scheme-grid">
          {COLOR_SCHEMES.map((scheme) => {
            const selected = activeScheme.id === scheme.id
            const name = t(`mindmap.colorScheme.${scheme.nameKey}`, scheme.id)
            return (
              <button
                key={scheme.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`mindmap-theme-picker__scheme-option${selected ? ' is-active' : ''}`}
                onClick={() => applyColorScheme(scheme.id, scheme.colors)}
              >
                <span className="mindmap-theme-picker__palette" aria-hidden="true">
                  {scheme.colors.map((color) => <span key={color} style={{ background: color }} />)}
                </span>
                <span>{name}</span>
                {selected ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      </CompactPicker>

      <CompactPicker
        id="mindmap-style-preset"
        label={t('mindmap.themeGallery.stylePreset')}
        valueLabel={activePresetName}
        preview={<span className="mindmap-theme-picker__mini-map">{renderThemeThumb(activePreset ?? current.theme)}</span>}
        open={openPicker === 'preset'}
        onOpenChange={(open) => setOpenPicker(open ? 'preset' : null)}
      >
        <p className="mindmap-theme-picker__hint">{t('mindmap.themeGallery.approximationHint')}</p>
        <div className="mindmap-theme-gallery__grid">
          {BUILT_IN_THEMES.map((theme) => {
            const selected = current.theme.id === theme.id
            const name = t(`mindmap.themeGallery.${theme.id}`, theme.name ?? theme.id)
            const fidelity = getBuiltInThemeFidelityReport(theme.id)?.report
            const preserved = fidelity?.preserved.reduce((total, finding) => total + finding.count, 0) ?? 0
            const approximated = fidelity?.approximated.reduce((total, finding) => total + finding.count, 0) ?? 0
            const dropped = fidelity?.dropped.reduce((total, finding) => total + finding.count, 0) ?? 0
            const fidelityLabel = t('mindmap.themeGallery.fidelityAria', {
              preserved,
              approximated,
              dropped
            })
            return (
              <button
                key={theme.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`mindmap-theme-gallery__preset${selected ? ' is-active' : ''}`}
                onClick={() => applyTheme(theme)}
                title={`${name} — ${fidelityLabel}`}
                aria-label={`${name}. ${fidelityLabel}`}
              >
                {renderThemeThumb(theme)}
                <span className="mindmap-theme-gallery__name">{name}</span>
                <span className="mindmap-theme-gallery__fidelity" aria-hidden="true">
                  {t('mindmap.themeGallery.fidelitySummary', { preserved, approximated, dropped })}
                </span>
              </button>
            )
          })}
        </div>
      </CompactPicker>
    </section>
  )
}
