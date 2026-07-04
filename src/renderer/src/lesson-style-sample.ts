import {
  LESSON_FLASHCARD_CSS,
  LESSON_FLASHCARD_JS,
  LESSON_QUIZ_JS,
  lessonStyleCss,
  type LessonStyleId
} from '../../shared/lesson-styles'

/**
 * Builds a self-contained sample lesson page (inline styles + scripts, no
 * external assets) for the resources-page style gallery. The markup mirrors
 * what `lesson-renderer.ts` emits so the preview is representative of real
 * generated lessons, including interactive quiz cards and flashcards.
 */
export function buildLessonStyleSampleHtml(styleId: LessonStyleId): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>风格样例 · ${styleId}</title>
  <style>${lessonStyleCss(styleId)}</style>
  <style>${LESSON_FLASHCARD_CSS}</style>
</head>
<body>
  <main class="lesson-page">
    <header class="lesson-hero">
      <p class="kicker">Lesson demo-01 · 15 min</p>
      <h1>间隔重复：让记忆保持新鲜</h1>
      <p>理解遗忘曲线的规律，学会用间隔重复和主动回忆安排复习节奏，让学到的知识真正留下来。</p>
    </header>

    <section class="mission-card">
      <span>Mission</span>
      <strong>建立可持续的复习系统</strong>
      <p>把「学过」变成「记得」：为每节课沉淀复习卡片，并按遗忘曲线安排回顾时间。</p>
    </section>

    <section>
      <h2>为什么我们会遗忘</h2>
      <p>艾宾浩斯的实验表明，新知识在最初 24 小时内流失得最快。如果不做任何复习，一周后往往只剩下不到三成。真正有效的对策不是「多看几遍」，而是<strong>在快要忘记的时刻主动回想</strong>。</p>
      <blockquote>检索一次的效果，胜过重读十次——回忆本身就是在加固记忆。</blockquote>
      <ul class="compact-list">
        <li>重读只产生「熟悉感」，并不等于记住了。</li>
        <li>主动回忆迫使大脑重建线索，形成更强的连接。</li>
        <li>间隔越合理，单位时间的复习收益越高。</li>
      </ul>
    </section>

    <section>
      <h2>把知识变成卡片</h2>
      <p>一张好卡片只问一件事。把概念拆成「问题 → 答案」，例如用 <code>Q/A</code> 的形式记录 API 用法：</p>
      <pre><code>Q: setInterval 与 setTimeout 的核心区别？
A: setInterval 周期性触发；setTimeout 只触发一次。</code></pre>
      <table>
        <thead>
          <tr><th>复习轮次</th><th>距上次间隔</th><th>目标</th></tr>
        </thead>
        <tbody>
          <tr><td>第 1 次</td><td>1 天</td><td>能独立复述要点</td></tr>
          <tr><td>第 2 次</td><td>3 天</td><td>能举出自己的例子</td></tr>
          <tr><td>第 3 次</td><td>7 天</td><td>能应用到新问题</td></tr>
        </tbody>
      </table>
      <p class="tip"><strong>提示：</strong>卡片答错时不要沮丧——错误暴露的位置，正是间隔重复要优先照顾的地方。</p>
    </section>

    <section>
      <h2>要点</h2>
      <ul class="compact-list">
        <li>遗忘最快的窗口在学习后的第一天，第一次复习要尽早。</li>
        <li>复习时先回忆再核对答案，不要直接重读。</li>
        <li>把复习安排写进日程，系统比意志力可靠。</li>
      </ul>
    </section>

    <section class="flashcards">
      <h2>复习卡片</h2>
      <article class="flashcard" tabindex="0"><div class="flashcard-face flashcard-front"><span>主动回忆比重读更有效的原因是什么？</span></div><div class="flashcard-face flashcard-back"><span>回忆迫使大脑重建检索线索，重读只带来熟悉感。</span><div class="flashcard-self"><button type="button" data-rating="again">再次</button><button type="button" data-rating="good">良好</button><button type="button" data-rating="mastered">掌握</button></div></div></article>
      <article class="flashcard" tabindex="0"><div class="flashcard-face flashcard-front"><span>第一次复习应该安排在什么时候？</span></div><div class="flashcard-face flashcard-back"><span>学习后 24 小时内——这是遗忘最快的窗口。</span><div class="flashcard-self"><button type="button" data-rating="again">再次</button><button type="button" data-rating="good">良好</button><button type="button" data-rating="mastered">掌握</button></div></div></article>
    </section>

    <section class="practice">
      <h2>检索练习</h2>
      <article class="quiz-card" data-type="single" data-answer="b">
        <p>下列哪种做法最符合「主动回忆」？</p>
        <div class="quiz-choices">
          <button type="button" data-choice="a">把课件再从头读一遍</button>
          <button type="button" data-choice="b">合上笔记，先自己复述要点再核对</button>
          <button type="button" data-choice="c">用荧光笔把重点画出来</button>
        </div>
        <output aria-live="polite"></output>
        <p class="quiz-explanation">先回忆再核对，才会触发记忆的重建；重读和划线只是「熟悉感」。</p>
      </article>
      <article class="quiz-card" data-type="fill" data-answer="遗忘曲线">
        <p>描述记忆随时间衰减规律的曲线叫什么？</p>
        <div class="quiz-fill">
          <input type="text" placeholder="输入你的答案" aria-label="答案输入" />
          <button type="button" data-choice="submit">提交</button>
        </div>
        <output aria-live="polite"></output>
        <p class="quiz-explanation">艾宾浩斯遗忘曲线：不复习时，记忆在最初 24 小时内衰减最快。</p>
      </article>
    </section>

    <footer>
      <p>下一步：把不清楚的地方继续问教学助手，并把新的理解沉淀成 learning record。</p>
    </footer>
  </main>
  <script>${LESSON_QUIZ_JS}</script>
  <script>${LESSON_FLASHCARD_JS}</script>
</body>
</html>
`
}
