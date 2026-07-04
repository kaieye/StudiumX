import type { LessonStyleTokens } from './types'

export const SANS_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif'
export const MONO_FONT = '"Cascadia Code", "SFMono-Regular", Consolas, monospace'

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
