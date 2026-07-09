import type { LessonStyleDefinition, LessonStyleTokens } from './types'

/**
 * manuscript — 稿纸批注
 * Chinese composition-grid paper with the teacher's vermilion pen:
 * kaiti display type, a seal-style kicker, double-rule underlines.
 */
export const MANUSCRIPT_TOKENS: LessonStyleTokens = {
  fontBody: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif',
  fontHeading: '"KaiTi", "Kaiti SC", "STKaiti", "DFKai-SB", "BiauKai", serif',
  fontMono: '"Cascadia Code", Consolas, "SFMono-Regular", monospace',
  pageBg: '#f6f1e5',
  ink: '#2d2a21',
  muted: '#6f6a5b',
  soft: '#f3ecdc',
  panel: '#fdfbf4',
  line: '#ddd5c2',
  accent: '#b8392a',
  accentSoft: 'rgba(184, 57, 42, 0.07)',
  link: '#8a4a1f',
  linkHover: '#b8392a',
  linkUnderline: 'rgba(138, 74, 31, 0.35)',
  heroBg:
    'repeating-linear-gradient(0deg, transparent 0 27px, rgba(122, 160, 133, 0.38) 27px 28px), repeating-linear-gradient(90deg, transparent 0 27px, rgba(122, 160, 133, 0.38) 27px 28px), #fdfbf4',
  heroBorder: '#a9c2b0',
  heroText: '#2d2a21',
  heroMuted: '#6f6a5b',
  heroKicker: '#b8392a',
  heading: '#2d2a21',
  strong: '#211e16',
  codeText: '#7c4a1e',
  codeBg: '#f3ecdc',
  codeBorder: '#ddd5c2',
  preText: '#f2ecd9',
  preBg: '#332f24',
  theadBg: '#f3ecdc',
  theadText: '#2d2a21',
  stripe: '#f9f5ea',
  buttonBg: '#fdfbf4',
  buttonText: '#2d2a21',
  buttonBorder: '#c9c0a8',
  buttonHoverBg: '#f3ecdc',
  green: '#45744d',
  greenSoft: '#e9f0e4',
  amber: '#966d1d',
  amberSoft: '#f7eed3',
  rose: '#b8392a',
  roseSoft: 'rgba(184, 57, 42, 0.08)',
  radiusCard: '3px',
  radiusSmall: '3px',
  shadow: '0 2px 0 rgba(45, 42, 33, 0.05), 0 14px 30px rgba(45, 42, 33, 0.07)',
  cardShadow: '0 1px 0 rgba(45, 42, 33, 0.04), 0 8px 18px rgba(45, 42, 33, 0.05)'
}

export const MANUSCRIPT_CSS = `/* manuscript — 稿纸批注 */
:root {
  color-scheme: light;
  --paper: #f6f1e5;
  --card: #fdfbf4;
  --ink: #2d2a21;
  --muted: #6f6a5b;
  --red: #b8392a;
  --red-ink: #7c352b;
  --grid: rgba(122, 160, 133, 0.38);
  --grid-strong: #a9c2b0;
  --line: #ddd5c2;
  --soft: #f3ecdc;
  --green: #45744d;
  --green-soft: #e9f0e4;
  --amber: #966d1d;
  --amber-soft: #f7eed3;
  --font-kai: "KaiTi", "Kaiti SC", "STKaiti", "DFKai-SB", "BiauKai", serif;
  --font-body: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif;
  --font-mono: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
  --page-max: 780px;
  color: var(--ink);
  background: var(--paper);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.9;
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
  outline: 2px solid var(--red);
  outline-offset: 2px;
}

/* —— 稿纸 hero —— */

body > header,
.lesson-hero {
  margin-top: 40px;
  margin-bottom: 32px;
  padding: 42px 46px 40px;
  border: 1px solid var(--grid-strong);
  border-radius: 3px;
  background:
    repeating-linear-gradient(0deg, transparent 0 27px, var(--grid) 27px 28px),
    repeating-linear-gradient(90deg, transparent 0 27px, var(--grid) 27px 28px),
    var(--card);
  box-shadow: 0 2px 0 rgba(45, 42, 33, 0.05), 0 14px 30px rgba(45, 42, 33, 0.07);
}

.kicker,
body > header .kicker {
  display: inline-block;
  margin: 0 0 20px;
  padding: 3px 12px;
  color: var(--red);
  border: 1.5px solid rgba(184, 57, 42, 0.75);
  border-radius: 3px;
  background: var(--card);
  font-family: var(--font-kai);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2px;
  transform: rotate(-1.2deg);
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-kai);
  line-height: 1.3;
}

body > header h1,
.lesson-hero h1 {
  max-width: 640px;
  font-size: 42px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1.28;
}

body > header p,
.lesson-hero p {
  max-width: 600px;
  margin: 16px 0 0;
  color: var(--muted);
  font-size: 16.5px;
}

.subtitle {
  color: var(--muted);
  font-weight: 700;
}

/* —— 正文 —— */

section,
article {
  margin-top: 30px;
}

section > h2,
.lesson-page > section > h2 {
  margin: 0 0 16px;
  font-size: 27px;
  font-weight: 700;
  letter-spacing: 1px;
}

section > h2::after,
.lesson-page > section > h2::after {
  content: "";
  display: block;
  width: 72px;
  margin-top: 8px;
  border-bottom: 4px double rgba(184, 57, 42, 0.6);
}

h3 {
  font-size: 20px;
}

p,
li,
td,
th {
  color: #4d493d;
  font-size: 16px;
  line-height: 1.9;
}

p {
  margin: 10px 0;
}

strong {
  color: #211e16;
  font-weight: 700;
}

a {
  color: #8a4a1f;
  text-decoration: none;
  border-bottom: 1px solid rgba(138, 74, 31, 0.35);
}

a:hover {
  color: var(--red);
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
  color: #7c4a1e;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--soft);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

pre {
  overflow: auto;
  margin: 14px 0 0;
  padding: 18px;
  color: #f2ecd9;
  border-radius: 3px;
  background: #332f24;
}

pre code {
  padding: 0;
  color: inherit;
  border: 0;
  background: transparent;
}

/* 批注：楷体引文，朱笔左线 */
blockquote {
  margin: 18px 0 0;
  padding: 14px 22px;
  color: #4a4433;
  border-left: 3px solid var(--red);
  border-radius: 0 3px 3px 0;
  background: rgba(184, 57, 42, 0.05);
  font-family: var(--font-kai);
  font-size: 17.5px;
}

blockquote p {
  margin: 0;
  color: inherit;
  font-size: inherit;
}

blockquote p + p {
  margin-top: 8px;
}

hr {
  height: 1px;
  margin: 22px 0;
  border: 0;
  background: var(--line);
}

/* —— 练习册表格 —— */

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 16px 0 0;
  border: 1px solid var(--grid-strong);
  border-radius: 3px;
  border-spacing: 0;
  border-collapse: separate;
  background: var(--card);
}

thead {
  background: var(--soft);
}

th,
td {
  min-width: 150px;
  padding: 11px 14px;
  text-align: left;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

th {
  color: var(--ink);
  border-bottom: 2px solid var(--grid-strong);
  font-family: var(--font-kai);
  font-size: 16.5px;
  font-weight: 700;
}

tr:last-child td {
  border-bottom: 0;
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:nth-child(even) {
  background: #f9f5ea;
}

/* —— 卡片组件 —— */

.mission-card,
.qa-block,
.quiz-card,
.summary,
.studiumx-generated-quiz {
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--card);
  box-shadow: 0 1px 0 rgba(45, 42, 33, 0.04), 0 8px 18px rgba(45, 42, 33, 0.05);
}

.mission-card {
  padding: 20px 24px;
  border-left: 4px solid var(--red);
}

.mission-card span,
.file-grid span,
.steps span {
  display: block;
  color: var(--red);
  font-family: var(--font-kai);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 3px;
}

.steps span {
  color: var(--muted);
  letter-spacing: 1px;
}

.mission-card strong {
  display: block;
  margin-top: 8px;
  font-family: var(--font-kai);
  font-size: 20px;
}

.mission-card p {
  margin-bottom: 0;
}

.qa-block {
  overflow: hidden;
}

.qa-block h3 {
  padding: 16px 22px;
  border-bottom: 1px solid var(--line);
  background: var(--soft);
  font-size: 18px;
}

.answer {
  padding: 16px 22px 20px;
}

.answer > :first-child {
  margin-top: 0;
}

.answer > :last-child {
  margin-bottom: 0;
}

/* 红笔圈出的提示 */
.tip {
  margin-top: 16px;
  padding: 13px 17px;
  color: var(--red-ink);
  border: 1.5px dashed rgba(184, 57, 42, 0.55);
  border-radius: 10px;
  background: rgba(184, 57, 42, 0.05);
}

.tip strong {
  color: var(--red);
}

.summary {
  padding: 24px;
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
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--card);
}

.steps li {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
}

.steps strong {
  color: var(--ink);
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
  border-radius: 3px;
  background: var(--card);
}

.file-grid a:hover {
  border-color: rgba(184, 57, 42, 0.5);
}

.file-grid strong {
  display: block;
  margin-top: 6px;
}

/* —— 测验 —— */

.practice,
.studiumx-generated-quiz {
  margin-top: 30px;
}

.studiumx-generated-quiz {
  padding: 20px;
}

.quiz-card {
  display: grid;
  gap: 12px;
  padding: 18px 20px;
  box-shadow: none;
}

.quiz-card + .quiz-card {
  margin-top: 12px;
}

.quiz-card p {
  margin: 0;
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
  border: 1px solid #c9c0a8;
  border-radius: 3px;
  font: inherit;
}

.quiz-card button {
  padding: 0 16px;
  color: var(--ink);
  background: var(--card);
  cursor: pointer;
  text-align: left;
}

.quiz-card button:hover {
  background: var(--soft);
}

.quiz-card button.is-selected,
.quiz-card .quiz-choices button.is-selected {
  border-color: var(--red);
  background: rgba(184, 57, 42, 0.07);
}

.quiz-card button.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card button.is-wrong {
  border-color: var(--red);
  background: rgba(184, 57, 42, 0.08);
}

.quiz-card .quiz-fill input {
  flex: 1;
  width: 100%;
  padding: 0 12px;
  color: var(--ink);
  border: 1px solid #c9c0a8;
  background: var(--card);
}

.quiz-card .quiz-fill input.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card .quiz-fill input.is-wrong {
  border-color: var(--red);
  background: rgba(184, 57, 42, 0.08);
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
  margin-top: 44px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}

footer p {
  color: var(--muted);
}

/* —— 索引卡闪卡（覆盖 flashcards.css）—— */

.flashcards .flashcard {
  border: 1px solid var(--line);
  border-top: 3px solid var(--red);
  border-radius: 3px;
  background: var(--card);
}

.flashcards .flashcard-front {
  color: var(--ink);
  font-family: var(--font-kai);
  font-size: 17.5px;
}

.flashcards .flashcard-back {
  color: var(--muted);
  border-radius: 0 0 3px 3px;
  background: var(--soft);
}

.flashcard .flashcard-self button {
  color: var(--ink);
  border: 1px solid #c9c0a8;
  border-radius: 3px;
  background: var(--card);
}

.flashcard .flashcard-self button:hover {
  background: var(--soft);
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
    margin-top: 20px;
    padding: 28px 22px;
  }

  body > header h1,
  .lesson-hero h1 {
    font-size: 31px;
  }

  section > h2,
  .lesson-page > section > h2 {
    font-size: 23px;
  }

  .qa-block h3,
  .answer,
  .summary,
  .studiumx-generated-quiz {
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
 * chalkboard — 晚自习黑板
 * Deep-green board in a wooden rim: chalk handwriting for headings,
 * dashed chalk frames, yellow/pink/green chalk as the semantic colors.
 */

export const MANUSCRIPT_STYLE: LessonStyleDefinition = {
  id: 'manuscript',
  tokens: MANUSCRIPT_TOKENS,
  css: MANUSCRIPT_CSS
}
