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

const DIALOG_GEOMETRY_KEY = 'studiumx-pet-assistant-geometry-v1'
const DIALOG_EDGE_GAP = 16
const DIALOG_MIN_WIDTH = 300
const DIALOG_MIN_HEIGHT = 320
const DIALOG_DEFAULT_WIDTH = 380
const DIALOG_DEFAULT_HEIGHT = 560

const resizeDirections = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'] as const

type ResizeDirection = (typeof resizeDirections)[number]

type DialogGeometry = {
  x: number
  y: number
  width: number
  height: number
}

type DialogInteraction = {
  pointerId: number
  captureElement: HTMLElement
  mode: 'drag' | 'resize'
  direction?: ResizeDirection
  startX: number
  startY: number
  startGeometry: DialogGeometry
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function clampDialogGeometry(geometry: DialogGeometry): DialogGeometry {
  const availableWidth = Math.max(1, window.innerWidth - DIALOG_EDGE_GAP * 2)
  const availableHeight = Math.max(1, window.innerHeight - DIALOG_EDGE_GAP * 2)
  const minimumWidth = Math.min(DIALOG_MIN_WIDTH, availableWidth)
  const minimumHeight = Math.min(DIALOG_MIN_HEIGHT, availableHeight)
  const width = clamp(geometry.width, minimumWidth, availableWidth)
  const height = clamp(geometry.height, minimumHeight, availableHeight)

  return {
    x: clamp(geometry.x, DIALOG_EDGE_GAP, Math.max(DIALOG_EDGE_GAP, window.innerWidth - width - DIALOG_EDGE_GAP)),
    y: clamp(geometry.y, DIALOG_EDGE_GAP, Math.max(DIALOG_EDGE_GAP, window.innerHeight - height - DIALOG_EDGE_GAP)),
    width,
    height
  }
}

function defaultDialogGeometry(): DialogGeometry {
  const width = Math.min(DIALOG_DEFAULT_WIDTH, Math.max(1, window.innerWidth - DIALOG_EDGE_GAP * 2))
  const height = Math.min(DIALOG_DEFAULT_HEIGHT, Math.max(1, window.innerHeight - DIALOG_EDGE_GAP * 2))
  return clampDialogGeometry({
    x: window.innerWidth - width - DIALOG_EDGE_GAP,
    y: window.innerHeight - height - DIALOG_EDGE_GAP,
    width,
    height
  })
}

function storedDialogGeometry(): DialogGeometry | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DIALOG_GEOMETRY_KEY) ?? 'null') as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Record<string, unknown>
    if (
      typeof candidate.x !== 'number' ||
      typeof candidate.y !== 'number' ||
      typeof candidate.width !== 'number' ||
      typeof candidate.height !== 'number' ||
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y) ||
      !Number.isFinite(candidate.width) ||
      !Number.isFinite(candidate.height)
    ) return null
    return clampDialogGeometry({
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height
    })
  } catch {
    return null
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
    return stored ?? defaultDialogGeometry()
  })
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const interactionRef = useRef<DialogInteraction | null>(null)
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

  useEffect(() => {
    const handleWindowResize = (): void => {
      setGeometry((current) => (
        customizedGeometryRef.current ? clampDialogGeometry(current) : defaultDialogGeometry()
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

  const startInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    mode: DialogInteraction['mode'],
    direction?: ResizeDirection
  ): void => {
    if (event.button !== 0) return
    if (mode === 'drag' && (event.target as HTMLElement).closest('button')) return
    customizedGeometryRef.current = true
    interactionRef.current = {
      pointerId: event.pointerId,
      captureElement: event.currentTarget,
      mode,
      direction,
      startX: event.clientX,
      startY: event.clientY,
      startGeometry: geometry
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const moveInteraction = (event: ReactPointerEvent<HTMLElement>): void => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    const dx = event.clientX - interaction.startX
    const dy = event.clientY - interaction.startY
    const start = interaction.startGeometry

    if (interaction.mode === 'drag') {
      setGeometry(clampDialogGeometry({ ...start, x: start.x + dx, y: start.y + dy }))
      return
    }

    const direction = interaction.direction
    if (!direction) return
    const next = { ...start }
    const availableWidth = Math.max(1, window.innerWidth - DIALOG_EDGE_GAP * 2)
    const availableHeight = Math.max(1, window.innerHeight - DIALOG_EDGE_GAP * 2)
    const minimumWidth = Math.min(DIALOG_MIN_WIDTH, availableWidth)
    const minimumHeight = Math.min(DIALOG_MIN_HEIGHT, availableHeight)

    if (direction.includes('w')) {
      const right = start.x + start.width
      next.width = clamp(start.width - dx, minimumWidth, right - DIALOG_EDGE_GAP)
      next.x = right - next.width
    } else if (direction.includes('e')) {
      next.width = clamp(
        start.width + dx,
        minimumWidth,
        window.innerWidth - start.x - DIALOG_EDGE_GAP
      )
    }

    if (direction.includes('n')) {
      const bottom = start.y + start.height
      next.height = clamp(start.height - dy, minimumHeight, bottom - DIALOG_EDGE_GAP)
      next.y = bottom - next.height
    } else if (direction.includes('s')) {
      next.height = clamp(
        start.height + dy,
        minimumHeight,
        window.innerHeight - start.y - DIALOG_EDGE_GAP
      )
    }

    setGeometry(clampDialogGeometry(next))
  }

  const finishInteraction = (event: ReactPointerEvent<HTMLElement>): void => {
    const interaction = interactionRef.current
    if (!interaction || interaction.pointerId !== event.pointerId) return
    interactionRef.current = null
    if (interaction.captureElement.hasPointerCapture(event.pointerId)) {
      interaction.captureElement.releasePointerCapture(event.pointerId)
    }
    setGeometry((current) => {
      try {
        window.localStorage.setItem(DIALOG_GEOMETRY_KEY, JSON.stringify(current))
      } catch {
        // The dialog remains usable when storage is unavailable.
      }
      return current
    })
  }

  return (
    <section
      className="pet-assistant-dialog"
      role="dialog"
      aria-label={`${petName} AI 对话`}
      aria-modal="false"
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
