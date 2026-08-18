/**
 * Main-only MCP OAuth deep-link router (ADR-0013).
 *
 * Accepts only the fixed studiumx://mcp-oauth/callback path and never opens
 * arbitrary deep-link routes or executes callback payload content.
 */

import type { App } from 'electron'

import { MCP_OAUTH_CALLBACK_URI } from '../../shared/mcp/oauth-types'

export type McpOAuthDeepLinkHandler = (deepLink: string) => void | Promise<void>

/**
 * Structural app surface used by the bridge.
 *
 * Prefer `Pick` over a hand-written catch-all `on(event: string, …)`: Electron's
 * `App.on` is overload-only, so a wide string-event signature rejects real `App`
 * under TS2322. `Pick` keeps real Electron `App` assignable while still allowing
 * narrow fakes in unit tests.
 */
export type McpOAuthDeepLinkApp = Pick<App, 'on' | 'setAsDefaultProtocolClient'>

export type InstallMcpOAuthDeepLinkBridgeOptions = Readonly<{
  app: McpOAuthDeepLinkApp
  handleDeepLink: McpOAuthDeepLinkHandler
  /** Optional argv snapshot used by tests; defaults to process.argv. */
  argv?: readonly string[]
  platform?: NodeJS.Platform
}>

const CALLBACK_PREFIX = MCP_OAUTH_CALLBACK_URI

/**
 * Install protocol registration and OS deep-link listeners. Must run before
 * app ready completes on platforms that deliver cold-start URLs via argv.
 */
export function installMcpOAuthDeepLinkBridge(
  options: InstallMcpOAuthDeepLinkBridgeOptions
): void {
  const platform = options.platform ?? process.platform
  try {
    options.app.setAsDefaultProtocolClient('studiumx')
  } catch {
    // Protocol registration is best-effort; authorization remains explicit.
  }

  options.app.on('open-url', (event, url) => {
    event.preventDefault()
    void routeMcpOAuthDeepLink(url, options.handleDeepLink)
  })

  options.app.on('second-instance', (_event, argv) => {
    const candidate = extractMcpOAuthDeepLink(argv ?? [])
    if (candidate) void routeMcpOAuthDeepLink(candidate, options.handleDeepLink)
  })

  // Cold start on Windows/Linux may carry the callback in process argv.
  if (platform !== 'darwin') {
    const coldStart = extractMcpOAuthDeepLink(options.argv ?? process.argv)
    if (coldStart) void routeMcpOAuthDeepLink(coldStart, options.handleDeepLink)
  }
}

export function extractMcpOAuthDeepLink(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && isMcpOAuthCallbackCandidate(arg)) return arg
  }
  return null
}

export function isMcpOAuthCallbackCandidate(value: string): boolean {
  return value.startsWith(CALLBACK_PREFIX)
}

async function routeMcpOAuthDeepLink(
  deepLink: string,
  handleDeepLink: McpOAuthDeepLinkHandler
): Promise<void> {
  if (!isMcpOAuthCallbackCandidate(deepLink)) return
  try {
    await handleDeepLink(deepLink)
  } catch {
    // Fail closed: never throw into Electron app event dispatch.
  }
}
