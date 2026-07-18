import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeWorkbench } from '../../src/renderer/src/views/workbench/OfficeWorkbench'
import { navigateWorkbenchRoute, parseWorkbenchRoute } from '../../src/renderer/src/views/workbench/workbenchRoute'

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
  WorkbenchTasks: ({
    onOpenAnalytics,
    analyticsButtonRef
  }: {
    onOpenAnalytics: () => void
    analyticsButtonRef?: { current: HTMLButtonElement | null }
  }) => (
    <div data-testid="tasks">
      <button
        ref={(node) => {
          if (analyticsButtonRef) analyticsButtonRef.current = node
        }}
        type="button"
        onClick={onOpenAnalytics}
        aria-label="打开学习分析"
      >
        学习分析
      </button>
    </div>
  )
}))
vi.mock('../../src/renderer/src/views/workbench/WorkbenchMusicPlayer', () => ({
  WorkbenchMusicPlayer: () => <div data-testid="music" />
}))
vi.mock('../../src/renderer/src/views/workbench/StudyTaskSchedulePage', () => ({
  StudyTaskSchedulePage: () => <div data-testid="schedule" />
}))
vi.mock('../../src/renderer/src/views/workbench/analytics/StudyAnalyticsPage', () => ({
  StudyAnalyticsPage: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="analytics">
      <button type="button" onClick={onBack} aria-label="返回自习室">
        返回
      </button>
    </div>
  )
}))

const workbenchRouteState = vi.hoisted(() => ({
  route: 'room' as 'room' | 'analytics' | 'schedule'
}))

vi.mock('../../src/renderer/src/views/workbench/workbenchRoute', () => ({
  parseWorkbenchRoute: vi.fn(() => workbenchRouteState.route),
  navigateWorkbenchRoute: vi.fn((route: 'room' | 'analytics' | 'schedule') => {
    workbenchRouteState.route = route
  })
}))

function renderWorkbench() {
  return render(<OfficeWorkbench showNotification={vi.fn(async () => undefined)} />)
}

describe('OfficeWorkbench immersive fullscreen lifecycle', () => {
  let fullscreenElement: Element | null

  beforeEach(() => {
    fullscreenElement = null
    workbenchRouteState.route = 'room'
    vi.mocked(parseWorkbenchRoute).mockImplementation(() => workbenchRouteState.route)
    vi.mocked(navigateWorkbenchRoute).mockImplementation((route) => {
      workbenchRouteState.route = route
    })
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

    // Real fullscreen hosts consume Escape and emit fullscreenchange themselves.
    // The immersive key handler must ignore Escape while the stage owns fullscreen.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.exitFullscreen).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()
    expect(document.fullscreenElement).not.toBeNull()

    // Simulate the browser finishing the Escape-driven exit.
    fullscreenElement = null
    document.dispatchEvent(new Event('fullscreenchange'))
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

  it('keeps immersive open and exit reachable when close-driven exitFullscreen rejects', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    await user.click(screen.getByRole('button', { name: '进入全屏' }))

    const exitFullscreen = vi.mocked(document.exitFullscreen)
    exitFullscreen.mockImplementationOnce(() => Promise.reject(new Error('exit blocked')))

    await user.click(screen.getByRole('button', { name: '收起沉浸模式' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '退出全屏' })).toHaveFocus()
    })
    expect(document.fullscreenElement).not.toBeNull()
    expect(screen.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()
    expect(document.getElementById('workbench-immersive-layer')).toHaveClass('is-open')

    // Transition and close-request flags must clear so the user can retry.
    exitFullscreen.mockImplementationOnce(() => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    await user.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(document.fullscreenElement).toBeNull())
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '进入全屏' })).toHaveFocus()
    })
  })

  it('keeps immersive open and retries when toggle exitFullscreen rejects', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    await user.click(screen.getByRole('button', { name: '进入全屏' }))

    const exitFullscreen = vi.mocked(document.exitFullscreen)
    exitFullscreen.mockImplementationOnce(() => Promise.reject(new Error('toggle exit blocked')))

    await user.click(screen.getByRole('button', { name: '退出全屏' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '退出全屏' })).toHaveFocus()
    })
    expect(document.fullscreenElement).not.toBeNull()
    expect(screen.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()

    exitFullscreen.mockImplementationOnce(() => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    await user.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(document.fullscreenElement).toBeNull())
  })

  it('clears request flags when route-leave exitFullscreen rejects', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    await user.click(screen.getByRole('button', { name: '进入全屏' }))

    const exitFullscreen = vi.mocked(document.exitFullscreen)
    exitFullscreen.mockImplementationOnce(() => Promise.reject(new Error('route exit blocked')))

    await user.click(screen.getByRole('button', { name: '打开学习分析' }))

    await waitFor(() => {
      expect(screen.getByTestId('analytics')).toBeInTheDocument()
    })
    expect(document.fullscreenElement).not.toBeNull()
    expect(exitFullscreen).toHaveBeenCalled()

    // Returning to room must remain possible after a rejected cleanup exit.
    workbenchRouteState.route = 'room'
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '进入沉浸模式' })).toBeVisible()
    })
  })

  it('keeps only the exit control interactive after pointer and focus leave fullscreen', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    await user.click(screen.getByRole('button', { name: '进入全屏' }))

    const controls = document.querySelector('.workbench-immersive-controls')!
    const canvas = screen.getByLabelText(/StudiumX 自习室/)
    canvas.focus()
    fireEvent.pointerLeave(controls)

    const exitFullscreen = await screen.findByRole('button', { name: '退出全屏' })
    expect(exitFullscreen).toBeVisible()
    expect(exitFullscreen).toHaveAttribute('tabindex', '0')

    // Collapsed fullscreen fan: hide/scene/note leave the tab order and a11y tree.
    expect(screen.queryByRole('button', { name: '隐藏自习室卡片' })).toBeNull()
    expect(screen.queryByRole('button', { name: '选择场景' })).toBeNull()
    expect(screen.queryByRole('button', { name: '快捷记事' })).toBeNull()

    const hideButton = document.querySelector('.workbench-immersive-arc-action--hide') as HTMLButtonElement
    expect(hideButton.getAttribute('aria-hidden')).toBe('true')
    expect(hideButton.tabIndex).toBe(-1)
  })

  it('ignores duplicate fullscreenchange events that do not flip ownership', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    await user.click(screen.getByRole('button', { name: '进入全屏' }))

    const exitButton = screen.getByRole('button', { name: '退出全屏' })
    await waitFor(() => expect(exitButton).toHaveFocus())

    // A second identical fullscreenchange must not steal focus again or churn state.
    const canvas = screen.getByLabelText(/StudiumX 自习室/)
    canvas.focus()
    expect(exitButton).not.toHaveFocus()

    document.dispatchEvent(new Event('fullscreenchange'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(exitButton).not.toHaveFocus()
    expect(document.fullscreenElement).not.toBeNull()
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeVisible()
  })
})
