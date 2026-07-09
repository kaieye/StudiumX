const selectorFor = (className: string): string => `.${className}`

export const LESSON_MARKUP_CLASSES = {
  page: 'lesson-page',
  hero: 'lesson-hero',
  heroKicker: 'kicker',
  missionCard: 'mission-card',
  compactList: 'compact-list',
  tip: 'tip',
  practice: 'practice',
  generatedQuiz: 'studiumx-generated-quiz',
  quizCard: 'quiz-card',
  quizChoices: 'quiz-choices',
  quizFill: 'quiz-fill',
  quizExplanation: 'quiz-explanation',
  flashcards: 'flashcards',
  flashcard: 'flashcard',
  flashcardFace: 'flashcard-face',
  flashcardFront: 'flashcard-front',
  flashcardBack: 'flashcard-back',
  flashcardSelf: 'flashcard-self',
  isSelected: 'is-selected',
  isCorrect: 'is-correct',
  isWrong: 'is-wrong',
  isFlipped: 'is-flipped'
} as const

export const LESSON_MARKUP_DATA_ATTRIBUTES = {
  quizType: 'data-type',
  quizAnswer: 'data-answer',
  quizChoice: 'data-choice',
  flashcardRating: 'data-rating',
  quizReady: 'data-quiz-ready'
} as const

export const LESSON_MARKUP_DATASET_KEYS = {
  quizType: 'type',
  quizAnswer: 'answer',
  quizChoice: 'choice',
  flashcardRating: 'rating',
  quizReady: 'quizReady'
} as const

export const LESSON_MARKUP_SELECTORS = {
  page: selectorFor(LESSON_MARKUP_CLASSES.page),
  hero: selectorFor(LESSON_MARKUP_CLASSES.hero),
  missionCard: selectorFor(LESSON_MARKUP_CLASSES.missionCard),
  practice: selectorFor(LESSON_MARKUP_CLASSES.practice),
  generatedQuiz: selectorFor(LESSON_MARKUP_CLASSES.generatedQuiz),
  quizCard: selectorFor(LESSON_MARKUP_CLASSES.quizCard),
  quizChoices: selectorFor(LESSON_MARKUP_CLASSES.quizChoices),
  quizChoiceButton: `button[${LESSON_MARKUP_DATA_ATTRIBUTES.quizChoice}]`,
  selectedQuizChoiceButton: `button[${LESSON_MARKUP_DATA_ATTRIBUTES.quizChoice}].${LESSON_MARKUP_CLASSES.isSelected}`,
  quizFill: selectorFor(LESSON_MARKUP_CLASSES.quizFill),
  quizTextInput: 'input[type="text"]',
  quizExplanation: selectorFor(LESSON_MARKUP_CLASSES.quizExplanation),
  flashcards: selectorFor(LESSON_MARKUP_CLASSES.flashcards),
  flashcard: selectorFor(LESSON_MARKUP_CLASSES.flashcard),
  flashcardFront: selectorFor(LESSON_MARKUP_CLASSES.flashcardFront),
  flashcardBack: selectorFor(LESSON_MARKUP_CLASSES.flashcardBack),
  flashcardSelf: selectorFor(LESSON_MARKUP_CLASSES.flashcardSelf),
  flashcardSelfButton: `${selectorFor(LESSON_MARKUP_CLASSES.flashcardSelf)} button`
} as const

export const LESSON_INTERACTION_SOURCE = 'studiumx-lesson'
