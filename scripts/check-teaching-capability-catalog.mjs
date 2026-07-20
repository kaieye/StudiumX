import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/teaching-capability-catalog.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-capability-catalog.unit.test.ts'), 'utf8')

assert.match(source, /export type CapabilityStatus/, 'CapabilityStatus union is required.')
assert.match(
  source,
  /'available'[\s\S]*'disabled'[\s\S]*'unconfigured'[\s\S]*'denied'[\s\S]*'degraded'/,
  'Status vocabulary must include available|disabled|unconfigured|denied|degraded.'
)
assert.match(source, /export type CapabilitySnapshot/, 'CapabilitySnapshot type is required.')
assert.match(source, /snapshot\(request: TeachingCapabilityCatalogRequest\): CapabilitySnapshot/, 'snapshot(request) seam is required.')
assert.match(source, /export function selectPromptEligibleCapabilities\(/, 'Planner/context filter helper is required.')
assert.match(source, /promptEligible/, 'Prompt eligibility flag is required so disabled items stay out of prompts.')
assert.match(source, /resolveTeachingCapabilityPolicy/, 'Must derive permission boundaries from existing capability policy.')
assert.match(source, /resolveActiveProvider|resolveConfiguredProvider|availableProviders/, 'Must derive provider/search readiness from existing modules.')
assert.match(source, /DEFAULT_CAPABILITY_SNAPSHOT_TTL_MS|ttlMs|freshness/, 'Freshness/TTL support is required.')
assert.match(source, /degradedSnapshot|status: 'degraded'/, 'Failures must degrade gracefully.')
assert.doesNotMatch(
  source,
  /node:fs|node:fs\/promises|readFile\(|writeFile\(|mkdir\(|sqlite|MCP|cloud sync/i,
  'Catalog must stay a pure read-only snapshot adapter (no I/O, no second registry storage).'
)
assert.doesNotMatch(
  source,
  /class SkillLibrary|registerProvider\(/,
  'Must not create a second skill/provider registry.'
)

assert.match(unit, /promptEligible|non-prompt-eligible/, 'Unit coverage must prove disabled/unconfigured stay out of prompt inputs.')
assert.match(unit, /TTL|ttl|invalidate/, 'Unit coverage must prove freshness/TTL behavior.')
assert.match(unit, /degrad/i, 'Unit coverage must prove graceful degradation.')
assert.match(unit, /available capabilities for planner|prompt inputs/, 'Unit coverage must prove available-only consumption.')

console.log('teaching capability catalog gate ok')
