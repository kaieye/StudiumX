import type { OpenPathResult, TeachingSettingsV1 } from '../shared/teaching-types'
import { requireHttpUrl } from './teaching-ipc-commands'

type ExternalLinkSettings = {
  privacy: Pick<TeachingSettingsV1['privacy'], 'allowExternalLinks'>
}

export type ExternalLinkOpener = (url: string) => Promise<void>

export type ExternalHttpUrlResult = { ok: true; url: string } | { ok: false; message?: string }

export function normalizeExternalHttpUrl(rawUrl: unknown): ExternalHttpUrlResult {
  try {
    return { ok: true, url: requireHttpUrl(rawUrl) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function openExternalHttpUrl(
  rawUrl: unknown,
  settings: ExternalLinkSettings,
  opener: ExternalLinkOpener
): Promise<OpenPathResult> {
  if (!settings.privacy.allowExternalLinks) {
    return { ok: false, message: 'External links are disabled in privacy settings.' }
  }

  const parsed = normalizeExternalHttpUrl(rawUrl)
  if (!parsed.ok) return parsed

  try {
    await opener(parsed.url)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
