import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchRoomSwitcher } from '@renderer/views/workbench/WorkbenchRoomSwitcher'

describe('WorkbenchRoomSwitcher', () => {
  it('keeps the room code and explains the failure when the room is not active', async () => {
    const user = userEvent.setup()
    const onJoinSpace = vi.fn().mockResolvedValue(false)

    render(
      <WorkbenchRoomSwitcher
        onEnterRandomSpace={vi.fn()}
        onJoinSpace={onJoinSpace}
      />
    )

    const input = screen.getByRole('textbox', { name: '搜索要加入的现有房间码' })
    await user.type(input, 'empty')
    await user.click(screen.getByRole('button', { name: '搜索并加入现有房间' }))

    expect(onJoinSpace).toHaveBeenCalledWith('EMPTY')
    expect(input).toHaveValue('EMPTY')
    expect(screen.getByRole('alert')).toHaveTextContent('未找到可加入的在线自习室')
  })
})
