export type LessonStyleId =
  | 'manuscript'
  | 'chalkboard'
  | 'editorial'
  | 'blueprint'
  | 'poster'
  | 'classic'
  | 'nightfall'
  | 'paper'
  | 'vivid'
  | 'mono'
  | 'terminal'

// Runtime catalog values live with the ordered definitions. Re-exporting keeps
// this types module's existing public contract without a second ID list.
export { DEFAULT_LESSON_STYLE_ID, LESSON_STYLE_IDS } from '../lesson-style-registry'

export type LessonStyleTokens = {
  fontBody: string
  fontHeading: string
  fontMono: string
  pageBg: string
  ink: string
  muted: string
  soft: string
  panel: string
  line: string
  accent: string
  accentSoft: string
  link: string
  linkHover: string
  linkUnderline: string
  heroBg: string
  heroBorder: string
  heroText: string
  heroMuted: string
  heroKicker: string
  heading: string
  strong: string
  codeText: string
  codeBg: string
  codeBorder: string
  preText: string
  preBg: string
  theadBg: string
  theadText: string
  stripe: string
  buttonBg: string
  buttonText: string
  buttonBorder: string
  buttonHoverBg: string
  green: string
  greenSoft: string
  amber: string
  amberSoft: string
  rose: string
  roseSoft: string
  radiusCard: string
  radiusSmall: string
  shadow: string
  cardShadow: string
  extraCss?: string
}

export type LessonStyleDefinition = {
  id: LessonStyleId
  tokens: LessonStyleTokens
  css: string
}
