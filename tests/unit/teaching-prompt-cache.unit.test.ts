import { describe, expect, it } from 'vitest'
import { buildSessionStablePrefix, composeTeachingUserTurn } from '../../src/main/teaching-conversation-prompt'

const base = {
  mode: 'teaching' as const,
  lessonToolEnabled: true,
  skillReferences: [{ id: 'teach', name: 'Teach', source: 'builtin', content: '# Teach\nFULL BODY' }]
}

describe('teaching prompt cache contract', () => {
  it('keeps the stable prefix byte-identical across turns', () => {
    const first = buildSessionStablePrefix(base)
    const second = buildSessionStablePrefix({ ...base, skillReferences: [...base.skillReferences] })
    expect(second).toBe(first)
    expect(first).toContain('FULL BODY')
  })

  it('ignores stage-specific bodies for prefix identity but invalidates on kernel content change', () => {
    const first = buildSessionStablePrefix({
      ...base,
      skillReferences: [
        ...base.skillReferences,
        { id: 'learning-assessor', name: 'Assessor', source: 'builtin', content: 'ASSESSOR V1' }
      ]
    })
    const nonKernelChanged = buildSessionStablePrefix({
      ...base,
      skillReferences: [
        ...base.skillReferences,
        { id: 'learning-assessor', name: 'Assessor', source: 'builtin', content: 'ASSESSOR V2' }
      ]
    })
    const kernelChanged = buildSessionStablePrefix({
      ...base,
      skillReferences: [{ ...base.skillReferences[0]!, content: '# Teach\nCHANGED KERNEL' }]
    })
    expect(nonKernelChanged).toBe(first)
    expect(kernelChanged).not.toBe(first)
    expect(kernelChanged).toContain('CHANGED KERNEL')
  })

  it('moves turn-varying context into the user turn packet', () => {
    const prefix = buildSessionStablePrefix(base)
    const turn = composeTeachingUserTurn({
      ...base,
      visiblePageContext: 'Visible page changes',
      memoryCapturePlan: { action: 'create', candidate: { content: 'Remember this' } } as any
    })
    expect(prefix).not.toContain('Visible page changes')
    expect(prefix).not.toContain('Remember this')
    expect(turn).toContain('<teaching-context-packet>')
    expect(turn).toContain('Visible page changes')
    expect(turn).not.toContain('FULL BODY')
    expect(turn).toContain('Remember this')
  })
})
