import type { LessonStyleDefinition, LessonStyleTokens } from './types'
import { BLUEPRINT_CSS } from './css/blueprint'
export { BLUEPRINT_CSS } from './css/blueprint'

/**
 * blueprint — 蓝晒图纸
 * Prussian-blue drafting sheet: faint grid, double-line drawing frame
 * with a title block, DIN-style condensed headings, NOTE/REV labels.
 */
export const BLUEPRINT_TOKENS: LessonStyleTokens = {
  fontBody: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  fontHeading: 'Bahnschrift, "Franklin Gothic Medium", "Arial Narrow", "Microsoft YaHei", sans-serif',
  fontMono: '"Cascadia Code", Consolas, "SFMono-Regular", monospace',
  pageBg: '#164470',
  ink: '#eaf3fc',
  muted: '#b0c9de',
  soft: 'rgba(234, 243, 252, 0.05)',
  panel: '#1a4a78',
  line: 'rgba(234, 243, 252, 0.4)',
  accent: '#8fd8ee',
  accentSoft: 'rgba(143, 216, 238, 0.12)',
  link: '#8fd8ee',
  linkHover: '#c4ecf8',
  linkUnderline: 'rgba(143, 216, 238, 0.45)',
  heroBg: '#0f3a61',
  heroBorder: 'rgba(234, 243, 252, 0.4)',
  heroText: '#eaf3fc',
  heroMuted: '#b0c9de',
  heroKicker: '#8fd8ee',
  heading: '#eaf3fc',
  strong: '#ffffff',
  codeText: '#8fd8ee',
  codeBg: 'rgba(234, 243, 252, 0.08)',
  codeBorder: 'rgba(234, 243, 252, 0.18)',
  preText: '#bfe3f6',
  preBg: '#0b2b4a',
  theadBg: 'rgba(234, 243, 252, 0.08)',
  theadText: '#eaf3fc',
  stripe: 'rgba(234, 243, 252, 0.025)',
  buttonBg: 'transparent',
  buttonText: '#eaf3fc',
  buttonBorder: 'rgba(234, 243, 252, 0.4)',
  buttonHoverBg: 'rgba(234, 243, 252, 0.08)',
  green: '#93e6b5',
  greenSoft: 'rgba(147, 230, 181, 0.12)',
  amber: '#ffd684',
  amberSoft: 'rgba(255, 214, 132, 0.12)',
  rose: '#ff9d88',
  roseSoft: 'rgba(255, 157, 136, 0.1)',
  radiusCard: '0px',
  radiusSmall: '0px',
  shadow: 'none',
  cardShadow: 'none'
}

export const BLUEPRINT_STYLE: LessonStyleDefinition = {
  id: 'blueprint',
  tokens: BLUEPRINT_TOKENS,
  css: BLUEPRINT_CSS
}
