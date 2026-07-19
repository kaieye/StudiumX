import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { useAppStore } from '../../src/renderer/src/app-shell/appStore'
import type { PendingAgentConversation } from '../../src/renderer/src/agent-conversation-state'
import { PET_ASSISTANT_GEOMETRY_STORAGE_KEY } from '../../src/renderer/src/views/pet/pet-interaction'
import { PetAssistantDialog } from '../../src/renderer/src/views/pet/PetAssistantDialog'
import type { AgentChatTurn, AgentConversationSummary, TeachingWorkspaceSummary } from '../../src/shared/teaching-types'
import { act, fireEvent, renderUi, screen, setupUser, waitFor } from '../helpers/render'

const originalState = useAppStore.getState()
const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

function workspace(conversations: AgentConversationSummary[] = []): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1', name: 'Physics', rootPath: '/workspace',
    missionPath: '/workspace/MISSION.md', resourcesPath: '/workspace/resources',
    lessonsDir: '/workspace/lessons', recordsDir: '/workspace/records',
    referenceDir: '/workspace/reference', reviewsDir: '/workspace/reviews',
    createdAt: '2026-07-15T08:00:00.000Z', updatedAt: '2026-07-15T08:00:00.000Z',
    missionTitle: 'Physics', missionExcerpt: 'Learn physics', courses: [], fileTree: [],
    conversations, resources: [], records: [], lessons: [], referenceCount: 0,
    assetsReady: true, git: null
  }
}

function summary(id = 'saved-1'): AgentConversationSummary {
  return {
    id, workspaceId: 'workspace-1', title: 'Study plan',
    createdAt: '2026-07-15T08:00:00.000Z', updatedAt: '2026-07-15T08:00:00.000Z',
    relativePath: `.studiumx/agent-conversations/${id}.json`, absolutePath: `/workspace/${id}.json`,
    messageCount: 1
  }
}

function pending(turns: AgentChatTurn[], id = 'pending-1'): PendingAgentConversation {
  return {
    workspaceId: 'workspace-1', sourceConversationId: null, sourceConversationRevision: null,
    mode: 'temporary', summary: { ...summary(id), pending: true }, turns,
    status: 'thinking', toolsSupported: true
  }
}

function setWorkspaceState(patch: Partial<ReturnType<typeof useAppStore.getState>> = {}): void {
  const activeWorkspace = workspace()
  useAppStore.setState((state) => ({
    ...patch,
    appState: {
      ...state.appState,
      workspaces: [activeWorkspace],
      activeWorkspace,
      temporaryConversations: []
    },
    error: null
  }))
}

function renderDialog(onClose = vi.fn()) {
  return { onClose, ...renderUi(<PetAssistantDialog open petName="Boba" onClose={onClose} />) }
}

beforeEach(async () => {
  useAppStore.setState(originalState)
  setWorkspaceState({
    agentTurns: [], activeConversationId: null, agentChatBusy: false,
    agentStatus: '', pendingAgentConversation: null, error: null
  })
  await i18n.changeLanguage('zh-CN')
})

afterEach(async () => {
  useAppStore.setState(originalState)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
  await i18n.changeLanguage('zh-CN')
})

describe('PetAssistantDialog', () => {
  it.each([
    ['zh-CN', '现在想推进什么？', '输入消息…', '新建对话'],
    ['en-US', 'What would you like to move forward now?', 'Type a message…', 'New conversation']
  ])('renders complete %s copy', async (locale, emptyTitle, placeholder, newConversation) => {
    await i18n.changeLanguage(locale)
    renderDialog()

    expect(screen.getByRole('dialog')).toHaveAccessibleName(new RegExp(locale === 'zh-CN' ? '学习搭档' : 'Study companion'))
    expect(screen.getByText(emptyTitle)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: newConversation })).toBeInTheDocument()
  })

  it('renders pending turns and announces structural run events without replaying streamed tokens', async () => {
    const turns: AgentChatTurn[] = [
      { id: 'u-1', role: 'user', content: 'Plan today', createdAt: '2026-07-15T08:00:00.000Z' },
      { id: 'a-1', role: 'assistant', content: 'First', createdAt: '2026-07-15T08:00:01.000Z' }
    ]
    setWorkspaceState({
      agentTurns: [{ id: 'old', role: 'assistant', content: 'Old result', createdAt: '2026-07-14' }],
      agentChatBusy: true,
      pendingAgentConversation: pending(turns)
    })
    const { container } = renderDialog()

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.queryByText('Old result')).not.toBeInTheDocument()
    expect(container.querySelector('.pet-assistant-thread')).not.toHaveAttribute('aria-live')
    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Assistant 已开始回复。'))
    const announcementKey = status.getAttribute('data-announcement-key')

    act(() => {
      useAppStore.setState({ pendingAgentConversation: pending([
        turns[0], { ...turns[1], content: 'First streamed token' }
      ]) })
    })

    expect(await screen.findByText('First streamed token')).toBeInTheDocument()
    expect(status).toHaveAttribute('data-announcement-key', announcementKey)
    expect(status).toHaveTextContent('Assistant 已开始回复。')
  })

  it('announces an interruption once, focuses its entry, then restores composer focus', async () => {
    const askTurn: AgentChatTurn = {
      id: 'a-ask', role: 'assistant', content: 'Choose', createdAt: '2026-07-15',
      toolCalls: [{
        id: 'ask-1', name: 'ask',
        arguments: JSON.stringify({ questions: [{ question: 'Goal?', options: [{ label: 'A' }, { label: 'B' }] }] })
      }]
    }
    setWorkspaceState({ agentChatBusy: true, pendingAgentConversation: pending([askTurn]) })
    renderDialog()

    const interruption = await screen.findByRole('button', { name: '需要回答一个问题' })
    await waitFor(() => expect(interruption).toHaveFocus())
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Assistant 需要你回答一个问题。')
    const key = status.getAttribute('data-announcement-key')

    act(() => {
      useAppStore.setState({ pendingAgentConversation: pending([{ ...askTurn, toolCalls: [{ ...askTurn.toolCalls![0], result: 'A' }] }]) })
    })

    const input = screen.getByRole('textbox', { name: '给 AI 发送消息' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(status).toHaveAttribute('data-announcement-key', key)
  })

  it('clears draft, imported Todo UI, and conversation identity when starting a new conversation', async () => {
    const saved = summary()
    const todoTurn: AgentChatTurn = {
      id: 'todo-turn', role: 'assistant', createdAt: '2026-07-15',
      content: 'Plan\n```todo\n{"tasks":["Read notes"]}\n```'
    }
    const activeWorkspace = workspace([saved])
    useAppStore.setState((state) => ({
      appState: { ...state.appState, workspaces: [activeWorkspace], activeWorkspace },
      activeConversationId: saved.id,
      agentTurns: [todoTurn]
    }))
    const user = setupUser()
    renderDialog()

    const input = screen.getByRole('textbox', { name: '给 AI 发送消息' })
    await user.type(input, 'unfinished draft')
    await user.click(screen.getByRole('button', { name: /加入今日清单/ }))
    expect(screen.getByRole('button', { name: '已加入今日清单' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '新建对话' }))
    expect(input).toHaveValue('')
    expect(useAppStore.getState().activeConversationId).toBeNull()
    expect(screen.getByText('现在想推进什么？')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '已加入今日清单' })).not.toBeInTheDocument()
  })

  it('preserves IME and Shift+Enter behavior while plain Enter submits', () => {
    const agentChat = vi.fn(async () => {})
    setWorkspaceState({ agentChat })
    renderDialog()
    const input = screen.getByRole('textbox', { name: '给 AI 发送消息' })

    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: false })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, shiftKey: true })
    expect(agentChat).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    expect(agentChat).toHaveBeenCalledWith('hello', { mode: 'temporary' })
  })

  it('clamps damaged geometry in a tiny viewport and provides a keyboard reset action', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 180 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 160 })
    window.localStorage.setItem(PET_ASSISTANT_GEOMETRY_STORAGE_KEY, '{broken')
    const user = setupUser()
    renderDialog()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveStyle({ left: '16px', top: '16px', width: '148px', height: '128px' })

    // Wait for the dialog-open composer autofocus (80ms) to settle first.
    // Otherwise that timer can steal focus from the reset button during keyboard activation.
    const composer = screen.getByRole('textbox', { name: '给 AI 发送消息' })
    await waitFor(() => expect(composer).toHaveFocus())

    const reset = screen.getByRole('button', { name: '重置 Assistant 窗口位置和尺寸' })
    reset.focus()
    await user.keyboard('{Enter}')
    expect(window.localStorage.getItem(PET_ASSISTANT_GEOMETRY_STORAGE_KEY)).toBeNull()
    expect(reset).toHaveFocus()
  })

  it('handles Escape and cleans focus frames plus active pointer capture on unmount', () => {
    const saved = summary()
    const activeWorkspace = workspace([saved])
    useAppStore.setState((state) => ({
      appState: { ...state.appState, workspaces: [activeWorkspace], activeWorkspace },
      activeConversationId: saved.id,
      agentTurns: [{ id: 'a-1', role: 'assistant', content: 'Ready', createdAt: '2026-07-15' }]
    }))
    const onClose = vi.fn()
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 77)
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame')
    const { container, unmount } = renderDialog(onClose)
    const header = container.querySelector<HTMLElement>('.pet-assistant-header')!
    Object.assign(header, {
      setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn()
    })

    fireEvent.keyDown(window, { key: 'Escape', keyCode: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.pointerDown(header, { button: 0, pointerId: 9, clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    unmount()

    expect(cancelFrame).toHaveBeenCalledWith(77)
    expect(header.releasePointerCapture).toHaveBeenCalledWith(9)
    requestFrame.mockRestore()
  })
})
