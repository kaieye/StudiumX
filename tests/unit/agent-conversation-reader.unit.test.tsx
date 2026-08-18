import { describe, expect, it } from 'vitest'
import { AgentConversationReader } from '../../src/renderer/src/views/agent-conversation/AgentConversationReader'
import type { AgentConversationTurnPresentation } from '../../src/renderer/src/agent-conversation-presentation'
import type { TeachingTurnPresentation } from '../../src/renderer/src/teaching-turn-presentation'
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

describe('AgentConversationReader reasoning progress', () => {
  it('renders a compact Think row with the current learner-safe reasoning summary', () => {
    renderUi(<AgentConversationReader presentation={presentation('active')} />)

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('正在准备写入')
    expect(panel).toHaveTextContent('Think')
    expect(panel).toHaveTextContent('好，让我接下来写入文件。')
    expect(screen.getByRole('button', { name: '展开思考内容' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('creates a process panel when reasoning is the only item', () => {
    renderUi(<AgentConversationReader presentation={{ ...presentation('active'), items: [presentation('active').items[0]] }} />)

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('Think')
    expect(panel).toHaveTextContent('好，让我接下来写入文件。')
  })
})

const teachingPresentation: TeachingTurnPresentation = {
  phases: [{ id: 'confirm_goal', title: '确认学习目标', state: 'active', statusText: '正在准备下一步学习' }],
  activePhaseId: 'confirm_goal',
  action: null,
  sourceIds: [],
  accessibleNames: {
    region: '学习流程',
    phaseList: '学习流程阶段',
    currentPhase: '确认学习目标：正在准备下一步学习',
    sourceList: '可信来源标识'
  },
  announcement: null,
  technicalDiagnostic: { state: 'active', label: '学习流程正在等待已确认的下一步' },
  focusKey: 'teaching-with-reasoning'
}

describe('AgentConversationReader combined teaching and reasoning views', () => {
  it('shows the teaching projection and the Think summary for the same turn', () => {
    renderUi(
      <AgentConversationReader
        presentation={presentation('active')}
        teachingPresentation={teachingPresentation}
      />
    )

    expect(screen.getByRole('region', { name: '学习流程' })).toBeVisible()
    const process = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(process).toHaveTextContent('Think')
    expect(process).toHaveTextContent('好，让我接下来写入文件。')
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
  it('keeps a completed Think timeline in the normal message flow without a generic completion banner', async () => {
    const user = setupUser()
    const { rerender } = renderUi(<AgentConversationReader presentation={presentation('active')} />)

    expect(screen.queryByRole('button', { name: '展开思考过程' })).toBeNull()
    expect(screen.getByRole('button', { name: '展开思考内容' })).toHaveAttribute('aria-expanded', 'false')

    rerender(<AgentConversationReader presentation={presentation('complete')} />)

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('Think')
    expect(panel).toHaveTextContent('处理完成')
    expect(panel).not.toHaveTextContent('思考结束')
    expect(screen.queryByRole('button', { name: '收起思考过程' })).toBeNull()

    const expand = screen.getByRole('button', { name: '展开思考内容' })
    await user.click(expand)

    expect(screen.getByRole('button', { name: '收起思考内容' })).toHaveAttribute('aria-expanded', 'true')
    expect(panel.querySelector('.agent-process-reasoning-content')).toHaveTextContent('好，让我接下来写入文件。')
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
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).toHaveTextContent('旧投影')
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).not.toHaveTextContent('思考中')

    rerender(<AgentConversationReader presentation={legacy(false, { kind: 'future_status' })} />)
    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('旧投影')
    expect(panel).not.toHaveTextContent('思考结束')
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

  it.each([
    ['resource_limit', '已达到资源边界', '需要调整资源'],
    ['suspended', '运行已暂停', '紧急保护已触发'],
    ['no_progress', '未检测到安全进展', '未自动重试或重放'],
    ['context_unrecoverable', '上下文无法继续', '请开始新的明确对话'],
    ['retry_exhausted', '重试已用尽', '未自动重试或重放']
  ] as const)('renders %s as attention instead of failure or completion', (kind, title, label) => {
    const limited: AgentConversationTurnPresentation = {
      turnId: kind,
      active: false,
      status: { kind },
      answeredAsks: [],
      sources: [],
      items: [{
        id: `${kind}-status`,
        kind: 'status',
        label: title,
        state: kind
      }]
    }

    renderUi(<AgentConversationReader presentation={limited} />)

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent(title)
    expect(panel).toHaveTextContent(label)
    expect(panel).not.toHaveTextContent('处理失败')
    expect(panel).not.toHaveTextContent('已完成')
    expect(panel.querySelector('.agent-process-event')).toHaveClass('is-attention')
  })

  it('shows outcome rows only for failed/canceled states, never for an ordinary completion', () => {
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
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).toHaveTextContent('completed')
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).not.toHaveTextContent('思考结束')
    expect(screen.getByRole('region', { name: 'AI 处理过程' })).not.toHaveTextContent('已完成')
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

  it('uses Think and reviewed tool categories while preserving safe activity labels', () => {
    renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'safe-reasoning', kind: 'reasoning', label: '思考过程', state: 'complete' },
          { id: 'safe-tool', kind: 'tool_call', label: 'READ', state: 'complete' },
          { id: 'safe-status', kind: 'status', label: '正在准备回复', state: 'complete' }
        ])}
      />
    )

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('Think')
    expect(panel).toHaveTextContent('READ')
    expect(panel).toHaveTextContent('正在准备回复')
  })

  it('fail-closes unsafe diagnostics including reasoning labels and details', () => {
    const secretLabel = 'api_key=sk-secret-do-not-show-xyz'
    const answerLabel = 'RAW-ANSWER-DO-NOT-SHOW: momentum is conserved'
    const pathLabel = 'C:\\Users\\learner\\private\\answer-key.md'
    const providerLabel = '{"prompt":"leak","answer":"42","apiKey":"tok_abc","token":"x"}'
    const passwordLabel = 'password=super-secret-value'
    const cotLabel = 'CHAIN-OF-THOUGHT provider payload system prompt'
    const cotDetail = 'api_key=reasoning-secret C:\\Users\\learner\\private\\reasoning.md'

    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'secret', kind: 'tool_call', label: secretLabel, state: 'complete' },
          { id: 'answer', kind: 'status', label: answerLabel, state: 'complete' },
          { id: 'path', kind: 'source', label: pathLabel, state: 'complete' },
          { id: 'provider', kind: 'tool_result', label: providerLabel, state: 'error' },
          { id: 'password', kind: 'child_run', label: passwordLabel, state: 'complete' },
          { id: 'cot', kind: 'reasoning', label: cotLabel, detail: cotDetail, state: 'complete' },
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
      providerLabel,
      '"apiKey"',
      'tok_abc',
      passwordLabel,
      'super-secret-value',
      '[redacted'
    ]) {
      expect(rendered).not.toContain(forbidden)
    }

    expect(rendered).toContain('Tool call')
    expect(rendered).toContain('处理状态')
    expect(rendered).toContain('来源处理')
    expect(rendered).toContain('辅助任务')
    expect(rendered).toContain('Think')
    expect(rendered).toContain('已隐藏不安全的分析内容。')
    expect(rendered).not.toContain(cotLabel)
    expect(rendered).not.toContain(cotDetail)
    expect(rendered).not.toContain('reasoning-secret')
    expect(rendered).not.toContain('C:\\Users\\learner')
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
    expect(rendered).toContain('Tool call')
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

    expect(rendered).toContain('Tool call')
    expect(rendered).toContain('处理状态')
    expect(rendered).toContain('来源处理')
    expect(rendered).toContain('辅助任务')
  })

  it('keeps reviewed tool categories and does not misclassify safe labels', () => {
    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          { id: 'read', kind: 'tool_call', label: 'READ', state: 'complete' },
          { id: 'shell', kind: 'tool_result', label: 'Bash', state: 'complete' },
          { id: 'status-copy', kind: 'status', label: '正在准备回复', state: 'complete' },
          { id: 'reasoning-copy', kind: 'reasoning', label: '思考过程', state: 'complete' }
        ])}
      />
    )

    const rendered = container.textContent ?? ''
    expect(rendered).toContain('READ')
    expect(rendered).toContain('Bash')
    expect(rendered).toContain('正在准备回复')
    expect(rendered).toContain('Think')
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

describe('AgentConversationReader Think and tool disclosures', () => {
  const basePresentation = (
    items: AgentConversationTurnPresentation['items']
  ): AgentConversationTurnPresentation => ({
    turnId: 'disclosure-1',
    active: false,
    status: { kind: 'completed' },
    answeredAsks: [],
    sources: [],
    items
  })

  it('keeps the process toggle name distinct from a reasoning-row disclosure', async () => {
    const user = setupUser()
    renderUi(
      <AgentConversationReader
        presentation={basePresentation([{
          id: 'reasoning-disclosure',
          kind: 'reasoning',
          label: '思考过程',
          detail: '先检查已有结果。\n再组织下一步。',
          state: 'complete'
        }])}
      />
    )

    const reasoningToggle = screen.getByRole('button', { name: '展开思考内容' })
    expect(reasoningToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(reasoningToggle)

    expect(screen.getByRole('button', { name: '收起思考内容' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('先检查已有结果。')).toBeInTheDocument()
  })

  it('renders a safe projected tool summary without exposing raw input/output fields', async () => {
    const user = setupUser()
    renderUi(
      <AgentConversationReader
        presentation={basePresentation([{
          id: 'tool-disclosure',
          kind: 'tool_result',
          label: 'Tool call',
          detail: '已找到 3 条相关笔记。',
          state: 'complete'
        }])}
      />
    )

    const toggle = screen.getByRole('button', { name: '展开Tool call详情' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('OUT')
    expect(panel).toHaveTextContent('已找到 3 条相关笔记。')
    expect(panel).not.toHaveTextContent('arguments')
    expect(panel).not.toHaveTextContent('input')
    expect(panel).not.toHaveTextContent('output')
  })

  it('renders structured tool input and output in an expandable IN/OUT card', async () => {
    const user = setupUser()
    renderUi(
      <AgentConversationReader
        presentation={basePresentation([{
          id: 'tool-call-disclosure',
          kind: 'tool_call',
          label: 'READ',
          detail: 'src/example.ts',
          state: 'complete',
          disclosure: {
            eligible: true,
            label: 'src/example.ts',
            arguments: '{\n  "path": "src/example.ts"\n}',
            result: 'export const answer = 42',
            resultState: 'available'
          }
        }])}
      />
    )

    await user.click(screen.getByRole('button', { name: '展开READ详情' }))

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('IN')
    expect(panel).toHaveTextContent('OUT')
    expect(panel).toHaveTextContent('"path": "src/example.ts"')
    expect(panel).toHaveTextContent('export const answer = 42')
  })

  it('renders structured terminal, read, diff, and search cards for recognized safe tools', async () => {
    const user = setupUser()
    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([
          {
            id: 'terminal-card',
            kind: 'tool_call',
            label: 'Bash',
            state: 'complete',
            disclosure: {
              eligible: true,
              label: 'pnpm typecheck',
              arguments: JSON.stringify({ command: 'pnpm typecheck', cwd: '.' }),
              result: JSON.stringify({ stdout: 'Types passed\n', exitCode: 0 }),
              content: {
                kind: 'terminal',
                command: 'pnpm typecheck',
                cwd: '.',
                output: 'Types passed\n',
                exitCode: 0,
                running: false,
                failed: false,
                truncated: false
              }
            }
          },
          {
            id: 'read-card',
            kind: 'tool_call',
            label: 'READ',
            state: 'complete',
            disclosure: {
              eligible: true,
              label: 'src/example.ts',
              arguments: JSON.stringify({ path: 'src/example.ts' }),
              result: JSON.stringify({ path: 'src/example.ts', content: 'export const answer = 42' }),
              content: {
                kind: 'read',
                path: 'src/example.ts',
                lines: [{ number: 1, text: 'export const answer = 42' }],
                totalLines: 1,
                truncated: false
              }
            }
          },
          {
            id: 'diff-card',
            kind: 'tool_call',
            label: 'Edit',
            state: 'complete',
            disclosure: {
              eligible: true,
              label: 'src/example.ts',
              arguments: JSON.stringify({ path: 'src/example.ts' }),
              result: JSON.stringify({ ok: true }),
              content: {
                kind: 'diff',
                path: 'src/example.ts',
                oldText: 'export const answer = 41',
                newText: 'export const answer = 42'
              }
            }
          },
          {
            id: 'search-card',
            kind: 'tool_call',
            label: 'Search',
            state: 'complete',
            disclosure: {
              eligible: true,
              label: 'answer',
              arguments: JSON.stringify({ pattern: 'answer' }),
              result: JSON.stringify({ count: 1 }),
              content: {
                kind: 'search',
                query: 'answer',
                resultKind: 'matches',
                files: [{ path: 'src/example.ts', matches: [{ lineNumber: 1, text: 'export const answer = 42' }] }],
                paths: [],
                total: 1,
                truncated: false
              }
            }
          }
        ])}
      />
    )

    await user.click(screen.getByRole('button', { name: '展开Bash详情' }))
    await user.click(screen.getByRole('button', { name: '展开READ详情' }))
    await user.click(screen.getByRole('button', { name: '展开Edit详情' }))
    await user.click(screen.getByRole('button', { name: '展开Search详情' }))

    expect(container.querySelectorAll('.agent-tool-card')).toHaveLength(4)
    expect(container.querySelector('.agent-tool-terminal')).toHaveTextContent('pnpm typecheck')
    expect(container.querySelector('.agent-tool-terminal')).toHaveTextContent('Types passed')
    expect(container.querySelector('.agent-tool-read')).toHaveTextContent('1')
    expect(container.querySelector('.agent-tool-diff')).toHaveTextContent('+')
    expect(container.querySelector('.agent-tool-diff')).toHaveTextContent('-')
    expect(container.querySelector('.agent-tool-search')).toHaveTextContent('搜索结果')
    expect(container.querySelector('.agent-process-tool-io-card')).toBeNull()
  })

  it('fails closed when a crafted disclosure contains sensitive diagnostics', () => {
    const secret = 'token=do-not-render'
    const { container } = renderUi(
      <AgentConversationReader
        presentation={basePresentation([{
          id: 'sensitive-tool-disclosure',
          kind: 'tool_call',
          label: 'Tool call',
          detail: '安全摘要',
          state: 'complete',
          disclosure: {
            eligible: true,
            label: secret,
            arguments: JSON.stringify({ token: secret }),
            result: `provider payload ${secret}`
          }
        }])}
      />
    )

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).not.toHaveTextContent(secret)
    expect(container.textContent).toContain('安全摘要')
    expect(screen.queryByRole('button', { name: '展开Tool call详情' })).toBeNull()
  })

  it('shows only IN while a structured tool call is still running', async () => {
    const user = setupUser()
    renderUi(
      <AgentConversationReader
        presentation={basePresentation([{
          id: 'active-tool',
          kind: 'tool_call',
          label: 'Bash',
          state: 'active',
          disclosure: {
            eligible: true,
            label: '检查类型',
            arguments: 'pnpm typecheck'
          }
        }])}
      />
    )

    await user.click(screen.getByRole('button', { name: '展开Bash详情' }))

    const panel = screen.getByRole('region', { name: 'AI 处理过程' })
    expect(panel).toHaveTextContent('IN')
    expect(panel).not.toHaveTextContent('OUT')
    expect(panel).toHaveTextContent('pnpm typecheck')
    expect(panel).not.toHaveTextContent('原始参数不会显示')
  })
})
