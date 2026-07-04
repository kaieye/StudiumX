/**
 * Lesson style themes shared by the main process (workspace scaffolding /
 * apply-style IPC) and the renderer (resources page style gallery preview).
 *
 * Every theme produces a full `assets/lesson.css` replacement through
 * `buildLessonCss`: the layout rules are static and reference CSS variables,
 * so a theme only supplies design tokens plus optional extra rules. The
 * `classic` theme mirrors the original hand-written lesson.css.
 */

export type LessonStyleId = 'classic' | 'nightfall' | 'paper' | 'vivid' | 'mono' | 'terminal'

export const LESSON_STYLE_IDS = ['classic', 'nightfall', 'paper', 'vivid', 'mono', 'terminal'] as const satisfies readonly LessonStyleId[]

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

export function isLessonStyleId(value: unknown): value is LessonStyleId {
  return typeof value === 'string' && (LESSON_STYLE_IDS as readonly string[]).includes(value)
}

export function normalizeLessonStyleId(value: unknown): LessonStyleId {
  return isLessonStyleId(value) ? value : DEFAULT_LESSON_STYLE_ID
}

export function lessonStyleCss(styleId: unknown): string {
  const id = normalizeLessonStyleId(styleId)
  return LESSON_STYLES.find((style) => style.id === id)!.css
}

export function buildLessonCss(tokens: LessonStyleTokens): string {
  return `:root {
  color: ${tokens.ink};
  background: ${tokens.pageBg};
  font-family: ${tokens.fontBody};
  font-size: 16px;
  line-height: 1.75;
  --page-max: 920px;
  --page-bg: ${tokens.pageBg};
  --ink: ${tokens.ink};
  --muted: ${tokens.muted};
  --soft: ${tokens.soft};
  --panel: ${tokens.panel};
  --line: ${tokens.line};
  --accent: ${tokens.accent};
  --accent-soft: ${tokens.accentSoft};
  --link: ${tokens.link};
  --link-hover: ${tokens.linkHover};
  --link-underline: ${tokens.linkUnderline};
  --hero-bg: ${tokens.heroBg};
  --hero-border: ${tokens.heroBorder};
  --hero-text: ${tokens.heroText};
  --hero-muted: ${tokens.heroMuted};
  --hero-kicker: ${tokens.heroKicker};
  --heading: ${tokens.heading};
  --strong: ${tokens.strong};
  --code-text: ${tokens.codeText};
  --code-bg: ${tokens.codeBg};
  --code-border: ${tokens.codeBorder};
  --pre-text: ${tokens.preText};
  --pre-bg: ${tokens.preBg};
  --thead-bg: ${tokens.theadBg};
  --thead-text: ${tokens.theadText};
  --stripe: ${tokens.stripe};
  --button-bg: ${tokens.buttonBg};
  --button-text: ${tokens.buttonText};
  --button-border: ${tokens.buttonBorder};
  --button-hover-bg: ${tokens.buttonHoverBg};
  --green: ${tokens.green};
  --green-soft: ${tokens.greenSoft};
  --amber: ${tokens.amber};
  --amber-soft: ${tokens.amberSoft};
  --rose: ${tokens.rose};
  --rose-soft: ${tokens.roseSoft};
  --radius-card: ${tokens.radiusCard};
  --radius-small: ${tokens.radiusSmall};
  --font-heading: ${tokens.fontHeading};
  --font-mono: ${tokens.fontMono};
  --shadow: ${tokens.shadow};
  --card-shadow: ${tokens.cardShadow};
}

* {
  box-sizing: border-box;
}

html {
  background: var(--page-bg);
}

body {
  min-height: 100vh;
  margin: 0;
  padding: 0 0 56px;
  color: var(--ink);
  background: var(--page-bg);
}

body > header,
body > main,
body > section,
body > article,
body > footer {
  width: min(calc(100% - 48px), var(--page-max));
  margin-right: auto;
  margin-left: auto;
}

.lesson-page {
  width: min(calc(100% - 48px), var(--page-max));
  max-width: none;
  margin: 0 auto;
  padding: 0;
}

body > header,
.lesson-hero {
  margin-top: 32px;
  margin-bottom: 28px;
  padding: 38px 42px 40px;
  color: var(--hero-text);
  border: 1px solid var(--hero-border);
  border-radius: var(--radius-card);
  background: var(--hero-bg);
  box-shadow: var(--shadow);
}

.kicker,
body > header .kicker {
  margin: 0 0 10px;
  color: var(--hero-kicker);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--heading);
  font-family: var(--font-heading);
  line-height: 1.22;
  letter-spacing: 0;
}

body > header h1,
.lesson-hero h1 {
  max-width: 760px;
  color: var(--hero-text);
  font-size: 40px;
  line-height: 1.16;
}

body > header p,
.lesson-hero p {
  max-width: 720px;
  margin: 14px 0 0;
  color: var(--hero-muted);
  font-size: 17px;
}

.subtitle {
  color: var(--hero-muted);
  font-weight: 700;
}

section,
article {
  margin-top: 24px;
}

section > h2,
.lesson-page > section > h2 {
  margin: 0 0 14px;
  padding-top: 10px;
  color: var(--heading);
  font-size: 24px;
}

h3 {
  font-size: 19px;
}

p,
li,
td,
th {
  color: var(--muted);
  font-size: 16px;
  line-height: 1.78;
}

p {
  margin: 10px 0;
}

strong {
  color: var(--strong);
  font-weight: 800;
}

a {
  color: var(--link);
  text-decoration: none;
  border-bottom: 1px solid var(--link-underline);
}

a:hover {
  color: var(--link-hover);
  border-bottom-color: currentColor;
}

ul,
ol {
  margin: 10px 0 0;
  padding-left: 1.35rem;
}

li + li {
  margin-top: 8px;
}

code {
  color: var(--code-text);
  border: 1px solid var(--code-border);
  border-radius: var(--radius-small);
  background: var(--code-bg);
  padding: 0.12em 0.38em;
  font-family: var(--font-mono);
  font-size: 0.92em;
}

pre {
  overflow: auto;
  margin: 14px 0 0;
  padding: 16px;
  color: var(--pre-text);
  border-radius: var(--radius-small);
  background: var(--pre-bg);
}

pre code {
  color: inherit;
  border: 0;
  background: transparent;
  padding: 0;
}

blockquote {
  margin: 16px 0 0;
  padding: 16px 18px;
  border-left: 4px solid var(--accent);
  border-radius: 0 var(--radius-small) var(--radius-small) 0;
  background: var(--accent-soft);
}

blockquote p:first-child {
  margin-top: 0;
}

blockquote p:last-child {
  margin-bottom: 0;
}

hr {
  height: 1px;
  margin: 18px 0;
  border: 0;
  background: var(--line);
}

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 16px 0 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  border-spacing: 0;
  border-collapse: separate;
  background: var(--panel);
}

thead {
  background: var(--thead-bg);
}

th,
td {
  min-width: 150px;
  padding: 12px 14px;
  text-align: left;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

th {
  color: var(--thead-text);
  font-weight: 800;
}

tr:last-child td {
  border-bottom: 0;
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:nth-child(even) {
  background: var(--stripe);
}

.mission-card,
.qa-block,
.quiz-card,
.flashcard,
.summary,
.teachos-generated-quiz {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
  box-shadow: var(--card-shadow);
}

.mission-card {
  padding: 18px 20px;
  border-left: 4px solid var(--green);
}

.mission-card span,
.file-grid span {
  display: block;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.mission-card strong {
  display: block;
  margin-top: 6px;
  color: var(--strong);
  font-size: 18px;
}

.mission-card p {
  margin-bottom: 0;
}

.qa-block {
  overflow: hidden;
}

.qa-block h3 {
  padding: 18px 22px;
  color: var(--heading);
  border-bottom: 1px solid var(--line);
  background: var(--soft);
}

.answer {
  padding: 18px 22px 22px;
}

.answer > :first-child {
  margin-top: 0;
}

.answer > :last-child {
  margin-bottom: 0;
}

.tip {
  margin-top: 14px;
  padding: 13px 15px;
  color: var(--amber);
  border: 1px solid var(--amber-soft);
  border-left: 4px solid var(--amber);
  border-radius: var(--radius-small);
  background: var(--amber-soft);
}

.tip strong {
  color: var(--amber);
}

.summary {
  padding: 22px;
  border-color: var(--line);
  background: var(--soft);
}

.summary h2 {
  padding-top: 0;
}

.summary blockquote {
  border-left-color: var(--green);
  background: var(--green-soft);
}

.steps,
.compact-list {
  display: grid;
  gap: 10px;
  padding: 0;
  list-style: none;
}

.steps li,
.compact-list li {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-small);
  background: var(--panel);
}

.steps li {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
}

.steps strong {
  color: var(--strong);
}

.steps span {
  color: var(--muted);
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.file-grid a {
  display: block;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
}

.file-grid strong {
  display: block;
  margin-top: 6px;
  color: var(--strong);
}

.practice,
.teachos-generated-quiz {
  margin-top: 28px;
}

.teachos-generated-quiz {
  padding: 20px;
}

.quiz-card {
  display: grid;
  gap: 12px;
  padding: 18px;
  box-shadow: none;
}

.quiz-card + .quiz-card {
  margin-top: 12px;
}

.quiz-card p {
  margin: 0;
}

.quiz-choices,
.quiz-fill {
  display: grid;
  gap: 8px;
}

.quiz-fill {
  grid-template-columns: minmax(0, 1fr) auto;
}

.quiz-card button,
.quiz-fill input {
  min-height: 40px;
  border: 1px solid var(--button-border);
  border-radius: var(--radius-small);
  font: inherit;
}

.quiz-card button {
  background: var(--button-bg);
  color: var(--button-text);
  cursor: pointer;
}

.quiz-card button:hover {
  background: var(--button-hover-bg);
}

.quiz-card button.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.quiz-card button.is-correct,
.quiz-fill input.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card button.is-wrong,
.quiz-fill input.is-wrong {
  border-color: var(--rose);
  background: var(--rose-soft);
}

.quiz-fill input {
  width: 100%;
  padding: 0 12px;
  color: var(--ink);
  background: var(--panel);
}

output {
  min-height: 24px;
  color: var(--green);
  font-weight: 800;
}

.quiz-explanation {
  display: none;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

footer,
body > footer {
  margin-top: 38px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

footer p {
  color: var(--muted);
}

/* Theme overrides for the shared static assets (flashcards.css loads after
   lesson.css, so these selectors win on specificity). */

.flashcards .flashcard {
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--panel);
}

.flashcards .flashcard-front {
  color: var(--strong);
}

.flashcards .flashcard-back {
  color: var(--muted);
  background: var(--soft);
  border-radius: var(--radius-card);
}

.flashcard .flashcard-self button {
  border: 1px solid var(--button-border);
  border-radius: var(--radius-small);
  background: var(--button-bg);
  color: var(--button-text);
}

.flashcard .flashcard-self button:hover {
  background: var(--button-hover-bg);
}

.quiz-card .quiz-choices button.is-selected {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.quiz-card .quiz-fill input {
  border: 1px solid var(--button-border);
  color: var(--ink);
  background: var(--panel);
}

.quiz-card .quiz-fill input.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card .quiz-fill input.is-wrong {
  border-color: var(--rose);
  background: var(--rose-soft);
}

.quiz-card .quiz-explanation {
  color: var(--muted);
}

@media (max-width: 700px) {
  body {
    padding-bottom: 36px;
  }

  body > header,
  body > main,
  body > section,
  body > article,
  body > footer,
  .lesson-page {
    width: min(calc(100% - 28px), var(--page-max));
  }

  body > header,
  .lesson-hero {
    margin-top: 18px;
    padding: 28px 22px;
  }

  body > header h1,
  .lesson-hero h1 {
    font-size: 30px;
  }

  section > h2,
  .lesson-page > section > h2 {
    font-size: 21px;
  }

  .qa-block h3,
  .answer,
  .summary,
  .teachos-generated-quiz {
    padding-right: 16px;
    padding-left: 16px;
  }

  .file-grid,
  .quiz-fill {
    grid-template-columns: 1fr;
  }

  .steps li {
    grid-template-columns: 1fr;
  }
}
${tokens.extraCss ? `\n${tokens.extraCss.trim()}\n` : ''}`
}

// ----------------------------------------------------------------
// Theme token sets
// ----------------------------------------------------------------

const SANS_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif'
const MONO_FONT = '"Cascadia Code", "SFMono-Regular", Consolas, monospace'

const CLASSIC_TOKENS: LessonStyleTokens = {
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

const NIGHTFALL_TOKENS: LessonStyleTokens = {
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

const PAPER_TOKENS: LessonStyleTokens = {
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

const VIVID_TOKENS: LessonStyleTokens = {
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

const MONO_TOKENS: LessonStyleTokens = {
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

const TERMINAL_TOKENS: LessonStyleTokens = {
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

export const LESSON_STYLES: readonly LessonStyleDefinition[] = [
  { id: 'classic', tokens: CLASSIC_TOKENS, css: buildLessonCss(CLASSIC_TOKENS) },
  { id: 'nightfall', tokens: NIGHTFALL_TOKENS, css: buildLessonCss(NIGHTFALL_TOKENS) },
  { id: 'paper', tokens: PAPER_TOKENS, css: buildLessonCss(PAPER_TOKENS) },
  { id: 'vivid', tokens: VIVID_TOKENS, css: buildLessonCss(VIVID_TOKENS) },
  { id: 'mono', tokens: MONO_TOKENS, css: buildLessonCss(MONO_TOKENS) },
  { id: 'terminal', tokens: TERMINAL_TOKENS, css: buildLessonCss(TERMINAL_TOKENS) }
]

// ----------------------------------------------------------------
// Shared static lesson assets (also written into workspace scaffolds
// and inlined into the renderer's style gallery sample page).
// ----------------------------------------------------------------

export const LESSON_QUIZ_JS = `function setupTeachOsQuizCards(root = document) {
  root.querySelectorAll('.quiz-card').forEach((card) => {
    if (card.dataset.quizReady === 'true') return;
    card.dataset.quizReady = 'true';

    const type = card.getAttribute('data-type') || 'single';
    const answer = card.getAttribute('data-answer') || '';
    const output = card.querySelector('output');
    const explanation = card.querySelector('.quiz-explanation');
    const report = (correct, msg) => {
      if (output) output.textContent = msg;
      if (explanation) explanation.style.display = correct ? 'block' : 'none';
      try {
        window.parent.postMessage({
          source: 'teachos-lesson',
          kind: 'quiz',
          question: card.querySelector('p')?.textContent || '',
          correct
        }, '*');
      } catch {}
    };

    if (type === 'fill') {
      const input = card.querySelector('input[type="text"]');
      const submit = card.querySelector('button[data-choice="submit"]');
      const normalize = (s) => s.trim().toLowerCase().replace(/\\s+/g, ' ').replace(/[。.,，！!？?]/g, '');
      const check = () => {
        const value = input?.value || '';
        const isCorrect = Boolean(value.trim()) && normalize(value) === normalize(answer);
        if (input) {
          input.classList.toggle('is-correct', isCorrect);
          input.classList.toggle('is-wrong', !isCorrect && value.trim().length > 0);
        }
        report(isCorrect, isCorrect ? '正确！' : '再想想，或查看解析。');
      };
      submit?.addEventListener('click', check);
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') check();
      });
      return;
    }

    const answers = type === 'multi' ? answer.split(',').map((s) => s.trim()) : [answer];
    card.querySelectorAll('button[data-choice]').forEach((button) => {
      button.addEventListener('click', () => {
        if (type === 'multi') {
          button.classList.toggle('is-selected');
          const selected = Array.from(card.querySelectorAll('button[data-choice].is-selected'))
            .map((b) => b.getAttribute('data-choice'));
          const isCorrect = selected.length === answers.length &&
            selected.every((c) => answers.includes(c)) &&
            answers.every((c) => selected.includes(c));
          report(isCorrect, isCorrect ? '全部正确！' : '选择还不完整或不正确，再看看。');
        } else {
          card.querySelectorAll('button[data-choice]').forEach((item) => item.classList.remove('is-correct', 'is-wrong'));
          const isCorrect = button.getAttribute('data-choice') === answer;
          button.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
          report(isCorrect, isCorrect ? '正确！' : '再试一次。');
        }
      });
    });
  });
}

function appendFillQuizCard(container, item, index) {
  const card = document.createElement('article');
  card.className = 'quiz-card';
  card.dataset.type = 'fill';
  card.dataset.answer = String(item.answer ?? '');

  const question = document.createElement('p');
  question.textContent = \`\${index + 1}. \${String(item.question ?? '请作答')}\`;

  const fill = document.createElement('div');
  fill.className = 'quiz-fill';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '输入你的答案';
  input.setAttribute('aria-label', '答案输入');

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.choice = 'submit';
  button.textContent = '提交';

  const output = document.createElement('output');
  output.setAttribute('aria-live', 'polite');

  const explanation = document.createElement('p');
  explanation.className = 'quiz-explanation';
  explanation.textContent = item.explanation ? String(item.explanation) : \`参考答案：\${String(item.answer ?? '')}\`;

  fill.append(input, button);
  card.append(question, fill, output, explanation);
  container.append(card);
}

window.Quiz = class Quiz {
  constructor(items = [], options = {}) {
    const mount = typeof options.mount === 'string' ? document.querySelector(options.mount) : options.mount;
    const section = mount || document.createElement('section');
    section.classList.add('practice', 'teachos-generated-quiz');

    if (!mount) {
      const title = document.createElement('h2');
      title.textContent = options.title || '小测验';
      section.append(title);
    }

    items.forEach((item, index) => appendFillQuizCard(section, item, index));

    if (!mount) {
      const anchor = document.currentScript;
      if (anchor?.parentNode) anchor.parentNode.insertBefore(section, anchor);
      else document.body.append(section);
    }

    setupTeachOsQuizCards(section);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setupTeachOsQuizCards());
} else {
  setupTeachOsQuizCards();
}
`

export const LESSON_FLASHCARD_CSS = `.flashcards { display: grid; gap: 12px; }
.flashcard { position: relative; min-height: 120px; perspective: 1000px; cursor: pointer; border: 1px solid #e3e8f2; border-radius: 12px; background: #fff; }
.flashcard-face { display: grid; place-items: center; padding: 22px; text-align: center; backface-visibility: hidden; }
.flashcard-front { color: #24324a; font-weight: 600; }
.flashcard-back { position: absolute; inset: 0; transform: rotateY(180deg); color: #536278; background: #f8fafc; border-radius: 12px; }
.flashcard.is-flipped .flashcard-front { opacity: 0; }
.flashcard.is-flipped .flashcard-back { transform: rotateY(0deg); }
.flashcard-self { display: flex; gap: 8px; margin-top: 10px; justify-content: center; }
.flashcard-self button { border: 1px solid #dfe7f4; border-radius: 8px; background: #f8fafc; color: #2d3d56; font: inherit; padding: 6px 12px; cursor: pointer; }
.flashcard-self button:hover { background: #eef4ff; }
.quiz-choices { display: grid; gap: 8px; }
.quiz-choices button.is-selected { border-color: #4f7cf5; background: #edf4ff; }
.quiz-fill { display: flex; gap: 8px; }
.quiz-fill input { flex: 1; min-height: 40px; border: 1px solid #dfe7f4; border-radius: 8px; padding: 0 12px; font: inherit; }
.quiz-fill input.is-correct { border-color: #68b692; background: #eaf8f2; }
.quiz-fill input.is-wrong { border-color: #e5a0af; background: #fff0f4; }
.quiz-explanation { display: none; margin: 6px 0 0; color: #65748a; font-size: 14px; }
`

export const LESSON_FLASHCARD_JS = `document.querySelectorAll('.flashcard').forEach((card) => {
  const flip = () => card.classList.toggle('is-flipped');
  card.addEventListener('click', flip);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  card.querySelectorAll('.flashcard-self button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.parent.postMessage({ source: 'teachos-lesson', kind: 'flashcard', rating: btn.getAttribute('data-rating') }, '*'); } catch {}
    });
  });
});
`
