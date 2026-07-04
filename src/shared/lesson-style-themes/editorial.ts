import type { LessonStyleDefinition, LessonStyleTokens } from './types'

/**
 * editorial — 特稿排版
 * Magazine feature layout: ink-blue and signal-orange, thick/thin rule
 * contrast, serif display headings, CJK drop caps and pull quotes.
 */
export const EDITORIAL_TOKENS: LessonStyleTokens = {
  fontBody: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif',
  fontHeading: 'Constantia, Cambria, Georgia, "Songti SC", "SimSun", serif',
  fontMono: '"Cascadia Code", Consolas, "SFMono-Regular", monospace',
  pageBg: '#f4f4ef',
  ink: '#1d2b47',
  muted: '#55607a',
  soft: '#ecece5',
  panel: '#ffffff',
  line: '#d8d9d0',
  accent: '#d9500e',
  accentSoft: '#fbe9dd',
  link: '#14203a',
  linkHover: '#d9500e',
  linkUnderline: 'rgba(217, 80, 14, 0.4)',
  heroBg: 'linear-gradient(180deg, #1d2b47 0%, #1d2b47 12%, #f4f4ef 12%, #f4f4ef 100%)',
  heroBorder: '#1d2b47',
  heroText: '#14203a',
  heroMuted: '#55607a',
  heroKicker: '#d9500e',
  heading: '#14203a',
  strong: '#14203a',
  codeText: '#1d2b47',
  codeBg: '#ecece5',
  codeBorder: '#d8d9d0',
  preText: '#f2f0e9',
  preBg: '#232e47',
  theadBg: 'transparent',
  theadText: '#14203a',
  stripe: 'transparent',
  buttonBg: '#ffffff',
  buttonText: '#1d2b47',
  buttonBorder: '#1d2b47',
  buttonHoverBg: '#fbe9dd',
  green: '#2e7d4f',
  greenSoft: '#e6f2ea',
  amber: '#b06a0a',
  amberSoft: '#faf0d9',
  rose: '#bf3a30',
  roseSoft: '#f9e8e5',
  radiusCard: '0px',
  radiusSmall: '0px',
  shadow: 'none',
  cardShadow: 'none'
}

export const EDITORIAL_CSS = `/* editorial — 特稿排版 */
:root {
  color-scheme: light;
  --paper: #f4f4ef;
  --white: #ffffff;
  --ink: #1d2b47;
  --ink-deep: #14203a;
  --body-text: #3c4660;
  --muted: #55607a;
  --orange: #d9500e;
  --orange-soft: #fbe9dd;
  --line: #d8d9d0;
  --green: #2e7d4f;
  --green-soft: #e6f2ea;
  --amber: #b06a0a;
  --amber-soft: #faf0d9;
  --rose: #bf3a30;
  --rose-soft: #f9e8e5;
  --font-serif: Constantia, Cambria, Georgia, "Songti SC", "SimSun", serif;
  --font-body: "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
  --font-mono: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
  --page-max: 720px;
  color: var(--ink);
  background: var(--paper);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.85;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--paper);
}

body {
  min-height: 100vh;
  margin: 0;
  padding: 0 0 64px;
  color: var(--ink);
  background: var(--paper);
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

:focus-visible {
  outline: 2px solid var(--orange);
  outline-offset: 2px;
}

/* —— 特稿刊头：粗细规则线之间的纯排版 —— */

body > header,
.lesson-hero {
  margin-top: 48px;
  margin-bottom: 36px;
  padding: 26px 0 30px;
  color: var(--ink-deep);
  border: 0;
  border-top: 6px solid var(--ink);
  border-bottom: 1px solid var(--ink);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.kicker,
body > header .kicker {
  margin: 0 0 18px;
  color: var(--orange);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 4px;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--ink-deep);
  font-family: var(--font-serif);
  line-height: 1.22;
}

body > header h1,
.lesson-hero h1 {
  max-width: 660px;
  font-size: 48px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1.18;
}

body > header p,
.lesson-hero p {
  max-width: 620px;
  margin: 18px 0 0;
  color: var(--muted);
  font-family: var(--font-serif);
  font-size: 18px;
  line-height: 1.7;
}

.subtitle {
  color: var(--muted);
  font-weight: 700;
}

/* —— 正文 —— */

section,
article {
  margin-top: 34px;
}

section > h2,
.lesson-page > section > h2 {
  margin: 0 0 16px;
  font-size: 27px;
  font-weight: 700;
}

section > h2::before,
.lesson-page > section > h2::before {
  content: "";
  display: block;
  width: 44px;
  height: 3px;
  margin-bottom: 12px;
  background: var(--orange);
}

h3 {
  font-size: 20px;
}

p,
li,
td,
th {
  color: var(--body-text);
  font-size: 16px;
  line-height: 1.85;
}

p {
  margin: 10px 0;
}

/* 首段首字下沉 */
body > header + section:not([class]) > p:first-of-type::first-letter,
.lesson-hero + section:not([class]) > p:first-of-type::first-letter,
.mission-card + section:not([class]) > p:first-of-type::first-letter {
  float: left;
  margin: 7px 12px 0 0;
  color: var(--orange);
  font-family: var(--font-serif);
  font-size: 52px;
  font-weight: 700;
  line-height: 0.9;
}

strong {
  color: var(--ink-deep);
  font-weight: 700;
}

a {
  color: var(--ink-deep);
  text-decoration: none;
  border-bottom: 2px solid rgba(217, 80, 14, 0.4);
}

a:hover {
  color: var(--orange);
  border-bottom-color: currentColor;
}

ul,
ol {
  margin: 10px 0 0;
  padding-left: 1.4rem;
}

li + li {
  margin-top: 8px;
}

code {
  padding: 0.1em 0.4em;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 0;
  background: #ecece5;
  font-family: var(--font-mono);
  font-size: 0.9em;
}

pre {
  overflow: auto;
  margin: 14px 0 0;
  padding: 18px;
  color: #f2f0e9;
  border-radius: 0;
  background: #232e47;
}

pre code {
  padding: 0;
  color: inherit;
  border: 0;
  background: transparent;
}

/* 拉引：上下细线之间的大号衬线 */
blockquote {
  position: relative;
  margin: 28px 0 0;
  padding: 14px 0 16px 42px;
  color: var(--ink-deep);
  border: 0;
  border-top: 1px solid var(--ink);
  border-bottom: 1px solid var(--ink);
  border-radius: 0;
  background: transparent;
  font-family: var(--font-serif);
  font-size: 20px;
  line-height: 1.65;
}

blockquote::before {
  content: "\\300C";
  position: absolute;
  top: 10px;
  left: 0;
  color: var(--orange);
  font-family: var(--font-serif);
  font-size: 30px;
  line-height: 1;
}

blockquote p {
  margin: 0;
  color: inherit;
  font-size: inherit;
  line-height: inherit;
}

blockquote p + p {
  margin-top: 8px;
}

hr {
  height: 1px;
  margin: 24px 0;
  border: 0;
  background: var(--ink);
}

/* —— 无竖线编辑表格 —— */

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 18px 0 0;
  border: 0;
  border-top: 3px solid var(--ink);
  border-radius: 0;
  border-spacing: 0;
  border-collapse: separate;
  background: transparent;
}

thead {
  background: transparent;
}

th,
td {
  min-width: 150px;
  padding: 11px 14px 11px 2px;
  text-align: left;
  border-right: 0;
  border-bottom: 1px solid var(--line);
}

th {
  color: var(--ink-deep);
  border-bottom: 1px solid var(--ink);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

tr:last-child td {
  border-bottom: 1px solid var(--ink);
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:nth-child(even) {
  background: transparent;
}

/* —— 编辑部卡片 —— */

.mission-card,
.qa-block,
.quiz-card,
.teachos-generated-quiz {
  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--white);
}

.mission-card {
  padding: 20px 26px;
  border-left: 3px solid var(--orange);
}

.mission-card span,
.file-grid span,
.steps span {
  display: block;
  color: var(--orange);
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
}

.steps span {
  color: var(--muted);
  letter-spacing: 0.5px;
  text-transform: none;
}

.mission-card strong {
  display: block;
  margin-top: 8px;
  font-family: var(--font-serif);
  font-size: 21px;
}

.mission-card p {
  margin-bottom: 0;
}

.qa-block {
  overflow: hidden;
}

.qa-block h3 {
  padding: 16px 24px;
  border-bottom: 1px solid var(--line);
  background: #fafaf6;
  font-size: 19px;
}

.answer {
  padding: 16px 24px 20px;
}

.answer > :first-child {
  margin-top: 0;
}

.answer > :last-child {
  margin-bottom: 0;
}

/* 旁注 */
.tip {
  margin-top: 16px;
  padding: 13px 17px;
  color: #7c4d09;
  border: 0;
  border-left: 3px solid var(--amber);
  border-radius: 0;
  background: var(--amber-soft);
}

.tip strong {
  color: var(--amber);
}

/* 要点栏：整块墨蓝反白 */
.summary {
  padding: 26px 30px;
  color: #e8ebf5;
  border: 0;
  border-radius: 0;
  background: var(--ink);
}

.summary h2 {
  padding-top: 0;
  color: var(--white);
}

.summary h2::after,
.summary h2::before {
  background: var(--orange);
}

.summary p,
.summary li {
  color: #c6cde0;
}

.summary strong {
  color: var(--white);
}

.summary blockquote {
  color: var(--white);
  border-top-color: rgba(255, 255, 255, 0.4);
  border-bottom-color: rgba(255, 255, 255, 0.4);
}

.steps,
.compact-list {
  display: grid;
  gap: 0;
  padding: 0;
  list-style: none;
}

.steps li,
.compact-list li {
  margin: 0;
  padding: 12px 2px;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
}

.steps li {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
}

.steps strong {
  color: var(--ink-deep);
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
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: var(--white);
}

.file-grid a:hover {
  border-color: var(--ink);
}

.file-grid strong {
  display: block;
  margin-top: 6px;
  color: var(--ink-deep);
}

/* —— 测验 —— */

.practice,
.teachos-generated-quiz {
  margin-top: 34px;
}

.teachos-generated-quiz {
  padding: 22px;
}

.quiz-card {
  display: grid;
  gap: 12px;
  padding: 20px 22px;
}

.quiz-card + .quiz-card {
  margin-top: 12px;
}

.quiz-card p {
  margin: 0;
  color: var(--ink-deep);
}

.quiz-choices {
  display: grid;
  gap: 8px;
}

.quiz-card .quiz-fill {
  display: flex;
  gap: 8px;
}

.quiz-card button,
.quiz-fill input {
  min-height: 42px;
  border: 1px solid var(--ink);
  border-radius: 0;
  font: inherit;
}

.quiz-card button {
  padding: 0 16px;
  color: var(--ink);
  background: var(--white);
  cursor: pointer;
  text-align: left;
}

.quiz-card button:hover {
  color: var(--orange);
  border-color: var(--orange);
  background: var(--white);
}

.quiz-card button.is-selected,
.quiz-card .quiz-choices button.is-selected {
  color: var(--ink-deep);
  border-color: var(--orange);
  background: var(--orange-soft);
}

.quiz-card button.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card button.is-wrong {
  border-color: var(--rose);
  background: var(--rose-soft);
}

.quiz-card .quiz-fill input {
  flex: 1;
  width: 100%;
  padding: 0 12px;
  color: var(--ink);
  border: 1px solid var(--ink);
  background: var(--white);
}

.quiz-card .quiz-fill input.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card .quiz-fill input.is-wrong {
  border-color: var(--rose);
  background: var(--rose-soft);
}

output {
  min-height: 24px;
  color: var(--green);
  font-weight: 700;
}

.quiz-explanation,
.quiz-card .quiz-explanation {
  display: none;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}

footer,
body > footer {
  margin-top: 48px;
  padding-top: 18px;
  border-top: 3px double var(--ink);
}

footer p {
  color: var(--muted);
}

/* —— 闪卡（覆盖 flashcards.css）—— */

.flashcards .flashcard {
  border: 1px solid var(--line);
  border-top: 3px solid var(--ink);
  border-radius: 0;
  background: var(--white);
}

.flashcards .flashcard-front {
  color: var(--ink-deep);
  font-family: var(--font-serif);
  font-size: 17.5px;
}

.flashcards .flashcard-back {
  color: var(--muted);
  border-radius: 0;
  background: #eeeee7;
}

.flashcard .flashcard-self button {
  color: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 0;
  background: var(--white);
}

.flashcard .flashcard-self button:hover {
  color: var(--orange);
  border-color: var(--orange);
  background: var(--white);
}

@media (max-width: 700px) {
  body {
    padding-bottom: 40px;
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
    margin-top: 26px;
    padding: 20px 0 24px;
  }

  body > header h1,
  .lesson-hero h1 {
    font-size: 33px;
  }

  section > h2,
  .lesson-page > section > h2 {
    font-size: 23px;
  }

  body > header + section:not([class]) > p:first-of-type::first-letter,
  .lesson-hero + section:not([class]) > p:first-of-type::first-letter,
  .mission-card + section:not([class]) > p:first-of-type::first-letter {
    font-size: 42px;
  }

  .qa-block h3,
  .answer,
  .summary,
  .teachos-generated-quiz {
    padding-right: 16px;
    padding-left: 16px;
  }

  .file-grid {
    grid-template-columns: 1fr;
  }

  .quiz-card .quiz-fill {
    flex-direction: column;
  }

  .steps li {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition: none !important;
    animation: none !important;
  }
}
`

/**
 * blueprint — 蓝晒图纸
 * Prussian-blue drafting sheet: faint grid, double-line drawing frame
 * with a title block, DIN-style condensed headings, NOTE/REV labels.
 */

export const EDITORIAL_STYLE: LessonStyleDefinition = {
  id: 'editorial',
  tokens: EDITORIAL_TOKENS,
  css: EDITORIAL_CSS
}
