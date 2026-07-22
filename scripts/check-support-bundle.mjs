import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/support-bundle.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/support-bundle.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/support-bundle.unit.test.ts'), 'utf8')
const barrel = await readFile(resolve(root, 'src/shared/teaching-types.ts'), 'utf8')
const pkg = await readFile(resolve(root, 'package.json'), 'utf8')

assert.match(shared, /export const SUPPORT_BUNDLE_SCHEMA_VERSION = 1/, 'Shared schemaVersion must be 1.')
assert.match(
  shared,
  /export type SupportBundleSectionId[\s\S]*'doctor'[\s\S]*'inspector'[\s\S]*'config_fingerprint'[\s\S]*'capability'[\s\S]*'audit_correlation'[\s\S]*'environment'[\s\S]*'local_data_index'[\s\S]*'mcp_status'/,
  'Shared section IDs must include doctor|inspector|config_fingerprint|capability|audit_correlation|environment|local_data_index|mcp_status.'
)
assert.match(shared, /export type SupportBundlePreview/, 'SupportBundlePreview type is required.')
assert.match(shared, /export type SupportBundleConsent/, 'SupportBundleConsent type is required.')
assert.match(shared, /export type SupportBundleExport/, 'SupportBundleExport type is required.')
assert.match(shared, /export type RedactionPolicy/, 'RedactionPolicy type is required.')
assert.match(shared, /noRawPrompts:\s*true/, 'RedactionPolicy must document noRawPrompts.')
assert.match(shared, /noApiKeys:\s*true/, 'RedactionPolicy must document noApiKeys.')
assert.match(shared, /noAbsoluteHomePaths:\s*true/, 'RedactionPolicy must document noAbsoluteHomePaths.')
assert.match(shared, /noLearnerAnswers:\s*true/, 'RedactionPolicy must document noLearnerAnswers.')
assert.match(shared, /accepted:\s*true/, 'Consent must require accepted: true literal.')

assert.match(source, /export function previewSupportBundle\(/, 'previewSupportBundle seam is required.')
assert.match(source, /export function exportSupportBundle\(/, 'exportSupportBundle seam is required.')
assert.match(source, /consent_required/, 'Export must fail closed with consent_required.')
assert.match(source, /section_not_previewed/, 'Export must reject sections not present in preview.')
assert.match(source, /exportTeachingDoctorReport/, 'Doctor section must reuse exportTeachingDoctorReport.')
assert.match(source, /function buildMcpStatusSection/, 'MCP status section builder is required (ADR-0128 Phase E).')
assert.match(source, /mcp_status/, 'Support bundle must include mcp_status section id.')
assert.match(unit, /packs redacted MCP status/, 'Unit must cover MCP support-bundle redaction.')
assert.match(unit, /never packs smuggled MCP secret/, 'Unit must cover MCP secret smuggling denial.')
assert.match(source, /redactAgentSecretText/, 'Must wrap existing secret redaction.')
assert.match(source, /redactTeachingAuditForExport|projectSafeTeachingAuditMetadata/, 'Audit section must reuse audit export helpers.')
assert.match(source, /<redacted-absolute-path>/, 'Absolute paths must collapse to redacted-absolute-path stub.')
assert.match(source, /workspaceRoot/, 'Workspace-relative path rewrite requires workspaceRoot input.')
assert.doesNotMatch(
  source,
  /Math\.random\b/,
  'Support bundle must not use random state.'
)
assert.doesNotMatch(
  source,
  /node:fs(?:\/promises)?|writeFile\s*\(|appendFile\s*\(|\bfetch\s*\(|https?:\/\/|mailto:|\bsmtp\b/i,
  'Support bundle must stay pure: no filesystem writes or network I/O.'
)
assert.doesNotMatch(
  source,
  /\bautoUpload\b|\buploadBundle\b|\bsendEmail\b|\bemailSupport\b/i,
  'Support bundle must not implement auto-upload or emailing support.'
)
assert.doesNotMatch(
  `${source}\n${shared}`,
  /learnerAnswer\s*:\s*string|rawPrompt|assessmentPayload|providerResponse/,
  'Contracts must not project raw learner, prompt, assessment, or provider payload fields.'
)

assert.match(barrel, /support-bundle/, 'Shared teaching-types barrel must re-export support-bundle.')
assert.match(pkg, /"check:support-bundle"\s*:\s*"node scripts\/check-support-bundle\.mjs"/, 'package.json must register check:support-bundle.')

// Unit contract coverage
assert.match(unit, /previews redacted sections and strips secrets and absolute paths/, 'Unit coverage must prove preview redaction.')
assert.match(unit, /export without consent fails with consent_required/, 'Unit coverage must prove consent gate.')
assert.match(unit, /export honors section allowlist/, 'Unit coverage must prove section allowlist.')
assert.match(unit, /doctor fail is still exportable/, 'Unit coverage must prove fail doctor remains exportable.')
assert.match(unit, /learner answers|sk-live|absolute/, 'Unit fixtures must exercise secret/path/learner redaction cases.')

const vitestEntry = [
  resolve(root, 'node_modules/vitest/vitest.mjs'),
  resolve(root, 'node_modules/vitest/dist/cli.js')
].find((path) => existsSync(path))
assert.ok(vitestEntry, 'Local vitest entry must exist.')

const unitResult = spawnSync(
  process.execPath,
  [vitestEntry, 'run', '--project', 'unit', 'tests/unit/support-bundle.unit.test.ts'],
  { cwd: root, encoding: 'utf8', env: { ...process.env, CI: 'true' } }
)
assert.equal(unitResult.status, 0, unitResult.stdout + unitResult.stderr)

console.log('support bundle gate ok')

