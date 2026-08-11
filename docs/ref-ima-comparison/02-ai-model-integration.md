# AI / 模型集成对比

## 1. 模型配置策略

### IMA Copilot：内置模型选择

IMA 在 `Preferences.json` 的 `kExtraSettingInfo` 中存储模型配置：

```json
{
  "modelConfig": {
    "modelOptions": [
      {
        "id": 3,
        "name": "DeepSeek-V4-Flash",
        "isDefault": true,
        "enableEnhancement": true,
        "subModelTypes": { "0": 3, "1": 1 },
        "subModelInfos": {
          "0": { "modelId": "official_3", "enableThinking": false },
          "1": { "modelId": "official_1", "enableThinking": false }
        }
      },
      {
        "id": 3000,
        "name": "GLM-5.2",
        "subModelTypes": { "0": 3000, "1": 3001 }
      },
      {
        "id": 0,
        "name": "Hy3",
        "isNew": true
      }
    ]
  }
}
```

**特征：**
- 用户在预设模型中选择，不暴露 API key / endpoint
- 每个模型有 `subModelTypes`（可能是不同模式：普通/增强/思考）
- `enableEnhancement`（增强模式）和 `enableThinking`（思考链）开关
- 模型列表由服务端下发，可动态更新
- **用户无需管理密钥**，腾讯统一鉴权

### StudiumX：用户自配（BYOK）

```typescript
// 用户在设置中配置
{
  "providers": [{
    "name": "OpenAI",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "<encrypted-locally>",
    "model": "gpt-4o"
  }]
}
```

**特征：**
- 支持任意 OpenAI 兼容提供商
- API key 存储在**本地安全存储**，不进 Git / public DTO / Doctor / 支持包
- `baseUrl` denylist 防止敏感 endpoint
- 校/团 managed overlay 可注入免密钥配置
- **用户完全控制模型选择和成本**

**对比结论：** IMA 的内置模型体验更**低门槛**（零配置即用），StudiumX 的 BYOK 更**自主可控**。StudiumX 可借鉴 IMA 的**模型模式切换 UI**（如"增强模式"/"思考链"开关），以及**预设模型快速接入**的体验（在用户未配置时提供引导式配置流程）。

---

## 2. 知识库与 RAG

### IMA Copilot：云端知识库 + 服务端 RAG

IMA 知识库扩展（`nkohmbngmopdajidckglcoehlaeepeoi`）的架构：

```
用户选择文件 -> COS 上传（cos-BBIjKW7O.js, 160KB）
             -> 服务端解析 + 向量化 + 索引
用户提问 -> copilot 扩展发送请求
         -> 服务端 RAG 检索 -> 注入 context
         -> 模型生成回答
```

**关键发现（代码分析）：**
- 知识库主 JS（`index-SlH5K271.js`, 589KB）中**没有** `embed`、`vector`、`chunk` 关键字
- 只有 `rag`（3 次）、`search`（3 次）、`context`（3 次）
- 说明**向量化和 RAG 检索在服务端**，前端只负责文件上传和结果展示
- COS 上传逻辑独立在 `cos-BBIjKW7O.js`（160KB），包含分片上传、断点续传

**支持的知识源类型（从 copilot JS 中提取）：**
- 网页链接（`colorful-web-link.svg`）
- 微信文件（`colorful-wechat.svg`）
- PPT/Office 文件（`colorful-ppt-file.svg`）
- XMind/脑图文件（`colorful-xmind-file.svg`）
- AI 对话内容（`colorful-ai-chat.svg`）
- 笔记（`colorful-note.svg`）

### StudiumX：本地教学资源 + 词汇检索

```
MISSION.md -> 学习目标
RESOURCES.md -> 可信资源清单
课程文件 -> Markdown 讲义
LearningSession Ledger -> 教学事实

AI 教学决策 -> 以工作区文件 + Ledger 为权威
            -> teaching-lexical-search.ts（词汇检索）
            -> resource-grounder.ts（资源定位）
```

**关键特征：**
- 教学决策以**工作区文件为权威**，不依赖向量检索
- `teaching-lexical-search.ts` 提供词汇级搜索
- `resource-grounder.ts` + `resource-grounder-external-adapters.ts` 定位外部资源
- 禁止 FTS5 / 向量库做**产品搜索面**（但教学内部可用）
- 学习记录保存在 JSONL（分区+分段+摘要投影）

**对比结论：** IMA 的知识库是一个**通用 RAG 系统**（文件 -> 向量 -> 检索 -> 生成），适合"扔文件进去问问题"的场景。StudiumX 的教学系统是一个**结构化教学工作区**（目标 -> 课程 -> 证据 -> outcome），适合"有计划地学习"的场景。

StudiumX 可借鉴 IMA 的：
1. **多格式文件上传与解析**（PDF/Office/EPUB/PPT -> 文本提取 -> 知识源）
2. **知识源类型可视化**（不同来源用不同彩色图标）
3. **COS 式分片上传体验**（大文件断点续传、进度反馈）

但 StudiumX 应保持**本地处理**而非云上传，并遵守"文件是教学真相源"的底线。

---

## 3. AI 对话架构

### IMA Copilot：Copilot 扩展

IMA 的 AI 对话由 `copilot` 扩展（v4.8.5）承载：

- 主入口 `index.html-ycll7j9F.js`（4.9MB，完整应用）
- 后台 `service-worker-loader.js`（Service Worker）
- 侧边栏 `sidePanel` 权限
- `debugger` 权限（可能用于页面内容提取）
- `tabGroups` + `management` 权限（标签页/扩展管理）

**功能覆盖（从 JS 关键字分析）：**
- `stream`（15 次）：流式输出
- `thinking`（4 次）：思考链展示
- `markdown`（16 次）+ `mermaid`（9 次）：富文本渲染
- `knowledge`（22 次）：知识库集成
- `translate`（36 次）：翻译集成
- `search`（37 次）：搜索集成
- `cos`（35 次）：文件上传
- `podcast`（7 次）：播客集成
- `voice`（6 次）+ `audio`（19 次）：语音
- `ocr`（3 次）：OCR 文字识别
- `screenshot`（3 次）：截图

**Mermaid 图表类型支持（完整）：**
- pie / class / state / flow / sequence / architecture / block / c4 / gitGraph / quadrant / timeline / treemap
- cose-bilkent 图布局算法

### StudiumX：TeachingTurnCoordinator + AgentLoop

```
用户输入 -> TeachingTurnCoordinator
         -> TeachingSessionRuntime
         -> AgentLoop（provider-adapter -> SSE 解析 -> 工具执行）
         -> LessonRenderer（Markdown/KaTeX/Mermaid 渲染）
         -> LearningOutcomeEvaluator -> LearningOutcomeCommitter
         -> LearningSessionLedger（持久化教学事实）
```

**关键模块：**
- `agent-loop.ts`：Agent 执行循环
- `provider-adapter/`：多提供商适配（request-builder, response-parser, sse-parser, formats, capabilities）
- `context-compactor.ts`：上下文压缩（cutpoints + reduction guard）
- `teaching-turn-orchestrator.ts`：教学轮次编排
- `lesson-renderer.ts` + `lesson-rendering/`：课程渲染（document-frame, markup-compiler）
- `teaching-lexical-search.ts`：词汇搜索
- `search-runtime.ts`：搜索运行时
- `web-search/`：网络搜索工具（providers, normalizers, settings）

**对比结论：** IMA Copilot 是一个**功能聚合型 AI 助手**（对话 + 搜索 + 翻译 + 文件 + OCR + 截图 + 播客 + 语音），功能广但每个功能深度有限。StudiumX 是一个**教学深度型 AI 工作区**（对话 -> 规划 -> 课程 -> 证据 -> outcome -> 复习），功能窄但教学链路完整。

StudiumX 可借鉴 IMA Copilot 的：
1. **多模态输入**（截图 -> OCR -> 提问；语音输入）
2. **页面内容提取**（`debugger` 权限提取当前页面上下文，注入对话）
3. **侧边栏对话模式**（`sidePanel`，不遮挡主内容）
4. **Mermaid 完整图表类型**（StudiumX 已有 mermaid 依赖，但可扩展图表类型覆盖度）

---

## 4. 搜索能力

### IMA Copilot：双搜索引擎

IMA 有两个搜索扩展：
1. **IMA搜索**（v5.8.0）：主页搜索，`chrome_url_overrides: home`
2. **问问ima**（v5.7.0）：问答搜索，带 `sidePanel`

**搜索引擎配置：** `kDefaultSearchEngine: 5`（支持切换）
**搜索能力：** 联网搜索 + 知识库搜索融合

### StudiumX：词汇搜索 + 网络搜索工具

- `teaching-lexical-search.ts`：教学内容词汇搜索
- `search-runtime.ts`：搜索运行时
- `web-search/`：网络搜索工具（可配置提供商）
- `web_search.ts`：网络搜索工具入口

**对比结论：** IMA 的搜索是**面向用户的搜索面**（主页 + 问答），StudiumX 的搜索是**面向教学的检索工具**（Agent 调用，不直接暴露为搜索 UI）。StudiumX 的 AGENTS.md 明确"禁止 FTS5 / 向量库做产品搜索面"，这是产品定位差异。

---

## 5. 翻译能力

### IMA Copilot：独立翻译扩展

IMA 网页翻译扩展（`jgbkoppinnkajdckajmppgnefifmgnld`, v1.4.1）：
- **整页翻译**：覆盖原文 / 双语对照
- **外文网页识别**：自动检测外文内容
- **content_scripts 注入**：`document_start` 时注入翻译脚本
- **popup 交互**：翻译设置弹窗
- **imaFrame 集成**：通过原生桥调用翻译服务

### StudiumX：无独立翻译功能

StudiumX 目前没有内置翻译能力。Agent 对话中的翻译由 LLM 在对话层面完成。

**借鉴价值：** 如果 StudiumX 的学习者需要阅读外文资料，可考虑在资源查看器中增加翻译辅助功能。但应作为**学习辅助工具**而非独立产品面，保持与教学工作流的关联。
