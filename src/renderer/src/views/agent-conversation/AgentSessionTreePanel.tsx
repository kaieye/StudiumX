import { Archive, GitBranch, GitFork, History, Play, RotateCcw, Trash2 } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
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
      <header><GitBranch size={14} /><strong>会话分支</strong><span>{branches.length} 个</span></header>
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
                <small>{statusLabel(node.status)} · head {node.head.turnId ?? '空'} · {node.head.turnCount} turns · r{node.revision}</small>
              </div>
              <div className="agent-session-tree__actions">
                <button aria-label={`打开分支 ${node.title}`} disabled={working || current || deleted || archived} onClick={() => void run(() => onOpen(node.conversationId))}><Play size={11} />打开</button>
                <button aria-label={`从分支 ${node.title} 的 head 创建分支`} disabled={working || deleted} onClick={() => void run(() => onFork(node.conversationId, sourceTurnId, node.revision))}><GitFork size={11} />Fork</button>
                <button
                  aria-label={`安全回放分支 ${node.title}`}
                  disabled={working || deleted}
                  onClick={() => void run(async () => {
                    setReplayPreview(null)
                    const turns = await onReplay(node.conversationId, sourceTurnId)
                    if (turns !== null) setReplayPreview(turns)
                  })}
                ><History size={11} />回放</button>
                {archived
                  ? <button aria-label={`恢复分支 ${node.title}`} disabled={working} onClick={() => void run(() => onStatus(node.conversationId, 'active', node.revision))}><RotateCcw size={11} />恢复</button>
                  : node.status === 'active'
                    ? <button aria-label={`归档分支 ${node.title}`} disabled={working || lastActive} title={lastActive ? '至少保留一个活跃分支' : undefined} onClick={() => void run(() => onStatus(node.conversationId, 'archived', node.revision))}><Archive size={11} />归档</button>
                    : null}
                <button
                  aria-label={`删除分支 ${node.title}`}
                  disabled={working || deleted || lastActive}
                  title={lastActive ? '至少保留一个活跃分支' : undefined}
                  onClick={() => {
                    if (!window.confirm(`确定永久删除分支“${node.title}”吗？该操作会保留 tombstone，但无法在界面中恢复。`)) return
                    void run(() => onStatus(node.conversationId, 'deleted', node.revision))
                  }}
                ><Trash2 size={11} />删除</button>
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

export function AgentTurnProvenance({ turn, canFork, onFork }: { turn: AgentChatTurn; canFork: boolean; onFork: (turnId: string) => void }) {
  const provenance = presentAgentTurnProvenance(turn)
  return (
    <div className={`agent-turn-provenance kind-${provenance.kind}`}>
      <span title={provenance.detail}>{provenance.label}</span>
      {canFork && provenance.kind !== 'recovery_notice'
        ? <button type="button" aria-label={`从轮次 ${turn.id} 创建分支`} onClick={() => onFork(turn.id)}><GitFork size={11} />Fork</button>
        : null}
    </div>
  )
}

function statusLabel(status: AgentConversationBranchStatus): string {
  return status === 'archived' ? '已归档' : status === 'deleted' ? '已删除' : '活跃'
}
