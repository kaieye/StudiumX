/**
 * Closed learner-facing projection of canonical teaching-loop state.
 *
 * This DTO intentionally carries no filesystem location, evaluator reason,
 * evidence payload, provider context, or credential material. It is a read-only
 * product projection; the ledger and TeachingTurnCoordinator/host remain the
 * teaching authority and settlement sole-writer.
 */
export const TEACHING_PRESENTATION_SCHEMA_VERSION = 1 as const

export type TeachingPresentationNextStep =
  | Readonly<{
      action: 'contrast_and_retry'
      label: '对照后再试一次'
      description: '先比较关键差异，再用新的提示重试。'
    }>
  | Readonly<{
      /** ADR-0003 canonical due-review recommendation; no item payload crosses IPC. */
      action: 'review_due'
      label: '开始复习'
      description: '先完成一项到期复习，再继续新的学习内容。'
    }>

export type TeachingPresentationSnapshot = Readonly<{
  schemaVersion: typeof TEACHING_PRESENTATION_SCHEMA_VERSION
  /** Opaque host-issued identity for the canonical projection. */
  operationId: string
  /** Canonical session revision used for optimistic action concurrency. */
  revision: number
  nextStep: TeachingPresentationNextStep | null
}>

export type TeachingPresentationActionPayload = Readonly<{
  operationId: string
  expectedRevision: number
  action: TeachingPresentationNextStep['action']
}>

export type TeachingPresentationActionResult =
  | Readonly<{ status: 'accepted'; snapshot: TeachingPresentationSnapshot }>
  | Readonly<{ status: 'stale' | 'unavailable' | 'rejected'; snapshot: TeachingPresentationSnapshot | null }>
