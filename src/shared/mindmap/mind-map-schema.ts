/**
 * Zod schemas mirroring the mind map data model 1:1 (see mind-map-types.ts).
 * Used for AI generation output validation, IPC payload validation, `.xmind`
 * import validation, and unit tests. Validation failures produce structured
 * diagnostics (ZodError) — never silent degradation.
 */
import { z } from 'zod'

import type { MindMapNode } from './mind-map-types'
import {
  DEFAULT_MIND_MAP_STRUCTURE_CLASS,
  MIND_MAP_DOCUMENT_SCHEMA_VERSION
} from './mind-map-types'

export const mindMapStructureClassSchema = z.enum([
  'org.xmind.ui.logic.right',
  'org.xmind.ui.logic.balanced',
  'org.xmind.ui.logic.left',
  'org.xmind.ui.logic.map',
  'org.xmind.ui.logic.down',
  'org.xmind.ui.logic.up'
,
  'org.xmind.ui.map',
  'org.xmind.ui.map.clockwise',
  'org.xmind.ui.map.anticlockwise',
  'org.xmind.ui.org-chart.down',
  'org.xmind.ui.org-chart.up',
  'org.xmind.ui.tree.right',
  'org.xmind.ui.tree.left',
  'org.xmind.ui.brace.right',
  'org.xmind.ui.brace.left',
  'org.xmind.ui.timeline.horizontal',
  'org.xmind.ui.timeline.vertical',
  'org.xmind.ui.spreadsheet',
  'org.xmind.ui.spreadsheet.column',
  'org.xmind.ui.fishbone.rightHeaded',
  'org.xmind.ui.fishbone.leftHeaded'
])

export const mindMapNodeSchema: z.ZodType<
  MindMapNode,
  z.ZodTypeDef,
  unknown
> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    title: z.string(),
    note: z.string().optional(),
    collapsed: z.boolean().optional(),
    structureClass: mindMapStructureClassSchema.optional(),
    assetIds: z.array(z.string().min(1)).optional(),
    numbering: z
      .object({
        pattern: z.enum(['none', 'arabic', 'uppercase', 'lowercase', 'roman']).optional(),
        tiered: z.boolean().optional(),
        restartAt: z.number().int().nonnegative().optional()
      })
      .optional(),
    children: z.array(z.lazy(() => mindMapNodeSchema)).default([])
  })
)

export const mindMapRelationshipSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional()
})

export const mindMapSheetSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  structureClass: mindMapStructureClassSchema.default(
    DEFAULT_MIND_MAP_STRUCTURE_CLASS
  ),
  root: mindMapNodeSchema,
  relationships: z.array(mindMapRelationshipSchema).optional()
})

export const mindMapDocumentSchema = z.object({
  schemaVersion: z.literal(MIND_MAP_DOCUMENT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sheets: z.array(mindMapSheetSchema).default([])
})
