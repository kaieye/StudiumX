import type {
  LearnerResponseKind,
  PreviewLessonInteractionIntent
} from './lesson-interaction'

type Assert<Condition extends true> = Condition
type PreviewResponseIntent = Extract<
  PreviewLessonInteractionIntent,
  { kind: 'retrieval_response_submitted' | 'learner_response_recorded' }
>

// This file is included by the production tsconfig's src/shared/**/*.ts glob.
// It emits no runtime code, but fails `pnpm run typecheck` if preview response
// intents ever make responseKind optional.
export type PreviewResponseIntentsRequireResponseKind = Assert<
  PreviewResponseIntent extends { responseKind: LearnerResponseKind } ? true : false
>
