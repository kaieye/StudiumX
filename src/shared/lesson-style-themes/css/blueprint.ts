export const BLUEPRINT_CSS = `/* blueprint — 蓝晒图纸 */
:root {
  color-scheme: dark;
  --sheet: #164470;
  --sheet-deep: #0f3a61;
  --ink: #eaf3fc;
  --dim: #b0c9de;
  --cyan: #8fd8ee;
  --line: rgba(234, 243, 252, 0.4);
  --line-soft: rgba(234, 243, 252, 0.18);
  --grid: rgba(234, 243, 252, 0.05);
  --red: #ff9d88;
  --amber: #ffd684;
  --green: #93e6b5;
  --font-draft: Bahnschrift, "Franklin Gothic Medium", "Arial Narrow", "Microsoft YaHei", sans-serif;
  --font-body: "Segoe UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
  --font-mono: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
  --page-max: 860px;
  color: var(--ink);
  background: var(--sheet);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.8;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--sheet);
}

/* 图纸微网格 */
body {
  min-height: 100vh;
  margin: 0;
  padding: 0 0 60px;
  color: var(--ink);
  background:
    repeating-linear-gradient(0deg, transparent 0 31px, var(--grid) 31px 32px),
    repeating-linear-gradient(90deg, transparent 0 31px, var(--grid) 31px 32px),
    var(--sheet);
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
  outline: 2px solid var(--cyan);
  outline-offset: 2px;
}

/* —— 图框 + 标题栏 —— */

body > header,
.lesson-hero {
  position: relative;
  margin-top: 40px;
  margin-bottom: 34px;
  padding: 38px 42px 58px;
  color: var(--ink);
  border: 2px solid var(--line);
  border-radius: 0;
  outline: 1px solid var(--line-soft);
  outline-offset: 5px;
  background: var(--sheet-deep);
}

body > header::after,
.lesson-hero::after {
  content: "SHEET NO. 01 \\00B7 SCALE 1:1 \\00B7 REV A";
  position: absolute;
  right: 0;
  bottom: 0;
  padding: 6px 14px;
  color: var(--cyan);
  border-top: 1px solid var(--line);
  border-left: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 2px;
}

.kicker,
body > header .kicker {
  margin: 0 0 14px;
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-draft);
  line-height: 1.3;
}

body > header h1,
.lesson-hero h1 {
  max-width: 700px;
  font-size: 37px;
  font-weight: 600;
  letter-spacing: 3px;
  text-transform: uppercase;
}

body > header p,
.lesson-hero p {
  max-width: 640px;
  margin: 16px 0 0;
  color: var(--dim);
  font-size: 16.5px;
}

.subtitle {
  color: var(--dim);
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
  padding-bottom: 9px;
  color: var(--cyan);
  border-bottom: 1px solid var(--line-soft);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 3.5px;
  text-transform: uppercase;
}

h3 {
  font-size: 17px;
  letter-spacing: 2px;
}

p,
li,
td,
th {
  color: var(--dim);
  font-size: 16px;
  line-height: 1.8;
}

p {
  margin: 10px 0;
}

strong {
  color: #ffffff;
  font-weight: 700;
}

a {
  color: var(--cyan);
  text-decoration: none;
  border-bottom: 1px solid rgba(143, 216, 238, 0.45);
}

a:hover {
  color: #c4ecf8;
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
  color: var(--cyan);
  border: 1px solid var(--line-soft);
  border-radius: 0;
  background: rgba(234, 243, 252, 0.08);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

pre {
  overflow: auto;
  margin: 14px 0 0;
  padding: 18px;
  color: #bfe3f6;
  border: 1px solid var(--line-soft);
  border-radius: 0;
  background: #0b2b4a;
}

pre code {
  padding: 0;
  color: inherit;
  border: 0;
  background: transparent;
}

/* NOTE 框：浮动标签打断边线 */
blockquote {
  position: relative;
  margin: 26px 0 0;
  padding: 18px 18px 14px;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 0;
  background: rgba(234, 243, 252, 0.05);
}

blockquote::before {
  content: "NOTE";
  position: absolute;
  top: -9px;
  left: 12px;
  padding: 0 8px;
  color: var(--cyan);
  background: var(--sheet);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 2.5px;
}

blockquote p {
  margin: 0;
  color: inherit;
}

blockquote p + p {
  margin-top: 8px;
}

hr {
  height: 1px;
  margin: 24px 0;
  border: 0;
  background: var(--line-soft);
}

/* —— 图表格 —— */

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 16px 0 0;
  border: 1px solid var(--line);
  border-radius: 0;
  border-spacing: 0;
  border-collapse: separate;
  background: rgba(11, 43, 74, 0.35);
}

thead {
  background: rgba(234, 243, 252, 0.08);
}

th,
td {
  min-width: 150px;
  padding: 11px 14px;
  text-align: left;
  border-right: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
}

th {
  color: var(--ink);
  border-bottom: 2px solid var(--line);
  font-family: var(--font-draft);
  font-weight: 600;
  letter-spacing: 2px;
}

tr:last-child td {
  border-bottom: 0;
}

th:last-child,
td:last-child {
  border-right: 0;
}

tbody tr:nth-child(even) {
  background: rgba(234, 243, 252, 0.025);
}

/* —— 白线框卡片 —— */

.mission-card,
.qa-block,
.quiz-card,
.summary,
.teachos-generated-quiz {
  border: 1px solid var(--line);
  border-radius: 0;
  background: rgba(234, 243, 252, 0.05);
}

.mission-card {
  padding: 20px 24px;
}

.mission-card span,
.file-grid span,
.steps span {
  display: block;
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
}

.steps span {
  color: var(--dim);
  letter-spacing: 1px;
  text-transform: none;
}

.mission-card strong {
  display: block;
  margin-top: 8px;
  font-family: var(--font-draft);
  font-size: 20px;
  letter-spacing: 1.5px;
}

.mission-card p {
  margin-bottom: 0;
}

.qa-block {
  overflow: hidden;
}

.qa-block h3 {
  padding: 15px 22px;
  border-bottom: 1px solid var(--line-soft);
  background: rgba(234, 243, 252, 0.04);
  font-size: 16.5px;
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

/* REDLINE 修订标记 */
.tip {
  position: relative;
  margin-top: 26px;
  padding: 17px 17px 13px;
  color: #ffc4b5;
  border: 1.5px dashed var(--red);
  border-radius: 0;
  background: rgba(255, 157, 136, 0.08);
}

.tip::before {
  content: "REV \\25B3";
  position: absolute;
  top: -9px;
  left: 12px;
  padding: 0 8px;
  color: var(--red);
  background: var(--sheet);
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 2.5px;
}

.tip strong {
  color: var(--red);
}

/* 汇总：双线图框 */
.summary {
  padding: 24px;
  border: 2px solid var(--line);
  outline: 1px solid var(--line-soft);
  outline-offset: 4px;
  background: var(--sheet-deep);
}

.summary h2 {
  padding-top: 0;
}

.summary blockquote {
  border-color: var(--green);
  background: rgba(147, 230, 181, 0.08);
}

.summary blockquote::before {
  color: var(--green);
  background: var(--sheet-deep);
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
  border: 1px solid var(--line-soft);
  border-radius: 0;
  background: rgba(234, 243, 252, 0.03);
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
  border: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  border-radius: 0;
  background: rgba(234, 243, 252, 0.03);
}

.file-grid a:hover {
  border-color: var(--cyan);
}

.file-grid strong {
  display: block;
  margin-top: 6px;
}

/* —— 测验 —— */

.practice,
.teachos-generated-quiz {
  margin-top: 32px;
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
  margin-top: 12px;
}

.quiz-card p {
  margin: 0;
  color: var(--ink);
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
  border: 1px solid var(--line);
  border-radius: 0;
  font: inherit;
}

.quiz-card button {
  padding: 0 16px;
  color: var(--ink);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.quiz-card button:hover {
  background: rgba(234, 243, 252, 0.08);
}

.quiz-card button.is-selected,
.quiz-card .quiz-choices button.is-selected {
  border-color: var(--cyan);
  background: rgba(143, 216, 238, 0.12);
}

.quiz-card button.is-correct {
  border-color: var(--green);
  background: rgba(147, 230, 181, 0.12);
}

.quiz-card button.is-wrong {
  border-color: var(--red);
  background: rgba(255, 157, 136, 0.1);
}

.quiz-card .quiz-fill input {
  flex: 1;
  width: 100%;
  padding: 0 12px;
  color: var(--ink);
  border: 1px solid var(--line);
  background: rgba(234, 243, 252, 0.05);
}

.quiz-card .quiz-fill input.is-correct {
  border-color: var(--green);
  background: rgba(147, 230, 181, 0.12);
}

.quiz-card .quiz-fill input.is-wrong {
  border-color: var(--red);
  background: rgba(255, 157, 136, 0.1);
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
  color: var(--dim);
  font-size: 14px;
}

footer,
body > footer {
  margin-top: 44px;
  padding-top: 18px;
  border-top: 2px solid var(--line);
}

footer p {
  color: var(--dim);
}

/* —— 图纸闪卡（覆盖 flashcards.css）—— */

.flashcards .flashcard {
  border: 1px solid var(--line);
  border-radius: 0;
  background: var(--sheet-deep);
}

.flashcards .flashcard-front {
  color: var(--ink);
  font-family: var(--font-draft);
  font-size: 16.5px;
  letter-spacing: 1px;
}

.flashcards .flashcard-back {
  color: var(--dim);
  border-radius: 0;
  background: #0d3156;
}

.flashcard .flashcard-self button {
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
}

.flashcard .flashcard-self button:hover {
  background: rgba(234, 243, 252, 0.08);
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
    margin-top: 22px;
    padding: 26px 20px 52px;
    outline-offset: 3px;
  }

  body > header h1,
  .lesson-hero h1 {
    font-size: 27px;
    letter-spacing: 2px;
  }

  section > h2,
  .lesson-page > section > h2 {
    font-size: 17px;
    letter-spacing: 2.5px;
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
