export type ReviewCard = {
  lessonId: string
  lessonTitle: string
  front: string
  back: string
}

export type ListReviewCardsResult = {
  cards: ReviewCard[]
}

export type QuizResultEntry = {
  lessonId: string
  question: string
  correct: boolean
}

export type RecordProgressPayload = {
  workspaceId: string
  lessonId: string
  results: QuizResultEntry[]
}

export type ProgressSummary = {
  totalAnswered: number
  correct: number
  byLesson: Record<string, { answered: number; correct: number }>
}

export type GetProgressResult = {
  workspaceId: string
  progress: ProgressSummary
}
