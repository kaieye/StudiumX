import { describe, expect, it } from 'vitest'
import {
  parseMindMapCancelGenerationPayload,
  parseMindMapCreatePayload,
  parseMindMapGeneratePayload,
  parseMindMapProposalGeneratePayload,
  parseMindMapMarkdownImportPayload,
  parseMindMapMarkdownExportPayload,
  parseMindMapOpmlImportPayload,
  parseMindMapPortableImportPayload,
  parseMindMapOpmlExportPayload,
  parseMindMapPortableExportPayload,
  parseMindMapSvgExportPayload,
  parseMindMapSourceRefreshPayload,
  parseMindMapSourceRefreshApplyPayload,
  parseMindMapUpdatePayload
} from '../../src/main/mindmap/mind-map-ipc-commands'

describe('parseMindMapUpdatePayload', () => {
  it('preserves every shipped right-panel theme and layout field across the IPC parser', () => {
    const doc = {
      schemaVersion: 2 as const,
      id: 'map-1',
      revision: 7,
      title: 'Styled map',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      theme: {
        id: 'preset-1',
        background: '#112233',
        branchColors: ['#ff0000', '#00ff00'],
        textColor: '#fefefe',
        lineColor: '#445566',
        fontFamily: 'Inter, sans-serif',
        shape: 'rounded-rect',
        rainbowBranches: false,
        colorSchemeId: 'classic',
        topicStyles: {
          central: {
            fill: '#123456',
            stroke: '#223344',
            borderStyle: 'hand-drawn-dash' as const,
            borderWidth: 5,
            fontFamily: 'Noto Sans CJK SC',
            fontWeight: '600',
            fontStyle: 'italic' as const,
            textDecoration: 'line-through underline' as const,
            textTransform: 'uppercase' as const,
            textAlign: 'right' as const
          },
          main: { stroke: '#abcdef', borderStyle: 'solid' as const, borderWidth: 3, fontSize: 18, shape: 'underline' },
          sub: { textColor: '#654321', structureClass: 'studiumx.layout.logic.right' }
        }
      },
      sheets: [{
        id: 'sheet-1',
        title: 'Overview',
        root: { id: 'root', title: 'Root', children: [] },
        elements: [],
        layout: {
          structureClass: 'studiumx.layout.logic.right',
          direction: 'ltr' as const,
          compact: true,
          spacing: 24,
          lineStyle: 'elbow' as const,
          lineWidthScale: 1.5
        }
      }],
      assets: []
    }

    const parsed = parseMindMapUpdatePayload({
      workspaceId: 'workspace-1',
      id: doc.id,
      expectedRevision: doc.revision,
      doc
    })

    expect(parsed?.doc).toEqual(doc)
  })

  it('rejects invalid stable style tokens instead of silently widening the contract', () => {
    const payload = {
      workspaceId: 'workspace-1',
      id: 'map-1',
      expectedRevision: 0,
      doc: {
        schemaVersion: 2,
        id: 'map-1',
        revision: 0,
        title: 'Invalid',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
        theme: { id: 'default', background: 'red' },
        sheets: [{
          id: 'sheet-1',
          title: 'Overview',
          root: { id: 'root', title: 'Root', children: [] },
          elements: [],
          layout: { structureClass: 'studiumx.layout.logic.right', lineWidthScale: 0 }
        }],
        assets: []
      }
    }

    expect(parseMindMapUpdatePayload(payload)).toBeNull()
  })
})

describe('parseMindMapCreatePayload', () => {
  const legacyPayload = { workspaceId: 'workspace-1', title: 'Chemistry' }

  it('keeps the existing title-only creation envelope compatible', () => {
    expect(parseMindMapCreatePayload(legacyPayload)).toEqual(legacyPayload)
  })

  it('accepts an native-compatible initial structure', () => {
    expect(
      parseMindMapCreatePayload({
        ...legacyPayload,
        structureClass: 'studiumx.layout.spreadsheet'
      })
    ).toEqual({
      ...legacyPayload,
      structureClass: 'studiumx.layout.spreadsheet'
    })
  })

  it('rejects unsupported structures and renderer-supplied extras', () => {
    expect(
      parseMindMapCreatePayload({
        ...legacyPayload,
        structureClass: 'studiumx.layout.not-a-layout'
      })
    ).toBeNull()
    expect(parseMindMapCreatePayload({ ...legacyPayload, rootPath: '/outside' })).toBeNull()
  })
})

describe('parseMindMapSourceRefreshPayload', () => {
  const valid = { workspaceId: 'workspace-1', id: 'map-1' }

  it('accepts the path-free source refresh envelope', () => {
    expect(parseMindMapSourceRefreshPayload(valid)).toEqual(valid)
  })

  it('rejects blank fields and renderer-supplied extras', () => {
    expect(parseMindMapSourceRefreshPayload({ ...valid, workspaceId: ' ' })).toBeNull()
    expect(parseMindMapSourceRefreshPayload({ ...valid, id: '' })).toBeNull()
    expect(parseMindMapSourceRefreshPayload({ ...valid, workspaceRoot: '/outside' })).toBeNull()
  })
})

describe('parseMindMapSourceRefreshApplyPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    id: 'map-1',
    expectedRevision: 7,
    updates: [
      {
        sourceRef: {
          id: 'source-1',
          workspacePath: './notes/biology.md',
          breadcrumb: ['Biology'],
          contentHash: 'sha256:current',
          stale: false
        }
      }
    ]
  }

  it('normalizes safe workspace-relative source paths', () => {
    expect(parseMindMapSourceRefreshApplyPayload(valid)).toEqual({
      ...valid,
      updates: [{
        sourceRef: {
          ...valid.updates[0].sourceRef,
          workspacePath: 'notes/biology.md'
        }
      }]
    })
  })

  it('rejects extra envelope or nested keys and unsafe paths', () => {
    expect(parseMindMapSourceRefreshApplyPayload({ ...valid, workspaceRoot: '/outside' })).toBeNull()
    expect(
      parseMindMapSourceRefreshApplyPayload({
        ...valid,
        updates: [{ sourceRef: { ...valid.updates[0].sourceRef, extra: true } }]
      })
    ).toBeNull()
    expect(
      parseMindMapSourceRefreshApplyPayload({
        ...valid,
        updates: [{ sourceRef: { ...valid.updates[0].sourceRef, workspacePath: '../outside.md' } }]
      })
    ).toBeNull()
  })

  it('rejects duplicate source ids and invalid revisions', () => {
    expect(
      parseMindMapSourceRefreshApplyPayload({
        ...valid,
        updates: [valid.updates[0], valid.updates[0]]
      })
    ).toBeNull()
    expect(
      parseMindMapSourceRefreshApplyPayload({ ...valid, expectedRevision: -1 })
    ).toBeNull()
  })

  it('requires an observed content hash, an explicit fresh flag, and a path for writeback', () => {
    expect(
      parseMindMapSourceRefreshApplyPayload({
        ...valid,
        updates: [{
          sourceRef: { ...valid.updates[0].sourceRef, contentHash: undefined }
        }]
      })
    ).toBeNull()
    expect(
      parseMindMapSourceRefreshApplyPayload({
        ...valid,
        updates: [{
          sourceRef: { ...valid.updates[0].sourceRef, stale: true }
        }]
      })
    ).toBeNull()
    expect(
      parseMindMapSourceRefreshApplyPayload({
        ...valid,
        updates: [{
          sourceRef: { ...valid.updates[0].sourceRef, workspacePath: undefined }
        }]
      })
    ).toBeNull()
  })
})

describe('parseMindMapProposalGeneratePayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    id: 'map-1',
    scope: 'selection',
    sheetId: 'sheet-1',
    selectedTopicIds: ['topic-1', 'topic-2'],
    sourceRefs: [
      {
        id: 'source-1',
        workspacePath: 'notes/biology.md',
        breadcrumb: ['Biology', 'Cells'],
        blockId: 'block-1',
        contentHash: 'sha256:abc',
        lastConfirmedAt: '2026-08-09T00:00:00.000Z',
        stale: false
      }
    ],
    prompt: 'Add the missing relationship between these topics.'
  }
  const pngAttachment = {
    id: 'image-1',
    name: 'diagram.png',
    mimeType: 'image/png' as const,
    dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    sizeBytes: 70
  }

  it('accepts the strict proposal-generation envelope', () => {
    expect(parseMindMapProposalGeneratePayload(valid)).toEqual(valid)
  })

  it('preserves an optional generation id for provider cancellation', () => {
    expect(
      parseMindMapProposalGeneratePayload({ ...valid, generationId: 'generation-1' })
    ).toEqual({ ...valid, generationId: 'generation-1' })
  })

  it('accepts validated image attachments on the proposal envelope', () => {
    expect(
      parseMindMapProposalGeneratePayload({ ...valid, imageAttachments: [pngAttachment] })
    ).toEqual({ ...valid, imageAttachments: [pngAttachment] })
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        imageAttachments: [pngAttachment],
        generationId: 'generation-1'
      })
    ).toEqual({ ...valid, imageAttachments: [pngAttachment], generationId: 'generation-1' })
  })

  it('accepts bounded conversation history on the proposal envelope', () => {
    const history = [
      { role: 'user' as const, content: '帮我整理这份资料。' },
      { role: 'assistant' as const, content: '已完成：新增 4 个节点。' }
    ]
    expect(
      parseMindMapProposalGeneratePayload({ ...valid, history })
    ).toEqual({ ...valid, history })
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        history,
        generationId: 'generation-1',
        imageAttachments: [pngAttachment]
      })
    ).toEqual({ ...valid, history, generationId: 'generation-1', imageAttachments: [pngAttachment] })
  })

  it('rejects invalid conversation history on the proposal envelope', () => {
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        history: [{ role: 'system', content: 'nope' }]
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        history: [{ role: 'user', content: ' ' }]
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        history: [{ role: 'user', content: 'x', extra: true }]
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        history: [{
          role: 'user',
          content: 'x'.repeat(8 * 1024 + 1)
        }]
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        history: Array.from({ length: 25 }, () => ({ role: 'user' as const, content: 'x' }))
      })
    ).toBeNull()
  })

  it('rejects invalid image attachments on the proposal envelope', () => {
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        imageAttachments: [{ ...pngAttachment, sizeBytes: 999 }]
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        imageAttachments: [{ ...pngAttachment, mimeType: 'image/svg+xml' }]
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        imageAttachments: [{ ...pngAttachment, name: 'C:\\private\\diagram.png' }]
      })
    ).toBeNull()
  })

  it('rejects unknown envelope or source-ref fields', () => {
    expect(
      parseMindMapProposalGeneratePayload({ ...valid, extra: true })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        sourceRefs: [{ ...valid.sourceRefs[0], extra: true }]
      })
    ).toBeNull()
  })

  it('rejects invalid scopes and duplicate ids', () => {
    expect(
      parseMindMapProposalGeneratePayload({ ...valid, scope: 'document' })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        selectedTopicIds: ['topic-1', 'topic-1']
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        sourceRefs: [valid.sourceRefs[0], valid.sourceRefs[0]]
      })
    ).toBeNull()
  })

  it('accepts selected-file scope only with a strict workspace-relative file envelope', () => {
    const selectedFile = {
      workspacePath: 'notes/biology.md'
    }
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        scope: 'selected-file',
        selectedTopicIds: [],
        sourceRefs: [],
        selectedFile
      })
    ).toEqual({
      ...valid,
      scope: 'selected-file',
      selectedTopicIds: [],
      sourceRefs: [],
      selectedFile
    })
  })

  it('accepts notes scope without a renderer-supplied source path', () => {
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        scope: 'notes',
        selectedTopicIds: [],
        sourceRefs: []
      })
    ).toEqual({
      ...valid,
      scope: 'notes',
      selectedTopicIds: [],
      sourceRefs: []
    })
  })


  it('accepts canonical Lesson scope with a strict workspace-relative HTML envelope', () => {
    const lesson = { workspacePath: 'courses/biology/lesson/cell-structure.html' }
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        scope: 'lesson',
        selectedTopicIds: [],
        sourceRefs: [],
        lesson
      })
    ).toEqual({
      ...valid,
      scope: 'lesson',
      selectedTopicIds: [],
      sourceRefs: [],
      lesson
    })
  })

  it('rejects missing, misplaced, unsafe, or nested-extra Lesson data', () => {
    const lessonScope = {
      ...valid,
      scope: 'lesson',
      selectedTopicIds: [],
      sourceRefs: []
    }
    expect(parseMindMapProposalGeneratePayload(lessonScope)).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        lesson: { workspacePath: 'lessons/cell-structure.html' }
      })
    ).toBeNull()

    for (const workspacePath of [
      'notes/cell-structure.html',
      'lessons/cell-structure.md',
      'lessons/assessment-cell-structure.html',
      'courses/biology/assessment/cell-structure.html',
      '../lessons/cell-structure.html',
      '/private/lessons/cell-structure.html',
      'C:\\private\\lessons\\cell-structure.html',
      '\\\\server\\share\\lessons\\cell-structure.html',
      'lessons/cell\u0000structure.html'
    ]) {
      expect(
        parseMindMapProposalGeneratePayload({ ...lessonScope, lesson: { workspacePath } })
      ).toBeNull()
    }
    expect(
      parseMindMapProposalGeneratePayload({
        ...lessonScope,
        lesson: { workspacePath: 'lessons/cell-structure.html', extra: true }
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        scope: 'sheet',
        lesson: { workspacePath: 'lessons/cell-structure.html' }
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...lessonScope,
        selectedFile: { workspacePath: 'notes/cell.md' },
        lesson: { workspacePath: 'lessons/cell-structure.html' }
      })
    ).toBeNull()
  })

  it('rejects missing, misplaced, unsafe, or nested-extra selected-file data', () => {
    const selected = {
      ...valid,
      scope: 'selected-file',
      selectedTopicIds: [],
      sourceRefs: []
    }
    expect(parseMindMapProposalGeneratePayload(selected)).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({ ...valid, selectedFile: { workspacePath: 'notes/a.md' } })
    ).toBeNull()

    for (const workspacePath of [
      '../outside.md',
      '/private/outside.md',
      'C:\\private\\outside.md',
      '\\\\server\\share\\outside.md',
      'notes/bad\u0000.md'
    ]) {
      expect(
        parseMindMapProposalGeneratePayload({ ...selected, selectedFile: { workspacePath } })
      ).toBeNull()
    }
    expect(
      parseMindMapProposalGeneratePayload({
        ...selected,
        selectedFile: { workspacePath: 'notes/a.md', extra: true }
      })
    ).toBeNull()
    expect(
      parseMindMapProposalGeneratePayload({
        ...valid,
        scope: 'notes',
        selectedTopicIds: [],
        sourceRefs: [],
        selectedFile: { workspacePath: 'notes/a.md' }
      })
    ).toBeNull()
  })
})

describe('parseMindMapGeneratePayload', () => {
  it('accepts the legacy envelope without a cancellation id', () => {
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis'
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: 'Explain mitosis'
    })
  })

  it('preserves a generation id for provider cancellation', () => {
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        generationId: 'generation-1'
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: 'Explain mitosis',
      generationId: 'generation-1'
    })
  })

  it('accepts validated image attachments on the full-document envelope', () => {
    const attachment = {
      id: 'image-1',
      name: 'diagram.png',
      mimeType: 'image/png' as const,
      dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      sizeBytes: 70
    }
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        imageAttachments: [attachment]
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: 'Explain mitosis',
      imageAttachments: [attachment]
    })
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        imageAttachments: [attachment],
        generationId: 'generation-1'
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: 'Explain mitosis',
      imageAttachments: [attachment],
      generationId: 'generation-1'
    })
  })

  it('rejects invalid image attachments on the full-document envelope', () => {
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        imageAttachments: [{
          id: 'image-1',
          name: 'diagram.png',
          mimeType: 'image/png' as const,
          dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          sizeBytes: 999
        }]
      })
    ).toBeNull()
  })

  it('accepts bounded conversation history on the full-document envelope', () => {
    const history = [
      { role: 'user' as const, content: '先帮我梳理主题。' },
      { role: 'assistant' as const, content: '已生成第一版导图。' }
    ]
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: '再补充一个分支',
        history
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: '再补充一个分支',
      history
    })
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: '再补充一个分支',
        history,
        generationId: 'generation-1'
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: '再补充一个分支',
      history,
      generationId: 'generation-1'
    })
  })

  it('rejects invalid conversation history on the full-document envelope', () => {
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        history: [{ role: 'assistant', content: '' }]
      })
    ).toBeNull()
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        history: [{ role: 'user', content: 'x', extra: true }]
      })
    ).toBeNull()
  })

  it('rejects blank generation ids and unknown fields', () => {
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        generationId: ' '
      })
    ).toBeNull()

    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        extra: true
      })
    ).toBeNull()
  })

  it('accepts only the workspace-relative selected-file field for full generation', () => {
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        selectedFile: { workspacePath: 'notes/biology.md' }
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: 'Explain mitosis',
      selectedFile: { workspacePath: 'notes/biology.md' }
    })
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        selectedFile: { workspacePath: 'C:\\private\\biology.md' }
      })
    ).toBeNull()
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        selectedFile: { workspacePath: 'notes/biology.md', extra: true }
      })
    ).toBeNull()
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain mitosis',
        selectedFile: { workspacePath: 'notes/biology.md' },
        workspaceRoot: '/private'
      })
    ).toBeNull()
  })


  it('accepts canonical Lesson context for full generation and rejects mixed or unsafe selectors', () => {
    const lesson = { workspacePath: 'lessons/cell-structure.htm' }
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain the lesson',
        lesson
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      title: 'Cell biology',
      prompt: 'Explain the lesson',
      lesson
    })
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain the lesson',
        lesson,
        selectedFile: { workspacePath: 'notes/biology.md' }
      })
    ).toBeNull()
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain the lesson',
        lesson: { workspacePath: '/private/lesson.html' }
      })
    ).toBeNull()
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain the lesson',
        lesson: { workspacePath: 'lessons/cell-structure.html', extra: true }
      })
    ).toBeNull()
    expect(
      parseMindMapGeneratePayload({
        workspaceId: 'workspace-1',
        title: 'Cell biology',
        prompt: 'Explain the lesson',
        lesson,
        workspaceRoot: '/private'
      })
    ).toBeNull()
  })
})

describe('parseMindMapCancelGenerationPayload', () => {
  it('accepts the workspace-scoped cancellation envelope', () => {
    expect(
      parseMindMapCancelGenerationPayload({
        workspaceId: 'workspace-1',
        generationId: 'generation-1'
      })
    ).toEqual({ workspaceId: 'workspace-1', generationId: 'generation-1' })
  })

  it('rejects blank ids and unknown fields before any cancellation side effect', () => {
    expect(
      parseMindMapCancelGenerationPayload({
        workspaceId: 'workspace-1',
        generationId: ' '
      })
    ).toBeNull()

    expect(
      parseMindMapCancelGenerationPayload({
        workspaceId: 'workspace-1',
        generationId: 'generation-1',
        extra: true
      })
    ).toBeNull()
  })
})


describe('parseMindMapMarkdownImportPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    sourcePath: '/tmp/imports/course.md'
  }

  it('accepts the workspace-scoped Markdown source envelope', () => {
    expect(parseMindMapMarkdownImportPayload(valid)).toEqual(valid)
  })

  it('rejects blank fields and unknown keys before file access', () => {
    expect(parseMindMapMarkdownImportPayload({ ...valid, workspaceId: '  ' })).toBeNull()
    expect(parseMindMapMarkdownImportPayload({ ...valid, sourcePath: '' })).toBeNull()
    expect(parseMindMapMarkdownImportPayload({ ...valid, extra: true })).toBeNull()
  })
})

describe('parseMindMapOpmlImportPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    sourcePath: '/tmp/imports/course.opml'
  }

  it('accepts the workspace-scoped OPML source envelope', () => {
    expect(parseMindMapOpmlImportPayload(valid)).toEqual(valid)
  })

  it('rejects blank fields and unknown keys before file access', () => {
    expect(parseMindMapOpmlImportPayload({ ...valid, workspaceId: '  ' })).toBeNull()
    expect(parseMindMapOpmlImportPayload({ ...valid, sourcePath: '' })).toBeNull()
    expect(parseMindMapOpmlImportPayload({ ...valid, extra: true })).toBeNull()
  })
})


describe('parseMindMapPortableImportPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    sourcePath: '/tmp/imports/course.sxmind'
  }

  it('accepts the workspace-scoped StudiumX package envelope', () => {
    expect(parseMindMapPortableImportPayload(valid)).toEqual(valid)
  })

  it('rejects blank fields and unknown keys before file access', () => {
    expect(parseMindMapPortableImportPayload({ ...valid, workspaceId: '  ' })).toBeNull()
    expect(parseMindMapPortableImportPayload({ ...valid, sourcePath: '' })).toBeNull()
    expect(parseMindMapPortableImportPayload({ ...valid, extra: true })).toBeNull()
  })
})


describe('parseMindMapMarkdownExportPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    id: 'map-1',
    destinationDirectory: '/tmp/exports',
    snapshotRevision: 4,
    expectedRevision: 4,
    pendingWrites: false,
    dirty: false
  }

  it('accepts the complete renderer readiness proof', () => {
    expect(parseMindMapMarkdownExportPayload(valid)).toEqual(valid)
  })

  it('rejects missing, malformed, or extra readiness fields', () => {
    expect(parseMindMapMarkdownExportPayload({ ...valid, dirty: undefined })).toBeNull()
    expect(parseMindMapMarkdownExportPayload({ ...valid, snapshotRevision: 1.5 })).toBeNull()
    expect(parseMindMapMarkdownExportPayload({ ...valid, pendingWrites: 'false' })).toBeNull()
    expect(parseMindMapMarkdownExportPayload({ ...valid, extra: true })).toBeNull()
  })
})

describe('parseMindMapOpmlExportPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    id: 'map-1',
    destinationDirectory: '/tmp/exports',
    snapshotRevision: 4,
    expectedRevision: 4,
    pendingWrites: false,
    dirty: false
  }

  it('accepts the complete renderer readiness proof', () => {
    expect(parseMindMapOpmlExportPayload(valid)).toEqual(valid)
  })

  it('rejects missing, malformed, or extra readiness fields', () => {
    expect(parseMindMapOpmlExportPayload({ ...valid, dirty: undefined })).toBeNull()
    expect(parseMindMapOpmlExportPayload({ ...valid, expectedRevision: -1 })).toBeNull()
    expect(parseMindMapOpmlExportPayload({ ...valid, pendingWrites: 'false' })).toBeNull()
    expect(parseMindMapOpmlExportPayload({ ...valid, extra: true })).toBeNull()
  })
})


describe('parseMindMapPortableExportPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    id: 'map-1',
    destinationDirectory: '/tmp/exports',
    snapshotRevision: 4,
    expectedRevision: 4,
    pendingWrites: false,
    dirty: false
  }

  it('accepts the complete renderer readiness proof', () => {
    expect(parseMindMapPortableExportPayload(valid)).toEqual(valid)
  })

  it('rejects missing, malformed, or extra readiness fields', () => {
    expect(parseMindMapPortableExportPayload({ ...valid, dirty: undefined })).toBeNull()
    expect(parseMindMapPortableExportPayload({ ...valid, expectedRevision: -1 })).toBeNull()
    expect(parseMindMapPortableExportPayload({ ...valid, pendingWrites: 'false' })).toBeNull()
    expect(parseMindMapPortableExportPayload({ ...valid, extra: true })).toBeNull()
  })
})


describe('parseMindMapSvgExportPayload', () => {
  const valid = {
    workspaceId: 'workspace-1',
    id: 'map-1',
    sheetId: 'sheet-1',
    destinationDirectory: '/tmp/exports',
    input: {
      title: 'Basics',
      nodes: [
        { id: 'root', title: 'Root', x: -80, y: 0, width: 160, height: 40 },
        { id: 'child', title: 'Child', x: 160, y: 80, width: 160, height: 40, collapsed: true }
      ],
      edges: [{ from: 'root', to: 'child', label: 'supports' }]
    },
    snapshotRevision: 4,
    expectedRevision: 4,
    pendingWrites: false,
    dirty: false
  }

  it('accepts the strict layout input and readiness proof', () => {
    expect(parseMindMapSvgExportPayload(valid)).toEqual(valid)
  })

  it('rejects missing, extra, or malformed nested fields', () => {
    expect(parseMindMapSvgExportPayload({ ...valid, sheetId: undefined })).toBeNull()
    expect(parseMindMapSvgExportPayload({ ...valid, extra: true })).toBeNull()
    expect(
      parseMindMapSvgExportPayload({
        ...valid,
        input: { ...valid.input, nodes: [{ ...valid.input.nodes[0], width: Number.NaN }] }
      })
    ).toBeNull()
    expect(
      parseMindMapSvgExportPayload({
        ...valid,
        input: { ...valid.input, nodes: [{ ...valid.input.nodes[0], extra: true }] }
      })
    ).toBeNull()
    expect(
      parseMindMapSvgExportPayload({
        ...valid,
        input: { ...valid.input, edges: [{ from: 'root', to: 'missing' }] }
      })
    ).toBeNull()
    expect(
      parseMindMapSvgExportPayload({
        ...valid,
        input: { ...valid.input, edges: [{ from: 'root', to: 'child', label: 42 }] }
      })
    ).toBeNull()
  })
})
