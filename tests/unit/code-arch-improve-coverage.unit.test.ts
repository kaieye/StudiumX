/**
 * Structural contract for the full-repo improve-codebase-architecture campaign.
 * Drives the shipped coverage tracker + per-slice reports (not a reimplementation
 * of skill logic): every planned slice must stay good_enough · 0 candidates with
 * an examined-line metric, and named production paths from reports must exist.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

const SLICE_REPORTS: ReadonlyArray<{ id: string; file: string }> = [
  { id: 'S01', file: 'S01-review.md' },
  { id: 'S02', file: 'S02-agent-conv.md' },
  { id: 'S03', file: 'S03-review.md' },
  { id: 'S04', file: 'S04-review.md' },
  { id: 'S05', file: 'S05-ai-loop.md' },
  { id: 'S06', file: 'S06-ai-context.md' },
  { id: 'S07', file: 'S07-review.md' },
  { id: 'S08', file: 'S08-review.md' },
  { id: 'S09', file: 'S09-review.md' },
  { id: 'S10', file: 'S10-review.md' },
  { id: 'S11', file: 'S11-review.md' },
  { id: 'S12', file: 'S12-review.md' },
  { id: 'S13', file: 'S13-review.md' },
  { id: 'S14', file: 'S14-review.md' },
  { id: 'S15', file: 'S15-review.md' },
  { id: 'S16', file: 'S16-review.md' },
  { id: 'S17', file: 'S17-review.md' },
  { id: 'S18', file: 'S18-review.md' }
]

/** Real production paths spanning main / shared / renderer (spot-check). */
const SPOT_PATHS = [
  'src/main/teaching-workspace.ts',
  'src/main/learning-session-ledger.ts',
  'src/main/teaching-turn-coordinator.ts',
  'src/main/teaching-turn-coordinator-host.ts',
  'src/main/ai/tools',
  'src/main/mcp',
  'src/shared/mcp',
  'src/shared/study-planning',
  'src/renderer/src/study-space',
  'src/renderer/src/views/workbench',
  'src/preload',
  'scripts'
] as const

function readRepo(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

function parseExaminedLines(report: string): number {
  const m = report.match(/approx_lines_examined[:\s*]*[~*]*\**(\d[\d,]*)/i)
  if (!m) return -1
  return Number(m[1].replace(/,/g, ''))
}

function isZeroCandidateClose(report: string): boolean {
  const goodEnough = /Good enough/i.test(report)
  const zeroCand =
    /\b0 candidates\b/i.test(report) ||
    /candidate_count[:\s*]*\**0\b/i.test(report)
  return goodEnough && zeroCand
}

describe('code-arch-improve coverage campaign contract', () => {
  const coveragePath = 'docs/improvements/code-arch-improve-coverage.md'
  const reviewsDir = 'docs/improvements/code-arch-reviews'

  it('ships the coverage tracker with complete 18-slice 0-cand closeout metrics', () => {
    expect(existsSync(resolve(root, coveragePath))).toBe(true)
    const coverage = readRepo(coveragePath)

    expect(coverage).toMatch(/COMPLETE/i)
    expect(coverage).toMatch(/18\s*\/\s*18/)
    expect(coverage).toMatch(/good_enough\s*[·.]\s*0\s*cand/i)
    expect(coverage).toMatch(/Lines deeply examined/i)
    expect(coverage).toMatch(/no further architecture improvement needed now/i)
    expect(coverage).toMatch(/Admitted candidates \(open\)[\s\S]{0,80}\*\*0\*\*/i)
    expect(coverage).toMatch(/Implemented candidates[\s\S]{0,80}\*\*0\*\*/i)

    for (const { id, file } of SLICE_REPORTS) {
      expect(coverage).toContain(id)
      expect(coverage).toContain(`docs/improvements/code-arch-reviews/${file}`)
      // Per-slice row claims good_enough · 0 cand (or sampled variant).
      const row = coverage.split('\n').find((line) => line.includes(`| ${id} |`))
      expect(row, `missing slice row for ${id}`).toBeTruthy()
      expect(row!).toMatch(/good_enough\s*[·.]\s*0\s*cand/i)
    }

    // Population table areas required by the campaign objective.
    for (const area of ['src/main', 'src/renderer', 'src/shared', 'src/preload', 'scripts'] as const) {
      expect(coverage).toContain(area)
    }
  })

  it('keeps every slice report on disk with Good enough + 0 candidates + examined LOC', () => {
    const dir = resolve(root, reviewsDir)
    expect(existsSync(dir)).toBe(true)
    const onDisk = new Set(readdirSync(dir))

    let examinedSum = 0
    for (const { id, file } of SLICE_REPORTS) {
      expect(onDisk.has(file), `missing report ${file}`).toBe(true)
      const report = readRepo(join(reviewsDir, file))
      expect(isZeroCandidateClose(report), `${id} must be good_enough · 0 candidates`).toBe(true)
      const examined = parseExaminedLines(report)
      expect(examined, `${id} approx_lines_examined`).toBeGreaterThan(0)
      examinedSum += examined
    }

    // Campaign examined surface is on the order of the full src+gates map (~100k+).
    expect(examinedSum).toBeGreaterThan(100_000)
    expect(examinedSum).toBeLessThan(300_000)
  })

  it('spot-checks live production paths spanning main, shared, and renderer', () => {
    for (const rel of SPOT_PATHS) {
      expect(existsSync(resolve(root, rel)), `missing path ${rel}`).toBe(true)
    }
  })
})
