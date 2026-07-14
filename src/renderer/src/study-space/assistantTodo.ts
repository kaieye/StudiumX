import type { StudyTask } from './types'
import {
  AssistantTodoCapture,
  STUDY_TASKS_CHANGED_EVENT,
  importTasks,
  inspectAssistantTurn,
  mergeAssistantTodoTasks,
  preparePrompt
} from './assistant-todo-capture'

export { AssistantTodoCapture, STUDY_TASKS_CHANGED_EVENT, mergeAssistantTodoTasks }

/** @deprecated Use AssistantTodoCapture.preparePrompt. */
export function appendTodoOutputContract(prompt: string): string {
  return preparePrompt(prompt)
}

/** @deprecated Use AssistantTodoCapture.inspectAssistantTurn. */
export function parseAssistantTodoPayload(content: string): string[] {
  return inspectAssistantTurn(content).tasks
}

/** @deprecated Use AssistantTodoCapture.inspectAssistantTurn. */
export function stripAssistantTodoPayload(content: string): string {
  return inspectAssistantTurn(content).visibleContent
}

/** @deprecated Use AssistantTodoCapture.importTasks. */
export function appendAssistantTodoTasks(titleInput: string[]): { tasks: StudyTask[]; added: number } {
  return importTasks(titleInput)
}
