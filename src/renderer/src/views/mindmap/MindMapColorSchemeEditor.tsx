import { Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  EDITOR_PALETTE_COLORS,
  type UserColorScheme
} from './mind-map-color-scheme-catalog'
import {
  findMindMapThemeReadabilityIssues,
  formatMindMapContrastRatio
} from './mind-map-theme-readability'

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const LIGHT_THEME_ENVIRONMENT = {
  surfaceColor: '#FFFFFF',
  textColor: '#24324A',
  subtopicFillColor: '#F8F7F7'
} as const

function expandHexDigits(digits: string): string {
  return digits.length === 3
    ? digits.split('').map((part) => `${part}${part}`).join('')
    : digits
}

function hexColorWellValue(color: string): string {
  const match = HEX_COLOR_PATTERN.exec(color)
  if (!match) return '#000000'
  return `#${expandHexDigits(match[1]!).slice(0, 6).toLowerCase()}`
}

type EditorProps = {
  /** The scheme being edited, or null when creating a new scheme. */
  scheme: UserColorScheme | null
  onCancel: () => void
  /** Save creates or updates a user scheme and returns it. */
  onSave: (name: string, colors: readonly string[]) => void
  /** Delete the scheme being edited (only provided for existing schemes). */
  onDelete?: (id: string) => void
}

/**
 * Compact custom color-scheme editor. Lives in a modal dialog so it can host
 * a name field, 6 color wells, a live preview strip and a non-blocking
 * contrast hint without crowding the compact scheme popover.
 */
export function MindMapColorSchemeEditor({ scheme, onCancel, onSave, onDelete }: EditorProps) {
  const { t } = useTranslation()
  const isEditing = scheme !== null
  const initialColors = (scheme?.colors ?? [])
    .slice(0, EDITOR_PALETTE_COLORS)
  while (initialColors.length < EDITOR_PALETTE_COLORS) {
    initialColors.push('#FFFFFF')
  }
  const [name, setName] = useState(scheme?.name ?? '')
  const [colors, setColors] = useState<string[]>(initialColors)
  const [hexDrafts, setHexDrafts] = useState<string[]>(initialColors.map(hexColorWellValue))
  const nameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => {
      previous?.focus?.()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const updateColor = (index: number, color: string): void => {
    const normalized = color.toUpperCase()
    setColors((current) => {
      const next = [...current]
      next[index] = normalized
      return next
    })
    setHexDrafts((current) => {
      const next = [...current]
      next[index] = hexColorWellValue(color)
      return next
    })
  }

  const commitHexDraft = (index: number): void => {
    const draft = hexDrafts[index] ?? ''
    if (HEX_COLOR_PATTERN.test(draft)) {
      updateColor(index, draft)
      return
    }
    setHexDrafts((current) => {
      const next = [...current]
      next[index] = hexColorWellValue(colors[index] ?? '#000000')
      return next
    })
  }

  const previewStrip: ReactNode = (
    <span className="mindmap-color-scheme-editor__preview" aria-hidden="true">
      {colors.map((color, index) => (
        <span key={`${color}-${index}`} style={{ background: color }} />
      ))}
    </span>
  )

  const readabilityIssues = findMindMapThemeReadabilityIssues(
    {
      id: 'custom-scheme-preview',
      branchColors: colors,
      rainbowBranches: true
    },
    LIGHT_THEME_ENVIRONMENT
  )

  const handleSave = (): void => {
    onSave(name, colors)
  }

  return (
    <div
      className="mindmap-color-scheme-editor__overlay"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="mindmap-color-scheme-editor"
        role="dialog"
        aria-modal="true"
        aria-label={t('mindmap.colorScheme.editorTitle')}
      >
        <div className="mindmap-color-scheme-editor__head">
          <strong>
            {isEditing
              ? t('mindmap.colorScheme.editTitle')
              : t('mindmap.colorScheme.newTitle')}
          </strong>
          <button
            type="button"
            className="mindmap-color-scheme-editor__close"
            aria-label={t('mindmap.colorScheme.cancel')}
            onClick={onCancel}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        <label className="mm-row mm-row--stack">
          <span className="mm-row__label" id="mindmap-scheme-name-label">
            {t('mindmap.colorScheme.nameLabel')}
          </span>
          <input
            ref={nameRef}
            className="mindmap-color-scheme-editor__name"
            aria-labelledby="mindmap-scheme-name-label"
            value={name}
            maxLength={80}
            placeholder={t('mindmap.colorScheme.namePlaceholder')}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>

        <fieldset className="mindmap-color-scheme-editor__wells">
          <legend className="mm-row__label">{t('mindmap.colorScheme.paletteLabel')}</legend>
          {colors.map((color, index) => (
            <div key={index} className="mindmap-color-scheme-editor__well">
              <input
                type="color"
                className="mm-color-well"
                aria-label={t('mindmap.colorScheme.colorWell', { number: index + 1 })}
                value={hexColorWellValue(color)}
                onChange={(event) => updateColor(index, event.currentTarget.value.toUpperCase())}
              />
              <input
                className="mindmap-color-scheme-editor__hex"
                aria-label={t('mindmap.colorScheme.hexLabel', { number: index + 1 })}
                value={hexDrafts[index] ?? ''}
                spellCheck={false}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setHexDrafts((current) => {
                    const next = [...current]
                    next[index] = value
                    return next
                  })
                }}
                onBlur={() => commitHexDraft(index)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  commitHexDraft(index)
                  event.currentTarget.blur()
                }}
              />
            </div>
          ))}
        </fieldset>

        <div className="mm-row mm-row--stack">
          <span className="mm-row__label">{t('mindmap.colorScheme.previewLabel')}</span>
          {previewStrip}
        </div>

        {readabilityIssues.length > 0 ? (
          <p className="mindmap-color-scheme-editor__hint is-warning" role="status">
            {t('mindmap.colorScheme.readabilityHint', {
              ratio: formatMindMapContrastRatio(
                Math.min(...readabilityIssues.map((issue) => issue.contrastRatio))
              )
            })}
          </p>
        ) : (
          <p className="mindmap-color-scheme-editor__hint">{t('mindmap.colorScheme.readabilityOk')}</p>
        )}

        <div className="mindmap-color-scheme-editor__actions">
          {isEditing && onDelete ? (
            <button
              type="button"
              className="mindmap-color-scheme-editor__delete"
              onClick={() => onDelete(scheme!.id)}
              title={t('mindmap.colorScheme.deleteScheme')}
            >
              <Trash2 size={13} aria-hidden="true" />
              {t('mindmap.colorScheme.deleteScheme')}
            </button>
          ) : (
            <span />
          )}
          <span className="mindmap-color-scheme-editor__action-right">
            <button
              type="button"
              className="mindmap-color-scheme-editor__cancel"
              onClick={onCancel}
            >
              {t('mindmap.colorScheme.cancel')}
            </button>
            <button
              type="button"
              className="mindmap-color-scheme-editor__save"
              onClick={handleSave}
            >
              {t('mindmap.colorScheme.save')}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
