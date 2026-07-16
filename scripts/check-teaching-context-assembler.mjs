import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(root, 'src/main/teaching-context-assembler.ts'), 'utf8')
const shared = await readFile(resolve(root, 'src/shared/teaching-types/teaching-context.ts'), 'utf8')
const grounding = await readFile(resolve(root, 'src/shared/teaching-types/grounding.ts'), 'utf8')
const unit = await readFile(resolve(root, 'tests/unit/teaching-context-assembler.unit.test.ts'), 'utf8')
const integration = await readFile(resolve(root, 'tests/integration/teaching-context-assembler.integration.test.ts'), 'utf8')

assert.match(source, /export interface TeachingContextAssembler[\s\S]*assemble\(input: TeachingContextAssemblerInput, consumer: TeachingContextConsumer\)/, 'Assembler must expose one typed consumer-neutral operation.')
assert.match(source, /export function createTeachingContextAssembler\(grounder: ResourceGrounder\)/, 'Assembler must retain a factory seam.')
assert.match(source, /void consumer/, 'Consumer mode must not alter normalized context.')
assert.match(source, /identity: sha256\(JSON\.stringify\(contextWithoutIdentity\)\)/, 'Context identity must derive from normalized context only.')
assert.match(shared, /type TeachingContextConsumer = 'lesson' \| 'conversation'/, 'Both teaching consumers must be explicit.')
assert.match(shared, /type TeachingContext[\s\S]*grounding:/, 'Context must carry grounding identity/status only.')
assert.match(grounding, /type GroundingPack[\s\S]*identity:[\s\S]*sources:[\s\S]*exclusions:[\s\S]*budget:/, 'Grounding pack must contain identity, sources, exclusions, and budget.')

assert.doesNotMatch(source, /node:fs|node:fs\/promises|readFile|writeFile|appendFile|mkdir|rename|unlink|rm\(|fetch\(|http:|https:|\bDate\b|Math\.random|from\s+['"][^'"]*(?:provider|model)[^'"]*['"]/i, 'Assembler must not perform I/O, remote calls, or depend on time/random/providers.')
assert.doesNotMatch(`${source}\n${shared}\n${grounding}`, /\b(?:learnerAnswer|transcript|rawEvidenceText|assessmentPayload|providerResponse|selectedOptionIds)\s*:/, 'Contracts must not project raw learner, transcript, evidence, assessment, or provider payloads.')

assert.match(unit, /repeated semantically identical facts in both consumer modes/, 'Unit coverage must retain cross-consumer deterministic behavior.')
assert.match(unit, /never projects injected learner, transcript, evidence, assessment, or provider payloads/, 'Unit coverage must retain redaction behavior.')
assert.match(unit, /does not mutate deeply frozen normalized facts/, 'Unit coverage must retain immutable-input behavior.')
assert.match(integration, /assembles exactly two fixture-like trusted sources for lesson and conversation, then excludes source removal and invalidity/, 'Integration must retain the source removal/invalidity scenario.')

console.log('teaching context assembler gate ok')
