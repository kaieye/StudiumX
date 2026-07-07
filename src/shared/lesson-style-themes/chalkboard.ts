import type { LessonStyleDefinition, LessonStyleTokens } from './types'
import { CHALKBOARD_CSS } from './css/chalkboard'
export { CHALKBOARD_CSS } from './css/chalkboard'

/**
 * chalkboard — 晚自习黑板
 * Deep-green board in a wooden rim: chalk handwriting for headings,
 * dashed chalk frames, yellow/pink/green chalk as the semantic colors.
 */
export const CHALKBOARD_TOKENS: LessonStyleTokens = {
  fontBody: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif',
  fontHeading: '"Segoe Print", "Bradley Hand", "Chalkboard SE", "KaiTi", "Kaiti SC", cursive',
  fontMono: '"Cascadia Code", Consolas, "SFMono-Regular", monospace',
  pageBg: '#223930',
  ink: '#ecf2e6',
  muted: '#b9cab3',
  soft: 'rgba(236, 242, 230, 0.06)',
  panel: '#28423a',
  line: 'rgba(236, 242, 230, 0.28)',
  accent: '#f2d478',
  accentSoft: 'rgba(242, 212, 120, 0.1)',
  link: '#a5d8e6',
  linkHover: '#cdeaf2',
  linkUnderline: 'rgba(165, 216, 230, 0.45)',
  heroBg: '#1b2f28',
  heroBorder: 'rgba(236, 242, 230, 0.28)',
  heroText: '#ecf2e6',
  heroMuted: '#b9cab3',
  heroKicker: '#f2d478',
  heading: '#ecf2e6',
  strong: '#fbfdf8',
  codeText: '#a5d8e6',
  codeBg: 'rgba(236, 242, 230, 0.1)',
  codeBorder: 'rgba(236, 242, 230, 0.16)',
  preText: '#cfe8d4',
  preBg: '#152420',
  theadBg: 'rgba(236, 242, 230, 0.08)',
  theadText: '#f2d478',
  stripe: 'rgba(236, 242, 230, 0.03)',
  buttonBg: 'transparent',
  buttonText: '#ecf2e6',
  buttonBorder: 'rgba(236, 242, 230, 0.28)',
  buttonHoverBg: 'rgba(236, 242, 230, 0.08)',
  green: '#a8dcb0',
  greenSoft: 'rgba(168, 220, 176, 0.12)',
  amber: '#f2d478',
  amberSoft: 'rgba(242, 212, 120, 0.1)',
  rose: '#f0aebc',
  roseSoft: 'rgba(240, 174, 188, 0.1)',
  radiusCard: '12px',
  radiusSmall: '8px',
  shadow: 'none',
  cardShadow: 'none'
}

export const CHALKBOARD_STYLE: LessonStyleDefinition = {
  id: 'chalkboard',
  tokens: CHALKBOARD_TOKENS,
  css: CHALKBOARD_CSS
}
