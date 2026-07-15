import { ArrowUpRight, MessageCircle, Plus, SendHorizontal, Square, X } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { selectPendingAsk, selectPendingToolPermission } from '../../agent-conversation-state'
import { useAppStore } from '../../app-shell/appStore'
import { AssistantTodoCapture } from '../../study-space/assistantTodo'
import {
  PET_ASSISTANT_GEOMETRY_STORAGE_KEY,
  canFinishAssistantDialogInteraction,
  clampAssistantDialogGeometry,
  defaultAssistantDialogGeometry,
  parseStoredAssistantDialogGeometry,
  projectAssistantDialogInteraction,
  serializeAssistantDialogGeometry,
  startAssistantDialogInteraction,
  type AssistantDialogGeometry,
  type AssistantDialogInteraction,
  type AssistantDialogResizeDirection
} from './pet-interaction'

type PetAssistantDialogProps = {
  open: boolean
  petName: string
  onClose: (options?: { restoreFocus?: boolean }) => void
}

function isImeComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return Boolean(event.isComposing || event.keyCode === 229)
}

const suggestions = [
  '帮我制作今天的 TodoList，按优先级拆成可执行任务',
  '根据我现在的目标安排一轮专注计划',
  '把一个复杂任务拆成可以立即开始的小步骤'
]

const resizeDirections = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const satisfies readonly AssistantDialogResizeDirection[]

type ResizeDirection = AssistantDialogResizeDirection
type DialogGeometry = AssistantDialogGeometry
type DialogPointerInteraction = {
  interaction: AssistantDialogInteraction
  captureElement: HTMLElement
}

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function storedDialogGeometry(): DialogGeometry | null {
  try {
    const geometry = parseStoredAssistantDialogGeometry(
      window.localStorage.getItem(PET_ASSISTANT_GEOMETRY_STORAGE_KEY)
    )
    return geometry ? clampAssistantDialogGeometry(geometry, viewport()) : null
  } catch {
    return null
  }
}

function persistDialogGeometry(geometry: DialogGeometry): void {
  try {
    window.localStorage.setItem(PET_ASSISTANT_GEOMETRY_STORAGE_KEY, serializeAssistantDialogGeometry(geometry))
  } catch {
    // The dialog remains usable when storage is unavailable.
  }
}

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
  const restorePendingAgentConversation = useAppStore((state) => state.restorePendingAgentConversation)
  const rememberAgentInput = useAppStore((state) => state.rememberAgentInput)
  const openExternal = useAppStore((state) => state.openExternal)
  const setOverviewDialogMode = useAppStore((state) => state.setOverviewDialogMode)
  const setView = useAppStore((state) => state.setView)
  const [input, setInput] = useState('')
  const [importedTodoTurns, setImportedTodoTurns] = useState<Set<string>>(() => new Set())
  const customizedGeometryRef = useRef(false)
  const [geometry, setGeometry] = useState<DialogGeometry>(() => {
    const stored = storedDialogGeometry()
    customizedGeometryRef.current = Boolean(stored)
    return stored ?? defaultAssistantDialogGeometry(viewport())
  })
  const dialogRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const interruptionRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<DialogPointerInteraction | null>(null)
  const pendingStreamId = pendingConversation?.summary.id ?? null
  const pendingTurns = pendingConversation?.turns ?? agentTurns
  const pendingAsk = pendingStreamId ? selectPendingAsk(pendingTurns, pendingStreamId) : null
  const pendingPermission = pendingStreamId ? selectPendingToolPermission(pendingTurns, pendingStreamId) : null
  const hasInterruption = Boolean(pendingAsk || pendingPermission)
  const canSend = Boolean(activeWorkspace && input.trim() && !agentChatBusy && !hasInterruption)

  useEffect(() => {
    if (!open) return
    const focusTimer = window.setTimeout(() => {
      const input = inputRef.current
      if (input && !input.disabled) input.focus()
      else (interruptionRef.current ?? closeButtonRef.current ?? dialogRef.current)?.focus()
    }, 80)
    const handleEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !isImeComposing(event)) onClose()
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
    if (!thread) return

    if (typeof thread.scrollTo === 'function') {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      thread.scrollTo({ top: thread.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' })
    } else {
      thread.scrollTop = thread.scrollHeight
    }
  }, [agentStatus, agentTurns, open])

  useEffect(() => {
    const handleWindowResize = (): void => {
      setGeometry((current) => (
        customizedGeometryRef.current
          ? clampAssistantDialogGeometry(current, viewport())
          : defaultAssistantDialogGeometry(viewport())
      ))
    }
    handleWindowResize()
    window.addEventListener('resize', handleWindowResize)
    return () => window.removeEventListener('resize', handleWindowResize)
  }, [])

  if (!open) return null

  const sendPrompt = (rawPrompt: string): void => {
    const prompt = rawPrompt.trim()
    if (!activeWorkspace || !prompt || agentChatBusy || hasInterruption) return
    rememberAgentInput(prompt)
    setInput('')
    void agentChat(AssistantTodoCapture.preparePrompt(prompt), { mode: 'temporary' })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    sendPrompt(input)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || isImeComposing(event.nativeEvent)) return
    event.preventDefault()
    if (canSend) sendPrompt(input)
  }

  const openFullConversation = (): void => {
    if (pendingConversation) restorePendingAgentConversation()
    setOverviewDialogMode('chat')
    setView('agent')
    onClose({ restoreFocus: false })
  }

  const importTodo = (turnId: string, titles: string[]): void => {
    AssistantTodoCapture.importTasks(titles)
    setImportedTodoTurns((current) => new Set(current).add(turnId))
  }

  const startInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    mode: AssistantDialogInteraction['mode'],
    direction?: ResizeDirection
  ): void => {
    if (event.button !== 0) return
    if (mode === 'drag' && (event.target as HTMLElement).closest('button')) return
    customizedGeometryRef.current = true
    interactionRef.current = {
      captureElement: event.currentTarget,
      interaction: startAssistantDialogInteraction({
        pointerId: event.pointerId,
        mode,
        direction,
        startPoint: { x: event.clientX, y: event.clientY },
        startGeometry: geometry
      })
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveInteraction = (event: ReactPointerEvent<HTMLElement>): void => {
    const activeInteraction = interactionRef.current
    if (!activeInteraction) return
    const nextGeometry = projectAssistantDialogInteraction(
      activeInteraction.interaction,
      event.pointerId,
      { x: event.clientX, y: event.clientY },
      viewport()
    )
    if (nextGeometry) setGeometry(nextGeometry)
  }

  const finishInteraction = (event: ReactPointerEvent<HTMLElement>): void => {
    const activeInteraction = interactionRef.current
    if (!activeInteraction || !canFinishAssistantDialogInteraction(activeInteraction.interaction, event.pointerId)) return
    interactionRef.current = null
    if (activeInteraction.captureElement.hasPointerCapture(event.pointerId)) {
      activeInteraction.captureElement.releasePointerCapture(event.pointerId)
    }
    setGeometry((current) => {
      persistDialogGeometry(current)
      return current
    })
  }

  return (
    <section
      ref={dialogRef}
      id="pet-assistant-dialog"
      className="pet-assistant-dialog"
      role="dialog"
      aria-label={`${petName} AI 对话`}
      aria-modal="false"
      tabIndex={-1}
      style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }}
    >
      <header
        className="pet-assistant-header"
        onPointerDown={(event) => startInteraction(event, 'drag')}
        onPointerMove={moveInteraction}
        onPointerUp={finishInteraction}
        onPointerCancel={finishInteraction}
      >
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
        <button ref={closeButtonRef} type="button" onClick={() => onClose()} aria-label="关闭对话" title="关闭对话">
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
            const todoInspection = turn.role === 'assistant'
              ? AssistantTodoCapture.inspectAssistantTurn(turn.content)
              : null
            const todoTitles = todoInspection?.tasks ?? []
            const visibleContent = todoInspection?.visibleContent ?? turn.content
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
        <button ref={interruptionRef} className="pet-assistant-interruption" type="button" onClick={openFullConversation}>
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

      {resizeDirections.map((direction) => (
        <span
          key={direction}
          className={`pet-assistant-resize-handle is-${direction}`}
          aria-hidden="true"
          onPointerDown={(event) => startInteraction(event, 'resize', direction)}
          onPointerMove={moveInteraction}
          onPointerUp={finishInteraction}
          onPointerCancel={finishInteraction}
        />
      ))}
    </section>
  )
}
