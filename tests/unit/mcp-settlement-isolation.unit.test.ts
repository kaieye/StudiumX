/**
 * Settlement isolation invariant (ADR-0128 / ADR-0132 / ADR-0134 / ADR-0135):
 * MCP modules must not import LearningSession ledger writers or outcome committer.
 * Grep-style static scan — mirrors scripts/check-workspace-host-imports.mjs pattern.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const mcpRoots = [join(repoRoot, 'src/main/mcp'), join(repoRoot, 'src/shared/mcp')]

/** Import/require path substrings that must never appear under MCP trees. */
const FORBIDDEN_IMPORT_TARGETS: Array<{ id: string; re: RegExp }> = [
  { id: 'learning-session-ledger', re: /learning-session-ledger/i },
  { id: 'learning-outcome-committer', re: /learning-outcome-committer/i },
  { id: 'learning-work-ledger', re: /learning-work-ledger/i }
]

const IMPORT_LINE_RE =
  /(?:^|\n)\s*(?:import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?|export\s+(?:type\s+)?[\s\S]*?\s+from\s+|require\s*\()\s*['"]([^'"]+)['"]/g

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function walkSourceFiles(dir: string, acc: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return acc
    }
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkSourceFiles(full, acc)
      continue
    }
    if (!entry.isFile()) continue
    if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue
    if (entry.name.endsWith('.d.ts')) continue
    acc.push(full)
  }
  return acc
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

function scanFile(filePath: string): Array<{ file: string; line: number; target: string; rule: string }> {
  const text = readFileSync(filePath, 'utf8')
  const rel = toPosix(relative(repoRoot, filePath))
  const violations: Array<{ file: string; line: number; target: string; rule: string }> = []
  const importRe = new RegExp(IMPORT_LINE_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = importRe.exec(text)) !== null) {
    const target = match[1]
    const at = match.index + (match[0].startsWith('\n') ? 1 : 0)
    const line = lineNumberAt(text, at)
    for (const rule of FORBIDDEN_IMPORT_TARGETS) {
      if (rule.re.test(target)) {
        violations.push({ file: rel, line, target, rule: rule.id })
      }
    }
  }
  return violations
}

describe('MCP settlement isolation (no ledger / outcome-committer imports)', () => {
  it('src/main/mcp and src/shared/mcp do not import ledger or outcome committer', () => {
    const files = mcpRoots.flatMap((root) => {
      expect(statSync(root).isDirectory()).toBe(true)
      return walkSourceFiles(root)
    })
    expect(files.length).toBeGreaterThan(0)

    const violations = files.flatMap(scanFile)
    expect(
      violations,
      violations.map((v) => `${v.file}:${v.line} imports "${v.target}" (${v.rule})`).join('\n') || 'ok'
    ).toEqual([])
  })

  it('includes oauth and artifact modules in the scan surface', () => {
    const files = mcpRoots.flatMap((root) => walkSourceFiles(root)).map((f) => toPosix(relative(repoRoot, f)))
    const expectedFragments = [
      'src/main/mcp/oauth-authorization-manager.ts',
      'src/main/mcp/oauth-token-store.ts',
      'src/main/mcp/artifact-writer.ts',
      'src/main/mcp/result-normalizer.ts',
      'src/main/mcp/trace-store.ts',
      'src/main/mcp/tool-bridge.ts',
      'src/main/mcp/marketplace-store.ts',
      'src/main/mcp/workspace-root-injection.ts',
      'src/shared/mcp/types.ts'
    ]
    for (const frag of expectedFragments) {
      expect(files.some((f) => f.endsWith(frag) || f === frag), `missing ${frag}`).toBe(true)
    }
    // marketplace / other Phase H files may appear; still must not import settlement.
    const violations = files
      .map((rel) => join(repoRoot, ...rel.split('/')))
      .flatMap(scanFile)
    expect(violations).toEqual([])
  })
})

