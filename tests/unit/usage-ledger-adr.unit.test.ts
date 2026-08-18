import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function readRepo(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('ADR-0007 local observability and usage-ledger contract', () => {
  const adr = readRepo('docs/adr/0007-local-observability-and-diagnostics.md')
  const readme = readRepo('docs/adr/README.md')

  it('keeps UsageLedger as the local observability canonical record', () => {
    expect(adr).toContain('`UsageLedger`')
    expect(adr).toMatch(/canonical.*本地记录|canonical.*本地记录/i)
    expect(adr).toMatch(/SQLite.*可重建|projection.*可重建/i)
  })

  it('keeps observability separate from teaching authority and settlement', () => {
    expect(adr).toContain('LearningSession')
    expect(adr).toMatch(/Evidence|Outcome/)
    expect(adr).toMatch(/不得成为.*authority|不.*TeachingSession|不.*教学权威/i)
  })

  it('keeps diagnostics local, redacted and consent-gated', () => {
    expect(adr).toMatch(/只读|read-only/i)
    expect(adr).toMatch(/脱敏|redact/i)
    expect(adr).toMatch(/secret|token/i)
    expect(adr).toMatch(/无默认远程|remote telemetry|phone-home/i)
    expect(adr).toMatch(/support bundle/i)
  })

  it('is indexed as ADR-0007', () => {
    expect(readme).toContain('0007-local-observability-and-diagnostics.md')
    expect(readme).toContain('ADR-0007')
  })
})
