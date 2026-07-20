import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/teaching-audit-correlation.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-audit-correlation.unit.test.ts'), 'utf8')

assert.match(
  source,
  /export type AuditCorrelation = \{[\s\S]*sessionId: string[\s\S]*turnId: string[\s\S]*eventId\?: string[\s\S]*operationId\?: string[\s\S]*effectId\?: string/,
  'AuditCorrelation must expose sessionId, turnId, and optional event/operation/effect IDs.'
)
assert.match(source, /export type TeachingAuditSafeMetadata/, 'Safe metadata allowlist type must exist.')
assert.match(source, /export function createAuditCorrelation\(/, 'Correlation factory seam is required.')
assert.match(source, /export function projectSafeTeachingAuditMetadata\(/, 'Allowlist projector is required.')
assert.match(source, /export function buildTeachingAuditMetadataFromCommand\(/, 'Command correlation hook is required.')
assert.match(source, /export function buildTeachingAuditMetadataForToolOperation\(/, 'Tool/operation correlation hook is required.')
assert.match(source, /export function redactTeachingAuditForExport\(/, 'Export redaction helper is required.')
assert.match(source, /export function redactTeachingAuditText\(/, 'Text redaction helper is required.')
assert.match(source, /export function formatTeachingAuditSafeLogLine\(/, 'Safe log serialization seam is required.')
assert.match(source, /TEACHING_AUDIT_DENIED_FIELD_NAMES/, 'Denied field vocabulary must be exported.')
assert.match(source, /providerPayload|learnerAnswer|reasoning|apiKey|secret|prompt|transcript/, 'Denied vocabulary must name privacy-sensitive fields.')
assert.match(source, /import \{ redactAgentSecretText \} from '\.\.\/shared\/agent-secret-redaction'/, 'Must wrap existing secret redaction rather than reimplement secrets.')
assert.doesNotMatch(
  source,
  /node:fs|node:fs\/promises|readFile|writeFile|appendFile|mkdir|rename|unlink|rm\(|fetch\(|https?:\/\//i,
  'Audit correlation module must stay pure (no I/O or network).'
)
assert.doesNotMatch(
  source,
  /\b(?:sqlite|MCP|shell tool|second provider|cloud sync)\b/i,
  'Must not expand into forbidden P1 scopes.'
)

assert.match(unit, /creates AuditCorrelation from opaque session\/turn IDs/, 'Unit coverage must prove correlation construction.')
assert.match(unit, /projects only allowlisted safe metadata/, 'Unit coverage must prove allowlist projection.')
assert.match(unit, /builds command and tool operation hook metadata/, 'Unit coverage must prove command/tool hooks.')
assert.match(unit, /redacts secrets and denied fields on export/, 'Unit coverage must prove export redaction.')
assert.match(unit, /traces an outcome to evidence\/effect IDs without raw reasoning/, 'Unit coverage must prove outcome→evidence/effect ID tracing.')
assert.match(unit, /providerPayload|learnerAnswer|reasoning|sk-proj|sk-live/, 'Unit fixtures must exercise privacy denial cases.')

console.log('teaching audit correlation gate ok')
