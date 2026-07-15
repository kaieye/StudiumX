import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const tempRoot = await mkdtemp(join(tmpdir(), 'markdown-preview-capabilities-check-'))
const previewOutfile = join(tempRoot, 'markdown-preview.mjs')
const promptOutfile = join(tempRoot, 'lesson-prompts.mjs')

try {
  await build({
    entryPoints: [join(process.cwd(), 'src', 'renderer', 'src', 'markdown-preview.tsx')],
    outfile: previewOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    external: ['mermaid'],
    logLevel: 'silent'
  })

  const { renderMarkdownPreviewHtml } = await import(pathToFileURL(previewOutfile).href)

  const sample = `# Rich preview

Inline math should render: $E = mc^2$.

$$
\\int_0^1 x^2 dx = \\frac{1}{3}
$$

\`\`\`mermaid
flowchart TD
  A[Question] --> B[Retrieve]
  B --> C[Explain]
\`\`\`

\`\`\`ts
const answer = 42
\`\`\`

| Item | Value |
| --- | ---: |
| math | 1 |
`

  const html = renderMarkdownPreviewHtml(sample)

  assert.match(html, /<span class="markdown-math markdown-math--inline">/, 'inline math should get a math wrapper')
  assert.match(html, /<div class="markdown-math markdown-math--block">/, 'block math should get a math wrapper')
  assert.match(html, /class="katex"/, 'KaTeX should render math markup')
  assert.match(html, /<div class="markdown-mermaid" data-mermaid-state="pending">/, 'Mermaid fences should render as preview placeholders')
  assert.match(html, /class="language-mermaid"/, 'Mermaid source should remain available for fallback display')
  assert.match(html, /markdown-codeblock-pre" data-language="ts"/, 'regular code fences should keep the existing code block shape')
  assert.match(html, /<table\b/, 'Markdown tables should continue to render')
  assert.doesNotMatch(html, /<script>/i, 'raw scripts must not be emitted by preview markdown rendering')

  await build({
    entryPoints: [join(process.cwd(), 'src', 'main', 'ai', 'lesson-prompts.ts')],
    outfile: promptOutfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })

  const { buildLessonSystemPrompt } = await import(pathToFileURL(promptOutfile).href)
  const promptBase = {
    missionTitle: 'Preview capability check',
    missionExcerpt: 'Verify optional rich markdown syntax.',
    durationMinutes: 10,
    includeRetrievalPractice: false,
    generateReference: false,
    memories: [],
    generator: {
      providerId: 'test',
      model: 'test',
      endpointFormat: 'openai',
      temperature: 0,
      maxOutputTokens: 1000,
      includeRetrievalPractice: false
    }
  }

  const conservativePrompt = buildLessonSystemPrompt(promptBase)
  assert.doesNotMatch(conservativePrompt, /KaTeX 数学公式/, 'math syntax should be opt-in')
  assert.doesNotMatch(conservativePrompt, /Mermaid 代码围栏/, 'Mermaid syntax should be opt-in')

  const richPrompt = buildLessonSystemPrompt({
    ...promptBase,
    previewCapabilities: { math: true, mermaid: true }
  })
  assert.match(richPrompt, /KaTeX 数学公式/, 'capability-aware prompts should advertise math syntax')
  assert.match(richPrompt, /Mermaid 代码围栏/, 'capability-aware prompts should advertise Mermaid syntax')
  assert.match(richPrompt, /只有当系统明确说明预览支持时/, 'prompt should keep rich syntax gated by host capability')

  console.log('check:markdown-preview-capabilities passed')
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
