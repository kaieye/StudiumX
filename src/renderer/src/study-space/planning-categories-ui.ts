/**
 * Pure category catalog projection for sole-read hydrate (ADR-0117).
 * Maps StudyPlanningCategoryV1 <-> V1 StudyTaskCategory UI shape. No I/O.
 */

import {
  normalizeStudyPlanningCategories,
  projectCategoriesFromSnapshot,
  type StudyPlanningCategoryV1
} from '../../../shared/study-planning'
import type { StudyTaskCategory } from './types'

export function toUiStudyTaskCategories(
  categories: readonly StudyPlanningCategoryV1[]
): StudyTaskCategory[] {
  return categories.map((c) => ({
    id: c.id as StudyTaskCategory['id'],
    name: c.name,
    color: c.color,
    builtin: c.builtin
  }))
}

/**
 * Project canonical snapshot.categories for UI sole-read.
 * null when unset/invalid — host keeps V1 localStorage cache.
 */
export function projectTaskCategoriesFromSnapshot(
  categories: unknown
): StudyTaskCategory[] | null {
  const projected = projectCategoriesFromSnapshot(categories)
  if (!projected) return null
  return toUiStudyTaskCategories(projected)
}

/**
 * Normalize UI categories for set_categories payload (dedupe keep color/id).
 */
export function normalizeCategoriesForCanonical(
  categories: readonly StudyTaskCategory[]
): StudyPlanningCategoryV1[] {
  return normalizeStudyPlanningCategories(categories)
}
