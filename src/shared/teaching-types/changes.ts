export type TeachingWorkspaceChangeTriggerKind =
  | 'lesson_generation'
  | 'agent_lesson_generation'
  | 'mission_update'
  | 'resource_edit'
  | 'workspace_markdown_save'
  | 'lesson_style_apply'
  | 'agent_conversation_export'

export type TeachingWorkspaceChangeTrigger = {
  kind: TeachingWorkspaceChangeTriggerKind
  label: string
  detail?: string
}

export type TeachingWorkspaceChangedFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'changed'

export type TeachingWorkspaceChangedFileKind =
  | 'lesson'
  | 'reference'
  | 'learning_record'
  | 'review'
  | 'mission'
  | 'resource'
  | 'asset'
  | 'workspace_index'
  | 'session_event'
  | 'conversation'
  | 'other'

export type TeachingWorkspaceChangedFile = {
  relativePath: string
  status: TeachingWorkspaceChangedFileStatus
  fileKind: TeachingWorkspaceChangedFileKind
  additions: number | null
  deletions: number | null
  diffAvailable: boolean
}

export type TeachingWorkspaceGitCheckpoint = {
  repositoryRoot: string
  workspaceInRepository: string
  beforeCommitOid: string
  afterCommitOid: string
}

export type TeachingWorkspaceChangeSummary = {
  id: string
  workspaceId: string
  timestamp: string
  trigger: TeachingWorkspaceChangeTrigger
  changedFiles: TeachingWorkspaceChangedFile[]
  additions: number
  deletions: number
  summary: string
  checkpoint?: TeachingWorkspaceGitCheckpoint
  git: {
    available: boolean
    repositoryRoot?: string
    reason?: 'not_git_repo' | 'git_unavailable' | 'error'
    message?: string
  }
}

export type ReadWorkspaceChangeDiffPayload = {
  workspaceId: string
  relativePath: string
  changeId?: string
}

export type WorkspaceChangeDiffResult =
  | {
      ok: true
      relativePath: string
      diff: string
      truncated: boolean
    }
  | {
      ok: false
      message: string
    }
