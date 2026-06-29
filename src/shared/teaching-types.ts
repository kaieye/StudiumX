export type WorkspaceView = 'overview' | 'lessons' | 'resources'

export type WorkflowStepState = 'done' | 'active' | 'waiting' | 'error'

export type ResourceSummary = {
  title: string
  detail: string
  tag: string
}

export type LearningRecordSummary = {
  title: string
  date: string
  relativePath: string
  absolutePath: string
}

export type LessonSummary = {
  id: string
  title: string
  objective: string
  prompt: string
  createdAt: string
  durationMinutes: number
  relativePath: string
  absolutePath: string
}

export type TeachingWorkspaceSummary = {
  id: string
  name: string
  rootPath: string
  createdAt: string
  updatedAt: string
  missionTitle: string
  missionExcerpt: string
  resources: ResourceSummary[]
  records: LearningRecordSummary[]
  lessons: LessonSummary[]
  referenceCount: number
  assetsReady: boolean
}

export type TeachingRuntimeState = {
  status: 'idle' | 'working' | 'error'
  currentStep: string
  queuedTasks: number
  providerLabel: string
}

export type TeachingAppState = {
  workspaces: TeachingWorkspaceSummary[]
  activeWorkspace: TeachingWorkspaceSummary | null
  previewHtml: string
  selectedLessonPath: string | null
  runtime: TeachingRuntimeState
}

export type CreateWorkspacePayload = {
  name: string
  prompt: string
}

export type GenerateLessonPayload = {
  workspaceId: string
  prompt: string
}

export type UpdateMissionPayload = {
  workspaceId: string
  prompt: string
}

export type ReadLessonPayload = {
  workspaceId: string
  lessonPath: string
}

export type ImportWorkspaceResult = {
  canceled: boolean
  state: TeachingAppState | null
}

export type GenerateLessonResult = {
  state: TeachingAppState
  lesson: LessonSummary
}

export type OpenPathResult = {
  ok: boolean
  message?: string
}

export type WindowControlAction = 'minimize' | 'toggle-maximize' | 'close'

export type TeachingSystemApi = {
  platform: NodeJS.Platform
  getState: () => Promise<TeachingAppState>
  selectWorkspace: (workspaceId: string) => Promise<TeachingAppState>
  createWorkspace: (payload: CreateWorkspacePayload) => Promise<TeachingAppState>
  importWorkspace: () => Promise<ImportWorkspaceResult>
  updateMission: (payload: UpdateMissionPayload) => Promise<TeachingAppState>
  generateLesson: (payload: GenerateLessonPayload) => Promise<GenerateLessonResult>
  readLesson: (payload: ReadLessonPayload) => Promise<{ html: string }>
  openPath: (path: string) => Promise<OpenPathResult>
  controlWindow: (action: WindowControlAction) => Promise<void>
}
