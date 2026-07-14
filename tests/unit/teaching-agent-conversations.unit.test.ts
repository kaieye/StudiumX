import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import {
  listAgentConversations,
  readAgentConversationRecord
} from '../../src/main/teaching-agent-conversations'

const createdRoots: string[] = []

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'studiumx-agent-conversations-'))
  createdRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Teaching Agent conversation catalog', () => {
  it('does not expose the temporary conversation metadata index as a phantom conversation', async () => {
    const root = await createRoot()
    await mkdir(join(root, 'conversations'), { recursive: true })
    await writeFile(
      join(root, 'conversations', '.index.json'),
      `${JSON.stringify({ pathMeta: {} }, null, 2)}\n`,
      'utf8'
    )

    const conversations = await listAgentConversations(root, {}, {
      includeRoot: true,
      includeRootConversation: false,
      includeLegacyRootConversations: true,
      includeLessons: false,
      includeCourses: false
    })

    expect(conversations).toEqual([])
    await expect(readAgentConversationRecord(root, 'index')).rejects.toThrow('Conversation not found.')
  })
})
