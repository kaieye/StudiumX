import { describe, expect, it } from 'vitest'
import { AgentConversationReader } from '../../src/renderer/src/views/agent-conversation/AgentConversationReader'
import type { AgentConversationTurnPresentation } from '../../src/renderer/src/agent-conversation-presentation'
import { renderUi, screen, setupUser, waitFor } from '../helpers/render'

function presentation(state: 'active' | 'complete'): AgentConversationTurnPresentation {
  return {
    turnId: 'assistant-1',
    active: state === 'active',
    status: { kind: state === 'active' ? 'active' : 'completed' },
    answeredAsks: [],
    sources: [],
    items: [
      {
        id: 'reasoning-1', kind: 'reasoning', label: '思考过程',
        detail: '好，让我接下来写入文件。', state
      },
      {
        id: 'status-1', kind: 'status', label: state === 'active' ? '正在准备写入' : '处理完成', state
      }
    ]
  }
}

describe('AgentConversationReader reasoning boundary', () => {
  it('does not render raw provider reasoning supplied by a legacy presentation', () => {
    renderUi(<AgentConversationReader presentation={presentation('active')} />)

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('正在准备写入')
    expect(panel).not.toHaveTextContent('好，让我接下来写入文件。')
    expect(panel).not.toHaveTextContent('思考过程')
  })

  it('does not create a process panel when reasoning is the only legacy item', () => {
    renderUi(<AgentConversationReader presentation={{ ...presentation('active'), items: [presentation('active').items[0]] }} />)

    expect(screen.queryByRole('region', { name: 'AI 处理过程' })).toBeNull()
  })
})

describe('AgentConversationReader file-touch projection', () => {
  it('does not render the files-touched card or create a standalone process panel', () => {
    renderUi(
      <AgentConversationReader
        presentation={{
          turnId: 'file-touch-only',
          active: false,
          status: { kind: 'completed' },
          answeredAsks: [],
          sources: [],
          items: [],
          fileTouches: {
            title: '本回合触碰的文件',
            role: 'reference_projection',
            caption: '参考投影',
            empty: false,
            rows: [{ id: 'readme', displayPath: 'README.md', kind: 'read', kindLabel: '已读取' }]
          }
        }}
      />
    )

    expect(screen.queryByRole('region', { name: 'AI 处理过程' })).toBeNull()
    expect(screen.queryByText('本回合触碰的文件')).toBeNull()
    expect(document.querySelector('.agent-process-files-touched')).toBeNull()
  })
})

function childProgressPresentation(details: string[]): AgentConversationTurnPresentation {
  return {
    turnId: 'assistant-child-progress',
    active: true,
    status: { kind: 'active' },
    answeredAsks: [],
    sources: [],
    items: details.map((detail, index) => ({
      id: `child-progress-${index + 1}`,
      kind: 'child_run' as const,
      label: '子任务进度',
      detail,
      state: index === details.length - 1 ? 'active' as const : 'complete' as const
    }))
  }
}

describe('AgentConversationReader repeated process descriptions', () => {
  it('rolls a new description upward and keeps the history behind a disclosure button', async () => {
    const user = setupUser()
    const { rerender } = renderUi(
      <AgentConversationReader presentation={childProgressPresentation(['child-1：thinking'])} />
    )

    expect(screen.queryByRole('button', { name: '展开子任务进度历史' })).toBeNull()

    rerender(
      <AgentConversationReader
        presentation={childProgressPresentation(['child-1：thinking', 'child-1：tool_done'])}
      />
    )

    const outgoing = screen.getByText('child-1：thinking')
    const incoming = screen.getByText('child-1：tool_done')
    expect(outgoing).toHaveClass('is-leaving')
    expect(incoming).toHaveClass('is-entering')

    await waitFor(() => expect(screen.queryByText('child-1：thinking')).toBeNull())

    rerender(
      <AgentConversationReader
        presentation={childProgressPresentation([
          'child-1：thinking',
          'child-1：tool_done',
          'child-1：thinking again'
        ])}
      />
    )
    expect(screen.getByText('child-1：tool_done')).toHaveClass('is-leaving')
    expect(screen.getByText('child-1：thinking again')).toHaveClass('is-entering')
    await waitFor(() => expect(screen.queryByText('child-1：tool_done')).toBeNull())

    const toggle = screen.getByRole('button', { name: '展开子任务进度历史' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    expect(screen.getByRole('button', { name: '折叠子任务进度历史' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list', { name: '子任务进度历史' })).toHaveTextContent('child-1：thinking')
    expect(screen.getByRole('list', { name: '子任务进度历史' })).toHaveTextContent('child-1：tool_done')
    expect(screen.getByRole('list', { name: '子任务进度历史' })).toHaveTextContent('child-1：thinking again')
  })
})


describe('AgentConversationReader process outcomes', () => {
  it('folds the completed planning card and lets the learner expand it again', async () => {
    const user = setupUser()
    const { rerender } = renderUi(<AgentConversationReader presentation={presentation('active')} />)

    expect(screen.queryByRole('button', { name: '展开思考过程' })).toBeNull()

    rerender(<AgentConversationReader presentation={presentation('complete')} />)

    const expand = await screen.findByRole('button', { name: '展开思考过程' })
    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    const content = document.getElementById('agent-process-content-assistant-1')
    expect(panel).toHaveClass('is-collapsed')
    expect(panel).toHaveTextContent('思考结束')
    expect(panel).not.toHaveTextContent('规划中')
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(content).toHaveAttribute('aria-hidden', 'true')

    await user.click(expand)

    expect(screen.getByRole('button', { name: '收起思考过程' })).toHaveAttribute('aria-expanded', 'true')
    expect(panel).not.toHaveClass('is-collapsed')
    expect(content).not.toHaveAttribute('aria-hidden')
  })

  it('falls back to legacy active/completed semantics when status is missing or unknown', () => {
    const legacy = (active: boolean, status?: unknown) => ({
      turnId: `legacy-${active}-${String(status)}`,
      active,
      ...(status === undefined ? {} : { status }),
      answeredAsks: [],
      sources: [],
      items: [{ id: 'legacy-status', kind: 'status' as const, label: '旧投影', state: active ? 'active' as const : 'complete' as const }]
    })

    const { rerender } = renderUi(<AgentConversationReader presentation={legacy(true)} />)
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).toHaveTextContent('思考中进行中')

    rerender(<AgentConversationReader presentation={legacy(false, { kind: 'future_status' })} />)
    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('思考结束已完成')
    expect(panel).not.toHaveTextContent('运行中断')
    expect(panel).not.toHaveTextContent('发生错误')
  })

  it('renders durable interrupted recovery as attention that needs confirmation, not completion or error', () => {
    const interrupted: AgentConversationTurnPresentation = {
      turnId: 'interrupted-1',
      active: false,
      status: { kind: 'interrupted' },
      answeredAsks: [],
      sources: [],
      items: [{
        id: 'interrupted-status',
        kind: 'status',
        label: '运行中断',
        detail: '请检查已有结果后再明确继续。',
        state: 'interrupted'
      }]
    }

    renderUi(<AgentConversationReader presentation={interrupted} />)

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('运行中断')
    expect(panel).toHaveTextContent('需确认')
    expect(panel).not.toHaveTextContent('已完成')
    expect(panel.querySelector('.agent-process-event')).not.toHaveClass('is-error')
  })

  it('retains failed, canceled, and completed header semantics', () => {
    const makePresentation = (kind: 'failed' | 'canceled' | 'completed'): AgentConversationTurnPresentation => ({
      turnId: kind,
      active: false,
      status: { kind },
      answeredAsks: [],
      sources: [],
      items: [{
        id: `${kind}-status`,
        kind: 'status',
        label: kind,
        state: kind === 'failed' ? 'error' : kind === 'canceled' ? 'canceled' : 'complete'
      }]
    })

    const { rerender } = renderUi(<AgentConversationReader presentation={makePresentation('failed')} />)
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).toHaveTextContent('处理失败发生错误')

    rerender(<AgentConversationReader presentation={makePresentation('canceled')} />)
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).toHaveTextContent('处理已取消已取消')

    rerender(<AgentConversationReader presentation={makePresentation('completed')} />)
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).toHaveTextContent('思考结束已完成')
  })
})

describe('AgentConversationReader learner-safe process primary labels', () => {
  const basePresentation = (
    items: AgentConversationTurnPresentation['items']
  ): AgentConversationTurnPresentation => ({
    turnId: 'label-redaction',
    active: false,
    status: { kind: 'completed' },
    answeredAsks: [],
    sources: [],
    items
  })

  it('preserves safe learner-visible process primary labels', () => {
    renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'safe-reasoning', kind: 'reasoning', label: '思考过程', state: 'complete' },
          { id: 'safe-tool', kind: 'tool_call', label: '调用工具：search_notes', state: 'complete' },
          { id: 'safe-status', kind: 'status', label: '正在准备回复', state: 'complete' }
        ])}
      />
    )

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).not.toHaveTextContent('思考过程')
    expect(panel).toHaveTextContent('调用工具：search_notes')
    expect(panel).toHaveTextContent('正在准备回复')
  })

  it('fail-closed redacts secret, answer, path, and provider payload primary labels without echoing originals', () => {
    const secretLabel = 'api_key=sk-secret-do-not-show-xyz'
    const answerLabel = 'RAW-ANSWER-DO-NOT-SHOW: momentum is conserved'
    const pathLabel = 'C:\\Users\\learner\\private\\answer-key.md'
    const providerLabel = '{"prompt":"leak","answer":"42","apiKey":"tok_abc","token":"x"}'
    const passwordLabel = 'password=super-secret-value'
    const cotLabel = 'CHAIN-OF-THOUGHT provider payload system prompt'

    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'secret', kind: 'tool_call', label: secretLabel, state: 'complete' },
          { id: 'answer', kind: 'status', label: answerLabel, state: 'complete' },
          { id: 'path', kind: 'source', label: pathLabel, state: 'complete' },
          { id: 'provider', kind: 'tool_result', label: providerLabel, state: 'error' },
          { id: 'password', kind: 'child_run', label: passwordLabel, state: 'complete' },
          { id: 'cot', kind: 'reasoning', label: cotLabel, state: 'complete' },
          { id: 'blank', kind: 'compaction', label: '   ', state: 'complete' }
        ])}
      />
    )

    const rendered = container.textContent ?? ''
    for (const forbidden of [
      secretLabel,
      'sk-secret-do-not-show-xyz',
      answerLabel,
      'RAW-ANSWER-DO-NOT-SHOW',
      'momentum is conserved',
      pathLabel,
      'answer-key.md',
      'C:\\Users\\learner',
      providerLabel,
      '"apiKey"',
      'tok_abc',
      passwordLabel,
      'super-secret-value',
      cotLabel,
      'CHAIN-OF-THOUGHT',
      'provider payload',
      'system prompt',
      '[redacted'
    ]) {
      expect(rendered).not.toContain(forbidden)
    }

    expect(rendered).toContain('技术步骤')
    expect(rendered).toContain('处理状态')
    expect(rendered).toContain('来源处理')
    expect(rendered).toContain('辅助任务')
    expect(rendered).not.toContain(cotLabel)
    expect(rendered).not.toContain('思考过程')
    expect(rendered).toContain('上下文整理')
  })

  it('fail-closed rejects absolute Windows/UNC/Unix/home paths without Users/Windows/private keywords', () => {
    const driveBackslash = 'opened D:\\project\\StudiumX\\notes.md'
    const driveSlash = 'reading C:/data/workspace/lesson.bin'
    const uncPath = '\\\\fileserver\\share\\cohort\\keys.txt'
    const unixPath = 'loading /var/log/agent/session.json'
    const homeTilde = 'using ~/Library/Application Support/secrets'
    const homeEnv = 'from $HOME/opt/cache/token.db'

    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'drive-bs', kind: 'source', label: driveBackslash, state: 'complete' },
          { id: 'drive-slash', kind: 'tool_call', label: driveSlash, state: 'complete' },
          { id: 'unc', kind: 'tool_result', label: uncPath, state: 'complete' },
          { id: 'unix', kind: 'status', label: unixPath, state: 'complete' },
          { id: 'home-tilde', kind: 'child_run', label: homeTilde, state: 'complete' },
          { id: 'home-env', kind: 'compaction', label: homeEnv, state: 'complete' }
        ])}
      />
    )

    const rendered = container.textContent ?? ''
    for (const forbidden of [
      driveBackslash,
      'D:\\project\\StudiumX',
      driveSlash,
      'C:/data/workspace',
      uncPath,
      'fileserver\\share',
      unixPath,
      '/var/log/agent',
      homeTilde,
      '~/Library',
      homeEnv,
      '$HOME/opt'
    ]) {
      expect(rendered).not.toContain(forbidden)
    }

    expect(rendered).toContain('来源处理')
    expect(rendered).toContain('技术步骤')
    expect(rendered).toContain('处理状态')
    expect(rendered).toContain('辅助任务')
    expect(rendered).toContain('上下文整理')
  })

  it('fail-closed falls back on redactor-owned secrets and never surfaces [redacted remnants', () => {
    const ghp = `ghp_${'a'.repeat(36)}`
    const githubPat = `github_pat_${'b'.repeat(30)}_${'c'.repeat(20)}`
    const bearer = 'Authorization: Bearer bearer-secret-value-xyz'
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      'sensitive-private-key-material',
      '-----END PRIVATE KEY-----'
    ].join(' ')
    const sk = 'provider key sk-abcdefghijklmnopqrstuv'

    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'ghp', kind: 'tool_call', label: `token ${ghp}`, state: 'complete' },
          { id: 'pat', kind: 'tool_result', label: githubPat, state: 'complete' },
          { id: 'bearer', kind: 'status', label: bearer, state: 'complete' },
          { id: 'pem', kind: 'source', label: pem, state: 'complete' },
          { id: 'sk', kind: 'child_run', label: sk, state: 'complete' }
        ])}
      />
    )

    const rendered = container.textContent ?? ''
    for (const forbidden of [
      ghp,
      githubPat,
      bearer,
      'bearer-secret-value-xyz',
      'sensitive-private-key-material',
      'BEGIN PRIVATE KEY',
      sk,
      'sk-abcdefghijklmnopqrstuv',
      '[redacted',
      'redacted private key'
    ]) {
      expect(rendered).not.toContain(forbidden)
    }

    expect(rendered).toContain('技术步骤')
    expect(rendered).toContain('处理状态')
    expect(rendered).toContain('来源处理')
    expect(rendered).toContain('辅助任务')
  })

  it('does not misclassify safe learner-visible labels as absolute paths or secrets', () => {
    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'rel-path', kind: 'tool_call', label: '读取 notes/lesson-guide.md', state: 'complete' },
          { id: 'tool-name', kind: 'tool_result', label: '调用工具：search_notes', state: 'complete' },
          { id: 'status-copy', kind: 'status', label: '正在准备回复', state: 'complete' },
          { id: 'reasoning-copy', kind: 'reasoning', label: '思考过程', state: 'complete' }
        ])}
      />
    )

    const rendered = container.textContent ?? ''
    expect(rendered).toContain('读取 notes/lesson-guide.md')
    expect(rendered).toContain('调用工具：search_notes')
    expect(rendered).toContain('正在准备回复')
    expect(rendered).not.toContain('思考过程')
    expect(rendered).not.toContain('[redacted')
    // Unmarked ordinary answer sentences without typed markers are out of scope
    // for this projector; they remain an upstream typed-title contract follow-up.
  })

  it('keeps rollup a11y names on projected labels and never falls back to raw malicious labels', async () => {
    const maliciousLabel = 'token=sk-malicious-history-label'
    const user = setupUser()
    renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          {
            id: 'child-1',
            kind: 'child_run',
            label: maliciousLabel,
            detail: 'child-1：thinking',
            state: 'complete'
          },
          {
            id: 'child-2',
            kind: 'child_run',
            label: maliciousLabel,
            detail: 'child-1：tool_done',
            state: 'active'
          }
        ])}
      />
    )

    await user.click(screen.getByRole('button', { name: '展开思考过程' }))
    const expand = screen.getByRole('button', { name: '展开辅助任务历史' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: new RegExp(maliciousLabel) })).toBeNull()
    expect(screen.queryByLabelText(new RegExp(maliciousLabel))).toBeNull()

    await user.click(expand)
    const collapse = screen.getByRole('button', { name: '折叠辅助任务历史' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list', { name: '辅助任务历史' })).toBeVisible()

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('辅助任务')
    expect(panel).not.toHaveTextContent(maliciousLabel)
    expect(panel).not.toHaveTextContent('sk-malicious-history-label')
  })
})
