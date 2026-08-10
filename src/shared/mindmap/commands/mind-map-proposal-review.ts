/**
 * Pure request-only review seam for the renderer.
 *
 * This combines the canonical request builder with a local review lifecycle,
 * but intentionally does not parse a provider proposal, contact a provider,
 * or carry any commands. The empty item list is an explicit request preview
 * shell: accept/reject here records only the local review outcome and cannot
 * mutate the mind-map document.
 */
import {
  buildMindMapProposalRequest,
  type MindMapProposalRequestInput,
  type MindMapProposalRequestResult
} from './mind-map-proposal-request'
import type { MindMapSourceRef, MindMapTopicV2 } from '../domain/types'
import {
  createMindMapProposalState,
  type MindMapProposalState
} from './mind-map-proposal-state'

export type MindMapProposalReviewPreview = {
  request: Extract<MindMapProposalRequestResult, { ok: true }>['request']
  state: MindMapProposalState
}

export type MindMapProposalReviewPreviewResult =
  | { ok: true; preview: MindMapProposalReviewPreview }
  | Extract<MindMapProposalRequestResult, { ok: false }>

function requestPreviewId(
  request: MindMapProposalReviewPreview['request']
): string {
  return `request-preview:${request.documentId}:${request.sheetId}:${request.scope}`
}

function collectSourceRefs(topic: MindMapTopicV2, refs: MindMapSourceRef[]): void {
  for (const sourceRef of topic.sourceRefs ?? []) {
    refs.push({
      ...sourceRef,
      ...(sourceRef.breadcrumb ? { breadcrumb: [...sourceRef.breadcrumb] } : {})
    })
  }
  for (const child of topic.children) collectSourceRefs(child, refs)
}

/**
 * Read source anchors from the current sheet only. The request builder still
 * validates every value and replaces metadata with its document-canonical
 * copy; this traversal is just the explicit source-scope selection step.
 */
function currentSheetSourceRefs(input: MindMapProposalRequestInput): MindMapSourceRef[] {
  if (typeof input.sheetId !== 'string') return []
  try {
    const sheet = input.document.sheets.find((candidate) => candidate.id === input.sheetId)
    if (!sheet) return []
    const refs: MindMapSourceRef[] = []
    collectSourceRefs(sheet.root, refs)
    return refs
  } catch {
    // Let buildMindMapProposalRequest classify the malformed document.
    return []
  }
}

/**
 * Build a canonical, local-only request preview and pending review state.
 *
 * A successful result is still only context metadata. No provider proposal or
 * mutation command exists at this boundary, so settlement must stay local.
 */
export function buildMindMapProposalReviewPreview(
  input: MindMapProposalRequestInput
): MindMapProposalReviewPreviewResult {
  const requestInput =
    input.scope === 'source' && input.sourceRefs === undefined
      ? { ...input, sourceRefs: currentSheetSourceRefs(input) }
      : input
  const requestResult = buildMindMapProposalRequest(requestInput)
  if (!requestResult.ok) return requestResult

  const request = requestResult.request
  return {
    ok: true,
    preview: {
      request,
      state: createMindMapProposalState(requestPreviewId(request), [])
    }
  }
}
