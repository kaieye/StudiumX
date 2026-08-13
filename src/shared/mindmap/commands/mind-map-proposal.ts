/**
 * Strict provider proposal boundary plus the pure accept/reject adapter for AI
 * mind-map proposals.
 *
 * Provider JSON is parsed into validated command data before review state is
 * created. The adapter then turns review decisions into one transaction and
 * delegates to the canonical command reducer. That keeps an accepted AI diff
 * atomic and undoable while rejected (or unreviewed) items never reach the
 * document.
 */
import { z } from 'zod'

import { mindMapStructureClassSchema } from '../mind-map-schema'
import type {
  MindMapDocumentV2,
  MindMapElement,
  MindMapSheetV2,
  MindMapTopicV2
} from '../domain/types'
import { applyMindMapCommand } from './mind-map-reducer'
import type {
  MindMapCommand,
  MindMapElementUpdatePatch,
  MindMapSheetLayoutUpdatePatch,
  MindMapTopicUpdatePatch,
  MindMapCommandError,
  MindMapCommandResult
} from './mind-map-command-types'

/** One independently reviewable AI diff item. */
export type MindMapProposalItem = {
  /** Stable id used by the renderer to persist the review decision. */
  id: string
  /** The only mutation that accepting this item may perform. */
  command: MindMapCommand
}

/** Scope explicitly selected by the user before a provider run. */
export const MIND_MAP_PROPOSAL_SCOPES = ['selection', 'sheet', 'source', 'selected-file', 'notes', 'lesson'] as const
export type MindMapProposalScope = (typeof MIND_MAP_PROPOSAL_SCOPES)[number]

/** Provider-facing proposal envelope. It is data only until reviewed. */
export type MindMapProviderProposal = {
  schemaVersion: 1
  proposalId: string
  scope: MindMapProposalScope
  items: MindMapProposalItem[]
}

/** Result returned by the pure provider JSON boundary. */
export type MindMapProposalParseResult =
  | { ok: true; proposal: MindMapProviderProposal }
  | { ok: false; code: 'json_parse' | 'schema_invalid'; message: string }

const nonEmptyIdSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'must not be empty'
})
const nonNegativeIntegerSchema = z.number().int().nonnegative()
const finiteNumberSchema = z.number().finite()
const mindMapColorProposalSchema = z.string().regex(
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  'must be a CSS hex color'
)
const mindMapFontFamilyProposalSchema = z.string().trim().min(1).max(512)
const mindMapFontWeightProposalSchema = z.enum([
  'normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'
])
const mindMapTopicShapeProposalSchema = z.enum([
  'roundedRect',
  'rounded-rect',
  'rect',
  'ellipse',
  'diamond',
  'underline',
  'fishbone',
  'none',
  'quote',
  'callout',
  'bracket',
  'arrow-right',
  'arrow-left',
  'heart',
  'cloud',
  'star',
  'parallelogram',
  'hexagon'
])
const mindMapFillPatternProposalSchema = z.enum(['solid', 'hand-drawn', 'diagonal', 'horizontal'])
const mindMapTopicWidthModeProposalSchema = z.enum(['auto', 'fixed'])
const mindMapTopicWidthProposalSchema = finiteNumberSchema.min(72).max(720)

const mindMapPointProposalSchema = z
  .object({ x: finiteNumberSchema, y: finiteNumberSchema })
  .strict()

export const mindMapTopicStyleProposalSchema = z
  .object({
    fill: mindMapColorProposalSchema.optional(),
    stroke: mindMapColorProposalSchema.optional(),
    borderStyle: z.enum(['none', 'solid', 'dash', 'hand-drawn-solid', 'hand-drawn-dash']).optional(),
    borderWidth: finiteNumberSchema.positive().max(32).optional(),
    textColor: mindMapColorProposalSchema.optional(),
    fontFamily: mindMapFontFamilyProposalSchema.optional(),
    fontSize: finiteNumberSchema.positive().max(512).optional(),
    fontWeight: mindMapFontWeightProposalSchema.optional(),
    fontStyle: z.enum(['normal', 'italic']).optional(),
    textDecoration: z.enum(['none', 'underline', 'line-through', 'line-through underline']).optional(),
    textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
    textAlign: z.enum(['left', 'center', 'right']).optional(),
    shape: mindMapTopicShapeProposalSchema.optional(),
    fillPattern: mindMapFillPatternProposalSchema.optional(),
    widthMode: mindMapTopicWidthModeProposalSchema.optional(),
    width: mindMapTopicWidthProposalSchema.optional(),
    structureClass: mindMapStructureClassSchema.optional()
  })
  .strict()

export const mindMapThemeProposalSchema = z
  .object({
    id: nonEmptyIdSchema,
    name: z.string().optional(),
    background: z.union([mindMapColorProposalSchema, z.literal('transparent')]).optional(),
    branchColors: z.array(mindMapColorProposalSchema).min(1).max(64).optional(),
    textColor: mindMapColorProposalSchema.optional(),
    lineColor: mindMapColorProposalSchema.optional(),
    fontFamily: mindMapFontFamilyProposalSchema.optional(),
    shape: mindMapTopicShapeProposalSchema.optional(),
    rainbowBranches: z.boolean().optional(),
    colorSchemeId: z.string().trim().min(1).max(128).optional(),
    topicStyles: z
      .object({
        central: mindMapTopicStyleProposalSchema.optional(),
        main: mindMapTopicStyleProposalSchema.optional(),
        sub: mindMapTopicStyleProposalSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict()

const mindMapPlanningProposalSchema = z
  .object({
    taskStatus: z.enum(['not-started', 'todo', 'doing', 'done']).optional(),
    dueAt: z.string().optional(),
    progress: finiteNumberSchema.min(0).max(100).optional(),
    priority: finiteNumberSchema.int().optional()
  })
  .strict()

const mindMapMarkerProposalSchema = z
  .object({
    id: nonEmptyIdSchema,
    symbol: z.string(),
    label: z.string().optional()
  })
  .strict()

const mindMapLinkProposalSchema = z
  .object({
    id: nonEmptyIdSchema,
    url: z.string(),
    title: z.string().optional()
  })
  .strict()

const mindMapSourceRefProposalSchema = z
  .object({
    id: nonEmptyIdSchema,
    workspacePath: z.string().optional(),
    breadcrumb: z.array(z.string()).optional(),
    blockId: z.string().optional(),
    contentHash: z.string().optional(),
    lastConfirmedAt: z.string().optional(),
    stale: z.boolean().optional()
  })
  .strict()

const mindMapElementArrowShapeProposalSchema = z.enum([
  'none',
  'dot',
  'triangle',
  'spearhead',
  'square',
  'diamond',
  'herringbone',
  'double-arrow',
  'anti-triangle',
  'attached',
  'hook'
])

const mindMapElementLineShapeProposalSchema = z.enum([
  'curved',
  'straight',
  'angled',
  'zigzag',
  'flexible-curved',
  'flexible-angled',
  'flexible-zigzag'
])

export const mindMapElementLinePatternProposalSchema = z.enum([
  'solid',
  'dash',
  'dot',
  'dash-dot',
  'dash-dot-dot'
])

const mindMapElementOutlineShapeProposalSchema = z.enum([
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'polygon',
  'scallops',
  'waves',
  'tension',
  'bracket'
])

export const mindMapElementStyleProposalSchema = z
  .object({
    stroke: z.string().optional(),
    strokeWidth: finiteNumberSchema.nonnegative().optional(),
    fill: z.string().optional(),
    textColor: z.string().optional(),
    fontFamily: z.string().optional(),
    fontSize: finiteNumberSchema.positive().optional(),
    dashed: z.boolean().optional(),
    lineShape: mindMapElementLineShapeProposalSchema.optional(),
    beginArrow: mindMapElementArrowShapeProposalSchema.optional(),
    endArrow: mindMapElementArrowShapeProposalSchema.optional(),
    linePattern: mindMapElementLinePatternProposalSchema.optional(),
    outlineShape: mindMapElementOutlineShapeProposalSchema.optional()
  })
  .strict()

const mindMapTopicProposalSchema: z.ZodType<MindMapTopicV2, z.ZodTypeDef, unknown> = z.lazy(() =>
  z
    .object({
      id: nonEmptyIdSchema,
      title: z.string(),
      note: z.string().optional(),
      collapsed: z.boolean().optional(),
      children: z.array(mindMapTopicProposalSchema).default([]),
      labels: z.array(z.string()).optional(),
      markers: z.array(mindMapMarkerProposalSchema).optional(),
      links: z.array(mindMapLinkProposalSchema).optional(),
      sourceRefs: z.array(mindMapSourceRefProposalSchema).optional(),
      planning: mindMapPlanningProposalSchema.optional(),
      style: mindMapTopicStyleProposalSchema.optional(),
      manualPosition: mindMapPointProposalSchema.optional()
    })
    .strict()
)

const mindMapElementBaseProposalSchema = z
  .object({
    id: nonEmptyIdSchema,
    type: z.enum(['relationship', 'boundary', 'summary', 'callout', 'free-topic']),
    label: z.string().optional(),
    style: mindMapElementStyleProposalSchema.optional()
  })
  .strict()

const mindMapElementProposalSchema: z.ZodType<MindMapElement> = z.discriminatedUnion('type', [
  mindMapElementBaseProposalSchema
    .extend({
      type: z.literal('relationship'),
      from: nonEmptyIdSchema,
      to: nonEmptyIdSchema
    })
    .strict(),
  mindMapElementBaseProposalSchema
    .extend({
      type: z.literal('boundary'),
      topicId: nonEmptyIdSchema,
      children: z.array(nonEmptyIdSchema).optional()
    })
    .strict(),
  mindMapElementBaseProposalSchema
    .extend({
      type: z.literal('summary'),
      from: nonEmptyIdSchema,
      to: nonEmptyIdSchema
    })
    .strict(),
  mindMapElementBaseProposalSchema
    .extend({
      type: z.literal('callout'),
      topicId: nonEmptyIdSchema,
      text: z.string(),
      position: mindMapPointProposalSchema.optional()
    })
    .strict(),
  mindMapElementBaseProposalSchema
    .extend({
      type: z.literal('free-topic'),
      topicId: nonEmptyIdSchema,
      position: mindMapPointProposalSchema
    })
    .strict()
])

export const mindMapLayoutProposalSchema = z
  .object({
    structureClass: mindMapStructureClassSchema,
    direction: z.enum(['ltr', 'rtl']).optional(),
    compact: z.boolean().optional(),
    spacing: finiteNumberSchema.nonnegative().optional(),
    lineStyle: z.enum(['curve', 'straight', 'elbow', 'rounded-elbow', 'bight', 'fold', 'rounded-fold']).optional(),
    lineWidthScale: finiteNumberSchema.positive().max(4).optional(),
    linePattern: z
      .enum(['solid', 'dash', 'hand-drawn-solid', 'hand-drawn-dash'])
      .optional(),
    tapered: z.boolean().optional()
  })
  .strict()

const mindMapSheetLayoutUpdatePatchProposalSchema: z.ZodType<MindMapSheetLayoutUpdatePatch> = z
  .object({
    structureClass: mindMapStructureClassSchema.optional(),
    direction: z.enum(['ltr', 'rtl']).nullable().optional(),
    compact: z.boolean().nullable().optional(),
    spacing: finiteNumberSchema.nonnegative().nullable().optional(),
    lineStyle: z.enum(['curve', 'straight', 'elbow', 'rounded-elbow', 'bight', 'fold', 'rounded-fold']).nullable().optional(),
    lineWidthScale: finiteNumberSchema.positive().max(4).nullable().optional(),
    linePattern: z
      .enum(['solid', 'dash', 'hand-drawn-solid', 'hand-drawn-dash'])
      .nullable()
      .optional(),
    tapered: z.boolean().nullable().optional()
  })
  .strict()

const mindMapViewportProposalSchema = z
  .object({
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    zoom: finiteNumberSchema.positive()
  })
  .strict()

const mindMapSheetProposalSchema: z.ZodType<MindMapSheetV2, z.ZodTypeDef, unknown> = z
  .object({
    id: nonEmptyIdSchema,
    title: z.string(),
    root: mindMapTopicProposalSchema,
    elements: z.array(mindMapElementProposalSchema).default([]),
    layout: mindMapLayoutProposalSchema,
    viewport: mindMapViewportProposalSchema.optional()
  })
  .strict()

const mindMapTopicUpdatePatchProposalSchema: z.ZodType<MindMapTopicUpdatePatch> = z
  .object({
    title: z.string().optional(),
    note: z.string().nullable().optional(),
    collapsed: z.boolean().optional(),
    labels: z.array(z.string()).optional(),
    markers: z.array(mindMapMarkerProposalSchema).optional(),
    links: z.array(mindMapLinkProposalSchema).optional(),
    sourceRefs: z.array(mindMapSourceRefProposalSchema).optional(),
    planning: mindMapPlanningProposalSchema.nullable().optional(),
    style: mindMapTopicStyleProposalSchema.nullable().optional(),
    manualPosition: mindMapPointProposalSchema.nullable().optional()
  })
  .strict()

const mindMapElementUpdatePatchProposalSchema: z.ZodType<MindMapElementUpdatePatch> = z
  .object({
    label: z.string().nullable().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    topicId: z.string().optional(),
    children: z.array(z.string()).nullable().optional(),
    text: z.string().optional(),
    position: mindMapPointProposalSchema.nullable().optional(),
    style: mindMapElementStyleProposalSchema.nullable().optional()
  })
  .strict()

const mindMapCommandProposalSchema: z.ZodType<MindMapCommand, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z
      .object({
        type: z.literal('topic.insert'),
        sheetId: nonEmptyIdSchema,
        parentId: nonEmptyIdSchema,
        index: nonNegativeIntegerSchema.optional(),
        node: mindMapTopicProposalSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('topic.update'),
        sheetId: nonEmptyIdSchema,
        topicId: nonEmptyIdSchema,
        patch: mindMapTopicUpdatePatchProposalSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('topic.move'),
        sheetId: nonEmptyIdSchema,
        topicId: nonEmptyIdSchema,
        toParentId: nonEmptyIdSchema,
        toIndex: nonNegativeIntegerSchema.optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('topic.remove'),
        sheetId: nonEmptyIdSchema,
        topicId: nonEmptyIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('element.create'),
        sheetId: nonEmptyIdSchema,
        index: nonNegativeIntegerSchema.optional(),
        element: mindMapElementProposalSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('element.update'),
        sheetId: nonEmptyIdSchema,
        elementId: nonEmptyIdSchema,
        patch: mindMapElementUpdatePatchProposalSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('element.remove'),
        sheetId: nonEmptyIdSchema,
        elementId: nonEmptyIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('selection.set-style'),
        sheetId: nonEmptyIdSchema,
        topicIds: z.array(nonEmptyIdSchema).min(1),
        style: mindMapTopicStyleProposalSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('sheet.create'),
        sheetId: nonEmptyIdSchema.optional(),
        title: z.string().optional(),
        index: nonNegativeIntegerSchema.optional(),
        sheet: mindMapSheetProposalSchema.optional()
      })
      .strict(),
    z
      .object({
        type: z.literal('document.rename'),
        title: z.string()
      })
      .strict(),
    z
      .object({
        type: z.literal('sheet.rename'),
        sheetId: nonEmptyIdSchema,
        title: z.string()
      })
      .strict(),
    z
      .object({
        type: z.literal('sheet.update-layout'),
        sheetId: nonEmptyIdSchema,
        patch: mindMapSheetLayoutUpdatePatchProposalSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('sheet.reorder'),
        sheetId: nonEmptyIdSchema,
        toIndex: nonNegativeIntegerSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('sheet.remove'),
        sheetId: nonEmptyIdSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('document.apply-theme'),
        theme: mindMapThemeProposalSchema
      })
      .strict(),
    z
      .object({
        type: z.literal('transaction'),
        commands: z.array(mindMapCommandProposalSchema).min(1)
      })
      .strict()
  ]).superRefine((command, ctx) => {
    if (command.type !== 'sheet.create') return

    // The reducer has two meaningful forms for this command: restore a
    // complete sheet, or create one from an id and title. Reject the empty
    // shape at the provider boundary instead of allowing a proposal that can
    // only fail later during review/settlement.
    const hasProvidedSheet = command.sheet !== undefined
    const hasSheetIdentity = command.sheetId !== undefined && command.title !== undefined
    if (!hasProvidedSheet && !hasSheetIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'sheet.create requires either "sheet" or both "sheetId" and "title"'
      })
    }
  })
)

/** Strict recursive schema for every command a provider may propose. */
export const mindMapCommandSchema = mindMapCommandProposalSchema

/** Strict provider proposal schema. Unknown keys are rejected at every level. */
export const mindMapProposalSchema: z.ZodType<MindMapProviderProposal, z.ZodTypeDef, unknown> = z
  .object({
    schemaVersion: z.literal(1),
    proposalId: nonEmptyIdSchema,
    scope: z.enum(MIND_MAP_PROPOSAL_SCOPES),
    items: z
      .array(
        z
          .object({ id: nonEmptyIdSchema, command: mindMapCommandProposalSchema })
          .strict()
      )
      .min(1)
  })
  .strict()
  .superRefine((proposal, ctx) => {
    const seen = new Set<string>()
    proposal.items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'id'],
          message: `duplicate proposal item id "${item.id}"`
        })
      }
      seen.add(item.id)
    })
  })

/** Alias emphasizing that this envelope is provider-facing, not review state. */
export const mindMapProviderProposalSchema = mindMapProposalSchema

/** Strip an optional markdown code fence often emitted by model providers. */
function stripMindMapProposalCodeFence(content: string): string {
  const trimmed = content.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/.exec(trimmed)
  if (fenced) return fenced[1]!.trim()
  // Streaming providers can leave an opening fence without its closing line.
  const opening = /^```(?:json)?\s*\r?\n([\s\S]*)$/.exec(trimmed)
  return opening ? opening[1]!.trim() : trimmed
}

/**
 * Parse provider text without allowing unknown fields to be silently stripped.
 * This is deliberately separate from generation/IPC so callers can validate a
 * proposal before creating review state or touching the canonical document.
 */
export function parseMindMapProposalJson(content: string): MindMapProposalParseResult {
  let value: unknown
  try {
    value = JSON.parse(stripMindMapProposalCodeFence(content)) as unknown
  } catch {
    return { ok: false, code: 'json_parse', message: 'mind-map proposal is not valid JSON' }
  }

  const parsed = mindMapProposalSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      code: 'schema_invalid',
      message: 'mind-map proposal failed schema validation'
    }
  }
  return { ok: true, proposal: parsed.data }
}

export type MindMapProposalDecision = 'accept' | 'reject'

/**
 * Decisions are intentionally keyed by proposal-item id rather than array
 * position. Missing decisions fail closed as `reject`, which prevents an
 * incomplete review from silently accepting provider output.
 */
export type MindMapProposalDecisions = Readonly<Record<string, MindMapProposalDecision>>

export type MindMapProposalResolution = {
  /** A single atomic command, or null when no item was accepted. */
  command: MindMapCommand | null
  acceptedIds: string[]
  rejectedIds: string[]
}

export type MindMapProposalApplyResult =
  | {
      ok: true
      document: MindMapDocumentV2
      /** Null means the review accepted no changes and is a no-op. */
      inverse: MindMapCommand | null
      command: MindMapCommand | null
      acceptedIds: string[]
      rejectedIds: string[]
    }
  | {
      ok: false
      error: MindMapCommandError
      command: MindMapCommand
      acceptedIds: string[]
      rejectedIds: string[]
    }

function assertProposalItems(items: readonly MindMapProposalItem[]): void {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.id.trim().length === 0) {
      throw new Error('Mind-map proposal item ids must not be empty')
    }
    if (ids.has(item.id)) {
      throw new Error(`Duplicate mind-map proposal item id "${item.id}"`)
    }
    ids.add(item.id)
  }
}

/**
 * Resolve review decisions into one transaction without touching a document.
 *
 * The original proposal order is preserved in the transaction. Unknown decision
 * keys are ignored so a stale renderer decision cannot accidentally accept an
 * item from another proposal; only an explicit `accept` for a current item is
 * applied.
 */
export function resolveMindMapProposal(
  items: readonly MindMapProposalItem[],
  decisions: MindMapProposalDecisions
): MindMapProposalResolution {
  assertProposalItems(items)

  const acceptedIds: string[] = []
  const rejectedIds: string[] = []
  const acceptedCommands: MindMapCommand[] = []

  for (const item of items) {
    if (decisions[item.id] === 'accept') {
      acceptedIds.push(item.id)
      acceptedCommands.push(item.command)
    } else {
      // Reject is also the safe default for an unreviewed item.
      rejectedIds.push(item.id)
    }
  }

  return {
    command:
      acceptedCommands.length === 0
        ? null
        : { type: 'transaction', commands: acceptedCommands },
    acceptedIds,
    rejectedIds
  }
}

/**
 * Apply the accepted portion of an AI proposal through the canonical reducer.
 *
 * If any accepted command is invalid, the reducer rejects the whole transaction
 * and this function returns no document change. Rejected items are never
 * evaluated by the reducer, so accepting a safe subset remains possible even if
 * another proposal item is malformed or no longer applicable.
 */
export function applyMindMapProposal(
  document: MindMapDocumentV2,
  items: readonly MindMapProposalItem[],
  decisions: MindMapProposalDecisions
): MindMapProposalApplyResult {
  const resolution = resolveMindMapProposal(items, decisions)
  if (resolution.command === null) {
    return {
      ok: true,
      document,
      inverse: null,
      command: null,
      acceptedIds: resolution.acceptedIds,
      rejectedIds: resolution.rejectedIds
    }
  }

  const result: MindMapCommandResult = applyMindMapCommand(document, resolution.command)
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      command: resolution.command,
      acceptedIds: resolution.acceptedIds,
      rejectedIds: resolution.rejectedIds
    }
  }

  return {
    ok: true,
    document: result.document,
    inverse: result.inverse,
    command: resolution.command,
    acceptedIds: resolution.acceptedIds,
    rejectedIds: resolution.rejectedIds
  }
}
