import { rm, unlink } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

import type { WorkspaceItemRemoveMode } from '../../shared/teaching-types'
import { isRootAgentConversationMarkdownRelativePath } from '../../shared/agent-conversation-catalog'
import { isPathInsideRoot } from '../path-access'
import {
  normalizeWorkspaceRelativePath,
  type WorkspacePathMeta
} from '../teaching-workspace-paths'
import { requireSafeAgentConversationId } from '../teaching-agent-conversations'
import type { WorkspaceIndex } from './lifecycle'
import type { RegistryWorkspace } from './registry'
import {
  archiveWorkspaceItemPathMeta,
  mergeWorkspaceItemPathMeta,
  planTemporaryConversationDiskRemoval,
  planWorkspaceItemDiskRemoval,
  pruneWorkspaceIndexForItemRemoval,
  pruneWorkspacePathMetaForItemRemoval,
  shouldArchiveWorkspaceItem,
  type WorkspaceItemMetaChange,
  type WorkspaceItemTarget
} from './item-lifecycle'

type TemporaryConversationIndex = {
  pathMeta?: Record<string, WorkspacePathMeta>
}

export type WorkspaceItemLifecycleIntent =
  | { type: 'set-meta'; change: WorkspaceItemMetaChange }
  | { type: 'remove'; mode?: WorkspaceItemRemoveMode }

export type TeachingWorkspaceItemLifecycleExecutorOptions<State> = {
  appDataRoot: string
  loadWorkspaceIndex: (workspace: RegistryWorkspace) => Promise<WorkspaceIndex>
  saveWorkspaceIndex: (rootPath: string, index: WorkspaceIndex) => Promise<void>
  loadTemporaryConversationIndex: () => Promise<TemporaryConversationIndex>
  saveTemporaryConversationIndex: (index: TemporaryConversationIndex) => Promise<void>
  hasTemporaryConversation: (id: string) => Promise<boolean>
  rebuildState: (workspace: RegistryWorkspace) => Promise<State>
}

/**
 * Executes mutations for items shown in a Teaching workspace catalog.
 *
 * Workspace files and their index are durable. Root Agent conversations may instead
 * be temporary app-data records, so their files and metadata are handled as the
 * only distinct representation before the catalog state is rebuilt.
 */
export class TeachingWorkspaceItemLifecycleExecutor<State> {
  constructor(private readonly options: TeachingWorkspaceItemLifecycleExecutorOptions<State>) {}

  async execute(input: {
    workspace: RegistryWorkspace
    target: WorkspaceItemTarget
    intent: WorkspaceItemLifecycleIntent
  }): Promise<State> {
    const target = validateTarget(input.workspace, input.target)
    const temporaryConversation = await this.findTemporaryConversation(target)

    if (input.intent.type === 'set-meta') {
      return this.setMeta(input.workspace, target, input.intent.change, temporaryConversation)
    }

    if (shouldArchiveWorkspaceItem(input.intent.mode)) {
      return this.archive(input.workspace, target, temporaryConversation)
    }

    return this.removeFromDisk(input.workspace, target, temporaryConversation)
  }

  /** Removes every branch artifact in an exhausted conversation session, then rebuilds once. */
  async removeConversationSessionFromDisk(input: {
    workspace: RegistryWorkspace
    relativePaths: readonly string[]
  }): Promise<State> {
    const targets = input.relativePaths.map((relativePath) => validateTarget(input.workspace, {
      relativePath,
      kind: 'conversation'
    }))
    if (targets.length === 0) throw new Error('Conversation session contains no removable branches.')

    const temporaryFlags = await Promise.all(targets.map((target) => this.findTemporaryConversation(target)))
    if (temporaryFlags.some((temporary) => temporary !== temporaryFlags[0])) {
      throw new Error('Conversation session branches must use one storage representation.')
    }

    if (temporaryFlags[0]) {
      const index = await this.options.loadTemporaryConversationIndex()
      await removePlannedPaths(mergeRemovalPlans(targets.map((target) => (
        planTemporaryConversationDiskRemoval(this.options.appDataRoot, target.relativePath)
      ))))
      let pathMeta = index.pathMeta
      for (const target of targets) pathMeta = pruneWorkspacePathMetaForItemRemoval(pathMeta, target)
      await this.options.saveTemporaryConversationIndex({ ...index, pathMeta })
      return this.options.rebuildState(input.workspace)
    }

    const index = await this.options.loadWorkspaceIndex(input.workspace)
    await removePlannedPaths(mergeRemovalPlans(targets.map((target) => (
      planWorkspaceItemDiskRemoval(input.workspace.rootPath, index, target)
    ))))
    let next: Pick<WorkspaceIndex, 'lessons' | 'pathMeta'> = { lessons: index.lessons, pathMeta: index.pathMeta }
    for (const target of targets) next = pruneWorkspaceIndexForItemRemoval({ ...index, ...next }, target)
    await this.options.saveWorkspaceIndex(input.workspace.rootPath, {
      ...index,
      ...next,
      updatedAt: new Date().toISOString()
    })
    return this.options.rebuildState(input.workspace)
  }

  private async setMeta(
    workspace: RegistryWorkspace,
    target: WorkspaceItemTarget,
    change: WorkspaceItemMetaChange,
    temporaryConversation: boolean
  ): Promise<State> {
    if (temporaryConversation) {
      const index = await this.options.loadTemporaryConversationIndex()
      await this.options.saveTemporaryConversationIndex({
        ...index,
        pathMeta: mergeWorkspaceItemPathMeta(index.pathMeta, target.relativePath, change)
      })
      return this.options.rebuildState(workspace)
    }

    const index = await this.options.loadWorkspaceIndex(workspace)
    await this.options.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      pathMeta: mergeWorkspaceItemPathMeta(index.pathMeta, target.relativePath, change),
      updatedAt: new Date().toISOString()
    })
    return this.options.rebuildState(workspace)
  }

  private async archive(
    workspace: RegistryWorkspace,
    target: WorkspaceItemTarget,
    temporaryConversation: boolean
  ): Promise<State> {
    if (temporaryConversation) {
      const index = await this.options.loadTemporaryConversationIndex()
      await this.options.saveTemporaryConversationIndex({
        ...index,
        pathMeta: archiveWorkspaceItemPathMeta(index.pathMeta, target.relativePath)
      })
      return this.options.rebuildState(workspace)
    }

    const index = await this.options.loadWorkspaceIndex(workspace)
    await this.options.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      pathMeta: archiveWorkspaceItemPathMeta(index.pathMeta, target.relativePath),
      updatedAt: new Date().toISOString()
    })
    return this.options.rebuildState(workspace)
  }

  private async removeFromDisk(
    workspace: RegistryWorkspace,
    target: WorkspaceItemTarget,
    temporaryConversation: boolean
  ): Promise<State> {
    if (temporaryConversation) {
      const index = await this.options.loadTemporaryConversationIndex()
      const plan = planTemporaryConversationDiskRemoval(this.options.appDataRoot, target.relativePath)
      await removePlannedPaths(plan)
      await this.options.saveTemporaryConversationIndex({
        ...index,
        pathMeta: pruneWorkspacePathMetaForItemRemoval(index.pathMeta, target)
      })
      return this.options.rebuildState(workspace)
    }

    const index = await this.options.loadWorkspaceIndex(workspace)
    const plan = planWorkspaceItemDiskRemoval(workspace.rootPath, index, target)
    await removePlannedPaths(plan)
    const { lessons, pathMeta } = pruneWorkspaceIndexForItemRemoval(index, target)
    await this.options.saveWorkspaceIndex(workspace.rootPath, {
      ...index,
      lessons,
      pathMeta,
      updatedAt: new Date().toISOString()
    })
    return this.options.rebuildState(workspace)
  }

  private async findTemporaryConversation(target: WorkspaceItemTarget): Promise<boolean> {
    if (target.kind !== 'conversation' || !isRootAgentConversationMarkdownRelativePath(target.relativePath)) {
      return false
    }
    const id = requireSafeAgentConversationId(basename(target.relativePath).replace(/\.md$/i, ''))
    return this.options.hasTemporaryConversation(id)
  }
}

function validateTarget(workspace: RegistryWorkspace, target: WorkspaceItemTarget): WorkspaceItemTarget {
  const relativePath = normalizeWorkspaceRelativePath(target.relativePath)
  if (!relativePath) throw new Error('relativePath is required.')

  const absolutePath = resolve(join(workspace.rootPath, relativePath))
  if (!isPathInsideRoot(workspace.rootPath, absolutePath)) {
    throw new Error('Path is outside the workspace.')
  }

  return { ...target, relativePath }
}

function mergeRemovalPlans(plans: readonly { files: string[]; directories: string[] }[]): { files: string[]; directories: string[] } {
  return {
    files: [...new Set(plans.flatMap((plan) => plan.files))],
    directories: [...new Set(plans.flatMap((plan) => plan.directories))]
  }
}

async function removePlannedPaths(plan: { files: string[]; directories: string[] }): Promise<void> {
  for (const directory of plan.directories) {
    await rm(directory, { recursive: true, force: true })
  }
  for (const file of plan.files) {
    await unlink(file).catch(() => {})
  }
}