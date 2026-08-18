import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callProvider, streamProvider } from '../../src/main/ai/provider-adapter'
import {
  cancelMindMapGeneration,
  generateMindMap,
  generateMindMapProposal,
  MindMapGenerationError,
  parseMindMapOutput
} from '../../src/main/mindmap/mind-map-generation'
import { defaultSettings } from '../../src/main/teaching-settings'
import type { MindMapDocument } from '../../src/shared/mindmap/mind-map-types'
import type { MindMapDocumentV2 } from '../../src/shared/mindmap/domain/types'
import type {
  MindMapProviderProposal
} from '../../src/shared/mindmap/commands/mind-map-proposal'
import type { MindMapProposalRequest } from '../../src/shared/mindmap/commands/mind-map-proposal-request'

function testSettings(): ReturnType<typeof defaultSettings> {
  const value = defaultSettings('mind-map-generation-test')
  value.generator.providerId = 'mock'
  value.generator.endpointFormat = 'openai-chat'
  value.generator.requestTimeoutMs = 30_000
  value.provider.activeProviderId = 'mock'
  value.provider.providers[0] = { ...value.provider.providers[0]!, id: 'mock', apiKey: 'key' }
  return value
}

vi.mock('../../src/main/ai/provider-adapter', () => ({
  resolveActiveProvider: vi.fn(() => ({ id: 'mock', apiKey: 'key' }) as never),
  callProvider: vi.fn((opts: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    const onAbort = (): void => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })
  })),
  streamProvider: vi.fn(),
  ProviderAdapterError: class ProviderAdapterError extends Error {}
}))

function validRawDocument(): MindMapDocument {
  return {
    schemaVersion: 1,
    id: 'doc-1',
    title: 'Study Plan',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    sheets: [
      {
        id: 'sheet-1',
        title: 'Sheet 1',
        structureClass: 'studiumx.layout.logic.right',
        root: {
          id: 'root-1',
          title: 'Chemistry',
          children: [
            {
              id: 'child-1',
              title: 'Acids',
              children: [
                { id: 'grandchild-1', title: 'pH', children: [] }
              ]
            }
          ]
        }
      }
    ]
  }
}

function proposalDocument(): MindMapDocumentV2 {
  return {
    schemaVersion: 2,
    id: 'doc-1',
    revision: 7,
    title: 'Study map',
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    theme: { id: 'default' },
    sheets: [
      {
        id: 'sheet-1',
        title: 'Overview',
        root: {
          id: 'root-1',
          title: 'Overview',
          children: [{ id: 'topic-1', title: 'Topic 1', children: [] }]
        },
        elements: [],
        layout: { structureClass: 'studiumx.layout.logic.right' }
      }
    ],
    assets: []
  }
}

function proposalRequest(): MindMapProposalRequest {
  return {
    schemaVersion: 1,
    scope: 'selection',
    documentId: 'doc-1',
    sheetId: 'sheet-1',
    selectedTopicIds: ['topic-1'],
    sourceRefs: []
  }
}

function validProposal(): MindMapProviderProposal {
  return {
    schemaVersion: 1,
    proposalId: 'proposal-1',
    scope: 'selection',
    items: [
      {
        id: 'rename-topic',
        command: {
          type: 'topic.update',
          sheetId: 'sheet-1',
          topicId: 'topic-1',
          patch: { title: 'Updated topic' }
        }
      }
    ]
  }
}

function proposalInput(overrides: Partial<Parameters<typeof generateMindMapProposal>[0]> = {}) {
  return {
    title: 'Study map',
    prompt: 'Clarify the selected topic.',
    settings: testSettings(),
    document: proposalDocument(),
    request: proposalRequest(),
    ...overrides
  }
}

describe('parseMindMapOutput', () => {
  it('parses a valid document from raw JSON', () => {
    const doc = parseMindMapOutput(JSON.stringify(validRawDocument()))
    expect(doc).toEqual(validRawDocument())
  })

  it('parses JSON wrapped in a ```json fence', () => {
    const fenced = '```json\n' + JSON.stringify(validRawDocument()) + '\n```'
    const doc = parseMindMapOutput(fenced)
    expect(doc).toEqual(validRawDocument())
  })

  it('parses JSON wrapped in a bare ``` fence', () => {
    const fenced = '```\n' + JSON.stringify(validRawDocument()) + '\n```'
    const doc = parseMindMapOutput(fenced)
    expect(doc).toEqual(validRawDocument())
  })

  it('throws invalid_output on non-JSON text', () => {
    expect(() => parseMindMapOutput('this is not json')).toThrow(MindMapGenerationError)
    try {
      parseMindMapOutput('not json')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output on invalid JSON inside a fence', () => {
    try {
      parseMindMapOutput('```json\n{"sheets": [}\n```')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output when schemaVersion is wrong', () => {
    const doc = validRawDocument()
    const bad = { ...doc, schemaVersion: 99 }
    try {
      parseMindMapOutput(JSON.stringify(bad))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output when sheets is not an array', () => {
    const doc = validRawDocument()
    const bad = { ...doc, sheets: 'not-an-array' as unknown }
    try {
      parseMindMapOutput(JSON.stringify(bad))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('throws invalid_output when a sheet lacks a root', () => {
    const doc = validRawDocument()
    const bad = {
      ...doc,
      sheets: [{ id: 's1', title: 'S', structureClass: 'studiumx.layout.logic.right' }]
    }
    try {
      parseMindMapOutput(JSON.stringify(bad))
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(MindMapGenerationError)
      expect((error as MindMapGenerationError).kind).toBe('invalid_output')
    }
  })

  it('accepts a minimal empty document', () => {
    const empty = {
      schemaVersion: 1,
      id: 'doc-empty',
      title: '',
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
      sheets: []
    }
    const doc = parseMindMapOutput(JSON.stringify(empty))
    expect(doc.sheets).toEqual([])
  })
})

describe('generateMindMapProposal', () => {
  beforeEach(() => {
    vi.mocked(callProvider).mockClear()
    vi.mocked(streamProvider).mockClear()
  })

  it('calls the existing provider path in JSON mode and returns a strict proposal', async () => {
    const proposal = validProposal()
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(proposal) })

    const result = await generateMindMapProposal(proposalInput())

    expect(result).toEqual(proposal)
    expect(callProvider).toHaveBeenCalledTimes(1)
    const providerCall = vi.mocked(callProvider).mock.calls[0]![0]
    expect(providerCall.request).toMatchObject({ jsonMode: true })
    expect(providerCall.request.systemPrompt).toContain('差异提案')
    // The provider needs an exact envelope and executable command shape rather
    // than a union placeholder such as "selection | sheet" or `{ type: "..." }`.
    // Otherwise JSON mode can still yield syntactically-valid output that fails
    // the strict proposal schema before it reaches the review/apply boundary.
    expect(providerCall.request.systemPrompt).toContain('"scope": "selection"')
    expect(providerCall.request.systemPrompt).toContain('"type": "topic.update"')
    expect(providerCall.request.systemPrompt).toContain('"patch": { "title": "..." }')
    expect(providerCall.request.systemPrompt).toContain('items 必须是至少含一项的数组，不能为空')
    expect(providerCall.request.systemPrompt).toContain('绝不能输出 `"items": []`')
    expect(providerCall.request.systemPrompt).toContain('画布文本能力与写法')
    expect(providerCall.request.systemPrompt).toContain('`$...$`')
    expect(providerCall.request.systemPrompt).toContain('`$$\\n...\\n$$`')
    expect(providerCall.request.systemPrompt).toContain('[链接文字](https://example.com)')
    expect(providerCall.request.systemPrompt).toContain('只使用有效的 `http://` 或 `https://` URL')
    expect(providerCall.request.systemPrompt).toContain('创建主题关系')
    expect(providerCall.request.systemPrompt).toContain('创建边界')
    expect(providerCall.request.userPrompt).toContain('<mind_map_context>')
    expect(providerCall.request.userPrompt).toContain('topic-1')
  })

  it('uses a complete hierarchy bootstrap prompt for an empty canonical sheet', async () => {
    const document = proposalDocument()
    document.sheets[0]!.root.children = []
    const proposal: MindMapProviderProposal = {
      schemaVersion: 1,
      proposalId: 'initial-map-proposal',
      scope: 'sheet',
      items: [
        {
          id: 'initial-branch',
          command: {
            type: 'topic.insert',
            sheetId: 'sheet-1',
            parentId: 'root-1',
            node: {
              id: 'branch-1',
              title: 'Core concept',
              children: [
                { id: 'detail-1', title: 'Concrete detail', children: [] }
              ]
            }
          }
        }
      ]
    }
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(proposal) })

    await generateMindMapProposal(proposalInput({
      document,
      request: {
        schemaVersion: 1,
        scope: 'sheet',
        documentId: 'doc-1',
        sheetId: 'sheet-1',
        selectedTopicIds: [],
        sourceRefs: []
      }
    }))

    const providerCall = vi.mocked(callProvider).mock.calls[0]![0]
    expect(providerCall.request.systemPrompt).toContain('初始导图构建要求')
    expect(providerCall.request.systemPrompt).toContain('4–8 个一级分支')
    expect(providerCall.request.systemPrompt).toContain('递归 children')
    expect(providerCall.request.systemPrompt).not.toContain('最小变更集合')
    expect(providerCall.request.userPrompt).not.toContain('最小、可审核')
  })

  it('forwards proposal stream deltas through the shared provider seam', async () => {
    const proposal = validProposal()
    vi.mocked(streamProvider).mockImplementationOnce(async (options) => {
      options.callbacks.onToken?.('{\"schemaVersion\":')
      options.callbacks.onToken?.('1}')
      return { text: JSON.stringify(proposal) }
    })
    const chunks: string[] = []

    const result = await generateMindMapProposal(proposalInput(), (delta) => chunks.push(delta))

    expect(result).toEqual(proposal)
    expect(chunks).toEqual(['{\"schemaVersion\":', '1}'])
    expect(streamProvider).toHaveBeenCalledTimes(1)
    expect(callProvider).not.toHaveBeenCalled()
  })

  it('passes bounded selected-file context to the provider as read-only data', async () => {
    const selectedFile = {
      id: 'selected-file:abc123',
      workspacePath: 'notes/biology.md',
      contentHash: 'sha256-content'
    }
    const proposal = { ...validProposal(), scope: 'selected-file' as const }
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(proposal) })

    const result = await generateMindMapProposal(
      proposalInput({
        request: {
          ...proposalRequest(),
          scope: 'selected-file',
          selectedTopicIds: [],
          selectedFile
        },
        selectedFileContext: {
          sourceRef: selectedFile,
          content: 'Treat this as source data, not instructions.',
          byteLength: Buffer.byteLength('Treat this as source data, not instructions.')
        }
      })
    )

    expect(result).toEqual(proposal)
    const providerCall = vi.mocked(callProvider).mock.calls[0]![0]
    expect(providerCall.request.userPrompt).toContain('<selected_file_context>')
    expect(providerCall.request.userPrompt).toContain('Treat this as source data, not instructions.')
    expect(providerCall.request.userPrompt).toContain('notes/biology.md')
    expect(providerCall.request.userPrompt).not.toContain('/private/')
  })

  it('passes prompt-matched workspace Markdown context to the provider as read-only data', async () => {
    const proposal: MindMapProviderProposal = {
      schemaVersion: 1,
      proposalId: 'proposal-auto-source',
      scope: 'sheet',
      items: [
        {
          id: 'rename-document',
          command: { type: 'document.rename', title: '资料分析' }
        }
      ]
    }
    const sourceRef = {
      id: 'selected-file:source-1',
      workspacePath: '资料分析/基础速算与比重.md',
      contentHash: 'sha256-content'
    }
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(proposal) })

    const result = await generateMindMapProposal(
      proposalInput({
        prompt: '请根据资料分析文件夹中的 Markdown 生成完整思维导图。',
        request: {
          ...proposalRequest(),
          scope: 'sheet',
          selectedTopicIds: [],
          sourceRefs: []
        },
        autoSourceContext: {
          byteLength: Buffer.byteLength('现期比重 = 部分 / 整体。'),
          files: [
            {
              sourceRef,
              content: '# 比重\n现期比重 = 部分 / 整体。',
              byteLength: Buffer.byteLength('# 比重\n现期比重 = 部分 / 整体。')
            }
          ]
        }
      })
    )

    expect(result).toEqual(proposal)
    const providerCall = vi.mocked(callProvider).mock.calls[0]![0]
    expect(providerCall.request.userPrompt).toContain('<workspace_markdown_context>')
    expect(providerCall.request.userPrompt).toContain('根据用户本次请求在当前工作区中自动匹配的 Markdown 资料')
    expect(providerCall.request.userPrompt).toContain('资料分析/基础速算与比重.md')
    expect(providerCall.request.userPrompt).toContain('现期比重')
    expect(providerCall.request.userPrompt).not.toContain('/private/')
  })

  it('passes bounded NOTES.md context to the provider as read-only data', async () => {
    const notes = {
      id: 'notes:abc123',
      workspacePath: 'NOTES.md',
      contentHash: 'sha256-content'
    }
    const proposal = { ...validProposal(), scope: 'notes' as const }
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(proposal) })

    const result = await generateMindMapProposal(
      proposalInput({
        request: {
          ...proposalRequest(),
          scope: 'notes',
          selectedTopicIds: [],
          notes
        },
        notesContext: {
          sourceRef: notes,
          content: 'Remember to review spaced repetition intervals.',
          byteLength: Buffer.byteLength('Remember to review spaced repetition intervals.')
        }
      })
    )

    expect(result).toEqual(proposal)
    const providerCall = vi.mocked(callProvider).mock.calls[0]![0]
    expect(providerCall.request.systemPrompt).toContain('NOTES.md')
    expect(providerCall.request.userPrompt).toContain('<notes_context>')
    expect(providerCall.request.userPrompt).toContain('Remember to review spaced repetition intervals.')
    expect(providerCall.request.userPrompt).toContain('只读资料')
    expect(providerCall.request.userPrompt).not.toContain('/private/')
  })

  it('passes bounded Lesson context to the provider as read-only data', async () => {
    const lesson = {
      id: 'lesson:abc123',
      workspacePath: 'courses/biology/lesson/cell-structure.html',
      contentHash: 'sha256-content'
    }
    const lessonContent = '<h1>Cell structure</h1><p>Membrane and nucleus.</p>'
    const proposal = { ...validProposal(), scope: 'lesson' as const }
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(proposal) })

    const result = await generateMindMapProposal(
      proposalInput({
        request: {
          ...proposalRequest(),
          scope: 'lesson',
          selectedTopicIds: [],
          lesson
        },
        lessonContext: {
          sourceRef: lesson,
          content: lessonContent,
          byteLength: Buffer.byteLength(lessonContent)
        }
      })
    )

    expect(result).toEqual(proposal)
    const providerCall = vi.mocked(callProvider).mock.calls[0]![0]
    expect(providerCall.request.systemPrompt).toContain('Lesson 来源')
    expect(providerCall.request.userPrompt).toContain('<lesson_context>')
    expect(providerCall.request.userPrompt).toContain(lessonContent)
    expect(providerCall.request.userPrompt).toContain('只读资料')
    expect(providerCall.request.userPrompt).not.toContain('/private/')
    expect(JSON.stringify(result)).not.toContain(lessonContent)
  })

  it.each([
    ['invalid JSON', 'not json'],
    ['invalid proposal schema', JSON.stringify({ ...validProposal(), items: [{}] })]
  ])('fails closed for provider %s', async (_label, text) => {
    vi.mocked(callProvider).mockResolvedValueOnce({ text })

    await expect(generateMindMapProposal(proposalInput())).rejects.toMatchObject({
      name: 'MindMapGenerationError',
      kind: 'invalid_output'
    })
  })

  it('rejects a provider proposal whose scope does not match the canonical request', async () => {
    vi.mocked(callProvider).mockResolvedValueOnce({
      text: JSON.stringify({ ...validProposal(), scope: 'sheet' })
    })

    await expect(generateMindMapProposal(proposalInput())).rejects.toMatchObject({
      kind: 'invalid_output'
    })
  })

  it('does not mutate the canonical snapshot while generating', async () => {
    const proposal = validProposal()
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(proposal) })
    const input = proposalInput()
    const before = structuredClone(input.document)

    await generateMindMapProposal(input)

    expect(input.document).toEqual(before)
  })
})

describe('generateMindMap Lesson context', () => {
  beforeEach(() => {
    vi.mocked(callProvider).mockClear()
  })

  it('includes Lesson HTML only in the provider prompt with read-only labeling', async () => {
    const lesson = {
      id: 'lesson:abc123',
      workspacePath: 'lessons/cell-structure.html',
      contentHash: 'sha256-content'
    }
    const lessonContent = '<html><body><h1>Cell structure</h1></body></html>'
    vi.mocked(callProvider).mockResolvedValueOnce({ text: JSON.stringify(validRawDocument()) })

    const result = await generateMindMap({
      title: 'Cell biology',
      prompt: 'Build a map from this lesson.',
      settings: testSettings(),
      lessonContext: {
        sourceRef: lesson,
        content: lessonContent,
        byteLength: Buffer.byteLength(lessonContent)
      }
    })

    expect(result).toEqual(validRawDocument())
    const providerCall = vi.mocked(callProvider).mock.calls[0]![0]
    expect(providerCall.request.systemPrompt).toContain('Lesson HTML 内容会作为只读资料')
    expect(providerCall.request.systemPrompt).toContain('画布文本能力与写法')
    expect(providerCall.request.systemPrompt).toContain('`$...$`')
    expect(providerCall.request.systemPrompt).toContain('`$$\\n...\\n$$`')
    expect(providerCall.request.systemPrompt).toContain('节点标题使用行内渲染')
    expect(providerCall.request.systemPrompt).not.toContain(lessonContent)
    expect(providerCall.request.userPrompt).toContain('<lesson_context>')
    expect(providerCall.request.userPrompt).toContain(lessonContent)
    expect(providerCall.request.userPrompt).toContain('只读资料')
    expect(providerCall.request.userPrompt).not.toContain('/private/workspace')
    expect(JSON.stringify(result)).not.toContain(lessonContent)
  })
})

describe('generateMindMap cancellation', () => {
  it('maps an aborted provider request to MindMapGenerationError(cancelled)', async () => {
    const controller = new AbortController()
    controller.abort()
    const promise = generateMindMap({
      title: 'Test',
      prompt: 'Test prompt',
      settings: testSettings(),
      signal: controller.signal
    })
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('cancelMindMapGeneration aborts a run registered by generationId', async () => {
    const promise = generateMindMap({
      generationId: 'gen-cancel-test',
      title: 'Test',
      prompt: 'Test prompt',
      settings: testSettings()
    })
    expect(cancelMindMapGeneration('gen-cancel-test')).toBe(true)
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('cancels a streamed provider, suppresses late deltas, and releases its lease', async () => {
    let capturedSignal: AbortSignal | undefined
    let capturedCallbacks: { onToken?: (delta: string) => void } | undefined
    let rejectStream: (reason?: unknown) => void = () => undefined

    vi.mocked(streamProvider).mockImplementationOnce((opts) => {
      capturedSignal = opts.signal
      capturedCallbacks = opts.callbacks
      return new Promise((_resolve, reject) => {
        rejectStream = reject
      })
    })

    const chunks: string[] = []
    const promise = generateMindMap(
      {
        generationId: 'gen-stream-cancel-test',
        title: 'Test',
        prompt: 'Test prompt',
        settings: testSettings()
      },
      (chunk) => chunks.push(chunk)
    )

    await vi.waitFor(() => expect(capturedSignal).toBeDefined())
    capturedCallbacks?.onToken?.('before-cancel')
    expect(chunks).toEqual(['before-cancel'])

    expect(cancelMindMapGeneration('gen-stream-cancel-test')).toBe(true)
    expect(capturedSignal?.aborted).toBe(true)
    capturedCallbacks?.onToken?.('after-cancel')
    expect(chunks).toEqual(['before-cancel'])

    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    rejectStream(abortError)
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' })
    expect(cancelMindMapGeneration('gen-stream-cancel-test')).toBe(false)
  })
})
