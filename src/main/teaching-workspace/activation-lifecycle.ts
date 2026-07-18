import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { readValidatedWithBackup, replaceWithBackup } from '../persistence/durable-file'
import type {
  CreateWorkspacePayload,
  TeachingAppState,
  TeachingRuntimeState,
  TeachingSettingsV1,
  TeachingWorkspaceChangeSummary,
  TeachingWorkspaceSummary
} from '../../shared/teaching-types'
import { cleanText, directoryExists, fileExists, slugify, toWorkspaceRelativePath } from '../teaching-workspace-paths'
import { isPathInsideRoot } from '../path-access'
import { previewUrlForDocument } from '../teaching-workspace-documents'
import {
  EMPTY_REGISTRY,
  findWorkspace,
  isRegistryWorkspace,
  orderRegistryWorkspaces,
  samePath,
  sameRegistryWorkspaceOrder,
  upsertRegistryWorkspace,
  visibleRegistryWorkspaces,
  type RegistryWorkspace,
  type WorkspaceRegistry
} from './registry'
import {
  appendSessionEvent,
  deriveWorkspaceTopic,
  loadWorkspaceIndex,
  provisionWorkspaceMaterial,
  saveWorkspaceIndex,
  type SessionEvent
} from './lifecycle'

export type TeachingWorkspaceActivationLifecycleOptions = {
  registryPath: string
  defaultRoot: string
  loadSettings: () => Promise<TeachingSettingsV1>
  summarizeWorkspace: (workspace: RegistryWorkspace) => Promise<TeachingWorkspaceSummary>
  listTemporaryConversations: (registry: WorkspaceRegistry) => Promise<TeachingAppState['temporaryConversations']>
  readLessonHtml: (workspaceId: string, lessonPath: string) => Promise<string>
  runtimeState: () => Promise<TeachingRuntimeState>
  listChangeHistory: (workspaceId: string) => Promise<TeachingWorkspaceChangeSummary[]>
  renderEmptyPreview: (workspace: TeachingWorkspaceSummary) => string
}

/**
 * Owns the durable Teaching workspace activation boundary: registry recovery,
 * root provisioning, active selection, and state assembly from the catalog.
 */
export class TeachingWorkspaceActivationLifecycle {
  constructor(private readonly options: TeachingWorkspaceActivationLifecycleOptions) {}

  async load(options: {
    activeWorkspaceId?: string | null
    selectedLessonPath?: string | null
  } = {}): Promise<TeachingAppState> {
    return this.assembleState(await this.ensureRegistry(), options.activeWorkspaceId, options.selectedLessonPath)
  }

  async create(payload: CreateWorkspacePayload): Promise<TeachingAppState> {
    const now = new Date().toISOString()
    const name = normalizeWorkspaceName(payload.name)
    const entry = await this.provisionWorkspace({
      id: randomUUID(),
      name,
      rootPath: await this.nextWorkspacePath(name),
      prompt: normalizeWorkspacePrompt(payload.prompt, name),
      now,
      eventKind: 'workspace_created'
    })
    const nextRegistry = upsertRegistryWorkspace(await this.loadAvailableRegistry(), entry, entry.id)
    await this.writeRegistry(nextRegistry)
    return this.assembleState(nextRegistry, entry.id, null)
  }

  async import(rootPath: string): Promise<TeachingAppState> {
    const now = new Date().toISOString()
    const normalizedRoot = await validateWorkspaceRoot(rootPath)
    const registry = await this.loadAvailableRegistry()
    const existing = registry.workspaces.find((workspace) => samePath(workspace.rootPath, normalizedRoot))
    if (existing) {
      const entry = await this.provisionWorkspace({
        ...existing,
        rootPath: normalizedRoot,
        prompt: `继续整理 ${existing.name} 教学工作区`,
        now,
        updatedAt: now
      })
      const nextRegistry = upsertRegistryWorkspace(
        registry,
        { ...entry, archived: false, updatedAt: now },
        entry.id
      )
      await this.writeRegistry(nextRegistry)
      return this.assembleState(nextRegistry, entry.id, null)
    }

    const name = normalizeWorkspaceName(basename(normalizedRoot) || 'workspace')
    const entry = await this.provisionWorkspace({
      id: randomUUID(),
      name,
      rootPath: normalizedRoot,
      prompt: `继续整理 ${name} 教学工作区`,
      now,
      eventKind: 'workspace_imported'
    })
    const nextRegistry = upsertRegistryWorkspace(registry, entry, entry.id)
    await this.writeRegistry(nextRegistry)
    return this.assembleState(nextRegistry, entry.id, null)
  }

  async select(workspaceId: string): Promise<TeachingAppState> {
    const registry = await this.ensureRegistry()
    const workspace = findWorkspace(registry, workspaceId)
    if (workspace.archived) throw new Error('Workspace not found.')
    const nextRegistry = { ...registry, activeWorkspaceId: workspace.id }
    await this.writeRegistry(nextRegistry)
    return this.assembleState(nextRegistry, workspace.id, null)
  }

  async saveRegistry(registry: WorkspaceRegistry): Promise<void> {
    await this.writeRegistry(registry)
  }

  async ensureRegistry(): Promise<WorkspaceRegistry> {
    const registry = await this.loadAvailableRegistry()
    if (registry.workspaces.length > 0) return registry

    const now = new Date().toISOString()
    const name = 'learn'
    const entry = await this.provisionWorkspace({
      id: randomUUID(),
      name,
      rootPath: await this.nextWorkspacePath(name),
      prompt: '搭建个人化 AI 教学系统的第一版工作流',
      now,
      eventKind: 'workspace_created'
    })
    const nextRegistry = { activeWorkspaceId: entry.id, workspaces: [entry] }
    await this.writeRegistry(nextRegistry)
    return nextRegistry
  }

  async assembleState(
    registry: WorkspaceRegistry,
    requestedActiveWorkspaceId?: string | null,
    requestedLessonPath?: string | null
  ): Promise<TeachingAppState> {
    const visibleWorkspaces = visibleRegistryWorkspaces(orderRegistryWorkspaces(registry.workspaces))
    const summaries = await Promise.all(visibleWorkspaces.map((workspace) => this.options.summarizeWorkspace(workspace)))
    const temporaryConversations = await this.options.listTemporaryConversations(registry)
    const requestedActive = requestedActiveWorkspaceId ?? registry.activeWorkspaceId
    const activeWorkspace = summaries.find((workspace) => workspace.id === requestedActive) ?? summaries[0] ?? null
    const lessonPath = await selectCatalogLesson(activeWorkspace, requestedLessonPath)
    const previewHtml =
      activeWorkspace && lessonPath
        ? await this.options.readLessonHtml(activeWorkspace.id, lessonPath).catch(() => this.options.renderEmptyPreview(activeWorkspace))
        : activeWorkspace
          ? this.options.renderEmptyPreview(activeWorkspace)
          : ''
    const runtime = await this.options.runtimeState()
    const changeHistory = activeWorkspace ? await this.options.listChangeHistory(activeWorkspace.id) : []

    return {
      workspaces: summaries,
      activeWorkspace,
      temporaryConversations,
      previewHtml,
      previewUrl: activeWorkspace && lessonPath
        ? previewUrlForDocument(activeWorkspace.id, toWorkspaceRelativePath(activeWorkspace.rootPath, lessonPath))
        : '',
      selectedLessonPath: lessonPath,
      runtime,
      recentChangeSummary: changeHistory[0] ?? null,
      changeHistory
    }
  }

  private async provisionWorkspace(options: {
    id: string
    name: string
    rootPath: string
    prompt: string
    now: string
    eventKind?: SessionEvent['kind']
    createdAt?: string
    updatedAt?: string
    pinned?: boolean
    archived?: boolean
  }): Promise<RegistryWorkspace> {
    const entry: RegistryWorkspace = {
      id: options.id,
      name: normalizeWorkspaceName(options.name),
      rootPath: resolve(options.rootPath),
      createdAt: options.createdAt ?? options.now,
      updatedAt: options.updatedAt ?? options.now,
      ...(options.pinned === true ? { pinned: true } : {}),
      ...(options.archived === true ? { archived: true } : {})
    }
    const existingIndex = await loadWorkspaceIndex(entry)
    await provisionWorkspaceMaterial(entry, {
      loadSettings: this.options.loadSettings,
      topic: deriveWorkspaceTopic(options.prompt, entry.name),
      prompt: options.prompt,
      pathMeta: existingIndex.pathMeta
    })
    await saveWorkspaceIndex(entry.rootPath, {
      ...existingIndex,
      id: entry.id,
      name: entry.name,
      rootPath: entry.rootPath,
      createdAt: existingIndex.createdAt || entry.createdAt,
      updatedAt: entry.updatedAt
    })
    if (options.eventKind) {
      await appendSessionEvent(entry.rootPath, {
        id: randomUUID(),
        kind: options.eventKind,
        timestamp: options.now,
        workspaceId: entry.id,
        prompt: options.prompt,
        paths: ['MISSION.md', 'RESOURCES.md', 'assets/lesson.css', 'assets/quiz.js']
      })
    }
    return entry
  }

  private async loadAvailableRegistry(): Promise<WorkspaceRegistry> {
    const read = await this.readRegistry()
    const registry = read.registry
    const workspaces = orderRegistryWorkspaces(await this.pruneUnavailableRoots(registry.workspaces))
    const visible = visibleRegistryWorkspaces(workspaces)
    const activeWorkspaceId = visible.some((workspace) => workspace.id === registry.activeWorkspaceId)
      ? registry.activeWorkspaceId
      : visible[0]?.id ?? null
    const nextRegistry = { activeWorkspaceId, workspaces }
    if (
      nextRegistry.workspaces.length !== registry.workspaces.length ||
      nextRegistry.activeWorkspaceId !== registry.activeWorkspaceId ||
      !sameRegistryWorkspaceOrder(nextRegistry.workspaces, registry.workspaces)
    ) {
      // Reading a backup is recovery, not restoration. Keep the recovered
      // document untouched until an explicit registry mutation needs saving.
      if (read.source !== 'backup') await this.writeRegistry(nextRegistry)
    }
    return nextRegistry
  }

  private async readRegistry(): Promise<{ registry: WorkspaceRegistry; source: 'canonical' | 'backup' | null }> {
    const recovered = await readValidatedWithBackup({
      path: this.options.registryPath,
      validate: isWorkspaceRegistryDocument
    })
    const parsed = recovered.value
    if (!parsed) return { registry: EMPTY_REGISTRY, source: null }
    return {
      source: recovered.source,
      registry: {
        activeWorkspaceId: typeof parsed.activeWorkspaceId === 'string'
          ? parsed.activeWorkspaceId
          : null,
        workspaces: parsed.workspaces
          .filter(isRegistryWorkspace)
          .map((workspace) => ({
            ...workspace,
            rootPath: resolve(workspace.rootPath)
          }))
      }
    }
  }

  private async writeRegistry(registry: WorkspaceRegistry): Promise<void> {
    await replaceWithBackup({
      path: this.options.registryPath,
      content: `${JSON.stringify(registry, null, 2)}\n`,
      validate: isWorkspaceRegistryDocument,
      mode: 0o600
    })
  }

  private async pruneUnavailableRoots(workspaces: RegistryWorkspace[]): Promise<RegistryWorkspace[]> {
    const existing: RegistryWorkspace[] = []
    const seen = new Set<string>()
    for (const workspace of workspaces) {
      const rootPath = resolve(workspace.rootPath)
      const key = rootPath.toLowerCase()
      if (seen.has(key) || !(await directoryExists(rootPath))) continue
      existing.push({ ...workspace, rootPath })
      seen.add(key)
    }
    return existing
  }

  private async nextWorkspacePath(name: string): Promise<string> {
    const { mkdir } = await import('node:fs/promises')
    const defaultRoot = await this.resolveDefaultRoot()
    await mkdir(defaultRoot, { recursive: true })
    const base = slugify(name, 'workspace')
    let candidate = join(defaultRoot, base)
    let suffix = 2
    while (await directoryExists(candidate)) {
      candidate = join(defaultRoot, `${base}-${suffix}`)
      suffix += 1
    }
    return candidate
  }

  private async resolveDefaultRoot(): Promise<string> {
    try {
      return resolve((await this.options.loadSettings()).workspace.defaultRoot || this.options.defaultRoot)
    } catch {
      return resolve(this.options.defaultRoot)
    }
  }
}

function normalizeWorkspaceName(value: string): string {
  return cleanText(value) || 'learn'
}

function normalizeWorkspacePrompt(value: string, name: string): string {
  return cleanText(value) || `学习 ${name}`
}

async function validateWorkspaceRoot(rootPath: string): Promise<string> {
  const normalizedRoot = resolve(rootPath)
  const info = await stat(normalizedRoot)
  if (!info.isDirectory()) throw new Error('Selected path is not a directory.')
  return normalizedRoot
}

async function selectCatalogLesson(
  workspace: TeachingWorkspaceSummary | null,
  requestedLessonPath?: string | null
): Promise<string | null> {
  if (!workspace) return null
  if (requestedLessonPath) {
    const absolutePath = resolve(requestedLessonPath)
    if (isPathInsideRoot(workspace.rootPath, absolutePath) && await fileExists(absolutePath)) return absolutePath
  }
  return workspace.lessons[0]?.absolutePath ?? null
}

function isWorkspaceRegistryDocument(value: unknown): value is WorkspaceRegistry {
  // Keep the historical tolerant reader: individual workspace entries are
  // filtered below, while a registry needs only an object and workspaces array
  // to be a safe durable backup candidate.
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as WorkspaceRegistry).workspaces)
}
