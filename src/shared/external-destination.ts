export const EXTERNAL_DESTINATION_PROTOCOLS = ['http:', 'https:'] as const

type ExternalDestinationProtocol = (typeof EXTERNAL_DESTINATION_PROTOCOLS)[number]

export type BrowserExternalDestination = {
  kind: 'browser'
  url: string
  protocol: ExternalDestinationProtocol
}

export type ExternalDestinationTarget = BrowserExternalDestination | {
  kind: 'blocked'
  message: string
}

export type ExternalDestinationLaunchIntent =
  | { kind: 'launch'; target: BrowserExternalDestination }
  | { kind: 'blocked'; message: string }

export type ExternalDestinationLaunchPolicy = {
  allowExternalLinks: boolean
}

const externalDestinationProtocols = new Set<string>(EXTERNAL_DESTINATION_PROTOCOLS)
const invalidExternalUrlMessage = 'External URL must be a valid http(s) URL.'
const externalLinksDisabledMessage = 'External links are disabled in privacy settings.'

/**
 * Parses an untrusted destination and classifies the only supported launch target.
 * Browser launchers may use this for presentation; the main process remains the
 * authority that applies the privacy policy before opening a destination.
 */
export function classifyExternalDestination(rawUrl: unknown): ExternalDestinationTarget {
  if (typeof rawUrl !== 'string') {
    return { kind: 'blocked', message: 'IPC payload field "url" must be a string.' }
  }

  try {
    const parsed = new URL(rawUrl)
    if (!externalDestinationProtocols.has(parsed.protocol)) {
      return { kind: 'blocked', message: invalidExternalUrlMessage }
    }
    return {
      kind: 'browser',
      url: parsed.toString(),
      protocol: parsed.protocol as ExternalDestinationProtocol
    }
  } catch {
    return { kind: 'blocked', message: invalidExternalUrlMessage }
  }
}

/**
 * Converts a classified destination and the privacy setting into a launch decision.
 * This is deliberately side-effect free so Electron and browser callers stay adapters.
 */
export function resolveExternalDestinationLaunchIntent(
  rawUrl: unknown,
  policy: ExternalDestinationLaunchPolicy
): ExternalDestinationLaunchIntent {
  // Preserve the capability boundary: disabled privacy settings reject before inspecting a URL.
  if (!policy.allowExternalLinks) {
    return { kind: 'blocked', message: externalLinksDisabledMessage }
  }
  const target = classifyExternalDestination(rawUrl)
  return target.kind === 'blocked' ? target : { kind: 'launch', target }
}
