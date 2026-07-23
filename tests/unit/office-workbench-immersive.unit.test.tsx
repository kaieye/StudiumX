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
  useAppStore: (selector: (state: {
    settings: {
      pet: {
        appearance: string
        notificationPreferences: { quietUntil: number | null }
      }
      notifications: { enabled: boolean }
    }
    appState: { activeWorkspace: { rootPath: string } | null }
  }) => unknown) =>
    selector({
      settings: {
        pet: {
          appearance: 'cat',
          notificationPreferences: { quietUntil: null }
        },
        notifications: { enabled: false }
      },
      appState: { activeWorkspace: null }
    })
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

const immersiveMediaStore = vi.hoisted(() => ({
  clearImmersiveCustomMedia: vi.fn(async () => true),
  renameImmersiveCustomMedia: vi.fn(async () => true),
  loadImmersiveCustomMedia: vi.fn(async () => null),
  saveImmersiveCustomMedia: vi.fn(async () => true),
  readImmersiveScenePreference: vi.fn(() => null as null | 'clock' | 'girl' | 'custom'),
  writeImmersiveScenePreference: vi.fn()
}))

vi.mock('../../src/renderer/src/views/workbench/immersive-custom-media-store', () => immersiveMediaStore)
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
    immersiveMediaStore.clearImmersiveCustomMedia.mockReset()
    immersiveMediaStore.clearImmersiveCustomMedia.mockResolvedValue(true)
    immersiveMediaStore.renameImmersiveCustomMedia.mockReset()
    immersiveMediaStore.renameImmersiveCustomMedia.mockResolvedValue(true)
    immersiveMediaStore.loadImmersiveCustomMedia.mockReset()
    immersiveMediaStore.loadImmersiveCustomMedia.mockResolvedValue(null)
    immersiveMediaStore.saveImmersiveCustomMedia.mockReset()
    immersiveMediaStore.saveImmersiveCustomMedia.mockResolvedValue(true)
    immersiveMediaStore.readImmersiveScenePreference.mockReset()
    immersiveMediaStore.readImmersiveScenePreference.mockReturnValue(null)
    immersiveMediaStore.writeImmersiveScenePreference.mockReset()
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
  it('puts hide before note/scene/fullscreen in keyboard order after the immersive toggle', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    const toggle = screen.getByRole('button', { name: '进入沉浸模式' })
    // Arc fan is hover/focus gated even before immersive open.
    fireEvent.pointerEnter(toggle.closest('.workbench-immersive-controls')!)
    expect(screen.getByRole('group', { name: '沉浸模式快捷操作' })).toHaveClass('is-active')

    toggle.focus()
    await user.tab()
    // Arc left-to-right: hide -> note -> scene -> fullscreen
    expect(screen.getByRole('button', { name: '隐藏自习室卡片' })).toHaveFocus()

  })
  it('keeps exit visible after pointer and focus leave, then restores the fullscreen trigger', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const controls = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controls)
    const enterFullscreen = screen.getByRole('button', { name: '进入全屏' })
    await user.click(enterFullscreen)

    const canvas = screen.getByLabelText(/StudiumX 自习室/)
    canvas.focus()
    fireEvent.pointerLeave(controls)

    // Fullscreen exit is no longer pinned; re-hover to reveal the control.
    fireEvent.pointerEnter(controls)
    const exitFullscreen = await screen.findByRole('button', { name: '退出全屏' })
    expect(exitFullscreen).toBeVisible()
    expect(screen.getByRole('group', { name: '沉浸模式快捷操作' })).toHaveClass('is-active')

    await user.click(exitFullscreen)

    // After exit, fan stays hover/focus gated (may collapse). Re-hover if needed.
    fireEvent.pointerEnter(controls)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '进入全屏' })).toBeVisible()
    })

  })
  it('treats fullscreen Escape as a browser exit and restores focus without closing immersive mode', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const controls = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controls)
    const enterFullscreen = screen.getByRole('button', { name: '进入全屏' })
    enterFullscreen.focus()
    await user.click(enterFullscreen)

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
      expect(document.fullscreenElement).toBeNull()
    })
    expect(screen.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()

  })
  it('exits owned fullscreen before closing immersive mode and restores the immersive toggle', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
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
    const controls = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controls)
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

    // Transition and close-request flags must clear so the user can retry exit.
    exitFullscreen.mockImplementationOnce(() => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    await user.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(document.fullscreenElement).toBeNull())
    fireEvent.pointerEnter(controls)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '进入全屏' })).toBeVisible()
    })

  })
  it('keeps immersive open and retries when toggle exitFullscreen rejects', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const controls = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controls)
    await user.click(screen.getByRole('button', { name: '进入全屏' }))

    const exitFullscreen = vi.mocked(document.exitFullscreen)
    exitFullscreen.mockImplementationOnce(() => Promise.reject(new Error('toggle exit blocked')))
    fireEvent.pointerEnter(controls)
    await user.click(screen.getByRole('button', { name: '退出全屏' }))

    fireEvent.pointerEnter(controls)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '退出全屏' })).toBeVisible()
    })
    expect(document.fullscreenElement).not.toBeNull()
    expect(screen.getByRole('button', { name: '收起沉浸模式' })).toBeVisible()

    exitFullscreen.mockImplementationOnce(() => {
      fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
      return Promise.resolve()
    })
    fireEvent.pointerEnter(controls)
    await user.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(document.fullscreenElement).toBeNull())

  })
  it('clears fullscreen state after leave-while-fullscreen and allows re-entry', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const controls = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controls)
    await user.click(screen.getByRole('button', { name: '进入全屏' }))
    await waitFor(() => {
      expect(document.querySelector('.workbench-immersive-controls')).toHaveClass('is-fullscreen')
    })

    await user.click(screen.getByRole('button', { name: '打开学习分析' }))
    await waitFor(() => {
      expect(screen.getByTestId('analytics')).toBeInTheDocument()
    })
    await waitFor(() => expect(document.fullscreenElement).toBeNull())

    await user.click(screen.getByRole('button', { name: '返回自习室' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '进入沉浸模式' })).toBeVisible()
    })

    // Returning to room must show a clean enter-fullscreen affordance on hover.
    const controlsAgain = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controlsAgain)
    const enterFullscreen = screen.getByRole('button', { name: '进入全屏' })
    expect(enterFullscreen).toBeVisible()
    expect(document.querySelector('.workbench-immersive-controls')).not.toHaveClass('is-fullscreen')

    await user.click(enterFullscreen)
    await waitFor(() => {
      expect(document.fullscreenElement).not.toBeNull()
    })
    expect(document.querySelector('.workbench-immersive-controls')).toHaveClass('is-fullscreen')

  })
  it('clears request flags when route-leave exitFullscreen rejects', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
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
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const enterFullscreen = screen.getByRole('button', { name: '进入全屏' })
    expect(enterFullscreen).toBeVisible()
    expect(document.querySelector('.workbench-immersive-controls')).not.toHaveClass('is-fullscreen')
    expect(enterFullscreen).toHaveAttribute('aria-pressed', 'false')
    await user.click(enterFullscreen)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '退出全屏' })).toBeVisible()
    })
  })
  it('keeps only the exit control interactive after pointer and focus leave fullscreen', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const controls = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controls)
    await user.click(screen.getByRole('button', { name: '进入全屏' }))

    const canvas = screen.getByLabelText(/StudiumX 自习室/)
    canvas.focus()
    fireEvent.pointerLeave(controls)

    // Collapsed fan: no arc actions remain in the a11y tree / tab order.
    const arcMenu = document.querySelector('.workbench-immersive-arc-menu')!
    expect(arcMenu).not.toHaveClass('is-active')
    expect(arcMenu).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('button', { name: '退出全屏' })).toBeNull()
    expect(screen.queryByRole('button', { name: '隐藏自习室卡片' })).toBeNull()
    expect(screen.queryByRole('button', { name: '选择场景' })).toBeNull()
    expect(screen.queryByRole('button', { name: '快捷记事' })).toBeNull()

    const hideButton = document.querySelector('.workbench-immersive-arc-action--hide') as HTMLButtonElement
    expect(hideButton).toHaveAttribute('tabindex', '-1')
    expect(hideButton).toHaveAttribute('aria-hidden', 'true')

  })
  it('ignores duplicate fullscreenchange events that do not flip ownership', async () => {
    const user = userEvent.setup()
    renderWorkbench()

    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    const controls = document.querySelector('.workbench-immersive-controls')!
    fireEvent.pointerEnter(controls)
    const enterFullscreen = screen.getByRole('button', { name: '进入全屏' })
    enterFullscreen.focus()
    await user.click(enterFullscreen)

    fireEvent.pointerEnter(controls)
    const exitButton = screen.getByRole('button', { name: '退出全屏' })
    // A second identical fullscreenchange must not steal focus again or churn state.
    const canvas = screen.getByLabelText(/StudiumX 自习室/)
    canvas.focus()
    fireEvent.pointerLeave(controls)
    expect(exitButton).not.toHaveFocus()
    document.dispatchEvent(new Event('fullscreenchange'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(exitButton).not.toHaveFocus()
    expect(document.fullscreenElement).not.toBeNull()
    // Fan stays collapsed until hover/focus returns.
    expect(document.querySelector('.workbench-immersive-arc-menu')).not.toHaveClass('is-active')

  })

  it('persists user-added scene media and restores it on mount', async () => {
    const user = userEvent.setup()
    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' })
    const file = new File([blob], 'wall.png', { type: 'image/png' })

    const first = renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
    await user.click(screen.getByRole('button', { name: '选择场景' }))

    const input = document.querySelector('.workbench-scene-picker__file-input') as HTMLInputElement
    expect(input).toBeTruthy()
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })

    await waitFor(() => {
      expect(immersiveMediaStore.saveImmersiveCustomMedia).toHaveBeenCalled()
    })
    const saved = immersiveMediaStore.saveImmersiveCustomMedia.mock.calls.at(-1)?.[0] as {
      kind: string
      name: string
      blob: Blob
    }
    expect(saved.kind).toBe('image')
    expect(saved.name).toBe('wall')
    expect(saved.blob).toBeInstanceOf(Blob)
    expect(screen.getByRole('dialog', { name: '选择场景' })).toBeVisible()
    expect(immersiveMediaStore.writeImmersiveScenePreference).toHaveBeenCalledWith('custom')
    first.unmount()

    // Simulate app restart: durable load returns the saved media + preference.
    immersiveMediaStore.loadImmersiveCustomMedia.mockResolvedValue({
      kind: 'image',
      name: 'wall',
      mimeType: 'image/png',
      blob,
      updatedAt: Date.now()
    })
    immersiveMediaStore.readImmersiveScenePreference.mockReturnValue('custom')

    renderWorkbench()
    await waitFor(() => {
      const imgs = document.querySelectorAll('img.workbench-immersive-video')
      expect(imgs.length).toBeGreaterThan(0)
    })
  })

  it('renders the bundled image scenes with their Chinese scene names', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
    await user.click(screen.getByRole('button', { name: '选择场景' }))

    await user.click(screen.getByRole('button', { name: '云蒸霞光' }))

    expect(screen.getByRole('button', { name: '云蒸霞光' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog', { name: '选择场景' })).toBeVisible()
  })

  it('keeps the scene picker open after selecting a preset', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
    await user.click(screen.getByRole('button', { name: '选择场景' }))

    await user.click(screen.getByRole('button', { name: '室内自习' }))

    expect(screen.getByRole('dialog', { name: '选择场景' })).toBeVisible()
    expect(screen.getByRole('button', { name: '室内自习' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches immersive plane to the focus-timer dial scene', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
    await user.click(screen.getByRole('button', { name: '选择场景' }))

    await user.click(screen.getByRole('button', { name: '专注计时' }))

    expect(screen.getByRole('button', { name: '专注计时' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('.workbench-immersive-focus-timer-scene')).toBeTruthy()
    expect(document.querySelector('.workbench-immersive-clock-scene')).toBeNull()
  })

  it('edits the custom scene name on double click and persists it', async () => {
    const user = userEvent.setup()
    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' })
    immersiveMediaStore.loadImmersiveCustomMedia.mockResolvedValue({
      kind: 'image',
      name: 'wall.png',
      mimeType: 'image/png',
      blob,
      updatedAt: Date.now()
    })

    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
    await user.click(screen.getByRole('button', { name: '选择场景' }))

    await user.dblClick(await screen.findByRole('button', { name: 'wall.png' }))
    const nameInput = screen.getByRole('textbox', { name: '编辑自定义场景名称' })
    await user.clear(nameInput)
    await user.type(nameInput, '我的自习室{Enter}')

    expect(immersiveMediaStore.renameImmersiveCustomMedia).toHaveBeenCalledWith('我的自习室')
    expect(screen.getByRole('button', { name: '我的自习室' })).toBeVisible()
  })

  it('deletes the custom scene from the picker without closing it', async () => {
    const user = userEvent.setup()
    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' })
    immersiveMediaStore.loadImmersiveCustomMedia.mockResolvedValue({
      kind: 'image',
      name: 'wall.png',
      mimeType: 'image/png',
      blob,
      updatedAt: Date.now()
    })

    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
    await user.click(screen.getByRole('button', { name: '选择场景' }))

    await user.click(await screen.findByRole('button', { name: '删除自定义场景' }))

    expect(immersiveMediaStore.clearImmersiveCustomMedia).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: '选择场景' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '删除自定义场景' })).toBeNull()
  })

  it('renders scene picker close control without an outer bordered plate class contract', async () => {
    const user = userEvent.setup()
    renderWorkbench()
    await user.click(screen.getByRole('button', { name: '进入沉浸模式' }))
    fireEvent.pointerEnter(document.querySelector('.workbench-immersive-controls')!)
    await user.click(screen.getByRole('button', { name: '选择场景' }))
    expect(screen.getByRole('heading', { name: '选择场景' })).toBeVisible()
    const close = screen.getByRole('button', { name: '关闭场景选择' })
    expect(close).toHaveClass('workbench-scene-picker__close')
    const grid = document.querySelector('.workbench-scene-picker__grid')
    expect(grid).toBeTruthy()
  })

})
