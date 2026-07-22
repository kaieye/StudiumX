/**
 * StudyPlanningPrefsSection UI — empty-start category row.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StudyPlanningPrefsSection } from '@renderer/views/workbench/StudyPlanningPrefsSection'

const options = [
  { value: 'study', label: '学习' },
  { value: 'entertainment', label: '娱乐' },
  { value: 'exercise', label: '锻炼' },
  { value: 'other', label: '其他' }
]

describe('StudyPlanningPrefsSection UI', () => {
  it('renders one settings-style category row', () => {
    render(
      <StudyPlanningPrefsSection
        emptyStartCategoryId="other"
        categoryOptions={options}
        onEmptyStartCategoryIdChange={vi.fn()}
      />
    )
    expect(screen.getByRole('region', { name: /空启动归类/ })).toBeInTheDocument()
    expect(screen.getByText('空启动归类')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('emits category change from select', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <StudyPlanningPrefsSection
        emptyStartCategoryId="other"
        categoryOptions={options}
        onEmptyStartCategoryIdChange={onChange}
      />
    )
    // SettingsSelect opens via button trigger with current label.
    const trigger = screen.getByRole('button', { name: '其他' })
    await user.click(trigger)
    const study = await screen.findByRole('option', { name: '学习' })
    await user.click(study)
    expect(onChange).toHaveBeenCalledWith('study')
  })
})
