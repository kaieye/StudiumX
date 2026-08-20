/**
 * Canonicalizes provider-owned topic identities before a proposal reaches the
 * reducer. Topic ids are graph keys rather than learner-visible labels, so a
 * language model reusing a familiar id must not make an otherwise safe edit
 * fail or corrupt a sheet.
 */
import { collectTopicIds } from '../domain/invariants'
import type { MindMapDocumentV2, MindMapTopicV2 } from '../domain/types'
import type { MindMapCommand } from './mind-map-command-types'
import type { MindMapProposalItem } from './mind-map-proposal'

/**
 * Reserve every id created by `topic.insert` against the canonical snapshot.
 *
 * The function deliberately changes only `topic.insert.node` ids. All other
 * topic-id fields identify nodes in the canonical snapshot; rewriting them
 * would be ambiguous and would violate the independently-reviewable proposal
 * contract. Nested commands are handled for strict-schema compatibility even
 * though provider prompts ask for one command per proposal item.
 */
export function reconcileMindMapProposalTopicIds(
  document: MindMapDocumentV2,
  items: readonly MindMapProposalItem[]
): MindMapProposalItem[] {
  const topicIdsBySheet = new Map(
    document.sheets.map((sheet) => [sheet.id, new Set(collectTopicIds(sheet))])
  )

  return items.map((item) => ({
    ...item,
    command: reconcileMindMapProposalCommandTopicIds(item.command, topicIdsBySheet)
  }))
}

function reconcileMindMapProposalCommandTopicIds(
  command: MindMapCommand,
  topicIdsBySheet: ReadonlyMap<string, Set<string>>
): MindMapCommand {
  if (command.type === 'transaction') {
    return {
      ...command,
      commands: command.commands.map((nested) => (
        reconcileMindMapProposalCommandTopicIds(nested, topicIdsBySheet)
      ))
    }
  }
  if (command.type !== 'topic.insert') return command

  const usedTopicIds = topicIdsBySheet.get(command.sheetId)
  // Keep an invalid sheet reference intact so the canonical reducer can report
  // the precise command error instead of hiding a malformed provider command.
  if (!usedTopicIds) return command

  return {
    ...command,
    node: reconcileInsertedTopicTreeIds(command.node, usedTopicIds)
  }
}

function reconcileInsertedTopicTreeIds(
  topic: MindMapTopicV2,
  usedTopicIds: Set<string>
): MindMapTopicV2 {
  return {
    ...topic,
    id: reserveTopicId(topic.id, usedTopicIds),
    children: topic.children.map((child) => reconcileInsertedTopicTreeIds(child, usedTopicIds))
  }
}

function reserveTopicId(preferredId: string, usedTopicIds: Set<string>): string {
  if (!usedTopicIds.has(preferredId)) {
    usedTopicIds.add(preferredId)
    return preferredId
  }

  let suffix = 1
  let candidate = `${preferredId}-${suffix}`
  while (usedTopicIds.has(candidate)) {
    suffix += 1
    candidate = `${preferredId}-${suffix}`
  }
  usedTopicIds.add(candidate)
  return candidate
}
