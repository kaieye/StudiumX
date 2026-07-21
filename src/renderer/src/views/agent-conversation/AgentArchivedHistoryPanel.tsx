import { Archive, CheckCircle2, ChevronDown, CircleAlert, Database, Loader2, Save, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type {
  AgentArchivedHistoryItem,
  AgentArchivedHistoryItemType,
  AgentConversationCheckpoint,
  QueryAgentArchivedHistoryResult,
  RestoreAgentWriteRewindResult
} from '../../../../shared/teaching-types'

const TYPE_LABELS: Record<AgentArchivedHistoryItemType, string> = {
  conversation_turn: '会话消息',
  session_sidecar: '会话旁路记录',
  tool_result: '工具结果',
  child_transcript: '子代理记录',
  checkpoint: '检查点'
}

export function AgentArchivedHistoryPanel({
  workspaceId,
  conversationId,
  lastAgentRunId
}: {
  workspaceId: string
  conversationId: string
  /** Optional last agent run/stream id used to rewind tool writes (not conversation checkpoints). */
  lastAgentRunId?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [rewinding, setRewinding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<QueryAgentArchivedHistoryResult | null>(null)
  const [checkpoint, setCheckpoint] = useState<AgentConversationCheckpoint | null>(null)
  const [writeRewind, setWriteRewind] = useState<RestoreAgentWriteRewindResult | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const api = window.teachingSystem
    if (!api) return
    setLoading(true)
    setError(null)
    try {
      const query = () => api.queryAgentArchivedHistory({
        workspaceId,
        conversationId,
        scope: 'all',
        limit: 40,
        maxBytes: 128 * 1024,
        maxExcerptBytes: 800
      })
      try {
        setResult(await query())
      } catch (queryError) {
        const message = queryError instanceof Error ? queryError.message : String(queryError)
        if (!/rebuild|index|索引/i.test(message)) throw queryError
        await api.rebuildAgentHistoryIndex({ workspaceId, scope: 'all' })
        setResult(await query())
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [conversationId, workspaceId])

  useEffect(() => {
    setOpen(false)
    setResult(null)
    setCheckpoint(null)
    setWriteRewind(null)
    setError(null)
  }, [conversationId, workspaceId])

  useEffect(() => {
    if (open) void load()
  }, [load, open])

  const createCheckpoint = async (): Promise<void> => {
    const api = window.teachingSystem
    if (!api) return
    setCreating(true)
    setError(null)
    try {
      const created = await api.createAgentConversationCheckpoint({
        workspaceId,
        conversationId,
        label: `手动检查点 ${new Date().toLocaleString()}`,
        reason: '用户从归档历史面板显式创建'
      })
      setCheckpoint(created)
      await api.rebuildAgentHistoryIndex({ workspaceId, scope: 'all' })
      await load()
    } catch (checkpointError) {
      setError(checkpointError instanceof Error ? checkpointError.message : String(checkpointError))
    } finally {
      setCreating(false)
    }
  }

  const rewindToolWrites = async (): Promise<void> => {
    const api = window.teachingSystem
    if (!api || !lastAgentRunId) return
    setRewinding(true)
    setError(null)
    try {
      const restored = await api.restoreAgentWriteRewind({
        workspaceId,
        runId: lastAgentRunId
      })
      setWriteRewind(restored)
    } catch (rewindError) {
      setError(rewindError instanceof Error ? rewindError.message : String(rewindError))
    } finally {
      setRewinding(false)
    }
  }

  return (
    <section className="agent-archived-history" aria-label="归档历史">
      <div className="agent-archived-history__header">
        <button
          className="agent-archived-history__trigger"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Archive size={14} />
          <span>归档历史</span>
          <small>仅在显式打开时检索，不加入模型上下文或学习记忆</small>
          <ChevronDown className={open ? 'is-open' : ''} size={14} />
        </button>
        <button
          className="agent-archived-history__checkpoint"
          type="button"
          disabled={creating}
          title="保存会话前缀检查点（恢复对话轮次，不回滚工具写入）"
          onClick={() => void createCheckpoint()}
        >
          {creating ? <Loader2 className="spin" size={13} /> : <Save size={13} />}
          创建检查点
        </button>
        <button
          className="agent-archived-history__checkpoint"
          type="button"
          disabled={rewinding || !lastAgentRunId}
          title={lastAgentRunId
            ? '撤销本轮工具写入（仅回滚 write_workspace_file 的 pre-image；不是会话检查点）'
            : '需要最近一次 agent runId 才能撤销本轮写入'}
          onClick={() => void rewindToolWrites()}
        >
          {rewinding ? <Loader2 className="spin" size={13} /> : <Undo2 size={13} />}
          撤销本轮写入
        </button>
      </div>

      {open ? (
        <div className="agent-archived-history__body">
          {checkpoint ? (
            <div className="agent-archived-history__notice is-success">
              <CheckCircle2 size={13} />
              已创建会话检查点 {checkpoint.label || checkpoint.checkpointId}（仅对话轮次；不会回滚工具写入）。
            </div>
          ) : null}
          {writeRewind ? (
            <div className="agent-archived-history__notice is-success">
              <CheckCircle2 size={13} />
              已撤销本轮工具写入（run {writeRewind.runId}）：恢复 {writeRewind.restored.length} 个文件，删除 {writeRewind.deleted.length} 个新建文件，跳过 {writeRewind.skipped.length} 项。此操作不是会话检查点。
            </div>
          ) : null}
          {loading ? (
            <div className="agent-archived-history__notice"><Loader2 className="spin" size={13} />正在读取派生索引…</div>
          ) : null}
          {error ? (
            <div className="agent-archived-history__notice is-error"><CircleAlert size={13} />{error}</div>
          ) : null}
          {!loading && !error && result?.items.length === 0 ? (
            <div className="agent-archived-history__notice"><Database size={13} />没有符合条件的归档项。</div>
          ) : null}
          {result?.items.length ? (
            <div className="agent-archived-history__list">
              {result.items.map((item) => <HistoryItem key={item.reference} item={item} />)}
            </div>
          ) : null}
          {result ? (
            <footer className="agent-archived-history__footer">
              <span>{result.usage.items} 项 · {formatBytes(result.usage.bytes)}</span>
              <span>{result.truncated ? '结果已按预算截断' : '结果完整'}</span>
              <span>模型注入：无 · 记忆写入：无</span>
            </footer>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function HistoryItem({ item }: { item: AgentArchivedHistoryItem }) {
  return (
    <article className="agent-archived-history__item">
      <div className="agent-archived-history__item-head">
        <strong>{TYPE_LABELS[item.type]}</strong>
        <time dateTime={item.timestamp}>{formatTimestamp(item.timestamp)}</time>
        <span className={`integrity-${item.integrity}`}>{integrityLabel(item.integrity)}</span>
      </div>
      <p>{item.summary || '无可展示摘要'}</p>
      <div className="agent-archived-history__meta">
        {item.turnId ? <span>来源消息：{item.turnId}</span> : null}
        {item.checkpointIds?.length ? <span>检查点：{item.checkpointIds.join('、')}</span> : null}
        <span>{item.sourceRelativePath}</span>
      </div>
    </article>
  )
}

function integrityLabel(integrity: AgentArchivedHistoryItem['integrity']): string {
  if (integrity === 'verified') return '完整性已验证'
  if (integrity === 'missing') return '文件缺失'
  if (integrity === 'hash_mismatch') return '哈希不匹配'
  return '无需校验'
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
