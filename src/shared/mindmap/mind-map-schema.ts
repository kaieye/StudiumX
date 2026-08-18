/**
 * Zod schemas mirroring the mind map data model 1:1 (see mind-map-types.ts).
 * Used for AI generation output validation, IPC payload validation, native document
 * validation, and unit tests. Validation failures produce structured
 * diagnostics (ZodError) — never silent degradation.
 */
import { z } from 'zod'

import type { MindMapNode } from './mind-map-types'
import {
  DEFAULT_MIND_MAP_STRUCTURE_CLASS,
  MIND_MAP_DOCUMENT_SCHEMA_VERSION
} from './mind-map-types'

export const mindMapStructureClassSchema = z.enum([
  'studiumx.layout.logic.right',
  'studiumx.layout.logic.balanced',
  'studiumx.layout.logic.left',
  'studiumx.layout.logic.map',
  'studiumx.layout.logic.down',
  'studiumx.layout.logic.up'
,
  'studiumx.layout.map',
  'studiumx.layout.map.clockwise',
  'studiumx.layout.map.anticlockwise',
  'studiumx.layout.org-chart.down',
  'studiumx.layout.org-chart.up',
  'studiumx.layout.tree.right',
  'studiumx.layout.tree.left',
  'studiumx.layout.brace.right',
  'studiumx.layout.brace.left',
  'studiumx.layout.timeline.horizontal',
  'studiumx.layout.timeline.vertical',
  'studiumx.layout.spreadsheet',
  'studiumx.layout.spreadsheet.column',
  'studiumx.layout.fishbone.rightHeaded',
  'studiumx.layout.fishbone.leftHeaded'
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
