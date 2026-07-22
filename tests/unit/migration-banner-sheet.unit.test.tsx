import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { buildMigrationBannerModel } from '@renderer/study-space/planning-migration-banner'
import { MigrationBannerSheet } from '@renderer/views/workbench/MigrationBannerSheet'

const summary = {
  taskCount: 2,
  scheduleBlockCount: 1,
  timerPlanCount: 1,
  suggestedWindowCount: 0
}

describe('MigrationBannerSheet UI', () => {
  it('renders summary rows and confirms migration', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const model = buildMigrationBannerModel({ summary })
    render(
      <MigrationBannerSheet open model={model} onResolve={onResolve} />
    )

    expect(screen.getByRole('dialog', { name: /将本地任务迁移到工作区权威文件/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '迁移摘要' })).toBeInTheDocument()
    expect(screen.getByText('任务')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '确认迁移' }))
    expect(onResolve).toHaveBeenCalledWith({ choice: 'confirm' })
  })

  it('later / Escape resolve as later; dismiss button uses dismiss', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const model = buildMigrationBannerModel({ summary })
    render(
      <MigrationBannerSheet open model={model} onResolve={onResolve} />
    )

    await user.click(screen.getByRole('button', { name: '关闭' }))
    expect(onResolve).toHaveBeenCalledWith({ choice: 'dismiss' })

    onResolve.mockClear()
    await user.keyboard('{Escape}')
    expect(onResolve).toHaveBeenCalledWith({ choice: 'later' })
  })

  it('busy disables actions and blocks Escape', async () => {
    const user = userEvent.setup()
    const onResolve = vi.fn()
    const model = buildMigrationBannerModel({ summary, busy: true })
    render(
      <MigrationBannerSheet
        open
        model={model}
        busy
        errorMessage="CAS conflict"
        onResolve={onResolve}
      />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('CAS conflict')
    expect(screen.getByRole('button', { name: '正在迁移…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onResolve).not.toHaveBeenCalled()
  })

  it('renders nothing when closed or model null', () => {
    const onResolve = vi.fn()
    const { rerender } = render(
      <MigrationBannerSheet open={false} model={null} onResolve={onResolve} />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(
      <MigrationBannerSheet
        open
        model={null}
        onResolve={onResolve}
      />
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
