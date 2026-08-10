import { describe, expect, it } from 'vitest'

import { parseMindMapProposalApplyPayload } from '../../src/main/mindmap/mind-map-proposal-ipc'

function validPayload() {
  return {
    workspaceId: 'workspace-1',
    id: 'map-1',
    expectedRevision: 4,
    proposal: {
      schemaVersion: 1,
      proposalId: 'proposal-1',
      scope: 'sheet',
      items: [
        {
          id: 'rename-document',
          command: { type: 'document.rename', title: 'New title' }
        },
        {
          id: 'rename-sheet',
          command: { type: 'sheet.rename', sheetId: 'sheet-1', title: 'New sheet title' }
        }
      ]
    },
    decisions: {
      'rename-document': 'accept'
    }
  }
}

describe('parseMindMapProposalApplyPayload', () => {
  it('accepts a strict proposal and allows omitted item decisions', () => {
    expect(parseMindMapProposalApplyPayload(validPayload())).toEqual(validPayload())
  })

  it('rejects unknown decision ids instead of silently ignoring stale review data', () => {
    expect(
      parseMindMapProposalApplyPayload({
        ...validPayload(),
        decisions: { stale: 'accept' }
      })
    ).toBeNull()
  })

  it('rejects malformed decisions and extra envelope keys before side effects', () => {
    expect(
      parseMindMapProposalApplyPayload({
        ...validPayload(),
        decisions: { 'rename-document': 'maybe' }
      })
    ).toBeNull()
    expect(
      parseMindMapProposalApplyPayload({
        ...validPayload(),
        extra: true
      })
    ).toBeNull()
  })

  it('rejects provider proposals with unknown command fields', () => {
    const payload = validPayload()
    payload.proposal.items[0]!.command = {
      type: 'document.rename',
      title: 'New title',
      extra: true
    } as never
    expect(parseMindMapProposalApplyPayload(payload)).toBeNull()
  })
})
