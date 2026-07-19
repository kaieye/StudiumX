import {
  STUDY_SPACE_STORAGE_KEY,
  defaultStudySnapshot
} from './constants'
import {
  normalizeStudySnapshot,
  persistStudySnapshot
} from './domain'
import type { StudySnapshot, StudyTask } from './types'

export const STUDY_TASKS_CHANGED_EVENT = 'studiumx:study-tasks-changed'

const MAX_ASSISTANT_TASKS = 8
const todoIntentPattern = /(?:todo\s*list|todo|待办|清单|任务列表|行动计划|学习计划|(?:制定|生成|制作|整理|安排|拆分|拆解)[^。？！\n]{0,12}(?:任务|计划))/i
const completeTodoFencePattern = /```todo\b[^\r\n]*\r?\n([\s\S]*?)```[ \t]*/gi
const todoFenceStartPattern = /```todo\b[^\r\n]*(?:\r?\n|$)/i
const todoOutputCommentPattern = /<!--\s*STUDIUMX_TODO_OUTPUT[\s\S]*?(?:-->|$)/gi

const todoOutputContract = [
  '<!-- STUDIUMX_TODO_OUTPUT',
  '如果回答中形成了可执行的待办清单，请在回答末尾追加且只追加一个如下格式的数据块：',
  '```todo',
  '{"tasks":["第一个具体任务","第二个具体任务"]}',
  '```',
  '每项使用动词开头，保持简短，不超过 8 项。',
  '-->'
].join('\n')

export type AssistantTodoTurnInspection = {
  visibleContent: string
  tasks: string[]
}

export type AssistantTodoImportResult = {
  tasks: StudyTask[]
  added: number
}

function normalizeTaskTitles(input: unknown): string[] {
  if (!Array.isArray(input)) return []

  const seen = new Set<string>()
  const titles: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const title = item.trim().replace(/\s+/g, ' ').slice(0, 80)
    const key = title.toLocaleLowerCase()
    if (!title || seen.has(key)) continue

    seen.add(key)
    titles.push(title)
    if (titles.length >= MAX_ASSISTANT_TASKS) break
  }
  return titles
}

function parseTodoPayload(payload: string): string[] {
  try {
    const parsed = JSON.parse(payload.trim()) as unknown
    if (Array.isArray(parsed)) return normalizeTaskTitles(parsed)
    if (!parsed || typeof parsed !== 'object') return []
    return normalizeTaskTitles((parsed as { tasks?: unknown }).tasks)
  } catch {
    return []
  }
}

/**
 * Reads the existing browser Session snapshot without rewriting it. This preserves
 * the Session representation while allowing a duplicate/cap no-op to stay a true
 * no-op (readStudySnapshot canonically persists every read).
 */
function readBrowserStudySnapshot(): StudySnapshot {
  try {
    const serialized = window.localStorage.getItem(STUDY_SPACE_STORAGE_KEY)
    const parsed = serialized ? JSON.parse(serialized) : defaultStudySnapshot
    return normalizeStudySnapshot(parsed)
  } catch {
    return normalizeStudySnapshot(defaultStudySnapshot)
  }
}

export function preparePrompt(prompt: string): string {
  if (!todoIntentPattern.test(prompt)) return prompt
  return `${prompt}\n\n${todoOutputContract}`
}

/**
 * Separates the assistant's user-visible Markdown from its hidden Todo payload.
 * Every protocol fence is stripped, including malformed and streaming-partial
 * output, so a model protocol never appears in the conversation UI.
 */
export function inspectAssistantTurn(content: string): AssistantTodoTurnInspection {
  let tasks: string[] = []

  completeTodoFencePattern.lastIndex = 0
  for (const match of content.matchAll(completeTodoFencePattern)) {
    const parsedTasks = parseTodoPayload(match[1] ?? '')
    if (parsedTasks.length === 0) continue
    tasks = parsedTasks
    break
  }

  completeTodoFencePattern.lastIndex = 0
  const withoutCompletePayloads = content.replace(completeTodoFencePattern, '')
  todoOutputCommentPattern.lastIndex = 0
  const withoutOutputContract = withoutCompletePayloads.replace(todoOutputCommentPattern, '')
  const partialFenceIndex = withoutOutputContract.search(todoFenceStartPattern)
  const visibleContent = (partialFenceIndex >= 0
    ? withoutOutputContract.slice(0, partialFenceIndex)
    : withoutOutputContract
  ).trim()

  return { visibleContent, tasks }
}

export function mergeAssistantTodoTasks(
  existingTasks: StudyTask[],
  titleInput: string[],
  now = Date.now()
): AssistantTodoImportResult {
  const existingKeys = new Set(existingTasks.map((task) => task.title.trim().toLocaleLowerCase()))
  const available = Math.max(0, MAX_ASSISTANT_TASKS - existingTasks.length)
  const titles = normalizeTaskTitles(titleInput)
    .filter((title) => !existingKeys.has(title.toLocaleLowerCase()))
    .slice(0, available)

  if (titles.length === 0) return { tasks: existingTasks, added: 0 }

  const existingIds = new Set(existingTasks.map((task) => task.id))
  let idIndex = 0
  const newTasks = titles.map((title) => {
    let id = `ai-${now}-${idIndex++}`
    while (existingIds.has(id)) id = `ai-${now}-${idIndex++}`
    existingIds.add(id)
    return { id, title, done: false, categoryId: 'study' as const }
  })

  return {
    tasks: [...newTasks, ...existingTasks],
    added: newTasks.length
  }
}

/** Adds validated assistant tasks to the durable browser Session snapshot. */
export function importTasks(titleInput: string[]): AssistantTodoImportResult {
  const snapshot = readBrowserStudySnapshot()
  const result = mergeAssistantTodoTasks(snapshot.tasks, titleInput)
  if (result.added === 0) return result

  persistStudySnapshot({ ...snapshot, tasks: result.tasks })
  window.dispatchEvent(new CustomEvent<StudyTask[]>(STUDY_TASKS_CHANGED_EVENT, { detail: result.tasks }))
  return result
}

export const AssistantTodoCapture = {
  preparePrompt,
  inspectAssistantTurn,
  importTasks
} as const
