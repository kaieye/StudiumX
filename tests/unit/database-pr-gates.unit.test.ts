import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function readRepo(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('database authority and PR-gates documentation contract', () => {
  const policy = readRepo('docs/adr/0012-file-authority-projections-and-durable-publish.md')
  const contributing = readRepo('CONTRIBUTING.md')
  const prTemplate = readRepo('.github/pull_request_template.md')
  const adrReadme = readRepo('docs/adr/README.md')

  it('keeps the ADR focused on authority, projections, no-FTS and durable publish', () => {
    expect(policy).toMatch(/canonical|权威/i)
    expect(policy).toMatch(/SQLite.*projection|projection.*SQLite/i)
    expect(policy).toMatch(/可重建|rebuildable/i)
    expect(policy).toMatch(/FTS|向量/)
    expect(policy).toMatch(/durable publish|原子.*rename|atomic.*rename/i)
    expect(policy).toMatch(/partial|reconcile|降级/i)
    expect(policy).not.toContain('Gate 1')
    expect(policy).not.toContain('DB-P2-1')
  })

  it('keeps the six database gates in CONTRIBUTING.md, not in the ADR', () => {
    for (const gate of ['Gate 1', 'Gate 2', 'Gate 3', 'Gate 4', 'Gate 5', 'Gate 6']) {
      expect(contributing).toContain(gate)
    }
    expect(contributing).toContain('Database acceptance gates')
    expect(contributing).toMatch(/Canonical immutability|Canonical 不变性/)
    expect(contributing).toMatch(/Drift safety|Drift 安全/)
    expect(contributing).toMatch(/No secrets|无秘密/)
    expect(contributing).toMatch(/Degrade on failure|失败可降级/)
    expect(contributing).toMatch(/Policy alignment|政策对齐/)
    expect(contributing).toMatch(/Gate 6.*Tests|测试/)
  })

  it('points the PR template to CONTRIBUTING.md and preserves the no-FTS boundary', () => {
    expect(prTemplate).toContain('CONTRIBUTING.md#database-pr-gates')
    expect(prTemplate).toMatch(/SQLite FTS|SQLite.*vector/i)
    expect(prTemplate).toMatch(/teaching write-SoT|teaching.*write.*authority/i)
    expect(prTemplate).not.toContain('docs/adr/0012-file-authority-projections-and-durable-publish.md')
    expect(adrReadme).toContain('0012-file-authority-projections-and-durable-publish.md')
  })
})
