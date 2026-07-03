function setupTeachOsQuizCards(root = document) {
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
      const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[。.,，！!？?]/g, '');
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
  question.textContent = `${index + 1}. ${String(item.question ?? '请作答')}`;

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
  explanation.textContent = item.explanation ? String(item.explanation) : `参考答案：${String(item.answer ?? '')}`;

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
