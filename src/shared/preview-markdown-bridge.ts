import { EXTERNAL_DESTINATION_PROTOCOLS, classifyExternalDestination } from './external-destination'

export const PREVIEW_PROTOCOL = 'studiumx-preview'
export const LEGACY_PREVIEW_PROTOCOL = 'teachos-preview'
export const PREVIEW_MARKDOWN_LINK_MESSAGE = 'studiumx:open-markdown'
export const PREVIEW_EXTERNAL_LINK_MESSAGE = 'studiumx:open-external'
export const LEGACY_PREVIEW_MARKDOWN_LINK_MESSAGE = 'teachos:open-markdown'
export const LEGACY_PREVIEW_EXTERNAL_LINK_MESSAGE = 'teachos:open-external'

const BRIDGE_SCRIPT_ID = 'studiumx-markdown-link-bridge'

export type PreviewMarkdownLink = {
  workspaceId: string
  relativePath: string
}

function markdownBridgeScript(): string {
  return `<script id="${BRIDGE_SCRIPT_ID}">
(() => {
  if (window.__studiumxMarkdownLinkBridge) return;
  window.__studiumxMarkdownLinkBridge = true;
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
    if (${JSON.stringify([`${PREVIEW_PROTOCOL}:`, `${LEGACY_PREVIEW_PROTOCOL}:`])}.includes(url.protocol)) {
      const path = decodeURIComponent(url.pathname);
      if (!/\\.(?:md|markdown)$/i.test(path)) return;
      event.preventDefault();
      window.parent.postMessage({ type: ${JSON.stringify(PREVIEW_MARKDOWN_LINK_MESSAGE)}, href: url.href }, '*');
      return;
    }
    if (${JSON.stringify(EXTERNAL_DESTINATION_PROTOCOLS)}.includes(url.protocol)) {
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
  if (url.protocol !== `${PREVIEW_PROTOCOL}:` && url.protocol !== `${LEGACY_PREVIEW_PROTOCOL}:`) return null

  const workspaceId = decodeURIComponent(url.hostname)
  const relativePath = url.pathname
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part))
    .join('/')

  if (!workspaceId || !relativePath || !/\.(?:md|markdown)$/i.test(relativePath)) return null
  return { workspaceId, relativePath }
}

/** Browser-message adapter for the same external destination allowlist used before Electron opens it. */
export function parsePreviewExternalHref(href: string): string | null {
  const target = classifyExternalDestination(href)
  return target.kind === 'browser' ? target.url : null
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
