export type ReviewCardProvenance = {
  /** Workspace-relative durable flashcard artifact path. */
  artifactPath: string
  /** Zero-based card position in the durable artifact. */
  artifactCardIndex: number
  /** Optional durable card id supplied by a newer artifact writer. */
  artifactCardId?: string
}

export type ReviewCard = {
  /** Stable identity derived from the durable artifact and card content. */
  id: string
  lessonId: string
  lessonTitle: string
  front: string
  back: string
  provenance: ReviewCardProvenance
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
