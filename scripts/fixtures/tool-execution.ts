import assert from 'node:assert/strict'

import { executeToolCall, parseToolArguments } from '../../src/main/ai/tools/execution'
import type { ToolCall } from '../../src/main/ai/provider-adapter'

function toolCall(name: string, args: string, id = `call-${name}`): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: args }
  }
}

assert.deepEqual(parseToolArguments('{"query":"rag","maxResults":3}'), { query: 'rag', maxResults: 3 })
assert.deepEqual(parseToolArguments('not json'), {})
assert.deepEqual(parseToolArguments(''), {})

const ok = await executeToolCall(
  {
    web_search: async (args) => JSON.stringify({ ok: true, args })
  },
  toolCall('web_search', '{"query":"rag"}')
)
assert.deepEqual(ok, {
  toolCallId: 'call-web_search',
  name: 'web_search',
  content: '{"ok":true,"args":{"query":"rag"}}',
  isError: false
})

const returnedError = await executeToolCall(
  {
    web_fetch: async () => JSON.stringify({ error: '缺少参数 url。' })
  },
  toolCall('web_fetch', '{}')
)
assert.deepEqual(returnedError, {
  toolCallId: 'call-web_fetch',
  name: 'web_fetch',
  content: '{"error":"缺少参数 url。"}',
  isError: true
})

const thrown = await executeToolCall(
  {
    read_workspace_file: async () => {
      throw new Error('路径超出当前教学工作区。')
    }
  },
  toolCall('read_workspace_file', '{"path":"../secret"}')
)
assert.equal(thrown.toolCallId, 'call-read_workspace_file')
assert.equal(thrown.name, 'read_workspace_file')
assert.equal(thrown.isError, true)
assert.match(thrown.content, /路径超出当前教学工作区/)

const missing = await executeToolCall({}, toolCall('unknown_tool', '{}'))
assert.equal(missing.isError, true)
assert.match(missing.content, /未知工具：unknown_tool/)

console.log('tool execution rules ok')
