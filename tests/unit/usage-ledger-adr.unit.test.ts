import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const adrPath = resolve(root, 'docs/adr/0122-usage-ledger-as-canonical-observability.md')
const readmePath = resolve(root, 'docs/adr/README.md')
const policyPath = resolve(root, 'docs/adr/0124-database-layered-authority-and-pr-gates.md')

describe('ADR-0122 usage-ledger-as-canonical-observability (DB-P1-1)', () => {
  const adr = readFileSync(adrPath, 'utf8')
  const readme = readFileSync(readmePath, 'utf8')
  const policy = readFileSync(policyPath, 'utf8')

  it('exists as the next free ADR after 0050 with design authority + P0-3 implemented status', () => {
    expect(adr).toMatch(/^# ADR-0122：Usage Ledger/)
    // Honest status: design authority adopted; minimal DB-P0-3 implementation landed (not design-only).
    expect(adr).toMatch(/\*\*状态：\*\*.*(设计权威|已设计|已采纳)/)
    expect(adr).toMatch(/DB-P0-3|最小实现|已落地/)
    expect(adr).toMatch(/usage-ledger-as-canonical-observability|Usage Ledger 作为可观测性/)
  })

  it('locks canonical append-only JSONL with ADR-0002 UTC partition pattern', () => {
    expect(adr).toMatch(/append-only JSONL/i)
    expect(adr).toMatch(/UTC/)
    expect(adr).toMatch(/ADR-0002/)
    expect(adr).toMatch(/50 MiB|durable-jsonl/)
    expect(adr).toMatch(/sealed segment/)
  })

  it('allows optional SQLite projection only as disposable rebuildable index', () => {
    expect(adr).toMatch(/Optional SQLite projection|可选 SQLite/)
    expect(adr).toMatch(/ADR-0001/)
    expect(adr).toMatch(/可丢弃|rebuildable|可重建/)
    expect(adr).toMatch(/禁止 FTS|无 FTS|no-FTS|不得变成可搜索/i)
    expect(adr).toMatch(/不得.*turn 成功路径|不挡 turn|不影响 turn/)
  })

  it('declares orthogonality to LearningSession ledger', () => {
    expect(adr).toMatch(/LearningSession/)
    expect(adr).toMatch(/ADR-0008/)
    expect(adr).toMatch(/正交/)
    expect(adr).toMatch(/usage ≠ learning outcome|不得.*settlement|不.*outcome/i)
  })

  it('defaults retention to diagnostic logger policy, not teaching permanent', () => {
    expect(adr).toMatch(/retention|保留/i)
    expect(adr).toMatch(/logger/)
    expect(adr).toMatch(/retentionDays|诊断级/)
    expect(adr).toMatch(/不是.*C-2 canonical teaching data|不.*继承.*永久保留|非.*teaching permanent/)
    expect(adr).toMatch(/严禁.*LearningSession|严禁.*learning-work|不得.*teaching canonical/)
  })

  it('requires redaction and secret-free field allowlist', () => {
    expect(adr).toMatch(/[Rr]edaction|脱敏/)
    expect(adr).toMatch(/allowlist|封闭集|ALLOWED|允许下列字段/)
    expect(adr).toMatch(/prompt/)
    expect(adr).toMatch(/secret|API key/i)
    expect(adr).toMatch(/token stream|全量/)
    expect(adr).toMatch(/聚合/)
  })

  it('defines relation to DB-P0-3 without claiming implementation ownership fight', () => {
    expect(adr).toMatch(/DB-P0-3/)
    expect(adr).toMatch(/最小实现|writer/)
    expect(adr).toMatch(/不.*争抢|不与 DB-P0-3 争抢|不.*实现文件/)
    expect(adr).toMatch(/设计权威|design/i)
  })

  it('covers V1 kinds model_usage / tool_usage / turn_usage and opaque correlation', () => {
    expect(adr).toMatch(/model_usage/)
    expect(adr).toMatch(/tool_usage/)
    expect(adr).toMatch(/turn_usage/)
    expect(adr).toMatch(/traceId/)
    expect(adr).toMatch(/turnId/)
    expect(adr).toMatch(/conversationId/)
    expect(adr).toMatch(/opaque/)
  })

  it('is indexed from docs/adr/README.md', () => {
    expect(readme).toMatch(/0122-usage-ledger-as-canonical-observability\.md/)
    expect(readme).toMatch(/ADR-0122/)
    expect(readme).toMatch(/Usage ledger as canonical observability|usage 观测/)
  })

  it('is referenced from ADR-0124 DB-P1-1 closeout status', () => {
    expect(policy).toMatch(/DB-P1-1/)
    expect(policy).toMatch(/ADR-0122|0122-usage-ledger-as-canonical-observability/)
  })
})
