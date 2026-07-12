import { ArrowUpRight, MessageCircle, Plus, SendHorizontal, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { selectPendingAsk, selectPendingToolPermission } from '../../agent-conversation-state'
import { useAppStore } from '../../app-shell/appStore'
import {
  appendAssistantTodoTasks,
  appendTodoOutputContract,
  parseAssistantTodoPayload,
  stripAssistantTodoPayload
} from '../../study-space/assistantTodo'

type PetAssistantDialogProps = {
  open: boolean
  petName: string
  onClose: () => void
}

const suggestions = [
  '帮我制作今天的 TodoList，按优先级拆成可执行任务',
  '根据我现在的目标安排一轮专注计划',
  '把一个复杂任务拆成可以立即开始的小步骤'
]

export function PetAssistantDialog({ open, petName, onClose }: PetAssistantDialogProps) {
  const activeWorkspace = useAppStore((state) => state.appState.activeWorkspace)
  const agentTurns = useAppStore((state) => state.agentTurns)
  const agentChatBusy = useAppStore((state) => state.agentChatBusy)
  const agentStatus = useAppStore((state) => state.agentStatus)
  const error = useAppStore((state) => state.error)
  const pendingConversation = useAppStore((state) => state.pendingAgentConversation)
  const agentChat = useAppStore((state) => state.agentChat)
  const cancelAgentChat = useAppStore((state) => state.cancelAgentChat)
  const clearAgentChat = useAppStore((state) => state.clearAgentChat)
  const rememberAgentInput = useAppStore((state) => state.rememberAgentInput)
  const openExternal = useAppStore((state) => state.openExternal)
  const setOverviewDialogMode = useAppStore((state) => state.setOverviewDialogMode)
  const setView = useAppStore((state) => state.setView)
  const [input, setInput] = useState('')
  const [importedTodoTurns, setImportedTodoTurns] = useState<Set<string>>(() => new Set())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const pendingStreamId = pendingConversation?.summary.id ?? null
  const pendingAsk = pendingStreamId ? selectPendingAsk(agentTurns, pendingStreamId) : null
  const pendingPermission = pendingStreamId ? selectPendingToolPermission(agentTurns, pendingStreamId) : null
  const hasInterruption = Boolean(pendingAsk || pendingPermission)
  const canSend = Boolean(activeWorkspace && input.trim() && !agentChatBusy && !hasInterruption)

  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 80)
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose, open])

  useEffect(() => {
    if (!open) return
    const thread = threadRef.current
    if (thread) thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' })
  }, [agentStatus, agentTurns, open])

  if (!open) return null

  const sendPrompt = (rawPrompt: string): void => {
    const prompt = rawPrompt.trim()
    if (!activeWorkspace || !prompt || agentChatBusy || hasInterruption) return
    rememberAgentInput(prompt)
    setInput('')
    void agentChat(appendTodoOutputContract(prompt), { mode: 'temporary' })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    sendPrompt(input)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (canSend) sendPrompt(input)
  }

  const openFullConversation = (): void => {
    setOverviewDialogMode('chat')
    setView('agent')
    onClose()
  }

  const importTodo = (turnId: string, titles: string[]): void => {
    appendAssistantTodoTasks(titles)
    setImportedTodoTurns((current) => new Set(current).add(turnId))
  }

  return (
    <section className="pet-assistant-dialog" role="dialog" aria-label={`${petName} AI 对话`} aria-modal="false">
      <header className="pet-assistant-header">
        <span className="pet-assistant-title-icon" aria-hidden="true"><MessageCircle size={16} /></span>
        <span>
          <strong>{petName}</strong>
          <small>{agentChatBusy ? agentStatus || '正在思考' : '学习搭档'}</small>
        </span>
        <button
          type="button"
          onClick={clearAgentChat}
          disabled={agentChatBusy || agentTurns.length === 0}
          aria-label="新建对话"
          title="新建对话"
        >
          <Plus size={15} />
        </button>
        <button type="button" onClick={onClose} aria-label="关闭对话" title="关闭对话">
          <X size={16} />
        </button>
      </header>

      <div ref={threadRef} className="pet-assistant-thread" aria-live="polite">
        {agentTurns.length === 0 ? (
          <div className="pet-assistant-empty">
            <MessageCircle size={22} />
            <strong>现在想推进什么？</strong>
            <div className="pet-assistant-suggestions">
              {suggestions.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => sendPrompt(suggestion)} disabled={!activeWorkspace}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          agentTurns.map((turn) => {
            const todoTitles = turn.role === 'assistant' ? parseAssistantTodoPayload(turn.content) : []
            const visibleContent = turn.role === 'assistant'
              ? stripAssistantTodoPayload(turn.content)
              : turn.content
            const imported = importedTodoTurns.has(turn.id)
            return (
              <article key={turn.id} className={`pet-assistant-message is-${turn.role}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        rel="noreferrer"
                        onClick={(event) => {
                          event.preventDefault()
                          if (href) void openExternal(href)
                        }}
                      >
                        {children}
                      </a>
                    )
                  }}
                >
                  {visibleContent || (agentChatBusy ? '正在回复...' : '')}
                </ReactMarkdown>
                {todoTitles.length > 0 ? (
                  <button
                    className="pet-assistant-todo-import"
                    type="button"
                    onClick={() => importTodo(turn.id, todoTitles)}
                    disabled={imported}
                  >
                    {imported ? '已加入今日清单' : `加入今日清单 · ${todoTitles.length} 项`}
                  </button>
                ) : null}
              </article>
            )
          })
        )}
        {error ? <div className="pet-assistant-error">{error.message}</div> : null}
      </div>

      {hasInterruption ? (
        <button className="pet-assistant-interruption" type="button" onClick={openFullConversation}>
          <span>{pendingPermission ? '需要确认工具权限' : '需要回答一个问题'}</span>
          <ArrowUpRight size={14} />
        </button>
      ) : null}

      <form className="pet-assistant-composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={activeWorkspace ? '输入消息...' : '请先创建或导入学习空间'}
          aria-label="给 AI 发送消息"
          disabled={!activeWorkspace || hasInterruption}
          rows={2}
        />
        <button
          type={agentChatBusy ? 'button' : 'submit'}
          onClick={agentChatBusy ? () => void cancelAgentChat() : undefined}
          disabled={agentChatBusy ? false : !canSend}
          aria-label={agentChatBusy ? '停止回复' : '发送消息'}
          title={agentChatBusy ? '停止回复' : '发送消息'}
        >
          {agentChatBusy ? <Square size={15} /> : <SendHorizontal size={16} />}
        </button>
      </form>
    </section>
  )
}
