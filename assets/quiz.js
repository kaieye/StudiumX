document.querySelectorAll('.quiz-card').forEach((card) => {
  const type = card.getAttribute('data-type') || 'single';
  const answer = card.getAttribute('data-answer') || '';
  const output = card.querySelector('output');
  const explanation = card.querySelector('.quiz-explanation');
  const report = (correct, msg) => {
    if (output) output.textContent = msg;
    if (explanation) explanation.style.display = correct ? 'block' : 'none';
    // Notify the TeachOS host so progress can be recorded.
    try { window.parent.postMessage({ source: 'teachos-lesson', kind: 'quiz', question: card.querySelector('p')?.textContent || '', correct }, '*'); } catch {}
  };

  if (type === 'fill') {
    const input = card.querySelector('input[type="text"]');
    const submit = card.querySelector('button[data-choice="submit"]');
    const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[。.,，！!？?]/g, '');
    const check = () => {
      const value = input?.value || '';
      const isCorrect = Boolean(value.trim()) && normalize(value) === normalize(answer);
      if (input) input.classList.toggle('is-correct', isCorrect), input.classList.toggle('is-wrong', !isCorrect && value.trim().length > 0);
      report(isCorrect, isCorrect ? '正确！' : '再想想，或查看解析。');
    };
    submit?.addEventListener('click', check);
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    return;
  }

  const answers = type === 'multi' ? answer.split(',').map((s) => s.trim()) : [answer];
  card.querySelectorAll('button[data-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      if (type === 'multi') {
        button.classList.toggle('is-selected');
        const selected = Array.from(card.querySelectorAll('button[data-choice].is-selected')).map((b) => b.getAttribute('data-choice'));
        const isCorrect = selected.length === answers.length && selected.every((c) => answers.includes(c)) && answers.every((c) => selected.includes(c));
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
