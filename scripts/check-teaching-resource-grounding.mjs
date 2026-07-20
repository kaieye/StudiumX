import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/resource-grounder.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/grounding.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-context-assembler.unit.test.ts'), 'utf8')

assert.match(source, /requireSafeTeachingRelativePath/, 'Grounder must validate workspace-relative resource locations.')
assert.match(source, /readContainedRegularFileBounded/, 'Grounder must use bounded contained reads.')
assert.match(source, /TRUSTED_TEACHING_RESOURCE_SCHEMA_VERSION/, 'Grounder must reject unknown descriptor schema versions.')
assert.match(source, /'unauthorized_resource'|'unsafe_location'|'stale_source'|'duplicate_chunk'|'budget_exhausted'/, 'Grounder must retain typed resource rejection paths.')
assert.match(source, /PRIORITY_ORDER[\s\S]*required: 0[\s\S]*recommended: 1[\s\S]*supplemental: 2/, 'Grounder must prioritize deterministic trusted resources.')
assert.match(source, /contentSha256 !== descriptor\.contentSha256/, 'Grounder must reject stale source bytes.')
assert.match(source, /identity: sha256\(stableJson\(packWithoutIdentity\)\)/, 'Grounding identity must be deterministic.')
assert.match(shared, /type GroundedTeachingResource[\s\S]*sourceId:[\s\S]*location:[\s\S]*provenance:/, 'Grounded source must retain actual source ID, location, and provenance.')
assert.match(shared, /type GroundingBudget[\s\S]*maxBytes:[\s\S]*usedBytes:[\s\S]*truncationReason:/, 'Grounding budget must expose accounting and truncation reason.')
assert.match(shared, /type GroundingExclusionCode[\s\S]*resource_absent[\s\S]*unknown_schema[\s\S]*unauthorized_resource[\s\S]*unsafe_location[\s\S]*unsafe_url[\s\S]*source_unavailable[\s\S]*dead_reference[\s\S]*stale_source[\s\S]*duplicate_source_id[\s\S]*duplicate_chunk[\s\S]*resource_gap/, 'Grounding exclusions must be typed and conservative.')

assert.doesNotMatch(source, /writeFile|appendFile|mkdir|rename|unlink|rm\(|fetch\(|http:|https:|\bDate\b|Math\.random|from\s+['"][^'"]*(?:provider|model)[^'"]*['"]/i, 'Grounder must not write, fetch remotely, or depend on time/random/providers.')
assert.doesNotMatch(`${source}\n${shared}`, /\b(?:learnerAnswer|transcript|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds)\s*:/, 'Grounding contracts must not carry raw learner, transcript, evidence, assessment, or provider payloads.')
assert.match(unit, /deterministic priority and records budget truncation conservatively/, 'Unit coverage must retain priority and truncation behavior.')
assert.match(unit, /typed-excludes/, 'Unit coverage must retain all typed rejection cases.')

console.log('teaching resource grounding gate ok')


