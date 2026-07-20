import { describe, expect, it } from 'vitest'
import { decideWorkspaceWrite, normalizeRelativePath } from '../../src/main/ai/tools/write-policy'

describe('workspace write policy', () => {
  it('denies absolute and escaping paths before any other rule', () => {
    expect(decideWorkspaceWrite({ path: '../secret.txt', approvalMode: 'full_access' })).toBe('deny')
    expect(decideWorkspaceWrite({ path: 'C:/secret.txt', approvalMode: 'full_access' })).toBe('deny')
    expect(normalizeRelativePath('notes/../lesson.md')).toBe('lesson.md')
  })
  it('gives deny globs priority over ask and allow', () => {
    expect(decideWorkspaceWrite({ path: 'secrets/token.txt', denyGlobs: ['secrets/**'], askGlobs: ['**/*.txt'], approvalMode: 'full_access' })).toBe('deny')
  })
  it('asks for explicit overwrite unless full access is granted', () => {
    expect(decideWorkspaceWrite({ path: 'lesson.md', overwrite: true, approvalMode: 'based_on_approval' })).toBe('ask')
    expect(decideWorkspaceWrite({ path: 'lesson.md', overwrite: true, approvalMode: 'request_approval' })).toBe('ask')
    expect(decideWorkspaceWrite({ path: 'lesson.md', overwrite: true, approvalMode: 'full_access' })).toBe('allow')
  })
  it('allows safe creates in risk-based mode and asks matching globs', () => {
    expect(decideWorkspaceWrite({ path: 'notes/new.md', approvalMode: 'based_on_approval' })).toBe('allow')
    expect(decideWorkspaceWrite({ path: 'notes/new.md', askGlobs: ['notes/**'], approvalMode: 'based_on_approval' })).toBe('ask')
    expect(decideWorkspaceWrite({ path: 'notes/new.md', approvalMode: 'request_approval' })).toBe('ask')
  })
})
