import { buildLessonCss, MONO_FONT, SANS_FONT } from './base'
import type { LessonStyleDefinition, LessonStyleTokens } from './types'

export const CLASSIC_TOKENS: LessonStyleTokens = {
  fontBody: SANS_FONT,
  fontHeading: 'inherit',
  fontMono: MONO_FONT,
  pageBg: '#f3f5f8',
  ink: '#172033',
  muted: '#5f6f86',
  soft: '#f7f9fc',
  panel: '#ffffff',
  line: '#dde5f0',
  accent: '#3468d8',
  accentSoft: '#eaf1ff',
  link: '#245fc8',
  linkHover: '#143f8f',
  linkUnderline: 'rgba(36, 95, 200, 0.28)',
  heroBg: '#172033',
  heroBorder: '#202a3f',
  heroText: '#ffffff',
  heroMuted: '#d7e2f6',
  heroKicker: '#96b7ff',
  heading: '#1e2a3d',
  strong: '#1d293d',
  codeText: '#20304a',
  codeBg: '#eef3fb',
  codeBorder: '#d7e0ee',
  preText: '#e8eef9',
  preBg: '#151d2c',
  theadBg: '#172033',
  theadText: '#ffffff',
  stripe: '#f8fafc',
  buttonBg: '#f8fafc',
  buttonText: '#2d3d56',
  buttonBorder: '#cfd9e8',
  buttonHoverBg: '#eef4ff',
  green: '#167a58',
  greenSoft: '#eaf7f1',
  amber: '#a05f00',
  amberSoft: '#fff6df',
  rose: '#b23857',
  roseSoft: '#fff0f4',
  radiusCard: '8px',
  radiusSmall: '8px',
  shadow: '0 16px 40px rgba(23, 32, 51, 0.08)',
  cardShadow: '0 10px 28px rgba(23, 32, 51, 0.06)'
}

export const CLASSIC_STYLE: LessonStyleDefinition = {
  id: 'classic',
  tokens: CLASSIC_TOKENS,
  css: buildLessonCss(CLASSIC_TOKENS)
}
