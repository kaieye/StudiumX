import { buildLessonCss, MONO_FONT, SANS_FONT } from './base'
import type { LessonStyleDefinition, LessonStyleTokens } from './types'

export const VIVID_TOKENS: LessonStyleTokens = {
  fontBody: SANS_FONT,
  fontHeading: 'inherit',
  fontMono: MONO_FONT,
  pageBg: '#f6f5ff',
  ink: '#2a2158',
  muted: '#6a648f',
  soft: '#f4f1ff',
  panel: '#ffffff',
  line: '#e5e0f5',
  accent: '#7048e8',
  accentSoft: '#f0eaff',
  link: '#6c3ee8',
  linkHover: '#4c22b8',
  linkUnderline: 'rgba(108, 62, 232, 0.3)',
  heroBg: 'linear-gradient(135deg, #6a5cf2 0%, #a44ff0 52%, #f65e9a 100%)',
  heroBorder: 'rgba(122, 82, 242, 0.4)',
  heroText: '#ffffff',
  heroMuted: 'rgba(255, 255, 255, 0.85)',
  heroKicker: '#ffe28a',
  heading: '#33246b',
  strong: '#2f2361',
  codeText: '#4b3a86',
  codeBg: '#f1ecff',
  codeBorder: '#ded2fb',
  preText: '#efeaff',
  preBg: '#2b2153',
  theadBg: 'linear-gradient(135deg, #6a5cf2, #a44ff0)',
  theadText: '#ffffff',
  stripe: '#f8f6ff',
  buttonBg: '#f7f4ff',
  buttonText: '#443884',
  buttonBorder: '#d9cdf8',
  buttonHoverBg: '#ede5ff',
  green: '#0f9d6c',
  greenSoft: '#e2f8ee',
  amber: '#c47a08',
  amberSoft: '#fff3d6',
  rose: '#e0447c',
  roseSoft: '#ffebf3',
  radiusCard: '18px',
  radiusSmall: '12px',
  shadow: '0 20px 46px rgba(106, 92, 242, 0.18)',
  cardShadow: '0 12px 30px rgba(106, 92, 242, 0.1)',
  extraCss: `section > h2::after,
.lesson-page > section > h2::after {
  content: "";
  display: block;
  width: 52px;
  height: 4px;
  margin-top: 8px;
  border-radius: 999px;
  background: linear-gradient(90deg, #6a5cf2, #f65e9a);
}`
}

export const VIVID_STYLE: LessonStyleDefinition = {
  id: 'vivid',
  tokens: VIVID_TOKENS,
  css: buildLessonCss(VIVID_TOKENS)
}
