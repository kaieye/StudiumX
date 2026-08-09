/**
 * Prompt builders for AI-assisted mind map generation (see docs/mindmap/design.md §5.1).
 *
 * Mirrors the tone and strict-JSON contract of `lesson-prompts.ts`: the model is
 * instructed to return ONLY a JSON object matching the `MindMapDocument` schema,
 * with no HTML and no markdown code-fence wrapping. Zod validates downstream and
 * any failure surfaces as a structured `MindMapGenerationError` — never a silent
 * degradation.
 */

/**
 * System prompt — demands a single JSON object matching the `MindMapDocument`
 * schema. The structure mirrors XMind's sheet → rootTopic → recursive topic tree.
 * Kept concise and deterministic so output is stable and cheap to cache.
 */
export function buildMindMapSystemPrompt(opts: {
  title: string
  prompt: string
}): string {
  return `你是一个帮助用户梳理想法、整理知识的思维导图助手。请围绕用户给定的主题与提示词，生成一棵结构化的思维导图。

# 严格输出契约
- 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码围栏、不要 HTML。
- JSON 必须符合下面的 TypeScript 结构：

{
  "schemaVersion": 1,
  "id": string,                          // 唯一标识，如 "mindmap-xxx"
  "title": string,                       // 导图标题
  "createdAt": string,                   // ISO 8601 时间，如 "2026-08-09T00:00:00.000Z"
  "updatedAt": string,                   // 与 createdAt 相同
  "sheets": [                            // 一个或多个 sheet
    {
      "id": string,                      // 唯一标识
      "title": string,                   // sheet 标题
      "structureClass": string,          // 布局，取值只允许 org.xmind.ui.logic.* 之一：
                                         //   "org.xmind.ui.logic.right"（默认）
                                         //   | "org.xmind.ui.logic.balanced"
                                         //   | "org.xmind.ui.logic.left"
                                         //   | "org.xmind.ui.logic.map"
                                         //   | "org.xmind.ui.logic.down"
                                         //   | "org.xmind.ui.logic.up"
      "root": {                          // 中心主题
        "id": string,
        "title": string,
        "note": string,                  // 可选：备注/说明
        "children": [                    // 可选，默认 []；递归的子树
          {
            "id": string,
            "title": string,
            "note": string,              // 可选
            "collapsed": boolean,        // 可选：分支是否折叠
            "children": [ /* 递归同上 */ ]
          }
        ]
      }
    }
  ]
}

# 生成目标
- 导图标题：${opts.title}
- 用户提示词：${opts.prompt}

# 要求
- 每个节点必须有唯一 id 和 title；title 用简洁的中文短语。
- children 数组可省略，缺省为空数组；不要输出 children 外的额外字段。
- structureClass 只能使用上面列出的 org.xmind.ui.logic.* 取值。
- 整体内容围绕用户主题，结构清晰、层次合理，便于用户后续在 XMind 中编辑。
- 不要输出 JSON 以外的任何字符。`
}

/**
 * User prompt — asks the model for a structured brain map on the given topic,
 * with branching guidance (a central topic, 4–8 main branches, 2–4 levels depth).
 */
export function buildMindMapUserPrompt(opts: {
  title: string
  prompt: string
}): string {
  return `请为主题「${opts.title}」生成一张思维导图。

用户补充的说明：
${opts.prompt}

导图建议：
- 以一个清晰的中心主题为核心。
- 分出 4~8 个主干分支，每个分支覆盖一个主要方面。
- 每个分支再展开 2~4 层子层级，层层递进、不要过度扁平或过度深挖。
- 同级分支之间逻辑并列，父子节点之间是从属关系。

请按系统约定的 JSON 结构输出思维导图。`
}