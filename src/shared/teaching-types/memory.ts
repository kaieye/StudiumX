export type TeachingMemoryScope = 'user' | 'workspace' | 'project'

export type TeachingMemoryRecord = {
  id: string
  content: string
  scope: TeachingMemoryScope
  workspace?: string
  project?: string
  sourceLessonId?: string
  tags: string[]
  confidence: number
  createdAt: string
  updatedAt: string
  disabledAt?: string
  deletedAt?: string
}

export type TeachingMemoryDiagnostics = {
  enabled: boolean
  rootDir: string
  activeCount: number
  tombstoneCount: number
  lastInjectedIds: string[]
}

export type CreateTeachingMemoryPayload = {
  content: string
  scope: TeachingMemoryScope
  tags?: string[]
  confidence?: number
  workspaceRoot?: string
}

export type UpdateTeachingMemoryPayload = {
  content?: string
  tags?: string[]
  confidence?: number
  disabled?: boolean
  workspaceRoot?: string
}

export type TeachingMemoryCaptureResult = {
  action: 'created' | 'requested_consent' | 'approved' | 'rejected' | 'none'
  candidateContent?: string
  memoryId?: string
}
