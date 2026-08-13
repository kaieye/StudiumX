import type { MindMapTheme, MindMapTopicStyleOverride } from '../../../../shared/mindmap/domain/types'
import { getColorScheme } from '../../../../shared/mindmap/themes/color-schemes'

export const MINIMUM_TOPIC_TEXT_CONTRAST = 4.5

export type MindMapThemeReadabilityEnvironment = {
  /** Resolved app surface behind transparent document backgrounds. */
  surfaceColor: string
  /** Resolved app ink used where a topic has no explicit text colour. */
  textColor: string
  /** Resolved default fill for subtopics without a local or themed fill. */
  subtopicFillColor: string
}

export type MindMapThemeReadabilityLayer = 'central' | 'main' | 'sub'

export type MindMapThemeReadabilityIssue = {
  id: string
  layer: MindMapThemeReadabilityLayer
  foreground: string
  background: string
  contrastRatio: number
}

type Rgba = { red: number; green: number; blue: number; alpha: number }

/**
 * Report topic text/fill pairs that fall below the WCAG normal-text contrast
 * target. This function is intentionally advisory: it neither changes a
 * document nor rejects a theme. Keeping it pure also makes the UI warning
 * agree with the visual precedence used by the canvas.
 */
export function findMindMapThemeReadabilityIssues(
  theme: MindMapTheme,
  environment: MindMapThemeReadabilityEnvironment
): MindMapThemeReadabilityIssue[] {
  const canvasBackground = theme.background && theme.background !== 'transparent'
    ? theme.background
    : environment.surfaceColor
  const themeText = theme.textColor ?? environment.textColor
  const central = topicPair(
    theme.topicStyles?.central,
    themeText,
    environment.surfaceColor
  )
  const sub = topicPair(
    theme.topicStyles?.sub,
    themeText,
    environment.subtopicFillColor
  )
  const mainStyle = theme.topicStyles?.main
  const mainText = mainStyle?.textColor ?? '#FFFFFF'
  const mainFills = [...new Set(mainStyle?.fill
    ? [mainStyle.fill]
    : branchFillColors(theme))]

  const candidates: Array<{ id: string; layer: MindMapThemeReadabilityLayer; foreground: string; background: string }> = [
    {
      id: 'central',
      layer: 'central',
      foreground: central.textColor,
      background: central.fill
    },
    {
      id: 'sub',
      layer: 'sub',
      foreground: sub.textColor,
      background: sub.fill
    },
    ...mainFills.map((fill, index) => ({
      id: `main-${index}`,
      layer: 'main' as const,
      foreground: mainText,
      background: fill
    }))
  ]

  return candidates.flatMap((candidate) => {
    const contrastRatio = contrastRatioAgainstCanvas(
      candidate.foreground,
      candidate.background,
      canvasBackground,
      environment.surfaceColor
    )
    if (contrastRatio === null || contrastRatio >= MINIMUM_TOPIC_TEXT_CONTRAST) return []
    return [{ ...candidate, contrastRatio }]
  })
}

/**
 * Format conservatively so a failing ratio just below 4.5 is never displayed
 * as the passing target after conventional rounding.
 */
export function formatMindMapContrastRatio(ratio: number): string {
  return (Math.floor(ratio * 100) / 100).toFixed(2)
}

function topicPair(
  style: MindMapTopicStyleOverride | undefined,
  fallbackTextColor: string,
  fallbackFillColor: string
): { textColor: string; fill: string } {
  return {
    textColor: style?.textColor ?? fallbackTextColor,
    fill: style?.fill ?? fallbackFillColor
  }
}

function branchFillColors(theme: MindMapTheme): readonly string[] {
  if (theme.rainbowBranches === false) return [theme.lineColor ?? '#8E8E93']
  if (theme.branchColors?.length) return theme.branchColors
  return getColorScheme(theme.colorSchemeId).colors
}

function contrastRatioAgainstCanvas(
  foreground: string,
  fill: string,
  canvasBackground: string,
  environmentSurface: string
): number | null {
  const parsedCanvas = parseHexColor(canvasBackground)
  const parsedEnvironmentSurface = parseHexColor(environmentSurface)
  const parsedFill = parseHexColor(fill)
  const parsedForeground = parseHexColor(foreground)
  if (!parsedCanvas || !parsedEnvironmentSurface || !parsedFill || !parsedForeground) return null

  // A CSS background may itself carry alpha. The caller has already resolved
  // the surface behind the canvas to an opaque color, so make the canvas
  // surface opaque before comparing a translucent topic fill against it.
  const effectiveCanvas = composite(parsedCanvas, parsedEnvironmentSurface)
  const effectiveFill = composite(parsedFill, effectiveCanvas)
  const effectiveForeground = composite(parsedForeground, effectiveFill)
  const foregroundLuminance = relativeLuminance(effectiveForeground)
  const backgroundLuminance = relativeLuminance(effectiveFill)
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
}

function parseHexColor(value: string): Rgba | null {
  const normalized = value.trim().replace(/^#/, '')
  if (!/^[0-9a-f]{3,4}$|^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(normalized)) return null
  const expanded = normalized.length <= 4
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16) / 255,
    green: Number.parseInt(expanded.slice(2, 4), 16) / 255,
    blue: Number.parseInt(expanded.slice(4, 6), 16) / 255,
    alpha
  }
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
  if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 }
  return {
    red: (foreground.red * foreground.alpha + background.red * background.alpha * (1 - foreground.alpha)) / alpha,
    green: (foreground.green * foreground.alpha + background.green * background.alpha * (1 - foreground.alpha)) / alpha,
    blue: (foreground.blue * foreground.alpha + background.blue * background.alpha * (1 - foreground.alpha)) / alpha,
    alpha
  }
}

function relativeLuminance(color: Rgba): number {
  const linearize = (component: number): number => component <= 0.04045
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4
  return 0.2126 * linearize(color.red)
    + 0.7152 * linearize(color.green)
    + 0.0722 * linearize(color.blue)
}
