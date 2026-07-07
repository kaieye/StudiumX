export type TeachingGitWorkspaceInfo = {
  repositoryRoot: string
  primaryWorktreePath: string
  currentBranch: string | null
  isWorktree: boolean
}

export type TeachingGitWorktreeRow = {
  path: string
  branch: string | null
  head: string
  isPrimary: boolean
  isManaged: boolean
  createdAt: string | null
}

export type TeachingGitWorktreesResult =
  | {
      ok: true
      repositoryRoot: string
      primaryWorktreePath: string
      worktreeRoot: string
      worktrees: TeachingGitWorktreeRow[]
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type RemoveTeachingGitWorktreePayload = {
  workspaceRoot: string
  worktreePath: string
}

export type TeachingGitBranchRow = {
  name: string
  current: boolean
  /**
   * Absolute path of another worktree that already has this branch checked
   * out. Git only allows a branch to live in one worktree at a time, so when
   * this is set an in-place `git switch` would fail. Unset when the branch is
   * free to be checked out in the current workspace.
   */
  worktreePath?: string
  /** True when {@link worktreePath} is the repository's primary (main) worktree. */
  worktreePrimary?: boolean
}

export type TeachingGitBranchesResult =
  | {
      ok: true
      repositoryRoot: string
      /** Absolute path of the repository's primary (main) worktree. */
      primaryRepositoryRoot: string
      currentBranch: string | null
      branches: TeachingGitBranchRow[]
      dirtyCount: number
    }
  | {
      ok: false
      reason: 'no_workspace' | 'not_git_repo' | 'git_unavailable' | 'error'
      message: string
    }

export type GitBranchPayload = {
  workspaceRoot: string
  branch: string
}
