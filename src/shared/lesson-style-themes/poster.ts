import type { LessonStyleDefinition, LessonStyleTokens } from './types'
import { POSTER_CSS } from './css/poster'
export { POSTER_CSS } from './css/poster'

/**
 * poster — 教室海报
 * Retro classroom teaching chart: thick ink outlines with hard offset
 * shadows, lake blue / mustard / tomato, marker-highlighted strong text.
 */
export const POSTER_TOKENS: LessonStyleTokens = {
  fontBody: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  fontHeading: '"Segoe UI Black", "Arial Black", "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
  fontMono: '"Cascadia Code", Consolas, "SFMono-Regular", monospace',
  pageBg: '#f6ecd9',
  ink: '#2f2820',
  muted: '#6d6152',
  soft: '#f8ecd0',
  panel: '#fdf6e9',
  line: '#2f2820',
  accent: '#cf4527',
  accentSoft: '#f9ddd3',
  link: '#1d7290',
  linkHover: '#cf4527',
  linkUnderline: 'rgba(29, 114, 144, 0.45)',
  heroBg: '#1d7290',
  heroBorder: '#2f2820',
  heroText: '#fdf6e9',
  heroMuted: 'rgba(253, 246, 233, 0.9)',
  heroKicker: '#dea82c',
  heading: '#2f2820',
  strong: '#2f2820',
  codeText: '#2f2820',
  codeBg: '#fdf6e9',
  codeBorder: '#2f2820',
  preText: '#f6ecd9',
  preBg: '#2f2820',
  theadBg: '#dea82c',
  theadText: '#2f2820',
  stripe: '#f7efdd',
  buttonBg: '#fdf6e9',
  buttonText: '#2f2820',
  buttonBorder: '#2f2820',
  buttonHoverBg: '#f8ecd0',
  green: '#4c8a4f',
  greenSoft: '#e2eedd',
  amber: '#dea82c',
  amberSoft: '#f8ecd0',
  rose: '#cf4527',
  roseSoft: '#f9ddd3',
  radiusCard: '16px',
  radiusSmall: '10px',
  shadow: '6px 6px 0 rgba(47, 40, 32, 0.85)',
  cardShadow: '4px 4px 0 rgba(47, 40, 32, 0.85)'
}

export const POSTER_STYLE: LessonStyleDefinition = {
  id: 'poster',
  tokens: POSTER_TOKENS,
  css: POSTER_CSS
}
