import type { OpenPathResult, TeachingSettingsV1 } from '../shared/teaching-types'
import {
  classifyExternalDestination,
  resolveExternalDestinationLaunchIntent
} from '../shared/external-destination'

type ExternalLinkSettings = {
  privacy: Pick<TeachingSettingsV1['privacy'], 'allowExternalLinks'>
}

export type ExternalLinkOpener = (url: string) => Promise<void>

export type ExternalHttpUrlResult = { ok: true; url: string } | { ok: false; message?: string }

/** Electron-facing compatibility adapter for callers that need an http(s) URL string. */
export function normalizeExternalHttpUrl(rawUrl: unknown): ExternalHttpUrlResult {
  const target = classifyExternalDestination(rawUrl)
  return target.kind === 'browser'
    ? { ok: true, url: target.url }
    : { ok: false, message: target.message }
}

/** Electron-facing launch adapter; parsing and policy decisions live in external-destination. */
export async function openExternalHttpUrl(
  rawUrl: unknown,
  settings: ExternalLinkSettings,
  opener: ExternalLinkOpener
): Promise<OpenPathResult> {
  const intent = resolveExternalDestinationLaunchIntent(rawUrl, settings.privacy)
  if (intent.kind === 'blocked') {
    return { ok: false, message: intent.message }
  }

  try {
    await opener(intent.target.url)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
