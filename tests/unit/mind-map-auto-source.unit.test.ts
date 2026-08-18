import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  matchMindMapPromptMarkdownPaths,
  resolveMindMapAutoSourceContext
} from '../../src/main/mindmap/mind-map-auto-source'

const roots: string[] = []

async function workspaceRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `studiumx-mind-map-auto-source-${label}-`))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('matchMindMapPromptMarkdownPaths', () => {
  it('matches every Markdown file below a Chinese directory named in the prompt', () => {
    const matched = matchMindMapPromptMarkdownPaths(
      '请根据资料分析的 md 文档生成完整思维导图。',
      [
        '资料分析/基础速算与比重.md',
        '资料分析/盐水与混合.md',
        '言语理解/词语辨析.md',
        '资料分析/图片.png'
      ]
    )

    expect(matched).toEqual([
      '资料分析/基础速算与比重.md',
      '资料分析/盐水与混合.md'
    ])
  })

  it('matches an explicitly-mentioned Markdown file without attaching sibling folders', () => {
    expect(matchMindMapPromptMarkdownPaths(
      '根据基础速算与比重.md，整理公式和易错点。',
      [
        '资料分析/基础速算与比重.md',
        '资料分析/盐水与混合.md',
        '言语理解/词语辨析.md'
      ]
    )).toEqual(['资料分析/基础速算与比重.md'])
  })

  it('does not match files when the prompt does not name a meaningful workspace path', () => {
    expect(matchMindMapPromptMarkdownPaths(
      '帮我生成一张考试复习思维导图。',
      ['资料分析/基础速算与比重.md', '言语理解/词语辨析.md']
    )).toEqual([])
  })
})

describe('resolveMindMapAutoSourceContext', () => {
  it('reads only Markdown below the folder inferred from user language', async () => {
    const root = await workspaceRoot('folder')
    await mkdir(join(root, '资料分析'), { recursive: true })
    await mkdir(join(root, '言语理解'), { recursive: true })
    await writeFile(join(root, '资料分析', '基础速算与比重.md'), '# 比重\n现期比重 = 部分 / 整体。', 'utf8')
    await writeFile(join(root, '资料分析', '盐水与混合.md'), '# 盐水\n浓度 = 溶质 / 溶液。', 'utf8')
    await writeFile(join(root, '言语理解', '词语辨析.md'), '# 词语\n语境辨析。', 'utf8')
    await writeFile(join(root, '资料分析', '图表.png'), 'not markdown', 'utf8')

    const context = await resolveMindMapAutoSourceContext(
      root,
      '请根据资料分析文件夹中的 Markdown 文档生成一张完整导图。'
    )

    expect(context).toMatchObject({
      byteLength: expect.any(Number),
      files: [
        {
          sourceRef: { workspacePath: '资料分析/基础速算与比重.md' },
          content: expect.stringContaining('现期比重')
        },
        {
          sourceRef: { workspacePath: '资料分析/盐水与混合.md' },
          content: expect.stringContaining('浓度')
        }
      ]
    })
    expect(context?.files.map((file) => file.sourceRef.workspacePath)).toEqual([
      '资料分析/基础速算与比重.md',
      '资料分析/盐水与混合.md'
    ])
    expect(JSON.stringify(context?.files.map((file) => file.sourceRef))).not.toContain(root)
  })

  it('keeps non-mentioned, linked, and over-budget files out of the provider context', async () => {
    const root = await workspaceRoot('limits')
    await mkdir(join(root, '资料分析'), { recursive: true })
    await mkdir(join(root, 'outside'), { recursive: true })
    await writeFile(join(root, '资料分析', 'a.md'), '1234', 'utf8')
    await writeFile(join(root, '资料分析', 'b.md'), '5678', 'utf8')
    await writeFile(join(root, 'outside', 'secret.md'), 'must not be read', 'utf8')
    await symlink(join(root, 'outside', 'secret.md'), join(root, '资料分析', 'link.md'))

    const context = await resolveMindMapAutoSourceContext(
      root,
      '根据资料分析文件夹的资料生成导图。',
      { maxTotalBytes: 5 }
    )

    expect(context?.files.map((file) => file.sourceRef.workspacePath)).toEqual(['资料分析/a.md'])
    expect(context?.files.map((file) => file.content)).toEqual(['1234'])
    expect(context?.byteLength).toBe(4)
  })
})
