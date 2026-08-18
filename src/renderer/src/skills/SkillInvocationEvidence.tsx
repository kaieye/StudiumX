import { useId, useState } from 'react'

import type { AgentChatTurn } from '../../../shared/teaching-types'

type SkillInvocationPresentation = NonNullable<AgentChatTurn['metadata']>['skillInvocation']

/**
 * Host-authoritative, privacy-safe projection for ADR-0014 Skill invocations.
 * The invocation body and local filesystem location intentionally never reach
 * this renderer component.
 */
export function SkillInvocationEvidence({ presentation }: {
  presentation: SkillInvocationPresentation
}) {
  const [expanded, setExpanded] = useState(false)
  const detailId = useId()
  if (!presentation) return null

  const name = presentation.displayName || presentation.skillId || 'Skill'
  const stateLabel = presentation.state === 'applied'
    ? '已应用'
    : presentation.state === 'failed'
      ? '调用失败'
      : '调用被拒绝'
  const reasonLabel: Record<NonNullable<typeof presentation.reason>, string> = {
    malformed: '调用格式无效',
    not_installed: '未安装或不存在',
    read_failed: '读取失败',
    empty_body: '正文为空',
    budget_exceeded: '正文超过本地限制'
  }

  return (
    <details
      className="skill-invocation-evidence"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary
        aria-controls={detailId}
        aria-expanded={expanded}
        aria-label={`Skill 调用：${name}，${stateLabel}`}
      >
        <span aria-hidden="true">[skill]</span> {name} · {stateLabel}
      </summary>
      <div id={detailId} className="skill-invocation-evidence__detail">
        {presentation.args ? <p><strong>参数：</strong>{presentation.args}</p> : <p>无附加参数</p>}
        {typeof presentation.bodyChars === 'number' ? <p>已验证正文：{presentation.bodyChars} 字符</p> : null}
        {presentation.invokedAt ? <p>解析时间：{presentation.invokedAt}</p> : null}
        {presentation.reason ? <p>{reasonLabel[presentation.reason]}</p> : null}
        <p>正文与本地路径不会显示在对话投影中。</p>
      </div>
    </details>
  )
}
