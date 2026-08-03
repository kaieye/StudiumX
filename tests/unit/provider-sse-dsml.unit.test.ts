import { describe, expect, it } from 'vitest'
import { readChatSseStream } from '../../src/main/ai/provider-adapter/sse-parser'

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[index]))
      index += 1
    }
  })
}

describe('readChatSseStream DSML handling', () => {
  it('parses DSML tool markup from stream text and strips it from the answer', async () => {
    const dsml = [
      '<｜｜DSML｜｜tool_calls>',
      '<｜｜DSML｜｜invoke name="write_workspace_file">',
      '<｜｜DSML｜｜parameter name="path" string="true">GLOSSARY.md</｜｜DSML｜｜parameter>',
      '</｜｜DSML｜｜invoke>',
      '</｜｜DSML｜｜tool_calls>'
    ].join('')
    const payload = JSON.stringify({
      choices: [{ delta: { content: `before ${dsml}` } }]
    })
    const result = await readChatSseStream(
      sseBody([`data: ${payload}\n\n`, 'data: [DONE]\n\n']),
      'chat_completions'
    )

    expect(result.text).toBe('before')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]?.function.name).toBe('write_workspace_file')
    expect(result.toolCalls[0]?.function.arguments).toContain('GLOSSARY.md')
  })

  it('strips XML-style tool-call markup from provider text before it reaches the transcript', async () => {
    const payload = JSON.stringify({
      choices: [{ delta: { content: '课程已生成。<tool_call>write_workspace_file<arg_key>path</arg_key><arg_value>GLOSSARY.md</arg_value></tool_call>' } }]
    })
    const result = await readChatSseStream(
      sseBody([`data: ${payload}\n\n`, 'data: [DONE]\n\n']),
      'chat_completions'
    )

    expect(result.text).toBe('课程已生成。')
  })

  it('strips unclosed DSML tool markup from the assembled answer text', async () => {
    const payload = JSON.stringify({
      choices: [{ delta: { content: '正文前缀 <｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="write_workspace_file">' } }]
    })
    const result = await readChatSseStream(
      sseBody([`data: ${payload}\n\n`, 'data: [DONE]\n\n']),
      'chat_completions'
    )
    expect(result.text).toBe('正文前缀')
    expect(result.toolCalls).toHaveLength(0)
  })
})
