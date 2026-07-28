import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSkillCapabilityPicker } from '../../src/renderer/src/skills/SkillCapabilityPicker'
import { useSkillSlashInput } from '../../src/renderer/src/skills/SkillSlashMenu'
import type { TeachingSystemApi } from '../../src/shared/teaching-types'
import type { SkillOrchestrationPreviewResult } from '../../src/shared/teaching-types/skill-orchestration'
import { renderUi, screen, setupUser, waitFor } from '../helpers/render'

const catalog = vi.hoisted(() => {
  const governed = (
    slot: 'kernel' | 'primary_teaching_strategy' | 'artifact',
    allowedModes = ['teaching_turn', 'instant_help'] as const
  ) => ({
    allowedModes,
    slot,
    trustLevel: 'host_governed' as const,
    selectionSurface: 'default' as const,
    formalTeachingEligible: slot !== 'kernel',
    reason: 'Host-governed builtin capability.'
  })
  const personalOnly = {
    allowedModes: [],
    slot: 'artifact' as const,
    trustLevel: 'advisory_only' as const,
    selectionSurface: 'advanced' as const,
    formalTeachingEligible: false,
    reason: 'Personal files do not participate in the formal teaching chain.'
  }
  return {
    skills: [
      {
        id: 'teach', name: 'Teach', description: 'Kernel', category: 'teaching', icon: 'book',
        author: 'StudiumX', command: '/teach', source: 'builtin' as const, installed: true, orchestration: governed('kernel')
      },
      {
        id: 'learning-assessor', name: 'Learning Assessor', description: 'Assess learner evidence', category: 'teaching', icon: 'check',
        author: 'StudiumX', command: '/learning-assessor', source: 'builtin' as const, installed: true, orchestration: governed('primary_teaching_strategy')
      },
      {
        id: 'teaching-resource-generator', name: 'Resource Generator', description: 'Generate aligned practice', category: 'teaching', icon: 'file',
        author: 'StudiumX', command: '/teaching-resource-generator', source: 'builtin' as const, installed: true, orchestration: governed('artifact', ['artifact_workflow'] as const)
      },
      {
        id: 'course-ebook-publishing', name: 'Ebook Publishing', description: 'Package a stable course', category: 'teaching', icon: 'book',
        author: 'StudiumX', command: '/course-ebook-publishing', source: 'builtin' as const, installed: true, orchestration: governed('artifact', ['artifact_workflow'] as const)
      },
      {
        id: 'personal-study-style', name: 'Personal Study Style', description: 'Personal file', category: 'learning', icon: 'sparkles',
        author: 'You', command: '/personal-study-style', source: 'personal' as const, installed: true, orchestration: personalOnly
      }
    ]
  }
})

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

function SlashHarness() {
  const [value, setValue] = useState('/')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const slash = useSkillSlashInput({
    value,
    onChange: setValue,
    inputRef,
    mode: 'teaching_turn'
  })
  return (
    <>
      {slash.menu}
      <textarea ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} />
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

    await user.click(screen.getByRole('button', { name: '教学意图与能力设置' }))
    await user.click(screen.getByRole('button', { name: '高级能力设置' }))
    await user.click(screen.getByRole('checkbox', { name: /Learning Assessor/ }))
    expect(screen.getByTestId('selected-skill-ids')).toHaveTextContent('learning-assessor')

    await user.click(screen.getByRole('button', { name: /测测我学会没有/ }))
    expect(screen.getByTestId('selected-skill-ids')).toHaveTextContent('learning-assessor')
  })

  it('connects the dialog to its trigger and restores focus after Escape', async () => {
    const user = setupUser()
    renderUi(<PickerHarness />)

    const trigger = screen.getByRole('button', { name: '教学意图与能力设置' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '教学意图与能力设置' })
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.getByRole('button', { name: '关闭教学能力设置' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps personal or unregistered capabilities out of the formal picker and explains their limit only in advanced settings', async () => {
    const user = setupUser()
    renderUi(<PickerHarness />)

    await user.click(screen.getByRole('button', { name: '教学意图与能力设置' }))
    expect(screen.queryByRole('checkbox', { name: /Learning Assessor/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Personal Study Style')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '高级能力设置' }))
    expect(screen.getByRole('checkbox', { name: /Learning Assessor/ })).toBeInTheDocument()
    expect(screen.getByText('Personal Study Style')).toBeInTheDocument()
    expect(screen.getByText('Personal files do not participate in the formal teaching chain.')).toBeInTheDocument()
    expect(screen.getByText('不参与正式教学链路')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Personal Study Style/ })).not.toBeInTheDocument()
  })

  it('does not offer artifact-only raw capabilities in a teaching-turn composer', async () => {
    const user = setupUser()
    renderUi(<PickerHarness />)

    await user.click(screen.getByRole('button', { name: '教学意图与能力设置' }))
    await user.click(screen.getByRole('button', { name: '高级能力设置' }))

    expect(screen.getByRole('checkbox', { name: /Learning Assessor/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Resource Generator/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Ebook Publishing/ })).not.toBeInTheDocument()
  })

  it('does not suggest artifact-only raw slash capabilities in a teaching-turn composer', () => {
    renderUi(<SlashHarness />)

    expect(screen.getByText('/learning-assessor')).toBeInTheDocument()
    expect(screen.queryByText('/teaching-resource-generator')).not.toBeInTheDocument()
    expect(screen.queryByText('/course-ebook-publishing')).not.toBeInTheDocument()
  })

  it('explains each planner decision and marks auto-added dependencies', async () => {
    const previewSkillOrchestration = vi.fn(async () => previewResult())
    installTeachingSystem({ previewSkillOrchestration })
    const user = setupUser()
    renderUi(<PickerHarness />)

    await user.click(screen.getByRole('button', { name: '教学意图与能力设置' }))
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
