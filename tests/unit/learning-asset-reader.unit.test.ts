import { describe, expect, it, vi } from 'vitest'
import type {
  ReadLessonResult,
  SaveWorkspaceMarkdownResult,
  TeachingAppState,
  TeachingWorkspaceSummary,
  WorkspaceMarkdownDocument
} from '../../src/shared/teaching-types'
import type { CoursePreviewFile, ResourcePreviewFile } from '../../src/renderer/src/app-shell/contextTransitions'
import {
  createLearningAssetReader,
  type HtmlPreviewAdapter,
  type LearningAssetReaderSnapshot,
  type MarkdownDocumentAdapter
} from '../../src/renderer/src/app-shell/learning-asset-reader'

type ReaderState = LearningAssetReaderSnapshot & {
  error: string | null
  view?: string
  overviewDialogMode?: string
  selectedCourseRelativePath?: string | null
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function readerWorkspace(): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Reader workspace',
    missionTitle: 'Learn readers',
    missionExcerpt: 'Keep selections coherent.'
  } as TeachingWorkspaceSummary
}

function courseFile(name: string, extension = 'html'): CoursePreviewFile {
  return {
    title: name,
    relativePath: `courses/reader/${name}.${extension}`,
    absolutePath: `/workspace/courses/reader/${name}.${extension}`
  }
}

function markdownDocument(file: CoursePreviewFile, content: string): WorkspaceMarkdownDocument {
  return {
    title: file.title,
    relativePath: file.relativePath,
    absolutePath: file.absolutePath,
    content,
    updatedAt: '2026-07-14T00:00:00.000Z'
  }
}

function createHarness(input: {
  htmlPreview?: Partial<HtmlPreviewAdapter>
  markdownDocument?: Partial<MarkdownDocumentAdapter>
} = {}) {
  const activeWorkspace = readerWorkspace()
  const state: ReaderState = {
    appState: { activeWorkspace } as TeachingAppState,
    lessonReaderOpen: false,
    selectedCoursePreviewFile: null,
    selectedResourcePreviewFile: null,
    selectedMarkdownDocument: null,
    markdownDraft: '',
    markdownSaving: false,
    selectedCourseWorkspaceId: null,
    error: null
  }
  const htmlPreview: HtmlPreviewAdapter = {
    read: input.htmlPreview?.read ?? vi.fn()
  }
  const markdownDocumentAdapter: MarkdownDocumentAdapter = {
    read: input.markdownDocument?.read ?? vi.fn(),
    save: input.markdownDocument?.save ?? vi.fn()
  }
  const reader = createLearningAssetReader({
    htmlPreview,
    markdownDocument: markdownDocumentAdapter,
    port: {
      getSnapshot: () => state,
      applyPatch: (patch) => Object.assign(state, patch),
      toError: (error) => error instanceof Error ? error.message : String(error),
      loadingPreviewHtml: () => '<p>Loading</p>',
      emptyPreviewHtml: () => '<p>Unavailable</p>'
    }
  })
  return { state, reader, workspace: activeWorkspace, htmlPreview, markdownDocumentAdapter }
}

describe('learning asset reader', () => {
  it('keeps a Resource Markdown selection when an earlier Lesson HTML request finishes', async () => {
    const lessonRead = deferred<ReadLessonResult>()
    const resourceRead = deferred<WorkspaceMarkdownDocument>()
    const { state, reader, workspace, htmlPreview, markdownDocumentAdapter } = createHarness({
      htmlPreview: { read: vi.fn(() => lessonRead.promise) },
      markdownDocument: { read: vi.fn(() => resourceRead.promise) }
    })
    const lesson = courseFile('lesson')
    const resource = courseFile('resource', 'md')

    const openingLesson = reader.openHtmlPreview({ workspace, file: lesson })
    const openingResource = reader.openMarkdownDocument({ workspace, file: resource })
    resourceRead.resolve(markdownDocument(resource, '# Resource notes'))
    await openingResource
    lessonRead.resolve({ html: '<h1>Lesson</h1>', url: 'file:///lesson.html' })
    await openingLesson

    expect(htmlPreview.read).toHaveBeenCalledWith({ workspaceId: workspace.id, lessonPath: lesson.relativePath })
    expect(markdownDocumentAdapter.read).toHaveBeenCalledWith({ workspaceId: workspace.id, documentPath: resource.relativePath })
    expect(state.lessonReaderOpen).toBe(false)
    expect(state.selectedCoursePreviewFile).toBeNull()
    expect(state.selectedMarkdownDocument).toMatchObject({ absolutePath: resource.absolutePath, content: '# Resource notes' })
    expect(state.markdownDraft).toBe('# Resource notes')
  })

  it('preserves an unsaved Markdown draft after a failed save and allows recovery with a retry', async () => {
    const file = courseFile('reflection', 'md')
    const savedState = { activeWorkspace: readerWorkspace() } as TeachingAppState
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce({
        state: savedState,
        document: markdownDocument(file, '# Updated reflection')
      } satisfies SaveWorkspaceMarkdownResult)
    const { state, reader, workspace, markdownDocumentAdapter } = createHarness({
      markdownDocument: {
        read: vi.fn().mockResolvedValue(markdownDocument(file, '# Initial reflection')),
        save
      }
    })

    await reader.openMarkdownDocument({ workspace, file })
    reader.updateMarkdownDraft('# Updated reflection')
    await reader.saveMarkdownDocument()

    expect(state.error).toBe('disk full')
    expect(state.markdownSaving).toBe(false)
    expect(state.selectedMarkdownDocument?.content).toBe('# Initial reflection')
    expect(state.markdownDraft).toBe('# Updated reflection')

    await reader.saveMarkdownDocument()

    expect(markdownDocumentAdapter.save).toHaveBeenCalledTimes(2)
    expect(state.error).toBeNull()
    expect(state.markdownSaving).toBe(false)
    expect(state.selectedMarkdownDocument?.content).toBe('# Updated reflection')
    expect(state.markdownDraft).toBe('# Updated reflection')
  })

  it('drops stale selections and does not reopen a reader closed during an in-flight request', async () => {
    const firstRead = deferred<ReadLessonResult>()
    const secondRead = deferred<ReadLessonResult>()
    const closingRead = deferred<WorkspaceMarkdownDocument>()
    const htmlRead = vi.fn()
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(secondRead.promise)
    const markdownRead = vi.fn(() => closingRead.promise)
    const { state, reader, workspace } = createHarness({
      htmlPreview: { read: htmlRead },
      markdownDocument: { read: markdownRead }
    })
    const firstLesson = courseFile('first')
    const secondLesson = courseFile('second')
    const notes = courseFile('notes', 'md')

    const firstOpen = reader.openHtmlPreview({ workspace, file: firstLesson })
    const secondOpen = reader.openHtmlPreview({ workspace, file: secondLesson })
    secondRead.resolve({ html: '<h1>Second</h1>', url: 'file:///second.html' })
    await secondOpen
    firstRead.resolve({ html: '<h1>First</h1>', url: 'file:///first.html' })
    await firstOpen

    expect(state.selectedCoursePreviewFile).toEqual(secondLesson)
    expect(state.appState.previewHtml).toBe('<h1>Second</h1>')

    const openingNotes = reader.openMarkdownDocument({ workspace, file: notes })
    reader.close()
    closingRead.resolve(markdownDocument(notes, '# Notes'))
    await openingNotes

    expect(state.lessonReaderOpen).toBe(false)
    expect(state.selectedCoursePreviewFile).toBeNull()
    expect(state.selectedResourcePreviewFile).toBeNull()
    expect(state.selectedMarkdownDocument).toBeNull()
    expect(state.markdownDraft).toBe('')
  })

  it('resets every reader surface when closing a Resource HTML preview', () => {
    const { state, reader } = createHarness()
    const resource: ResourcePreviewFile = { id: 'style-1', title: 'Style preview', html: '<h1>Style</h1>' }

    reader.openResourcePreview(resource)
    expect(state.selectedResourcePreviewFile?.html).toContain('id="studiumx-preview-scrollbar-style"')
    expect(state.selectedResourcePreviewFile?.html).toContain('background: transparent !important;')
    state.selectedMarkdownDocument = markdownDocument(courseFile('leftover', 'md'), '# leftover')
    state.markdownDraft = '# leftover'
    state.markdownSaving = true
    reader.close()

    expect(state.selectedResourcePreviewFile).toBeNull()
    expect(state.selectedMarkdownDocument).toBeNull()
    expect(state.markdownDraft).toBe('')
    expect(state.markdownSaving).toBe(false)
  })
})
