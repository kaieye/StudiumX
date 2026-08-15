/**
 * Mind map command layer types.
 *
 * A `MindMapCommand` is a narrow but complete set of document mutations that
 * every editing entry point (keyboard, toolbar, drag & drop, AI accept,
 * import/paste) must funnel through. The reducer in `mind-map-reducer.ts` is a
 * pure function: `(doc, command) => { newDoc, inverse }`. Every command is
 * required to return an inverse command so the undo/redo stack can reverse it
 * without guessing.
 *
 * The v2 domain model, schemas and invariants live in `../domain/`; this file
 * only depends on those types.
 */
import type {
  MindMapDocumentV2,
  MindMapLayoutSettings,
  MindMapAssetRef,
  MindMapElement,
  MindMapElementStyle,
  MindMapLink,
  MindMapMarker,
  MindMapPlanningMetadata,
  MindMapPoint,
  MindMapSheetV2,
  MindMapSourceRef,
  MindMapTheme,
  MindMapTopicNumbering,
  MindMapTopicStyleOverride,
  MindMapTopicV2
} from '../domain/types'

/** Partial topic update. `null` removes an optional field; `undefined` leaves it untouched. */
export type MindMapTopicUpdatePatch = {
  title?: string | null
  note?: string | null
  collapsed?: boolean
  labels?: string[] | null
  markers?: MindMapMarker[] | null
  links?: MindMapLink[] | null
  formula?: string | null
  /** Stable document-level asset ids attached to this topic. */
  assetIds?: string[] | null
  sourceRefs?: MindMapSourceRef[] | null
  planning?: MindMapPlanningMetadata | null
  style?: MindMapTopicStyleOverride | null
  manualPosition?: MindMapPoint | null
  /** Topic numbering override; `null` clears it, `undefined` leaves it untouched. */
  numbering?: MindMapTopicNumbering | null
}

/**
 * Partial element update. Only fields allowed for the element's `type` may be
 * present; `null` removes an optional field, `undefined` leaves it untouched.
 */
/** Partial per-sheet layout update. Optional fields set to null restore inherited/default values. */
export type MindMapSheetLayoutUpdatePatch = {
  structureClass?: MindMapLayoutSettings['structureClass']
  direction?: MindMapLayoutSettings['direction'] | null
  compact?: boolean | null
  spacing?: number | null
  lineStyle?: MindMapLayoutSettings['lineStyle'] | null
  lineWidthScale?: number | null
  linePattern?: MindMapLayoutSettings['linePattern'] | null
  tapered?: boolean | null
}

export type MindMapElementUpdatePatch = {
  label?: string | null
  from?: string
  to?: string
  topicId?: string
  children?: string[] | null
  text?: string
  position?: MindMapPoint | null
  style?: MindMapElementStyle | null
}

/**
 * Narrow, complete command set for the v2 mind map model.
 *
 * `sheet.create` accepts either a pre-built `sheet` (used by undo restore) or
 * a `sheetId` + `title`; id generation is the caller's responsibility so the
 * reducer stays deterministic and free of hidden randomness.
 */
export type MindMapCommand =
  | { type: 'topic.insert'; sheetId: string; parentId: string; index?: number; node: MindMapTopicV2 }
  | { type: 'topic.update'; sheetId: string; topicId: string; patch: MindMapTopicUpdatePatch }
  | { type: 'topic.move'; sheetId: string; topicId: string; toParentId: string; toIndex?: number }
  | { type: 'topic.remove'; sheetId: string; topicId: string }
  | { type: 'asset.create'; asset: MindMapAssetRef }
  | { type: 'asset.remove'; assetId: string }
  | { type: 'element.create'; sheetId: string; index?: number; element: MindMapElement }
  | { type: 'element.update'; sheetId: string; elementId: string; patch: MindMapElementUpdatePatch }
  | { type: 'element.remove'; sheetId: string; elementId: string }
  | { type: 'selection.set-style'; sheetId: string; topicIds: string[]; style: MindMapTopicStyleOverride }
  | { type: 'sheet.create'; sheetId?: string; title?: string; index?: number; sheet?: MindMapSheetV2 }
  | { type: 'document.rename'; title: string }
  | { type: 'sheet.rename'; sheetId: string; title: string }
  | { type: 'sheet.update-layout'; sheetId: string; patch: MindMapSheetLayoutUpdatePatch }
  | { type: 'sheet.reorder'; sheetId: string; toIndex: number }
  | { type: 'sheet.remove'; sheetId: string }
  | { type: 'document.apply-theme'; theme: MindMapTheme }
  | { type: 'transaction'; commands: MindMapCommand[] }

/** Error codes produced by the command reducer. */
export type MindMapCommandErrorCode =
  | 'INVALID_DOCUMENT'
  | 'SHEET_NOT_FOUND'
  | 'TOPIC_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'TOPIC_IS_ROOT'
  | 'ELEMENT_NOT_FOUND'
  | 'ASSET_NOT_FOUND'
  | 'DUPLICATE_ID'
  | 'CYCLIC_MOVE'
  | 'INVALID_INDEX'
  | 'INVALID_PATCH'
  | 'INVALID_STYLE'
  | 'INVALID_NUMBERING'
  | 'INVALID_TRANSACTION'

export type MindMapCommandError = {
  code: MindMapCommandErrorCode
  message: string
  command: MindMapCommand
}

export type MindMapCommandResult =
  | { ok: true; document: MindMapDocumentV2; inverse: MindMapCommand }
  | { ok: false; error: MindMapCommandError }

/** Pure reducer signature used by the undo/redo stack and tests. */
export type MindMapCommandReducer = (
  document: MindMapDocumentV2,
  command: MindMapCommand
) => MindMapCommandResult
