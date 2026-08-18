import { ChevronLeft, ChevronRight, Copy, GitFork, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  AgentChatTurn,
  AgentConversationBranchStatus,
  AgentConversationSessionTree,
  AgentConversationSessionTreeNode
} from '../../../../shared/teaching-types'
import { presentAgentTurnProvenance } from '../../agent-conversation-state'
import './agent-session-tree-panel.css'

export type FlatAgentSessionBranch = { node: AgentConversationSessionTreeNode; depth: number }

export function flattenAgentSessionTree(tree: AgentConversationSessionTree): FlatAgentSessionBranch[] {
  const ids = new Set(tree.branches.map((branch) => branch.branchId))
  const children = new Map<string, AgentConversationSessionTreeNode[]>()
  const roots: AgentConversationSessionTreeNode[] = []
  for (const branch of tree.branches) {
    if (!branch.parentBranchId || !ids.has(branch.parentBranchId) || branch.parentBranchId === branch.branchId) roots.push(branch)
    else children.set(branch.parentBranchId, [...(children.get(branch.parentBranchId) ?? []), branch])
  }
  const result: FlatAgentSessionBranch[] = []
  const visited = new Set<string>()
  const visit = (node: AgentConversationSessionTreeNode, depth: number): void => {
    if (visited.has(node.branchId)) return
    visited.add(node.branchId)
    result.push({ node, depth })
    for (const child of children.get(node.branchId) ?? []) visit(child, depth + 1)
  }
  roots.forEach((root) => visit(root, 0))
  tree.branches.forEach((branch) => visit(branch, 0))
  return result
}

export function AgentSessionTreePanel({
  tree,
  activeConversationId,
  onOpen,
  onFork,
  onReplay,
  onStatus
}: {
  tree: AgentConversationSessionTree
  activeConversationId: string
  onOpen: (conversationId: string) => Promise<void>
  onFork: (conversationId: string, sourceTurnId: string | undefined, expectedRevision: number) => Promise<void>
  onReplay: (conversationId: string, sourceTurnId?: string) => Promise<AgentChatTurn[] | null>
  onStatus: (conversationId: string, status: AgentConversationBranchStatus, revision: number) => Promise<void>
}) {
  const branches = useMemo(() => flattenAgentSessionTree(tree), [tree])
  const activeBranchCount = useMemo(
    () => tree.branches.filter((branch) => branch.status === 'active').length,
    [tree]
  )
  const [working, setWorking] = useState(false)
  const [replayPreview, setReplayPreview] = useState<AgentChatTurn[] | null>(null)
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (working) return
    setWorking(true)
    try {
      await action()
    } catch {
      // Store actions surface errors through the shared application error state.
    } finally {
      setWorking(false)
    }
  }
  return (
    <section className="agent-session-tree" aria-label="会话分支">
      <header><strong>会话分支</strong><span>{branches.length} 个</span></header>
      <div role="list" aria-label="会话分支树">
        {branches.map(({ node, depth }) => {
          const current = node.conversationId === activeConversationId
          const deleted = node.status === 'deleted'
          const archived = node.status === 'archived'
          const lastActive = node.status === 'active' && activeBranchCount <= 1
          const sourceTurnId = node.head.turnId ?? undefined
          return (
            <div
              role="listitem"
              aria-current={current ? 'true' : undefined}
              className={`agent-session-tree__row status-${node.status}${current ? ' is-current' : ''}`}
              style={{ '--branch-depth': depth } as CSSProperties}
              key={node.branchId}
            >
              <div className="agent-session-tree__copy">
                <strong>{node.title}</strong>
                <small>{statusLabel(node.status)}</small>
              </div>
              <div className="agent-session-tree__actions">
                <button aria-label={`打开分支 ${node.title}`} disabled={working || current || deleted || archived} onClick={() => void run(() => onOpen(node.conversationId))}>打开</button>
                <button aria-label={`从分支 ${node.title} 的 head 创建分支`} disabled={working || deleted} onClick={() => void run(() => onFork(node.conversationId, sourceTurnId, node.revision))}>Fork</button>
                <button
                  aria-label={`安全回放分支 ${node.title}`}
                  disabled={working || deleted}
                  onClick={() => void run(async () => {
                    setReplayPreview(null)
                    const turns = await onReplay(node.conversationId, sourceTurnId)
                    if (turns !== null) setReplayPreview(turns)
                  })}
                >回放</button>
                {archived
                  ? <button aria-label={`恢复分支 ${node.title}`} disabled={working} onClick={() => void run(() => onStatus(node.conversationId, 'active', node.revision))}>恢复</button>
                  : node.status === 'active'
                    ? <button aria-label={`归档分支 ${node.title}`} disabled={working || lastActive} title={lastActive ? '至少保留一个活跃分支' : undefined} onClick={() => void run(() => onStatus(node.conversationId, 'archived', node.revision))}>归档</button>
                    : null}
                <button
                  aria-label={`删除分支 ${node.title}`}
                  disabled={working || deleted || lastActive}
                  title={lastActive ? '至少保留一个活跃分支' : undefined}
                  onClick={() => {
                    if (!window.confirm(`确定永久删除分支“${node.title}”吗？该操作会保留 tombstone，但无法在界面中恢复。`)) return
                    void run(() => onStatus(node.conversationId, 'deleted', node.revision))
                  }}
                >删除</button>
              </div>
            </div>
          )
        })}
      </div>
      {replayPreview !== null ? (
        <div className="agent-session-tree__replay" role="region" aria-label="安全回放预览">
          <p>安全回放预览已生成 {replayPreview.length} 个 turn；未调用 Agent loop，也未重放工具。</p>
          {replayPreview.map((turn) => {
            const provenance = presentAgentTurnProvenance(turn)
            return (
              <article key={turn.id}>
                <header><strong>{turn.role === 'user' ? '用户' : '助手'}</strong><span>{provenance.label}</span></header>
                <p>{turn.content || '（空内容）'}</p>
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

export type AgentMessageActionsProps = {
  turn: AgentChatTurn
  canFork: boolean
  canEdit: boolean
  disabled?: boolean
  onFork: (turnId: string) => void
  onEdit: (turn: AgentChatTurn) => void
  onCopy: (content: string) => void | Promise<void>
  branchNavigation?: {
    current: number
    total: number
    onPrevious: () => void
    onNext: () => void
  }
}

/** In-flow message actions mirroring the conversation chrome. Branch details live in the left session list. */
export function AgentMessageActions({
  turn,
  canFork,
  canEdit,
  disabled = false,
  onFork,
  onEdit,
  onCopy,
  branchNavigation
}: AgentMessageActionsProps) {
  const showCopy = Boolean(turn.content)
  const showFork = canFork && turn.metadata?.provenance?.kind !== 'recovery_notice'
  const showEdit = canEdit && turn.role === 'user' && turn.metadata?.provenance?.kind !== 'recovery_notice'
  if (!showCopy && !showFork && !showEdit && !branchNavigation) return null
  const messageTime = formatMessageTime(turn.createdAt)
  const time = messageTime ? (
    <time className="agent-message-time" dateTime={turn.createdAt}>{messageTime}</time>
  ) : null

  return (
    <div className="agent-message-actions" role="toolbar" aria-label="消息操作">
      {turn.role === 'user' ? time : null}
      <button
        type="button"
        className="agent-message-action"
        aria-label="复制消息"
        title="复制"
        disabled={disabled || !showCopy}
        onClick={() => { void onCopy(turn.content) }}
      >
        <Copy size={16} strokeWidth={1.8} />
      </button>
      {showFork ? (
        <button
          type="button"
          className="agent-message-action"
          aria-label="从轮次创建分支"
          title="创建分支"
          disabled={disabled}
          onClick={() => onFork(turn.id)}
        >
          <GitFork size={16} strokeWidth={1.8} />
        </button>
      ) : null}
      {showEdit ? (
        <button
          type="button"
          className="agent-message-action"
          aria-label="重新编辑并发送"
          title="重新编辑"
          disabled={disabled}
          onClick={() => onEdit(turn)}
        >
          <Pencil size={16} strokeWidth={1.8} />
        </button>
      ) : null}
      {branchNavigation ? (
        <div className="agent-message-branch-pager" aria-label={`分支 ${branchNavigation.current}/${branchNavigation.total}`}>
          <button
            type="button"
            className="agent-message-action agent-message-branch-pager__button"
            aria-label="上一分支"
            title="上一分支"
            disabled={disabled || branchNavigation.current <= 1}
            onClick={branchNavigation.onPrevious}
          >
            <ChevronLeft size={17} strokeWidth={1.8} />
          </button>
          <span aria-live="polite">{branchNavigation.current}/{branchNavigation.total}</span>
          <button
            type="button"
            className="agent-message-action agent-message-branch-pager__button"
            aria-label="下一分支"
            title="下一分支"
            disabled={disabled || branchNavigation.current >= branchNavigation.total}
            onClick={branchNavigation.onNext}
          >
            <ChevronRight size={17} strokeWidth={1.8} />
          </button>
        </div>
      ) : null}
      {turn.role === 'assistant' ? time : null}
    </div>
  )
}

function formatMessageTime(createdAt: string): string | null {
  const timestamp = new Date(createdAt)
  if (Number.isNaN(timestamp.valueOf())) return null
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

export type AgentMessageEditorProps = {
  initialValue: string
  busy?: boolean
  onCancel: () => void
  onSubmit: (value: string) => void
}

export function AgentMessageEditor({
  initialValue,
  busy = false,
  onCancel,
  onSubmit
}: AgentMessageEditorProps) {
  const [value, setValue] = useState(initialValue)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.focus()
    node.selectionStart = node.value.length
    node.selectionEnd = node.value.length
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`
  }, [initialValue])

  const submit = (): void => {
    const next = value.trim()
    if (!next || busy) return
    onSubmit(next)
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="agent-message-editor">
      <textarea
        ref={textareaRef}
        value={value}
        disabled={busy}
        aria-label="重新编辑消息"
        onChange={(event) => {
          setValue(event.target.value)
          const node = event.currentTarget
          node.style.height = 'auto'
          node.style.height = `${Math.min(node.scrollHeight, 180)}px`
        }}
        onKeyDown={onKeyDown}
      />
      <div className="agent-message-editor__actions">
        <button type="button" className="agent-message-editor__cancel" disabled={busy} onClick={onCancel}>
          <X size={13} />
          取消
        </button>
        <button type="button" className="agent-message-editor__send" disabled={busy || !value.trim()} onClick={submit}>
          发送
        </button>
      </div>
    </div>
  )
}

/** @deprecated Prefer AgentMessageActions in the chat thread. Kept for diagnostic previews. */
export function AgentTurnProvenance({ turn, canFork, onFork }: { turn: AgentChatTurn; canFork: boolean; onFork: (turnId: string) => void }) {
  return (
    <AgentMessageActions
      turn={turn}
      canFork={canFork}
      canEdit={false}
      onFork={onFork}
      onEdit={() => undefined}
      onCopy={() => undefined}
    />
  )
}

function statusLabel(status: AgentConversationBranchStatus): string {
  return status === 'archived' ? '已归档' : status === 'deleted' ? '已删除' : '活跃'
}
