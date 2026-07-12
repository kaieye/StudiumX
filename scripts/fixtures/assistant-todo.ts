import assert from 'node:assert/strict'
import {
  appendTodoOutputContract,
  mergeAssistantTodoTasks,
  parseAssistantTodoPayload,
  stripAssistantTodoPayload
} from '../../src/renderer/src/study-space/assistantTodo'

const answer = `先按优先级推进：

\`\`\`todo
{"tasks":["完成线性代数习题","整理课堂错题","预习下一章"]}
\`\`\``

assert.deepEqual(parseAssistantTodoPayload(answer), [
  '完成线性代数习题',
  '整理课堂错题',
  '预习下一章'
])
assert.equal(stripAssistantTodoPayload(answer), '先按优先级推进：')
assert.deepEqual(parseAssistantTodoPayload('- 普通项目符号\n- 不应导入'), [])

const contracted = appendTodoOutputContract('帮我制作今天的 TodoList')
assert.match(contracted, /```todo/)
assert.equal(appendTodoOutputContract('解释一下傅里叶变换'), '解释一下傅里叶变换')

const merged = mergeAssistantTodoTasks(
  [{ id: 'old', title: '整理课堂错题', done: false }],
  ['完成线性代数习题', '整理课堂错题'],
  1234
)
assert.equal(merged.added, 1)
assert.deepEqual(merged.tasks.map((task) => task.title), ['完成线性代数习题', '整理课堂错题'])

console.log('assistant todo checks passed')
