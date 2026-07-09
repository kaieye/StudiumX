import assert from 'node:assert/strict'

import type { ToolContext } from '../../src/main/ai/tools/registry'
import { webFetchTool } from '../../src/main/ai/tools/web_fetch'
import { webSearchTool } from '../../src/main/ai/tools/web_search'

const wechatUrl =
  'https://mp.weixin.qq.com/s/test-article?__biz=MzIxMjE0&mid=2247483666&idx=1&sn=abcdef#wechat_redirect'
const blockedWeChatUrl =
  'https://mp.weixin.qq.com/s/blocked-article?__biz=MzIxMjE0&mid=2247483777&idx=1&sn=blocked'
const fallbackUrl = 'https://example.com/repost/wechat-article'

const wechatWallHtml = `
<!doctype html>
<html>
  <head>
    <title>微信公众平台</title>
    <meta property="og:title" content="AI 教学系统优化实战">
    <meta property="og:description" content="讲解 web_search 如何处理微信受限页面。">
    <script>
      var msg_title = "AI 教学系统优化实战";
      var msg_desc = "讲解 web_search 如何处理微信受限页面。";
      var nickname = "StudiumX研究所";
      var ct = "1767225600";
    </script>
  </head>
  <body>
    <div class="weui-msg">
      <p>请在微信客户端打开链接</p>
      <p>当前环境异常，需要登录后继续访问。</p>
    </div>
  </body>
</html>
`

const duckDuckGoHtml = `
<html>
  <body>
    <table>
      <tr>
        <td>
          <a rel="nofollow" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(fallbackUrl)}&amp;rut=test" class='result-link'>
            AI 教学系统优化实战 - 转载
          </a>
        </td>
      </tr>
      <tr>
        <td class='result-snippet'>
          StudiumX研究所发布的微信文章摘要，讲解 web_search 如何处理受限页面。
        </td>
      </tr>
    </table>
  </body>
</html>
`

const requests: string[] = []
const originalFetch = globalThis.fetch

globalThis.fetch = async (input: string | URL | Request) => {
  const url = input.toString()
  requests.push(url)
  if (url.startsWith('https://mp.weixin.qq.com/s/test-article')) {
    return new Response(wechatWallHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  }
  if (url.startsWith('https://mp.weixin.qq.com/s/blocked-article')) {
    return new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
  }
  if (url.startsWith('https://lite.duckduckgo.com/lite/')) {
    return new Response(duckDuckGoHtml, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  }
  throw new Error(`unexpected fetch: ${url}`)
}

try {
  const ctx = { proxyUrl: '', settings: {} } as ToolContext

  const fetchPayload = JSON.parse(await webFetchTool.handler({ url: wechatUrl }, ctx))
  assert.equal(fetchPayload.access, 'restricted')
  assert.match(fetchPayload.reason, /微信/)
  assert.equal(fetchPayload.metadata.title, 'AI 教学系统优化实战')
  assert.equal(fetchPayload.metadata.author, 'StudiumX研究所')
  assert.equal(fetchPayload.results[0]?.url, fallbackUrl)
  assert.doesNotMatch(fetchPayload.text ?? '', /请在微信客户端打开/)
  assert.match(fetchPayload.guidance, /不能声称已读取原文全文/)

  const blockedPayload = JSON.parse(await webFetchTool.handler({ url: blockedWeChatUrl }, ctx))
  assert.equal(blockedPayload.access, 'restricted')
  assert.match(blockedPayload.fetchError, /403/)
  assert.equal(blockedPayload.results[0]?.url, fallbackUrl)

  const searchPayload = JSON.parse(await webSearchTool.handler({ query: wechatUrl, maxResults: 3 }, ctx))
  assert.equal(searchPayload.wechat.access, 'restricted')
  assert.equal(searchPayload.wechat.metadata.title, 'AI 教学系统优化实战')
  assert.equal(searchPayload.results[0]?.url, fallbackUrl)
  assert.ok(
    requests.some((url) => url.includes('AI%20%E6%95%99%E5%AD%A6%E7%B3%BB%E7%BB%9F%E4%BC%98%E5%8C%96%E5%AE%9E%E6%88%98')),
    'fallback search should use the extracted WeChat title'
  )

  console.log('wechat web tool fallback ok')
} finally {
  globalThis.fetch = originalFetch
}
