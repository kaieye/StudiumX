export const PREVIEW_MARKDOWN_LINK_MESSAGE = 'teachos:open-markdown'
export const PREVIEW_EXTERNAL_LINK_MESSAGE = 'teachos:open-external'

const BRIDGE_SCRIPT_ID = 'teachos-markdown-link-bridge'

export type PreviewMarkdownLink = {
  workspaceId: string
  relativePath: string
}

function markdownBridgeScript(): string {
  return `<script id="${BRIDGE_SCRIPT_ID}">
(() => {
  if (window.__teachosMarkdownLinkBridge) return;
  window.__teachosMarkdownLinkBridge = true;
  document.addEventListener('click', (event) => {
    const target = event.target;
    const anchor = target instanceof Element ? target.closest('a[href]') : null;
    if (!anchor) return;
    let url;
    try {
      url = new URL(anchor.href || anchor.getAttribute('href') || '', window.location.href);
    } catch {
      return;
    }
    if (url.protocol === 'teachos-preview:') {
      const path = decodeURIComponent(url.pathname);
      if (!/\\.(?:md|markdown)$/i.test(path)) return;
      event.preventDefault();
      window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_MARKDOWN_LINK_MESSAGE)}, href: url.href }, '*');
      return;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      event.preventDefault();
      window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_EXTERNAL_LINK_MESSAGE)}, href: url.href }, '*');
    }
  }, true);
})();
</script>`
}

export function injectPreviewMarkdownLinkBridge(html: string): string {
  if (html.includes(`id="${BRIDGE_SCRIPT_ID}"`)) return html
  const script = markdownBridgeScript()
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}\n</body>`)
  return `${html}\n${script}`
}

export function ensurePreviewBaseTag(html: string, baseHref: string): string {
  if (/<base\s/i.test(html)) return html
  return html.replace(/<head([^>]*)>/i, `<head$1>\n  <base href="${escapeHtmlAttribute(baseHref)}" />`)
}

export function parsePreviewMarkdownHref(href: string): PreviewMarkdownLink | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'teachos-preview:') return null

  const workspaceId = decodeURIComponent(url.hostname)
  const relativePath = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
    .join('/')

  if (!workspaceId || !relativePath || !/\.(?:md|markdown)$/i.test(relativePath)) return null
  return { workspaceId, relativePath }
}

export function parsePreviewExternalHref(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
