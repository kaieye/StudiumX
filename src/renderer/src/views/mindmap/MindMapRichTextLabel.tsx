import type { CSSProperties, ReactNode } from 'react'
import type { MindMapTextSpan, MindMapTextSpanStyle } from '../../../../shared/mindmap/domain/types'
import { splitTextIntoSegments } from '../../../../shared/mindmap/text-spans'

/** Convert a span style into CSS overrides for a single rendered run. */
export function mindMapTextSpanToCss(style: MindMapTextSpanStyle): CSSProperties {
  const css: CSSProperties = {}
  if (style.color !== undefined) css.color = style.color
  if (style.bold !== undefined) css.fontWeight = style.bold ? 'bold' : 'normal'
  if (style.italic !== undefined) css.fontStyle = style.italic ? 'italic' : 'normal'
  if (style.underline !== undefined || style.strikethrough !== undefined) {
    const decorations: string[] = []
    if (style.underline) decorations.push('underline')
    if (style.strikethrough) decorations.push('line-through')
    css.textDecoration = decorations.length > 0 ? decorations.join(' ') : 'none'
  }
  if (style.fontFamily !== undefined) css.fontFamily = style.fontFamily
  if (style.fontSize !== undefined) css.fontSize = style.fontSize
  return css
}

export type MindMapRichTextLabelProps = {
  text: string
  spans?: MindMapTextSpan[]
  /** Base style applied to the whole label; span styles override it. */
  style?: CSSProperties
  className?: string
  ariaHidden?: boolean
}

/**
 * Render a plain text + offset-spans pair as styled inline runs. Used by the
 * canvas for rich-text node labels and drawn-shape labels (non-editing).
 */
export function MindMapRichTextLabel({
  text,
  spans = [],
  style,
  className,
  ariaHidden
}: MindMapRichTextLabelProps): ReactNode {
  const segments = splitTextIntoSegments(text, spans)
  return (
    <span className={className} style={style} aria-hidden={ariaHidden || undefined}>
      {segments.map((segment, index) => {
        const css = mindMapTextSpanToCss(segment.style)
        if (Object.keys(css).length === 0) return <span key={index}>{segment.text}</span>
        return (
          <span key={index} style={css}>
            {segment.text}
          </span>
        )
      })}
    </span>
  )
}
