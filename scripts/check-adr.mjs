#!/usr/bin/env node
/**
 * ADR governance structural checker + index generator (docs/adr/).
 *
 * Pure Node, no package deps. Runs from the repo root.
 *
 * Modes:
 *   node scripts/check-adr.mjs              structural checks (errors + warnings)
 *   node scripts/check-adr.mjs --strict     metadata completeness becomes fatal
 *   node scripts/check-adr.mjs --index      regenerate docs/adr/INDEX.md
 *   node scripts/check-adr.mjs --audit      write a temporary audit report to /tmp
 *
 * Checks (see governance spec section 六/十/十一):
 *   1. H1 is `# ADR-NNNN：标题` and filename number matches title number.
 *   2. Unified metadata present: 决策状态 / 实施状态 / 日期 / 范围 / 取代 / 被取代 / 相关 / 证据.
 *   3. Status values belong to the allowed sets.
 *   4. Relative markdown links resolve to existing files.
 *   5. supersedes / superseded_by targets exist.
 *   6. README / INDEX have no drift (every ADR linked; INDEX regenerated).
 *   7. Markdown code fences are balanced.
 *   8. Line-count warnings (normal >120, complex >150).
 *   9. README contains no historical test terminal output.
 *
 * The script is designed for an incremental migration: legacy `**状态：**`
 * metadata is accepted with a warning, and structural errors are fatal while
 * metadata completeness is a warning until `--strict`.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adrDir = path.join(root, 'docs', 'adr')

const DECISION_STATUSES = new Set(['proposed', 'accepted', 'superseded', 'rejected'])
const IMPLEMENTATION_STATUSES = new Set(['not_started', 'partial', 'complete', 'not_applicable'])

const REQUIRED_META = ['决策状态', '实施状态', '日期', '范围', '取代', '被取代', '相关', '证据']

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function walkMarkdownFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      // Only recurse into evidence/ etc. subfolders under docs/adr.
      if (entry === 'node_modules') continue
      out.push(...walkMarkdownFiles(full))
    } else if (entry.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

function parseMetaBlock(content) {
  // Parse the metadata block immediately after the H1: lines starting with '- **X：** ...'
  // The block ends at the first section heading after the H1 (`## ` / `# `),
  // which is a reliable boundary even when metadata values contain bold / links.
  const meta = {}
  const lines = content.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,3}\s/.test(line)) break
    const m = line.match(/^\s*-\s*\*\*([^*：:]+)[：:]\*\*\s*(.*)$/)
    if (m) {
      meta[m[1].trim()] = m[2].trim()
      continue
    }
    // Multi-line metadata values (e.g. sub-bullets under `相关` / `证据`) are
    // skipped; only `- **X：**` single-line keys are collected as metadata.
  }
  return meta
}

function extractStatus(meta) {
  // New unified fields first; legacy `状态` accepted as decision status fallback.
  return {
    decision: meta['决策状态'] ?? meta['状态'] ?? null,
    implementation: meta['实施状态'] ?? null,
  }
}

function resolveAdrNumberFromTitle(h1) {
  const m = h1.match(/^#\s*ADR-(\d{4})[：:]\s*(.*)$/)
  if (!m) return null
  return { number: m[1], title: m[2] }
}

function findLinks(markdown) {
  // [text](target) — excludes autolinks and images, includes relative paths.
  const links = []
  const re = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = re.exec(markdown)) !== null) {
    links.push({ text: m[1], target: m[2] })
  }
  return links
}

function resolveLink(baseDir, target) {
  if (/^(https?:|mailto:|#)/i.test(target)) return null // external or anchor
  if (target.startsWith('/')) return null // root-absolute, not verifiable here
  const cleaned = target.split('#')[0]
  if (!cleaned) return null
  const resolved = path.resolve(baseDir, cleaned)
  return resolved
}

function hasTestTerminalOutput(text) {
  // README must not contain historical test terminal output / pass counts.
  return /(tests?\s+passed|✓\s*\d+|✔\s*\d+|\d+\s+passed\s*\/\s*\d+)/i.test(text)
}

// ---------------------------------------------------------------------------
// Domain classification (deterministic, keyword based — navigation aid only)
// ---------------------------------------------------------------------------

function classifyDomain(adr) {
  const hay = `${adr.filename} ${adr.title} ${adr.scope ?? ''}`.toLowerCase()
  const rules = [
    ['mindmap', /mind-?map|思维导图/],
    ['mcp', /mcp/],
    ['study-planning', /study|planning|plan|timer|排程|规划|任务清单|专注/],
    ['memory', /memory|记忆/],
    ['database', /sqlite|projection|database|index|rebuild|usage-ledger|analytics/],
    ['provider', /provider|model|retry|quota|overflow|billing|headers/],
    ['platform-shell', /platform|shell|sandbox|workspace-shell|capability-profile/],
    ['agent-context', /agent|context|compaction|compact|busy|cancel|steer|queue|run|replay|fingerprint|child/],
    ['tools', /tool|effect|policy|dispatcher|write|contract/],
    ['teaching', /teaching|learning|lesson|outcome|evidence|ledger|settlement|session|review|skill|kernel|assessment/],
    ['observability-ops', /doctor|support|observability|audit|log|crash|trace|redact|bundle/],
    ['security-ci', /security|ci|worktree|actions|dependabot|osv|node-engines|npmrc/],
    ['config', /config|settings|overlay|managed|denylist/],
    ['durability', /durable|publish|migration|backup|recovery/],
    ['adoption', /adoption|improvements|借鉴|结项/],
    ['platform-misc', /release|mac|win|electron/],
  ]
  for (const [domain, re] of rules) {
    if (re.test(hay)) return domain
  }
  return 'misc'
}

// ---------------------------------------------------------------------------
// Reference scan (which files mention an ADR number or its filename)
// ---------------------------------------------------------------------------

function collectReferences(adrNumber, filename, scopeRoots) {
  const refs = new Set()
  for (const scope of scopeRoots) {
    if (!existsSync(scope)) continue
    const files = []
    const stack = [scope]
    while (stack.length) {
      const dir = stack.pop()
      let entries
      try {
        entries = readdirSync(dir)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git') continue
        const full = path.join(dir, entry)
        let st
        try {
          st = statSync(full)
        } catch {
          continue
        }
        if (st.isDirectory()) {
          if (dir.includes(`${path.sep}release${path.sep}`)) continue
          stack.push(full)
        } else if (/\.(ts|tsx|js|mjs|json|md|yml|yaml|sh|mjs)$/.test(entry)) {
          try {
            const text = readFileSync(full, 'utf8')
            if (text.includes(`ADR-${adrNumber}`) || text.includes(filename)) {
              const rel = path.relative(root, full).split(path.sep).join('/')
              refs.add(rel)
            }
          } catch {
            // ignore unreadable
          }
        }
      }
    }
  }
  return [...refs]
}

// ---------------------------------------------------------------------------
// Per-ADR analysis
// ---------------------------------------------------------------------------

function analyzeAdr(adrFile) {
  const content = readFileSync(adrFile, 'utf8')
  const filename = path.basename(adrFile)
  const rel = path.relative(root, adrFile).split(path.sep).join('/')
  const fileNumMatch = filename.match(/^(\d{4})-/)
  const fileNumber = fileNumMatch ? fileNumMatch[1] : null

  const h1 = content.split('\n')[0]
  const titleMatch = resolveAdrNumberFromTitle(h1)
  const meta = parseMetaBlock(content)
  const { decision, implementation } = extractStatus(meta)
  const scope = meta['范围'] ?? ''

  const errors = []
  const warnings = []

  // 1. H1 + filename number consistency
  if (!titleMatch) {
    errors.push(`H1 不是 '# ADR-NNNN：标题'：${h1}`)
  } else if (fileNumber && titleMatch.number !== fileNumber) {
    errors.push(`文件名编号 ${fileNumber} 与标题编号 ${titleMatch.number} 不一致`)
  }

  // 2. Metadata completeness
  const missing = REQUIRED_META.filter((k) => !(k in meta))
  if (missing.length) {
    warnings.push(`缺少统一元数据：${missing.join('、')}`)
  }

  // 3. Status values
  if (decision && !DECISION_STATUSES.has(decision.toLowerCase())) {
    warnings.push(`决策状态值不在允许集合：'${decision}'`)
  }
  if (implementation && !IMPLEMENTATION_STATUSES.has(implementation.toLowerCase())) {
    warnings.push(`实施状态值不在允许集合：'${implementation}'`)
  }
  if (!('决策状态' in meta) && decision) {
    warnings.push('仍使用旧字段 `**状态：**`（应迁移为 `**决策状态：**`）')
  }

  // 4. Links
  const baseDir = path.dirname(adrFile)
  for (const link of findLinks(content)) {
    const resolved = resolveLink(baseDir, link.target)
    if (!resolved) continue
    if (!existsSync(resolved)) {
      warnings.push(`坏链接 [${link.text}](${link.target}) → ${path.relative(root, resolved)}`)
    }
  }

  // 5. Supersession targets
  for (const field of ['取代', '被取代']) {
    const val = meta[field]
    if (val && val !== '无') {
      const nums = [...val.matchAll(/ADR-(\d{4})/g)].map((m) => m[1])
      for (const num of nums) {
        const target = path.join(adrDir, `${num}.md`)
        if (!existsSync(target)) {
          const candidates = readdirSync(adrDir).filter((f) => f.startsWith(`${num}-`))
          if (candidates.length === 0) {
            warnings.push(`${field} 指向不存在的 ADR-${num}`)
          }
        }
      }
    }
  }

  // 6. Code fences balanced
  const fences = (content.match(/```/g) ?? []).length
  if (fences % 2 !== 0) {
    errors.push('Markdown 代码围栏未闭合（``` 数量为奇数）')
  }

  // 7. Line counts (a `> **长度说明：**` blockquote counts as justification for complex ADRs)
  const lineCount = content.split('\n').length
  const hasLengthJustification = />\s*\*\*长度说明：\*\*/.test(content)
  if (lineCount > 150 && !hasLengthJustification) {
    warnings.push(`行数 ${lineCount} > 150（复杂 ADR 需说明理由或将证据移入 appendix）`)
  } else if (lineCount > 120) {
    warnings.push(`行数 ${lineCount} > 120（长度预算 warning）`)
  }

  // 8. Implementation流水账 heuristics
  const hasChecklist = /- \[ \]/.test(content)
  const hasPrSequence = /建议 PR 序列|PR-[0-9]/.test(content)
  const hasTestCount = /(tests? passed|\d+ passed|\d+ tests)/i.test(content)
  const hasCommitLog = /`[0-9a-f]{7,40}`/.test(content)

  return {
    rel,
    filename,
    fileNumber,
    h1,
    title: titleMatch ? titleMatch.title : null,
    decision,
    implementation,
    scope,
    supersededBy: meta['被取代'] ?? '',
    supersedes: meta['取代'] ?? '',
    domain: classifyDomain({ filename, title: titleMatch?.title ?? '', scope }),
    missing,
    lineCount,
    errors,
    warnings,
    hasChecklist,
    hasPrSequence,
    hasTestCount,
    hasCommitLog,
  }
}

// ---------------------------------------------------------------------------
// INDEX generation
// ---------------------------------------------------------------------------

function generateIndex(adrs) {
  const sorted = [...adrs].sort((a, b) => Number(a.fileNumber) - Number(b.fileNumber))
  const lines = []
  lines.push('# ADR 索引（机器维护）')
  lines.push('')
  lines.push('> 本文件由 `node scripts/check-adr.mjs --index` 从各 ADR 元数据自动生成；')
  lines.push('> 不要手工维护。每份 ADR 一行。决策状态 / 实施状态取值见 `docs/adr/README.md`。')
  lines.push('')
  lines.push('| ADR | 决策状态 | 实施状态 | 领域 | 一句话决定 | 被取代 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const a of sorted) {
    const num = a.fileNumber ?? '????'
    const decision = a.decision ?? '—'
    const impl = a.implementation ?? '—'
    const domain = a.domain
    const oneLiner = (a.scope || a.title || '').replace(/\s+/g, ' ').trim()
    const supersededBy = a.supersededBy || ''
    lines.push(`| [ADR-${num}](${a.filename}) | ${decision} | ${impl} | ${domain} | ${oneLiner} | ${supersededBy} |`)
  }
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// README drift checks
// ---------------------------------------------------------------------------

function checkReadme(adrs) {
  const readmePath = path.join(adrDir, 'README.md')
  const readme = readFileSync(readmePath, 'utf8')
  const errors = []
  const warnings = []
  if (hasTestTerminalOutput(readme)) {
    errors.push('README 中出现疑似测试终端输出 / pass 计数')
  }
  // Every ADR file should be linked somewhere in README or INDEX.
  const indexExists = existsSync(path.join(adrDir, 'INDEX.md'))
  const indexText = indexExists ? readFileSync(path.join(adrDir, 'INDEX.md'), 'utf8') : ''
  for (const a of adrs) {
    if (!readme.includes(a.filename) && !indexText.includes(a.filename)) {
      warnings.push(`README/INDEX 未链接 ${a.filename}`)
    }
  }
  return { errors, warnings }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2)
  const modeStrict = args.includes('--strict')
  const modeIndex = args.includes('--index')
  const modeAudit = args.includes('--audit')

  const adrFiles = walkMarkdownFiles(adrDir)
    .filter((f) => path.basename(f).match(/^\d{4}-.*\.md$/))
    .sort()
  const adrs = adrFiles.map(analyzeAdr)

  let exitCode = 0
  const report = []
  const totals = { files: adrs.length, errors: 0, warnings: 0 }

  for (const a of adrs) {
    if (a.errors.length) {
      totals.errors += a.errors.length
      exitCode = 1
    }
    const warnCount = a.warnings.length
    if (warnCount) totals.warnings += warnCount
    if (a.errors.length || warnCount) {
      report.push({ rel: a.rel, errors: a.errors, warnings: a.warnings })
    }
  }

  // README drift
  const readmeCheck = checkReadme(adrs)
  for (const e of readmeCheck.errors) {
    totals.errors += 1
    exitCode = 1
    report.push({ rel: 'docs/adr/README.md', errors: [e], warnings: [] })
  }
  for (const w of readmeCheck.warnings) {
    totals.warnings += 1
    report.push({ rel: 'docs/adr/README.md', errors: [], warnings: [w] })
  }

  // Metadata completeness in strict mode is fatal.
  if (modeStrict) {
    for (const a of adrs) {
      if (a.missing.length) {
        exitCode = 1
      }
    }
  }

  if (modeIndex) {
    const indexPath = path.join(adrDir, 'INDEX.md')
    writeFileSync(indexPath, generateIndex(adrs), 'utf8')
    console.log(`[check-adr] regenerated ${path.relative(root, indexPath)} (${adrs.length} ADRs)`)
  }

  if (modeAudit) {
    const outPath = path.join('/tmp', 'studiumx-adr-audit.json')
    writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totals, adrs }, null, 2), 'utf8')
    console.log(`[check-adr] audit written to ${outPath}`)
  }

  console.log(`[check-adr] ${totals.files} ADR files, ${totals.errors} errors, ${totals.warnings} warnings`)
  for (const r of report) {
    console.log(`- ${r.rel}`)
    for (const e of r.errors) console.log(`    [error] ${e}`)
    for (const w of r.warnings) console.log(`    [warn]  ${w}`)
  }
  if (!modeAudit && !modeIndex) {
    console.log(modeStrict ? '[check-adr] strict mode' : '[check-adr] (metadata completeness is warning-level until --strict)')
  }
  process.exit(exitCode)
}

main()
