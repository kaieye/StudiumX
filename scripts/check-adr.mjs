#!/usr/bin/env node
/**
 * ADR governance structural checker (docs/adr/).
 *
 * Pure Node, no package deps. Runs from the repo root.
 *
 * Modes:
 *   node scripts/check-adr.mjs              structural checks (errors + warnings)
 *   node scripts/check-adr.mjs --strict     proposed review deadline becomes fatal
 *   node scripts/check-adr.mjs --audit      write a temporary audit report to /tmp
 *
 * Checks (see docs/adr/README.md 治理 section):
 *   1. H1 is `# ADR-NNNN：标题` and filename number matches title number.
 *   2. Minimal metadata present: 状态 / 日期 / 领域. `取代` is optional and singular.
 *   3. Status belongs to {accepted, proposed}; proposed records governance and review metadata.
 *   4. Relative markdown links resolve to existing files.
 *   5. Optional `取代` is exactly 无 or one ADR-NNNN.
 *   6. Markdown code fences are balanced.
 *   7. Every ADR stays within the 60-line hard limit.
 *   8. In non-dry mode, scan the repo for references to non-existent ADR files/numbers
 *      (dead-reference check). Run after deletions.
 *
 * Historical INDEX generation is intentionally removed: docs/adr/README.md is the
 * single navigation entry. The current canonical set is continuously numbered.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adrDir = path.join(root, 'docs', 'adr')

const DECISION_STATUSES = new Set(['accepted', 'proposed'])
const REQUIRED_META = ['状态', '日期', '领域']
const PROPOSED_META = ['Owner', '任务', '复核期限', '处置条件']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function walkMarkdownFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...walkMarkdownFiles(full))
    } else if (entry.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

function parseMetaBlock(content) {
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
  }
  return meta
}

function resolveAdrNumberFromTitle(h1) {
  const m = h1.match(/^#\s*ADR-(\d{4})[：:]\s*(.*)$/)
  if (!m) return null
  return { number: m[1], title: m[2] }
}

function findLinks(markdown) {
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

// ---------------------------------------------------------------------------
// Per-ADR analysis
// ---------------------------------------------------------------------------

function parseIsoDate(value) {
  if (!ISO_DATE.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date
}

function analyzeAdr(adrFile, { strict }) {
  const content = readFileSync(adrFile, 'utf8')
  const filename = path.basename(adrFile)
  const rel = path.relative(root, adrFile).split(path.sep).join('/')
  const fileNumber = (filename.match(/^(\d{4})-/) || [])[1] || null

  const h1 = content.split('\n')[0]
  const titleMatch = resolveAdrNumberFromTitle(h1)
  const meta = parseMetaBlock(content)

  const errors = []
  const warnings = []

  // 1. H1 + filename consistency
  if (!titleMatch) {
    errors.push(`H1 不是 '# ADR-NNNN：标题'：${h1}`)
  } else if (fileNumber && titleMatch.number !== fileNumber) {
    errors.push(`文件名编号 ${fileNumber} 与标题编号 ${titleMatch.number} 不一致`)
  }

  // 2. Metadata completeness
  const missing = REQUIRED_META.filter((k) => !(k in meta))
  if (missing.length) {
    errors.push(`缺少元数据：${missing.join('、')}`)
  }

  const status = meta['状态'] ?? null
  if (status && !DECISION_STATUSES.has(status.toLowerCase())) {
    errors.push(`状态值不在允许集合 {accepted, proposed}：'${status}'`)
  }

  const decisionDate = meta['日期'] ? parseIsoDate(meta['日期']) : null
  if (meta['日期'] && !decisionDate) {
    errors.push(`日期必须是有效的 YYYY-MM-DD：'${meta['日期']}'`)
  }

  // 3. proposed governance metadata and deadline
  const isProposed = status && status.toLowerCase() === 'proposed'
  if (isProposed) {
    const missingProposed = PROPOSED_META.filter((k) => !meta[k])
    if (missingProposed.length) {
      errors.push(`proposed ADR 缺少元数据：${missingProposed.join('、')}`)
    }

    if (meta['复核期限']) {
      const deadline = parseIsoDate(meta['复核期限'])
      if (!deadline) {
        errors.push(`复核期限必须是有效的 YYYY-MM-DD：'${meta['复核期限']}'`)
      } else if (strict && deadline < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z')) {
        errors.push(`proposed ADR 复核期限已过期：${meta['复核期限']}`)
      }
    }
  }

  // 4. Links resolve
  const baseDir = path.dirname(adrFile)
  for (const link of findLinks(content)) {
    const resolved = resolveLink(baseDir, link.target)
    if (!resolved) continue
    if (!existsSync(resolved)) {
      errors.push(`坏链接 [${link.text}](${link.target}) → ${path.relative(root, resolved)}`)
    }
  }

  // 5. Supersession format. A deleted direct predecessor does not need a stub.
  const supersedes = meta['取代'] ?? ''
  if (supersedes && supersedes !== '无' && !/^ADR-\d{4}$/.test(supersedes)) {
    errors.push(`取代 只能是单个 ADR-NNNN 或 '无'：'${supersedes}'`)
  }

  // 6. Code fences
  const fences = (content.match(/```/g) ?? []).length
  if (fences % 2 !== 0) {
    errors.push('Markdown 代码围栏未闭合（``` 数量为奇数）')
  }

  // 7. Line count
  const lineCount = content.split('\n').length
  if (lineCount > 60) {
    errors.push(`行数 ${lineCount} > 60（超过硬上限）`)
  }

  return { rel, filename, fileNumber, h1, status, lineCount, errors, warnings }
}

// ---------------------------------------------------------------------------
// Dead-reference scan: code/tests/scripts/docs referencing deleted ADR paths
// ---------------------------------------------------------------------------

const SCOPE_PATHS = [
  'src', 'tests', 'scripts', 'docs', 'shared', 'resources', '.github',
  'AGENTS.md', 'SECURITY.md', 'CONTRIBUTING.md', 'README.md', 'todolist.md'
]
const REF_FILE_EXTS = /\.(ts|tsx|js|mjs|json|md|yml|yaml|sh)$/

function collectLivingAdrs() {
  const numbers = new Set()
  const files = new Set()
  for (const file of readdirSync(adrDir)) {
    const match = file.match(/^(\d{4})-.*\.md$/)
    if (!match) continue
    numbers.add(match[1])
    files.add(file)
  }
  return { numbers, files }
}

function deadReferenceScan(living) {
  const refs = []
  const seen = new Set()
  for (const scope of SCOPE_PATHS) {
    const start = path.join(root, scope)
    if (!existsSync(start)) continue
    const stack = [start]
    while (stack.length) {
      const current = stack.pop()
      let currentStat
      try { currentStat = statSync(current) } catch { continue }
      const entries = currentStat.isDirectory() ? readdirSync(current) : [path.basename(current)]
      const base = currentStat.isDirectory() ? current : path.dirname(current)
      for (const entry of entries) {
        if (['node_modules', '.git', '.studiumx', 'coverage', 'out', 'dist', 'release'].includes(entry)) continue
        const full = path.join(base, entry)
        let st
        try { st = statSync(full) } catch { continue }
        if (st.isDirectory()) {
          stack.push(full)
        } else if (REF_FILE_EXTS.test(entry)) {
          const rel = path.relative(root, full).split(path.sep).join('/')
          if (rel.includes('out/') || rel.includes('web/dist/') || rel.includes('release/')) continue
          let text = readFileSync(full, 'utf8')
          // The H1 declares the current ADR; it is not a cross-reference.
          if (/^docs\/adr\/\d{4}-.*\.md$/.test(rel)) text = text.split('\n').slice(1).join('\n')

          const deadPathNumbers = new Set()
          const pathPattern = /(?:^|[^A-Za-z0-9._/-])((?:(?:\.\.\/)+)?(?:docs\/)?adr\/(\d{4}-[A-Za-z0-9._-]+\.md))\b/gi
          for (const match of text.matchAll(pathPattern)) {
            const referencedPath = match[1]
            const basename = match[2]
            if (living.files.has(basename)) continue
            deadPathNumbers.add(basename.slice(0, 4))
            const key = `${rel}:path:${referencedPath}`
            if (seen.has(key)) continue
            seen.add(key)
            refs.push({ rel, path: referencedPath })
          }

          const numbers = [...new Set(text.matchAll(/ADR-(\d{4})/gi))].map((match) => match[1])
          for (const number of numbers) {
            if (living.numbers.has(number) || deadPathNumbers.has(number)) continue
            const key = `${rel}:number:${number}`
            if (seen.has(key)) continue
            seen.add(key)
            refs.push({ rel, number })
          }
        }
      }
    }
  }
  return refs
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2)
  const modeStrict = args.includes('--strict')
  const modeAudit = args.includes('--audit')
  const skipDead = args.includes('--skip-dead-refs')

  const adrFiles = walkMarkdownFiles(adrDir)
    .filter((f) => path.basename(f).match(/^\d{4}-.*\.md$/))
    .sort()
  const adrs = adrFiles.map((file) => analyzeAdr(file, { strict: modeStrict }))

  let exitCode = 0
  const report = []
  const totals = { files: adrs.length, errors: 0, warnings: 0 }

  const actualNumbers = adrs.map((a) => a.fileNumber)
  const expectedNumbers = adrs.map((_, index) => String(index + 1).padStart(4, '0'))
  if (actualNumbers.some((number, index) => number !== expectedNumbers[index])) {
    totals.errors += 1
    exitCode = 1
    report.push({
      rel: 'docs/adr/',
      errors: [`ADR 编号不连续：期望 ${expectedNumbers.join(', ')}，实际 ${actualNumbers.join(', ')}`],
      warnings: []
    })
  }

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

  // Dead-reference scan (unless the ADR directory is mid-deletion)
  if (!skipDead) {
    const living = collectLivingAdrs()
    const dead = deadReferenceScan(living)
    if (dead.length) {
      totals.errors += dead.length
      exitCode = 1
      for (const reference of dead) {
        const message = reference.path
          ? `引用不存在的 ADR 路径：${reference.path}`
          : `引用已删除的 ADR-${reference.number}`
        report.push({ rel: reference.rel, errors: [message], warnings: [] })
      }
    }
  }

  if (modeAudit) {
    const outPath = path.join('/tmp', 'studiumx-adr-audit.json')
    writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totals, adrs }, null, 2), 'utf8')
    console.log(`[check-adr] audit written to ${outPath}`)
  }

  console.log(`[check-adr] ${totals.files} ADR files, ${totals.errors} errors, ${totals.warnings} warnings (declared ${adrs.filter(a=>a.status&&a.status.toLowerCase()==='proposed').length} proposed)`)
  for (const r of report) {
    console.log(`- ${r.rel}`)
    for (const e of r.errors) console.log(`    [error] ${e}`)
    for (const w of r.warnings) console.log(`    [warn]  ${w}`)
  }
  if (!skipDead) {
    console.log(modeStrict ? '[check-adr] strict mode' : '[check-adr] standard mode')
  } else {
    console.log('[check-adr] dead-reference scan disabled')
  }
  process.exit(exitCode)
}

main()
