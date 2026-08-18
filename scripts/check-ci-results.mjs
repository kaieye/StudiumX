#!/usr/bin/env node
/**
 * Blocking CI fan-in aggregator; CI policy lives in CONTRIBUTING.md.
 *
 * Reads GitHub Actions `needs` context from NEEDS_JSON and fails unless every
 * required domain job result is exactly "success".
 *
 * skip=fail semantics: skipped | cancelled | failure | null | missing => exit 1.
 * Domain jobs remain the P0 gates; this script does not replace them.
 *
 * Pure Node, no package deps. Local dry-run:
 *   node scripts/check-ci-results.mjs --self-test
 *   NEEDS_JSON='...' node scripts/check-ci-results.mjs
 */

import process from 'node:process'

/** Jobs that must all report success for Blocking CI to pass. */
export const REQUIRED_JOBS = Object.freeze([
  'typecheck',
  'security-privacy',
  'teaching-evidence-p0',
])

/**
 * @param {unknown} needs
 * @param {readonly string[]} [requiredJobs]
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function evaluateNeeds(needs, requiredJobs = REQUIRED_JOBS) {
  const lines = []
  if (needs == null || typeof needs !== 'object' || Array.isArray(needs)) {
    lines.push('NEEDS_JSON must be a JSON object of job_id -> { result }')
    return { ok: false, lines }
  }

  /** @type {Record<string, unknown>} */
  const map = /** @type {Record<string, unknown>} */ (needs)
  let ok = true

  for (const jobId of requiredJobs) {
    const entry = map[jobId]
    const result =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? /** @type {{ result?: unknown }} */ (entry).result
        : undefined
    const resultStr = typeof result === 'string' ? result : String(result ?? 'missing')
    if (resultStr !== 'success') {
      ok = false
      lines.push(`FAIL  ${jobId}: result=${resultStr} (required: success; skip=fail)`)
    } else {
      lines.push(`OK    ${jobId}: success`)
    }
  }

  // Surface unexpected extra keys for operators (do not fail solely on extras).
  const known = new Set(requiredJobs)
  for (const key of Object.keys(map)) {
    if (!known.has(key)) {
      const entry = map[key]
      const result =
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? /** @type {{ result?: unknown }} */ (entry).result
          : undefined
      lines.push(`INFO  ${key}: result=${typeof result === 'string' ? result : String(result ?? 'n/a')} (not in required set)`)
    }
  }

  if (ok) {
    lines.push('ci-results: all required jobs succeeded (skip=fail gate passed)')
  } else {
    lines.push('ci-results: blocking fan-in FAILED (any non-success counts as fail)')
  }
  return { ok, lines }
}

/**
 * @param {string | undefined} raw
 * @returns {unknown}
 */
export function parseNeedsJson(raw) {
  if (raw == null || raw === '') {
    throw new Error(
      'NEEDS_JSON is missing. In CI, pass ${{ toJSON(needs) }}. Locally use --self-test or set NEEDS_JSON.',
    )
  }
  return JSON.parse(raw)
}

function runSelfTest() {
  /** @type {{ name: string, needs: unknown, expectOk: boolean }[]} */
  const cases = [
    {
      name: 'all success',
      needs: {
        typecheck: { result: 'success' },
        'security-privacy': { result: 'success' },
        'teaching-evidence-p0': { result: 'success' },
      },
      expectOk: true,
    },
    {
      name: 'skipped is fail',
      needs: {
        typecheck: { result: 'success' },
        'security-privacy': { result: 'skipped' },
        'teaching-evidence-p0': { result: 'success' },
      },
      expectOk: false,
    },
    {
      name: 'cancelled is fail',
      needs: {
        typecheck: { result: 'cancelled' },
        'security-privacy': { result: 'success' },
        'teaching-evidence-p0': { result: 'success' },
      },
      expectOk: false,
    },
    {
      name: 'failure is fail',
      needs: {
        typecheck: { result: 'failure' },
        'security-privacy': { result: 'success' },
        'teaching-evidence-p0': { result: 'success' },
      },
      expectOk: false,
    },
    {
      name: 'missing job is fail',
      needs: {
        typecheck: { result: 'success' },
        'security-privacy': { result: 'success' },
      },
      expectOk: false,
    },
    {
      name: 'null needs is fail',
      needs: null,
      expectOk: false,
    },
  ]

  let failed = 0
  for (const c of cases) {
    const { ok, lines } = evaluateNeeds(c.needs)
    if (ok !== c.expectOk) {
      failed += 1
      console.error(`self-test FAIL: ${c.name} expected ok=${c.expectOk} got ok=${ok}`)
      for (const line of lines) console.error('  ' + line)
    } else {
      console.log(`self-test OK: ${c.name}`)
    }
  }

  if (failed > 0) {
    console.error(`check-ci-results self-test: ${failed} case(s) failed`)
    process.exit(1)
  }
  console.log('check-ci-results self-test: all cases passed (skip=fail semantics)')
  process.exit(0)
}

function main(argv) {
  if (argv.includes('--self-test') || argv.includes('--test')) {
    runSelfTest()
    return
  }

  let needs
  try {
    needs = parseNeedsJson(process.env.NEEDS_JSON)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(msg)
    console.error('Hint: node scripts/check-ci-results.mjs --self-test')
    process.exit(1)
  }

  const { ok, lines } = evaluateNeeds(needs)
  for (const line of lines) {
    if (ok) console.log(line)
    else console.error(line)
  }
  process.exit(ok ? 0 : 1)
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('check-ci-results.mjs') ||
    process.argv[1].replaceAll('\\', '/').endsWith('scripts/check-ci-results.mjs'))

if (isDirect) {
  main(process.argv.slice(2))
}
