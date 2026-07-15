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
    expect(items.every((item) => item.tabIndex === 0)).toBe(true)
    expect(within(list).getAllByText(/Agent/).length).toBeGreaterThan(0)
    expect(within(list).getByText(/课程生成|Lesson generation/i)).toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: /忽略“正在生成课程”|Dismiss “Lesson generation is running”/i }))
    await waitFor(() => {
      expect(within(list).queryByText(/正在生成课程|Lesson generation is running/i)).not.toBeInTheDocument()
      expect(document.activeElement).not.toBe(document.body)
    })

    within(list).getAllByRole('listitem')[0].focus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('list', { name: /活动|activities/i })).not.toBeInTheDocument()
    expect(expand).toHaveFocus()
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
