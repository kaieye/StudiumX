import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeWorkbench } from '../../src/renderer/src/views/workbench/OfficeWorkbench'

const studySession = {
  snapshot: {
    nickname: '测试用户',
    timerState: 'idle',
    timerMode: 'pomodoro',
    spaceCode: 'TEST',
    tasks: []
  },
  presence: { status: 'offline' },
  viewModel: {
    userSeat: 0,
    userSeatConflict: false,
    peersBySeat: new Map(),
    activeRoom: { name: '测试自习室' },
    connectionLabel: '离线',
    roomCycle: { phase: 'focus', remainingSeconds: 1_500 },
    blockedSeatIndexes: [],
    roomMembers: [],
    timerProgress: 0,
    openTasks: [],
    completedTasks: [],
    nextAvailableSeat: 1
  },
  joinSpace: vi.fn(),
  enterRandomSpace: vi.fn(),
  chooseSeat: vi.fn(),
  toggleTimer: vi.fn(),
  resetTimer: vi.fn(),
  startTimerInMode: vi.fn(),
  saveTimerPlan: vi.fn(),
  applyTimerPlan: vi.fn(),
  removeTimerPlan: vi.fn(),
  addScheduledTask: vi.fn(),
  updateTask: vi.fn(),
  toggleTask: vi.fn(),
  removeTask: vi.fn()
}

vi.mock('../../src/renderer/src/app-shell/appStore', () => ({
  useAppStore: (selector: (state: { settings: { pet: { appearance: string } } }) => unknown) =>
    selector({ settings: { pet: { appearance: 'cat' } } })
}))

vi.mock('../../src/renderer/src/study-space/session/useStudySession', () => ({
  useStudySession: () => studySession
}))

vi.mock('../../src/renderer/src/views/workbench/office-scene-runtime', () => ({
  createOfficeSceneRuntime: () => ({
    mount: vi.fn(),
    update: vi.fn(),
    dispose: vi.fn()
  })
}))

vi.mock('../../src/renderer/src/views/workbench/WorkbenchLeaderboard', () => ({
  WorkbenchLeaderboard: () => <div data-testid="leaderboard" />
}))
vi.mock('../../src/renderer/src/views/workbench/WorkbenchPomodoro', () => ({
  WorkbenchPomodoro: () => <div data-testid="pomodoro" />
}))
vi.mock('../../src/renderer/src/views/workbench/WorkbenchTasks', () => ({
  WorkbenchTasks: () => <div data-testid="tasks" />
}))
vi.mock('../../src/renderer/src/views/workbench/WorkbenchMusicPlayer', () => ({
  WorkbenchMusicPlayer: () => <div data-testid="music" />
}))
vi.mock('../../src/renderer/src/views/workbench/StudyTaskSchedulePage', () => ({
  StudyTaskSchedulePage: () => <div data-testid="schedule" />
}))
vi.mock('../../src/renderer/src/views/workbench/analytics/StudyAnalyticsPage', () => ({
  StudyAnalyticsPage: () => <div data-testid="analytics" />
}))
vi.mock('../../src/renderer/src/views/workbench/workbenchRoute', () => ({
  parseWorkbenchRoute: () => 'room',
  navigateWorkbenchRoute: vi.fn()
}))

function renderWorkbench() {
  return render(<OfficeWorkbench showNotification={vi.fn(async () => undefined)} />)
}

describe('OfficeWorkbench immersive fullscreen lifecycle', () => {
  let fullscreenElement: Element | null

  beforeEach(() => {
    fullscreenElement = null
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => fullscreenElement
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(function requestFullscreen(this: HTMLElement) {
        fullscreenElement = this
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      })
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: vi.fn(() => {
        fullscreenElement = null
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      })
    })
  })

  it('puts the fullscreen action immediately after the immersive toggle in keyboard order', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    const toggle = screen.getByRole('button', { name: '进入沉浸模式' })
    await user.click(toggle)
    expect(screen.getByRole('group', { name: '沉浸模式快捷操作' })).toHaveClass('is-active')

    toggle.focus()
    await user.tab()
    expect(screen.getByRole('button', { name: '进入全屏' })).toHaveFocus()
  })

  it('keeps exit visible after pointer and focus leave, then restores the fullscreen trigger', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const enterFullscreen = screen.getByRole('button', { name: '进入全屏' })
    await user.click(enterFullscreen)

    const canvas = screen.getByLabelText(/StudiumX 自习室/)
    canvas.focus()
    fireEvent.pointerLeave(canvas.closest('.office-workbench-stage')!.querySelector('.workbench-immersive-controls')!)

    const exitFullscreen = await screen.findByRole('button', { name: '退出全屏' })
    expect(exitFullscreen).toBeVisible()
    await user.click(exitFullscreen)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '进入全屏' })).toHaveFocus()
    })
  })

  it('treats fullscreen Escape as a browser exit and restores focus without closing immersive mode', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    await user.click(screen.getByRole('button', { name: '进入全屏' }))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()
    expect(document.fullscreenElement).not.toBeNull()

    await document.exitFullscreen()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '进入全屏' })).toHaveFocus()
    })
    expect(screen.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()
  })

  it('exits owned fullscreen before closing immersive mode and restores the immersive toggle', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    await user.click(screen.getByRole('button', { name: '进入全屏' }))
    await user.click(screen.getByRole('button', { name: '收起沉浸模式' }))

    await waitFor(() => expect(document.fullscreenElement).toBeNull())
    await waitFor(() => {
      expect(document.getElementById('workbench-immersive-layer')).toHaveClass('is-closing')
    })
    fireEvent.animationEnd(document.getElementById('workbench-immersive-layer')!)

    const toggle = await screen.findByRole(
      'button',
      { name: '进入沉浸模式' },
      { timeout: 2_500 }
    )
    await waitFor(() => expect(toggle).toHaveFocus())
  })
})
