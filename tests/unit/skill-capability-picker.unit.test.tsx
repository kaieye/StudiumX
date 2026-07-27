import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSkillCapabilityPicker } from '../../src/renderer/src/skills/SkillCapabilityPicker'
import type { TeachingSystemApi } from '../../src/shared/teaching-types'
import type { SkillOrchestrationPreviewResult } from '../../src/shared/teaching-types/skill-orchestration'
import { renderUi, screen, setupUser, waitFor } from '../helpers/render'

const catalog = vi.hoisted(() => ({
  skills: [
    {
      id: 'teach', name: 'Teach', description: 'Kernel', category: 'teaching', icon: 'book',
      author: 'StudiumX', command: '/teach', source: 'builtin' as const, installed: true
    },
    {
      id: 'learning-assessor', name: 'Learning Assessor', description: 'Assess learner evidence', category: 'teaching', icon: 'check',
      author: 'StudiumX', command: '/learning-assessor', source: 'builtin' as const, installed: true
    },
    {
      id: 'teaching-resource-generator', name: 'Resource Generator', description: 'Generate aligned practice', category: 'teaching', icon: 'file',
      author: 'StudiumX', command: '/teaching-resource-generator', source: 'builtin' as const, installed: true
    },
    {
      id: 'course-ebook-publishing', name: 'Ebook Publishing', description: 'Package a stable course', category: 'teaching', icon: 'book',
      author: 'StudiumX', command: '/course-ebook-publishing', source: 'builtin' as const, installed: true
    }
  ]
}))

vi.mock('../../src/renderer/src/skills/skillCatalog', () => ({
  useSkillCatalog: () => ({
    catalog: { rootPath: '', skills: catalog.skills },
    loading: false,
    error: null,
    refresh: vi.fn()
  })
}))

const originalTeachingSystem = window.teachingSystem

function installTeachingSystem(api: Partial<TeachingSystemApi>): void {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: api as TeachingSystemApi
  })
}

function PickerHarness() {
  const picker = useSkillCapabilityPicker({
    isTeachingMode: true,
    userInput: 'Help me learn fractions',
    conversationId: 'conversation-1',
    workspaceId: 'workspace-1'
  })
  return (
    <>
      <output data-testid="selected-skill-ids">{picker.selectedSkillIds.join(',')}</output>
      {picker.panel}
      {picker.chips}
      {picker.toggle}
    </>
  )
}

function previewResult(): SkillOrchestrationPreviewResult {
  return {
    ok: true,
    autoAddedSkillIds: ['teaching-resource-generator'],
    plan: {
      schemaVersion: 1,
      planId: 'plan-1',
      mode: 'teaching_turn',
      objective: 'Help me learn fractions',
      contextIdentity: 'workspace-1',
      kernel: { skillId: 'teach', profile: 'interactive' },
      stages: [],
      decisions: [
        { skillId: 'learning-assessor', status: 'active_now', reason: '先诊断当前理解。' },
        { skillId: 'teaching-resource-generator', status: 'scheduled_later', reason: '诊断后再生成练习。' },
        { skillId: 'course-ebook-publishing', status: 'blocked', reason: '缺少稳定课程产物。' },
        { skillId: 'unselected-capability', status: 'excluded', reason: '本轮未选择。' }
      ],
      diagnostics: []
    }
  }
}

afterEach(() => {
  Object.defineProperty(window, 'teachingSystem', {
    configurable: true,
    writable: true,
    value: originalTeachingSystem
  })
})

describe('SkillCapabilityPicker', () => {
  it('keeps a manual selection when the matching preset is applied', async () => {
    const user = setupUser()
    renderUi(<PickerHarness />)

    await user.click(screen.getByRole('button', { name: '选择教学能力' }))
    await user.click(screen.getByRole('checkbox', { name: /Learning Assessor/ }))
    expect(screen.getByTestId('selected-skill-ids')).toHaveTextContent('learning-assessor')

    await user.click(screen.getByRole('button', { name: /测测我学会没有/ }))
    expect(screen.getByTestId('selected-skill-ids')).toHaveTextContent('learning-assessor')
  })

  it('connects the dialog to its trigger and restores focus after Escape', async () => {
    const user = setupUser()
    renderUi(<PickerHarness />)

    const trigger = screen.getByRole('button', { name: '选择教学能力' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '选择本次可以使用的能力' })
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByRole('button', { name: '关闭能力选择' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('explains each planner decision and marks auto-added dependencies', async () => {
    const previewSkillOrchestration = vi.fn(async () => previewResult())
    installTeachingSystem({ previewSkillOrchestration })
    const user = setupUser()
    renderUi(<PickerHarness />)

    await user.click(screen.getByRole('button', { name: '选择教学能力' }))
    expect(await screen.findByText('本轮计划')).toBeInTheDocument()

    expect(screen.getByText('现在')).toBeInTheDocument()
    expect(screen.getByText('稍后')).toBeInTheDocument()
    expect(screen.getByText('已阻止')).toBeInTheDocument()
    expect(screen.getByText('未启用')).toBeInTheDocument()
    expect(screen.getByText('先诊断当前理解。')).toBeInTheDocument()
    expect(screen.getByText('缺少稳定课程产物。')).toBeInTheDocument()
    expect(screen.getByText('自动加入的前置能力')).toBeInTheDocument()
    await waitFor(() => expect(previewSkillOrchestration).toHaveBeenCalledTimes(1))
  })
})
