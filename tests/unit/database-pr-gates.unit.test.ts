import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function readRepo(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('database PR gates documentation contract (ADR-0124)', () => {
  const policy = readRepo('docs/adr/0124-database-layered-authority-and-pr-gates.md')
  const contributing = readRepo('CONTRIBUTING.md')
  const prTemplate = readRepo('.github/pull_request_template.md')
  const adrReadme = readRepo('docs/adr/README.md')

  it('keeps P2 boundary section for DB-P2-1…4 with explicit wont-do / trigger gates', () => {
    for (const id of ['DB-P2-1', 'DB-P2-2', 'DB-P2-3', 'DB-P2-4'] as const) {
      expect(policy).toContain(id)
    }

    expect(policy).toMatch(/won'?t do/i)
    expect(policy).toContain('信号触发')
    expect(policy).toContain('默认不排期')
    expect(policy).toMatch(/不构成实现授权|不.*授权实现/)

    // DB-P2-3 rejects write-authority migration only (preferred-read projection is allowed).
    expect(policy).toMatch(/DB-P2-3[\s\S]{0,800}won'?t do/i)
    expect(policy).toContain('写权威')
    expect(policy).toContain('永不实现')
    expect(policy).toContain('runtime session store')
    expect(policy).toMatch(/优选读路径/)

    // Trigger / hard-condition language for re-openable P2 items.
    expect(policy).toContain('重新开启硬条件')
    expect(policy).toContain('触发信号')
    expect(policy).toContain('PR 拒绝信号')
    expect(policy).toContain('sqlite-vec')
    expect(policy).toContain('no-FTS')
    expect(policy).toContain('workflow_run')
  })

  it('implements six-gate checklist with PR copy block', () => {
    expect(policy).toContain('Gate 1')
    expect(policy).toContain('Gate 2')
    expect(policy).toContain('Gate 3')
    expect(policy).toContain('Gate 4')
    expect(policy).toContain('Gate 5')
    expect(policy).toContain('Gate 6')

    expect(policy).toContain('Canonical')
    expect(policy).toContain('Drift')
    expect(policy).toMatch(/无秘密|No secrets/i)
    expect(policy).toMatch(/失败可降级|Degrade on failure/i)
    expect(policy).toMatch(/政策对齐|Policy alignment/i)
    expect(policy).toMatch(/测试|Tests/i)

    // Must remain a checklist, not free-form prose only.
    expect(policy).toMatch(/- \[ \]/)
    expect(policy).toContain('Database acceptance gates (ADR-0124)')
    expect(policy).toContain('P2 boundary check')
    expect(policy).toContain('DB-P2-3')
  })

  it('points contributors and PR authors at ADR-0124 without authorizing P2 implementations', () => {
    expect(contributing).toContain('Database PR gates')
    expect(contributing).toContain('0124-database-layered-authority-and-pr-gates.md')
    expect(contributing).toMatch(/won'?t do/i)

    expect(prTemplate).toContain('Database-gates')
    expect(prTemplate).toContain('0124-database-layered-authority-and-pr-gates.md')
    expect(prTemplate).toContain('DB-P2-1')

    expect(contributing).toContain('SQLite FTS')
    expect(contributing).toMatch(/write-authority|write authority|写权威/i)
    expect(prTemplate).toMatch(/No .*SQLite FTS product search/i)
    expect(prTemplate).toMatch(/write-SoT|write source-of-truth|write-authority/i)

    expect(adrReadme).toContain('0124-database-layered-authority-and-pr-gates.md')
  })

  it('keeps forbidden P2 capabilities framed as refuse/default-off, not as authorized work', () => {
    expect(policy).toContain('不实现')
    expect(policy).toMatch(/won't do|won'?t do/i)
    expect(policy).toContain('默认不排期')
    expect(policy).toContain('Does **not** implement DB-P2-1')
    expect(policy).toContain('Does **not** implement DB-P2-2')
    expect(policy).toContain(
      "Does **not** implement DB-P2-3 SQLite teaching/session **write** source-of-truth (won't do; runtime store needs separate ADR)",
    )
    expect(policy).toContain('Does **not** implement DB-P2-4')
    expect(policy).toMatch(/写权威/)
    expect(policy).toMatch(/分层权威|layered authority/i)
    expect(policy).not.toMatch(/可直接推进|现在实现 DB-P2/)
    expect(policy).not.toMatch(/authorized to implement DB-P2/i)
  })

  it('records honest P0/P1/OPT closeout and open-slice stance', () => {
    expect(policy).toContain('DB-P0-1')
    expect(policy).toContain('DB-OPT-6')
    expect(policy).toMatch(/无.*开放.*实现切片|无开放 local-data/)
    expect(policy).toContain('ADR-0123')
  })
})
