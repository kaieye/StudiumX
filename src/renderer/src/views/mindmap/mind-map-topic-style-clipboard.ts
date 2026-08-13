import type { MindMapCommand } from '../../../../shared/mindmap/commands'
import { mindMapTopicStyleOverrideSchema } from '../../../../shared/mindmap/domain/schema'
import type {
  MindMapSheetV2,
  MindMapTopicStyleOverride
} from '../../../../shared/mindmap/domain/types'
import { findTopicInSheet } from './mind-map-commands'

/**
 * Renderer-local style clipboard. It carries only fields accepted by the
 * canonical topic-style schema; topic content and structural children never
 * enter this payload.
 */
export type MindMapTopicStyleClipboard = {
  kind: 'topic-style'
  style: MindMapTopicStyleOverride | null
}

/** Capture a detached, schema-filtered snapshot of one topic's local style. */
export function captureTopicStyleClipboard(
  style: MindMapTopicStyleOverride | undefined
): MindMapTopicStyleClipboard {
  if (style === undefined) return { kind: 'topic-style', style: null }
  const parsed = mindMapTopicStyleOverrideSchema.parse(structuredClone(style))
  return {
    kind: 'topic-style',
    style: Object.keys(parsed).length > 0 ? parsed : null
  }
}

/**
 * Paste the snapshot over compatible topic-style fields only.
 *
 * A transaction makes a multi-selection one undo/redo operation. Replacing the
 * local style snapshot (rather than topic content) also lets an empty copied
 * style intentionally restore theme/structural inheritance on every target.
 */
export function buildPasteTopicStyleCommand(
  sheet: MindMapSheetV2,
  topicIds: readonly string[],
  clipboard: MindMapTopicStyleClipboard
): MindMapCommand | null {
  const targets = [...new Set(topicIds)].filter(
    (topicId) => findTopicInSheet(sheet, topicId) !== undefined
  )
  if (targets.length === 0) return null

  const commands: MindMapCommand[] = targets.map((topicId) => ({
    type: 'topic.update',
    sheetId: sheet.id,
    topicId,
    patch: {
      style: clipboard.style === null ? null : structuredClone(clipboard.style)
    }
  }))

  return commands.length === 1 ? commands[0] : { type: 'transaction', commands }
}
