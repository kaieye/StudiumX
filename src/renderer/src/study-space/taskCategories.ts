import type {
  StudyTaskBuiltinCategoryId,
  StudyTaskCategory,
  StudyTaskCategoryId,
  StudyTaskCategoryInput
} from './types'

export const STUDY_TASK_CATEGORIES_STORAGE_KEY = 'studiumx:study-task-categories:v1'
export const STUDY_TASK_CATEGORY_NAME_MAX = 16
export const STUDY_TASK_CUSTOM_CATEGORY_LIMIT = 24

export const builtinStudyTaskCategories: Array<
  StudyTaskCategory & { id: StudyTaskBuiltinCategoryId; builtin: true }
> = [
  { id: 'study', name: '学习', color: '#8197aa', builtin: true },
  { id: 'entertainment', name: '娱乐', color: '#9c8aa5', builtin: true },
  { id: 'exercise', name: '锻炼', color: '#829d91', builtin: true }
]

const builtinCategoryIds = new Set<string>(builtinStudyTaskCategories.map((item) => item.id))

function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function normalizeCategoryName(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.trim().replace(/\s+/g, ' ').slice(0, STUDY_TASK_CATEGORY_NAME_MAX)
}

function normalizeCustomCategoryId(input: unknown): StudyTaskCategoryId | undefined {
  if (typeof input !== 'string') return undefined
  const id = input.trim()
  if (!/^custom-[a-z0-9_-]{1,40}$/i.test(id)) return undefined
  return id.toLowerCase() as StudyTaskCategoryId
}

export function isBuiltinStudyTaskCategoryId(value: unknown): value is StudyTaskBuiltinCategoryId {
  return typeof value === 'string' && builtinCategoryIds.has(value)
}

export function normalizeStudyTaskCategoryId(input: unknown): StudyTaskCategoryId | undefined {
  if (isBuiltinStudyTaskCategoryId(input)) return input
  return normalizeCustomCategoryId(input)
}

export function createStudyTaskCategoryId(now = Date.now()): StudyTaskCategoryId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `custom-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
  }
  return `custom-${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function normalizeStudyTaskCategory(input: unknown): StudyTaskCategory | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Partial<StudyTaskCategory>
  if (!isHexColor(raw.color)) return undefined

  if (isBuiltinStudyTaskCategoryId(raw.id)) {
    const builtin = builtinStudyTaskCategories.find((item) => item.id === raw.id)
    if (!builtin) return undefined
    return {
      ...builtin,
      color: raw.color.toLowerCase() as `#${string}`
    }
  }

  const id = normalizeCustomCategoryId(raw.id)
  const name = normalizeCategoryName(raw.name)
  if (!id || !name) return undefined
  return {
    id,
    name,
    color: raw.color.toLowerCase() as `#${string}`,
    builtin: false
  }
}

export function normalizeStudyTaskCategories(input: unknown): StudyTaskCategory[] {
  const source = Array.isArray(input) ? input : []
  const normalized = source
    .map(normalizeStudyTaskCategory)
    .filter((item): item is StudyTaskCategory => Boolean(item))

  const builtins = builtinStudyTaskCategories.map((builtin) => {
    const saved = normalized.find((item) => item.id === builtin.id)
    return saved && saved.builtin ? saved : builtin
  })

  const custom: StudyTaskCategory[] = []
  const seen = new Set<string>()
  for (const category of normalized) {
    if (category.builtin || seen.has(category.id)) continue
    seen.add(category.id)
    custom.push(category)
    if (custom.length >= STUDY_TASK_CUSTOM_CATEGORY_LIMIT) break
  }
  return [...builtins, ...custom]
}

export function readStudyTaskCategories(): StudyTaskCategory[] {
  if (typeof window === 'undefined') return normalizeStudyTaskCategories([])
  try {
    const stored = JSON.parse(window.localStorage.getItem(STUDY_TASK_CATEGORIES_STORAGE_KEY) ?? '[]')
    return normalizeStudyTaskCategories(stored)
  } catch {
    return normalizeStudyTaskCategories([])
  }
}

export function persistStudyTaskCategories(categories: StudyTaskCategory[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STUDY_TASK_CATEGORIES_STORAGE_KEY,
      JSON.stringify(normalizeStudyTaskCategories(categories))
    )
  } catch {
    // Categories remain usable for the current session even if storage is unavailable.
  }
}

export function listStudyTaskCategories(): StudyTaskCategory[] {
  return readStudyTaskCategories()
}

export function findStudyTaskCategory(
  categories: StudyTaskCategory[],
  categoryId: StudyTaskCategoryId | undefined | null
): StudyTaskCategory | undefined {
  if (!categoryId) return undefined
  return categories.find((item) => item.id === categoryId)
}

export function resolveStudyTaskCategory(
  categoryId: StudyTaskCategoryId | undefined | null,
  categories: StudyTaskCategory[] = listStudyTaskCategories()
): StudyTaskCategory | undefined {
  return findStudyTaskCategory(categories, categoryId)
}

export function addStudyTaskCategory(
  categories: StudyTaskCategory[],
  input: StudyTaskCategoryInput,
  id = createStudyTaskCategoryId()
): { categories: StudyTaskCategory[]; category: StudyTaskCategory | null } {
  const name = normalizeCategoryName(input.name)
  const color = isHexColor(input.color) ? input.color.toLowerCase() as `#${string}` : null
  if (!name || !color) return { categories, category: null }

  const duplicate = categories.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  if (duplicate) return { categories, category: duplicate }

  const customCount = categories.filter((item) => !item.builtin).length
  if (customCount >= STUDY_TASK_CUSTOM_CATEGORY_LIMIT) return { categories, category: null }

  const category: StudyTaskCategory = {
    id,
    name,
    color,
    builtin: false
  }
  const next = normalizeStudyTaskCategories([...categories, category])
  return { categories: next, category: next.find((item) => item.id === category.id) ?? category }
}

export function updateStudyTaskCategory(
  categories: StudyTaskCategory[],
  categoryId: StudyTaskCategoryId,
  patch: Partial<StudyTaskCategoryInput>
): StudyTaskCategory[] {
  return normalizeStudyTaskCategories(categories.map((item) => {
    if (item.id !== categoryId) return item
    const name = item.builtin || patch.name === undefined ? item.name : normalizeCategoryName(patch.name)
    const color = patch.color === undefined
      ? item.color
      : isHexColor(patch.color)
        ? patch.color.toLowerCase() as `#${string}`
        : item.color
    if (!name) return item
    return { ...item, name, color }
  }))
}

export function removeStudyTaskCategory(
  categories: StudyTaskCategory[],
  categoryId: StudyTaskCategoryId
): StudyTaskCategory[] {
  if (isBuiltinStudyTaskCategoryId(categoryId)) return categories
  return normalizeStudyTaskCategories(categories.filter((item) => item.id !== categoryId))
}

export function getReadableCategoryInk(color: string): string {
  if (!isHexColor(color)) return '#ffffff'
  const red = Number.parseInt(color.slice(1, 3), 16)
  const green = Number.parseInt(color.slice(3, 5), 16)
  const blue = Number.parseInt(color.slice(5, 7), 16)
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000
  return luminance >= 158 ? '#25313a' : '#ffffff'
}
