/**
 * Future-blocks decision sheet model (STC-306 / freeze #7).
 * Pure presentation: cancel / keep as review / reassign — never silent bulk cancel.
 */

export type FutureBlocksDecisionChoice =
  | 'cancel_blocks'
  | 'keep_as_review'
  | 'reassign'

/** Wire aliases accepted from renderer client payloads. */
export type FutureBlocksDecisionWire =
  | FutureBlocksDecisionChoice
  | 'cancel'
  | 'keep_review'
  | 'reassign'

export type FutureBlocksDecisionSheetModel = {
  taskId: string
  taskTitle: string
  futureBlockCount: number
  futureBlockIds: string[]
  options: FutureBlocksDecisionChoice[]
  copy: {
    title: string
    description: string
    cancelBlocksLabel: string
    keepReviewLabel: string
    reassignLabel: string
    dismissLabel: string
  }
}

/**
 * Map client/wire aliases onto pure FutureBlocksDecisionChoice.
 * Unknown values → null (fail-closed; do not invent cancel).
 */
export function normalizeFutureBlocksDecision(
  raw: string | null | undefined
): FutureBlocksDecisionChoice | null {
  if (raw == null || raw === '') return null
  if (raw === 'cancel' || raw === 'cancel_blocks') return 'cancel_blocks'
  if (raw === 'keep_review' || raw === 'keep_as_review') return 'keep_as_review'
  if (raw === 'reassign') return 'reassign'
  return null
}

export function buildFutureBlocksDecisionSheetModel(input: {
  taskId: string
  taskTitle: string
  futureBlockIds: readonly string[]
}): FutureBlocksDecisionSheetModel {
  const count = input.futureBlockIds.length
  return {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    futureBlockCount: count,
    futureBlockIds: [...input.futureBlockIds],
    options: ['cancel_blocks', 'keep_as_review', 'reassign'],
    copy: {
      title: '任务已完成 — 处理未来时间块',
      description:
        count === 1
          ? `「${input.taskTitle}」还有 1 个未来时间块。请选择如何处理（不会静默取消）。`
          : `「${input.taskTitle}」还有 ${count} 个未来时间块。请选择如何处理（不会静默取消）。`,
      cancelBlocksLabel: '取消这些时间块',
      keepReviewLabel: '保留作复习',
      reassignLabel: '改派给其他任务',
      dismissLabel: '稍后处理'
    }
  }
}
