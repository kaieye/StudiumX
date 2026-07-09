import type { LessonStyleDefinition, LessonStyleTokens } from './types'
import { EDITORIAL_CSS } from './css/editorial'
export { EDITORIAL_CSS } from './css/editorial'

/**
 * editorial — 特稿排版
 * Magazine feature layout: ink-blue and signal-orange, thick/thin rule
 * contrast, serif display headings, CJK drop caps and pull quotes.
 */
export const EDITORIAL_TOKENS: LessonStyleTokens = {
  fontBody: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  fontHeading: 'Constantia, Cambria, Georgia, "Songti SC", "SimSun", serif',
  fontMono: '"Cascadia Code", Consolas, "SFMono-Regular", monospace',
  pageBg: '#f4f4ef',
  ink: '#1d2b47',
  muted: '#55607a',
  soft: '#ecece5',
  panel: '#ffffff',
  line: '#d8d9d0',
  accent: '#d9500e',
  accentSoft: '#fbe9dd',
  link: '#14203a',
  linkHover: '#d9500e',
  linkUnderline: 'rgba(217, 80, 14, 0.4)',
  heroBg: 'linear-gradient(180deg, #1d2b47 0%, #1d2b47 12%, #f4f4ef 12%, #f4f4ef 100%)',
  heroBorder: '#1d2b47',
  heroText: '#14203a',
  heroMuted: '#55607a',
  heroKicker: '#d9500e',
  heading: '#14203a',
  strong: '#14203a',
  codeText: '#1d2b47',
  codeBg: '#ecece5',
  codeBorder: '#d8d9d0',
  preText: '#f2f0e9',
  preBg: '#232e47',
  theadBg: 'transparent',
  theadText: '#14203a',
  stripe: 'transparent',
  buttonBg: '#ffffff',
  buttonText: '#1d2b47',
  buttonBorder: '#1d2b47',
  buttonHoverBg: '#fbe9dd',
  green: '#2e7d4f',
  greenSoft: '#e6f2ea',
  amber: '#b06a0a',
  amberSoft: '#faf0d9',
  rose: '#bf3a30',
  roseSoft: '#f9e8e5',
  radiusCard: '0px',
  radiusSmall: '0px',
  shadow: 'none',
  cardShadow: 'none'
}

export const EDITORIAL_STYLE: LessonStyleDefinition = {
  id: 'editorial',
  tokens: EDITORIAL_TOKENS,
  css: EDITORIAL_CSS
}
