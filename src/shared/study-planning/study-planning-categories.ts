/**
 * Study planning category catalog (ADR-0117 section 4.5).
 *
 * Pure normalize for snapshot.categories sole-authority cutover.
 * Rules align with renderer taskCategories (color/ID/name/limit); no I/O.
 */

export const STUDY_PLANNING_CATEGORY_NAME_MAX = 16
export const STUDY_PLANNING_CUSTOM_CATEGORY_LIMIT = 24

export type StudyPlanningBuiltinCategoryId = 'study' | 'entertainment' | 'exercise' | 'other'
export type StudyPlanningCategoryId = StudyPlanningBuiltinCategoryId | `custom-${string}`

export type StudyPlanningCategoryV1 = {
  id: StudyPlanningCategoryId
  name: string
  color: `#${string}`
  builtin: boolean
}

export const BUILTIN_STUDY_PLANNING_CATEGORIES: ReadonlyArray<
  StudyPlanningCategoryV1 & { id: StudyPlanningBuiltinCategoryId; builtin: true }
> = [
  { id: 'study', name: '学习', color: '#8197aa', builtin: true },
  { id: 'entertainment', name: '娱乐', color: '#9c8aa5', builtin: true },
  { id: 'exercise', name: '锻炼', color: '#829d91', builtin: true },
  { id: 'other', name: '其他', color: '#8a9096', builtin: true }
]

const builtinIds = new Set<string>(BUILTIN_STUDY_PLANNING_CATEGORIES.map((c) => c.id))

function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function normalizeCategoryName(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.trim().replace(/\s+/g, ' ').slice(0, STUDY_PLANNING_CATEGORY_NAME_MAX)
}

function isBuiltinId(value: unknown): value is StudyPlanningBuiltinCategoryId {
  return typeof value === 'string' && builtinIds.has(value)
}

function normalizeCustomId(input: unknown): StudyPlanningCategoryId | undefined {
  if (typeof input !== 'string') return undefined
  const id = input.trim()
  if (!/^custom-[a-z0-9_-]{1,40}$/i.test(id)) return undefined
  return id.toLowerCase() as StudyPlanningCategoryId
}

export function normalizeStudyPlanningCategoryId(
  input: unknown
): StudyPlanningCategoryId | undefined {
  if (isBuiltinId(input)) return input
  return normalizeCustomId(input)
}

export function normalizeStudyPlanningCategory(
  input: unknown
): StudyPlanningCategoryV1 | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Partial<StudyPlanningCategoryV1>
  if (!isHexColor(raw.color)) return undefined

  if (isBuiltinId(raw.id)) {
    const builtin = BUILTIN_STUDY_PLANNING_CATEGORIES.find((item) => item.id === raw.id)
    if (!builtin) return undefined
    return {
      ...builtin,
      color: raw.color.toLowerCase() as `#${string}`
    }
  }

  const id = normalizeCustomId(raw.id)
  const name = normalizeCategoryName(raw.name)
  if (!id || !name) return undefined
  return {
    id,
    name,
    color: raw.color.toLowerCase() as `#${string}`,
    builtin: false
  }
}

/**
 * Normalize a category catalog: always includes builtins (saved color overrides),
 * then custom rows (dedupe by id, cap custom count).
 */
export function normalizeStudyPlanningCategories(
  input: unknown
): StudyPlanningCategoryV1[] {
  const source = Array.isArray(input) ? input : []
  const normalized = source
    .map(normalizeStudyPlanningCategory)
    .filter((item): item is StudyPlanningCategoryV1 => Boolean(item))

  const builtins = BUILTIN_STUDY_PLANNING_CATEGORIES.map((builtin) => {
    const saved = normalized.find((item) => item.id === builtin.id)
    return saved && saved.builtin ? saved : { ...builtin }
  })

  const custom: StudyPlanningCategoryV1[] = []
  const seen = new Set<string>()
  for (const category of normalized) {
    if (category.builtin || seen.has(category.id)) continue
    seen.add(category.id)
    custom.push(category)
    if (custom.length >= STUDY_PLANNING_CUSTOM_CATEGORY_LIMIT) break
  }
  return [...builtins, ...custom]
}

/**
 * Sole-read projection: null when unset/empty/invalid so host V1 cache stays.
 * Present array (including builtins-only) means canonical catalog is authority.
 */
export function projectCategoriesFromSnapshot(
  categories: unknown
): StudyPlanningCategoryV1[] | null {
  if (categories === undefined || categories === null) return null
  if (!Array.isArray(categories)) return null
  // Empty array is invalid product state (builtins always required after normalize);
  // treat as unset so we do not wipe host with empty.
  if (categories.length === 0) return null
  const next = normalizeStudyPlanningCategories(categories)
  if (next.length === 0) return null
  return next
}
