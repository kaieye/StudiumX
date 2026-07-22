/**
 * Pure model tests for classification prompt sheet (STC-406/407).
 */
import { describe, expect, it } from 'vitest'
import {
  buildClassificationPromptSheetModel,
  normalizeClassificationPromptAction,
  resolveClassificationCategoryId
} from '../../src/shared/study-planning'

describe('classification prompt sheet model (STC-406/407)', () => {
  it('normalizes actions; rejects unknown (fail-closed)', () => {
    expect(normalizeClassificationPromptAction('classify')).toBe('classify')
    expect(normalizeClassificationPromptAction('keep_inbox')).toBe('keep_inbox')
    expect(normalizeClassificationPromptAction('keep')).toBe('keep_inbox')
    expect(normalizeClassificationPromptAction('later')).toBe('later')
    expect(normalizeClassificationPromptAction('dismiss')).toBe('later')
    expect(normalizeClassificationPromptAction('never_prompt')).toBe('never_prompt')
    expect(normalizeClassificationPromptAction('never')).toBe('never_prompt')
    expect(normalizeClassificationPromptAction(null)).toBeNull()
    expect(normalizeClassificationPromptAction(undefined)).toBeNull()
    expect(normalizeClassificationPromptAction('')).toBeNull()
    expect(normalizeClassificationPromptAction('yolo')).toBeNull()
  })

  it('builds copy that never implies rollback on dismiss', () => {
    const model = buildClassificationPromptSheetModel({
      taskId: 't1',
      taskTitle: '线性代数',
      categories: [
        { id: 'study', name: '学习', color: '#8197aa' },
        { id: 'exercise', name: '锻炼' }
      ]
    })
    expect(model.taskTitle).toBe('线性代数')
    expect(model.categories).toHaveLength(2)
    expect(model.options).toEqual(['classify', 'keep_inbox', 'later', 'never_prompt'])
    expect(model.copy.description).toContain('关闭不会撤销完成')
    expect(model.copy.classifyLabel).toBe('选择类别')
    expect(model.copy.keepInboxLabel).toBe('保持待归类')
    expect(model.copy.laterLabel).toBe('稍后')
    expect(model.copy.neverPromptLabel).toBe('不再提示')
  })

  it('falls back empty title and filters empty category ids', () => {
    const model = buildClassificationPromptSheetModel({
      taskId: 't2',
      taskTitle: '  ',
      categories: [
        { id: '', name: 'x' },
        { id: 'study', name: '  ' }
      ]
    })
    expect(model.taskTitle).toBe('未命名任务')
    expect(model.categories).toEqual([{ id: 'study', name: 'study' }])
  })

  it('resolveClassificationCategoryId never invents first category', () => {
    const cats = [
      { id: 'study', name: '学习' },
      { id: 'exercise', name: '锻炼' }
    ]
    expect(resolveClassificationCategoryId(cats, null)).toBeNull()
    expect(resolveClassificationCategoryId(cats, '')).toBeNull()
    expect(resolveClassificationCategoryId(cats, 'missing')).toBeNull()
    expect(resolveClassificationCategoryId(cats, 'exercise')).toBe('exercise')
  })
})
