import { describe, expect, it, vi } from 'vitest'

import {
  createAgentRunResourcePolicyResolver,
  resolveUnconstrainedAgentRunResourcePolicy,
  snapshotAgentRunResourcePolicy,
  userAgentRunResourceBudgetFromSettings
} from '../../src/main/ai/agent-run-resource-policy'
import { createTeachingSettingsDefaults } from '../../src/shared/teaching-settings-schema'

describe('Agent run resource policy resolver', () => {
  it('resolves user and deployment limits only through host-owned callbacks', async () => {
    const userLoader = vi.fn(async () => ({
      limits: [{ meter: 'logical_requests' as const, limit: 3, scope: 'task' as const, auditId: 'user-choice' }]
    }))
    const deploymentLoader = vi.fn(async () => ({
      limits: [{ meter: 'provider_transport_attempts' as const, limit: 2, scope: 'deployment' as const, auditId: 'org-policy' }]
    }))
    const resolver = createAgentRunResourcePolicyResolver({
      loadUserBudget: userLoader,
      loadDeploymentPolicy: deploymentLoader,
      now: () => new Date('2026-08-05T00:00:00.000Z')
    })

    const snapshot = await resolver({
      runId: 'run-1', workspaceId: 'workspace-1', conversationId: 'conversation-1', mode: 'teaching'
    })

    expect(snapshot).toEqual({
      version: 1,
      resolvedAt: '2026-08-05T00:00:00.000Z',
      governance: {
        userBudget: { limits: [{ meter: 'logical_requests', limit: 3, scope: 'task', auditId: 'user-choice' }] },
        deploymentPolicy: { limits: [{ meter: 'provider_transport_attempts', limit: 2, scope: 'deployment', auditId: 'org-policy' }] }
      }
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.governance.userBudget?.limits)).toBe(true)
    expect(userLoader).toHaveBeenCalledWith({ runId: 'run-1', workspaceId: 'workspace-1', conversationId: 'conversation-1', mode: 'teaching' })
    expect(deploymentLoader).toHaveBeenCalledTimes(1)
  })

  it('drops malformed policy entries rather than promoting them to a resource boundary', () => {
    const snapshot = snapshotAgentRunResourcePolicy({
      resolvedAt: 'invalid',
      userBudget: {
        limits: [
          { meter: 'logical_requests', limit: 0, scope: 'run' },
          { meter: 'total_tokens', limit: 10.5, scope: 'run' },
          { meter: 'total_tokens', limit: 10, scope: 'run', auditId: '  public-label  ' }
        ]
      }
    })

    expect(snapshot).toEqual({
      version: 1,
      resolvedAt: '1970-01-01T00:00:00.000Z',
      governance: {
        userBudget: { limits: [{ meter: 'total_tokens', limit: 10, scope: 'run', auditId: 'public-label' }] }
      }
    })
  })

  it('projects only an enabled persisted user budget into per-run limits', () => {
    const settings = createTeachingSettingsDefaults('C:/workspace')
    expect(userAgentRunResourceBudgetFromSettings(settings)).toBeUndefined()

    settings.resourceBudget = {
      enabled: true,
      providerTransportAttempts: 7,
      toolOperationAttempts: 11,
      durationMinutes: 3,
      totalTokens: 12_345
    }

    expect(userAgentRunResourceBudgetFromSettings(settings)).toEqual({
      limits: [
        { meter: 'provider_transport_attempts', limit: 7, scope: 'run', auditId: 'user_budget.provider_transport_attempts' },
        { meter: 'tool_operation_attempts', limit: 11, scope: 'run', auditId: 'user_budget.tool_operation_attempts' },
        { meter: 'duration_ms', limit: 180_000, scope: 'run', auditId: 'user_budget.duration_minutes' },
        { meter: 'total_tokens', limit: 12_345, scope: 'run', auditId: 'user_budget.total_tokens' }
      ]
    })
  })

  it('uses no user or deployment boundary when no host policy is configured', async () => {
    const snapshot = await resolveUnconstrainedAgentRunResourcePolicy({ runId: 'run-1', mode: 'temporary' })
    expect(snapshot.governance).toEqual({})
  })
})

