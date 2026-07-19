import { describe, expect, it } from 'vitest'

import { parseSetWorkspaceTrustPayload } from '../../src/main/teaching-ipc-commands'

describe('parseSetWorkspaceTrustPayload', () => {
  it('accepts only a workspace id and the binary trust state', () => {
    expect(parseSetWorkspaceTrustPayload({ workspaceId: 'workspace-1', trust: 'trusted' }))
      .toEqual({ workspaceId: 'workspace-1', trust: 'trusted' })
    expect(parseSetWorkspaceTrustPayload({ workspaceId: 'workspace-1', trust: 'untrusted' }))
      .toEqual({ workspaceId: 'workspace-1', trust: 'untrusted' })
  })

  it('rejects extra capability data such as a root path', () => {
    expect(() => parseSetWorkspaceTrustPayload({
      workspaceId: 'workspace-1', trust: 'trusted', rootPath: 'D:/not-renderer-authoritative'
    })).toThrow('IPC workspace trust payload must contain only "workspaceId" and "trust".')
  })

  it('rejects malformed trust values before a gateway action can run', () => {
    expect(() => parseSetWorkspaceTrustPayload({ workspaceId: 'workspace-1', trust: 'pending' }))
      .toThrow('IPC payload field "trust" must be one of: trusted, untrusted.')
  })
})
