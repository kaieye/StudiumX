import { buildLessonCss, MONO_FONT, SANS_FONT } from './base'
import type { LessonStyleDefinition, LessonStyleTokens } from './types'

export const TERMINAL_TOKENS: LessonStyleTokens = {
  fontBody: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
  fontHeading: 'inherit',
  fontMono: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
  pageBg: '#0a0f0b',
  ink: '#c9ecc9',
  muted: '#84a888',
  soft: '#101911',
  panel: '#0e1710',
  line: '#1f3323',
  accent: '#3ddc68',
  accentSoft: 'rgba(61, 220, 104, 0.12)',
  link: '#5ee88a',
  linkHover: '#8ff5ac',
  linkUnderline: 'rgba(94, 232, 138, 0.4)',
  heroBg: '#0c150d',
  heroBorder: '#2c4a30',
  heroText: '#d8f5d8',
  heroMuted: '#93bb98',
  heroKicker: '#3ddc68',
  heading: '#b7e8bd',
  strong: '#e4fbe6',
  codeText: '#a9e8b4',
  codeBg: '#122114',
  codeBorder: '#234a2a',
  preText: '#b7f0c0',
  preBg: '#071009',
  theadBg: '#142516',
  theadText: '#c9ecc9',
  stripe: '#0c1510',
  buttonBg: '#122013',
  buttonText: '#b7e8bd',
  buttonBorder: '#2c4a30',
  buttonHoverBg: '#1b3020',
  green: '#3ddc68',
  greenSoft: 'rgba(61, 220, 104, 0.12)',
  amber: '#e8c35a',
  amberSoft: 'rgba(232, 195, 90, 0.1)',
  rose: '#ef7a90',
  roseSoft: 'rgba(239, 122, 144, 0.1)',
  radiusCard: '6px',
  radiusSmall: '4px',
  shadow: '0 0 0 1px rgba(61, 220, 104, 0.06), 0 18px 40px rgba(0, 0, 0, 0.55)',
  cardShadow: '0 10px 24px rgba(0, 0, 0, 0.4)',
  extraCss: `body > header h1::before,
.lesson-hero h1::before {
  content: "$ ";
  color: var(--accent);
}

.kicker::before,
body > header .kicker::before {
  content: "// ";
}`
}

// ----------------------------------------------------------------
// Designed themes — each one is a fully hand-written stylesheet with
// its own layout language. Tokens below only feed gallery thumbnails.
// ----------------------------------------------------------------

/**
 * manuscript — 稿纸批注
 * Chinese composition-grid paper with the teacher's vermilion pen:
 * kaiti display type, a seal-style kicker, double-rule underlines.
 */

export const TERMINAL_STYLE: LessonStyleDefinition = {
  id: 'terminal',
  tokens: TERMINAL_TOKENS,
  css: buildLessonCss(TERMINAL_TOKENS)
}
