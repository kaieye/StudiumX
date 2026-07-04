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

export const LESSON_STYLE_IDS = [
  'manuscript',
  'chalkboard',
  'editorial',
  'blueprint',
  'poster',
  'classic',
  'nightfall',
  'paper',
  'vivid',
  'mono',
  'terminal'
] as const satisfies readonly LessonStyleId[]

export const DEFAULT_LESSON_STYLE_ID: LessonStyleId = 'classic'

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
