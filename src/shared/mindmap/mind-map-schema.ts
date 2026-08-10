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
