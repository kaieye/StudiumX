import type { StudyTask } from './types'
import { persistStudySnapshot, readStudySnapshot } from './domain'

export const STUDY_TASKS_CHANGED_EVENT = 'studiumx:study-tasks-changed'

const todoIntentPattern = /(?:todo\s*list|todo|待办|清单|任务列表|行动计划|学习计划)/i
const todoBlockPattern = /```todo\s*([\s\S]*?)```/gi
const maxTasks = 8

const todoOutputContract = [
  '<!-- STUDIUMX_TODO_OUTPUT',
  '如果回答中形成了可执行的待办清单，请在回答末尾追加且只追加一个如下格式的数据块：',
  '```todo',
  '{"tasks":["第一个具体任务","第二个具体任务"]}',
  '```',
  '每项使用动词开头，保持简短，不超过 8 项。',
  '-->'
].join('\n')

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
    if (titles.length >= maxTasks) break
  }
  return titles
}

export function appendTodoOutputContract(prompt: string): string {
  const value = prompt.trim()
  if (!todoIntentPattern.test(value)) return value
  return `${value}\n\n${todoOutputContract}`
}

export function parseAssistantTodoPayload(content: string): string[] {
  todoBlockPattern.lastIndex = 0
  for (const match of content.matchAll(todoBlockPattern)) {
    try {
      const parsed = JSON.parse(match[1].trim()) as unknown
      const tasks = Array.isArray(parsed)
        ? normalizeTaskTitles(parsed)
        : normalizeTaskTitles((parsed as { tasks?: unknown } | null)?.tasks)
      if (tasks.length > 0) return tasks
    } catch {
      // Ignore malformed model output and leave the conversation untouched.
    }
  }
  return []
}

export function stripAssistantTodoPayload(content: string): string {
  todoBlockPattern.lastIndex = 0
  return content.replace(todoBlockPattern, '').trim()
}

export function mergeAssistantTodoTasks(
  existingTasks: StudyTask[],
  titleInput: string[],
  now = Date.now()
): { tasks: StudyTask[]; added: number } {
  const existingKeys = new Set(existingTasks.map((task) => task.title.trim().toLocaleLowerCase()))
  const newTasks = normalizeTaskTitles(titleInput)
    .filter((title) => !existingKeys.has(title.toLocaleLowerCase()))
    .map((title, index) => ({ id: `ai-${now}-${index}`, title, done: false }))

  return {
    tasks: [...newTasks, ...existingTasks].slice(0, maxTasks),
    added: newTasks.length
  }
}

export function appendAssistantTodoTasks(titleInput: string[]): { tasks: StudyTask[]; added: number } {
  const snapshot = readStudySnapshot()
  const result = mergeAssistantTodoTasks(snapshot.tasks, titleInput)
  if (result.added === 0) return result

  persistStudySnapshot({ ...snapshot, tasks: result.tasks })
  window.dispatchEvent(new CustomEvent<StudyTask[]>(STUDY_TASKS_CHANGED_EVENT, { detail: result.tasks }))
  return result
}
