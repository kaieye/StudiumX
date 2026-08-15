import { Check, ChevronDown, Copy, Pencil, Plus, Star } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COLOR_SCHEMES,
  getColorSchemeCategory,
  type MindMapColorSchemeCategory
} from '../../../../shared/mindmap/themes/color-schemes'
import {
  type UserColorScheme
} from './mind-map-color-scheme-catalog'
import { MindMapColorSchemeEditor } from './MindMapColorSchemeEditor'
import { useMindMapViewStore } from './mind-map-view-store'

function renderColorStrip(colors: readonly string[]): ReactNode {
  return (
    <span className="mindmap-theme-picker__palette" aria-hidden="true">
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} style={{ background: color }} />
      ))}
    </span>
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
    // From the search input (not an option), ArrowDown enters the list at the
    // top and ArrowUp at the bottom; between options the list wraps around.
    const nextIndex =
      currentIndex === -1
        ? step === 1
          ? 0
          : options.length - 1
        : (currentIndex + step + options.length) % options.length
    options[nextIndex]?.focus()
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

type SchemeEntry = {
  id: string
  name: string
  colors: readonly string[]
  custom: boolean
}

type EditorTarget = { mode: 'create' } | { mode: 'edit'; id: string } | null

export function MindMapThemeGallery() {
  const { t } = useTranslation()
  const current = useMindMapViewStore((state) => state.current)
  const dispatchCommand = useMindMapViewStore((state) => state.dispatchCommand)
  const colorSchemes = useMindMapViewStore((state) => state.colorSchemes)
  const createColorScheme = useMindMapViewStore((state) => state.createColorScheme)
  const renameColorScheme = useMindMapViewStore((state) => state.renameColorScheme)
  const updateColorSchemeColors = useMindMapViewStore((state) => state.updateColorSchemeColors)
  const duplicateColorScheme = useMindMapViewStore((state) => state.duplicateColorScheme)
  const deleteColorScheme = useMindMapViewStore((state) => state.deleteColorScheme)
  const toggleColorSchemeFavorite = useMindMapViewStore((state) => state.toggleColorSchemeFavorite)
  const recordRecentColorScheme = useMindMapViewStore((state) => state.recordRecentColorScheme)
  const [openPicker, setOpenPicker] = useState<'scheme' | null>(null)
  const [editor, setEditor] = useState<EditorTarget>(null)
  const [searchQuery, setSearchQuery] = useState('')

  if (!current) return null

  const builtInEntries: SchemeEntry[] = COLOR_SCHEMES.map((scheme) => ({
    id: scheme.id,
    name: t(`mindmap.colorScheme.${scheme.nameKey}`, scheme.id),
    colors: scheme.colors,
    custom: false
  }))
  const customEntries: SchemeEntry[] = colorSchemes.schemes.map((scheme) => ({
    id: scheme.id,
    name: scheme.name,
    colors: scheme.colors,
    custom: true
  }))
  const allEntries: SchemeEntry[] = [...builtInEntries, ...customEntries]
  const entryById = new Map(allEntries.map((entry) => [entry.id, entry]))

  const activeSchemeId = current.theme.colorSchemeId ?? COLOR_SCHEMES[0]!.id
  const activeEntry = entryById.get(activeSchemeId) ?? builtInEntries[0]!
  const rainbowBranches = current.theme.rainbowBranches !== false
  const branchPreviewColors = rainbowBranches
    ? current.theme.branchColors ?? activeEntry.colors
    : [current.theme.lineColor ?? '#8E8E93']
  const activeSchemeLabel = [
    activeEntry.name,
    t(rainbowBranches ? 'mindmap.themeGallery.rainbowPalette' : 'mindmap.themeGallery.singleColor')
  ].join(' · ')

  const isFavorite = (id: string): boolean => colorSchemes.favorites.includes(id)
  const favoritesSet = new Set(colorSchemes.favorites)
  const recentEntries = colorSchemes.recent
    .map((id) => entryById.get(id))
    .filter((entry): entry is SchemeEntry => entry !== undefined)

  const applyColorScheme = (schemeId: string, colors: readonly string[]): void => {
    dispatchCommand(
      {
        type: 'document.apply-theme',
        theme: {
          ...current.theme,
          branchColors: [...colors],
          colorSchemeId: schemeId,
          rainbowBranches: true
        }
      },
      { label: t('mindmap.themeGallery.applyColorScheme') }
    )
    recordRecentColorScheme(schemeId)
    setSearchQuery('')
    setOpenPicker(null)
  }

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const categoryLabel = (category: MindMapColorSchemeCategory): string => {
    switch (category) {
      case 'recommended':
        return t('mindmap.colorScheme.recommended', 'Recommended')
      case 'classic':
        return t('mindmap.colorScheme.classic', 'Classic')
      case 'custom':
        return t('mindmap.colorScheme.custom', 'Custom')
    }
  }

  // When searching, ignore grouping and recent; only matching entries are shown.
  const filteredEntries = normalizedQuery
    ? allEntries.filter((entry) => entry.name.toLowerCase().includes(normalizedQuery))
    : allEntries

  const groups: Array<{
    category: MindMapColorSchemeCategory
    label: string
    entries: SchemeEntry[]
  }> = []
  if (!normalizedQuery) {
    const order: MindMapColorSchemeCategory[] = ['recommended', 'classic', 'custom']
    for (const category of order) {
      const entries = allEntries
        .filter((entry) => getColorSchemeCategory(entry.id) === category)
        .sort((left, right) => Number(favoritesSet.has(right.id)) - Number(favoritesSet.has(left.id)))
      groups.push({ category, label: categoryLabel(category), entries })
    }
  }

  const renderSchemeOption = (entry: SchemeEntry): ReactNode => {
    const selected = activeSchemeId === entry.id
    const favorite = isFavorite(entry.id)
    const customBadge = entry.custom ? t('mindmap.colorScheme.customBadge') : null
    return (
      <div
        key={entry.id}
        role="option"
        aria-selected={selected}
        aria-description={selected ? t('mindmap.topicStyle.selected') : undefined}
        tabIndex={0}
        className={`mindmap-theme-picker__scheme-option${selected ? ' is-active' : ''}`}
        onClick={() => applyColorScheme(entry.id, entry.colors)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            applyColorScheme(entry.id, entry.colors)
          }
        }}
      >
        {renderColorStrip(entry.colors)}
        <span className="mindmap-theme-picker__scheme-name">
          {entry.name}
          {customBadge ? (
            <small className="mindmap-theme-picker__custom-badge">{customBadge}</small>
          ) : null}
        </span>
        <span className="mindmap-theme-picker__option-actions">
          {selected ? (
            <Check size={13} aria-hidden="true" className="mindmap-theme-picker__check" />
          ) : null}
          <button
            type="button"
            className={`mindmap-theme-picker__icon-btn${favorite ? ' is-favorite' : ''}`}
            aria-label={
              favorite
                ? t('mindmap.colorScheme.unfavorite', { name: entry.name })
                : t('mindmap.colorScheme.favorite', { name: entry.name })
            }
            aria-pressed={favorite}
            onClick={(event) => {
              event.stopPropagation()
              toggleColorSchemeFavorite(entry.id)
            }}
          >
            <Star size={12} aria-hidden="true" />
          </button>
          {entry.custom ? (
            <button
              type="button"
              className="mindmap-theme-picker__icon-btn"
              aria-label={t('mindmap.colorScheme.duplicateAria', { name: entry.name })}
              onClick={(event) => {
                event.stopPropagation()
                duplicateColorScheme(entry.id)
              }}
            >
              <Copy size={11} aria-hidden="true" />
            </button>
          ) : null}
          {entry.custom ? (
            <button
              type="button"
              className="mindmap-theme-picker__icon-btn"
              aria-label={t('mindmap.colorScheme.editAria', { name: entry.name })}
              onClick={(event) => {
                event.stopPropagation()
                openEditorFor({ mode: 'edit', id: entry.id })
              }}
            >
              <Pencil size={11} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      </div>
    )
  }

  const editingScheme: UserColorScheme | null =
    editor?.mode === 'edit'
      ? colorSchemes.schemes.find((scheme) => scheme.id === editor.id) ?? null
      : null

  const handleEditorSave = (name: string, colors: readonly string[]): void => {
    if (editor?.mode === 'edit') {
      renameColorScheme(editor.id, name)
      updateColorSchemeColors(editor.id, colors)
    } else {
      createColorScheme(name, colors)
    }
    setEditor(null)
  }

  const handleEditorDelete = (id: string): void => {
    deleteColorScheme(id)
    setEditor(null)
  }

  const openEditorFor = (target: Exclude<EditorTarget, null>): void => {
    setOpenPicker(null)
    setEditor(target)
  }

  return (
    <section className="mindmap-theme-gallery mm-section" aria-labelledby="mindmap-theme-gallery-title">

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
            {branchPreviewColors.map((color, index) => (
              <span key={`${color}-${index}`} style={{ background: color }} />
            ))}
          </span>
        )}
        open={openPicker === 'scheme'}
        onOpenChange={(open) => {
          if (!open) setSearchQuery('')
          setOpenPicker(open ? 'scheme' : null)
        }}
      >
        <div className="mindmap-theme-picker__search">
          <input
            type="text"
            role="searchbox"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filteredEntries.length > 0) {
                event.preventDefault()
                applyColorScheme(filteredEntries[0]!.id, filteredEntries[0]!.colors)
              }
            }}
            placeholder={t('mindmap.colorScheme.searchPlaceholder', 'Search color schemes')}
            aria-label={t('mindmap.colorScheme.searchPlaceholder', 'Search color schemes')}
          />
        </div>

        {normalizedQuery ? (
          filteredEntries.length > 0 ? (
            <div
              className="mindmap-theme-picker__scheme-grid"
              role="group"
              aria-label={t('mindmap.colorScheme.searchResults', 'Search results')}
            >
              {filteredEntries.map(renderSchemeOption)}
            </div>
          ) : (
            <div className="mindmap-theme-picker__empty" role="status">
              {t('mindmap.colorScheme.noResults', 'No matching color schemes')}
            </div>
          )
        ) : (
          <>
            {recentEntries.length > 0 ? (
              <div className="mindmap-theme-picker__section">
                <div className="mindmap-theme-picker__recent" role="group" aria-label={t('mindmap.colorScheme.recent')}>
                  {recentEntries.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="mindmap-theme-picker__recent-chip"
                      aria-label={t('mindmap.colorScheme.applyRecent', { name: entry.name })}
                      onClick={() => applyColorScheme(entry.id, entry.colors)}
                    >
                      {renderColorStrip(entry.colors)}
                      <span>{entry.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {groups.map((group) => (
              <div key={group.category} className="mindmap-theme-picker__section">
                <div className="mindmap-theme-picker__scheme-grid" role="group" aria-label={group.label}>
                  {group.entries.map(renderSchemeOption)}
                </div>
              </div>
            ))}
          </>
        )}

        <div className="mindmap-theme-picker__footer">
          <button
            type="button"
            className="mindmap-theme-picker__new"
            onClick={() => openEditorFor({ mode: 'create' })}
          >
            <Plus size={13} aria-hidden="true" />
            {t('mindmap.colorScheme.newScheme')}
          </button>
        </div>
      </CompactPicker>

      {editor ? (
        <MindMapColorSchemeEditor
          scheme={editingScheme}
          onCancel={() => setEditor(null)}
          onSave={handleEditorSave}
          onDelete={editor.mode === 'edit' ? handleEditorDelete : undefined}
        />
      ) : null}
    </section>
  )
}
