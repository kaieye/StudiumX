import { describe, expect, it } from 'vitest'

import { SkillInvocationEvidence } from '../../src/renderer/src/skills/SkillInvocationEvidence'
import { renderUi, screen, setupUser } from '../helpers/render'

describe('SkillInvocationEvidence', () => {
  it('is a default-collapsed accessible evidence disclosure without body or local path leakage', async () => {
    const user = setupUser()
    // Deliberately model a malformed persisted payload: the renderer must ignore
    // fields which the main-process projection allow-list forbids.
    const unsafePresentation = {
      skillId: 'learning-assessor',
      displayName: 'Learning Assessor',
      args: '评估刚才的答案',
      bodySha256: 'cfd96c35bebccf34a1110719f8bf3f0944c91ac60c0d808b1d2ed7add2ba6646',
      bodyChars: 321,
      invokedAt: '2026-08-01T02:03:04.000Z',
      bodyTruncated: false,
      state: 'applied',
      filePath: '/private/skills/learning-assessor/SKILL.md',
      baseDir: '/private/skills/learning-assessor',
      body: 'secret Skill body'
    } as unknown as Parameters<typeof SkillInvocationEvidence>[0]['presentation']
    renderUi(
      <SkillInvocationEvidence presentation={unsafePresentation} />
    )

    const summary = screen.getByLabelText('Skill 调用：Learning Assessor，已应用')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(summary).toHaveTextContent('[skill] Learning Assessor · 已应用')

    await user.click(summary)

    expect(details).toHaveAttribute('open')
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('评估刚才的答案')).toBeVisible()
    expect(screen.getByText('已验证正文：321 字符')).toBeVisible()
    expect(screen.getByText('解析时间：2026-08-01T02:03:04.000Z')).toBeVisible()
    expect(screen.getByText('正文与本地路径不会显示在对话投影中。')).toBeVisible()
    expect(document.body.textContent).not.toContain('/private/skills')
    expect(document.body.textContent).not.toContain('secret Skill body')
  })

  it('renders host-authoritative failed/rejected state rather than fabricating success', () => {
    renderUi(
      <SkillInvocationEvidence
        presentation={{
          skillId: 'missing-skill',
          bodyTruncated: false,
          state: 'rejected',
          reason: 'not_installed'
        }}
      />
    )

    expect(screen.getByLabelText('Skill 调用：missing-skill，调用被拒绝')).toBeVisible()
    expect(screen.queryByText('已应用')).toBeNull()
  })
})
