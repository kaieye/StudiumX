import { describe, expect, it } from 'vitest'

import { formatAgentSandboxReadinessForUi } from '../../src/shared/teaching-types/agent-sandbox'

describe('formatAgentSandboxReadinessForUi (Stage E)', () => {
  it('labels Windows without OS enforcement as policy fence, never YOLO', () => {
    const text = formatAgentSandboxReadinessForUi({
      mode: 'workspace_write',
      backend: 'policy_fence',
      osEnforcementAvailable: false,
      platform: 'win32',
      windowsReadiness: 'notConfigured'
    })
    expect(text).toMatch(/策略围栏/)
    expect(text).toMatch(/backend=policy_fence/)
    expect(text).toMatch(/Windows readiness=notConfigured/)
    expect(text).not.toMatch(/YOLO|DangerFullAccess|always-approve/i)
  })

  it('labels macOS OS wrap when available', () => {
    const text = formatAgentSandboxReadinessForUi({
      mode: 'read_only',
      backend: 'macos_seatbelt',
      osEnforcementAvailable: true,
      platform: 'darwin'
    })
    expect(text).toMatch(/Seatbelt|OS 包装/)
    expect(text).toMatch(/只读沙箱/)
    expect(text).not.toMatch(/YOLO/i)
  })

  it('labels full_access as 宽松策略 only', () => {
    const text = formatAgentSandboxReadinessForUi({
      mode: 'full_access',
      backend: 'policy_fence',
      osEnforcementAvailable: false,
      platform: 'linux'
    })
    expect(text).toMatch(/宽松策略/)
    expect(text).not.toMatch(/YOLO|DangerFullAccess/i)
  })
})
