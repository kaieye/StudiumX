import { Check, CheckCircle2, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LESSON_STYLES,
  normalizeLessonStyleId,
  type LessonStyleId,
  type LessonStyleTokens
} from '../../../../shared/lesson-styles'
import { buildLessonStyleSampleHtml } from '../../lesson-style-sample'

type ResourcePreviewFile = {
  id: string
  title: string
  html: string
}

type LessonStyleGalleryProps = {
  currentStyleId: unknown
  onApplyLessonStyle: (styleId: LessonStyleId) => Promise<void>
  onOpenPreview: (file: ResourcePreviewFile) => void
}

/** Perceived luminance check so text stays readable on the accent chip. */
function isLightColor(color: string): boolean {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i)?.[1]
  if (!hex) return false
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62
}

/** Heading font stack of a theme ('inherit' falls back to the body stack). */
function styleCardFontStack(tokens: LessonStyleTokens): string {
  return tokens.fontHeading === 'inherit' ? tokens.fontBody : tokens.fontHeading
}

/** First family of the heading stack, shown as the specimen label. */
function styleCardFontLabel(tokens: LessonStyleTokens): string {
  const first = styleCardFontStack(tokens).split(',')[0]?.replace(/["']/g, '').trim()
  return first || 'System'
}

export function LessonStyleGallery({
  currentStyleId,
  onApplyLessonStyle,
  onOpenPreview
}: LessonStyleGalleryProps) {
  const { t } = useTranslation()
  const normalizedCurrentStyleId = normalizeLessonStyleId(currentStyleId)
  const [applyingStyleId, setApplyingStyleId] = useState<LessonStyleId | null>(null)

  const applyStyle = async (styleId: LessonStyleId): Promise<void> => {
    setApplyingStyleId(styleId)
    try {
      await onApplyLessonStyle(styleId)
    } finally {
      setApplyingStyleId(null)
    }
  }

  return (
    <div className="style-gallery is-card-only">
      <div className="style-gallery-cards">
        {LESSON_STYLES.map((style) => {
          const isCurrent = style.id === normalizedCurrentStyleId
          const isApplying = applyingStyleId === style.id
          const { tokens } = style
          return (
            <article
              className={`style-card${isCurrent ? ' is-selected' : ''}`}
              key={style.id}
            >
              <button
                className="style-card-preview"
                type="button"
                aria-pressed={isCurrent}
                onClick={() => onOpenPreview({
                  id: `style-${style.id}`,
                  title: t(`resources.styles.items.${style.id}.name`),
                  html: buildLessonStyleSampleHtml(style.id)
                })}
              >
                <span aria-hidden className="style-card-thumb" style={{ background: tokens.pageBg, borderColor: tokens.line }}>
                  <span
                    className="style-card-chip style-card-chip-color"
                    style={{ background: tokens.accent, color: isLightColor(tokens.accent) ? '#20242a' : '#ffffff' }}
                  >
                    <span className="style-card-chip-label">Primary</span>
                    <span className="style-card-chip-hex">
                      {tokens.accent.startsWith('#') ? tokens.accent.toUpperCase() : ''}
                    </span>
                  </span>
                  <span className="style-card-chip style-card-chip-type" style={{ background: tokens.panel, borderColor: tokens.line }}>
                    <span
                      className="style-card-chip-aa"
                      style={{ color: tokens.heading, fontFamily: styleCardFontStack(tokens) }}
                    >
                      Aa
                    </span>
                    <span className="style-card-chip-font" style={{ color: tokens.muted }}>
                      {styleCardFontLabel(tokens)}
                    </span>
                  </span>
                  <span className="style-card-chip style-card-chip-ui" style={{ background: tokens.panel, borderColor: tokens.line }}>
                    <span className="style-card-chip-buttons">
                      <span className="style-card-chip-btn" style={{ background: tokens.accent }} />
                      <span className="style-card-chip-btn is-outline" style={{ borderColor: tokens.muted }} />
                    </span>
                    <span className="style-card-chip-line" style={{ background: tokens.accent, width: '54%' }} />
                    <span className="style-card-chip-line" style={{ background: tokens.muted, width: '88%' }} />
                    <span className="style-card-chip-line" style={{ background: tokens.muted, width: '68%' }} />
                  </span>
                  <span className="style-card-scale" style={{ borderColor: tokens.line }}>
                    {[tokens.ink, tokens.muted, tokens.accent, tokens.soft, tokens.panel, tokens.pageBg].map((swatch, index) => (
                      <span key={index} style={{ background: swatch }} />
                    ))}
                  </span>
                </span>
                <span className="style-card-body">
                  <strong>{t(`resources.styles.items.${style.id}.name`)}</strong>
                  <span>{t(`resources.styles.items.${style.id}.detail`)}</span>
                </span>
              </button>
              <button
                className={`style-card-apply${isCurrent ? ' is-current' : ''}`}
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                disabled={isCurrent || isApplying}
                onClick={() => void applyStyle(style.id)}
              >
                {isApplying ? <Loader2 className="spin" size={13} /> : isCurrent ? <CheckCircle2 size={13} /> : <Check size={13} />}
                {isCurrent ? t('resources.styles.applied') : t('resources.styles.apply')}
              </button>
            </article>
          )
        })}
      </div>
    </div>
  )
}
