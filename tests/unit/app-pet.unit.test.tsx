import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySettings } from '../../src/renderer/src/workflows/settings'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import { AppPet } from '../../src/renderer/src/views/pet/AppPet'
import type { PendingAgentConversation } from '../../src/renderer/src/agent-conversation-state'
import type { AgentChatTurn, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'
import { act, fireEvent, renderUi, screen, setupUser, waitFor, within } from '../helpers/render'

const originalState = useAppStore.getState()

function activeWorkspace(): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Physics',
    rootPath: '/workspace',
    missionPath: '/workspace/MISSION.md',
    resourcesPath: '/workspace/resources',
    lessonsDir: '/workspace/lessons',
    recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference',
    reviewsDir: '/workspace/reviews',
    createdAt: '2026-07-15T08:00:00.000Z',
    updatedAt: '2026-07-15T08:00:00.000Z',
    missionTitle: 'Physics',
    missionExcerpt: 'Learn physics',
    courses: [],
    fileTree: [],
    conversations: [],
    resources: [],
    records: [],
    lessons: [],
    referenceCount: 0,
    assetsReady: true,
    git: null
  }
}

function pendingAskConversation(): { conversation: PendingAgentConversation; turns: AgentChatTurn[] } {
  const turns: AgentChatTurn[] = [{
    id: 'assistant-ask',
    role: 'assistant',
    content: 'I need one answer.',
    createdAt: '2026-07-15T08:00:00.000Z',
    toolCalls: [{
      id: 'ask-1',
      name: 'ask',
      arguments: JSON.stringify({
        questions: [{
          id: 'goal',
          question: 'Choose a goal',
          options: [{ label: 'Focus' }, { label: 'Review' }]
        }]
      })
    }]
  }]
  return {
    turns,
    conversation: {
      workspaceId: 'workspace-1',
      sourceConversationId: null,
      sourceConversationRevision: null,
      mode: 'temporary',
      summary: {
        id: 'pending-ask',
        title: 'Pending ask',
        createdAt: '2026-07-15T08:00:00.000Z',
        updatedAt: '2026-07-15T08:00:00.000Z',
        relativePath: '.studiumx/agent-conversations/pending-ask.json',
        absolutePath: '/tmp/pending-ask.json',
        messageCount: turns.length,
        pending: true
      },
      turns,
      status: '等待回答',
      toolsSupported: true
    }
  }
}


function resetStore(): void {
  useAppStore.setState({
    ...originalState,
    settings: {
      ...emptySettings,
      pet: {
        ...emptySettings.pet,
        enabled: true,
        displayName: 'Boba',
        size: 112
      }
    },
    generating: false,
    lessonGenerationRunId: null,
    agentPetNotificationResult: null,
    lessonGenerationPetNotificationResult: null,
    agentChatBusy: false,
    agentTurns: [],
    pendingAgentConversation: null,
    error: null,
    petNotificationErrors: [],
    updateSettings: async (patch) => {
      useAppStore.setState((state) => ({
        settings: {
          ...state.settings,
          pet: { ...state.settings.pet, ...(patch.pet ?? {}) }
        }
      }))
    }
  })
}

describe('AppPet accessibility', () => {
  beforeEach(resetStore)
  afterEach(() => useAppStore.setState(originalState))

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' ']
  ])('opens the Pet Assistant with %s and restores mascot focus on close', async (_label, key) => {
    const user = setupUser()
    const { container } = renderUi(<AppPet />)
    const mascot = container.querySelector<HTMLButtonElement>('.app-pet-mascot')
    expect(mascot).not.toBeNull()

    expect(mascot).toHaveAttribute('aria-haspopup', 'dialog')
    expect(mascot).toHaveAttribute('aria-controls', 'pet-assistant-dialog')
    expect(mascot).toHaveAttribute('aria-expanded', 'false')

    mascot!.focus()
    await user.keyboard(key)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('id', 'pet-assistant-dialog')
    expect(mascot).toHaveAttribute('aria-expanded', 'true')

    const closeButton = await screen.findByRole('button', { name: /关闭对话|close conversation/i })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    await user.click(closeButton)

    await waitFor(() => {
      expect(mascot).toHaveFocus()
      expect(mascot).toHaveAttribute('aria-expanded', 'false')
    })
  })



  it('wires pointer cancellation without opening the Assistant', () => {
    const { container } = renderUi(<AppPet />)
    const mascot = container.querySelector<HTMLButtonElement>('.app-pet-mascot')!
    Object.assign(mascot, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn()
    })

    fireEvent.pointerDown(mascot, { button: 0, pointerId: 7, clientX: 100, clientY: 100 })
    fireEvent.pointerCancel(mascot, { pointerId: 7, clientX: 100, clientY: 100 })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mascot.releasePointerCapture).toHaveBeenCalledWith(7)
  })

  it('focuses and dismisses the context menu with Escape or viewport changes', async () => {
    const user = setupUser()
    const { container } = renderUi(<AppPet />)
    const mascot = container.querySelector<HTMLButtonElement>('.app-pet-mascot')!

    fireEvent.contextMenu(mascot, { clientX: 80, clientY: 90 })
    const openItem = await screen.findByRole('menuitem', { name: /打开宠物助手|open pet assistant/i })
    await waitFor(() => expect(openItem).toHaveFocus())

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: /重置位置|reset position/i })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(mascot).toHaveFocus()

    fireEvent.contextMenu(mascot, { clientX: 80, clientY: 90 })
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    fireEvent(window, new Event('resize'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('dismisses a status notification without disabling the pet and opens its related action', async () => {
    const { conversation } = pendingAskConversation()
    useAppStore.setState({
      agentTurns: [],
      agentChatBusy: true,
      pendingAgentConversation: conversation
    })
    const user = setupUser()
    const { container } = renderUi(<AppPet />)

    const action = await screen.findByRole('button', { name: /处理请求|handle request/i })
    await user.click(action)
    await waitFor(() => expect(useAppStore.getState()).toMatchObject({
      view: 'agent',
      overviewDialogMode: 'chat',
      activeConversationId: conversation.summary.id,
      agentTurns: conversation.turns
    }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dismiss = await screen.findByRole('button', { name: /忽略本次提醒|dismiss this notification/i })
    await user.click(dismiss)

    expect(container.querySelector('.app-pet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /处理请求|handle request/i })).not.toBeInTheDocument()
    expect(useAppStore.getState().settings.pet.enabled).toBe(true)
  })

  it('expands at most three real activities and collapses with Escape without losing focus', async () => {
    const { conversation } = pendingAskConversation()
    useAppStore.setState({
      agentChatBusy: true,
      pendingAgentConversation: conversation,
      generating: true,
      lessonGenerationRunId: 'workspace-1:lesson-run-1'
    })
    const user = setupUser()
    renderUi(<AppPet />)

    expect(screen.queryByRole('list', { name: /活动|activities/i })).not.toBeInTheDocument()
    const expand = await screen.findByRole('button', { name: /展开.*活动|show.*activities/i })
    await user.click(expand)

    const list = await screen.findByRole('list', { name: /活动|activities/i })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])
    expect(within(list).getAllByText(/Agent/).length).toBeGreaterThan(0)
    expect(within(list).getByText(/课程生成|Lesson generation/i)).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: /忽略“正在生成课程”|Dismiss “Lesson generation is running”/i }))
    await waitFor(() => {
      expect(within(list).queryByText(/正在生成课程|Lesson generation is running/i)).not.toBeInTheDocument()
      expect(document.activeElement).not.toBe(document.body)
    })

    within(within(list).getAllByRole('listitem')[0]).getByRole('button', { name: /处理请求|handle request/i }).focus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('list', { name: /活动|activities/i })).not.toBeInTheDocument()
    expect(expand).toHaveFocus()
  })

  it('recomputes a viewport-safe bubble alignment after viewport changes without persisting a new Pet position', async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    let mascotRect = { x: 4, y: 220, width: 112, height: 121 }
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 480 })
    window.localStorage.setItem('studiumx-pet-position-v1', JSON.stringify({ x: 4, y: 220 }))
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('app-pet-mascot')) {
        return { ...mascotRect, top: mascotRect.y, left: mascotRect.x, right: mascotRect.x + mascotRect.width, bottom: mascotRect.y + mascotRect.height, toJSON: () => ({}) }
      }
      if (this.classList.contains('app-pet-bubble')) {
        return { x: 0, y: 0, top: 0, left: 0, right: 240, bottom: 120, width: 240, height: 120, toJSON: () => ({}) }
      }
      if (this.classList.contains('app-pet')) {
        return { ...mascotRect, top: mascotRect.y, left: mascotRect.x, right: mascotRect.x + mascotRect.width, bottom: mascotRect.y + mascotRect.height, toJSON: () => ({}) }
      }
      return originalRect.call(this)
    })

    try {
      const { container } = renderUi(<AppPet />)
      const bubble = await waitFor(() => {
        const element = container.querySelector<HTMLElement>('.app-pet-bubble')
        expect(element).toHaveAttribute('data-horizontal', 'start')
        expect(element).toHaveAttribute('data-vertical', 'above')
        return element!
      })
      expect(bubble.style.maxWidth).toBe('296px')

      mascotRect = { ...mascotRect, x: 250 }
      fireEvent(window, new Event('resize'))
      await waitFor(() => expect(bubble).toHaveAttribute('data-horizontal', 'end'))

      mascotRect = { ...mascotRect, x: 100, y: 8 }
      fireEvent(window, new Event('resize'))
      await waitFor(() => expect(bubble).toHaveAttribute('data-vertical', 'below'))
      expect(window.localStorage.getItem('studiumx-pet-position-v1')).toBe(JSON.stringify({ x: 4, y: 220 }))
    } finally {
      rectSpy.mockRestore()
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth)
      if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight)
    }
  })

  it('keeps three expanded activities operable in a tiny viewport without changing persisted Pet placement', async () => {
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 180 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 160 })
    window.localStorage.setItem('studiumx-pet-position-v1', JSON.stringify({ x: 20, y: 20 }))
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('app-pet-bubble')) {
        return { x: 0, y: 0, top: 0, left: 0, right: 360, bottom: 520, width: 360, height: 520, toJSON: () => ({}) }
      }
      if (this.classList.contains('app-pet-mascot') || this.classList.contains('app-pet')) {
        return { x: 20, y: 20, top: 20, left: 20, right: 132, bottom: 141, width: 112, height: 121, toJSON: () => ({}) }
      }
      return originalRect.call(this)
    })

    try {
      const { conversation } = pendingAskConversation()
      useAppStore.setState({
        agentChatBusy: true,
        pendingAgentConversation: conversation,
        generating: true,
        lessonGenerationRunId: 'workspace-1:lesson-run-1'
      })
      const user = setupUser()
      const { container } = renderUi(<AppPet />)

      await user.click(await screen.findByRole('button', { name: /展开.*活动|show.*activities/i }))
      const list = await screen.findByRole('list', { name: /活动|activities/i })
      const items = within(list).getAllByRole('listitem')
      const bubble = container.querySelector<HTMLElement>('.app-pet-bubble')!

      await waitFor(() => {
        expect(bubble.style.maxWidth).toBe('156px')
        expect(bubble.style.maxHeight).toBe('136px')
      })
      expect(items).toHaveLength(3)
      for (const item of items) {
        const action = within(item).getAllByRole('button')[0]
        action.focus()
        expect(action).toHaveFocus()
      }
      expect(window.localStorage.getItem('studiumx-pet-position-v1')).toBe(JSON.stringify({ x: 20, y: 20 }))
    } finally {
      rectSpy.mockRestore()
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth)
      if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight)
    }
  })

  it('navigates Activity Stack items cyclically with arrows, Home, and End', async () => {
    const { conversation } = pendingAskConversation()
    useAppStore.setState({
      agentChatBusy: true,
      pendingAgentConversation: conversation,
      generating: true,
      lessonGenerationRunId: 'workspace-1:lesson-run-1'
    })
    const user = setupUser()
    renderUi(<AppPet />)

    await user.click(await screen.findByRole('button', { name: /展开.*活动|show.*activities/i }))
    const items = within(await screen.findByRole('list', { name: /活动|activities/i })).getAllByRole('listitem')
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])

    items[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(items[2]).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(items[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(items[2]).toHaveFocus()

    const nativeAction = within(items[0]).getByRole('button', { name: /处理请求|handle request/i })
    nativeAction.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(useAppStore.getState()).toMatchObject({ view: 'agent', overviewDialogMode: 'chat' }))
  })

  it('moves focus to the adjacent notification identity when the focused activity is dismissed', async () => {
    const { conversation } = pendingAskConversation()
    useAppStore.setState({
      agentChatBusy: true,
      pendingAgentConversation: conversation,
      generating: true,
      lessonGenerationRunId: 'workspace-1:lesson-run-1'
    })
    const user = setupUser()
    renderUi(<AppPet />)

    await user.click(await screen.findByRole('button', { name: /展开.*活动|show.*activities/i }))
    const list = await screen.findByRole('list', { name: /活动|activities/i })
    const agentItem = within(list).getByText(/Agent 正在工作|Agent is working/i).closest<HTMLElement>('[role="listitem"]')!
    const lessonItem = within(list).getByText(/正在生成课程|Lesson generation is running/i).closest<HTMLElement>('[role="listitem"]')!
    const dismissAgent = within(agentItem).getByRole('button', { name: /忽略“Agent 正在工作”|Dismiss “Agent is working”/i })

    dismissAgent.focus()
    await user.click(dismissAgent)

    await waitFor(() => {
      expect(agentItem).not.toBeInTheDocument()
      expect(lessonItem).toHaveFocus()
    })
  })

  it('returns focus to the mascot when Activity Stack automatically collapses to one notification', async () => {
    const { conversation } = pendingAskConversation()
    useAppStore.setState({
      agentChatBusy: true,
      pendingAgentConversation: conversation,
      generating: true,
      lessonGenerationRunId: 'workspace-1:lesson-run-1'
    })
    const user = setupUser()
    const { container } = renderUi(<AppPet />)

    await user.click(await screen.findByRole('button', { name: /展开.*活动|show.*activities/i }))
    const list = await screen.findByRole('list', { name: /活动|activities/i })
    within(list).getAllByRole('listitem')[1].focus()

    act(() => {
      useAppStore.setState({
        agentChatBusy: false,
        pendingAgentConversation: null,
        generating: false,
        lessonGenerationRunId: null
      })
    })

    await waitFor(() => {
      expect(screen.queryByRole('list', { name: /活动|activities/i })).not.toBeInTheDocument()
      expect(container.querySelector('.app-pet-mascot')).toHaveFocus()
    })
  })

  it('announces a highest-priority notification once without replaying it for rerenders, hover, resize, or stack expansion', async () => {
    const { conversation } = pendingAskConversation()
    useAppStore.setState({
      agentChatBusy: true,
      pendingAgentConversation: conversation,
      generating: true,
      lessonGenerationRunId: 'workspace-1:lesson-run-1'
    })
    const { container, rerender } = renderUi(<AppPet />)

    const liveRegion = await screen.findByRole('status')
    await waitFor(() => expect(liveRegion).toHaveTextContent(/等待.*有请求需要处理.*Agent 正在等待|Waiting.*Request needs your attention.*Agent question/i))
    expect(liveRegion).toHaveAttribute('aria-live', 'assertive')
    const mutations: MutationRecord[] = []
    const observer = new MutationObserver((records) => mutations.push(...records))
    observer.observe(liveRegion, { childList: true, characterData: true, subtree: true })

    rerender(<AppPet />)
    fireEvent.pointerEnter(container.querySelector('.app-pet-mascot')!)
    fireEvent(window, new Event('resize'))
    fireEvent.pointerLeave(container.querySelector('.app-pet-mascot')!)
    fireEvent.click(await screen.findByRole('button', { name: /展开.*活动|show.*activities/i }))
    await act(async () => {})

    expect(mutations).toHaveLength(0)
    observer.disconnect()
  })

  it('announces waiting over running, treats a new business ID as new, and clears dismissed content', async () => {
    const { conversation, turns } = pendingAskConversation()
    const runningConversation = { ...conversation, turns: [], status: '运行中' }
    useAppStore.setState({ agentChatBusy: true, pendingAgentConversation: runningConversation })
    const user = setupUser()
    renderUi(<AppPet />)

    const liveRegion = await screen.findByRole('status')
    await waitFor(() => expect(liveRegion).toHaveTextContent(/工作中.*Agent 正在工作|Working.*Agent is working/i))
    expect(liveRegion).toHaveAttribute('aria-live', 'polite')
    const runningKey = liveRegion.getAttribute('data-announcement-key')

    act(() => useAppStore.setState({ pendingAgentConversation: conversation }))
    await waitFor(() => expect(liveRegion).toHaveTextContent(/等待.*有请求需要处理|Waiting.*Request needs your attention/i))
    expect(liveRegion).toHaveAttribute('aria-live', 'assertive')
    const firstWaitingKey = liveRegion.getAttribute('data-announcement-key')
    expect(firstWaitingKey).not.toBe(runningKey)

    const nextTurns = turns.map((turn) => ({
      ...turn,
      toolCalls: turn.toolCalls?.map((toolCall) => ({ ...toolCall, id: 'ask-2' }))
    }))
    act(() => useAppStore.setState({
      pendingAgentConversation: { ...conversation, turns: nextTurns }
    }))
    await waitFor(() => expect(liveRegion.getAttribute('data-announcement-key')).not.toBe(firstWaitingKey))

    await user.click(screen.getByRole('button', { name: /忽略本次提醒|dismiss this notification/i }))
    await waitFor(() => expect(liveRegion).not.toHaveTextContent(/有请求需要处理|Request needs your attention/i))
  })

  it('moves focus by notification ID when a focused review automatically expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T08:00:00.000Z'))
    try {
      const { conversation } = pendingAskConversation()
      const runConversation = {
        ...conversation,
        turns: [],
        status: '运行中',
        summary: { ...conversation.summary, id: 'agent-run-1' }
      }
      useAppStore.setState({
        agentChatBusy: true,
        pendingAgentConversation: runConversation,
        generating: true,
        lessonGenerationRunId: 'workspace-1:lesson-run-1'
      })
      renderUi(<AppPet />)
      await act(async () => {})

      act(() => useAppStore.setState({
        agentChatBusy: false,
        agentPetNotificationResult: {
          runId: 'agent-run-1',
          resultId: 'agent-result-1',
          targetId: 'agent-run-1'
        }
      }))
      await act(async () => {})

      const expand = screen.getByRole('button', { name: /展开.*活动|show.*activities/i })
      fireEvent.click(expand)
      const list = screen.getByRole('list', { name: /活动|activities/i })
      const reviewItem = within(list).getByText(/Agent 结果已就绪|Agent result is ready/i).closest<HTMLElement>('[role="listitem"]')!
      const lessonItem = within(list).getByText(/正在生成课程|Lesson generation is running/i).closest<HTMLElement>('[role="listitem"]')!
      reviewItem.focus()

      act(() => vi.advanceTimersByTime(7_002))
      await act(async () => {})
      act(() => vi.advanceTimersByTime(20))

      expect(reviewItem).not.toBeInTheDocument()
      expect(lessonItem).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps focus on the same notification ID when priority changes reorder the stack', async () => {
    const { conversation } = pendingAskConversation()
    const runningConversation = { ...conversation, turns: [], status: '运行中' }
    useAppStore.setState({
      agentChatBusy: true,
      pendingAgentConversation: runningConversation,
      generating: true,
      lessonGenerationRunId: 'workspace-1:lesson-run-1'
    })
    const user = setupUser()
    renderUi(<AppPet />)

    await user.click(await screen.findByRole('button', { name: /展开.*活动|show.*activities/i }))
    const list = await screen.findByRole('list', { name: /活动|activities/i })
    const lessonItem = within(list).getByText(/正在生成课程|Lesson generation is running/i).closest<HTMLElement>('[role="listitem"]')!
    lessonItem.focus()

    act(() => useAppStore.setState({ pendingAgentConversation: conversation }))

    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')[2]).toBe(lessonItem)
      expect(lessonItem).toHaveFocus()
      expect(lessonItem).toHaveAttribute('tabindex', '0')
    })
  })

  it('returns focus to the mascot when the focused notification bubble automatically expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T08:00:00.000Z'))
    try {
      const { container } = renderUi(<AppPet />)
      await act(async () => {})
      const action = screen.getByRole('button', { name: /开始对话|start a chat/i })
      action.focus()

      act(() => vi.advanceTimersByTime(8_002))
      await act(async () => {})

      expect(screen.queryByRole('button', { name: /开始对话|start a chat/i })).not.toBeInTheDocument()
      expect(container.querySelector('.app-pet-mascot')).toHaveFocus()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores unrelated global errors and only shows explicitly sourced operation failures', async () => {
    useAppStore.setState({
      error: { message: 'Unrelated settings failure', severity: 'error' },
      petNotificationErrors: []
    })
    const { container, rerender } = renderUi(<AppPet />)
    expect(container.querySelector('.app-pet')).not.toHaveAttribute('data-state', 'failed')

    useAppStore.setState({
      petNotificationErrors: [{
        id: 'agent:run-1:failed:1',
        source: 'agent',
        sourceId: 'run-1',
        error: { message: 'Agent failed safely', severity: 'error' },
        createdAt: Date.now()
      }]
    })
    rerender(<AppPet />)

    await waitFor(() => expect(container.querySelector('.app-pet')).toHaveAttribute('data-state', 'failed'))
    expect(screen.getByText('Agent failed safely')).toBeInTheDocument()
  })

  it('offers safe utility actions from the pet context menu', async () => {
    window.localStorage.setItem('studiumx-pet-position-v1', JSON.stringify({ x: 120, y: 140 }))
    useAppStore.setState((state) => ({
      settings: {
        ...state.settings,
        pet: { ...state.settings.pet, size: 176, showStatusBubble: true }
      }
    }))
    const user = setupUser()
    const { container } = renderUi(<AppPet />)
    const mascot = container.querySelector<HTMLButtonElement>('.app-pet-mascot')!

    fireEvent.contextMenu(mascot, { clientX: 80, clientY: 90 })
    await user.click(await screen.findByRole('menuitem', { name: /重置位置|reset position/i }))
    expect(window.localStorage.getItem('studiumx-pet-position-v1')).toBeNull()

    fireEvent.contextMenu(mascot, { clientX: 80, clientY: 90 })
    await user.click(await screen.findByRole('menuitem', { name: /重置尺寸|reset size/i }))
    await waitFor(() => expect(useAppStore.getState().settings.pet.size).toBe(112))

    fireEvent.contextMenu(mascot, { clientX: 80, clientY: 90 })
    await user.click(await screen.findByRole('menuitem', { name: /隐藏状态气泡|hide status bubble/i }))
    await waitFor(() => expect(useAppStore.getState().settings.pet.showStatusBubble).toBe(false))
  })


  it('uses pending turns for waiting state and restores them without returning focus to the Pet', async () => {
    const { conversation, turns } = pendingAskConversation()
    useAppStore.setState({
      agentTurns: [],
      agentChatBusy: true,
      pendingAgentConversation: conversation
    })
    const user = setupUser()
    const { container } = renderUi(<AppPet />)
    const pet = container.querySelector<HTMLElement>('.app-pet')!
    const mascot = container.querySelector<HTMLButtonElement>('.app-pet-mascot')!

    expect(pet).toHaveAttribute('data-state', 'waiting')
    mascot.focus()
    await user.keyboard('{Enter}')

    const interruption = await screen.findByRole('button', { name: /需要回答一个问题/ })
    await waitFor(() => expect(interruption).toHaveFocus())
    await user.click(interruption)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(useAppStore.getState()).toMatchObject({
        view: 'agent',
        overviewDialogMode: 'chat',
        activeConversationId: conversation.summary.id,
        agentTurns: turns
      })
      expect(mascot).not.toHaveFocus()
    })
  })

  it('does not submit Enter while Chromium reports IME keyCode 229', async () => {
    const agentChat = vi.fn(async () => {})
    const workspace = activeWorkspace()
    useAppStore.setState((state) => ({
      appState: {
        ...state.appState,
        workspaces: [workspace],
        activeWorkspace: workspace
      },
      agentChat
    }))
    const user = setupUser()
    const { container } = renderUi(<AppPet />)
    container.querySelector<HTMLButtonElement>('.app-pet-mascot')!.focus()
    await user.keyboard('{Enter}')

    const input = await screen.findByRole('textbox', { name: /给 AI 发送消息|send.*message/i })
    fireEvent.change(input, { target: { value: 'unfinished composition' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 229 })

    expect(agentChat).not.toHaveBeenCalled()
    expect(input).toHaveValue('unfinished composition')
  })

  it('does not close for a composing Escape key and avoids smooth scrolling with reduced motion', async () => {
    const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
    const scrollTo = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollTo
    })
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    }))

    try {
      const user = setupUser()
      const { container } = renderUi(<AppPet />)
      container.querySelector<HTMLButtonElement>('.app-pet-mascot')!.focus()
      await user.keyboard('{Enter}')
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' })))

      fireEvent.keyDown(window, { key: 'Escape', isComposing: true })
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Escape', isComposing: false, keyCode: 229 })
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Escape', isComposing: false, keyCode: 0 })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    } finally {
      if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
      else delete (HTMLElement.prototype as { scrollTo?: typeof scrollTo }).scrollTo
    }
  })


  it('clears transient UI when disabled so re-enabling starts from a clean welcome state', async () => {
    const user = setupUser()
    const { container } = renderUi(<AppPet />)
    const mascot = container.querySelector<HTMLButtonElement>('.app-pet-mascot')!

    mascot.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    act(() => {
      useAppStore.setState((state) => ({
        settings: { ...state.settings, pet: { ...state.settings.pet, enabled: false } }
      }))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => {
      useAppStore.setState((state) => ({
        settings: { ...state.settings, pet: { ...state.settings.pet, enabled: true } }
      }))
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('.app-pet')).toHaveAttribute('data-state', 'waving')

    fireEvent.contextMenu(container.querySelector<HTMLButtonElement>('.app-pet-mascot')!)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    act(() => {
      useAppStore.setState((state) => ({
        settings: { ...state.settings, pet: { ...state.settings.pet, enabled: false } }
      }))
    })
    act(() => {
      useAppStore.setState((state) => ({
        settings: { ...state.settings, pet: { ...state.settings.pet, enabled: true } }
      }))
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

})
