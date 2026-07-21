import { describe, expect, it } from 'vitest'
import {
  buildFutureBlocksDecisionSheetModel,
  normalizeFutureBlocksDecision
} from '../../src/shared/study-planning'

describe('future-blocks decision sheet model (STC-306 cutover)', () => {
  it('normalizes pure and wire aliases; rejects unknown (fail-closed)', () => {
    expect(normalizeFutureBlocksDecision('cancel_blocks')).toBe('cancel_blocks')
    expect(normalizeFutureBlocksDecision('cancel')).toBe('cancel_blocks')
    expect(normalizeFutureBlocksDecision('keep_as_review')).toBe('keep_as_review')
    expect(normalizeFutureBlocksDecision('keep_review')).toBe('keep_as_review')
    expect(normalizeFutureBlocksDecision('reassign')).toBe('reassign')
    expect(normalizeFutureBlocksDecision(null)).toBeNull()
    expect(normalizeFutureBlocksDecision(undefined)).toBeNull()
    expect(normalizeFutureBlocksDecision('')).toBeNull()
    expect(normalizeFutureBlocksDecision('delete_all')).toBeNull()
    expect(normalizeFutureBlocksDecision('yolo')).toBeNull()
  })

  it('builds sheet model with singular/plural copy and no silent cancel option order', () => {
    const one = buildFutureBlocksDecisionSheetModel({
      taskId: 't1',
      taskTitle: '线性代数',
      futureBlockIds: ['b1']
    })
    expect(one.futureBlockCount).toBe(1)
    expect(one.futureBlockIds).toEqual(['b1'])
    expect(one.options).toEqual(['cancel_blocks', 'keep_as_review', 'reassign'])
    expect(one.copy.description).toContain('1 个未来时间块')
    expect(one.copy.description).toContain('不会静默取消')

    const many = buildFutureBlocksDecisionSheetModel({
      taskId: 't1',
      taskTitle: '线性代数',
      futureBlockIds: ['b1', 'b2', 'b3']
    })
    expect(many.futureBlockCount).toBe(3)
    expect(many.copy.description).toContain('3 个未来时间块')
    expect(many.copy.cancelBlocksLabel).toBe('取消这些时间块')
    expect(many.copy.keepReviewLabel).toBe('保留作复习')
    expect(many.copy.reassignLabel).toBe('改派给其他任务')
    expect(many.copy.dismissLabel).toBe('稍后处理')
  })
})
