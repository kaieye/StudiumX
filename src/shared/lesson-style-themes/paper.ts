import { buildLessonCss } from './base'
import type { LessonStyleDefinition, LessonStyleTokens } from './types'

export const PAPER_TOKENS: LessonStyleTokens = {
  fontBody: 'Georgia, "Iowan Old Style", "Times New Roman", "Songti SC", SimSun, serif',
  fontHeading: 'Georgia, "Songti SC", SimSun, serif',
  fontMono: '"Courier New", "Cascadia Code", monospace',
  pageBg: '#f5efe2',
  ink: '#3c3422',
  muted: '#6e6248',
  soft: '#f9f4e8',
  panel: '#fdf9ee',
  line: '#e0d3b4',
  accent: '#96652f',
  accentSoft: '#f3e8d2',
  link: '#7a5220',
  linkHover: '#5a3a12',
  linkUnderline: 'rgba(122, 82, 32, 0.35)',
  heroBg: '#fdf9ee',
  heroBorder: '#cbb98d',
  heroText: '#3a2f14',
  heroMuted: '#6e6248',
  heroKicker: '#96652f',
  heading: '#3a2f14',
  strong: '#2f2812',
  codeText: '#4a3c1e',
  codeBg: '#f2ead4',
  codeBorder: '#ddcda4',
  preText: '#f3ecd9',
  preBg: '#3a3323',
  theadBg: '#4a3f26',
  theadText: '#f8f2e2',
  stripe: '#f7f1e0',
  buttonBg: '#f7f1e0',
  buttonText: '#4a3c1e',
  buttonBorder: '#d6c69c',
  buttonHoverBg: '#efe4c8',
  green: '#4e6b34',
  greenSoft: '#ebf0dd',
  amber: '#8a5a00',
  amberSoft: '#f7ecce',
  rose: '#96434c',
  roseSoft: '#f6e6e3',
  radiusCard: '4px',
  radiusSmall: '3px',
  shadow: '0 10px 26px rgba(90, 74, 38, 0.14)',
  cardShadow: '0 6px 18px rgba(90, 74, 38, 0.1)',
  extraCss: `body > header,
.lesson-hero {
  border-style: double;
  border-width: 4px;
}`
}

export const PAPER_STYLE: LessonStyleDefinition = {
  id: 'paper',
  tokens: PAPER_TOKENS,
  css: buildLessonCss(PAPER_TOKENS)
}
