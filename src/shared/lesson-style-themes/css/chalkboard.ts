export const CHALKBOARD_CSS = `/* chalkboard — 晚自习黑板 */
:root {
  color-scheme: dark;
  --board: #223930;
  --board-deep: #1b2f28;
  --panel: #28423a;
  --chalk: #ecf2e6;
  --chalk-dim: #b9cab3;
  --yellow: #f2d478;
  --pink: #f0aebc;
  --blue: #a5d8e6;
  --green: #a8dcb0;
  --line: rgba(236, 242, 230, 0.28);
  --line-soft: rgba(236, 242, 230, 0.16);
  --wood: #6f5640;
  --font-hand: "Segoe Print", "Bradley Hand", "Chalkboard SE", "KaiTi", "Kaiti SC", cursive;
  --font-body: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Segoe UI", sans-serif;
  --font-mono: "Cascadia Code", Consolas, "SFMono-Regular", monospace;
  --page-max: 850px;
  color: var(--chalk);
  background: var(--wood);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.85;
}

* {
  box-sizing: border-box;
}

html {
  background: var(--wood);
}

/* 黑板配木质包边 */
body {
  min-height: 100vh;
  margin: 0;
  padding: 0 0 60px;
  color: var(--chalk);
  background: var(--board);
  border: 10px solid var(--wood);
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
  outline: 2px solid var(--yellow);
  outline-offset: 2px;
}

/* —— 板书标题区 —— */

body > header,
.lesson-hero {
  margin-top: 38px;
  margin-bottom: 32px;
  padding: 38px 42px 42px;
  color: var(--chalk);
  border: 2px dashed var(--line);
  border-radius: 14px;
  background: var(--board-deep);
}

.kicker,
body > header .kicker {
  margin: 0 0 12px;
  color: var(--yellow);
  font-family: var(--font-hand);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 2px;
}

h1,
h2,
h3 {
  margin: 0;
  color: var(--chalk);
  font-family: var(--font-hand);
  line-height: 1.35;
}

body > header h1,
.lesson-hero h1 {
  max-width: 680px;
  font-size: 38px;
  font-weight: 700;
  line-height: 1.4;
  text-decoration: underline;
  text-decoration-style: wavy;
  text-decoration-color: rgba(242, 212, 120, 0.75);
  text-decoration-thickness: 2px;
  text-underline-offset: 12px;
}

body > header p,
.lesson-hero p {
  max-width: 640px;
  margin: 20px 0 0;
  color: var(--chalk-dim);
  font-size: 16.5px;
}

.subtitle {
  color: var(--chalk-dim);
  font-weight: 700;
}

/* —— 正文 —— */

section,
article {
  margin-top: 30px;
}

section > h2,
.lesson-page > section > h2 {
  margin: 0 0 14px;
  color: var(--yellow);
  font-size: 26px;
  font-weight: 700;
}

h3 {
  font-size: 19px;
}

p,
li,
td,
th {
  color: var(--chalk-dim);
  font-size: 16px;
  line-height: 1.85;
}

p {
  margin: 10px 0;
}

strong {
  color: #fbfdf8;
  font-weight: 700;
}

a {
  color: var(--blue);
  text-decoration: none;
  border-bottom: 1px dashed rgba(165, 216, 230, 0.55);
}

a:hover {
  color: #cdeaf2;
  border-bottom-style: solid;
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
  color: var(--blue);
  border: 1px solid var(--line-soft);
  border-radius: 6px;
  background: rgba(236, 242, 230, 0.1);
  font-family: var(--font-mono);
  font-size: 0.9em;
}

pre {
  overflow: auto;
  margin: 14px 0 0;
  padding: 18px;
  color: #cfe8d4;
  border: 1px dashed var(--line-soft);
  border-radius: 10px;
  background: #152420;
}

pre code {
  padding: 0;
  color: inherit;
  border: 0;
  background: transparent;
}

/* 黄粉笔框出的重点 */
blockquote {
  margin: 18px 0 0;
  padding: 15px 20px;
  color: var(--chalk);
  border: 0;
  border-left: 3px solid var(--yellow);
  border-radius: 0 10px 10px 0;
  background: rgba(242, 212, 120, 0.08);
}

blockquote p {
  margin: 0;
  color: inherit;
}

blockquote p + p {
  margin-top: 8px;
}

hr {
  height: 0;
  margin: 22px 0;
  border: 0;
  border-top: 2px dashed var(--line-soft);
  background: transparent;
}

/* —— 粉笔线表格 —— */

table {
  display: block;
  width: 100%;
  overflow-x: auto;
  margin: 16px 0 0;
  border: 2px dashed var(--line);
  border-radius: 10px;
  border-spacing: 0;
  border-collapse: separate;
  background: rgba(236, 242, 230, 0.03);
}

thead {
  background: rgba(236, 242, 230, 0.08);
}

th,
td {
  min-width: 150px;
  padding: 11px 14px;
  text-align: left;
  border-right: 1px dashed var(--line-soft);
  border-bottom: 1px dashed var(--line-soft);
}

th {
  color: var(--yellow);
  font-family: var(--font-hand);
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
  background: rgba(236, 242, 230, 0.03);
}

/* —— 粉笔框卡片 —— */

.mission-card,
.qa-block,
.quiz-card,
.summary,
.teachos-generated-quiz {
  border: 2px dashed var(--line);
  border-radius: 12px;
  background: rgba(236, 242, 230, 0.05);
}

.mission-card {
  padding: 20px 24px;
}

.mission-card span,
.file-grid span,
.steps span {
  display: block;
  color: var(--yellow);
  font-family: var(--font-hand);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 2px;
}

.steps span {
  color: var(--chalk-dim);
  letter-spacing: 0;
}

.mission-card strong {
  display: block;
  margin-top: 8px;
  color: var(--chalk);
  font-family: var(--font-hand);
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
  border-bottom: 1px dashed var(--line-soft);
  background: rgba(236, 242, 230, 0.04);
  font-size: 19px;
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

/* 粉色粉笔的提醒 */
.tip {
  margin-top: 16px;
  padding: 13px 17px;
  color: var(--pink);
  border: 1.5px dashed rgba(240, 174, 188, 0.6);
  border-radius: 10px;
  background: rgba(240, 174, 188, 0.08);
}

.tip strong {
  color: var(--pink);
}

.summary {
  padding: 24px;
  background: rgba(236, 242, 230, 0.06);
}

.summary h2 {
  padding-top: 0;
}

.summary blockquote {
  border-left-color: var(--green);
  background: rgba(168, 220, 176, 0.1);
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
  border: 1px dashed var(--line-soft);
  border-radius: 10px;
  background: rgba(236, 242, 230, 0.04);
}

.steps li {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 12px;
}

.steps strong {
  color: var(--chalk);
}

.file-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.file-grid a {
  display: block;
  padding: 16px;
  border: 1px dashed var(--line-soft);
  border-bottom: 1px dashed var(--line-soft);
  border-radius: 10px;
  background: rgba(236, 242, 230, 0.04);
}

.file-grid a:hover {
  border-color: var(--line);
  border-style: dashed;
}

.file-grid strong {
  display: block;
  margin-top: 6px;
  color: var(--chalk);
}

/* —— 测验 —— */

.practice,
.teachos-generated-quiz {
  margin-top: 30px;
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
  color: var(--chalk);
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
  border: 1.5px dashed var(--line);
  border-radius: 8px;
  font: inherit;
}

.quiz-card button {
  padding: 0 16px;
  color: var(--chalk);
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.quiz-card button:hover {
  background: rgba(236, 242, 230, 0.08);
}

.quiz-card button.is-selected,
.quiz-card .quiz-choices button.is-selected {
  border: 1.5px solid var(--blue);
  background: rgba(165, 216, 230, 0.12);
}

.quiz-card button.is-correct {
  border: 1.5px solid var(--green);
  background: rgba(168, 220, 176, 0.14);
}

.quiz-card button.is-wrong {
  border: 1.5px solid var(--pink);
  background: rgba(240, 174, 188, 0.12);
}

.quiz-card .quiz-fill input {
  flex: 1;
  width: 100%;
  padding: 0 12px;
  color: var(--chalk);
  border: 1.5px dashed var(--line);
  background: rgba(236, 242, 230, 0.06);
}

.quiz-card .quiz-fill input.is-correct {
  border: 1.5px solid var(--green);
  background: rgba(168, 220, 176, 0.14);
}

.quiz-card .quiz-fill input.is-wrong {
  border: 1.5px solid var(--pink);
  background: rgba(240, 174, 188, 0.12);
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
  color: var(--chalk-dim);
  font-size: 14px;
}

footer,
body > footer {
  margin-top: 44px;
  padding-top: 20px;
  border-top: 2px dashed var(--line-soft);
}

footer p {
  color: var(--chalk-dim);
}

/* —— 黑板闪卡（覆盖 flashcards.css）—— */

.flashcards .flashcard {
  border: 2px dashed var(--line);
  border-radius: 12px;
  background: var(--board-deep);
}

.flashcards .flashcard-front {
  color: var(--chalk);
  font-family: var(--font-hand);
  font-size: 17px;
}

.flashcards .flashcard-back {
  color: var(--chalk-dim);
  border-radius: 10px;
  background: #2c463c;
}

.flashcard .flashcard-self button {
  color: var(--chalk);
  border: 1.5px dashed var(--line);
  border-radius: 8px;
  background: transparent;
}

.flashcard .flashcard-self button:hover {
  background: rgba(236, 242, 230, 0.08);
}

@media (max-width: 700px) {
  body {
    padding-bottom: 36px;
    border-width: 6px;
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
    padding: 26px 20px 30px;
  }

  body > header h1,
  .lesson-hero h1 {
    font-size: 29px;
    text-underline-offset: 9px;
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
