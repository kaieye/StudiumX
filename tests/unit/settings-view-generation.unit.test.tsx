import { render, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'
import i18n from '../../src/renderer/src/i18n'
import { SettingsView } from '../../src/renderer/src/views/settings/SettingsView'

const workspaceRoot = '/teaching/workspace'

function renderGenerationSettings() {
  return render(
    <SettingsView
      section="generation"
      settings={createTeachingSettingsDefaults(workspaceRoot)}
      activeWorkspace={null}
      onClose={() => {}}
      onSectionChange={() => {}}
      onUpdateSettings={async () => {}}
      onPickDefaultRoot={async () => {}}
      onCreateWorkspace={async () => {}}
      onImportWorkspace={async () => false}
      onOpenPath={async () => {}}
      onOpenExternal={async () => {}}
      onTestNotification={async () => {}}
      onProbeProvider={async () => ({ ok: true, latencyMs: 0, modelIds: [] })}
      onListUpstreamModels={async () => ({ ok: true, modelIds: [] })}
      onListGitWorktrees={async () => ({
        ok: true,
        repositoryRoot: workspaceRoot,
        primaryWorktreePath: workspaceRoot,
        worktreeRoot: `${workspaceRoot}/.worktrees`,
        worktrees: []
      })}
      onRemoveGitWorktree={async () => {}}
      memoryRecords={[]}
      memoryDiagnostics={null}
      onListMemory={async () => {}}
      onCreateMemory={async () => true}
      onUpdateMemory={async () => true}
      onDeleteMemory={async () => {}}
      onLoadMemoryDiagnostics={async () => {}}
      onOpenLogFile={async () => {}}
      onOpenAppDataDir={async () => {}}
    />
  )
}

describe('Generation settings', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('renders a title-only settings header', async () => {
    await i18n.changeLanguage('zh-CN')
    const { container } = renderGenerationSettings()
    const heading = container.querySelector('.settings-panel-heading')!

    expect(within(heading).getByRole('heading', { name: '生成' })).toBeInTheDocument()
    expect(heading.querySelector('p')).toBeNull()
    expect(within(container.querySelector('.settings-content')!).queryByText('配置后续 lesson 文件及伴随产物的教学内容。')).toBeNull()
  })

  it('keeps model runtime parameters out of the generation section', async () => {
    await i18n.changeLanguage('en-US')
    const { container } = renderGenerationSettings()
    const content = within(container.querySelector('.settings-content')!)

    expect(content.getByRole('heading', { name: 'Generation' })).toBeInTheDocument()
    expect(content.getByText('Lesson duration')).toBeInTheDocument()
    expect(content.getByText('Retrieval practice')).toBeInTheDocument()
    expect(content.queryByText('Generation provider')).not.toBeInTheDocument()
    expect(content.queryByText('Model')).not.toBeInTheDocument()
    expect(content.queryByText('Reasoning effort')).not.toBeInTheDocument()
    expect(content.queryByText('Temperature')).not.toBeInTheDocument()
    expect(content.queryByText('Max output tokens')).not.toBeInTheDocument()
    expect(content.queryByText('Request timeout')).not.toBeInTheDocument()
  })
})
