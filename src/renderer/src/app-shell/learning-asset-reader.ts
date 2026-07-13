import type {
  ReadLessonPayload,
  ReadLessonResult,
  SaveWorkspaceMarkdownPayload,
  SaveWorkspaceMarkdownResult,
  TeachingAppState,
  TeachingSystemApi,
  TeachingWorkspaceSummary,
  WorkspaceMarkdownDocument
} from '../../../shared/teaching-types'
import {
  closeLearningAssetReaderContext,
  courseRelativePathForFile,
  openLessonReaderContext,
  openResourceReaderContext,
  openWorkspaceMarkdownContext,
  type AppShellTransitionPatch,
  type CoursePreviewFile,
  type ResourcePreviewFile
} from './contextTransitions'

/**
 * The two system-facing adapters needed by the reader. Keeping the IPC calls here
 * lets the reader coordinate selections, stale results, and recovery without
 * coupling that behavior to the Zustand store or a React component.
 */
export type HtmlPreviewAdapter = {
  read(input: ReadLessonPayload): Promise<ReadLessonResult>
}

export function createHtmlPreviewAdapter(api: Pick<TeachingSystemApi, 'readLesson'>): HtmlPreviewAdapter {
  return {
    read: (input) => api.readLesson(input)
  }
}

export type MarkdownDocumentAdapter = {
  read(input: { workspaceId: string; documentPath: string }): Promise<WorkspaceMarkdownDocument>
  save(input: SaveWorkspaceMarkdownPayload): Promise<SaveWorkspaceMarkdownResult>
}

export function createMarkdownDocumentAdapter(
  api: Pick<TeachingSystemApi, 'readWorkspaceMarkdown' | 'saveWorkspaceMarkdown'>
): MarkdownDocumentAdapter {
  return {
    read: (input) => api.readWorkspaceMarkdown(input),
    save: (input) => api.saveWorkspaceMarkdown(input)
  }
}

export type LearningAssetReaderSnapshot = {
  appState: TeachingAppState
  lessonReaderOpen: boolean
  selectedCoursePreviewFile: CoursePreviewFile | null
  selectedResourcePreviewFile: ResourcePreviewFile | null
  selectedMarkdownDocument: WorkspaceMarkdownDocument | null
  markdownDraft: string
  markdownSaving: boolean
  selectedCourseWorkspaceId: string | null
}

type LearningAssetReaderPatch<ErrorState> = AppShellTransitionPatch & {
  error?: ErrorState | null
}

export type LearningAssetReaderPort<ErrorState> = {
  getSnapshot: () => LearningAssetReaderSnapshot
  applyPatch: (patch: LearningAssetReaderPatch<ErrorState>) => void
  toError: (error: unknown) => ErrorState
  loadingPreviewHtml: (workspace: TeachingWorkspaceSummary) => string
  emptyPreviewHtml: (workspace: TeachingWorkspaceSummary) => string
}

export type OpenHtmlPreviewInput = {
  workspace: TeachingWorkspaceSummary
  file: CoursePreviewFile
  courseRelativePath?: string | null
}

export type OpenMarkdownDocumentInput = {
  workspace: TeachingWorkspaceSummary
  file: CoursePreviewFile
}

/**
 * Coordinates the complete lifecycle of a learning asset reader selection.
 *
 * A selection version is advanced for every open and close. Async completion
 * must match both that version and the visible selection before it can patch
 * the UI. This guards against slow IPC requests restoring a reader the user
 * has already replaced or closed.
 */
export type LearningAssetReader = {
  openHtmlPreview: (input: OpenHtmlPreviewInput) => Promise<void>
  openMarkdownDocument: (input: OpenMarkdownDocumentInput) => Promise<void>
  openResourcePreview: (file: ResourcePreviewFile) => void
  updateMarkdownDraft: (content: string) => void
  saveMarkdownDocument: () => Promise<void>
  close: () => void
}

export function createLearningAssetReader<ErrorState>(input: {
  htmlPreview: HtmlPreviewAdapter | null
  markdownDocument: MarkdownDocumentAdapter | null
  port: LearningAssetReaderPort<ErrorState>
}): LearningAssetReader {
  let selectionVersion = 0
  let saveVersion = 0

  const beginSelection = (): number => {
    selectionVersion += 1
    saveVersion += 1
    return selectionVersion
  }

  const matchesHtmlSelection = (version: number, file: CoursePreviewFile): boolean => {
    const state = input.port.getSnapshot()
    return selectionVersion === version &&
      state.lessonReaderOpen &&
      state.selectedMarkdownDocument === null &&
      state.selectedCoursePreviewFile?.absolutePath === file.absolutePath
  }

  const matchesMarkdownSelection = (version: number, file: CoursePreviewFile, workspaceId: string): boolean => {
    const state = input.port.getSnapshot()
    return selectionVersion === version &&
      !state.lessonReaderOpen &&
      state.selectedCourseWorkspaceId === workspaceId &&
      state.selectedMarkdownDocument?.absolutePath === file.absolutePath
  }

  return {
    openHtmlPreview: async ({ workspace, file, courseRelativePath }) => {
      const htmlPreview = input.htmlPreview
      if (!htmlPreview) return
      const version = beginSelection()
      input.port.applyPatch(openLessonReaderContext({
        appState: input.port.getSnapshot().appState,
        workspace,
        previewFile: file,
        previewHtml: input.port.loadingPreviewHtml(workspace),
        courseRelativePath: courseRelativePath ?? courseRelativePathForFile(file.relativePath)
      }))

      try {
        const result = await htmlPreview.read({
          workspaceId: workspace.id,
          lessonPath: file.absolutePath
        })
        if (!matchesHtmlSelection(version, file)) return
        const state = input.port.getSnapshot()
        input.port.applyPatch({
          appState: {
            ...state.appState,
            selectedLessonPath: file.absolutePath,
            previewHtml: result.html,
            previewUrl: result.url
          },
          selectedCoursePreviewFile: file
        })
      } catch (error) {
        if (!matchesHtmlSelection(version, file)) return
        const state = input.port.getSnapshot()
        input.port.applyPatch({
          error: input.port.toError(error),
          appState: {
            ...state.appState,
            previewHtml: input.port.emptyPreviewHtml(workspace),
            previewUrl: ''
          }
        })
      }
    },

    openMarkdownDocument: async ({ workspace, file }) => {
      const markdownDocument = input.markdownDocument
      if (!markdownDocument) return
      const version = beginSelection()
      input.port.applyPatch(openWorkspaceMarkdownContext({
        appState: input.port.getSnapshot().appState,
        workspace,
        file,
        courseRelativePath: courseRelativePathForFile(file.relativePath)
      }))

      try {
        const document = await markdownDocument.read({
          workspaceId: workspace.id,
          documentPath: file.absolutePath
        })
        if (!matchesMarkdownSelection(version, file, workspace.id)) return
        const state = input.port.getSnapshot()
        input.port.applyPatch({
          selectedMarkdownDocument: document,
          markdownDraft: document.content,
          appState: { ...state.appState, selectedLessonPath: document.absolutePath }
        })
      } catch (error) {
        if (!matchesMarkdownSelection(version, file, workspace.id)) return
        input.port.applyPatch({
          error: input.port.toError(error),
          ...closeLearningAssetReaderContext()
        })
      }
    },

    openResourcePreview: (file) => {
      beginSelection()
      input.port.applyPatch(openResourceReaderContext(file))
    },

    updateMarkdownDraft: (content) => {
      if (!input.port.getSnapshot().selectedMarkdownDocument) return
      input.port.applyPatch({ markdownDraft: content })
    },

    saveMarkdownDocument: async () => {
      const state = input.port.getSnapshot()
      const document = state.selectedMarkdownDocument
      const workspaceId = state.selectedCourseWorkspaceId ?? state.appState.activeWorkspace?.id
      const markdownDocument = input.markdownDocument
      if (!document || !workspaceId || !markdownDocument || state.markdownSaving) return

      const selectionAtSave = selectionVersion
      const thisSave = ++saveVersion
      const draftAtSave = state.markdownDraft
      input.port.applyPatch({ markdownSaving: true, error: null })

      try {
        const result = await markdownDocument.save({
          workspaceId,
          documentPath: document.absolutePath,
          content: draftAtSave
        })
        if (!matchesMarkdownSelection(selectionAtSave, document, workspaceId) || saveVersion !== thisSave) return
        const current = input.port.getSnapshot()
        input.port.applyPatch({
          appState: result.state,
          selectedMarkdownDocument: result.document,
          // Keep edits made while the save was in flight instead of overwriting them.
          markdownDraft: current.markdownDraft === draftAtSave ? result.document.content : current.markdownDraft,
          markdownSaving: false
        })
      } catch (error) {
        if (!matchesMarkdownSelection(selectionAtSave, document, workspaceId) || saveVersion !== thisSave) return
        input.port.applyPatch({
          error: input.port.toError(error),
          markdownSaving: false
        })
      }
    },

    close: () => {
      beginSelection()
      input.port.applyPatch(closeLearningAssetReaderContext())
    }
  }
}
