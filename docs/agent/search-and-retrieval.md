# 搜索与检索设计

目标是把现有 `web_search` / `web_fetch` 从“能搜能抓”提升为可追踪、可测试、可扩展的检索模块。

## 当前能力

`src/main/ai/tools/web_search.ts` 已支持：

- Firecrawl
- Parallel
- Tavily
- Exa
- SearXNG
- Brave
- DDGS / DuckDuckGo
- xAI
- 微信公众号受限链接的 fallback metadata/search 处理

`src/main/ai/tools/web_fetch.ts` 已支持：

- HTTP(S) fetch。
- 手动最多 3 次重定向。
- HTML 到文本的粗提取。
- 微信公众号受限时返回可解释元数据和公开搜索线索。
- 基础 URL host 检查。

设置已分布在：

- `src/shared/teaching-types.ts`
- `src/main/teaching-settings.ts`
- `src/renderer/src/App.tsx`

## 目标模块

新增 `SearchRuntime`，对工具暴露小接口：

```ts
type SearchRuntime = {
  search(input: SearchInput, ctx: SearchContext): Promise<SearchResultEnvelope>
  fetch(input: FetchInput, ctx: SearchContext): Promise<FetchResultEnvelope>
  diagnostics(): SearchDiagnostics
}
```

工具 handler 只负责：

1. 校验工具参数。
2. 调用 `SearchRuntime`。
3. 将结构化结果序列化给模型。

provider 选择、fallback、telemetry、正文截断和安全策略都留在 runtime 实现里。

## 输出契约

搜索结果建议统一为：

```ts
type SearchResultEnvelope = {
  query: string
  backend: string
  attemptedBackends: Array<{
    backend: string
    ok: boolean
    error?: string
    latencyMs?: number
  }>
  results: SearchSource[]
}

type SearchSource = {
  sourceId: string
  title: string
  url: string
  snippet?: string
  publishedAt?: string
  retrievedAt: string
  provider: string
  score?: number
}
```

抓取结果建议统一为：

```ts
type FetchResultEnvelope = {
  sourceId: string
  url: string
  finalUrl: string
  title?: string
  text: string
  retrievedAt: string
  contentType?: string
  truncated: boolean
  attempts: FetchAttempt[]
  restricted?: {
    kind: 'wechat' | 'robots' | 'auth' | 'unsupported'
    message: string
    fallbackQueries?: string[]
  }
}
```

模型侧回答可以引用 `sourceId`，UI 侧可以把 `sourceId -> url/title/retrievedAt` 渲染为来源列表。

## Provider seam

每个后端实现同一接口：

```ts
type SearchProvider = {
  id: string
  capabilities: {
    search: boolean
    fetch: boolean
    freshness?: boolean
    semantic?: boolean
  }
  isAvailable(settings: TeachingSettingsV1): Availability
  search(input: SearchInput, ctx: ProviderContext): Promise<SearchProviderResult>
}
```

这样可以把当前大函数拆成 provider adapters：

- `FirecrawlProvider`
- `ParallelProvider`
- `TavilyProvider`
- `ExaProvider`
- `SearxngProvider`
- `BraveProvider`
- `DuckDuckGoProvider`
- `XaiProvider`

`SearchRuntime` 根据设置和 provider availability 决定使用首选后端或 fallback。

## 抓取安全边界

`web_fetch` 需要从 URL 字符串检查升级为连接前后的网络地址检查：

- 禁止 `localhost`、loopback、link-local、private IPv4/IPv6、CGNAT、云 metadata 地址。
- DNS 解析后检查每个 A/AAAA 结果。
- 跟随重定向时重新执行同样检查。
- 明确代理行为：如果使用 HTTP/SOCKS proxy，要记录 proxy mode，并避免 `no_proxy` 绕过安全检查。
- body 读取使用流式上限，不能先读完整响应再截断。
- HTML 解析优先使用可靠 parser；正则提取只作为 fallback。

## 微信与受限内容

微信公众号等受限链接不应伪装成成功抓取。返回应包含：

- 受限类型。
- 原始 URL。
- 可公开检索的标题或关键词。
- 建议的 fallback search queries。
- 明确说明没有读取完整正文。

## 缓存与截断

建议先做发送时截断，不急于引入持久缓存：

- 搜索结果保留结构化元数据和短 snippet。
- fetch text 按字符、token、行数三重上限截断。
- 长正文返回 `truncated: true` 和可复取的 `sourceId`。
- 对模型输出强调：没有 fetch 的页面只能基于 snippet 作答。

## 测试计划

单元测试：

- provider availability 与 fallback 顺序。
- 每个 provider adapter 的响应归一化。
- `sourceId` 稳定性和 `retrievedAt` 存在性。
- URL 安全检查覆盖 IPv4、IPv6、DNS、重定向、metadata、CGNAT。
- 长 HTML、非 HTML、错误状态、超时和受限链接。

集成测试：

- fake provider 返回确定性结果，验证 `web_search` tool 输出。
- fake fetch server 验证重定向和 body 上限。
- 设置关闭时 registry 不注册搜索/抓取工具。

验收标准：

- agent 回答中可稳定生成来源引用。
- 失败时能看见后端 attempts，不再只有一段不可分类错误。
- 抓取安全策略可测试，不依赖人工审查。

