import {
  LESSON_INTERACTION_SOURCE,
  LESSON_MARKUP_CLASSES,
  LESSON_MARKUP_DATA_ATTRIBUTES,
  LESSON_MARKUP_DATASET_KEYS,
  LESSON_MARKUP_SELECTORS
} from './contract'

export const LESSON_QUIZ_JS = `var teachOsLessonQuizContract = ${JSON.stringify({
  classes: {
    practice: LESSON_MARKUP_CLASSES.practice,
    generatedQuiz: LESSON_MARKUP_CLASSES.generatedQuiz,
    quizCard: LESSON_MARKUP_CLASSES.quizCard,
    quizFill: LESSON_MARKUP_CLASSES.quizFill,
    quizExplanation: LESSON_MARKUP_CLASSES.quizExplanation,
    isSelected: LESSON_MARKUP_CLASSES.isSelected,
    isCorrect: LESSON_MARKUP_CLASSES.isCorrect,
    isWrong: LESSON_MARKUP_CLASSES.isWrong
  },
  dataAttributes: {
    quizChoice: LESSON_MARKUP_DATA_ATTRIBUTES.quizChoice
  },
  datasetKeys: {
    quizType: LESSON_MARKUP_DATASET_KEYS.quizType,
    quizAnswer: LESSON_MARKUP_DATASET_KEYS.quizAnswer,
    quizChoice: LESSON_MARKUP_DATASET_KEYS.quizChoice,
    quizReady: LESSON_MARKUP_DATASET_KEYS.quizReady
  },
  selectors: {
    quizCard: LESSON_MARKUP_SELECTORS.quizCard,
    quizChoiceButton: LESSON_MARKUP_SELECTORS.quizChoiceButton,
    selectedQuizChoiceButton: LESSON_MARKUP_SELECTORS.selectedQuizChoiceButton,
    quizTextInput: LESSON_MARKUP_SELECTORS.quizTextInput,
    quizExplanation: LESSON_MARKUP_SELECTORS.quizExplanation
  },
  source: LESSON_INTERACTION_SOURCE
})};

function setupTeachOsQuizCards(root = document) {
  const contract = teachOsLessonQuizContract;
  root.querySelectorAll(contract.selectors.quizCard).forEach((card) => {
    if (card.dataset[contract.datasetKeys.quizReady] === 'true') return;
    card.dataset[contract.datasetKeys.quizReady] = 'true';

    const type = card.dataset[contract.datasetKeys.quizType] || 'single';
    const answer = card.dataset[contract.datasetKeys.quizAnswer] || '';
    const output = card.querySelector('output');
    const explanation = card.querySelector(contract.selectors.quizExplanation);
    const report = (correct, msg) => {
      if (output) output.textContent = msg;
      if (explanation) explanation.style.display = correct ? 'block' : 'none';
      try {
        window.parent.postMessage({
          source: contract.source,
          kind: 'quiz',
          question: card.querySelector('p')?.textContent || '',
          correct
        }, '*');
      } catch {}
    };

    if (type === 'fill') {
      const input = card.querySelector(contract.selectors.quizTextInput);
      const submit = card.querySelector(\`button[\${contract.dataAttributes.quizChoice}="submit"]\`);
      const normalize = (s) => s.trim().toLowerCase().replace(/\\s+/g, ' ').replace(/[。.,，！!？?]/g, '');
      const check = () => {
        const value = input?.value || '';
        const isCorrect = Boolean(value.trim()) && normalize(value) === normalize(answer);
        if (input) {
          input.classList.toggle(contract.classes.isCorrect, isCorrect);
          input.classList.toggle(contract.classes.isWrong, !isCorrect && value.trim().length > 0);
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
    card.querySelectorAll(contract.selectors.quizChoiceButton).forEach((button) => {
      button.addEventListener('click', () => {
        if (type === 'multi') {
          button.classList.toggle(contract.classes.isSelected);
          const selected = Array.from(card.querySelectorAll(contract.selectors.selectedQuizChoiceButton))
            .map((b) => b.dataset[contract.datasetKeys.quizChoice]);
          const isCorrect = selected.length === answers.length &&
            selected.every((c) => answers.includes(c)) &&
            answers.every((c) => selected.includes(c));
          report(isCorrect, isCorrect ? '全部正确！' : '选择还不完整或不正确，再看看。');
        } else {
          card.querySelectorAll(contract.selectors.quizChoiceButton).forEach((item) => item.classList.remove(contract.classes.isCorrect, contract.classes.isWrong));
          const isCorrect = button.dataset[contract.datasetKeys.quizChoice] === answer;
          button.classList.add(isCorrect ? contract.classes.isCorrect : contract.classes.isWrong);
          report(isCorrect, isCorrect ? '正确！' : '再试一次。');
        }
      });
    });
  });
}

function appendFillQuizCard(container, item, index) {
  const contract = teachOsLessonQuizContract;
  const card = document.createElement('article');
  card.className = contract.classes.quizCard;
  card.dataset[contract.datasetKeys.quizType] = 'fill';
  card.dataset[contract.datasetKeys.quizAnswer] = String(item.answer ?? '');

  const question = document.createElement('p');
  question.textContent = \`\${index + 1}. \${String(item.question ?? '请作答')}\`;

  const fill = document.createElement('div');
  fill.className = contract.classes.quizFill;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '输入你的答案';
  input.setAttribute('aria-label', '答案输入');

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset[contract.datasetKeys.quizChoice] = 'submit';
  button.textContent = '提交';

  const output = document.createElement('output');
  output.setAttribute('aria-live', 'polite');

  const explanation = document.createElement('p');
  explanation.className = contract.classes.quizExplanation;
  explanation.textContent = item.explanation ? String(item.explanation) : \`参考答案：\${String(item.answer ?? '')}\`;

  fill.append(input, button);
  card.append(question, fill, output, explanation);
  container.append(card);
}

window.Quiz = class Quiz {
  constructor(items = [], options = {}) {
    const mount = typeof options.mount === 'string' ? document.querySelector(options.mount) : options.mount;
    const section = mount || document.createElement('section');
    section.classList.add(teachOsLessonQuizContract.classes.practice, teachOsLessonQuizContract.classes.generatedQuiz);

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

export const LESSON_FLASHCARD_JS = `var teachOsLessonFlashcardContract = ${JSON.stringify({
  classes: {
    isFlipped: LESSON_MARKUP_CLASSES.isFlipped
  },
  dataAttributes: {
    flashcardRating: LESSON_MARKUP_DATA_ATTRIBUTES.flashcardRating
  },
  selectors: {
    flashcard: LESSON_MARKUP_SELECTORS.flashcard,
    flashcardSelfButton: LESSON_MARKUP_SELECTORS.flashcardSelfButton
  },
  source: LESSON_INTERACTION_SOURCE
})};

document.querySelectorAll(teachOsLessonFlashcardContract.selectors.flashcard).forEach((card) => {
  const contract = teachOsLessonFlashcardContract;
  const flip = () => card.classList.toggle(contract.classes.isFlipped);
  card.addEventListener('click', flip);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  card.querySelectorAll(contract.selectors.flashcardSelfButton).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      try { window.parent.postMessage({ source: contract.source, kind: 'flashcard', rating: btn.getAttribute(contract.dataAttributes.flashcardRating) }, '*'); } catch {}
    });
  });
});
`
