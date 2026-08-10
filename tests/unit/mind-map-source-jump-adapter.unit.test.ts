import { describe, expect, it, vi } from 'vitest'
import type { MindMapSourceRef } from '../../src/shared/mindmap/domain/types'
import type { TeachingWorkspaceSummary } from '../../src/shared/teaching-types'
import {
  createMindMapSourceJumpAdapter,
  findCanonicalWorkspaceFile
} from '../../src/renderer/src/app-shell/mind-map-source-jump'

function workspace(): TeachingWorkspaceSummary {
  return {
    id: 'workspace-1',
    name: 'Source jump workspace',
    rootPath: '/workspace',
    lessons: [
      {
        id: 'lesson-1',
        title: 'Acids and bases',
        relativePath: 'lessons/chemistry/acids.md',
        absolutePath: '/workspace/lessons/chemistry/acids.md'
      }
    ],
    fileTree: [
      {
        name: 'notes',
        kind: 'directory',
        relativePath: 'notes',
        absolutePath: '/workspace/notes',
        children: [
          {
            name: 'chemistry.md',
            kind: 'file',
            relativePath: 'notes/chemistry.md',
            absolutePath: '/workspace/notes/chemistry.md'
          }
        ]
      }
    ]
  } as TeachingWorkspaceSummary
}

describe('mind-map source jump adapter', () => {
  it('opens a catalog-owned lesson through the existing HTML reader seam', async () => {
    const reader = {
      openHtmlPreview: vi.fn(async () => undefined),
      openMarkdownDocument: vi.fn(async () => undefined)
    }
    const sourceRef: MindMapSourceRef = {
      id: 'lesson-ref',
      workspacePath: '.\\lessons\\chemistry\\acids.md',
      blockId: 'acid-block'
    }

    const result = await createMindMapSourceJumpAdapter({ reader }).open({
      sourceRef,
      workspace: workspace()
    })

    expect(result).toEqual({
      ok: true,
      kind: 'lesson',
      relativePath: 'lessons/chemistry/acids.md',
      blockId: 'acid-block'
    })
    expect(reader.openHtmlPreview).toHaveBeenCalledWith({
      workspace: workspace(),
      file: {
        title: 'Acids and bases',
        relativePath: 'lessons/chemistry/acids.md',
        absolutePath: '/workspace/lessons/chemistry/acids.md'
      }
    })
    expect(reader.openMarkdownDocument).not.toHaveBeenCalled()
  })

  it('opens a catalog-owned note through the existing Markdown reader seam', async () => {
    const reader = {
      openHtmlPreview: vi.fn(async () => undefined),
      openMarkdownDocument: vi.fn(async () => undefined)
    }

    const result = await createMindMapSourceJumpAdapter({ reader }).open({
      sourceRef: { id: 'notes-ref', workspacePath: 'notes/chemistry.md' },
      workspace: workspace()
    })

    expect(result).toEqual({
      ok: true,
      kind: 'notes',
      relativePath: 'notes/chemistry.md'
    })
    expect(reader.openMarkdownDocument).toHaveBeenCalledWith({
      workspace: workspace(),
      file: {
        title: 'chemistry.md',
        relativePath: 'notes/chemistry.md',
        absolutePath: '/workspace/notes/chemistry.md'
      }
    })
    expect(reader.openHtmlPreview).not.toHaveBeenCalled()
  })

  it('accepts the workspace Markdown extension used by the file reader', async () => {
    const reader = {
      openHtmlPreview: vi.fn(async () => undefined),
      openMarkdownDocument: vi.fn(async () => undefined)
    }
    const markdownWorkspace = {
      ...workspace(),
      fileTree: [
        {
          name: 'reference',
          kind: 'directory' as const,
          relativePath: 'reference',
          absolutePath: '/workspace/reference',
          children: [
            {
              name: 'chemistry.markdown',
              kind: 'file' as const,
              relativePath: 'reference/chemistry.markdown',
              absolutePath: '/workspace/reference/chemistry.markdown'
            }
          ]
        }
      ]
    }

    const result = await createMindMapSourceJumpAdapter({ reader }).open({
      sourceRef: { id: 'markdown-ref', workspacePath: 'reference/chemistry.markdown' },
      workspace: markdownWorkspace
    })

    expect(result).toMatchObject({
      ok: true,
      kind: 'workspace',
      relativePath: 'reference/chemistry.markdown'
    })
    expect(reader.openMarkdownDocument).toHaveBeenCalledOnce()
  })

  it('fails closed for unsafe or unindexed paths without invoking a reader', async () => {
    const reader = {
      openHtmlPreview: vi.fn(async () => undefined),
      openMarkdownDocument: vi.fn(async () => undefined)
    }
    const adapter = createMindMapSourceJumpAdapter({ reader })

    const unsafe = await adapter.open({
      sourceRef: { id: 'unsafe', workspacePath: '../outside.md' },
      workspace: workspace()
    })
    expect(unsafe.ok).toBe(false)
    expect(unsafe).toMatchObject({ reason: 'invalid_target' })

    const unindexed = await adapter.open({
      sourceRef: { id: 'missing', workspacePath: 'reference/missing.md' },
      workspace: workspace()
    })
    expect(unindexed.ok).toBe(false)
    expect(unindexed).toMatchObject({ reason: 'source_not_indexed' })
    expect(reader.openHtmlPreview).not.toHaveBeenCalled()
    expect(reader.openMarkdownDocument).not.toHaveBeenCalled()
  })

  it('does not manufacture absolute paths and keeps block navigation out of the adapter', () => {
    const target = {
      kind: 'workspace',
      locator: 'reference/missing.md',
      readerPayload: { workspaceId: 'workspace-1', documentPath: 'reference/missing.md' },
      canResolve: true,
      blockId: 'future-block'
    } as const

    expect(findCanonicalWorkspaceFile(workspace(), target)).toBeNull()
  })
})
