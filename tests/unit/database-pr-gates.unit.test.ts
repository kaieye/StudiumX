import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function readRepo(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('database PR gates documentation contract', () => {
  const roadmap = readRepo('docs/improvements/database-roadmap.md')
  const boundaries = readRepo('docs/improvements/database-p2-boundaries.md')
  const acceptance = readRepo('docs/improvements/database-acceptance-gates.md')
  const contributing = readRepo('CONTRIBUTING.md')
  const prTemplate = readRepo('.github/pull_request_template.md')

  it('keeps living P2 boundary doc for DB-P2-1…4 with explicit wont-do / trigger gates', () => {
    for (const id of ['DB-P2-1', 'DB-P2-2', 'DB-P2-3', 'DB-P2-4'] as const) {
      expect(boundaries).toContain(id)
      expect(roadmap).toContain(id)
    }

    expect(boundaries).toMatch(/won'?t do/i)
    expect(boundaries).toContain('信号触发')
    expect(boundaries).toContain('默认不排期')
    expect(boundaries).toContain('不构成实现授权')

    // DB-P2-3 is an explicit rejection, not a backlog item.
    expect(boundaries).toMatch(/DB-P2-3[\s\S]{0,400}won'?t do/i)
    expect(boundaries).toContain('会话真相源迁入 SQLite')
    expect(boundaries).toContain('永不实现')

    // Trigger / hard-condition language for re-openable P2 items.
    expect(boundaries).toContain('重新开启硬条件')
    expect(boundaries).toContain('触发信号')
    expect(boundaries).toContain('PR / 实现拒绝信号')
    expect(boundaries).toContain('sqlite-vec')
    expect(boundaries).toContain('no-FTS')
    expect(boundaries).toContain('workflow_run')

    // Cross-links to living acceptance checklist and roadmap.
    expect(boundaries).toContain('database-acceptance-gates.md')
    expect(boundaries).toContain('database-roadmap.md')
    expect(roadmap).toContain('database-p2-boundaries.md')
  })

  it('implements roadmap §8 as a living six-gate checklist with PR copy block', () => {
    expect(acceptance).toContain('Gate 1')
    expect(acceptance).toContain('Gate 2')
    expect(acceptance).toContain('Gate 3')
    expect(acceptance).toContain('Gate 4')
    expect(acceptance).toContain('Gate 5')
    expect(acceptance).toContain('Gate 6')

    expect(acceptance).toContain('Canonical')
    expect(acceptance).toContain('Drift')
    expect(acceptance).toMatch(/无秘密|No secrets/i)
    expect(acceptance).toMatch(/失败可降级|Degrade on failure/i)
    expect(acceptance).toMatch(/政策对齐|Policy alignment/i)
    expect(acceptance).toMatch(/测试|Tests/i)

    // Must remain a checklist, not free-form prose only.
    expect(acceptance).toMatch(/- \[ \]/)
    expect(acceptance).toContain('Database acceptance gates (roadmap §8)')
    expect(acceptance).toContain('P2 boundary check')
    expect(acceptance).toContain('DB-P2-3')

    // Roadmap §8 points at the living checklist as authority.
    expect(roadmap).toMatch(/## 8\. 验收总闸/)
    expect(roadmap).toContain('database-acceptance-gates.md')
    expect(roadmap).toMatch(/活清单/)
  })

  it('points contributors and PR authors at database gates without authorizing P2 implementations', () => {
    expect(contributing).toContain('Database PR gates')
    expect(contributing).toContain('docs/improvements/database-acceptance-gates.md')
    expect(contributing).toContain('docs/improvements/database-p2-boundaries.md')
    expect(contributing).toMatch(/won'?t do/i)

    expect(prTemplate).toContain('Database-gates')
    expect(prTemplate).toContain('docs/improvements/database-acceptance-gates.md')
    expect(prTemplate).toContain('docs/improvements/database-p2-boundaries.md')
    expect(prTemplate).toContain('DB-P2-1')

    // Hard red lines remain: no FTS product surface by default.
    expect(contributing).toContain('SQLite FTS')
    expect(prTemplate).toContain('No SQLite FTS product search')
  })

  it('keeps forbidden P2 capabilities framed as refuse/default-off, not as authorized work', () => {
    // Reject-signal phrases may mention FTS SQL / sqlite-vec as examples of what to block.
    expect(boundaries).toContain('不实现')
    expect(boundaries).toMatch(/won't do|won'?t do/i)
    expect(boundaries).toContain('默认不排期')
    expect(boundaries).toContain('不构成实现授权')
    expect(acceptance).toContain('Does **not** implement DB-P2-1')
    expect(acceptance).toContain('Does **not** implement DB-P2-2')
    expect(acceptance).toContain("Does **not** implement DB-P2-3 SQLite session source-of-truth (won't do)")
    expect(acceptance).toContain('Does **not** implement DB-P2-4')
    // Living docs must not claim P2 items are scheduled implementation work.
    expect(boundaries).not.toMatch(/可直接推进|现在实现 DB-P2/)
    expect(acceptance).not.toMatch(/authorized to implement DB-P2/i)
  })
})
