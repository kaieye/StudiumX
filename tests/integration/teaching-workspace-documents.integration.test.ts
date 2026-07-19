import { mkdir, open as openFile, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TeachingWorkspaceDocuments } from '../../src/main/teaching-workspace-documents'
import type { DurableFileOperations } from '../../src/main/persistence/durable-file'
import { createVitestRuntimeScope } from '../helpers/test-runtime/vitest'
import { defaultSettings } from '../../src/main/teaching-settings'
import { TeachingWorkspaceService } from '../../src/main/teaching-workspace'
import {
  PREVIEW_PROTOCOL,
  PREVIEW_EXTERNAL_LINK_MESSAGE,
  PREVIEW_MARKDOWN_LINK_MESSAGE,
  PREVIEW_SCROLLBAR_STYLE_ID
} from '../../src/shared/preview-markdown-bridge'

const runtimeScope = createVitestRuntimeScope()

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

function recordingDurableOperations(): {
  operations: DurableFileOperations
  events: string[]
  failWith: (matcher: (event: string) => Error | undefined) => void
} {
  const events: string[] = []
  let fail: (event: string) => Error | undefined = () => undefined
  const observe = (event: string): void => {
    events.push(event)
    const failure = fail(event)
    if (failure) throw failure
  }
  const operations: DurableFileOperations = {
    mkdir,
    readFile,
    open: async (path, flags, mode) => {
      observe(`open:${flags}:${path}`)
      const handle = await openFile(path, flags, mode)
      return {
        writeFile: async (content) => {
          observe(`write:${path}`)
          await handle.writeFile(content)
        },
        sync: async () => {
          observe(`sync:${path}`)
          await handle.sync()
        },
        close: async () => {
          const event = `close:${path}`
          events.push(event)
          const failure = fail(event)
          await handle.close()
          if (failure) throw failure
        }
      }
    },
    rename: async (from, to) => {
      observe(`rename:${from}->${to}`)
      await rename(from, to)
    },
    rm
  }
  return { operations, events, failWith: (matcher) => { fail = matcher } }
}

async function createDocumentWorkspace() {
  const runtime = await runtimeScope.create('workspace-documents')
  const rootPath = runtime.paths.workspace
  await mkdir(join(rootPath, 'courses', 'course-a', 'lesson-a'), { recursive: true })
  await mkdir(join(rootPath, 'lessons', 'legacy'), { recursive: true })
  await mkdir(join(rootPath, 'learning-records'), { recursive: true })
  await mkdir(join(rootPath, 'reviews'), { recursive: true })
  await mkdir(join(rootPath, 'reference'), { recursive: true })
  await mkdir(join(rootPath, 'conversation'), { recursive: true })
  await mkdir(join(rootPath, 'assets'), { recursive: true })
  return { id: 'workspace-documents', rootPath }
}

describe('TeachingWorkspaceDocuments', () => {
  it('uses document intent tables for exactly the supported Markdown, lesson, asset, and MIME paths', async () => {
    const workspace = await createDocumentWorkspace()
    const documents = new TeachingWorkspaceDocuments()
    const markdownDocuments = [
      'MISSION.md',
      'RESOURCES.md',
      'GLOSSARY.md',
      'NOTES.md',
      'courses/course-a/lesson-a/outline.md',
      'lessons/legacy/guide.md',
      'learning-records/progress.md',
      'reviews/card.md',
      'reference/source.md',
      'conversation/thread.md'
    ]
    await Promise.all(markdownDocuments.map((relativePath) => writeFile(join(workspace.rootPath, relativePath), `# ${relativePath}\n`)))

    for (const relativePath of markdownDocuments) {
      const document = await documents.readMarkdown(workspace, relativePath)
      expect(document.relativePath).toBe(relativePath)
      expect(document.absolutePath).toBe(join(workspace.rootPath, relativePath))
      expect(document.title).toBe(relativePath)
    }

    const saved = await documents.saveMarkdown(workspace, 'courses/new-course/notes.md', '# Safely saved\n')
    expect(saved.relativePath).toBe('courses/new-course/notes.md')
    expect(saved.title).toBe('Safely saved')
    await expect(readFile(join(workspace.rootPath, 'courses', 'new-course', 'notes.md'), 'utf8')).resolves.toBe('# Safely saved\n')

    await writeFile(join(workspace.rootPath, 'courses', 'course-a', 'lesson-a', 'index.html'), '<html><head></head><body><a href="../../../MISSION.md">Mission</a><a href="https://example.test">External</a></body></html>')
    await writeFile(join(workspace.rootPath, 'lessons', 'legacy', 'legacy.htm'), '<html><head></head><body>Legacy</body></html>')
    await writeFile(join(workspace.rootPath, 'assets', 'lesson.css'), 'body { color: red; }')
    await writeFile(join(workspace.rootPath, 'assets', 'diagram.svg'), '<svg></svg>')
    const binary = Buffer.from([0, 255, 17, 128, 0])
    await writeFile(join(workspace.rootPath, 'assets', 'sample.bin'), binary)

    const lesson = await documents.readLesson(workspace, 'courses\\course-a\\lesson-a\\index.html')
    expect(lesson.url).toBe('studiumx-preview://workspace-documents/courses/course-a/lesson-a/index.html')
    expect(lesson.html).toContain('<base href="studiumx-preview://workspace-documents/courses/course-a/lesson-a/index.html"')
    expect(lesson.html).toContain(PREVIEW_MARKDOWN_LINK_MESSAGE)
    expect(lesson.html).toContain(PREVIEW_EXTERNAL_LINK_MESSAGE)
    expect(lesson.html).toContain(`id="${PREVIEW_SCROLLBAR_STYLE_ID}"`)
    expect(lesson.html).toContain('scrollbar-color: var(--studiumx-preview-scrollbar-thumb) transparent !important;')
    expect(lesson.html).toContain('background: transparent !important;')

    await expect(documents.resolvePreviewFile(workspace, 'assets/lesson.css')).resolves.toMatchObject({
      relativePath: 'assets/lesson.css',
      mimeType: 'text/css; charset=utf-8'
    })
    await expect(documents.resolvePreviewFile(workspace, 'assets/diagram.svg')).resolves.toMatchObject({
      mimeType: 'image/svg+xml'
    })
    await expect(documents.resolvePreviewFile(workspace, 'lessons/legacy/legacy.htm')).resolves.toMatchObject({
      mimeType: 'text/html; charset=utf-8'
    })

    const htmlPreview = await documents.readPreview(
      workspace,
      'courses/course-a/lesson-a/index.html',
      `${PREVIEW_PROTOCOL}://workspace-documents/courses/course-a/lesson-a/index.html`
    )
    expect(htmlPreview?.body.toString('utf8')).toContain(`<base href="${PREVIEW_PROTOCOL}://workspace-documents/courses/course-a/lesson-a/index.html"`)
    expect(htmlPreview?.body.toString('utf8')).toContain(PREVIEW_MARKDOWN_LINK_MESSAGE)
    expect(htmlPreview?.body.toString('utf8')).toContain(`id="${PREVIEW_SCROLLBAR_STYLE_ID}"`)

    const binaryPreview = await documents.readPreview(workspace, 'assets/sample.bin', 'studiumx-preview://workspace-documents/assets/sample.bin')
    expect(binaryPreview?.mimeType).toBe('application/octet-stream')
    expect(binaryPreview?.body).toEqual(binary)
  })

  it.each([
    ['pre-rename file write', (event: string, targetPath: string, rootPath: string) => event.startsWith('write:') && event.includes('.NOTES.md.')],
    ['post-rename directory sync', (event: string, targetPath: string, rootPath: string) => event === `sync:${rootPath}`]
  ])('rejects durable Markdown %s failures before touching or saving the registry', async (name, matches) => {
    const workspace = await createDocumentWorkspace()
    const durable = recordingDurableOperations()
    const registryPath = join(workspace.rootPath, '..', `registry-durable-${name.replace(/\s+/g, '-')}.json`)
    const service = new TeachingWorkspaceService({
      registryPath,
      defaultRoot: join(workspace.rootPath, 'managed-workspaces'),
      settingsProvider: async () => defaultSettings(join(workspace.rootPath, 'managed-workspaces')),
      durableFileOperations: durable.operations
    })
    const created = await service.createWorkspace({ name: `registry durable ${name}`, prompt: 'document durability' })
    const registered = created.activeWorkspace!
    const targetPath = join(registered.rootPath, 'NOTES.md')
    const oldContent = '# Previous registry-safe notes\n'
    const nextContent = '# Durable registry-gated notes\n'
    await writeFile(targetPath, oldContent, 'utf8')
    const registryBeforeFailure = await readFile(registryPath, 'utf8')
    durable.events.length = 0
    const failure = errno('EIO')
    durable.failWith((event) => matches(event, targetPath, registered.rootPath) ? failure : undefined)

    await expect(service.saveWorkspaceMarkdown({
      workspaceId: registered.id,
      documentPath: 'NOTES.md',
      content: nextContent
    })).rejects.toBe(failure)

    await expect(readFile(registryPath, 'utf8')).resolves.toBe(registryBeforeFailure)
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(name === 'pre-rename file write' ? oldContent : nextContent)
  })

  it('rejects absolute and encoded traversal intents, while a failed save leaves registry metadata untouched', async () => {
    const workspace = await createDocumentWorkspace()
    const documents = new TeachingWorkspaceDocuments()
    await writeFile(join(workspace.rootPath, 'courses', 'course-a', 'lesson-a', 'index.html'), '<html></html>')

    const rejectedIntents = [
      '../outside.md',
      '..%2Foutside.md',
      '%2e%2e%2foutside.md',
      'courses/%2e%2e/lesson-a/index.html',
      '%2Fetc%2Fpasswd',
      '/etc/passwd',
      'C:\\outside.md',
      'C:%5Coutside.md',
      'courses/%5C..%5Csecret.md',
      'courses/%2Fabsolute.md'
    ]

    for (const intent of rejectedIntents) {
      await expect(documents.resolvePreviewFile(workspace, intent)).resolves.toBeNull()
      await expect(documents.readMarkdown(workspace, intent)).rejects.toThrow('Markdown path is outside the allowed workspace documents.')
      await expect(documents.readLesson(workspace, intent)).rejects.toThrow('Lesson path is outside the workspace lessons directory.')
    }
    await expect(documents.saveMarkdown(workspace, 'assets/lesson.css', 'nope')).rejects.toThrow('Markdown path is outside the allowed workspace documents.')
    await expect(documents.readMarkdown(workspace, 'MISSION.markdown')).rejects.toThrow('Markdown path is outside the allowed workspace documents.')

    const registryPath = join(workspace.rootPath, '..', 'registry.json')
    const service = new TeachingWorkspaceService({
      registryPath,
      defaultRoot: join(workspace.rootPath, 'managed-workspaces'),
      settingsProvider: async () => defaultSettings(join(workspace.rootPath, 'managed-workspaces'))
    })
    const created = await service.createWorkspace({ name: 'registry-safety', prompt: 'document safety' })
    const registered = created.activeWorkspace
    expect(registered).not.toBeNull()
    const registryBeforeFailure = await readFile(registryPath, 'utf8')

    await expect(service.saveWorkspaceMarkdown({
      workspaceId: registered!.id,
      documentPath: '%2e%2e%2foutside.md',
      content: '# unsafe\n'
    })).rejects.toThrow('Markdown path is outside the allowed workspace documents.')
    expect(await readFile(registryPath, 'utf8')).toBe(registryBeforeFailure)

    const saved = await service.saveWorkspaceMarkdown({
      workspaceId: registered!.id,
      documentPath: 'NOTES.md',
      content: '# Updated safely\n'
    })
    expect(saved.document.content).toBe('# Updated safely\n')
    expect(await readFile(join(registered!.rootPath, 'NOTES.md'), 'utf8')).toBe('# Updated safely\n')
    expect(await readFile(registryPath, 'utf8')).not.toBe(registryBeforeFailure)
  })
})
