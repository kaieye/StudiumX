import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/session-resume-picker.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/session-resume-picker.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/session-resume-picker.unit.test.ts'), 'utf8')
const barrel = await readFile(resolve(root, 'src/shared/teaching-types.ts'), 'utf8')

assert.match(source, /export function buildSessionResumeCandidates/, 'Primary pure builder seam required.')
assert.match(source, /export async function listSessionResumeCandidates/, 'Optional ledger adapter seam required.')
assert.match(source, /DEFAULT_RESUME_PICKER_LIMIT = 20/, 'Default limit must be 20.')
assert.match(source, /MAX_RESUME_PICKER_LIMIT = 100/, 'Hard max limit must be 100.')

assert.match(shared, /SESSION_RESUME_PICKER_SCHEMA_VERSION = 1/, 'Shared schemaVersion must be 1.')
assert.match(shared, /export type ResumeCandidate/, 'Shared contract must export ResumeCandidate.')
assert.match(shared, /export type ResumePickerQuery/, 'Shared contract must export ResumePickerQuery.')
assert.match(shared, /export type ResumePickerReport/, 'Shared contract must export ResumePickerReport.')
assert.match(
  shared,
  /type ResumeEligibility[\s\S]*'ready'[\s\S]*'completed_read_only'[\s\S]*'legacy_read_only'[\s\S]*'quarantined'[\s\S]*'corrupt'/,
  'ResumeEligibility ladder must include ready, completed_read_only, legacy_read_only, quarantined, corrupt.'
)
assert.match(
  shared,
  /type ResumeCandidate[\s\S]*sessionId:[\s\S]*workspaceId:[\s\S]*status:[\s\S]*source:[\s\S]*courseId:[\s\S]*courseName:[\s\S]*lessonTitle:[\s\S]*eventCount:[\s\S]*updatedAt:[\s\S]*completedAt:[\s\S]*outcomeKind:[\s\S]*resumeEligibility:[\s\S]*reason:[\s\S]*rankScore:/,
  'ResumeCandidate must carry the full identity/ranking field set.'
)
assert.match(
  shared,
  /type ResumePickerQuery[\s\S]*limit\?:[\s\S]*courseId\?:[\s\S]*statusFilter\?:[\s\S]*queryText\?:/,
  'ResumePickerQuery must expose limit, courseId, statusFilter, queryText.'
)
assert.match(
  shared,
  /type ResumePickerReport[\s\S]*candidates:[\s\S]*totalScanned:[\s\S]*generatedAt:[\s\S]*diagnostics:/,
  'ResumePickerReport must include candidates, totalScanned, generatedAt, diagnostics.'
)

assert.match(barrel, /session-resume-picker/, 'Shared teaching-types barrel must re-export session-resume-picker.')

// Read-only pure projection: no filesystem writes, no random.
assert.doesNotMatch(
  source,
  /writeFile|appendFile|rename\(|unlink\(|rm\(|mkdir\(|replaceWithBackup|durableReplace/,
  'Session resume picker must stay read-only and must not write the filesystem.'
)
assert.doesNotMatch(source, /Math\.random\b/, 'Session resume picker must not use random state.')
assert.doesNotMatch(
  `${source}\n${shared}`,
  /\b(?:learnerAnswer|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds)\s*:/,
  'Resume picker contracts must not declare raw learner/provider payload fields.'
)

// Ranking / filter policy surface
assert.match(source, /ELIGIBILITY_RANK/, 'Ranking must encode eligibility tiers.')
assert.match(source, /ready:\s*0/, 'Active/ready candidates must rank first.')
assert.match(source, /completed_read_only:\s*1/, 'Completed trusted/read-only must rank after ready.')
assert.match(source, /legacy_read_only:\s*2/, 'Legacy projections must be demoted.')
assert.match(source, /quarantined:\s*3/, 'Quarantined identities must be demoted.')
assert.match(source, /corrupt:\s*4/, 'Corrupt sessions must rank last.')
assert.match(source, /courseName[\s\S]*lessonTitle/, 'queryText matching must use course/lesson titles only.')

// Unit contract coverage
assert.match(unit, /ranks active recent sessions before completed, legacy, and quarantined/, 'Unit coverage must retain ranking policy.')
assert.match(unit, /prefers completed sessions that carry a trusted outcome/, 'Unit coverage must retain trusted-outcome preference.')
assert.match(unit, /classifies corrupt diagnostics separately from general quarantine/, 'Unit coverage must retain corrupt vs quarantine split.')
assert.match(unit, /filters by courseId, statusFilter, and queryText over course\/lesson titles only/, 'Unit coverage must retain query filters.')
assert.match(unit, /caps limit to default 20 and hard max 100/, 'Unit coverage must retain limit caps.')
assert.match(unit, /never projects raw event payloads or learner answers onto candidates/, 'Unit coverage must retain redaction/exclusion.')
assert.match(unit, /listSessionResumeCandidates scans then builds via the thin adapter/, 'Unit coverage must retain adapter seam.')
assert.match(unit, /does not mutate deeply frozen scan inputs/, 'Unit coverage must retain pure/immutable behavior.')

const vitestEntry = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  resolve(root, 'node_modules/vitest/dist/cli.js')
].find((path) => existsSync(path))
assert.ok(vitestEntry, 'Local vitest entry must exist.')

const unitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/session-resume-picker.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(unitResult.status, 0, unitResult.stdout + unitResult.stderr)

console.log('session resume picker gate ok')
