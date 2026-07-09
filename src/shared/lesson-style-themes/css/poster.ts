export const POSTER_CSS = `/* poster — 教室海报 */
:root {
  color-scheme: light;
  --paper: #f6ecd9;
  --card: #fdf6e9;
  --ink: #2f2820;
  --muted: #6d6152;
  --lake: #1d7290;
  --lake-soft: #d9ebee;
  --tomato: #cf4527;
  --tomato-soft: #f9ddd3;
  --mustard: #dea82c;
  --mustard-soft: #f8ecd0;
  --green: #4c8a4f;
  --green-soft: #e2eedd;
  --shadow: 6px 6px 0 rgba(47, 40, 32, 0.85);
  --shadow-sm: 4px 4px 0 rgba(47, 40, 32, 0.85);
  --font-black: "Segoe UI Black", "Arial Black", "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  --font-body: "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
  --font-mono: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
  --page-max: 800px;
  color: var(--ink);
  background: var(--paper);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.8;
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
  outline: 3px solid var(--lake);
  outline-offset: 2px;
}

/* —— 挂图刊头 —— */

body > header,
.lesson-hero {
  margin-top: 40px;
  margin-bottom: 38px;
  padding: 38px 42px 42px;
  color: #fdf6e9;
  border: 3px solid var(--ink);
  border-radius: 18px;
  background: var(--lake);
  box-shadow: var(--shadow);
}

.kicker,
body > header .kicker {
  display: inline-block;
  margin: 0 0 20px;
  padding: 4px 14px;
  color: var(--ink);
  border: 2px solid var(--ink);
  border-radius: 999px;
  background: var(--mustard);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-black);
  font-weight: 900;
  line-height: 1.2;
}

body > header h1,
.lesson-hero h1 {
  max-width: 660px;
  color: #fdf6e9;
  font-size: 42px;
  letter-spacing: -0.5px;
  line-height: 1.15;
}

body > header p,
.lesson-hero p {
  max-width: 620px;
  margin: 16px 0 0;
  color: rgba(253, 246, 233, 0.9);
  font-size: 17px;
}

.subtitle {
  color: rgba(253, 246, 233, 0.9);
  font-weight: 700;
}

/* —— 正文 —— */

section,
article {
  margin-top: 32px;
}

section > h2,
.lesson-page > section > h2 {
  margin: 0 0 16px;
  font-size: 25px;
}

section > h2::before,
.lesson-page > section > h2::before {
  content: "";
  display: inline-block;
  width: 14px;
  height: 14px;
  margin-right: 11px;
  border: 2px solid var(--ink);
  border-radius: 4px;
  background: var(--mustard);
  transform: translateY(1px);
}

h3 {
  font-size: 19px;
}

p,
li,
td,
th {
  color: #4a4234;
  font-size: 16px;
  line-height: 1.8;
}

p {
  margin: 10px 0;
}

/* 荧光笔划重点 */
strong {
  padding: 0 2px;
  color: var(--ink);
  background: linear-gradient(transparent 58%, rgba(222, 168, 44, 0.5) 58%);
  font-weight: 800;
}

a {
  color: var(--lake);
  text-decoration: none;
  border-bottom: 2px solid rgba(29, 114, 144, 0.45);
  font-weight: 700;
}

a:hover {
  color: var(--tomato);
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
  border: 1.5px solid var(--ink);
  border-radius: 6px;
  background: var(--card);
  font-family: var(--font-mono);
  font-size: 0.88em;
}

pre {
  overflow: auto;
  margin: 16px 0 0;
  padding: 18px;
  color: #f6ecd9;
  border: 3px solid var(--ink);
  border-radius: 12px;
  background: #2f2820;
  box-shadow: var(--shadow-sm);
}

pre code {
  padding: 0;
  color: inherit;
  border: 0;
  background: transparent;
}

/* 标语条 */
blockquote {
  margin: 20px 0 0;
  padding: 16px 20px;
  color: var(--ink);
  border: 2px solid var(--ink);
  border-radius: 12px;
  background: var(--mustard-soft);
  box-shadow: var(--shadow-sm);
  font-weight: 600;
}

blockquote p {
  margin: 0;
  color: inherit;
}

blockquote p + p {
  margin-top: 8px;
}

hr {
  height: 3px;
  margin: 24px 0;
  border: 0;
  border-radius: 999px;
  background: var(--ink);
}

/* —— 挂图表格 —— */

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 18px 0 0;
  border: 2px solid var(--ink);
  border-radius: 12px;
  border-spacing: 0;
  border-collapse: separate;
  background: var(--card);
  box-shadow: var(--shadow-sm);
}

thead {
  background: var(--mustard);
}

thead th:first-child {
  border-top-left-radius: 9px;
}

thead th:last-child {
  border-top-right-radius: 9px;
}

th,
td {
  min-width: 150px;
  padding: 11px 14px;
  text-align: left;
  border-right: 1px solid rgba(47, 40, 32, 0.25);
  border-bottom: 1px solid rgba(47, 40, 32, 0.25);
}

th {
  color: var(--ink);
  border-bottom: 2px solid var(--ink);
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
  background: #f7efdd;
}

/* —— 厚描边卡片 —— */

.qa-block,
.quiz-card,
.teachos-generated-quiz {
  border: 2px solid var(--ink);
  border-radius: 14px;
  background: var(--card);
}

.mission-card {
  padding: 22px 26px;
  border: 3px solid var(--ink);
  border-radius: 16px;
  background: var(--card);
  box-shadow: var(--shadow);
}

.mission-card span,
.file-grid span,
.steps span {
  display: inline-block;
  padding: 3px 12px;
  color: #fdf6e9;
  border: 2px solid var(--ink);
  border-radius: 999px;
  background: var(--tomato);
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.file-grid span,
.steps span {
  padding: 0;
  color: var(--muted);
  border: 0;
  border-radius: 0;
  background: transparent;
  letter-spacing: 1px;
  text-transform: none;
}

.mission-card strong {
  display: block;
  margin-top: 12px;
  padding: 0;
  background: none;
  font-family: var(--font-black);
  font-size: 21px;
}

.mission-card p {
  margin-bottom: 0;
}

.qa-block {
  overflow: hidden;
}

.qa-block h3 {
  padding: 16px 22px;
  border-bottom: 2px solid var(--ink);
  background: var(--lake-soft);
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

.tip {
  margin-top: 18px;
  padding: 14px 18px;
  color: #8c3a26;
  border: 2px solid var(--ink);
  border-radius: 12px;
  background: var(--tomato-soft);
}

.tip strong {
  padding: 0;
  color: var(--tomato);
  background: none;
}

.summary {
  padding: 24px;
  border: 3px solid var(--ink);
  border-radius: 16px;
  background: var(--lake-soft);
}

.summary h2 {
  padding-top: 0;
}

.summary blockquote {
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
  border: 2px solid var(--ink);
  border-radius: 10px;
  background: var(--card);
}

.steps li {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
}

.steps strong {
  padding: 0;
  background: none;
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.file-grid a {
  display: block;
  padding: 16px;
  border: 2px solid var(--ink);
  border-bottom: 2px solid var(--ink);
  border-radius: 12px;
  background: var(--card);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}

.file-grid a:hover {
  transform: translate(-2px, -2px);
  box-shadow: var(--shadow-sm);
}

.file-grid strong {
  display: block;
  margin-top: 6px;
  padding: 0;
  background: none;
}

/* —— 测验 —— */

.practice,
.teachos-generated-quiz {
  margin-top: 34px;
}

.teachos-generated-quiz {
  padding: 20px;
}

.quiz-card {
  display: grid;
  gap: 12px;
  padding: 18px 20px;
}

.quiz-card + .quiz-card {
  margin-top: 14px;
}

.quiz-card p {
  margin: 0;
  font-weight: 700;
}

.quiz-choices {
  display: grid;
  gap: 10px;
}

.quiz-card .quiz-fill {
  display: flex;
  gap: 10px;
}

.quiz-card button,
.quiz-fill input {
  min-height: 44px;
  border: 2px solid var(--ink);
  border-radius: 10px;
  font: inherit;
}

.quiz-card button {
  padding: 0 16px;
  color: var(--ink);
  background: var(--card);
  box-shadow: 3px 3px 0 rgba(47, 40, 32, 0.85);
  cursor: pointer;
  text-align: left;
  font-weight: 700;
  transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.1s ease;
}

.quiz-card button:hover {
  background: var(--mustard-soft);
}

.quiz-card button:active {
  transform: translate(2px, 2px);
  box-shadow: 1px 1px 0 rgba(47, 40, 32, 0.85);
}

.quiz-card button.is-selected,
.quiz-card .quiz-choices button.is-selected {
  border-color: var(--lake);
  background: var(--lake-soft);
}

.quiz-card button.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card button.is-wrong {
  border-color: var(--tomato);
  background: var(--tomato-soft);
}

.quiz-card .quiz-fill input {
  flex: 1;
  width: 100%;
  padding: 0 14px;
  color: var(--ink);
  border: 2px solid var(--ink);
  background: var(--card);
}

.quiz-card .quiz-fill input.is-correct {
  border-color: var(--green);
  background: var(--green-soft);
}

.quiz-card .quiz-fill input.is-wrong {
  border-color: var(--tomato);
  background: var(--tomato-soft);
}

output {
  min-height: 24px;
  color: var(--green);
  font-weight: 800;
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
  padding-top: 20px;
  border-top: 3px solid var(--ink);
}

footer p {
  color: var(--muted);
}

/* —— 挂图闪卡（覆盖 flashcards.css）—— */

.flashcards .flashcard {
  border: 3px solid var(--ink);
  border-radius: 16px;
  background: var(--card);
  box-shadow: var(--shadow-sm);
}

.flashcards .flashcard-front {
  color: var(--ink);
  font-family: var(--font-black);
  font-size: 16.5px;
}

.flashcards .flashcard-back {
  color: #3d4d44;
  border-radius: 13px;
  background: var(--lake-soft);
}

.flashcard .flashcard-self button {
  color: var(--ink);
  border: 2px solid var(--ink);
  border-radius: 999px;
  background: var(--card);
  font-weight: 700;
}

.flashcard .flashcard-self button[data-rating="again"] {
  background: var(--tomato-soft);
}

.flashcard .flashcard-self button[data-rating="good"] {
  background: var(--mustard-soft);
}

.flashcard .flashcard-self button[data-rating="mastered"] {
  background: var(--green-soft);
}

.flashcard .flashcard-self button:hover {
  transform: translateY(-1px);
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
    margin-top: 22px;
    padding: 26px 22px 30px;
    box-shadow: var(--shadow-sm);
  }

  body > header h1,
  .lesson-hero h1 {
    font-size: 31px;
  }

  section > h2,
  .lesson-page > section > h2 {
    font-size: 22px;
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
