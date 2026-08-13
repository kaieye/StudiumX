/**
 * Zod schemas for the v2 mind map domain model.
 *
 * These validate the boundaries where untrusted input enters the domain:
 * IPC payloads, imported files, and persisted documents. Validation failures
 * produce structured ZodError diagnostics — never silent degradation.
 *
 * See types.ts for the corresponding TypeScript types.
 */
import { z } from 'zod'

import { mindMapStructureClassSchema } from '../mind-map-schema'
import type { MindMapTopicV2 } from './types'
import { MIND_MAP_DOCUMENT_SCHEMA_VERSION_V2 } from './types'

/**
 * XMind extension baggage is foreign input, not an open-ended application
 * object. Keep it JSON-only and bounded so an imported document cannot smuggle
 * executable values or an unbounded metadata payload into the renderer.
 */
const MAX_XMIND_EXTENSION_BYTES = 64 * 1024
const MAX_XMIND_EXTENSION_KEYS = 128
const MAX_XMIND_EXTENSION_DEPTH = 8

function extensionValueError(
  value: unknown,
  depth: number,
  seen: Set<object>
): string | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return undefined
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : 'must contain only finite numbers'
  }
  if (typeof value !== 'object') {
    return 'must contain JSON values only'
  }
  if (depth >= MAX_XMIND_EXTENSION_DEPTH) {
    return `must not exceed ${MAX_XMIND_EXTENSION_DEPTH} nested levels`
  }
  if (seen.has(value)) {
    return 'must not contain cyclic references'
  }
  seen.add(value)

  let error: string | undefined
  if (Array.isArray(value)) {
    if (value.length > MAX_XMIND_EXTENSION_KEYS) {
      error = `must not contain more than ${MAX_XMIND_EXTENSION_KEYS} items per array`
    } else {
      for (const item of value) {
        error = extensionValueError(item, depth + 1, seen)
        if (error) break
      }
    }
  } else if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    error = 'must contain plain JSON objects only'
  } else {
    const entries = Object.entries(value)
    if (entries.length > MAX_XMIND_EXTENSION_KEYS) {
      error = `must not contain more than ${MAX_XMIND_EXTENSION_KEYS} keys per object`
    } else {
      for (const [, item] of entries) {
        error = extensionValueError(item, depth + 1, seen)
        if (error) break
      }
    }
  }
  seen.delete(value)
  return error
}

const mindMapXmindExtensionsSchema = z
  .record(z.string(), z.unknown())
  .superRefine((extensions, ctx) => {
    const error = extensionValueError(extensions, 0, new Set<object>())
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error })
      return
    }
    let serialized: string
    try {
      serialized = JSON.stringify(extensions)
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'must be serializable JSON'
      })
      return
    }
    const serializedBytes = new TextEncoder().encode(serialized).byteLength
    if (serializedBytes > MAX_XMIND_EXTENSION_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `must not exceed ${MAX_XMIND_EXTENSION_BYTES} serialized bytes`
      })
    }
  })

export const mindMapPointSchema = z.object({
  x: z.number(),
  y: z.number()
})

const mindMapColorSchema = z.string().regex(
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  'must be a CSS hex color'
)

const mindMapFontFamilySchema = z.string().trim().min(1).max(512)
const mindMapFontWeightSchema = z.enum([
  'normal',
  'bold',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900'
])
const mindMapTopicShapeSchema = z.enum([
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
const mindMapFillPatternSchema = z.enum(['solid', 'hand-drawn', 'diagonal', 'horizontal'])
const mindMapTopicWidthModeSchema = z.enum(['auto', 'fixed'])
const mindMapTopicWidthSchema = z.number().finite().min(72).max(720)

export const mindMapTopicStyleOverrideSchema = z.object({
  fill: mindMapColorSchema.optional(),
  stroke: mindMapColorSchema.optional(),
  borderStyle: z.enum(['none', 'solid', 'dash', 'hand-drawn-solid', 'hand-drawn-dash']).optional(),
  borderWidth: z.number().finite().positive().max(32).optional(),
  textColor: mindMapColorSchema.optional(),
  fontFamily: mindMapFontFamilySchema.optional(),
  fontSize: z.number().finite().positive().max(512).optional(),
  fontWeight: mindMapFontWeightSchema.optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  textDecoration: z.enum(['none', 'underline', 'line-through', 'line-through underline']).optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  shape: mindMapTopicShapeSchema.optional(),
  fillPattern: mindMapFillPatternSchema.optional(),
  widthMode: mindMapTopicWidthModeSchema.optional(),
  width: mindMapTopicWidthSchema.optional(),
  structureClass: mindMapStructureClassSchema.optional()
})

export const mindMapThemeSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  background: z.union([mindMapColorSchema, z.literal('transparent')]).optional(),
  branchColors: z.array(mindMapColorSchema).min(1).max(64).optional(),
  textColor: mindMapColorSchema.optional(),
  lineColor: mindMapColorSchema.optional(),
  fontFamily: mindMapFontFamilySchema.optional(),
  shape: mindMapTopicShapeSchema.optional(),
  rainbowBranches: z.boolean().optional(),
  colorSchemeId: z.string().trim().min(1).max(128).optional(),
  topicStyles: z
    .object({
      central: mindMapTopicStyleOverrideSchema.optional(),
      main: mindMapTopicStyleOverrideSchema.optional(),
      sub: mindMapTopicStyleOverrideSchema.optional()
    })
    .optional()
})

export const mindMapAssetRefSchema = z.object({
  id: z.string().min(1),
  fileName: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
  createdAt: z.string().optional()
})

export const mindMapInteropMetadataSchema = z.object({
  xmind: z
    .object({
      sourcePath: z.string().optional(),
      sourceVersion: z.string().optional(),
      importedAt: z.string().optional(),
      extensions: mindMapXmindExtensionsSchema.optional()
    })
    .optional(),
  migratedFrom: z
    .object({ schemaVersion: z.number().int().nonnegative() })
    .optional()
})

export const mindMapLayoutSettingsSchema = z.object({
  structureClass: mindMapStructureClassSchema,
  direction: z.enum(['ltr', 'rtl']).optional(),
  compact: z.boolean().optional(),
  spacing: z.number().finite().nonnegative().optional(),
  lineStyle: z.enum(['curve', 'straight', 'elbow', 'rounded-elbow', 'bight', 'fold', 'rounded-fold']).optional(),
  lineWidthScale: z.number().finite().positive().max(4).optional(),
  linePattern: z
    .enum(['solid', 'dash', 'hand-drawn-solid', 'hand-drawn-dash'])
    .optional(),
  tapered: z.boolean().optional()
})

export const mindMapViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive()
})

export const mindMapPlanningMetadataSchema = z.object({
  taskStatus: z.enum(['not-started', 'todo', 'doing', 'done']).optional(),
  dueAt: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  priority: z.number().int().optional()
})

export const mindMapMarkerSchema = z.object({
  id: z.string().min(1),
  symbol: z.string(),
  label: z.string().optional()
})

export const mindMapLinkSchema = z.object({
  id: z.string().min(1),
  url: z.string(),
  title: z.string().optional()
})

export const mindMapSourceRefSchema = z.object({
  id: z.string().min(1),
  workspacePath: z.string().optional(),
  breadcrumb: z.array(z.string()).optional(),
  blockId: z.string().optional(),
  contentHash: z.string().optional(),
  lastConfirmedAt: z.string().optional(),
  stale: z.boolean().optional()
})

const mindMapElementArrowShapeSchema = z.enum([
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

const mindMapElementLineShapeSchema = z.enum([
  'curved',
  'straight',
  'angled',
  'zigzag',
  'flexible-curved',
  'flexible-angled',
  'flexible-zigzag'
])

export const mindMapElementLinePatternSchema = z.enum([
  'solid',
  'dash',
  'dot',
  'dash-dot',
  'dash-dot-dot'
])

const mindMapElementOutlineShapeSchema = z.enum([
  'rectangle',
  'rounded-rectangle',
  'ellipse',
  'polygon',
  'scallops',
  'waves',
  'tension',
  'bracket'
])

export const mindMapElementStyleSchema = z.object({
  stroke: mindMapColorSchema.optional(),
  strokeWidth: z.number().finite().nonnegative().max(64).optional(),
  fill: mindMapColorSchema.optional(),
  textColor: mindMapColorSchema.optional(),
  fontFamily: mindMapFontFamilySchema.optional(),
  fontSize: z.number().finite().positive().max(512).optional(),
  dashed: z.boolean().optional(),
  lineShape: mindMapElementLineShapeSchema.optional(),
  beginArrow: mindMapElementArrowShapeSchema.optional(),
  endArrow: mindMapElementArrowShapeSchema.optional(),
  linePattern: mindMapElementLinePatternSchema.optional(),
  outlineShape: mindMapElementOutlineShapeSchema.optional()
})

export const mindMapElementBaseSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['relationship', 'boundary', 'summary', 'callout', 'free-topic']),
  label: z.string().optional(),
  style: mindMapElementStyleSchema.optional()
})

export const mindMapRelationshipSchema = mindMapElementBaseSchema.extend({
  type: z.literal('relationship'),
  from: z.string().min(1),
  to: z.string().min(1)
})

export const mindMapBoundarySchema = mindMapElementBaseSchema.extend({
  type: z.literal('boundary'),
  topicId: z.string().min(1),
  children: z.array(z.string().min(1)).optional()
})

export const mindMapSummarySchema = mindMapElementBaseSchema.extend({
  type: z.literal('summary'),
  from: z.string().min(1),
  to: z.string().min(1)
})

export const mindMapCalloutSchema = mindMapElementBaseSchema.extend({
  type: z.literal('callout'),
  topicId: z.string().min(1),
  text: z.string(),
  position: mindMapPointSchema.optional()
})

export const mindMapFreeTopicSchema = mindMapElementBaseSchema.extend({
  type: z.literal('free-topic'),
  topicId: z.string().min(1),
  position: mindMapPointSchema
})

export const mindMapElementSchema = z.discriminatedUnion('type', [
  mindMapRelationshipSchema,
  mindMapBoundarySchema,
  mindMapSummarySchema,
  mindMapCalloutSchema,
  mindMapFreeTopicSchema
])

export const mindMapTopicNumberingSchema = z.object({
  pattern: z.enum(['none', 'arabic', 'uppercase', 'lowercase', 'roman']).optional(),
  tiered: z.boolean().optional(),
  restartAt: z.number().finite().int().min(1).max(9999).optional()
})

export const mindMapTopicV2Schema: z.ZodType<
  MindMapTopicV2,
  z.ZodTypeDef,
  unknown
> = z.lazy(() =>
    z.object({
      id: z.string().min(1),
      title: z.string(),
      note: z.string().optional(),
      collapsed: z.boolean().optional(),
      children: z.array(z.lazy(() => mindMapTopicV2Schema)).default([]),
      labels: z.array(z.string()).optional(),
      markers: z.array(mindMapMarkerSchema).optional(),
      links: z.array(mindMapLinkSchema).optional(),
      sourceRefs: z.array(mindMapSourceRefSchema).optional(),
      assetIds: z.array(z.string().min(1)).optional(),
      planning: mindMapPlanningMetadataSchema.optional(),
      style: mindMapTopicStyleOverrideSchema.optional(),
      manualPosition: mindMapPointSchema.optional(),
      numbering: mindMapTopicNumberingSchema.optional()
    })
  )

export const mindMapSheetV2Schema = z.object({
  id: z.string().min(1),
  title: z.string(),
  root: mindMapTopicV2Schema,
  elements: z.array(mindMapElementSchema).default([]),
  layout: mindMapLayoutSettingsSchema,
  viewport: mindMapViewportSchema.optional()
})

export const mindMapDocumentV2Schema = z.object({
  schemaVersion: z.literal(MIND_MAP_DOCUMENT_SCHEMA_VERSION_V2),
  id: z.string().min(1),
  revision: z.number().int().nonnegative(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  theme: mindMapThemeSchema,
  sheets: z.array(mindMapSheetV2Schema).default([]),
  assets: z.array(mindMapAssetRefSchema).default([]),
  interop: mindMapInteropMetadataSchema.optional()
})

export type MindMapDocumentV2Input = z.input<typeof mindMapDocumentV2Schema>
export type MindMapDocumentV2Output = z.output<typeof mindMapDocumentV2Schema>
export type MindMapSheetV2Input = z.input<typeof mindMapSheetV2Schema>
export type MindMapSheetV2Output = z.output<typeof mindMapSheetV2Schema>
export type MindMapTopicV2Input = z.input<typeof mindMapTopicV2Schema>
export type MindMapTopicV2Output = z.output<typeof mindMapTopicV2Schema>
export type MindMapElementInput = z.input<typeof mindMapElementSchema>
export type MindMapElementOutput = z.output<typeof mindMapElementSchema>
