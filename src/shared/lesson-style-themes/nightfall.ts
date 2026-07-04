import { buildLessonCss, MONO_FONT, SANS_FONT } from './base'
import type { LessonStyleDefinition, LessonStyleTokens } from './types'

export const NIGHTFALL_TOKENS: LessonStyleTokens = {
  fontBody: SANS_FONT,
  fontHeading: 'inherit',
  fontMono: MONO_FONT,
  pageBg: '#0c1120',
  ink: '#e8edfb',
  muted: '#9fadcb',
  soft: '#141c30',
  panel: '#131a2b',
  line: '#27334e',
  accent: '#7ea2ff',
  accentSoft: 'rgba(126, 162, 255, 0.16)',
  link: '#9db9ff',
  linkHover: '#c4d4ff',
  linkUnderline: 'rgba(157, 185, 255, 0.35)',
  heroBg: 'linear-gradient(140deg, #1a2440 0%, #101627 100%)',
  heroBorder: '#2a3654',
  heroText: '#f2f5ff',
  heroMuted: '#b9c7e8',
  heroKicker: '#8fb0ff',
  heading: '#dce5fa',
  strong: '#f0f4ff',
  codeText: '#cfe0ff',
  codeBg: '#1a2338',
  codeBorder: '#2c3a5c',
  preText: '#dbe6ff',
  preBg: '#0a0f1d',
  theadBg: '#1d2947',
  theadText: '#e8edfb',
  stripe: '#0f1626',
  buttonBg: '#1a2336',
  buttonText: '#d5def5',
  buttonBorder: '#31405f',
  buttonHoverBg: '#243356',
  green: '#4cd6a2',
  greenSoft: 'rgba(76, 214, 162, 0.14)',
  amber: '#f0b45c',
  amberSoft: 'rgba(240, 180, 92, 0.13)',
  rose: '#f08ba5',
  roseSoft: 'rgba(240, 139, 165, 0.13)',
  radiusCard: '10px',
  radiusSmall: '8px',
  shadow: '0 18px 44px rgba(0, 0, 0, 0.5)',
  cardShadow: '0 12px 30px rgba(0, 0, 0, 0.35)'
}

export const NIGHTFALL_STYLE: LessonStyleDefinition = {
  id: 'nightfall',
  tokens: NIGHTFALL_TOKENS,
  css: buildLessonCss(NIGHTFALL_TOKENS)
}
