import { buildLessonCss } from './base'
import type { LessonStyleDefinition, LessonStyleTokens } from './types'

export const MONO_TOKENS: LessonStyleTokens = {
  fontBody: '"Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontHeading: 'Georgia, "Times New Roman", "Songti SC", SimSun, serif',
  fontMono: '"Courier New", Consolas, monospace',
  pageBg: '#ffffff',
  ink: '#141414',
  muted: '#4d4d4d',
  soft: '#f5f5f5',
  panel: '#ffffff',
  line: '#dcdcdc',
  accent: '#141414',
  accentSoft: '#f0f0f0',
  link: '#141414',
  linkHover: '#000000',
  linkUnderline: '#141414',
  heroBg: '#ffffff',
  heroBorder: '#141414',
  heroText: '#141414',
  heroMuted: '#4d4d4d',
  heroKicker: '#141414',
  heading: '#141414',
  strong: '#000000',
  codeText: '#141414',
  codeBg: '#f2f2f2',
  codeBorder: '#d5d5d5',
  preText: '#f5f5f5',
  preBg: '#1a1a1a',
  theadBg: '#141414',
  theadText: '#ffffff',
  stripe: '#f7f7f7',
  buttonBg: '#ffffff',
  buttonText: '#141414',
  buttonBorder: '#141414',
  buttonHoverBg: '#f0f0f0',
  green: '#1d6b40',
  greenSoft: '#eef4ef',
  amber: '#7a5a12',
  amberSoft: '#f7f3e6',
  rose: '#8c2f3f',
  roseSoft: '#f9eef0',
  radiusCard: '0px',
  radiusSmall: '0px',
  shadow: 'none',
  cardShadow: 'none',
  extraCss: `body > header,
.lesson-hero {
  border-width: 2px;
  border-top-width: 8px;
}`
}

export const MONO_STYLE: LessonStyleDefinition = {
  id: 'mono',
  tokens: MONO_TOKENS,
  css: buildLessonCss(MONO_TOKENS)
}
