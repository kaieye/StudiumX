/**
 * StudyPlanningPrefsSection UI (STC-404) — restore empty-start + classification opt-out.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StudyPlanningPrefsSection } from '@renderer/views/workbench/StudyPlanningPrefsSection'

describe('StudyPlanningPrefsSection UI (STC-404)', () => {
  it('renders empty-start radios and classification checkbox', () => {
    render(
      <StudyPlanningPrefsSection
        emptyStartPolicy="ask_every_time"
        classificationPromptOptOut={false}
        onEmptyStartPolicyChange={vi.fn()}
        onClassificationPromptOptOutChange={vi.fn()}
      />
    )
    expect(screen.getByRole('region', { name: /启动与归类偏好/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /每次询问/ })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('radio', { name: /记住快速创建/ })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    expect(screen.getByRole('checkbox', { name: /完成后不再提示归类/ })).not.toBeChecked()
  })

  it('emits policy change and restorable opt-out uncheck', async () => {
    const user = userEvent.setup()
    const onPolicy = vi.fn()
    const onOptOut = vi.fn()
    const { rerender } = render(
      <StudyPlanningPrefsSection
        emptyStartPolicy="ask_every_time"
        classificationPromptOptOut={false}
        onEmptyStartPolicyChange={onPolicy}
        onClassificationPromptOptOutChange={onOptOut}
      />
    )

    await user.click(screen.getByRole('radio', { name: /记住无任务计时/ }))
    expect(onPolicy).toHaveBeenCalledWith('remember_unattributed')

    await user.click(screen.getByRole('checkbox', { name: /完成后不再提示归类/ }))
    expect(onOptOut).toHaveBeenCalledWith(true)

    onOptOut.mockClear()
    rerender(
      <StudyPlanningPrefsSection
        emptyStartPolicy="remember_unattributed"
        classificationPromptOptOut={true}
        onEmptyStartPolicyChange={onPolicy}
        onClassificationPromptOptOutChange={onOptOut}
      />
    )
    expect(screen.getByRole('checkbox', { name: /完成后不再提示归类/ })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: /完成后不再提示归类/ }))
    expect(onOptOut).toHaveBeenCalledWith(false)
  })
})
