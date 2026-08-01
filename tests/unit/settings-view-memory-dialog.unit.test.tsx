import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'
import type { TeachingMemoryDiagnostics } from '../../src/shared/teaching-types'
import i18n from '../../src/renderer/src/i18n'
import { SettingsView } from '../../src/renderer/src/views/settings/SettingsView'

const workspaceRoot = '/teaching/workspace'

function renderMemorySettings(memoryDiagnostics: TeachingMemoryDiagnostics | null = null) {
  return render(
    <SettingsView
      section="memory"
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
      memoryDiagnostics={memoryDiagnostics}
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

describe('Memory settings dialog', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('presents a clearly labelled, guided form when creating a memory', async () => {
    await i18n.changeLanguage('zh-CN')
    const user = userEvent.setup()
    renderMemorySettings()

    await user.click(screen.getByRole('button', { name: '新建记忆' }))

    const dialog = screen.getByRole('dialog', { name: '新建记忆' })
    expect(dialog).toHaveTextContent('记录未来生成课程时值得保留的偏好、事实或约束。')
    expect(screen.getByRole('textbox', { name: '记忆内容' })).toBeInTheDocument()
    expect(screen.getByText('适用范围')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '标签' })).toBeInTheDocument()
    const confidence = screen.getByRole('slider', { name: '置信度' })
    expect(confidence).toHaveValue('1')
    expect(screen.getByText('100%')).toBeInTheDocument()

    fireEvent.change(confidence, { target: { value: '0.7' } })
    expect(screen.getByText('70%')).toBeInTheDocument()
  })

  it('keeps implementation-only platform and migration diagnostics out of settings', async () => {
    await i18n.changeLanguage('zh-CN')
    renderMemorySettings({
      enabled: true,
      activeCount: 2,
      tombstoneCount: 1,
      lastInjectedCount: 1,
      legacyMigrationPreflight: {
        legacyFlatEligibleCount: 1,
        alreadyPartitionedCount: 1,
        blockedDuplicateCount: 1,
        blockedRecoveryIssueCount: 1,
        migrationReady: false
      },
      platformIoProfile: 'pathname_default',
      platformCapabilityCode: 'ok',
      platformCapabilityMessageKey: 'platformCapability.pathnameDefault'
    })

    expect(screen.queryByText('平台 I/O profile')).not.toBeInTheDocument()
    expect(screen.queryByText('旧版迁移预检')).not.toBeInTheDocument()
  })
})
