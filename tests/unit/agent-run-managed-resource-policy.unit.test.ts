import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  extractManagedDeploymentResourcePolicy,
  loadManagedDeploymentResourcePolicyFromRoot
} from '../../src/main/ai/agent-run-managed-resource-policy'
import { createAgentRunResourcePolicyResolver } from '../../src/main/ai/agent-run-resource-policy'
import {
  AgentRunResourceBoundaryError,
  AgentRunResourceGovernor
} from '../../src/main/ai/agent-run-resource-governance'
import { DEFAULT_MANAGED_CONFIG_RELATIVE_PATH } from '../../src/main/teaching-managed-config-fs'

const roots: string[] = []

async function managedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-managed-resource-policy-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop()
    if (root) await rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

describe('managed deployment resource policy', () => {
  it('projects only valid secret-free resource limits from the dedicated managed field', () => {
    const result = extractManagedDeploymentResourcePolicy({
      resourceGovernance: {
        deploymentPolicy: {
          limits: [
            {
              meter: 'provider_transport_attempts',
              limit: 12,
              scope: 'deployment',
              auditId: '  org.transport-cap  ',
              apiKey: 'must-not-be-projected'
            },
            {
              meter: 'total_tokens',
              limit: 50_000,
              scope: 'tenant',
              secret: 'also-not-projected'
            }
          ],
          apiKey: 'not-a-policy-output'
        }
      },
      provider: { apiKey: 'not-a-policy-output' }
    })

    expect(result).toEqual({
      limits: [
        {
          meter: 'provider_transport_attempts',
          limit: 12,
          scope: 'deployment',
          auditId: 'org.transport-cap'
        },
        { meter: 'total_tokens', limit: 50_000, scope: 'tenant' }
      ]
    })
    expect(JSON.stringify(result)).not.toContain('apiKey')
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(Object.isFrozen(result?.limits)).toBe(true)
  })

  it('drops malformed entries and omits an all-invalid or unrelated policy', () => {
    expect(extractManagedDeploymentResourcePolicy({
      resourceGovernance: {
        deploymentPolicy: {
          limits: [
            { meter: 'unknown', limit: 10, scope: 'deployment' },
            { meter: 'total_tokens', limit: 0, scope: 'deployment' },
            { meter: 'total_tokens', limit: 10.5, scope: 'deployment' },
            { meter: 'total_tokens', limit: 1, scope: 'not-a-scope' }
          ]
        }
      }
    })).toBeUndefined()
    expect(extractManagedDeploymentResourcePolicy({ resourceGovernance: {} })).toBeUndefined()
    expect(extractManagedDeploymentResourcePolicy({ deploymentPolicy: { limits: [] } })).toBeUndefined()
    expect(extractManagedDeploymentResourcePolicy(null)).toBeUndefined()
  })

  it('loads a persisted managed document under the host root and snapshots it as deployment policy', async () => {
    const root = await managedRoot()
    await writeFile(join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH), JSON.stringify({
      resourceGovernance: {
        deploymentPolicy: {
          limits: [{
            meter: 'provider_transport_attempts',
            limit: 1,
            scope: 'deployment',
            auditId: 'managed.single-dispatch'
          }]
        }
      }
    }), 'utf8')

    const loadDeploymentPolicy = async () => loadManagedDeploymentResourcePolicyFromRoot({ rootPath: root })
    const resolver = createAgentRunResourcePolicyResolver({ loadDeploymentPolicy })
    const snapshot = await resolver({ runId: 'run-1', mode: 'teaching' })

    expect(snapshot.governance).toEqual({
      deploymentPolicy: {
        limits: [{
          meter: 'provider_transport_attempts',
          limit: 1,
          scope: 'deployment',
          auditId: 'managed.single-dispatch'
        }]
      }
    })
  })

  it('reports a managed deployment boundary as resource_limit rather than a provider quota', async () => {
    const root = await managedRoot()
    await writeFile(join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH), JSON.stringify({
      resourceGovernance: {
        deploymentPolicy: {
          limits: [{
            meter: 'provider_transport_attempts',
            limit: 1,
            scope: 'deployment',
            auditId: 'managed.one-provider-attempt'
          }]
        }
      }
    }), 'utf8')

    const resolver = createAgentRunResourcePolicyResolver({
      loadDeploymentPolicy: async () => loadManagedDeploymentResourcePolicyFromRoot({ rootPath: root })
    })
    const snapshot = await resolver({ runId: 'run-governed', mode: 'temporary' })
    const governor = new AgentRunResourceGovernor({ governance: snapshot.governance })

    governor.claim('provider_transport_attempts')
    expect(() => governor.claim('provider_transport_attempts')).toThrow(AgentRunResourceBoundaryError)
    expect(governor.boundary).toMatchObject({
      layer: 'deployment_policy',
      meter: 'provider_transport_attempts',
      action: 'resource_limit',
      auditId: 'managed.one-provider-attempt'
    })
    governor.dispose()
  })
  it('fails closed to no deployment policy for a missing or invalid managed document', async () => {
    const root = await managedRoot()
    await expect(loadManagedDeploymentResourcePolicyFromRoot({ rootPath: root })).resolves.toBeUndefined()

    await writeFile(join(root, DEFAULT_MANAGED_CONFIG_RELATIVE_PATH), '{not-json', 'utf8')
    await expect(loadManagedDeploymentResourcePolicyFromRoot({ rootPath: root })).resolves.toBeUndefined()
  })
})

